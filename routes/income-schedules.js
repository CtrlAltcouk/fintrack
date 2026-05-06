const express = require('express');
const router = express.Router();
const db = require('../db');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function ensureIncomeEntries(year, month) {
  const y = Number(year), m = Number(month);
  const monthPad = String(m).padStart(2, '0');
  const dim = daysInMonth(y, m);
  const monthStart = `${y}-${monthPad}-01`;
  const monthEnd   = `${y}-${monthPad}-${String(dim).padStart(2, '0')}`;

  const schedules = db.prepare('SELECT * FROM income_schedules WHERE active = 1').all();

  for (const sched of schedules) {
    if (sched.frequency === 'monthly') {
      const day = Math.min(sched.day_of_month, dim);
      const ym = `${y}-${monthPad}`;
      const exists = db.prepare(
        `SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND strftime('%Y-%m', date) = ?`
      ).get(sched.id, ym);
      if (exists.c === 0) {
        const dateStr = `${y}-${monthPad}-${String(day).padStart(2, '0')}`;
        db.prepare(
          'INSERT INTO income (amount, description, date, source_schedule_id) VALUES (?, ?, ?, ?)'
        ).run(sched.amount, sched.name, dateStr, sched.id);
      }
    } else if (sched.frequency === 'weekly') {
      const anchorDow = new Date(sched.anchor_date + 'T00:00:00Z').getUTCDay();
      for (let d = 1; d <= dim; d++) {
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (dow !== anchorDow) continue;
        const dateStr = `${y}-${monthPad}-${String(d).padStart(2, '0')}`;
        const exists = db.prepare(
          'SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?'
        ).get(sched.id, dateStr);
        if (exists.c === 0) {
          db.prepare(
            'INSERT INTO income (amount, description, date, source_schedule_id) VALUES (?, ?, ?, ?)'
          ).run(sched.amount, sched.name, dateStr, sched.id);
        }
      }
    } else if (sched.frequency === 'four_weekly') {
      let cur = sched.anchor_date;
      // Walk forward until cur >= monthStart
      while (cur < monthStart) cur = addDays(cur, 28);
      // Walk backward if cur is past monthEnd (anchor in future month)
      while (cur > monthEnd) cur = addDays(cur, -28);
      // Iterate through all occurrences in the month
      while (cur <= monthEnd) {
        if (cur >= monthStart) {
          const exists = db.prepare(
            'SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?'
          ).get(sched.id, cur);
          if (exists.c === 0) {
            db.prepare(
              'INSERT INTO income (amount, description, date, source_schedule_id) VALUES (?, ?, ?, ?)'
            ).run(sched.amount, sched.name, cur, sched.id);
          }
        }
        cur = addDays(cur, 28);
      }
    }
  }
}

// GET /api/income/schedules
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM income_schedules ORDER BY created_at DESC').all();
  res.json(rows);
});

// POST /api/income/schedules
router.post('/', (req, res) => {
  const { name, amount, frequency, day_of_month, anchor_date } = req.body;
  if (!name || amount == null || !frequency)
    return res.status(400).json({ error: 'name, amount, frequency required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  if (!['weekly', 'four_weekly', 'monthly'].includes(frequency))
    return res.status(400).json({ error: 'frequency must be weekly, four_weekly, or monthly' });
  if (frequency === 'monthly') {
    const day = Number(day_of_month);
    if (!day || day < 1 || day > 31)
      return res.status(400).json({ error: 'day_of_month required (1–31) for monthly frequency' });
  } else {
    if (!anchor_date)
      return res.status(400).json({ error: 'anchor_date required for weekly/four_weekly frequency' });
  }
  const result = db.prepare(
    'INSERT INTO income_schedules (name, amount, frequency, day_of_month, anchor_date) VALUES (?, ?, ?, ?, ?)'
  ).run(name, parsed, frequency, day_of_month ?? null, anchor_date ?? null);
  res.status(201).json({
    id: result.lastInsertRowid, name, amount: parsed,
    frequency, day_of_month: day_of_month ?? null, anchor_date: anchor_date ?? null, active: 1,
  });
});

// PATCH /api/income/schedules/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const sched = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'not found' });
  if (!sched.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE income_schedules SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ id: Number(req.params.id), active: false });
});

module.exports = { router, ensureIncomeEntries };
