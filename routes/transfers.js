const express = require('express');
const router = express.Router();
const db = require('../db');

const stmtList = db.prepare(`
  SELECT t.id, t.from_account_id, t.to_account_id, t.amount, t.date, t.note, t.created_at,
         fa.name as from_account_name, fa.colour as from_account_colour,
         ta.name as to_account_name,   ta.colour as to_account_colour
  FROM transfers t
  JOIN accounts fa ON fa.id = t.from_account_id
  JOIN accounts ta ON ta.id = t.to_account_id
  ORDER BY t.date DESC, t.id DESC
`);

// GET /api/transfers
router.get('/', (_req, res) => {
  res.json(stmtList.all());
});

// POST /api/transfers
router.post('/', (req, res) => {
  const { from_account_id, to_account_id, amount, date, note } = req.body;

  const amt = parseFloat(amount);
  if (!amount || isNaN(amt) || amt <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' });
  if (!date || !String(date).trim())
    return res.status(400).json({ error: 'date required' });
  if (!from_account_id || !to_account_id)
    return res.status(400).json({ error: 'from_account_id and to_account_id required' });
  if (Number(from_account_id) === Number(to_account_id))
    return res.status(400).json({ error: 'from and to accounts must be different' });

  const fromAcct = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1').get(from_account_id);
  const toAcct   = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1').get(to_account_id);
  if (!fromAcct || !toAcct)
    return res.status(400).json({ error: 'invalid or inactive account' });

  const result = db.prepare(
    'INSERT INTO transfers (from_account_id, to_account_id, amount, date, note) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(from_account_id), Number(to_account_id), amt, String(date).trim(), note ?? null);

  const created = db.prepare('SELECT * FROM transfers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// DELETE /api/transfers/:id
router.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT id FROM transfers WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM transfers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
