const express = require('express');
const router  = express.Router();
const db      = require('../db');
const {
  parseIntegerId, parseMoney, validationMessage,
} = require('../lib/finance-validation');
const {
  ACCOUNT_IN_USE_CODE, ACCOUNT_IN_USE_MESSAGE, deactivateAccount,
} = require('../lib/account-dependencies');

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
  const balance = openingBalance + inc - txn - bill + tin - tout;
  if (!Number.isFinite(balance)) throw new Error('Calculated account balance is not finite');
  return Object.is(balance, -0) ? 0 : balance;
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
  let ob;
  try { ob = parseMoney(opening_balance ?? 0, 'opening_balance'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const result = db.prepare(
    'INSERT INTO accounts (user_id, name, type, colour, opening_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, name.trim(), type, colour ?? '#888888', ob);
  res.status(201).json({ id: result.lastInsertRowid, user_id: req.userId, name: name.trim(), type, colour: colour ?? '#888888', opening_balance: ob, balance: ob, active: 1 });
});

// PATCH /api/accounts/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'account id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const result = deactivateAccount(db, id, req.userId);
  if (result.status === 'not_found') return res.status(404).json({ error: 'not found' });
  if (result.status === 'already_inactive') return res.status(409).json({ error: 'already inactive' });
  if (result.status === 'blocked') {
    return res.status(409).json({
      error: ACCOUNT_IN_USE_MESSAGE,
      code: ACCOUNT_IN_USE_CODE,
      dependencies: result.dependencies,
      dependency_details: result.details,
    });
  }
  res.json({ ok: true });
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'account id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!a) return res.status(404).json({ error: 'not found' });
  const { name, colour, type, opening_balance } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  const updName = name !== undefined ? name.trim() : a.name;
  const updColour = colour ?? a.colour;
  const updType = type ?? a.type;
  let updOb;
  try { updOb = opening_balance !== undefined ? parseMoney(opening_balance, 'opening_balance') : a.opening_balance; }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  if (!['current','savings','card'].includes(updType)) return res.status(400).json({ error: 'type must be current, savings, or card' });
  db.prepare('UPDATE accounts SET name=?, colour=?, type=?, opening_balance=? WHERE id=? AND user_id=?')
    .run(updName, updColour, updType, updOb, id, req.userId);
  res.json({ id, name: updName, colour: updColour, type: updType, opening_balance: updOb, balance: calcBalance(a.id, updOb, req.userId), active: a.active });
});

module.exports = router;
