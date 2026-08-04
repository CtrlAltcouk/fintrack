const express = require('express');
const router = express.Router();
const db = require('../db');
const { findOwned } = require('../lib/ownership');
const {
  createIncomeScheduleWithSeries, deactivateIncomeSchedule, editIncomeSchedule,
  materializeIncomeMonth, serializeIncomeSchedule,
} = require('../lib/recurrence/income-service');
const {
  parseIntegerId, parseOptionalIntegerId, parsePositiveMoney, validationMessage,
} = require('../lib/finance-validation');

function ensureIncomeEntries(year, month, userId) {
  materializeIncomeMonth(db, userId, year, month);
}

function scheduleRows(userId) {
  return db.prepare(`SELECT i.*, s.status AS recurrence_status,
      s.frequency_unit, s.frequency_interval, s.start_date, s.end_mode,
      s.end_date, s.max_occurrences, s.paused_at
    FROM income_schedules i
    JOIN recurring_series s ON s.id = i.recurring_series_id
    WHERE i.user_id = ? ORDER BY i.created_at DESC, i.id DESC`
  ).all(userId).map(serializeIncomeSchedule);
}

function validateScheduleRequest(req, res) {
  const { name, amount, frequency, account_id } = req.body;
  if (!name || amount == null || !frequency) {
    res.status(400).json({ error: 'name, amount, frequency required' });
    return null;
  }
  let parsed, accountId;
  try {
    parsed = parsePositiveMoney(amount);
    accountId = parseOptionalIntegerId(account_id, 'account_id');
  } catch (error) {
    res.status(400).json({ error: validationMessage(error) });
    return null;
  }
  return { ...req.body, name, amount: parsed, account_id: accountId };
}

router.get('/', (req, res) => {
  res.json(scheduleRows(req.userId));
});

router.post('/', (req, res) => {
  const input = validateScheduleRequest(req, res);
  if (!input) return;
  const result = db.transaction(() => {
    if (input.account_id != null
        && !findOwned(db, 'account', input.account_id, req.userId, { active: true })) {
      return { accountNotFound: true };
    }
    return createIncomeScheduleWithSeries(db, req.userId, input);
  }).immediate();
  if (result.accountNotFound) return res.status(404).json({ error: 'account not found' });
  if (result.error) return res.status(400).json({ error: result.error });
  const created = scheduleRows(req.userId).find(row => row.id === result.scheduleId);
  res.status(201).json(created);
});

// Existing edit endpoint remains a going-forward replacement. Historical
// income stays linked to the old immutable series revision.
router.patch('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'income schedule id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const schedule = db.prepare(
    'SELECT * FROM income_schedules WHERE id = ? AND user_id = ?'
  ).get(id, req.userId);
  if (!schedule) return res.status(404).json({ error: 'not found' });
  const series = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(schedule.recurring_series_id);
  const input = validateScheduleRequest(req, res);
  if (!input) return;
  const result = db.transaction(() => {
    if (input.account_id != null
        && !findOwned(db, 'account', input.account_id, req.userId, { active: true })) {
      return { accountNotFound: true };
    }
    return editIncomeSchedule(db, schedule, series, input);
  }).immediate();
  if (result.accountNotFound) return res.status(404).json({ error: 'account not found' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(scheduleRows(req.userId).find(row => row.id === schedule.id));
});

router.patch('/:id/deactivate', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'income schedule id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const schedule = db.prepare(
    'SELECT * FROM income_schedules WHERE id = ? AND user_id = ?'
  ).get(id, req.userId);
  if (!schedule) return res.status(404).json({ error: 'not found' });
  if (!schedule.active) return res.status(409).json({ error: 'already inactive' });
  deactivateIncomeSchedule(db, schedule);
  res.json({ id, active: false });
});

module.exports = { router, ensureIncomeEntries, scheduleRows };
