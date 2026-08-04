const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { findOwned, requireOwned } = require('../lib/ownership');
const { _parseDateRange } = require('./summary-range');
const {
  cancelBillSeries, createBillWithSeries, materializeBillRange,
} = require('../lib/recurrence/service');
const { frequencyName } = require('../lib/recurrence/dates');
const {
  parseIntegerId, parseOptionalIntegerId, parsePositiveInteger, parsePositiveMoney,
  validationMessage,
} = require('../lib/finance-validation');

function ensureBillMonths(year, month, userId) {
  const dim = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  materializeBillRange(db, userId, `${prefix}-01`, `${prefix}-${String(dim).padStart(2, '0')}`);
}

function monthsBetween(from, to) {
  const [fromY, fromM] = from.split('-').slice(0, 2).map(Number);
  const [toY, toM]     = to.split('-').slice(0, 2).map(Number);
  const months = [];
  let y = fromY, m = fromM;
  while (y < toY || (y === toY && m <= toM)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

function resolveDueDate(dueDay, year, month) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, daysInMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function enrichRecurrence(row) {
  return {
    ...row,
    recurrence_frequency: row.frequency_unit
      ? frequencyName(row.frequency_unit, row.frequency_interval)
      : 'monthly',
  };
}

function billRowsForRange(userId, from, to, accountId) {
  let sql = `
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           bm.id as bill_month_id, bm.paid, bm.amount_paid, bm.paid_date, bm.due_date,
           s.status as recurrence_status, s.frequency_unit, s.frequency_interval,
           s.start_date, s.end_mode, s.end_date, s.max_occurrences
    FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id AND b.user_id = ? AND b.active = 1
    JOIN categories c ON b.category_id = c.id
    JOIN recurring_series s ON s.id = b.recurring_series_id
    WHERE bm.due_date >= ? AND bm.due_date <= ?`;
  const params = [userId, from, to];
  if (accountId != null) { sql += ' AND b.account_id = ?'; params.push(accountId); }
  sql += ' ORDER BY bm.due_date ASC, b.id ASC';
  const occurrences = db.prepare(sql).all(...params).map(enrichRecurrence);

  let dormantSql = `
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           NULL as bill_month_id, NULL as paid, NULL as amount_paid, NULL as paid_date,
           NULL as due_date, s.status as recurrence_status, s.frequency_unit,
           s.frequency_interval, s.start_date, s.end_mode, s.end_date, s.max_occurrences
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    JOIN recurring_series s ON s.id = b.recurring_series_id
    WHERE b.user_id = ? AND b.active = 1 AND s.status IN ('paused','completed')
      AND NOT EXISTS (
        SELECT 1 FROM bill_months existing
        WHERE existing.bill_id = b.id AND existing.due_date >= ? AND existing.due_date <= ?
      )`;
  const dormantParams = [userId, from, to];
  if (accountId != null) { dormantSql += ' AND b.account_id = ?'; dormantParams.push(accountId); }
  const dormant = db.prepare(dormantSql).all(...dormantParams).map(row => ({
    ...enrichRecurrence(row), management_only: true,
  }));
  return [...occurrences, ...dormant];
}

function cancelledBillRows(userId, accountId) {
  let sql = `
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           NULL as bill_month_id, NULL as paid, NULL as amount_paid, NULL as paid_date,
           NULL as due_date, s.status as recurrence_status, s.frequency_unit,
           s.frequency_interval, s.start_date, s.end_mode, s.end_date, s.max_occurrences
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    JOIN recurring_series s ON s.id = b.recurring_series_id
    WHERE b.user_id = ? AND b.active = 0
  `;
  const params = [userId];
  if (accountId != null) { sql += ' AND b.account_id = ?'; params.push(accountId); }
  sql += ' ORDER BY b.cancelled_at DESC, b.id DESC';
  return db.prepare(sql).all(...params).map(enrichRecurrence);
}

// GET /api/bills
router.get('/', (req, res) => {
  const now = new Date();
  const year  = Number(req.query.year  ?? now.getUTCFullYear());
  const month = Number(req.query.month ?? now.getUTCMonth() + 1);
  const { account_id } = req.query;
  ensureBillMonths(year, month, req.userId);
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  res.json([
    ...billRowsForRange(req.userId, `${prefix}-01`, `${prefix}-${String(dim).padStart(2, '0')}`, account_id),
    ...cancelledBillRows(req.userId, account_id),
  ]);
});

// GET /api/bills/by-range?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/by-range', (req, res) => {
  const { from, to } = req.query;
  const err = _parseDateRange(from, to);
  if (err) return res.status(400).json({ error: err });

  materializeBillRange(db, req.userId, from, to);
  res.json([...billRowsForRange(req.userId, from, to), ...cancelledBillRows(req.userId)]);
});

// POST /api/bills
router.post('/', (req, res) => {
  const { name, amount, due_day, category_id, account_id, recurrence } = req.body;
  if (!name || amount == null || !category_id || (!due_day && !recurrence?.start_date))
    return res.status(400).json({ error: 'name, amount, due_day, category_id required' });
  let parsedAmount, parsedDay, categoryId, accountId;
  try {
    parsedAmount = parsePositiveMoney(amount);
    parsedDay = parsePositiveInteger(due_day ?? String(recurrence.start_date).slice(8, 10), 'due_day', 31);
    categoryId = parseIntegerId(category_id, 'category_id');
    accountId = parseOptionalIntegerId(account_id, 'account_id');
  } catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  if (!requireOwned(db, res, 'category', categoryId, req.userId)) return;
  try {
    const result = db.transaction(() => {
      if (accountId != null && !findOwned(db, 'account', accountId, req.userId, { active: true })) {
        return { accountNotFound: true };
      }
      return createBillWithSeries(db, req.userId, {
        name, amount: parsedAmount, due_day: parsedDay,
        category_id: categoryId, account_id: accountId,
      }, recurrence);
    }).immediate();
    if (result.accountNotFound) return res.status(404).json({ error: 'account not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({
      id: result.billId, name, amount: parsedAmount, due_day: parsedDay,
      category_id, account_id: account_id ?? null, active: 1,
      recurring_series_id: result.series.id, recurrence: result.series,
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'invalid category_id or account_id' });
    throw err;
  }
});

// PATCH /api/bills/:id/cancel
router.patch('/:id/cancel', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'bill id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (!bill.active) return res.status(409).json({ error: 'already cancelled' });
  cancelBillSeries(db, bill);
  res.json({ id, cancelled: true });
});

// POST /api/bill-months/:id/pay
router.post('/:id/pay', (req, res) => {
  let id;
  try { id = parseIntegerId(req.params.id, 'bill payment id'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  const bm = db.prepare(`
    SELECT bm.* FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id AND b.user_id = ?
    WHERE bm.id = ?
  `).get(req.userId, id);
  if (!bm) return res.status(404).json({ error: 'not found' });
  const bill = db.prepare('SELECT amount FROM bills WHERE id = ?').get(bm.bill_id);
  let amount_paid;
  try { amount_paid = parsePositiveMoney(req.body.amount_paid ?? bill.amount, 'amount_paid'); }
  catch (error) { return res.status(400).json({ error: validationMessage(error) }); }
  db.prepare("UPDATE bill_months SET paid = 1, amount_paid = ?, paid_date = date('now') WHERE id = ?")
    .run(amount_paid, id);
  res.json({ id, paid: true, amount_paid });
});

module.exports = router;
module.exports.ensureBillMonths = ensureBillMonths;
module.exports.monthsBetween = monthsBetween;
module.exports.resolveDueDate = resolveDueDate;
