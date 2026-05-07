const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');

// GET /api/income?year=2026&month=5
router.get('/', (req, res) => {
  const { year, month, account_id } = req.query;
  if (year && month) ensureIncomeEntries(year, month);
  let sql = 'SELECT * FROM income WHERE 1=1';
  const params = [];
  if (year && month) {
    sql += ` AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (account_id) { sql += ` AND account_id = ?`; params.push(account_id); }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/income
router.post('/', (req, res) => {
  const { amount, description, date, account_id } = req.body;
  if (amount == null || !description || !date)
    return res.status(400).json({ error: 'amount, description, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  const result = db.prepare(
    'INSERT INTO income (amount, description, date, account_id) VALUES (?, ?, ?, ?)'
  ).run(parsed, description, date, account_id ?? null);
  res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, date, account_id: account_id ?? null });
});

// DELETE /api/income/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM income WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
