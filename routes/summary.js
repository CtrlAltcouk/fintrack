const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');

router.get('/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthPad = String(month).padStart(2, '0');
  const uid = req.userId;

  ensureIncomeEntries(year, month, uid);

  const incomeRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM income
     WHERE user_id = ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ? AND date <= date('now')`
  ).get(uid, year, monthPad);

  const spentRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
  ).get(uid, year, monthPad);

  const byCategory = db.prepare(
    `SELECT c.name, c.colour, COALESCE(SUM(t.amount), 0) as total
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = ?
       AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?
     WHERE c.user_id = ?
     GROUP BY c.id ORDER BY total DESC`
  ).all(uid, year, monthPad, uid);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Number(year), Number(month) - 1 - i, 1);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const inc = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as t FROM income WHERE user_id=? AND strftime('%Y',date)=? AND strftime('%m',date)=? AND date<=date('now')`
    ).get(uid, y, m).t;
    const spent = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=? AND strftime('%Y',date)=? AND strftime('%m',date)=?`
    ).get(uid, y, m).t;
    months.push({ year: y, month: m, income: inc, spent });
  }

  res.json({
    income: incomeRow.total,
    spent: spentRow.total,
    remaining: incomeRow.total - spentRow.total,
    byCategory,
    monthlyTrend: months,
  });
});

module.exports = router;
