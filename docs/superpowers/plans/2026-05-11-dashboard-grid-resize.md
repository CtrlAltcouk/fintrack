# Dashboard Grid Resize & Chart Widget Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the `charts` widget into two independent widgets, add a 2-column CSS grid to the dashboard, and give each widget a drag-to-snap resize handle in edit mode.

**Architecture:** `routes/settings.js` gains a `_migrate()` helper and updated validation for the 5 new widget IDs + `sizes` field; `public/style.css` gets a responsive stat-grid and loses the now-unused chart-grid rule; the dashboard section in `public/app.js` is rewritten to render a CSS grid, accept `editSizes` as a 4th parameter, and wire resize handle mousedown/mouseup events.

**Tech Stack:** Node.js, Express 4, better-sqlite3, vanilla JS, Chart.js, CSS Grid.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `routes/settings.js` | Modify | New widget IDs, `DEFAULT_SIZES`, `_migrate()`, updated GET/POST |
| `public/style.css` | Modify | `.stat-grid` → auto-fit, remove `.chart-grid` |
| `public/app.js` | Modify | Dashboard section: new widget HTML, grid container, resize handle, sizes wiring |
| `package.json` | Modify | Bump to 1.4.1 |

---

### Task 1: Update settings API

**Files:**
- Modify: `routes/settings.js`

- [ ] **Step 1: Read the current file**

Read `routes/settings.js` to confirm it matches what is expected before editing.

- [ ] **Step 2: Replace the entire file with the new version**

```javascript
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

  // 2. Remove unknown IDs
  const before = layout.order.length;
  layout.order = layout.order.filter(id => KNOWN_WIDGETS.includes(id));
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
```

- [ ] **Step 3: Verify GET returns migrated layout**

Start the server if not already running: `node server.js`

```
curl -s http://localhost:3000/api/settings/dashboard
```

Expected (may vary if a layout was previously saved — but `charts` must NOT appear and `bar_chart`/`donut_chart` MUST appear):
```json
{"order":["stats","accounts","bar_chart","donut_chart","calendar"],"hidden":[],"sizes":{"stats":2,"accounts":2,"bar_chart":1,"donut_chart":1,"calendar":2}}
```

- [ ] **Step 4: Verify POST saves sizes**

```
curl -s -X POST http://localhost:3000/api/settings/dashboard -H "Content-Type: application/json" -d "{\"order\":[\"stats\",\"accounts\",\"bar_chart\",\"donut_chart\",\"calendar\"],\"hidden\":[],\"sizes\":{\"stats\":2,\"accounts\":2,\"bar_chart\":1,\"donut_chart\":1,\"calendar\":2}}"
```

Expected: `{"ok":true}`

- [ ] **Step 5: Verify POST validation rejects unknown widget**

```
curl -s -X POST http://localhost:3000/api/settings/dashboard -H "Content-Type: application/json" -d "{\"order\":[\"stats\",\"accounts\",\"charts\",\"donut_chart\",\"calendar\"],\"hidden\":[],\"sizes\":{}}"
```

Expected: `{"error":"order must contain: stats, accounts, bar_chart, donut_chart, calendar"}`

- [ ] **Step 6: Verify POST validation rejects bad size value**

```
curl -s -X POST http://localhost:3000/api/settings/dashboard -H "Content-Type: application/json" -d "{\"order\":[\"stats\",\"accounts\",\"bar_chart\",\"donut_chart\",\"calendar\"],\"hidden\":[],\"sizes\":{\"bar_chart\":3}}"
```

Expected: `{"error":"sizes.bar_chart must be 1 or 2"}`

- [ ] **Step 7: Commit**

```
git add routes/settings.js
git commit -m "feat: settings API — 5 widgets, sizes field, _migrate for old layouts"
```

---

### Task 2: Update CSS

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Change `.stat-grid` to use auto-fit**

Find:
```css
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
```

Replace with:
```css
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
```

- [ ] **Step 2: Remove `.chart-grid` rule**

Find and delete this entire rule (it is no longer used):
```css
/* Charts */
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}
```

- [ ] **Step 3: Commit**

```
git add public/style.css
git commit -m "style: responsive stat-grid, remove unused chart-grid rule"
```

---

### Task 3: Rewrite dashboard section in app.js

**Files:**
- Modify: `public/app.js` (lines 51–321, the `// ── Dashboard` section through end of `pages.dashboard`)

The `renderCalendar` function and everything after it must NOT be touched.

- [ ] **Step 1: Read the current dashboard section**

Read `public/app.js` from line 51 to line 325 to identify the exact old_string boundaries for the Edit tool.

- [ ] **Step 2: Replace the entire dashboard section**

Replace from `// ── Dashboard ─────────────────────────────────────────────────────────────` through the closing `};` of `pages.dashboard` (the line just before `renderCalendar` starts) with:

```javascript
// ── Dashboard ─────────────────────────────────────────────────────────────
let barChart = null, donutChart = null;
let calYear = null, calMonth = null;
let _dashData = null; // cached for edit mode re-renders without API calls

const WIDGET_NAMES = {
  stats:       'Monthly Stats',
  accounts:    'Account Balances',
  bar_chart:   'Income vs Spending',
  donut_chart: 'Spending by Category',
  calendar:    'Calendar',
};

function _widgetHtml(id, summary, accounts) {
  if (id === 'stats') return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Income</div>
        <div class="value">${fmt(summary.income)}</div>
        <div class="sub">This month</div>
      </div>
      <div class="stat-card">
        <div class="label">Spent</div>
        <div class="value">${fmt(summary.spent)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.spent / summary.income * 100) : 0}% of income</div>
      </div>
      <div class="stat-card highlight">
        <div class="label">Remaining</div>
        <div class="value">${fmt(summary.remaining)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.remaining / summary.income * 100) : 0}% left</div>
      </div>
    </div>`;
  if (id === 'accounts') return `
    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">Account Balances</div>
      <div class="stat-grid" style="margin:0">
        ${accounts.map(a => `
          <div class="stat-card" style="border-left:3px solid ${esc(a.colour)}">
            <div class="label">${esc(a.name)}</div>
            <div class="value" style="font-size:20px">${fmt(a.balance)}</div>
            <div class="sub" style="text-transform:capitalize">${esc(a.type)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  if (id === 'bar_chart') return `
    <div class="card">
      <div class="chart-title">Income vs Spending (6 months)</div>
      <canvas id="barChart" height="180"></canvas>
    </div>`;
  if (id === 'donut_chart') return `
    <div class="card">
      <div class="chart-title">Spending by Category</div>
      <canvas id="donutChart" height="180"></canvas>
    </div>`;
  if (id === 'calendar') return `
    <div class="card">
      <div id="calWidget" style="min-height:280px;display:flex;align-items:center;justify-content:center">
        <span style="color:var(--muted)">Loading calendar…</span>
      </div>
    </div>`;
  return '';
}

function _renderDashboard(editMode, editOrder, editHidden, editSizes) {
  if (!_dashData) return;
  const { summary, accounts } = _dashData;

  if (barChart)   { barChart.destroy();   barChart = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }

  const widgetsHtml = editOrder.map(id => {
    const isHidden = editHidden.includes(id);
    const span = editSizes[id] ?? 2;

    if (isHidden) {
      if (!editMode) return '';
      // Ghost slot — always full-width to avoid grid gaps
      return `
        <div class="dash-ghost" data-widget="${id}"
          style="grid-column:span 2;border:1px dashed #333;border-radius:8px;padding:10px 16px;
                 display:flex;align-items:center;justify-content:space-between;opacity:0.45">
          <span style="color:var(--muted);font-size:13px">${WIDGET_NAMES[id] ?? id}</span>
          <button class="dash-restore-btn btn btn-sm"
            data-widget="${id}"
            style="background:#4ade80;color:#111;border:none;border-radius:6px;
                   padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer">
            ＋ Restore
          </button>
        </div>`;
    }

    const inner = _widgetHtml(id, summary, accounts);

    if (!editMode) {
      return `<div data-widget="${id}" style="grid-column:span ${span}">${inner}</div>`;
    }

    // Visible widget in edit mode — wrap with drag bar + resize handle
    return `
      <div class="dash-widget" draggable="true" data-widget="${id}"
        style="position:relative;grid-column:span ${span};border:1px dashed #f7a4a244;
               border-radius:8px;padding-top:30px">
        <div style="position:absolute;top:0;left:0;right:0;height:30px;
                    display:flex;align-items:center;justify-content:space-between;
                    padding:0 10px;background:#1a1a1a;border-radius:8px 8px 0 0;
                    cursor:grab;user-select:none">
          <span style="color:var(--muted);font-size:13px">⠿ ${WIDGET_NAMES[id] ?? id}</span>
          <button class="dash-remove-btn btn btn-sm"
            data-widget="${id}"
            style="background:#ff4444;color:#fff;border:none;border-radius:50%;
                   width:20px;height:20px;font-size:11px;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;padding:0">
            ✕
          </button>
        </div>
        ${inner}
        <div class="dash-resize-handle" data-widget="${id}"
          style="position:absolute;bottom:4px;right:4px;width:14px;height:14px;
                 border-right:2px solid #555;border-bottom:2px solid #555;
                 cursor:se-resize;border-radius:0 0 4px 0"></div>
      </div>`;
  }).join('');

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="color:var(--muted);font-size:13px">${monthName(calMonth)} ${calYear}</span>
        ${editMode
          ? `<button class="btn btn-primary btn-sm" id="dashDone">✓ Done</button>`
          : `<button class="btn btn-ghost btn-sm" id="dashEdit">✏️ Edit</button>`}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${widgetsHtml}
    </div>
  `;

  // Initialise bar chart if visible
  if (!editHidden.includes('bar_chart') && $('barChart')) {
    const trend = summary.monthlyTrend;
    barChart = new Chart($('barChart'), {
      type: 'bar',
      data: {
        labels: trend.map(m => monthName(Number(m.month))),
        datasets: [
          { label: 'Income',   data: trend.map(m => m.income), backgroundColor: '#ffffff44', borderColor: '#ffffff', borderWidth: 1 },
          { label: 'Spending', data: trend.map(m => m.spent),  backgroundColor: '#f7a4a288', borderColor: '#f7a4a2', borderWidth: 1 },
        ],
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#888' } } },
        scales: { x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
                  y: { ticks: { color: '#888', callback: v => '£' + v }, grid: { color: '#2a2a2a' } } } },
    });
  }

  // Initialise donut chart if visible
  if (!editHidden.includes('donut_chart') && $('donutChart')) {
    const catData = summary.byCategory.filter(c => c.total > 0);
    donutChart = new Chart($('donutChart'), {
      type: 'doughnut',
      data: {
        labels: catData.map(c => c.name),
        datasets: [{ data: catData.map(c => c.total), backgroundColor: catData.map(c => c.colour), borderWidth: 0 }],
      },
      options: { responsive: true, cutout: '65%',
        plugins: { legend: { position: 'right', labels: { color: '#888', boxWidth: 12 } } } },
    });
  }

  // Initialise calendar if visible
  if (!editHidden.includes('calendar')) {
    renderCalendar(calYear, calMonth);
  }

  if (!editMode) {
    $('dashEdit')?.addEventListener('click', () => {
      _renderDashboard(true,
        [..._dashData.layout.order],
        [..._dashData.layout.hidden],
        { ..._dashData.layout.sizes });
    });
    return;
  }

  // ── Edit mode wiring ──────────────────────────────────────────────────────

  let dragSrc = null;

  // Drag and drop on visible widgets
  document.querySelectorAll('.dash-widget[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragSrc = e.currentTarget.dataset.widget;
      setTimeout(() => { e.currentTarget.style.opacity = '0.4'; }, 0);
    });
    el.addEventListener('dragend', e => {
      e.currentTarget.style.opacity = '';
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.currentTarget.style.outline = '2px dashed #f7a4a2';
    });
    el.addEventListener('dragleave', e => {
      e.currentTarget.style.outline = '';
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.currentTarget.style.outline = '';
      const dropTarget = e.currentTarget.dataset.widget;
      if (!dragSrc || dragSrc === dropTarget) return;
      const fromIdx = editOrder.indexOf(dragSrc);
      const toIdx   = editOrder.indexOf(dropTarget);
      editOrder.splice(fromIdx, 1);
      editOrder.splice(toIdx, 0, dragSrc);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Drag events on ghost slots (allow drop + visual feedback)
  document.querySelectorAll('.dash-ghost[data-widget]').forEach(el => {
    el.addEventListener('dragover', e => {
      e.preventDefault();
      el.style.outline = '2px dashed #f7a4a2';
    });
    el.addEventListener('dragleave', () => {
      el.style.outline = '';
    });
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.style.outline = '';
      const dropTarget = el.dataset.widget;
      if (!dragSrc || dragSrc === dropTarget) return;
      const fromIdx = editOrder.indexOf(dragSrc);
      const toIdx   = editOrder.indexOf(dropTarget);
      editOrder.splice(fromIdx, 1);
      editOrder.splice(toIdx, 0, dragSrc);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Remove (✕) buttons
  document.querySelectorAll('.dash-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.widget;
      if (!editHidden.includes(id)) editHidden.push(id);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Restore (＋) buttons
  document.querySelectorAll('.dash-restore-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.widget;
      editHidden.splice(editHidden.indexOf(id), 1);
      _renderDashboard(true, editOrder, editHidden, editSizes);
    });
  });

  // Resize handles — drag right to expand, drag left to shrink
  document.querySelectorAll('.dash-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const widgetId = handle.dataset.widget;
      const startX = e.clientX;

      const onMove = () => {};

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const delta = ev.clientX - startX;
        const current = editSizes[widgetId] ?? 2;
        if (delta > 40 && current === 1) editSizes[widgetId] = 2;
        else if (delta < -40 && current === 2) editSizes[widgetId] = 1;
        _renderDashboard(true, editOrder, editHidden, editSizes);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // Done button — save and exit edit mode
  $('dashDone')?.addEventListener('click', async () => {
    try {
      await api('/settings/dashboard', { method: 'POST', body: { order: editOrder, hidden: editHidden, sizes: editSizes } });
      _dashData.layout = { order: [...editOrder], hidden: [...editHidden], sizes: { ...editSizes } };
      _renderDashboard(false, [...editOrder], [...editHidden], { ...editSizes });
    } catch {
      alert('Failed to save layout. Please try again.');
    }
  });
}

pages.dashboard = async function () {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  if (!calYear) { calYear = year; calMonth = month; }

  invalidateAccounts();
  try {
    const [summary, accounts, layout] = await Promise.all([
      api(`/summary/${year}/${month}`),
      getAccounts(),
      api('/settings/dashboard'),
    ]);
    _dashData = { summary, accounts, layout };
    _renderDashboard(false, [...layout.order], [...layout.hidden], { ...layout.sizes });
  } catch {
    main().innerHTML = `<div class="card" style="color:var(--muted);padding:24px">Failed to load dashboard. Please refresh.</div>`;
  }
};
```

- [ ] **Step 3: Check for syntax errors**

```
node --check public/app.js
```

Expected: no output.

- [ ] **Step 4: Verify in browser — normal mode**

Open http://localhost:3000 and go to Dashboard. Verify:
- Both chart widgets appear side-by-side (each spanning 1 column)
- Stats, Accounts, Calendar span the full width
- ✏️ Edit button is present

- [ ] **Step 5: Verify edit mode — resize handle**

Click ✏️ Edit. Verify:
- Each visible widget has a `⌟` handle at its bottom-right corner
- Drag the handle on "Income vs Spending" to the right → it expands to full width
- Drag the handle on a full-width widget to the left → it shrinks to half width
- Both chart widgets can be made full-width independently

- [ ] **Step 6: Verify edit mode — reorder, hide, restore still work**

While in edit mode:
- Drag a widget by its top bar onto another → they reorder
- Click ✕ on a widget → it becomes a ghost slot (full-width placeholder)
- Click ＋ Restore on the ghost → it comes back

- [ ] **Step 7: Verify save persists**

1. Resize "Income vs Spending" to full-width
2. Click ✓ Done
3. Navigate away and back to Dashboard
4. Confirm "Income vs Spending" is still full-width

- [ ] **Step 8: Commit**

```
git add public/app.js
git commit -m "feat: dashboard grid layout, split bar_chart/donut_chart, resize handles"
```

---

### Task 4: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Change version to `1.4.1`**

Find `"version": "1.4.0"` and change it to `"version": "1.4.1"`.

- [ ] **Step 2: Commit**

```
git add package.json
git commit -m "chore: bump version to 1.4.1"
```
