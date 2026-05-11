const express = require('express');
const router = express.Router();
const db = require('../db');

const KNOWN_WIDGETS = ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'];

const DEFAULT_SIZES = { stats: 2, accounts: 2, bar_chart: 1, donut_chart: 1, calendar: 2 };

const DEFAULT_LAYOUT = {
  order: ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'],
  hidden: [],
  sizes: { ...DEFAULT_SIZES },
};

const stmtGet    = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtUpsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function _migrate(layout) {
  let changed = false;

  // 1. Replace old 'charts' with 'bar_chart' + 'donut_chart'
  const ci = layout.order.indexOf('charts');
  if (ci !== -1) {
    layout.order.splice(ci, 1, 'bar_chart', 'donut_chart');
    changed = true;
  }
  const chi = layout.hidden.indexOf('charts');
  if (chi !== -1) {
    layout.hidden.splice(chi, 1, 'bar_chart', 'donut_chart');
    changed = true;
  }

  // 2. Remove unknown IDs and deduplicate
  const before = layout.order.length;
  layout.order = [...new Set(layout.order.filter(id => KNOWN_WIDGETS.includes(id)))];
  if (layout.order.length !== before) changed = true;

  // 3. Add missing IDs at the end
  for (const w of KNOWN_WIDGETS) {
    if (!layout.order.includes(w)) {
      layout.order.push(w);
      changed = true;
    }
  }

  // 4. Remove hidden IDs not in order
  const hiddenBefore = layout.hidden.length;
  layout.hidden = layout.hidden.filter(id => layout.order.includes(id));
  if (layout.hidden.length !== hiddenBefore) changed = true;

  // 5. Ensure sizes is an object
  if (!layout.sizes || typeof layout.sizes !== 'object' || Array.isArray(layout.sizes)) {
    layout.sizes = { ...DEFAULT_SIZES };
    changed = true;
  }

  // 6. Fill missing / invalid size values
  for (const id of layout.order) {
    if (layout.sizes[id] !== 1 && layout.sizes[id] !== 2) {
      layout.sizes[id] = DEFAULT_SIZES[id] ?? 2;
      changed = true;
    }
  }

  return { layout, changed };
}

// GET /api/settings/dashboard
router.get('/dashboard', (_req, res) => {
  const row = stmtGet.get('dashboard_layout');
  if (!row) return res.json(DEFAULT_LAYOUT);
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return res.json(DEFAULT_LAYOUT);
  }
  const { layout, changed } = _migrate(parsed);
  if (changed) stmtUpsert.run('dashboard_layout', JSON.stringify(layout));
  res.json(layout);
});

// POST /api/settings/dashboard
router.post('/dashboard', (req, res) => {
  const { order, hidden, sizes } = req.body;
  if (!Array.isArray(order) || !Array.isArray(hidden))
    return res.status(400).json({ error: 'order and hidden must be arrays' });
  if (order.length !== KNOWN_WIDGETS.length)
    return res.status(400).json({ error: 'order must contain exactly 5 widget IDs' });
  if (!KNOWN_WIDGETS.every(w => order.includes(w)))
    return res.status(400).json({ error: 'order must contain: stats, accounts, bar_chart, donut_chart, calendar' });
  if (!hidden.every(w => KNOWN_WIDGETS.includes(w)))
    return res.status(400).json({ error: 'hidden contains unknown widget ID' });
  if (sizes !== undefined && (typeof sizes !== 'object' || Array.isArray(sizes)))
    return res.status(400).json({ error: 'sizes must be an object' });
  if (sizes) {
    for (const [k, v] of Object.entries(sizes)) {
      if (!KNOWN_WIDGETS.includes(k))
        return res.status(400).json({ error: `sizes contains unknown widget ID: ${k}` });
      if (v !== 1 && v !== 2)
        return res.status(400).json({ error: `sizes.${k} must be 1 or 2` });
    }
  }
  // Fill any missing sizes with defaults before storing
  const mergedSizes = { ...DEFAULT_SIZES, ...(sizes || {}) };
  stmtUpsert.run('dashboard_layout', JSON.stringify({ order, hidden, sizes: mergedSizes }));
  res.json({ ok: true });
});

module.exports = router;
module.exports._migrate = _migrate; // exposed for unit tests
