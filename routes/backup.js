const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateBackupOwnership } = require('../lib/ownership');
const requireAdmin = require('../middleware/admin');
const { writeSecurityAudit } = require('../lib/security-audit');
const { frequencyConfig, occurrenceAt } = require('../lib/recurrence/dates');
const { deleteAllUserData } = require('../lib/data-deletion');
const {
  BackupValidationError, calculateBackupBalances, validateBackupSemantics,
  validateRestoredDatabase,
} = require('../lib/backup-validation');

const TABLES_EXPORT = [
  'users', 'categories', 'accounts', 'income_schedules',
  'recurring_series', 'recurring_transaction_templates', 'recurring_transfer_templates',
  'bills', 'income', 'transactions', 'transfers',
  'recurring_occurrences', 'bill_months', 'settings',
];
const TABLES_INSERT = [
  'users', 'categories', 'accounts', 'recurring_series', 'recurring_occurrences',
  'recurring_transaction_templates', 'recurring_transfer_templates',
  'bills', 'income_schedules', 'bill_months', 'income', 'transactions',
  'transfers', 'settings',
];
const TABLE_COLUMNS = Object.fromEntries(TABLES_EXPORT.map(table => [
  table,
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)),
]));

function validateBackupShape(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)
      || backup.meta?.app !== 'outflow') {
    return 'not an Outflow backup';
  }
  for (const table of TABLES_EXPORT) {
    if (!Array.isArray(backup[table])) return `missing table: ${table}`;
    for (const row of backup[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return `${table} contains an invalid row`;
      }
      const keys = Object.keys(row);
      if (!keys.length || keys.some(key => !TABLE_COLUMNS[table].has(key))) {
        return `${table} contains invalid columns`;
      }
      if (Object.values(row).some(value => value !== null && typeof value === 'object')) {
        return `${table} contains an invalid value`;
      }
    }
  }
  return null;
}

function legacyDueDate(dueDay, year, month) {
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(dueDay, dim)).padStart(2, '0')}`;
}

function upgradeLegacyBackup(backup) {
  if (Array.isArray(backup.recurring_series) || Array.isArray(backup.recurring_occurrences)) return backup;
  const upgraded = structuredClone(backup);
  upgraded.recurring_series = [];
  upgraded.recurring_occurrences = [];
  let seriesId = 1;
  let occurrenceId = 1;
  const monthsByBill = new Map();
  for (const row of upgraded.bill_months ?? []) {
    if (!monthsByBill.has(row.bill_id)) monthsByBill.set(row.bill_id, []);
    monthsByBill.get(row.bill_id).push(row);
  }
  for (const bill of upgraded.bills ?? []) {
    const months = (monthsByBill.get(bill.id) ?? []).sort((a, b) => a.year - b.year || a.month - b.month);
    const created = String(bill.created_at ?? '').slice(0, 10);
    const startYear = months[0]?.year ?? (Number(created.slice(0, 4)) || new Date().getUTCFullYear());
    const startMonth = months[0]?.month ?? (Number(created.slice(5, 7)) || new Date().getUTCMonth() + 1);
    const startDate = legacyDueDate(bill.due_day, startYear, startMonth);
    const sid = seriesId++;
    bill.recurring_series_id = sid;
    const nextSequence = months.length
      ? (months.at(-1).year - startYear) * 12 + months.at(-1).month - startMonth + 2
      : 1;
    const series = {
      id: sid, user_id: bill.user_id, kind: 'bill', frequency_unit: 'month',
      frequency_interval: 1, start_date: startDate, anchor_day: bill.due_day,
      anchor_month: null, time_zone: 'UTC', end_mode: 'never', end_date: null,
      max_occurrences: null, status: bill.active ? 'active' : 'deleted',
      next_due_date: null, next_sequence: nextSequence,
      revision: 1, paused_at: null, deleted_at: bill.cancelled_at,
      created_at: bill.created_at, updated_at: bill.cancelled_at ?? bill.created_at,
    };
    series.next_due_date = bill.active ? occurrenceAt(series, nextSequence) : null;
    upgraded.recurring_series.push(series);
    for (const row of months) {
      const dueDate = legacyDueDate(bill.due_day, row.year, row.month);
      const sequence = (row.year - startYear) * 12 + row.month - startMonth + 1;
      const oid = occurrenceId++;
      upgraded.recurring_occurrences.push({
        id: oid, series_id: sid, scheduled_date: dueDate, sequence,
        series_revision: 1, status: 'generated', skip_reason: null,
        attempt_count: 0, last_attempt_at: null, next_retry_at: null,
        failure_code: null, created_at: bill.created_at, updated_at: bill.created_at,
      });
      row.due_date = dueDate;
      row.recurring_occurrence_id = oid;
    }
  }
  return upgraded;
}

function backupIncomeSequence(series, date) {
  const start = new Date(`${series.start_date}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  if (series.frequency_unit === 'day' || series.frequency_unit === 'week') {
    const step = series.frequency_interval * (series.frequency_unit === 'week' ? 7 : 1);
    return Math.round((target - start) / 86400000 / step) + 1;
  }
  const months = (target.getUTCFullYear() - start.getUTCFullYear()) * 12
    + target.getUTCMonth() - start.getUTCMonth();
  const step = series.frequency_unit === 'year' ? series.frequency_interval * 12 : series.frequency_interval;
  return Math.round(months / step) + 1;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.map(String)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function upgradeIncomeBackup(backup) {
  const schedules = backup.income_schedules ?? [];
  const income = backup.income ?? [];
  const existingSeries = new Map(
    (backup.recurring_series ?? []).map(row => [String(row.id), row])
  );
  const existingOccurrences = new Map(
    (backup.recurring_occurrences ?? []).map(row => [String(row.id), row])
  );
  const existingSchedules = new Map(schedules.map(row => [String(row.id), row]));
  const existingCurrentScheduleBySeries = new Map(schedules
    .filter(row => row.recurring_series_id != null)
    .map(row => [String(row.recurring_series_id), row]));
  const existingSourceSchedulesBySeries = new Map();
  for (const row of income) {
    const occurrence = existingOccurrences.get(String(row.recurring_occurrence_id));
    if (!occurrence) continue;
    const key = String(occurrence.series_id);
    if (!existingSourceSchedulesBySeries.has(key)) existingSourceSchedulesBySeries.set(key, new Set());
    existingSourceSchedulesBySeries.get(key).add(String(row.source_schedule_id));
  }
  const validScheduleSeries = row => {
    const series = existingSeries.get(String(row.recurring_series_id));
    return series?.kind === 'income' && String(series.user_id) === String(row.user_id)
      && !(Number(row.active) === 1 && series.status === 'deleted')
      && !(Number(row.active) === 0 && series.status !== 'deleted');
  };
  const validIncomeOccurrence = row => {
    if (row.recurring_occurrence_id == null) return true;
    const schedule = existingSchedules.get(String(row.source_schedule_id));
    const occurrence = existingOccurrences.get(String(row.recurring_occurrence_id));
    const series = occurrence && existingSeries.get(String(occurrence.series_id));
    const currentScheduleForSeries = existingCurrentScheduleBySeries.get(String(occurrence?.series_id));
    const sourceSchedules = existingSourceSchedulesBySeries.get(String(occurrence?.series_id));
    const mixedScheduleRevision = sourceSchedules?.size !== 1
      || !sourceSchedules.has(String(row.source_schedule_id));
    return schedule && series?.kind === 'income'
      && String(schedule.user_id) === String(row.user_id)
      && String(series.user_id) === String(row.user_id)
      && occurrence.scheduled_date === row.date
      && (String(occurrence.series_id) === String(schedule.recurring_series_id)
        || (['deleted', 'completed'].includes(series.status)
          && !currentScheduleForSeries && !mixedScheduleRevision));
  };
  const duplicateScheduleSeries = new Set(duplicateValues(
    schedules.map(row => row.recurring_series_id).filter(value => value != null)
  ));
  const needsUpgrade = schedules.some(row => !validScheduleSeries(row))
    || duplicateScheduleSeries.size > 0
    || income.some(row => !Object.hasOwn(row, 'recurring_occurrence_id') || !validIncomeOccurrence(row));
  if (!needsUpgrade) return backup;
  const upgraded = structuredClone(backup);
  let seriesId = Math.max(0, ...upgraded.recurring_series.map(row => Number(row.id) || 0)) + 1;
  let occurrenceId = Math.max(0, ...upgraded.recurring_occurrences.map(row => Number(row.id) || 0)) + 1;
  const seriesById = new Map(upgraded.recurring_series.map(row => [String(row.id), row]));
  const occurrenceById = new Map(upgraded.recurring_occurrences.map(row => [String(row.id), row]));
  const currentScheduleBySeries = new Map(upgraded.income_schedules
    .filter(row => row.recurring_series_id != null)
    .map(row => [String(row.recurring_series_id), row]));
  const sourceSchedulesBySeries = new Map();
  for (const row of upgraded.income) {
    const occurrence = occurrenceById.get(String(row.recurring_occurrence_id));
    if (!occurrence) continue;
    const key = String(occurrence.series_id);
    if (!sourceSchedulesBySeries.has(key)) sourceSchedulesBySeries.set(key, new Set());
    sourceSchedulesBySeries.get(key).add(String(row.source_schedule_id));
  }
  const linkedOccurrenceIds = new Set(upgraded.income
    .map(row => row.recurring_occurrence_id)
    .filter(value => value != null)
    .map(String));
  const rowsBySchedule = new Map();
  const usedScheduleSeries = new Set();
  for (const row of upgraded.income) {
    row.recurring_occurrence_id ??= null;
    if (row.source_schedule_id == null) continue;
    if (!rowsBySchedule.has(row.source_schedule_id)) rowsBySchedule.set(row.source_schedule_id, []);
    rowsBySchedule.get(row.source_schedule_id).push(row);
  }
  for (const schedule of upgraded.income_schedules) {
    const rows = (rowsBySchedule.get(schedule.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    let series = seriesById.get(String(schedule.recurring_series_id));
    if (series?.kind !== 'income' || String(series.user_id) !== String(schedule.user_id)
        || (Number(schedule.active) === 1 && series.status === 'deleted')
        || (Number(schedule.active) === 0 && series.status !== 'deleted')
        || usedScheduleSeries.has(String(series.id))) {
      const created = String(schedule.created_at ?? '').slice(0, 10);
      let startDate = schedule.anchor_date ?? rows[0]?.date;
      if (schedule.frequency === 'monthly') {
        const basis = rows[0]?.date ?? created;
        const year = Number(basis.slice(0, 4)) || new Date().getUTCFullYear();
        const month = Number(basis.slice(5, 7)) || new Date().getUTCMonth() + 1;
        startDate = legacyDueDate(schedule.day_of_month, year, month);
      } else if (rows[0]?.date && rows[0].date < startDate) {
        startDate = rows[0].date;
      }
      const config = frequencyConfig(schedule.frequency);
      if (!config || !startDate) throw new Error(`Income schedule ${schedule.id} cannot be safely reconstructed`);
      const sid = seriesId++;
      series = {
        id: sid, user_id: schedule.user_id, kind: 'income',
        frequency_unit: config.unit, frequency_interval: config.interval,
        start_date: startDate, anchor_day: schedule.frequency === 'monthly'
          ? Number(schedule.day_of_month) : Number(startDate.slice(8, 10)),
        anchor_month: config.unit === 'year' ? Number(startDate.slice(5, 7)) : null,
        time_zone: 'UTC', end_mode: 'never', end_date: null, max_occurrences: null,
        status: schedule.active ? 'active' : 'deleted', next_due_date: null,
        next_sequence: 1, revision: 1, paused_at: null,
        deleted_at: schedule.active ? null : schedule.created_at,
        created_at: schedule.created_at, updated_at: schedule.created_at,
      };
      const previousSeriesId = String(schedule.recurring_series_id);
      if (currentScheduleBySeries.get(previousSeriesId) === schedule) {
        currentScheduleBySeries.delete(previousSeriesId);
      }
      schedule.recurring_series_id = sid;
      upgraded.recurring_series.push(series);
      seriesById.set(String(sid), series);
      currentScheduleBySeries.set(String(sid), schedule);
    }
    usedScheduleSeries.add(String(series.id));
    for (const row of rows) {
      if (row.recurring_occurrence_id != null) {
        const occurrence = occurrenceById.get(String(row.recurring_occurrence_id));
        const occurrenceSeries = occurrence && seriesById.get(String(occurrence.series_id));
        const currentScheduleForSeries = currentScheduleBySeries.get(String(occurrence?.series_id));
        const sourceSchedules = sourceSchedulesBySeries.get(String(occurrence?.series_id));
        const mixedScheduleRevision = sourceSchedules?.size !== 1
          || !sourceSchedules.has(String(schedule.id));
        if (occurrenceSeries?.kind === 'income'
            && String(occurrenceSeries.user_id) === String(row.user_id)
            && occurrence.scheduled_date === row.date
            && (String(occurrence.series_id) === String(series.id)
              || (['deleted', 'completed'].includes(occurrenceSeries.status)
                && !currentScheduleForSeries && !mixedScheduleRevision))) {
          continue;
        }
        linkedOccurrenceIds.delete(String(row.recurring_occurrence_id));
        row.recurring_occurrence_id = null;
      }
      const sequence = backupIncomeSequence(series, row.date);
      if (occurrenceAt(series, sequence) !== row.date) {
        throw new Error(`Income ${row.id} is not on schedule ${schedule.id}`);
      }
      series.next_sequence = Math.max(Number(series.next_sequence) || 1, sequence + 1);
      let occurrence = upgraded.recurring_occurrences.find(item =>
        String(item.series_id) === String(series.id) && item.scheduled_date === row.date
      );
      if (occurrence && linkedOccurrenceIds.has(String(occurrence.id))) {
        throw new Error(`Income schedule ${schedule.id} has duplicate income on ${row.date}`);
      }
      if (!occurrence) {
        occurrence = {
          id: occurrenceId++, series_id: series.id, scheduled_date: row.date, sequence,
          series_revision: series.revision ?? 1, status: 'generated', skip_reason: null,
          attempt_count: 0, last_attempt_at: null, next_retry_at: null,
          failure_code: null, created_at: row.created_at, updated_at: row.created_at,
        };
        upgraded.recurring_occurrences.push(occurrence);
        occurrenceById.set(String(occurrence.id), occurrence);
      }
      const oid = occurrence.id;
      row.recurring_occurrence_id = oid;
      linkedOccurrenceIds.add(String(oid));
    }
    series.next_due_date = schedule.active ? occurrenceAt(series, series.next_sequence) : null;
  }
  return upgraded;
}

function upgradeTransactionBackup(backup) {
  const needsTemplates = !Array.isArray(backup.recurring_transaction_templates);
  const needsOccurrenceColumn = backup.transactions?.some(
    row => !Object.hasOwn(row, 'recurring_occurrence_id')
  );
  if (!needsTemplates && !needsOccurrenceColumn) return backup;
  const upgraded = structuredClone(backup);
  upgraded.recurring_transaction_templates ??= [];
  for (const row of upgraded.transactions ?? []) row.recurring_occurrence_id ??= null;
  return upgraded;
}

function upgradeTransferBackup(backup) {
  const needsTemplates = !Array.isArray(backup.recurring_transfer_templates);
  const needsOccurrenceColumn = backup.transfers?.some(
    row => !Object.hasOwn(row, 'recurring_occurrence_id')
  );
  if (!needsTemplates && !needsOccurrenceColumn) return backup;
  const upgraded = structuredClone(backup);
  upgraded.recurring_transfer_templates ??= [];
  for (const row of upgraded.transfers ?? []) row.recurring_occurrence_id ??= null;
  return upgraded;
}

function upgradeBackup(backup) {
  const legacy = !Array.isArray(backup?.recurring_series)
    || !Array.isArray(backup?.recurring_occurrences);
  const billUpgraded = legacy ? upgradeLegacyBackup(backup) : backup;
  const upgraded = upgradeTransferBackup(
    upgradeTransactionBackup(upgradeIncomeBackup(billUpgraded))
  );
  const sanitized = structuredClone(upgraded);
  for (const user of sanitized.users ?? []) {
    delete user.session_token;
    delete user.session_token_hash;
    delete user.session_created_at;
    delete user.session_expires_at;
  }
  return sanitized;
}

function restoreBackup(database, backup, { beforeCommit } = {}) {
  if (database.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new BackupValidationError('foreign-key enforcement must be enabled during restore');
  }
  const expectedBalances = calculateBackupBalances(backup);
  database.transaction(() => {
    deleteAllUserData(database);
    database.prepare('DELETE FROM users').run();

    for (const table of TABLES_INSERT) {
      for (const row of backup[table]) {
        const columns = Object.keys(row);
        database.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
          .run(...Object.values(row));
      }
    }

    validateRestoredDatabase(database, backup, expectedBalances);
    beforeCommit?.(database);
  })();
}

router.get('/', requireAdmin('backup.export'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { version } = require('../package.json');
  const backup = { meta: {
    app: 'outflow', version, schema_version: db.pragma('user_version', { simple: true }),
    exported_at: new Date().toISOString(),
  } };
  for (const table of TABLES_EXPORT) {
    backup[table] = table === 'users'
      ? db.prepare(`
          SELECT id, display_name, password_hash, colour, is_admin, created_at, avatar
          FROM users
        `).all()
      : db.prepare(`SELECT * FROM ${table}`).all();
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="outflow-backup-${today}.json"`);
  writeSecurityAudit(req, 'backup.export', 'succeeded');
  res.send(JSON.stringify(backup, null, 2));
});

router.post('/restore', requireAdmin('backup.restore'), (req, res) => {
  const mode = req.query.mode ?? 'replace';
  if (mode === 'merge') {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'unsafe_merge_disabled' });
    return res.status(409).json({
      error: 'Merge restore is disabled because record ID collisions cannot be resolved safely. Use replace mode.',
    });
  }
  if (mode !== 'replace') {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'invalid_mode' });
    return res.status(400).json({ error: 'Restore mode must be replace' });
  }

  let suppliedBackup;
  try {
    suppliedBackup = upgradeBackup(req.body);
  } catch {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'upgrade_failed' });
    return res.status(400).json({ error: 'Invalid backup file: legacy backup upgrade failed' });
  }
  const shapeError = validateBackupShape(suppliedBackup);
  if (shapeError) {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'invalid_shape' });
    return res.status(400).json({ error: `Invalid backup file: ${shapeError}` });
  }

  const semanticError = validateBackupSemantics(suppliedBackup);
  if (semanticError) {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'invalid_recurrence' });
    return res.status(400).json({ error: `Invalid backup data: ${semanticError}` });
  }

  const ownership = validateBackupOwnership(suppliedBackup);
  if (ownership.error) {
    writeSecurityAudit(req, 'backup.restore', 'rejected', { reason: 'invalid_ownership' });
    return res.status(400).json({ error: `Invalid backup ownership: ${ownership.error}` });
  }
  const backup = ownership.backup;

  try {
    restoreBackup(db, backup);
    writeSecurityAudit(req, 'backup.restore', 'succeeded', { mode });
    res.json({ ok: true, mode });
  } catch (error) {
    writeSecurityAudit(req, 'backup.restore', 'failed', { mode });
    console.error('[backup] restore failed:', error.message);
    if (error instanceof BackupValidationError) {
      return res.status(400).json({ error: `Restore validation failed: ${error.message}` });
    }
    if (String(error.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({ error: 'Restore validation failed: backup violates database constraints' });
    }
    res.status(500).json({ error: 'Restore failed; the original database was preserved' });
  }
});

router.validateBackupShape = validateBackupShape;
router.upgradeLegacyBackup = upgradeLegacyBackup;
router.upgradeIncomeBackup = upgradeIncomeBackup;
router.upgradeTransactionBackup = upgradeTransactionBackup;
router.upgradeTransferBackup = upgradeTransferBackup;
router.upgradeBackup = upgradeBackup;
router.restoreBackup = restoreBackup;
router.TABLES_INSERT = TABLES_INSERT;
module.exports = router;
