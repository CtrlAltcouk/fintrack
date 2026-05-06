const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureBillMonths } = require('./bills');
const { ensureIncomeEntries } = require('./income-schedules');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// GET /api/calendar/:year/:month
router.get('/:year/:month', (req, res) => {
  const year  = Number(req.params.year);
  const month = Number(req.params.month);
  const monthPad = String(month).padStart(2, '0');
  const dim = daysInMonth(year, month);

  ensureBillMonths(year, month);
  ensureIncomeEntries(year, month);

  const billRows = db.prepare(`
    SELECT b.name, b.amount, b.due_day, c.colour, bm.paid
    FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id
    JOIN categories c ON c.id = b.category_id
    WHERE bm.year = ? AND bm.month = ? AND b.active = 1
    ORDER BY b.due_day ASC
  `).all(year, month);

  const incomeRows = db.prepare(`
    SELECT amount, description, date, source_schedule_id
    FROM income
    WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
    ORDER BY date ASC
  `).all(String(year), monthPad);

  const events = [];

  for (const b of billRows) {
    const day = Math.min(b.due_day, dim);
    const dateStr = `${year}-${monthPad}-${String(day).padStart(2, '0')}`;
    events.push({ date: dateStr, type: 'bill', name: b.name, amount: b.amount, colour: b.colour, paid: b.paid });
  }

  for (const inc of incomeRows) {
    const type = inc.source_schedule_id != null ? 'income' : 'income_oneoff';
    events.push({ date: inc.date, type, name: inc.description, amount: inc.amount });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  res.json({ events });
});

module.exports = router;
