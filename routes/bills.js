const express = require('express');
const router = express.Router();
const db = require('../db');

function ensureBillMonths(year, month) {
  const activeBills = db.prepare('SELECT id FROM bills WHERE active = 1').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO bill_months (bill_id, year, month) VALUES (?, ?, ?)'
  );
  for (const bill of activeBills) insert.run(bill.id, year, month);
}

// GET /api/bills?year=2026&month=5
router.get('/', (req, res) => {
  const now = new Date();
  const year  = Number(req.query.year  ?? now.getFullYear());
  const month = Number(req.query.month ?? now.getMonth() + 1);
  ensureBillMonths(year, month);

  const rows = db.prepare(`
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           bm.id as bill_month_id, bm.paid, bm.amount_paid, bm.paid_date
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    LEFT JOIN bill_months bm ON bm.bill_id = b.id AND bm.year = ? AND bm.month = ?
    ORDER BY b.active DESC, b.due_day ASC
  `).all(year, month);
  res.json(rows);
});

// POST /api/bills
router.post('/', (req, res) => {
  const { name, amount, due_day, category_id } = req.body;
  if (!name || amount == null || !due_day || !category_id)
    return res.status(400).json({ error: 'name, amount, due_day, category_id required' });
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).json({ error: 'amount must be a number' });
  const parsedDay = Number(due_day);
  if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31)
    return res.status(400).json({ error: 'due_day must be 1-31' });
  try {
    const result = db.prepare(
      'INSERT INTO bills (name, amount, due_day, category_id) VALUES (?, ?, ?, ?)'
    ).run(name, parsedAmount, parsedDay, category_id);
    res.status(201).json({ id: result.lastInsertRowid, name, amount: parsedAmount, due_day: parsedDay, category_id, active: 1 });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(400).json({ error: 'category_id does not exist' });
    }
    throw err;
  }
});

// PATCH /api/bills/:id/cancel
router.patch('/:id/cancel', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (!bill.active) return res.status(409).json({ error: 'already cancelled' });
  db.prepare("UPDATE bills SET active = 0, cancelled_at = datetime('now') WHERE id = ?")
    .run(req.params.id);
  res.json({ id: Number(req.params.id), cancelled: true });
});

// POST /api/bill-months/:id/pay  (served via /api/bill-months mount in server.js)
router.post('/:id/pay', (req, res) => {
  const bm = db.prepare('SELECT * FROM bill_months WHERE id = ?').get(req.params.id);
  if (!bm) return res.status(404).json({ error: 'not found' });
  const bill = db.prepare('SELECT amount FROM bills WHERE id = ?').get(bm.bill_id);
  const amount_paid = req.body.amount_paid != null ? parseFloat(req.body.amount_paid) : bill.amount;
  if (isNaN(amount_paid)) return res.status(400).json({ error: 'amount_paid must be a number' });
  db.prepare("UPDATE bill_months SET paid = 1, amount_paid = ?, paid_date = date('now') WHERE id = ?")
    .run(amount_paid, req.params.id);
  res.json({ id: Number(req.params.id), paid: true, amount_paid });
});

module.exports = router;
