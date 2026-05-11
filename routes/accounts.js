const express = require('express');
const router = express.Router();
const db = require('../db');

const stmtBalInc  = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM income WHERE account_id = ? AND date <= date('now')");
const stmtBalTxn  = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE account_id = ?');
const stmtBalBill = db.prepare(`
  SELECT COALESCE(SUM(bm.amount_paid),0) as s
  FROM bill_months bm JOIN bills b ON bm.bill_id = b.id
  WHERE b.account_id = ? AND bm.paid = 1
`);
const stmtBalTxfTo   = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE to_account_id = ?');
const stmtBalTxfFrom = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE from_account_id = ?');

function calcBalance(accountId, openingBalance) {
  return openingBalance
    + stmtBalInc.get(accountId).s
    - stmtBalTxn.get(accountId).s
    - stmtBalBill.get(accountId).s
    + stmtBalTxfTo.get(accountId).s
    - stmtBalTxfFrom.get(accountId).s;
}

// GET /api/accounts
router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE active = 1 ORDER BY id ASC').all();
  res.json(accounts.map(a => ({ ...a, balance: calcBalance(a.id, a.opening_balance) })));
});

// POST /api/accounts
router.post('/', (req, res) => {
  const { name, type, colour, opening_balance } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!['current','savings','card'].includes(type))
    return res.status(400).json({ error: 'type must be current, savings, or card' });
  const ob = parseFloat(opening_balance ?? 0);
  if (isNaN(ob)) return res.status(400).json({ error: 'opening_balance must be a number' });
  const result = db.prepare(
    `INSERT INTO accounts (name, type, colour, opening_balance) VALUES (?, ?, ?, ?)`
  ).run(name.trim(), type, colour ?? '#888888', ob);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), type, colour: colour ?? '#888888', opening_balance: ob, balance: ob, active: 1 });
});

// PATCH /api/accounts/:id/deactivate  — must be defined BEFORE /:id
router.patch('/:id/deactivate', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE accounts SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  const { name, colour, type, opening_balance } = req.body;
  if (name !== undefined && !name.trim())
    return res.status(400).json({ error: 'name cannot be empty' });
  const updName = name !== undefined ? name.trim() : a.name;
  const updColour = colour ?? a.colour;
  const updType = type ?? a.type;
  const updOb = opening_balance !== undefined ? parseFloat(opening_balance) : a.opening_balance;
  if (!['current','savings','card'].includes(updType))
    return res.status(400).json({ error: 'type must be current, savings, or card' });
  if (isNaN(updOb)) return res.status(400).json({ error: 'opening_balance must be a number' });
  db.prepare('UPDATE accounts SET name=?, colour=?, type=?, opening_balance=? WHERE id=?')
    .run(updName, updColour, updType, updOb, req.params.id);
  res.json({ id: Number(req.params.id), name: updName, colour: updColour, type: updType, opening_balance: updOb, balance: calcBalance(a.id, updOb), active: a.active });
});

module.exports = router;
