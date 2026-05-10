# Customisable Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an edit mode to the FinTrack dashboard that lets users drag widgets to reorder them and hide/restore them, with the layout persisted server-side.

**Architecture:** New `settings` SQLite table stores layout JSON under key `dashboard_layout`; `routes/settings.js` exposes GET/POST for that key; `pages.dashboard` is refactored into a render helper `_renderDashboard(editMode, editOrder, editHidden)` that re-renders without API calls during edit interactions, using the HTML5 Drag and Drop API.

**Tech Stack:** Node.js, Express 4, better-sqlite3 (synchronous), vanilla JS SPA, HTML5 DnD API (no new libraries).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `db.js` | Modify | Add `settings` table DDL |
| `routes/settings.js` | Create | GET + POST for `dashboard_layout` |
| `server.js` | Modify | Mount `/api/settings` |
| `public/app.js` | Modify | Refactor dashboard section with edit mode |
| `package.json` | Modify | Bump version to 1.4.0 |

---

### Task 1: Database — add settings table

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add the settings table DDL to `db.js`**

Read `db.js` to find the last `db.exec(...)` block (the one that creates the `transfers` table), then add this new block immediately after it:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
```

- [ ] **Step 2: Verify the table is created**

Restart the server, then run:

```
node -e "const db = require('./db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='settings'\").get());"
```

Expected: `{ name: 'settings' }`

- [ ] **Step 3: Commit**

```
git add db.js
git commit -m "feat: add settings table"
```

---

### Task 2: Settings API

**Files:**
- Create: `routes/settings.js`
- Modify: `server.js`

- [ ] **Step 1: Create `routes/settings.js`**

```javascript
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
```

- [ ] **Step 2: Mount in `server.js`**

Add the settings route before the `health` line:

```javascript
app.use('/api/settings',          require('./routes/settings'));
```

The full route list in `server.js` should end with:
```javascript
app.use('/api/update',            require('./routes/update'));
app.use('/api/settings',          require('./routes/settings'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
```

- [ ] **Step 3: Verify GET returns default**

```
curl -s http://localhost:3000/api/settings/dashboard
```

Expected: `{"order":["stats","accounts","charts","calendar"],"hidden":[]}`

- [ ] **Step 4: Verify POST saves and GET returns saved layout**

```
curl -s -X POST http://localhost:3000/api/settings/dashboard -H "Content-Type: application/json" -d "{\"order\":[\"accounts\",\"stats\",\"charts\",\"calendar\"],\"hidden\":[\"calendar\"]}"
```

Expected: `{"ok":true}`

Then:
```
curl -s http://localhost:3000/api/settings/dashboard
```

Expected: `{"order":["accounts","stats","charts","calendar"],"hidden":["calendar"]}`

- [ ] **Step 5: Verify validation rejects bad payload**

```
curl -s -X POST http://localhost:3000/api/settings/dashboard -H "Content-Type: application/json" -d "{\"order\":[\"stats\"],\"hidden\":[]}"
```

Expected: `{"error":"order must contain exactly 4 widget IDs"}`

- [ ] **Step 6: Reset layout back to default for clean testing**

```
curl -s -X POST http://localhost:3000/api/settings/dashboard -H "Content-Type: application/json" -d "{\"order\":[\"stats\",\"accounts\",\"charts\",\"calendar\"],\"hidden\":[]}"
```

- [ ] **Step 7: Commit**

```
git add routes/settings.js server.js
git commit -m "feat: settings API — GET/POST dashboard layout"
```

---

### Task 3: Dashboard rewrite — edit mode

**Files:**
- Modify: `public/app.js` (lines 51–145, the `// ── Dashboard` section through the end of `pages.dashboard`)

This is the most complex task. Read the current file carefully before editing.

The `renderCalendar` function starting around line 147 is **not changed** — leave it as-is.

- [ ] **Step 1: Read the current dashboard section**

Read `public/app.js` from line 51 to line 145 to understand what is being replaced.

- [ ] **Step 2: Replace the dashboard section**

Replace everything from the `// ── Dashboard ──` comment line down to and including the closing `};` of `pages.dashboard` (the line `await renderCalendar(calYear, calMonth);` and its closing `};`) with the following.

**Do NOT touch `renderCalendar` or anything after it.**

```javascript
// ── Dashboard ─────────────────────────────────────────────────────────────
let barChart = null, donutChart = null;
let calYear = null, calMonth = null;
let _dashData = null; // cached for edit mode re-renders without API calls

const WIDGET_NAMES = {
  stats:    'Monthly Stats',
  accounts: 'Account Balances',
  charts:   'Charts',
  calendar: 'Calendar',
};

function _widgetHtml(id, summary, accounts) {
  if (id === 'stats') return `
    <div class="stat-grid" style="margin-bottom:24px">
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
    <div class="card" style="margin-bottom:24px">
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
  if (id === 'charts') return `
    <div class="chart-grid" style="margin-bottom:24px">
      <div class="card">
        <div class="chart-title">Income vs Spending (6 months)</div>
        <canvas id="barChart" height="180"></canvas>
      </div>
      <div class="card">
        <div class="chart-title">Spending by Category</div>
        <canvas id="donutChart" height="180"></canvas>
      </div>
    </div>`;
  if (id === 'calendar') return `
    <div class="card" style="margin-bottom:24px">
      <div id="calWidget" style="min-height:280px;display:flex;align-items:center;justify-content:center">
        <span style="color:var(--muted)">Loading calendar…</span>
      </div>
    </div>`;
  return '';
}

function _renderDashboard(editMode, editOrder, editHidden) {
  const { summary, accounts } = _dashData;
  const year = calYear, month = calMonth;

  if (barChart)   { barChart.destroy();   barChart = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }

  const widgetsHtml = editOrder.map(id => {
    const isHidden = editHidden.includes(id);

    if (isHidden) {
      if (!editMode) return '';
      // Ghost slot
      return `
        <div class="dash-ghost" data-widget="${id}"
          style="border:1px dashed #333;border-radius:8px;padding:10px 16px;margin-bottom:24px;
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

    if (!editMode) return inner;

    // Visible widget in edit mode — wrap with drag bar
    return `
      <div class="dash-widget" draggable="true" data-widget="${id}"
        style="position:relative;margin-bottom:24px;border:1px dashed #f7a4a244;
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
      </div>`;
  }).join('');

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="color:var(--muted);font-size:13px">${monthName(month)} ${year}</span>
        ${editMode
          ? `<button class="btn btn-primary btn-sm" id="dashDone">✓ Done</button>`
          : `<button class="btn btn-ghost btn-sm" id="dashEdit">✏️ Edit</button>`}
      </div>
    </div>
    ${widgetsHtml}
  `;

  // Initialise charts if visible
  if (!editHidden.includes('charts') && $('barChart')) {
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
      _renderDashboard(true, [..._dashData.layout.order], [..._dashData.layout.hidden]);
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
      _renderDashboard(true, editOrder, editHidden);
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
      _renderDashboard(true, editOrder, editHidden);
    });
  });

  // Remove (✕) buttons
  document.querySelectorAll('.dash-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.widget;
      if (!editHidden.includes(id)) editHidden.push(id);
      _renderDashboard(true, editOrder, editHidden);
    });
  });

  // Restore (＋) buttons
  document.querySelectorAll('.dash-restore-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.widget;
      editHidden.splice(editHidden.indexOf(id), 1);
      _renderDashboard(true, editOrder, editHidden);
    });
  });

  // Done button — save and exit edit mode
  $('dashDone')?.addEventListener('click', async () => {
    await api('/settings/dashboard', { method: 'POST', body: { order: editOrder, hidden: editHidden } });
    _dashData.layout = { order: [...editOrder], hidden: [...editHidden] };
    _renderDashboard(false, [...editOrder], [...editHidden]);
  });
}

pages.dashboard = async function () {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  if (!calYear) { calYear = year; calMonth = month; }

  invalidateAccounts();
  const [summary, accounts, layout] = await Promise.all([
    api(`/summary/${year}/${month}`),
    getAccounts(),
    api('/settings/dashboard'),
  ]);
  _dashData = { summary, accounts, layout };
  _renderDashboard(false, [...layout.order], [...layout.hidden]);
};
```

- [ ] **Step 3: Verify the file compiles — check for syntax errors**

In the project directory run:
```
node --check public/app.js
```

Expected: no output (silent = OK). If errors appear, fix them before continuing.

- [ ] **Step 4: Verify in browser — normal mode**

Open http://localhost:3000 and navigate to Dashboard. Verify:
- Dashboard renders all 4 widgets in the default order
- An ✏️ Edit button appears in the top-right of the header

- [ ] **Step 5: Verify in browser — enter edit mode**

Click ✏️ Edit. Verify:
- The button changes to ✓ Done
- Each visible widget has a top bar with a `⠿` handle and `✕` button
- No ghost slots (all widgets visible by default)

- [ ] **Step 6: Verify remove and restore**

Click `✕` on one widget (e.g. Calendar). Verify:
- The widget collapses to a faded ghost slot with a `＋ Restore` button
- Click `＋ Restore` — the widget comes back in its original position

- [ ] **Step 7: Verify drag to reorder**

Drag a widget by its top bar and drop it onto another widget. Verify:
- The widgets swap/reorder
- The charts still render correctly after reorder

- [ ] **Step 8: Verify save persists**

1. Remove the Calendar widget and move Accounts to first position
2. Click ✓ Done
3. Navigate to another page (e.g. Spending) then back to Dashboard
4. Verify the layout is restored correctly (Calendar hidden, Accounts first)

- [ ] **Step 9: Commit**

```
git add public/app.js
git commit -m "feat: customisable dashboard — edit mode, drag-and-drop, show/hide"
```

---

### Task 4: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to `1.4.0`**

Change `"version": "1.3.0"` to `"version": "1.4.0"`.

- [ ] **Step 2: Commit**

```
git add package.json
git commit -m "chore: bump version to 1.4.0"
```
