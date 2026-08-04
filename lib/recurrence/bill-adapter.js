const { CAPABILITIES, registerRecurrenceAdapter } = require('./registry');

const billAdapter = registerRecurrenceAdapter('bill', {
  capability: CAPABILITIES.PROJECTION_ONLY,
  materializeRange(db, series, occurrences) {
    const bill = db.prepare('SELECT * FROM bills WHERE recurring_series_id = ?').get(series.id);
    if (!bill || !bill.active) return [];
    const insertOccurrence = db.prepare(`
      INSERT OR IGNORE INTO recurring_occurrences
        (series_id, scheduled_date, sequence, series_revision, status)
      VALUES (?, ?, ?, ?, 'generated')
    `);
    const getOccurrence = db.prepare(`
      SELECT * FROM recurring_occurrences WHERE series_id = ? AND scheduled_date = ?
    `);
    const insertBillMonth = db.prepare(`
      INSERT OR IGNORE INTO bill_months
        (bill_id, year, month, due_date, recurring_occurrence_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    const rows = [];
    for (const occurrence of occurrences) {
      insertOccurrence.run(series.id, occurrence.date, occurrence.sequence, series.revision);
      const ledger = getOccurrence.get(series.id, occurrence.date);
      if (!ledger || ['skipped', 'deleted'].includes(ledger.status)) continue;
      const [year, month] = occurrence.date.split('-').map(Number);
      insertBillMonth.run(bill.id, year, month, occurrence.date, ledger.id);
      rows.push(occurrence);
    }
    return rows;
  },

  removeFutureProjections(db, series, afterDate) {
    const projected = db.prepare(`SELECT ro.id
      FROM recurring_occurrences ro
      JOIN bill_months bm ON bm.recurring_occurrence_id = ro.id
      WHERE ro.series_id = ? AND ro.scheduled_date > ? AND bm.paid = 0
        AND ro.status = 'generated'`).all(series.id, afterDate);
    const removeBillMonth = db.prepare('DELETE FROM bill_months WHERE recurring_occurrence_id = ?');
    const removeOccurrence = db.prepare("DELETE FROM recurring_occurrences WHERE id = ? AND status = 'generated'");
    for (const occurrence of projected) {
      removeBillMonth.run(occurrence.id);
      removeOccurrence.run(occurrence.id);
    }
  },

  removeOccurrenceProjection(db, occurrence) {
    const billMonth = db.prepare(
      'SELECT id, paid FROM bill_months WHERE recurring_occurrence_id = ?'
    ).get(occurrence.id);
    if (billMonth?.paid) return { error: 'a paid occurrence cannot be skipped', status: 409 };
    if (billMonth) db.prepare('DELETE FROM bill_months WHERE id = ?').run(billMonth.id);
    return { ok: true };
  },
});

module.exports = billAdapter;
