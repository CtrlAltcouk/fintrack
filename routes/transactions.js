const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { findOwned, requireOwned } = require('../lib/ownership');
const { insertTransaction } = require('../lib/transactions/service');
const { getOwnedSeries } = require('../lib/recurrence/service');
const {
  createRecurringTransaction, updateTransactionFuture,
} = require('../lib/recurrence/transaction-service');
const {
  parseIntegerId, parseIsoDate, parseOptionalIntegerId, parsePositiveMoney, validationMessage,
} = require('../lib/finance-validation');

// GET /api/transactions
router.get('/', (req, res) => {
  const { year, month, from, to, category_id, account_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour,
             a.name as account_name, a.colour as account_colour,
             ro.series_id as recurring_series_id
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts   a ON t.account_id  = a.id
             LEFT JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
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
  const {
    amount, description, category_id, date, account_id, recurrence,
    notes, transaction_type, metadata,
  } = req.body;
  if (amount == null || !description || !category_id || !date)
    return res.status(400).json({ error: 'amount, description, category_id, date required' });
  let parsed, categoryId, accountId, parsedDate;
  try {
    parsed = parsePositiveMoney(amount);
    categoryId = parseIntegerId(category_id, 'category_id');
    accountId = parseOptionalIntegerId(account_id, 'account_id');
    parsedDate = parseIsoDate(date);
  } catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  if (!requireOwned(db, res, 'category', categoryId, req.userId)) return;
  try {
    const result = db.transaction(() => {
      if (accountId != null && !findOwned(db, 'account', accountId, req.userId, { active: true })) {
        return { accountNotFound: true };
      }
      if (recurrence !== undefined && recurrence !== null) {
        return { recurring: createRecurringTransaction(db, req.userId, {
          amount: parsed, description, category_id: categoryId, date: parsedDate,
          account_id: accountId, notes,
          transaction_type, metadata,
        }, recurrence) };
      }
      return { id: insertTransaction(db, {
        user_id: req.userId, amount: parsed, description, category_id,
        date: parsedDate, account_id: accountId,
      }) };
    }).immediate();
    if (result.accountNotFound) return res.status(404).json({ error: 'account not found' });
    if (result.recurring) {
      if (result.recurring.error) {
        return res.status(result.recurring.status ?? 400).json({ error: result.recurring.error });
      }
      return res.status(201).json(result.recurring);
    }
    res.status(201).json({ id: result.id, amount: parsed, description, category_id: categoryId, date: parsedDate, account_id: accountId });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'category_id does not exist' });
    throw err;
  }
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'transaction id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const {
    amount, description, category_id, date, account_id, notes,
    transaction_type, metadata,
  } = req.body;
  const scope = req.body.scope ?? req.body.recurrence_scope ?? 'single';
  if (!['single', 'future'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be single or future' });
  }
  let parsedAmount, parsedCategoryId, parsedAccountId, parsedDate;
  try {
    parsedAmount = amount !== undefined ? parsePositiveMoney(amount) : existing.amount;
    parsedCategoryId = category_id !== undefined ? parseIntegerId(category_id, 'category_id') : existing.category_id;
    parsedAccountId = account_id !== undefined ? parseOptionalIntegerId(account_id, 'account_id') : existing.account_id;
    parsedDate = date !== undefined ? parseIsoDate(date) : existing.date;
  } catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  if (category_id !== undefined && !requireOwned(db, res, 'category', parsedCategoryId, req.userId)) return;
  const occurrence = existing.recurring_occurrence_id == null ? null : db.prepare(`SELECT ro.*, s.id AS recurring_series_id
    FROM recurring_occurrences ro JOIN recurring_series s ON s.id = ro.series_id
    WHERE ro.id = ? AND s.user_id = ? AND s.kind = 'transaction'`
  ).get(existing.recurring_occurrence_id, req.userId);
  if (scope === 'future' && !occurrence) {
    return res.status(409).json({ error: 'transaction is not recurring' });
  }
  const nextAccountId = parsedAccountId;
  const nextCategoryId = parsedCategoryId;
  const nextDescription = description ?? existing.description;
  const nextDate = parsedDate;
  let future = null;
  const updateResult = db.transaction(() => {
    if (parsedAccountId != null
        && !findOwned(db, 'account', parsedAccountId, req.userId, { active: true })) {
      return { accountNotFound: true };
    }
    if (scope === 'future') {
      future = updateTransactionFuture(db, getOwnedSeries(
        db, occurrence.recurring_series_id, req.userId, { kind: 'transaction' }
      ), {
        amount: parsedAmount, description: nextDescription, category_id: nextCategoryId,
        account_id: nextAccountId, notes, transaction_type, metadata,
      });
      if (future.error) return { futureError: true };
    }
    db.prepare(`UPDATE transactions SET amount=?, description=?, category_id=?, date=?, account_id=?
      WHERE id=? AND user_id=?`
    ).run(parsedAmount, nextDescription, nextCategoryId, nextDate, nextAccountId, id, req.userId);
    return { updated: true };
  }).immediate();
  if (updateResult.accountNotFound) return res.status(404).json({ error: 'account not found' });
  if (future?.error) return res.status(future.status).json({ error: future.error });
  res.json({ id, amount: parsedAmount,
             description: nextDescription, category_id: nextCategoryId, date: nextDate,
             ...(occurrence ? { recurring_series_id: occurrence.recurring_series_id, scope } : {}) });
});

// DELETE /api/transactions/:id
router.delete('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'transaction id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const existing = db.prepare(
    'SELECT id, recurring_occurrence_id FROM transactions WHERE id = ? AND user_id = ?'
  ).get(id, req.userId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const result = db.transaction(() => {
    const removed = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
      .run(id, req.userId);
    if (existing.recurring_occurrence_id != null) {
      db.prepare(`UPDATE recurring_occurrences SET status = 'deleted',
        updated_at = datetime('now') WHERE id = ?`).run(existing.recurring_occurrence_id);
    }
    return removed;
  })();
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
