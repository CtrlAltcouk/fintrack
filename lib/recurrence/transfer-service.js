const { validateRecurrence } = require('./dates');
const { serializeSeries } = require('./service');
const { validateTransfer } = require('../transfers/service');

function createRecurringTransfer(db, userId, input, recurrenceInput) {
  const transfer = validateTransfer(db, userId, input);
  if (transfer.error) return transfer;
  const recurrence = validateRecurrence(recurrenceInput, { defaultStartDate: transfer.value.date });
  if (recurrence.error) return { error: recurrence.error, status: 400 };
  const value = recurrence.value;

  return db.transaction(() => {
    const seriesResult = db.prepare(`INSERT INTO recurring_series
      (user_id, kind, frequency_unit, frequency_interval, start_date,
       anchor_day, anchor_month, time_zone, end_mode, end_date,
       max_occurrences, status, next_due_date, next_sequence)
      VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)`
    ).run(
      userId, value.frequency_unit, value.frequency_interval, value.start_date,
      value.anchor_day, value.anchor_month, value.time_zone, value.end_mode,
      value.end_date, value.max_occurrences, value.start_date
    );
    const seriesId = Number(seriesResult.lastInsertRowid);
    db.prepare(`INSERT INTO recurring_transfer_templates
      (recurring_series_id, from_account_id, to_account_id, amount, note)
      VALUES (?, ?, ?, ?, ?)`
    ).run(
      seriesId, transfer.value.from_account_id, transfer.value.to_account_id,
      transfer.value.amount, transfer.value.note
    );
    return {
      recurring_series_id: seriesId,
      series: serializeSeries(db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(seriesId)),
    };
  })();
}

function updateTransferFuture(db, series, input) {
  const current = db.prepare(
    'SELECT * FROM recurring_transfer_templates WHERE recurring_series_id = ?'
  ).get(series.id);
  if (!current) return { error: 'recurring transfer template not found', status: 404 };
  const validation = validateTransfer(db, series.user_id, {
    from_account_id: input.from_account_id ?? current.from_account_id,
    to_account_id: input.to_account_id ?? current.to_account_id,
    amount: input.amount ?? current.amount,
    date: series.next_due_date ?? series.start_date,
    note: input.note === undefined ? current.note : input.note,
  });
  if (validation.error) return validation;
  const value = validation.value;
  db.prepare(`UPDATE recurring_transfer_templates SET
    from_account_id = ?, to_account_id = ?, amount = ?, note = ?,
    updated_at = datetime('now') WHERE recurring_series_id = ?`
  ).run(value.from_account_id, value.to_account_id, value.amount, value.note, series.id);
  return { ok: true, recurring_series_id: series.id };
}

module.exports = { createRecurringTransfer, updateTransferFuture };
