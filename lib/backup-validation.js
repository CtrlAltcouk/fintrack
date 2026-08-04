const { frequencyName, occurrenceAt, parseDate } = require('./recurrence/dates');
const { ownershipViolations } = require('../db-migrations');
const {
  parseIntegerId, parseIsoDate, parseMoney, parseOptionalIntegerId,
  parseOptionalPositiveInteger, parsePositiveInteger, parsePositiveMoney,
} = require('./finance-validation');

class BackupValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

const ID_TABLES = Object.freeze([
  'users', 'categories', 'accounts', 'income_schedules', 'bills', 'income',
  'transactions', 'transfers', 'recurring_series', 'recurring_occurrences',
  'bill_months',
]);

const AMOUNT_FIELDS = Object.freeze([
  ['accounts', 'opening_balance', false, false],
  ['income_schedules', 'amount'],
  ['bills', 'amount'],
  ['income', 'amount'],
  ['transactions', 'amount'],
  ['transfers', 'amount'],
  ['recurring_transaction_templates', 'amount'],
  ['recurring_transfer_templates', 'amount'],
  ['bill_months', 'amount_paid', true],
]);

const REFERENCE_FIELDS = Object.freeze([
  ['categories', 'user_id'], ['accounts', 'user_id'],
  ['income_schedules', 'user_id'], ['income_schedules', 'account_id', true],
  ['income_schedules', 'recurring_series_id'],
  ['bills', 'user_id'], ['bills', 'category_id'], ['bills', 'account_id', true],
  ['bills', 'recurring_series_id'],
  ['income', 'user_id'], ['income', 'account_id', true], ['income', 'source_schedule_id', true],
  ['income', 'recurring_occurrence_id', true],
  ['transactions', 'user_id'], ['transactions', 'category_id'], ['transactions', 'account_id', true],
  ['transactions', 'recurring_occurrence_id', true],
  ['transfers', 'user_id', true], ['transfers', 'from_account_id'], ['transfers', 'to_account_id'],
  ['transfers', 'recurring_occurrence_id', true],
  ['recurring_series', 'user_id'], ['recurring_occurrences', 'series_id'],
  ['recurring_transaction_templates', 'recurring_series_id'],
  ['recurring_transaction_templates', 'category_id'],
  ['recurring_transaction_templates', 'account_id', true],
  ['recurring_transfer_templates', 'recurring_series_id'],
  ['recurring_transfer_templates', 'from_account_id'],
  ['recurring_transfer_templates', 'to_account_id'],
  ['bill_months', 'bill_id'], ['bill_months', 'recurring_occurrence_id'],
  ['settings', 'user_id'],
]);

const DATE_FIELDS = Object.freeze([
  ['income_schedules', 'anchor_date', true],
  ['bills', 'cancelled_at', true, true],
  ['income', 'date'],
  ['transactions', 'date'],
  ['transfers', 'date'],
  ['bill_months', 'due_date'],
  ['bill_months', 'paid_date', true],
  ['recurring_series', 'start_date'],
  ['recurring_series', 'end_date', true],
  ['recurring_series', 'next_due_date', true],
  ['recurring_occurrences', 'scheduled_date'],
  ['recurring_occurrences', 'last_attempt_at', true, true],
  ['recurring_occurrences', 'next_retry_at', true, true],
]);

const SERIES_STATUSES = new Set(['active', 'paused', 'completed', 'error', 'deleted']);
const OCCURRENCE_STATUSES = new Set(['scheduled', 'generated', 'skipped', 'failed', 'deleted']);

function recordError(errors, message) {
  if (errors.length < 20) errors.push(message);
}

function duplicateKeys(rows, keyFor) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const key = keyFor(row);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

function validDateValue(value, allowDateTime = false) {
  if (allowDateTime && typeof value === 'string') value = value.slice(0, 10);
  try { parseIsoDate(value); return true; } catch { return false; }
}

function validateBackupSemantics(backup) {
  const errors = [];

  for (const table of ID_TABLES) {
    for (const row of backup[table]) {
      try { parseIntegerId(row.id); }
      catch { recordError(errors, `${table} ${row.id ?? '?'} has an invalid id`); }
    }
    const duplicates = duplicateKeys(backup[table], row => String(row.id));
    if (duplicates.length) recordError(errors, `${table} contains duplicate id ${duplicates[0]}`);
  }

  for (const table of ['recurring_transaction_templates', 'recurring_transfer_templates']) {
    const duplicates = duplicateKeys(backup[table], row => String(row.recurring_series_id));
    if (duplicates.length) {
      recordError(errors, `${table} contains duplicate series id ${duplicates[0]}`);
    }
  }
  const duplicateSettings = duplicateKeys(
    backup.settings, row => `${row.user_id}:${row.key}`
  );
  if (duplicateSettings.length) recordError(errors, 'settings contains a duplicate user/key pair');

  for (const [table, field, nullable = false, positive = true] of AMOUNT_FIELDS) {
    for (const row of backup[table]) {
      if (nullable && (row[field] === null || row[field] === undefined)) continue;
      try {
        if (positive) parsePositiveMoney(row[field], field);
        else parseMoney(row[field], field);
      } catch {
        recordError(errors, `${table} ${row.id ?? row.recurring_series_id ?? '?'} has an invalid ${field}`);
      }
    }
  }

  for (const [table, field, nullable = false] of REFERENCE_FIELDS) {
    for (const row of backup[table]) {
      if (table === 'transfers' && field === 'user_id' && row[field] == null) continue;
      try {
        if (nullable) parseOptionalIntegerId(row[field], field);
        else parseIntegerId(row[field], field);
      } catch {
        recordError(errors, `${table} ${row.id ?? row.recurring_series_id ?? '?'} has an invalid ${field}`);
      }
    }
  }

  for (const row of backup.transfers) {
    if (String(row.from_account_id) === String(row.to_account_id)) {
      recordError(errors, `transfers ${row.id} uses the same account twice`);
    }
  }
  for (const row of backup.recurring_transfer_templates) {
    if (String(row.from_account_id) === String(row.to_account_id)) {
      recordError(errors, `recurring_transfer_templates ${row.recurring_series_id} uses the same account twice`);
    }
  }

  for (const [table, field, nullable = false, dateTime = false] of DATE_FIELDS) {
    for (const row of backup[table]) {
      if (nullable && (row[field] === null || row[field] === undefined)) continue;
      if (!validDateValue(row[field], dateTime)) {
        recordError(errors, `${table} ${row.id ?? '?'} has an invalid ${field}`);
      }
    }
  }

  const seriesById = new Map(backup.recurring_series.map(row => [String(row.id), row]));
  const occurrencesById = new Map(backup.recurring_occurrences.map(row => [String(row.id), row]));
  const billsBySeries = new Map(backup.bills.map(row => [String(row.recurring_series_id), row]));
  const schedulesBySeries = new Map(
    backup.income_schedules.map(row => [String(row.recurring_series_id), row])
  );
  const transactionsBySeries = new Map(
    backup.recurring_transaction_templates.map(row => [String(row.recurring_series_id), row])
  );
  const transfersBySeries = new Map(
    backup.recurring_transfer_templates.map(row => [String(row.recurring_series_id), row])
  );

  for (const series of backup.recurring_series) {
    const id = String(series.id);
    if (!['bill', 'income', 'transaction', 'transfer'].includes(series.kind)) {
      recordError(errors, `recurring series ${series.id} has an unsupported kind`);
      continue;
    }
    if (!frequencyName(series.frequency_unit, series.frequency_interval)) {
      recordError(errors, `recurring series ${series.id} has an unsupported frequency`);
    }
    if (!SERIES_STATUSES.has(series.status)) {
      recordError(errors, `recurring series ${series.id} has an invalid status`);
    }
    try {
      parsePositiveInteger(series.frequency_interval, 'frequency_interval');
      parsePositiveInteger(series.next_sequence, 'next_sequence');
      parsePositiveInteger(series.revision, 'revision');
    } catch {
      recordError(errors, `recurring series ${series.id} has invalid sequence metadata`);
    }
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: series.time_zone }).format(new Date());
    } catch {
      recordError(errors, `recurring series ${series.id} has an invalid IANA timezone`);
    }
    const validEnd = (series.end_mode === 'never' && series.end_date == null && series.max_occurrences == null)
      || (series.end_mode === 'date' && validDateValue(series.end_date) && series.max_occurrences == null)
      || (series.end_mode === 'count' && series.end_date == null
        && series.max_occurrences != null && (() => {
        try { parseOptionalPositiveInteger(series.max_occurrences, 'max_occurrences'); return true; }
        catch { return false; }
      })());
    if (!validEnd) recordError(errors, `recurring series ${series.id} has invalid end settings`);
    if (series.next_due_date != null) {
      try {
        if (occurrenceAt(series, Number(series.next_sequence)) !== series.next_due_date) {
          recordError(errors, `recurring series ${series.id} has inconsistent next occurrence metadata`);
        }
      } catch {
        recordError(errors, `recurring series ${series.id} cannot calculate its next occurrence`);
      }
    }
    const entityCount = Number(billsBySeries.has(id)) + Number(schedulesBySeries.has(id))
      + Number(transactionsBySeries.has(id)) + Number(transfersBySeries.has(id));
    const expectedEntity = (series.kind === 'bill' && billsBySeries.has(id))
      || (series.kind === 'income' && schedulesBySeries.has(id))
      || (series.kind === 'transaction' && transactionsBySeries.has(id))
      || (series.kind === 'transfer' && transfersBySeries.has(id));
    if (entityCount !== 1 || !expectedEntity) {
      recordError(errors, `recurring series ${series.id} does not have exactly one matching entity`);
    }
  }

  const occurrenceDates = duplicateKeys(
    backup.recurring_occurrences, row => `${row.series_id}:${row.scheduled_date}`
  );
  if (occurrenceDates.length) recordError(errors, 'recurring occurrences contain a duplicate series/date');
  const occurrenceSequences = duplicateKeys(
    backup.recurring_occurrences, row => `${row.series_id}:${row.sequence}`
  );
  if (occurrenceSequences.length) recordError(errors, 'recurring occurrences contain a duplicate series/sequence');

  const linkedDestinations = new Map();
  const destinationTables = [
    ['bill_months', 'bill'], ['income', 'income'],
    ['transactions', 'transaction'], ['transfers', 'transfer'],
  ];
  for (const [table, kind] of destinationTables) {
    for (const row of backup[table]) {
      if (row.recurring_occurrence_id == null) continue;
      const occurrence = occurrencesById.get(String(row.recurring_occurrence_id));
      const series = occurrence && seriesById.get(String(occurrence.series_id));
      if (!occurrence || !series || series.kind !== kind) {
        recordError(errors, `${table} ${row.id} references an invalid recurring occurrence`);
        continue;
      }
      if (occurrence.status !== 'generated') {
        recordError(errors, `${table} ${row.id} links to a non-generated occurrence`);
      }
      const key = String(occurrence.id);
      linkedDestinations.set(key, (linkedDestinations.get(key) ?? 0) + 1);
    }
  }

  for (const occurrence of backup.recurring_occurrences) {
    const series = seriesById.get(String(occurrence.series_id));
    if (!series) continue;
    let validOccurrenceIntegers = true;
    try {
      const sequence = parsePositiveInteger(occurrence.sequence, 'sequence');
      const revision = parsePositiveInteger(occurrence.series_revision, 'series_revision');
      if (revision > parsePositiveInteger(series.revision, 'revision')) validOccurrenceIntegers = false;
      if (sequence < 1) validOccurrenceIntegers = false;
    } catch { validOccurrenceIntegers = false; }
    if (!validOccurrenceIntegers) {
      recordError(errors, `recurring occurrence ${occurrence.id} has invalid sequence metadata`);
    }
    let validAttemptCount = false;
    try {
      const count = occurrence.attempt_count;
      validAttemptCount = count === 0 || count === '0'
        || parsePositiveInteger(count, 'attempt_count') >= 1;
    } catch { validAttemptCount = false; }
    if (!OCCURRENCE_STATUSES.has(occurrence.status) || !validAttemptCount) {
      recordError(errors, `recurring occurrence ${occurrence.id} has invalid lifecycle metadata`);
    }
    try {
      if (occurrenceAt(series, Number(occurrence.sequence)) !== occurrence.scheduled_date) {
        recordError(errors, `recurring occurrence ${occurrence.id} is not on its series schedule`);
      }
    } catch {
      recordError(errors, `recurring occurrence ${occurrence.id} has invalid schedule metadata`);
    }
    const links = linkedDestinations.get(String(occurrence.id)) ?? 0;
    if (occurrence.status === 'generated' && links !== 1) {
      recordError(errors, `generated occurrence ${occurrence.id} does not have exactly one destination`);
    }
    if (occurrence.status !== 'generated' && links !== 0) {
      recordError(errors, `non-generated occurrence ${occurrence.id} has a destination`);
    }
  }

  return errors.length ? errors.join('; ') : null;
}

function calculateBackupBalances(backup, today = new Date().toISOString().slice(0, 10)) {
  const balances = new Map(backup.accounts.map(row => [Number(row.id), Number(row.opening_balance)]));
  const apply = (accountId, amount) => {
    if (accountId == null || !balances.has(Number(accountId))) return;
    balances.set(Number(accountId), balances.get(Number(accountId)) + Number(amount));
  };
  for (const row of backup.income) if (row.date <= today) apply(row.account_id, row.amount);
  for (const row of backup.transactions) apply(row.account_id, -Number(row.amount));
  const bills = new Map(backup.bills.map(row => [String(row.id), row]));
  for (const row of backup.bill_months) {
    if (!row.paid) continue;
    apply(bills.get(String(row.bill_id))?.account_id, -Number(row.amount_paid ?? 0));
  }
  for (const row of backup.transfers) {
    apply(row.from_account_id, -Number(row.amount));
    apply(row.to_account_id, Number(row.amount));
  }
  return balances;
}

function validateDatabaseBalances(db, expected, today = new Date().toISOString().slice(0, 10)) {
  const actual = new Map();
  const income = db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM income WHERE account_id = ? AND user_id = ? AND date <= ?');
  const transactions = db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM transactions WHERE account_id = ? AND user_id = ?');
  const bills = db.prepare(`SELECT COALESCE(SUM(bm.amount_paid), 0) AS amount FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id WHERE b.account_id = ? AND b.user_id = ? AND bm.paid = 1`);
  const transferIn = db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM transfers WHERE to_account_id = ? AND user_id = ?');
  const transferOut = db.prepare('SELECT COALESCE(SUM(amount), 0) AS amount FROM transfers WHERE from_account_id = ? AND user_id = ?');
  for (const account of db.prepare('SELECT * FROM accounts').all()) {
    const balance = Number(account.opening_balance)
      + Number(income.get(account.id, account.user_id, today).amount)
      - Number(transactions.get(account.id, account.user_id).amount)
      - Number(bills.get(account.id, account.user_id).amount)
      + Number(transferIn.get(account.id, account.user_id).amount)
      - Number(transferOut.get(account.id, account.user_id).amount);
    actual.set(Number(account.id), balance);
  }
  if (actual.size !== expected.size) throw new BackupValidationError('account set changed during restore');
  for (const [accountId, expectedBalance] of expected) {
    const actualBalance = actual.get(accountId);
    if (!Number.isFinite(actualBalance) || Math.abs(actualBalance - expectedBalance) > 1e-7) {
      throw new BackupValidationError(`account ${accountId} balance did not restore consistently`);
    }
  }
}

function validateRestoredDatabase(db, backup, expectedBalances) {
  const foreignKeys = db.pragma('foreign_key_check');
  if (foreignKeys.length) throw new BackupValidationError('foreign-key validation failed');

  const ownership = ownershipViolations(db);
  if (ownership.length) {
    throw new BackupValidationError(`ownership validation failed for ${ownership[0].table}`);
  }

  const tableCounts = [
    'users', 'categories', 'accounts', 'income_schedules', 'recurring_series',
    'recurring_transaction_templates', 'recurring_transfer_templates', 'bills',
    'recurring_occurrences', 'bill_months', 'income', 'transactions', 'transfers', 'settings',
  ];
  for (const table of tableCounts) {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    if (count !== backup[table].length) {
      throw new BackupValidationError(`${table} row count changed during restore`);
    }
  }

  const orphanChecks = [
    ['recurring series entities', `SELECT COUNT(*) AS count FROM recurring_series s
      LEFT JOIN bills b ON b.recurring_series_id = s.id
      LEFT JOIN income_schedules i ON i.recurring_series_id = s.id
      LEFT JOIN recurring_transaction_templates rt ON rt.recurring_series_id = s.id
      LEFT JOIN recurring_transfer_templates rf ON rf.recurring_series_id = s.id
      WHERE (s.kind = 'bill' AND b.id IS NULL) OR (s.kind = 'income' AND i.id IS NULL)
        OR (s.kind = 'transaction' AND rt.recurring_series_id IS NULL)
        OR (s.kind = 'transfer' AND rf.recurring_series_id IS NULL)`],
    ['generated occurrence destinations', `SELECT COUNT(*) AS count FROM recurring_occurrences ro
      LEFT JOIN bill_months bm ON bm.recurring_occurrence_id = ro.id
      LEFT JOIN income i ON i.recurring_occurrence_id = ro.id
      LEFT JOIN transactions t ON t.recurring_occurrence_id = ro.id
      LEFT JOIN transfers f ON f.recurring_occurrence_id = ro.id
      WHERE ro.status = 'generated' AND
        ((bm.id IS NOT NULL) + (i.id IS NOT NULL) + (t.id IS NOT NULL) + (f.id IS NOT NULL)) != 1`],
    ['execution claims', `SELECT COUNT(*) AS count FROM recurring_execution_claims c
      LEFT JOIN recurring_occurrences ro ON ro.id = c.occurrence_id WHERE ro.id IS NULL`],
  ];
  for (const [name, sql] of orphanChecks) {
    if (db.prepare(sql).get().count) throw new BackupValidationError(`${name} orphan validation failed`);
  }

  const semanticError = validateBackupSemantics(backup);
  if (semanticError) throw new BackupValidationError(semanticError);
  validateDatabaseBalances(db, expectedBalances);
}

module.exports = {
  BackupValidationError,
  calculateBackupBalances,
  validateBackupSemantics,
  validateRestoredDatabase,
};
