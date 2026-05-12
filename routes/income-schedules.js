const express = require('express');
const router  = express.Router();
const db      = require('../db');

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function ensureIncomeEntries(year, month, userId) {
  const y = Number(year), m = Number(month);
  const now = new Date();
  if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) return;

  const monthPad  = String(m).padStart(2, '0');
  const dim       = daysInMonth(y, m);
  const monthStart = `${y}-${monthPad}-01`;
  const monthEnd   = `${y}-${monthPad}-${String(dim).padStart(2, '0')}`;

  const schedules = db.prepare('SELECT * FROM income_schedules WHERE active = 1 AND user_id = ?').all(userId);

  for (const sched of schedules) {
    if (sched.frequency === 'monthly') {
      const day = Math.min(sched.day_of_month, dim);
      const ym  = `${y}-${monthPad}`;
      if (db.prepare(`SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND strftime('%Y-%m', date) = ?`).get(sched.id, ym).c === 0) {
        db.prepare('INSERT INTO income (user_id, amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(userId, sched.amount, sched.name, `${y}-${monthPad}-${String(day).padStart(2, '0')}`, sched.id, sched.account_id ?? null);
      }
    } else if (sched.frequency === 'weekly') {
      const anchorDow = new Date(sched.anchor_date + 'T00:00:00Z').getUTCDay();
      for (let d = 1; d <= dim; d++) {
        if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== anchorDow) continue;
        const dateStr = `${y}-${monthPad}-${String(d).padStart(2, '0')}`;
        if (db.prepare('SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?').get(sched.id, dateStr).c === 0) {
          db.prepare('INSERT INTO income (user_id, amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, sched.amount, sched.name, dateStr, sched.id, sched.account_id ?? null);
        }
      }
    } else if (sched.frequency === 'four_weekly') {
      let cur = sched.anchor_date;
      while (cur < monthStart) cur = addDays(cur, 28);
      while (cur > monthEnd)   cur = addDays(cur, -28);
      while (cur <= monthEnd) {
        if (cur >= monthStart) {
          if (db.prepare('SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?').get(sched.id, cur).c === 0) {
            db.prepare('INSERT INTO income (user_id, amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?, ?)')
              .run(userId, sched.amount, sched.name, cur, sched.id, sched.account_id ?? null);
          }
        }
        cur = addDays(cur, 28);
      }
    }
  }
}

// GET /api/income/schedules
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM income_schedules WHERE user_id = ? ORDER BY created_at DESC').all(req.userId));
});

// POST /api/income/schedules
router.post('/', (req, res) => {
  const { name, amount, frequency, day_of_month, anchor_date, account_id } = req.body;
  if (!name || amount == null || !frequency)
    return res.status(400).json({ error: 'name, amount, frequency required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  if (!['weekly','four_weekly','monthly'].includes(frequency))
    return res.status(400).json({ error: 'frequency must be weekly, four_weekly, or monthly' });
  if (frequency === 'monthly') {
    const day = Number(day_of_month);
    if (!day || day < 1 || day > 31) return res.status(400).json({ error: 'day_of_month required (1–31) for monthly frequency' });
  } else {
    if (!anchor_date) return res.status(400).json({ error: 'anchor_date required for weekly/four_weekly frequency' });
  }
  const result = db.prepare(
    'INSERT INTO income_schedules (user_id, name, amount, frequency, day_of_month, anchor_date, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, name, parsed, frequency, day_of_month ?? null, anchor_date ?? null, account_id ?? null);
  res.status(201).json({ id: result.lastInsertRowid, name, amount: parsed, frequency, day_of_month: day_of_month ?? null, anchor_date: anchor_date ?? null, account_id: account_id ?? null, active: 1 });
});

// PATCH /api/income/schedules/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const sched = db.prepare('SELECT * FROM income_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!sched) return res.status(404).json({ error: 'not found' });
  if (!sched.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE income_schedules SET active = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ id: Number(req.params.id), active: false });
});

module.exports = { router, ensureIncomeEntries };
