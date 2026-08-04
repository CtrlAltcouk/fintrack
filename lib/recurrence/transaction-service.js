const { validateRecurrence } = require('./dates');
const { serializeSeries } = require('./service');
const {
  resumeAutomaticSeries,
  skipNextAutomaticOccurrence,
  stopAutomaticSeries,
} = require('./automatic-series-service');

function normalizeMetadata(value) {
  if (value === undefined || value === null) return '{}';
  if (typeof value === 'string') {
    try { JSON.parse(value); return value; } catch { return null; }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.stringify(value);
}

function createRecurringTransaction(db, userId, input, recurrenceInput) {
  const recurrence = validateRecurrence(recurrenceInput, { defaultStartDate: input.date });
  if (recurrence.error) return { error: recurrence.error, status: 400 };
  const metadata = normalizeMetadata(input.metadata);
  if (metadata === null) return { error: 'metadata must be valid JSON data', status: 400 };
  const value = recurrence.value;

  return db.transaction(() => {
    const seriesResult = db.prepare(`INSERT INTO recurring_series
      (user_id, kind, frequency_unit, frequency_interval, start_date,
       anchor_day, anchor_month, time_zone, end_mode, end_date,
       max_occurrences, status, next_due_date, next_sequence)
      VALUES (?, 'transaction', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)`
    ).run(
      userId, value.frequency_unit, value.frequency_interval, value.start_date,
      value.anchor_day, value.anchor_month, value.time_zone, value.end_mode,
      value.end_date, value.max_occurrences, value.start_date
    );
    const seriesId = Number(seriesResult.lastInsertRowid);
    db.prepare(`INSERT INTO recurring_transaction_templates
      (recurring_series_id, account_id, category_id, amount, description,
       notes, transaction_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      seriesId, input.account_id ?? null, input.category_id, input.amount,
      input.description, input.notes ?? null, input.transaction_type ?? 'expense', metadata
    );
    return {
      recurring_series_id: seriesId,
      series: serializeSeries(db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(seriesId)),
    };
  })();
}

function updateTransactionFuture(db, series, input) {
  const current = db.prepare(
    'SELECT * FROM recurring_transaction_templates WHERE recurring_series_id = ?'
  ).get(series.id);
  if (!current) return { error: 'recurring transaction template not found', status: 404 };
  const metadata = input.metadata === undefined ? current.metadata : normalizeMetadata(input.metadata);
  if (metadata === null) return { error: 'metadata must be valid JSON data', status: 400 };
  db.prepare(`UPDATE recurring_transaction_templates SET
    amount = ?, description = ?, category_id = ?, account_id = ?, notes = ?,
    transaction_type = ?, metadata = ?, updated_at = datetime('now')
    WHERE recurring_series_id = ?`
  ).run(
    input.amount ?? current.amount, input.description ?? current.description,
    input.category_id ?? current.category_id,
    input.account_id === undefined ? current.account_id : input.account_id,
    input.notes === undefined ? current.notes : input.notes,
    input.transaction_type ?? current.transaction_type, metadata, series.id
  );
  return { ok: true, recurring_series_id: series.id };
}

module.exports = {
  createRecurringTransaction,
  resumeTransactionSeries: resumeAutomaticSeries,
  skipNextTransactionOccurrence: skipNextAutomaticOccurrence,
  stopTransactionSeries: stopAutomaticSeries,
  updateTransactionFuture,
};
