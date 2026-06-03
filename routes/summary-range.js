const express = require('express');
const router  = express.Router();
const db      = require('../db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _parseDateRange(from, to) {
  if (!from || !to)                              return 'from and to are required (YYYY-MM-DD)';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return 'from and to are required (YYYY-MM-DD)';
  if (from > to)                                 return 'from must be before or equal to to';
  return null;
}

router.get('/by-range', (req, res) => {
  const err = _parseDateRange(req.query.from, req.query.to);
  if (err) return res.status(400).json({ error: err });

  const { from, to } = req.query;
  const uid = req.userId;

  const incomeRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE user_id = ? AND date >= ? AND date <= ?`
  ).get(uid, from, to);

  const spentRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?`
  ).get(uid, from, to);

  const byCategory = db.prepare(
    `SELECT c.name, c.colour, COALESCE(SUM(t.amount), 0) as total
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = ?
       AND t.date >= ? AND t.date <= ?
     WHERE c.user_id = ?
     GROUP BY c.id ORDER BY total DESC`
  ).all(uid, from, to, uid);

  res.json({
    income:     incomeRow.total,
    spent:      spentRow.total,
    remaining:  incomeRow.total - spentRow.total,
    byCategory,
  });
});

module.exports = router;
module.exports._parseDateRange = _parseDateRange;
