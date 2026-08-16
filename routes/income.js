const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');
const { findOwned } = require('../lib/ownership');
const {
  parseIntegerId, parseIsoDate, parseOptionalIntegerId, parsePositiveMoney, validationMessage,
} = require('../lib/finance-validation');

// GET /api/income
router.get('/', (req, res) => {
  const { year, month, account_id } = req.query;
  if (year && month) ensureIncomeEntries(year, month, req.userId);
  let sql = `SELECT i.*, ro.series_id AS recurring_series_id
    FROM income i LEFT JOIN recurring_occurrences ro ON ro.id = i.recurring_occurrence_id
    WHERE i.user_id = ?`;
  const params = [req.userId];
  if (year && month) {
    sql += ` AND strftime('%Y', i.date) = ? AND strftime('%m', i.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (account_id) { sql += ` AND i.account_id = ?`; params.push(account_id); }
  sql += ' ORDER BY i.date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/income
router.post('/', (req, res) => {
  const { amount, description, date, account_id } = req.body;
  if (amount == null || !description || !date)
    return res.status(400).json({ error: 'amount, description, date required' });
  let parsed, parsedDate, accountId;
  try {
    parsed = parsePositiveMoney(amount);
    parsedDate = parseIsoDate(date);
    accountId = parseOptionalIntegerId(account_id, 'account_id');
  } catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const result = db.transaction(() => {
    if (accountId != null && !findOwned(db, 'account', accountId, req.userId, { active: true })) {
      return null;
    }
    return db.prepare(
      'INSERT INTO income (user_id, amount, description, date, account_id) VALUES (?, ?, ?, ?, ?)'
    ).run(req.userId, parsed, description, parsedDate, accountId);
  }).immediate();
  if (!result) return res.status(404).json({ error: 'account not found' });
  res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, date: parsedDate, account_id: accountId });
});

// DELETE /api/income/:id
router.delete('/:id', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'income id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const result = db.transaction(() => {
    const income = db.prepare(`SELECT i.id, i.recurring_occurrence_id,
        ro.series_id, s.kind AS series_kind, s.user_id AS series_user_id
      FROM income i
      LEFT JOIN recurring_occurrences ro ON ro.id = i.recurring_occurrence_id
      LEFT JOIN recurring_series s ON s.id = ro.series_id
      WHERE i.id = ? AND i.user_id = ?`).get(id, req.userId);
    if (!income) return { status: 'not_found' };
    if (income.recurring_occurrence_id != null
        && (income.series_kind !== 'income' || income.series_user_id !== req.userId)) {
      return { status: 'invalid_recurrence' };
    }
    const removed = db.prepare('DELETE FROM income WHERE id = ? AND user_id = ?')
      .run(id, req.userId);
    if (removed.changes !== 1) return { status: 'not_found' };
    if (income.recurring_occurrence_id != null) {
      const ledger = db.prepare(`UPDATE recurring_occurrences
        SET status = 'deleted', skip_reason = 'user', updated_at = datetime('now')
        WHERE id = ? AND series_id = ?`
      ).run(income.recurring_occurrence_id, income.series_id);
      if (ledger.changes !== 1) throw new Error('recurring income occurrence could not be marked deleted');
    }
    return { status: 'deleted' };
  }).immediate();
  if (result.status === 'not_found') return res.status(404).json({ error: 'not found' });
  if (result.status === 'invalid_recurrence') {
    return res.status(409).json({ error: 'recurring income relationship is invalid' });
  }
  res.status(204).end();
});

module.exports = router;
