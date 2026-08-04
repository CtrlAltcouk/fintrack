const { CAPABILITIES, registerRecurrenceAdapter } = require('./registry');

const incomeAdapter = registerRecurrenceAdapter('income', {
  capability: CAPABILITIES.PROJECTION_ONLY,
  materializeRange(db, series, occurrences) {
    const schedule = db.prepare(
      'SELECT * FROM income_schedules WHERE recurring_series_id = ?'
    ).get(series.id);
    if (!schedule || !schedule.active) return [];
    const insertOccurrence = db.prepare(`INSERT OR IGNORE INTO recurring_occurrences
      (series_id, scheduled_date, sequence, series_revision, status)
      VALUES (?, ?, ?, ?, 'generated')`);
    const getOccurrence = db.prepare(
      'SELECT * FROM recurring_occurrences WHERE series_id = ? AND scheduled_date = ?'
    );
    const insertIncome = db.prepare(`INSERT OR IGNORE INTO income
      (user_id, amount, description, date, source_schedule_id, account_id, recurring_occurrence_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const rows = [];
    for (const occurrence of occurrences) {
      insertOccurrence.run(series.id, occurrence.date, occurrence.sequence, series.revision);
      const ledger = getOccurrence.get(series.id, occurrence.date);
      if (!ledger || ['skipped', 'deleted'].includes(ledger.status)) continue;
      insertIncome.run(
        schedule.user_id, schedule.amount, schedule.name, occurrence.date,
        schedule.id, schedule.account_id ?? null, ledger.id
      );
      rows.push(occurrence);
    }
    return rows;
  },

  removeFutureProjections(db, series, afterDate) {
    const projected = db.prepare(`SELECT ro.id
      FROM recurring_occurrences ro
      JOIN income i ON i.recurring_occurrence_id = ro.id
      WHERE ro.series_id = ? AND ro.scheduled_date > ? AND ro.status = 'generated'`
    ).all(series.id, afterDate);
    const removeIncome = db.prepare('DELETE FROM income WHERE recurring_occurrence_id = ?');
    const removeOccurrence = db.prepare("DELETE FROM recurring_occurrences WHERE id = ? AND status = 'generated'");
    for (const occurrence of projected) {
      removeIncome.run(occurrence.id);
      removeOccurrence.run(occurrence.id);
    }
  },

  removeOccurrenceProjection(db, occurrence) {
    db.prepare('DELETE FROM income WHERE recurring_occurrence_id = ?').run(occurrence.id);
    return { ok: true };
  },
});

module.exports = incomeAdapter;
