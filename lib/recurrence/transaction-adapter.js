const { insertTransaction } = require('../transactions/service');
const { CAPABILITIES, registerRecurrenceAdapter } = require('./registry');

const transactionAdapter = registerRecurrenceAdapter('transaction', {
  capability: CAPABILITIES.AUTOMATIC_EXECUTION,
  scheduleOccurrences: true,
  materializeRange() {
    return [];
  },

  executeOccurrence(db, occurrence) {
    const template = db.prepare(`SELECT t.*, s.user_id
      FROM recurring_transaction_templates t
      JOIN recurring_series s ON s.id = t.recurring_series_id
      WHERE t.recurring_series_id = ? AND s.kind = 'transaction'`
    ).get(occurrence.series_id);
    if (!template) {
      const error = new Error('Recurring transaction template is unavailable');
      error.code = 'TEMPLATE_MISSING';
      throw error;
    }
    return insertTransaction(db, {
      user_id: template.user_id,
      amount: template.amount,
      description: template.description,
      category_id: template.category_id,
      date: occurrence.scheduled_date,
      account_id: template.account_id,
      recurring_occurrence_id: occurrence.id,
    });
  },
});

module.exports = transactionAdapter;
