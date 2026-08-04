const { insertTransfer } = require('../transfers/service');
const { CAPABILITIES, registerRecurrenceAdapter } = require('./registry');

const transferAdapter = registerRecurrenceAdapter('transfer', {
  capability: CAPABILITIES.AUTOMATIC_EXECUTION,
  scheduleOccurrences: true,
  materializeRange() { return []; },

  executeOccurrence(db, occurrence) {
    const template = db.prepare(`SELECT t.*, s.user_id
      FROM recurring_transfer_templates t
      JOIN recurring_series s ON s.id = t.recurring_series_id
      WHERE t.recurring_series_id = ? AND s.kind = 'transfer'`
    ).get(occurrence.series_id);
    if (!template) {
      const error = new Error('Recurring transfer template is unavailable');
      error.code = 'TEMPLATE_MISSING';
      throw error;
    }
    const result = insertTransfer(db, template.user_id, {
      from_account_id: template.from_account_id,
      to_account_id: template.to_account_id,
      amount: template.amount,
      date: occurrence.scheduled_date,
      note: template.note,
      recurring_occurrence_id: occurrence.id,
    });
    if (result.error) {
      const error = new Error(result.error);
      error.code = result.status === 404 ? 'ACCOUNT_UNAVAILABLE' : 'TRANSFER_INVALID';
      throw error;
    }
    return result.id;
  },
});

module.exports = transferAdapter;
