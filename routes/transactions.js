const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/transactions?year=2026&month=5&category_id=1
router.get('/', (req, res) => {
  const { year, month, category_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour
             FROM transactions t JOIN categories c ON t.category_id = c.id WHERE 1=1`;
  const params = [];
  if (year && month) {
    sql += ` AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (category_id) { sql += ` AND t.category_id = ?`; params.push(category_id); }
  sql += ` ORDER BY t.date DESC, t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

// POST /api/transactions
router.post('/', (req, res) => {
  const { amount, description, category_id, date } = req.body;
  if (!amount || !description || !category_id || !date)
    return res.status(400).json({ error: 'amount, description, category_id, date required' });
  const result = db.prepare(
    'INSERT INTO transactions (amount, description, category_id, date) VALUES (?, ?, ?, ?)'
  ).run(amount, description, category_id, date);
  res.status(201).json({ id: result.lastInsertRowid, amount, description, category_id, date });
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { amount, description, category_id, date } = req.body;
  db.prepare('UPDATE transactions SET amount=?, description=?, category_id=?, date=? WHERE id=?')
    .run(amount ?? existing.amount, description ?? existing.description,
         category_id ?? existing.category_id, date ?? existing.date, req.params.id);
  res.json({ id: Number(req.params.id), ...existing, ...req.body });
});

// DELETE /api/transactions/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
