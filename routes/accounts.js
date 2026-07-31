const express = require('express');
const router  = express.Router();
const db      = require('../db');

function calcBalance(accountId, openingBalance, userId) {
  const inc  = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM income WHERE account_id=? AND user_id=? AND date<=date('now')").get(accountId, userId).s;
  const txn  = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE account_id=? AND user_id=?').get(accountId, userId).s;
  const bill = db.prepare(`SELECT COALESCE(SUM(bm.amount_paid),0) as s FROM bill_months bm
    JOIN bills b ON bm.bill_id=b.id WHERE b.account_id=? AND b.user_id=? AND bm.paid=1`).get(accountId, userId).s;
  const tin  = db.prepare(`SELECT COALESCE(SUM(t.amount),0) as s FROM transfers t
    JOIN accounts f ON f.id=t.from_account_id AND f.user_id=?
    JOIN accounts d ON d.id=t.to_account_id AND d.user_id=?
    WHERE t.to_account_id=? AND t.user_id=?`).get(userId, userId, accountId, userId).s;
  const tout = db.prepare(`SELECT COALESCE(SUM(t.amount),0) as s FROM transfers t
    JOIN accounts f ON f.id=t.from_account_id AND f.user_id=?
    JOIN accounts d ON d.id=t.to_account_id AND d.user_id=?
    WHERE t.from_account_id=? AND t.user_id=?`).get(userId, userId, accountId, userId).s;
  return openingBalance + inc - txn - bill + tin - tout;
}

// GET /api/accounts
router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND active = 1 ORDER BY id ASC').all(req.userId);
  res.json(accounts.map(a => ({ ...a, balance: calcBalance(a.id, a.opening_balance, req.userId) })));
});

// POST /api/accounts
router.post('/', (req, res) => {
  const { name, type, colour, opening_balance } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!['current','savings','card'].includes(type)) return res.status(400).json({ error: 'type must be current, savings, or card' });
  const ob = parseFloat(opening_balance ?? 0);
  if (isNaN(ob)) return res.status(400).json({ error: 'opening_balance must be a number' });
  const result = db.prepare(
    'INSERT INTO accounts (user_id, name, type, colour, opening_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, name.trim(), type, colour ?? '#888888', ob);
  res.status(201).json({ id: result.lastInsertRowid, user_id: req.userId, name: name.trim(), type, colour: colour ?? '#888888', opening_balance: ob, balance: ob, active: 1 });
});

// PATCH /api/accounts/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE accounts SET active = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!a) return res.status(404).json({ error: 'not found' });
  const { name, colour, type, opening_balance } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  const updName = name !== undefined ? name.trim() : a.name;
  const updColour = colour ?? a.colour;
  const updType = type ?? a.type;
  const updOb = opening_balance !== undefined ? parseFloat(opening_balance) : a.opening_balance;
  if (!['current','savings','card'].includes(updType)) return res.status(400).json({ error: 'type must be current, savings, or card' });
  if (isNaN(updOb)) return res.status(400).json({ error: 'opening_balance must be a number' });
  db.prepare('UPDATE accounts SET name=?, colour=?, type=?, opening_balance=? WHERE id=? AND user_id=?')
    .run(updName, updColour, updType, updOb, req.params.id, req.userId);
  res.json({ id: Number(req.params.id), name: updName, colour: updColour, type: updType, opening_balance: updOb, balance: calcBalance(a.id, updOb, req.userId), active: a.active });
});

module.exports = router;
