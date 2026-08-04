const { currentDateForSeries, occurrenceAt, occurrencesBetween } = require('./dates');
const { getRecurrenceAdapter } = require('./registry');

function materializeSeriesRange(db, series, from, to) {
  if (series.status !== 'active') return [];
  const adapter = getRecurrenceAdapter(series.kind);
  return db.transaction(() => {
    const result = adapter.materializeRange(db, series, occurrencesBetween(series, from, to));
    const finalDate = series.end_mode === 'count'
      ? occurrenceAt(series, series.max_occurrences)
      : series.end_mode === 'date' ? series.end_date : null;
    const today = currentDateForSeries(series);
    if (finalDate && today > finalDate) {
      db.prepare(`UPDATE recurring_series
        SET status = 'completed', next_due_date = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'active'`).run(series.id);
    }
    return result;
  })();
}

module.exports = { materializeSeriesRange };
