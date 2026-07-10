const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { _parseDateRange } = require('./summary-range');

function ensureBillMonths(year, month, userId) {
  const activeBills = db.prepare('SELECT id FROM bills WHERE active = 1 AND user_id = ?').all(userId);
  const insert = db.prepare('INSERT OR IGNORE INTO bill_months (bill_id, year, month) VALUES (?, ?, ?)');
  for (const bill of activeBills) insert.run(bill.id, year, month);
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
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, daysInMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// GET /api/bills
router.get('/', (req, res) => {
  const now = new Date();
  const year  = Number(req.query.year  ?? now.getFullYear());
  const month = Number(req.query.month ?? now.getMonth() + 1);
  const { account_id } = req.query;
  ensureBillMonths(year, month, req.userId);

  let sql = `
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           bm.id as bill_month_id, bm.paid, bm.amount_paid, bm.paid_date
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    LEFT JOIN bill_months bm ON bm.bill_id = b.id AND bm.year = ? AND bm.month = ?
    WHERE b.user_id = ?`;
  const params = [year, month, req.userId];
  if (account_id != null) { sql += ` AND b.account_id = ?`; params.push(account_id); }
  sql += ` ORDER BY b.active DESC, b.due_day ASC`;
  res.json(db.prepare(sql).all(...params));
});

// GET /api/bills/by-range?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/by-range', (req, res) => {
  const { from, to } = req.query;
  const err = _parseDateRange(from, to);
  if (err) return res.status(400).json({ error: err });

  const months = monthsBetween(from, to);
  for (const { year, month } of months) ensureBillMonths(year, month, req.userId);

  const activeRows = [];
  for (const { year, month } of months) {
    const rows = db.prepare(`
      SELECT b.*, c.name as category_name, c.colour as category_colour,
             bm.id as bill_month_id, bm.paid, bm.amount_paid, bm.paid_date
      FROM bills b
      JOIN categories c ON b.category_id = c.id
      LEFT JOIN bill_months bm ON bm.bill_id = b.id AND bm.year = ? AND bm.month = ?
      WHERE b.user_id = ? AND b.active = 1
    `).all(year, month, req.userId);
    for (const row of rows) {
      const dueDate = resolveDueDate(row.due_day, year, month);
      if (dueDate >= from && dueDate <= to) activeRows.push({ ...row, due_date: dueDate });
    }
  }

  const cancelledRows = db.prepare(`
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           NULL as bill_month_id, NULL as paid, NULL as amount_paid, NULL as paid_date
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    WHERE b.user_id = ? AND b.active = 0
  `).all(req.userId).map(row => ({ ...row, due_date: null }));

  res.json([...activeRows, ...cancelledRows]);
});

// POST /api/bills
router.post('/', (req, res) => {
  const { name, amount, due_day, category_id, account_id } = req.body;
  if (!name || amount == null || !due_day || !category_id)
    return res.status(400).json({ error: 'name, amount, due_day, category_id required' });
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).json({ error: 'amount must be a number' });
  const parsedDay = Number(due_day);
  if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31)
    return res.status(400).json({ error: 'due_day must be 1-31' });
  try {
    const result = db.prepare(
      'INSERT INTO bills (user_id, name, amount, due_day, category_id, account_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, name, parsedAmount, parsedDay, category_id, account_id ?? null);
    res.status(201).json({ id: result.lastInsertRowid, name, amount: parsedAmount, due_day: parsedDay, category_id, account_id: account_id ?? null, active: 1 });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'invalid category_id or account_id' });
    throw err;
  }
});

// PATCH /api/bills/:id/cancel
router.patch('/:id/cancel', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (!bill.active) return res.status(409).json({ error: 'already cancelled' });
  db.prepare("UPDATE bills SET active = 0, cancelled_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  res.json({ id: Number(req.params.id), cancelled: true });
});

// POST /api/bill-months/:id/pay
router.post('/:id/pay', (req, res) => {
  const bm = db.prepare(`
    SELECT bm.* FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id AND b.user_id = ?
    WHERE bm.id = ?
  `).get(req.userId, req.params.id);
  if (!bm) return res.status(404).json({ error: 'not found' });
  const bill = db.prepare('SELECT amount FROM bills WHERE id = ?').get(bm.bill_id);
  const amount_paid = req.body.amount_paid != null ? parseFloat(req.body.amount_paid) : bill.amount;
  if (isNaN(amount_paid)) return res.status(400).json({ error: 'amount_paid must be a number' });
  db.prepare("UPDATE bill_months SET paid = 1, amount_paid = ?, paid_date = date('now') WHERE id = ?")
    .run(amount_paid, req.params.id);
  res.json({ id: Number(req.params.id), paid: true, amount_paid });
});

module.exports = router;
module.exports.ensureBillMonths = ensureBillMonths;
module.exports.monthsBetween = monthsBetween;
module.exports.resolveDueDate = resolveDueDate;
