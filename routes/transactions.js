const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/transactions
router.get('/', (req, res) => {
  const { year, month, from, to, category_id, account_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour,
             a.name as account_name, a.colour as account_colour
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts   a ON t.account_id  = a.id
             WHERE t.user_id = ?`;
  const params = [req.userId];
  if (from && to) {
    sql += ` AND t.date >= ? AND t.date <= ?`;
    params.push(from, to);
  } else if (year && month) {
    sql += ` AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (category_id) { sql += ` AND t.category_id = ?`; params.push(category_id); }
  if (account_id)  { sql += ` AND t.account_id  = ?`; params.push(account_id); }
  sql += ` ORDER BY t.date DESC, t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

// POST /api/transactions
router.post('/', (req, res) => {
  const { amount, description, category_id, date, account_id } = req.body;
  if (amount == null || !description || !category_id || !date)
    return res.status(400).json({ error: 'amount, description, category_id, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  try {
    const result = db.prepare(
      'INSERT INTO transactions (user_id, amount, description, category_id, date, account_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, parsed, description, category_id, date, account_id ?? null);
    res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, category_id, date, account_id: account_id ?? null });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'category_id does not exist' });
    throw err;
  }
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { amount, description, category_id, date } = req.body;
  const parsedAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
  if (isNaN(parsedAmount)) return res.status(400).json({ error: 'amount must be a number' });
  db.prepare('UPDATE transactions SET amount=?, description=?, category_id=?, date=? WHERE id=? AND user_id=?')
    .run(parsedAmount, description ?? existing.description,
         category_id ?? existing.category_id, date ?? existing.date,
         req.params.id, req.userId);
  res.json({ id: Number(req.params.id), amount: parsedAmount,
             description: description ?? existing.description,
             category_id: category_id ?? existing.category_id,
             date: date ?? existing.date });
});

// DELETE /api/transactions/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
