const { currentDateForSeries, isWithinEnd, occurrenceAt, parseDate } = require('./dates');
const { serializeSeries, skipOccurrence } = require('./service');

function resumeAutomaticSeries(db, series, resumeDate, now = new Date()) {
  const date = resumeDate ?? currentDateForSeries(series, now);
  if (series.status !== 'paused') return { error: 'series is not paused', status: 409 };
  if (!parseDate(date)) return { error: 'resume_date must be a valid date', status: 400 };

  return db.transaction(() => {
    db.prepare(`UPDATE recurring_occurrences SET status = 'skipped', skip_reason = 'paused',
      next_retry_at = NULL, failure_code = NULL, updated_at = datetime('now')
      WHERE series_id = ? AND scheduled_date < ? AND status IN ('scheduled','failed')`
    ).run(series.id, date);
    db.prepare(`DELETE FROM recurring_execution_claims WHERE occurrence_id IN
      (SELECT id FROM recurring_occurrences WHERE series_id = ? AND status = 'skipped')`
    ).run(series.id);

    let sequence = Number(series.next_sequence);
    let nextDate = occurrenceAt(series, sequence);
    const insertSkipped = db.prepare(`INSERT OR IGNORE INTO recurring_occurrences
      (series_id, scheduled_date, sequence, series_revision, status, skip_reason)
      VALUES (?, ?, ?, ?, 'skipped', 'paused')`);
    while (nextDate < date && isWithinEnd(series, nextDate, sequence)) {
      insertSkipped.run(series.id, nextDate, sequence, series.revision);
      sequence += 1;
      nextDate = occurrenceAt(series, sequence);
    }
    const hasNext = isWithinEnd(series, nextDate, sequence);
    db.prepare(`UPDATE recurring_series SET status = ?, paused_at = NULL,
      next_sequence = ?, next_due_date = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(hasNext ? 'active' : 'completed', sequence, hasNext ? nextDate : null, series.id);
    return serializeSeries(db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(series.id));
  })();
}

function skipNextAutomaticOccurrence(db, series) {
  if (series.status !== 'active') return { error: 'series is not active', status: 409 };
  if (!series.next_due_date) return { error: 'series has no future occurrence', status: 409 };
  const result = skipOccurrence(db, series, series.next_due_date);
  if (result.error) return result;
  const nextSequence = Number(series.next_sequence) + 1;
  const nextDate = occurrenceAt(series, nextSequence);
  const hasNext = isWithinEnd(series, nextDate, nextSequence);
  db.prepare(`UPDATE recurring_series SET next_sequence = ?, next_due_date = ?, status = ?,
    updated_at = datetime('now') WHERE id = ?`
  ).run(nextSequence, hasNext ? nextDate : null, hasNext ? 'active' : 'completed', series.id);
  return { ok: true, date: series.next_due_date };
}

function stopAutomaticSeries(db, series) {
  if (!['active', 'paused'].includes(series.status)) {
    return { error: 'series cannot be stopped', status: 409 };
  }
  db.transaction(() => {
    db.prepare(`UPDATE recurring_occurrences SET status = 'deleted', next_retry_at = NULL,
      failure_code = NULL, updated_at = datetime('now')
      WHERE series_id = ? AND status IN ('scheduled','failed')`).run(series.id);
    db.prepare(`DELETE FROM recurring_execution_claims WHERE occurrence_id IN
      (SELECT id FROM recurring_occurrences WHERE series_id = ?)`
    ).run(series.id);
    db.prepare(`UPDATE recurring_series SET status = 'deleted', deleted_at = datetime('now'),
      next_due_date = NULL, updated_at = datetime('now') WHERE id = ?`).run(series.id);
  })();
  return { ok: true, recurring_series_id: series.id };
}

module.exports = {
  resumeAutomaticSeries,
  skipNextAutomaticOccurrence,
  stopAutomaticSeries,
};
