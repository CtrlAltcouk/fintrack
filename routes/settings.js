const express = require('express');
const router = express.Router();
const db = require('../db');

const KNOWN_WIDGETS = ['stats', 'accounts', 'charts', 'calendar'];
const DEFAULT_LAYOUT = { order: ['stats', 'accounts', 'charts', 'calendar'], hidden: [] };

const stmtGet    = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtUpsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

// GET /api/settings/dashboard
router.get('/dashboard', (_req, res) => {
  const row = stmtGet.get('dashboard_layout');
  if (!row) return res.json(DEFAULT_LAYOUT);
  try {
    res.json(JSON.parse(row.value));
  } catch {
    res.json(DEFAULT_LAYOUT);
  }
});

// POST /api/settings/dashboard
router.post('/dashboard', (req, res) => {
  const { order, hidden } = req.body;
  if (!Array.isArray(order) || !Array.isArray(hidden))
    return res.status(400).json({ error: 'order and hidden must be arrays' });
  if (order.length !== KNOWN_WIDGETS.length)
    return res.status(400).json({ error: 'order must contain exactly 4 widget IDs' });
  if (!KNOWN_WIDGETS.every(w => order.includes(w)))
    return res.status(400).json({ error: 'order must contain: stats, accounts, charts, calendar' });
  if (!hidden.every(w => KNOWN_WIDGETS.includes(w)))
    return res.status(400).json({ error: 'hidden contains unknown widget ID' });
  stmtUpsert.run('dashboard_layout', JSON.stringify({ order, hidden }));
  res.json({ ok: true });
});

module.exports = router;
