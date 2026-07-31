const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireOwned } = require('../lib/ownership');

// GET /api/transfers
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT t.id, t.from_account_id, t.to_account_id, t.amount, t.date, t.note, t.created_at,
           fa.name as from_account_name, fa.colour as from_account_colour,
           ta.name as to_account_name,   ta.colour as to_account_colour
    FROM transfers t
    JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = ?
    JOIN accounts ta ON ta.id = t.to_account_id   AND ta.user_id = ?
    WHERE t.user_id = ?
    ORDER BY t.date DESC, t.id DESC
  `).all(req.userId, req.userId, req.userId));
});

// POST /api/transfers
router.post('/', (req, res) => {
  const { from_account_id, to_account_id, amount, date, note } = req.body;
  const amt = parseFloat(amount);
  if (amount == null || isNaN(amt) || amt <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' });
  if (!date || !String(date).trim())
    return res.status(400).json({ error: 'date required' });
  if (!from_account_id || !to_account_id)
    return res.status(400).json({ error: 'from_account_id and to_account_id required' });
  if (Number(from_account_id) === Number(to_account_id))
    return res.status(400).json({ error: 'from and to accounts must be different' });

  if (!requireOwned(db, res, 'account', from_account_id, req.userId, { active: true })) return;
  if (!requireOwned(db, res, 'account', to_account_id, req.userId, { active: true })) return;

  try {
    const result = db.prepare(
      'INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, date, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, Number(from_account_id), Number(to_account_id), amt, String(date).trim(), note ?? null);
    res.status(201).json(db.prepare('SELECT * FROM transfers WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'invalid account' });
    throw err;
  }
});

// DELETE /api/transfers/:id
router.delete('/:id', (req, res) => {
  // Verify the transfer belongs to this user via accounts join
  const t = db.prepare(`
    SELECT t.id FROM transfers t
    JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = ?
    JOIN accounts ta ON ta.id = t.to_account_id AND ta.user_id = ?
    WHERE t.id = ? AND t.user_id = ?
  `).get(req.userId, req.userId, req.params.id, req.userId);
  if (!t) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM transfers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
