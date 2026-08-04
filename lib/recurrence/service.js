const { materializeSeriesRange } = require('./engine');
const { getRecurrenceAdapter } = require('./registry');
const {
  currentDateForSeries, frequencyName, occurrencesBetween, parseDate, validateRecurrence,
} = require('./dates');
require('./bill-adapter');
require('./income-adapter');
require('./transaction-adapter');
require('./transfer-adapter');
const { parseIntegerId } = require('../finance-validation');

function getOwnedSeries(db, id, userId, { kind = null } = {}) {
  let numericId;
  try { numericId = parseIntegerId(id, 'recurring series id'); }
  catch { return null; }
  let sql = 'SELECT * FROM recurring_series WHERE id = ? AND user_id = ?';
  const params = [numericId, userId];
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  return db.prepare(sql).get(...params) ?? null;
}

function serializeSeries(series) {
  return {
    ...series,
    frequency: frequencyName(series.frequency_unit, series.frequency_interval),
  };
}

function sqliteTimestampDateForSeries(value, series) {
  const text = String(value ?? '');
  const instant = new Date(`${text.replace(' ', 'T')}Z`);
  return Number.isNaN(instant.getTime()) ? null : currentDateForSeries(series, instant);
}

function defaultBillStartDate(dueDay, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(dueDay, dim)).padStart(2, '0')}`;
}

function createBillWithSeries(db, userId, billInput, recurrenceInput) {
  const recurrence = validateRecurrence(recurrenceInput, {
    dueDay: billInput.due_day,
    defaultStartDate: defaultBillStartDate(billInput.due_day),
  });
  if (recurrence.error) return { error: recurrence.error };
  const value = recurrence.value;

  return db.transaction(() => {
    const seriesResult = db.prepare(`
      INSERT INTO recurring_series
        (user_id, kind, frequency_unit, frequency_interval, start_date,
         anchor_day, anchor_month, time_zone, end_mode, end_date,
         max_occurrences, status, next_due_date, next_sequence)
      VALUES (?, 'bill', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)
    `).run(
      userId, value.frequency_unit, value.frequency_interval, value.start_date,
      value.anchor_day, value.anchor_month, value.time_zone, value.end_mode,
      value.end_date, value.max_occurrences, value.start_date
    );
    const seriesId = Number(seriesResult.lastInsertRowid);
    const billResult = db.prepare(`
      INSERT INTO bills
        (user_id, name, amount, due_day, category_id, account_id, recurring_series_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, billInput.name, billInput.amount, billInput.due_day,
      billInput.category_id, billInput.account_id ?? null, seriesId
    );
    return {
      billId: Number(billResult.lastInsertRowid),
      series: serializeSeries(db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(seriesId)),
    };
  })();
}

function materializeBillRange(db, userId, from, to) {
  if (!parseDate(from) || !parseDate(to) || from > to) throw new Error('invalid bill range');
  const seriesRows = db.prepare(`
    SELECT s.* FROM recurring_series s
    JOIN bills b ON b.recurring_series_id = s.id
    WHERE s.user_id = ? AND s.kind = 'bill' AND s.status = 'active' AND b.active = 1
  `).all(userId);
  for (const series of seriesRows) {
    materializeSeriesRange(db, series, from, to);
  }
}

function pauseSeries(db, series, now = new Date()) {
  if (series.status !== 'active') return { error: 'series is not active', status: 409 };
  db.transaction(() => {
    getRecurrenceAdapter(series.kind).removeFutureProjections?.(
      db, series, currentDateForSeries(series, now)
    );
    db.prepare(`UPDATE recurring_series
      SET status = 'paused', paused_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`).run(series.id);
  })();
  return serializeSeries(db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(series.id));
}

function resumeSeries(db, series, resumeDate = null, now = new Date()) {
  if (series.status !== 'paused') return { error: 'series is not paused', status: 409 };
  const effectiveResumeDate = resumeDate ?? currentDateForSeries(series, now);
  if (!parseDate(effectiveResumeDate)) return { error: 'resume_date must be a valid date', status: 400 };
  const pausedDate = sqliteTimestampDateForSeries(series.paused_at, series);
  const yesterday = new Date(`${effectiveResumeDate}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const through = yesterday.toISOString().slice(0, 10);

  db.transaction(() => {
    if (parseDate(pausedDate) && pausedDate <= through) {
      const insert = db.prepare(`INSERT OR IGNORE INTO recurring_occurrences
        (series_id, scheduled_date, sequence, series_revision, status, skip_reason)
        VALUES (?, ?, ?, ?, 'skipped', 'paused')`);
      const update = db.prepare(`UPDATE recurring_occurrences
        SET status = 'skipped', skip_reason = 'paused', updated_at = datetime('now')
        WHERE series_id = ? AND scheduled_date = ? AND status = 'scheduled'`);
      for (const occurrence of occurrencesBetween(series, pausedDate, through)) {
        insert.run(series.id, occurrence.date, occurrence.sequence, series.revision);
        update.run(series.id, occurrence.date);
      }
    }
    db.prepare(`UPDATE recurring_series
      SET status = 'active', paused_at = NULL, next_due_date = ?, updated_at = datetime('now')
      WHERE id = ?`).run(effectiveResumeDate, series.id);
  })();
  return serializeSeries(db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(series.id));
}

function skipOccurrence(db, series, date) {
  if (!parseDate(date)) return { error: 'date must be a valid date', status: 400 };
  const match = occurrencesBetween(series, date, date);
  if (!match.length) return { error: 'date is not an occurrence in this series', status: 400 };
  const occurrence = match[0];
  return db.transaction(() => {
    const existing = db.prepare(`SELECT ro.*
      FROM recurring_occurrences ro
      WHERE ro.series_id = ? AND ro.scheduled_date = ?`).get(series.id, date);
    if (existing) {
      const removed = getRecurrenceAdapter(series.kind).removeOccurrenceProjection?.(db, existing);
      if (removed?.error) return removed;
    }
    db.prepare(`INSERT INTO recurring_occurrences
      (series_id, scheduled_date, sequence, series_revision, status, skip_reason)
      VALUES (?, ?, ?, ?, 'skipped', 'user')
      ON CONFLICT(series_id, scheduled_date) DO UPDATE SET
        status = 'skipped', skip_reason = 'user', updated_at = datetime('now')
    `).run(series.id, date, occurrence.sequence, series.revision);
    return { ok: true, date };
  })();
}

function cancelBillSeries(db, bill) {
  db.transaction(() => {
    db.prepare("UPDATE bills SET active = 0, cancelled_at = datetime('now') WHERE id = ?").run(bill.id);
    db.prepare(`UPDATE recurring_series
      SET status = 'deleted', deleted_at = datetime('now'), next_due_date = NULL, updated_at = datetime('now')
      WHERE id = ?`).run(bill.recurring_series_id);
  })();
}

module.exports = {
  cancelBillSeries,
  createBillWithSeries,
  defaultBillStartDate,
  getOwnedSeries,
  materializeBillRange,
  pauseSeries,
  resumeSeries,
  serializeSeries,
  sqliteTimestampDateForSeries,
  skipOccurrence,
};
