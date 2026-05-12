const express = require('express');
const router = express.Router();
const db = require('../db');

const KNOWN_WIDGETS = ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'];

const DEFAULT_SIZES = {
  stats:       { w: 4, h: 1 },
  accounts:    { w: 4, h: 1 },
  bar_chart:   { w: 2, h: 1 },
  donut_chart: { w: 2, h: 1 },
  calendar:    { w: 4, h: 1 },
};

const DEFAULT_LAYOUT = {
  order: ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'],
  hidden: [],
  sizes: { ...DEFAULT_SIZES },
};

const stmtGet    = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?');
const stmtUpsert = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value');

const DARK_THEME_DEFAULTS  = { mode: 'dark',  accent: '#f7a4a2', bg: '#111111' };
const LIGHT_THEME_DEFAULTS = { mode: 'light', accent: '#c45c5a', bg: '#f0e8f0' };
const HEX_RE = /^#[0-9a-f]{6}$/i;

function parseTheme(raw) {
  let t;
  try { t = JSON.parse(raw); } catch { return { ...DARK_THEME_DEFAULTS }; }
  if (!['dark', 'light'].includes(t?.mode)) return { ...DARK_THEME_DEFAULTS };
  const defs = t.mode === 'dark' ? DARK_THEME_DEFAULTS : LIGHT_THEME_DEFAULTS;
  return {
    mode:   t.mode,
    accent: HEX_RE.test(t.accent) ? t.accent : defs.accent,
    bg:     HEX_RE.test(t.bg)     ? t.bg     : defs.bg,
  };
}

function _migrate(layout, userId) {
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

  // 6. Migrate numeric sizes (v1.4.1) and fill missing / invalid { w, h } values
  for (const id of layout.order) {
    const s = layout.sizes[id];
    const def = DEFAULT_SIZES[id] ?? { w: 4, h: 1 };
    if (typeof s === 'number') {
      layout.sizes[id] = s === 1 ? { w: 2, h: 1 } : { w: 4, h: 1 };
      changed = true;
    } else if (
      !s || typeof s !== 'object' ||
      ![1, 2, 3, 4].includes(s.w) ||
      ![1, 2, 3].includes(s.h)
    ) {
      layout.sizes[id] = { ...def };
      changed = true;
    }
  }

  if (changed && userId != null) stmtUpsert.run(userId, 'dashboard_layout', JSON.stringify(layout));
  return { layout, changed };
}

// GET /api/settings/dashboard
router.get('/dashboard', (req, res) => {
  const row = stmtGet.get(req.userId, 'dashboard_layout');
  if (!row) return res.json(DEFAULT_LAYOUT);
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return res.json(DEFAULT_LAYOUT);
  }
  const { layout } = _migrate(parsed, req.userId);
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
      if (!v || typeof v !== 'object' || ![1,2,3,4].includes(v.w) || ![1,2,3].includes(v.h))
        return res.status(400).json({ error: `sizes.${k} must be { w: 1-4, h: 1-3 }` });
    }
  }
  // Fill any missing sizes with defaults before storing
  const mergedSizes = { ...DEFAULT_SIZES, ...(sizes || {}) };
  stmtUpsert.run(req.userId, 'dashboard_layout', JSON.stringify({ order, hidden, sizes: mergedSizes }));
  res.json({ ok: true });
});

// GET /api/settings/theme
router.get('/theme', (req, res) => {
  const row = stmtGet.get(req.userId, 'theme');
  if (!row) return res.json({ ...DARK_THEME_DEFAULTS });
  res.json(parseTheme(row.value));
});

// POST /api/settings/theme
router.post('/theme', (req, res) => {
  const { mode, accent, bg } = req.body;
  if (mode !== undefined && !['dark', 'light'].includes(mode))
    return res.status(400).json({ error: 'mode must be "dark" or "light"' });
  if (accent !== undefined && !HEX_RE.test(accent))
    return res.status(400).json({ error: 'accent must be a valid hex colour (#rrggbb)' });
  if (bg !== undefined && !HEX_RE.test(bg))
    return res.status(400).json({ error: 'bg must be a valid hex colour (#rrggbb)' });

  const row = stmtGet.get(req.userId, 'theme');
  const current = row ? parseTheme(row.value) : { ...DARK_THEME_DEFAULTS };
  const updated = {
    mode:   mode   ?? current.mode,
    accent: accent ?? current.accent,
    bg:     bg     ?? current.bg,
  };
  stmtUpsert.run(req.userId, 'theme', JSON.stringify(updated));
  res.json({ ok: true });
});

module.exports = router;
module.exports._migrate = _migrate; // exposed for unit tests
module.exports._parseTheme = parseTheme;
