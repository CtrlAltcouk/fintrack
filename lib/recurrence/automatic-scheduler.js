const { addDays, dateInTimeZone, isWithinEnd, occurrenceAt } = require('./dates');

function scheduleAutomaticOccurrences(db, kinds, now, limit) {
  if (!kinds.length || limit < 1) return 0;
  const placeholders = kinds.map(() => '?').join(',');
  const upperDate = addDays(now.toISOString().slice(0, 10), 1);
  const candidates = db.prepare(`SELECT * FROM recurring_series
    WHERE kind IN (${placeholders}) AND status = 'active'
      AND next_due_date IS NOT NULL AND next_due_date <= ?
    ORDER BY next_due_date ASC, id ASC`).all(...kinds, upperDate);
  let scheduled = 0;

  return db.transaction(() => {
    while (scheduled < limit) {
      let selected = null;
      for (const candidate of candidates) {
        if (candidate.status !== 'active' || candidate.next_due_date == null) continue;
        const localToday = dateInTimeZone(now, candidate.time_zone);
        if (candidate.next_due_date <= localToday
            && (!selected || candidate.next_due_date < selected.next_due_date
              || (candidate.next_due_date === selected.next_due_date && candidate.id < selected.id))) {
          selected = candidate;
        }
      }
      if (!selected) break;

      const sequence = Number(selected.next_sequence);
      const scheduledDate = occurrenceAt(selected, sequence);
      if (!isWithinEnd(selected, scheduledDate, sequence)) {
        db.prepare(`UPDATE recurring_series SET status = 'completed', next_due_date = NULL,
          updated_at = datetime('now') WHERE id = ?`).run(selected.id);
        selected.status = 'completed';
        selected.next_due_date = null;
        continue;
      }

      db.prepare(`INSERT OR IGNORE INTO recurring_occurrences
        (series_id, scheduled_date, sequence, series_revision, status)
        VALUES (?, ?, ?, ?, 'scheduled')`
      ).run(selected.id, scheduledDate, sequence, selected.revision);

      const nextSequence = sequence + 1;
      const nextDate = occurrenceAt(selected, nextSequence);
      const hasNext = isWithinEnd(selected, nextDate, nextSequence);
      db.prepare(`UPDATE recurring_series SET next_sequence = ?, next_due_date = ?,
        updated_at = datetime('now') WHERE id = ?`
      ).run(nextSequence, hasNext ? nextDate : null, selected.id);
      selected.next_sequence = nextSequence;
      selected.next_due_date = hasNext ? nextDate : null;
      scheduled += 1;
    }
    return scheduled;
  })();
}

module.exports = { scheduleAutomaticOccurrences };
