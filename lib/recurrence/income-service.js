const { materializeSeriesRange } = require('./engine');
const {
  currentDateForSeries, frequencyName, parseDate, validateRecurrence,
} = require('./dates');
require('./income-adapter');

function monthlyStart(day, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}

function recurrenceInputForSchedule(input, existingSeries = null) {
  const frequency = input.recurrence?.frequency ?? input.frequency;
  const startDate = input.recurrence?.start_date
    ?? input.anchor_date
    ?? (frequency === 'monthly'
      ? monthlyStart(Number(input.day_of_month ?? existingSeries?.anchor_day))
      : existingSeries?.start_date);
  const day = Number(input.day_of_month
    ?? input.recurrence?.anchor_day
    ?? (parseDate(startDate)?.day)
    ?? existingSeries?.anchor_day);
  return {
    frequency,
    start_date: startDate,
    anchor_day: day || undefined,
    end_mode: input.recurrence?.end_mode ?? input.end_mode ?? existingSeries?.end_mode ?? 'never',
    end_date: input.recurrence?.end_date ?? input.end_date ?? existingSeries?.end_date ?? undefined,
    max_occurrences: input.recurrence?.max_occurrences
      ?? input.max_occurrences ?? existingSeries?.max_occurrences ?? undefined,
    time_zone: input.recurrence?.time_zone ?? existingSeries?.time_zone ?? 'UTC',
  };
}

function validateIncomeRecurrence(input, existingSeries = null) {
  const source = recurrenceInputForSchedule(input, existingSeries);
  if (!source.frequency) return { error: 'frequency required' };
  if (!source.start_date) {
    return { error: source.frequency === 'monthly'
      ? 'day_of_month required (1–31) for monthly frequency'
      : 'anchor_date required for this frequency' };
  }
  return validateRecurrence(source, {
    dueDay: source.anchor_day,
    defaultStartDate: source.start_date,
  });
}

function insertSeries(db, userId, value, status = 'active') {
  const result = db.prepare(`INSERT INTO recurring_series
    (user_id, kind, frequency_unit, frequency_interval, start_date,
     anchor_day, anchor_month, time_zone, end_mode, end_date,
     max_occurrences, status, next_due_date, next_sequence)
    VALUES (?, 'income', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    userId, value.frequency_unit, value.frequency_interval, value.start_date,
    value.anchor_day, value.anchor_month, value.time_zone, value.end_mode,
    value.end_date, value.max_occurrences, status,
    status === 'active' ? value.start_date : null
  );
  return Number(result.lastInsertRowid);
}

function serializeIncomeSchedule(row) {
  return {
    ...row,
    recurrence_status: row.recurrence_status ?? row.series_status ?? (row.active ? 'active' : 'deleted'),
    recurrence_frequency: row.frequency_unit
      ? frequencyName(row.frequency_unit, row.frequency_interval)
      : row.frequency,
  };
}

function createIncomeScheduleWithSeries(db, userId, input) {
  const recurrence = validateIncomeRecurrence(input);
  if (recurrence.error) return recurrence;
  const value = recurrence.value;
  return db.transaction(() => {
    const seriesId = insertSeries(db, userId, value);
    const result = db.prepare(`INSERT INTO income_schedules
      (user_id, name, amount, frequency, day_of_month, anchor_date,
       account_id, recurring_series_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId, input.name, input.amount, value.frequency,
      value.frequency === 'monthly' ? value.anchor_day : null,
      value.frequency === 'monthly' ? null : value.start_date,
      input.account_id ?? null, seriesId
    );
    return { scheduleId: Number(result.lastInsertRowid), seriesId, recurrence: value };
  })();
}

function removeProjectedIncomeFrom(db, seriesId, fromDate) {
  const occurrences = db.prepare(`SELECT ro.id FROM recurring_occurrences ro
    JOIN income i ON i.recurring_occurrence_id = ro.id
    WHERE ro.series_id = ? AND ro.scheduled_date >= ? AND ro.status = 'generated'`
  ).all(seriesId, fromDate);
  const removeIncome = db.prepare('DELETE FROM income WHERE recurring_occurrence_id = ?');
  const removeOccurrence = db.prepare("DELETE FROM recurring_occurrences WHERE id = ? AND status = 'generated'");
  for (const occurrence of occurrences) {
    removeIncome.run(occurrence.id);
    removeOccurrence.run(occurrence.id);
  }
}

function editIncomeSchedule(db, schedule, series, input) {
  const recurrence = validateIncomeRecurrence(input, series);
  if (recurrence.error) return recurrence;
  const value = recurrence.value;
  return db.transaction(() => {
    removeProjectedIncomeFrom(db, series.id, currentDateForSeries(series));
    db.prepare(`UPDATE recurring_series
      SET status = 'deleted', deleted_at = datetime('now'), next_due_date = NULL,
          updated_at = datetime('now') WHERE id = ?`).run(series.id);
    const nextStatus = series.status === 'paused' ? 'paused' : 'active';
    const seriesId = insertSeries(db, schedule.user_id, value, nextStatus);
    if (nextStatus === 'paused') {
      db.prepare("UPDATE recurring_series SET paused_at = datetime('now') WHERE id = ?").run(seriesId);
    }
    db.prepare(`UPDATE income_schedules
      SET name = ?, amount = ?, frequency = ?, day_of_month = ?, anchor_date = ?,
          account_id = ?, recurring_series_id = ?
      WHERE id = ? AND user_id = ?`
    ).run(
      input.name, input.amount, value.frequency,
      value.frequency === 'monthly' ? value.anchor_day : null,
      value.frequency === 'monthly' ? null : value.start_date,
      input.account_id ?? null, seriesId, schedule.id, schedule.user_id
    );
    return { scheduleId: schedule.id, seriesId, recurrence: value, status: nextStatus };
  })();
}

function deactivateIncomeSchedule(db, schedule) {
  return db.transaction(() => {
    const series = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(schedule.recurring_series_id);
    if (!series || series.kind !== 'income' || series.user_id !== schedule.user_id) {
      return { error: 'recurring income relationship is invalid' };
    }
    const cutoff = currentDateForSeries(series);
    const projected = db.prepare(`SELECT COUNT(*) AS count
      FROM recurring_occurrences ro JOIN income i ON i.recurring_occurrence_id = ro.id
      WHERE ro.series_id = ? AND ro.scheduled_date > ? AND ro.status = 'generated'`
    ).get(series.id, cutoff).count;
    require('./income-adapter').removeFutureProjections(db, series, cutoff);
    db.prepare('UPDATE income_schedules SET active = 0 WHERE id = ?').run(schedule.id);
    db.prepare(`UPDATE recurring_series
      SET status = 'deleted', deleted_at = datetime('now'), next_due_date = NULL,
          updated_at = datetime('now') WHERE id = ?`).run(schedule.recurring_series_id);
    return { id: schedule.id, active: false, removed_future: projected };
  }).immediate();
}

function materializeIncomeMonth(db, userId, year, month) {
  const y = Number(year);
  const m = Number(month);
  const now = new Date();
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return;
  if (y < now.getUTCFullYear() || (y === now.getUTCFullYear() && m < now.getUTCMonth() + 1)) return;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = `${y}-${String(m).padStart(2, '0')}`;
  const seriesRows = db.prepare(`SELECT s.* FROM recurring_series s
    JOIN income_schedules i ON i.recurring_series_id = s.id
    WHERE s.user_id = ? AND s.kind = 'income' AND s.status = 'active' AND i.active = 1`
  ).all(userId);
  for (const series of seriesRows) {
    materializeSeriesRange(db, series, `${prefix}-01`, `${prefix}-${String(dim).padStart(2, '0')}`);
  }
}

module.exports = {
  createIncomeScheduleWithSeries,
  deactivateIncomeSchedule,
  editIncomeSchedule,
  materializeIncomeMonth,
  monthlyStart,
  recurrenceInputForSchedule,
  removeProjectedIncomeFrom,
  serializeIncomeSchedule,
  validateIncomeRecurrence,
};
