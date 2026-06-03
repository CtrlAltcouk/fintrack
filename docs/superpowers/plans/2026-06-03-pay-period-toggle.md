# Pay Period Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle that switches the entire dashboard (stats, bar chart, donut, calendar) between calendar-month view and pay-period view driven by a user-chosen primary income schedule.

**Architecture:** Two new settings keys (`dashboard_mode`, `primary_schedule_id`) stored in the existing `settings` table. A new `GET /api/summary/by-range` endpoint handles arbitrary date ranges. Client-side `computePeriods()` (in `public/period-utils.js`) calculates period boundaries for weekly, four-weekly, and monthly schedules. The dashboard fires 6 parallel range calls to build the trend chart. A pill toggle in the dashboard header and a selector in Settings → Personalisation both persist the preference.

**Tech Stack:** Node.js/Express, better-sqlite3, Vanilla JS SPA, Chart.js 4 (CDN)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `public/period-utils.js` | `addDays` + `computePeriods` — dual-env (browser + Node require) |
| Create | `routes/summary-range.js` | `GET /api/summary/by-range?from=&to=` |
| Create | `tests/period.test.js` | Unit tests for `computePeriods` |
| Create | `tests/summary-range.test.js` | Unit tests for `_parseDateRange` |
| Modify | `routes/settings.js` | Add `GET`+`POST /api/settings/pay-period`, export `_parsePayPeriodBody` |
| Modify | `server.js` | Mount `summary-range` before `summary` |
| Modify | `public/index.html` | Add `<script src="period-utils.js">` before `app.js` |
| Modify | `public/app.js` | 6 targeted edits — state, dashboard fetch, render, settings tab, handlers, logout |
| Modify | `package.json` | Bump version to `1.6.0` |

---

## Task 1: Create `public/period-utils.js`

**Files:**
- Create: `public/period-utils.js`

- [ ] **Step 1: Create the file**

```javascript
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

// Returns array of {from, to, label} periods, newest first.
// todayOverride: optional YYYY-MM-DD string for testing (omit in production).
function computePeriods(schedule, count, todayOverride) {
  count = count || 6;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const todayStr  = todayOverride || new Date().toISOString().split('T')[0];
  const todayDate = new Date(todayStr + 'T00:00:00Z');

  function fmtDate(ds) {
    const d = new Date(ds + 'T00:00:00Z');
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  function mkLabel(from, to) { return `${fmtDate(from)} – ${fmtDate(to)}`; }

  const periods = [];

  if (schedule.frequency === 'monthly') {
    const dom = schedule.day_of_month;
    let sy = todayDate.getUTCFullYear(), sm = todayDate.getUTCMonth();
    if (todayDate.getUTCDate() < dom) {
      sm -= 1;
      if (sm < 0) { sm = 11; sy -= 1; }
    }
    for (let i = 0; i < count; i++) {
      let py = sy, pm = sm - i;
      while (pm < 0) { pm += 12; py -= 1; }
      const daysInPm  = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
      const startDay  = Math.min(dom, daysInPm);
      const from      = `${py}-${String(pm + 1).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`;
      let ey = py, em = pm + 1;
      if (em > 11) { em -= 12; ey += 1; }
      const daysInEm = new Date(Date.UTC(ey, em + 1, 0)).getUTCDate();
      const endDay   = Math.min(dom, daysInEm) - 1;
      let to;
      if (endDay < 1) {
        const last = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
        to = `${py}-${String(pm + 1).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
      } else {
        to = `${ey}-${String(em + 1).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;
      }
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  } else if (schedule.frequency === 'four_weekly') {
    let cur  = schedule.anchor_date;
    let next = addDays(cur, 28);
    while (next <= todayStr) { cur = next; next = addDays(next, 28); }
    for (let i = 0; i < count; i++) {
      const from = addDays(cur, -28 * i);
      const to   = addDays(from, 27);
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  } else if (schedule.frequency === 'weekly') {
    const anchorDow   = new Date(schedule.anchor_date + 'T00:00:00Z').getUTCDay();
    const todayDow    = todayDate.getUTCDay();
    const daysBack    = (todayDow - anchorDow + 7) % 7;
    const curStart    = addDays(todayStr, -daysBack);
    for (let i = 0; i < count; i++) {
      const from = addDays(curStart, -7 * i);
      const to   = addDays(from, 6);
      periods.push({ from, to, label: mkLabel(from, to) });
    }
  }

  return periods;
}

if (typeof module !== 'undefined') module.exports = { computePeriods };
```

- [ ] **Step 2: Verify the file loads in Node**

```bash
node -e "const {computePeriods}=require('./public/period-utils');console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add public/period-utils.js
git commit -m "feat: add computePeriods helper for pay period boundary calculation"
```

---

## Task 2: Write and pass `tests/period.test.js`

**Files:**
- Create: `tests/period.test.js`

- [ ] **Step 1: Create the test file**

```javascript
// tests/period.test.js
const assert = require('assert');
const { computePeriods } = require('../public/period-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// ── Monthly ────────────────────────────────────────────────────────────────
const mSched = { frequency: 'monthly', day_of_month: 25 };

test('monthly: period spans pay-day to day-before-next pay-day', () => {
  const [cur] = computePeriods(mSched, 1, '2026-06-10');
  assert.strictEqual(cur.from, '2026-05-25');
  assert.strictEqual(cur.to,   '2026-06-24');
});

test('monthly: new period starts on pay-day itself', () => {
  const [cur] = computePeriods(mSched, 1, '2026-06-25');
  assert.strictEqual(cur.from, '2026-06-25');
  assert.strictEqual(cur.to,   '2026-07-24');
});

test('monthly: clamps dom=31 in February', () => {
  const s = { frequency: 'monthly', day_of_month: 31 };
  const [cur] = computePeriods(s, 1, '2026-03-10');
  assert.strictEqual(cur.from, '2026-01-31');
  assert.strictEqual(cur.to,   '2026-02-27');
});

test('monthly: dom=1 period ends on last day of same month', () => {
  const s = { frequency: 'monthly', day_of_month: 1 };
  const [cur] = computePeriods(s, 1, '2026-06-10');
  assert.strictEqual(cur.from, '2026-06-01');
  assert.strictEqual(cur.to,   '2026-06-30');
});

test('monthly: returns 6 periods newest first', () => {
  const ps = computePeriods(mSched, 6, '2026-06-10');
  assert.strictEqual(ps.length, 6);
  assert.strictEqual(ps[0].from, '2026-05-25');
  assert.strictEqual(ps[5].from, '2025-12-25');
});

test('monthly: label formatted correctly', () => {
  const [cur] = computePeriods(mSched, 1, '2026-06-10');
  assert.strictEqual(cur.label, '25 May – 24 Jun');
});

// ── Four-weekly ────────────────────────────────────────────────────────────
const fwSched = { frequency: 'four_weekly', anchor_date: '2026-05-02' };

test('four_weekly: finds current 28-day period', () => {
  const [cur] = computePeriods(fwSched, 1, '2026-06-10');
  assert.strictEqual(cur.from, '2026-05-30');
  assert.strictEqual(cur.to,   '2026-06-25');
});

test('four_weekly: period starts today when today is a step date', () => {
  const [cur] = computePeriods(fwSched, 1, '2026-05-30');
  assert.strictEqual(cur.from, '2026-05-30');
  assert.strictEqual(cur.to,   '2026-06-25');
});

test('four_weekly: period starts on anchor when today equals anchor', () => {
  const [cur] = computePeriods(fwSched, 1, '2026-05-02');
  assert.strictEqual(cur.from, '2026-05-02');
  assert.strictEqual(cur.to,   '2026-05-28');
});

// ── Weekly ─────────────────────────────────────────────────────────────────
const wSched = { frequency: 'weekly', anchor_date: '2026-05-12' }; // Tuesday

test('weekly: finds most recent anchor weekday', () => {
  const [cur] = computePeriods(wSched, 1, '2026-06-10'); // Wednesday
  assert.strictEqual(cur.from, '2026-06-09'); // Tuesday
  assert.strictEqual(cur.to,   '2026-06-15');
});

test('weekly: period starts today when today is anchor weekday', () => {
  const [cur] = computePeriods(wSched, 1, '2026-06-09'); // Tuesday
  assert.strictEqual(cur.from, '2026-06-09');
  assert.strictEqual(cur.to,   '2026-06-15');
});

test('weekly: returns 6 periods newest first', () => {
  const ps = computePeriods(wSched, 6, '2026-06-10');
  assert.strictEqual(ps.length, 6);
  assert.ok(ps[0].from > ps[5].from);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the tests**

```bash
node tests/period.test.js
```
Expected: `13 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add tests/period.test.js
git commit -m "test: add computePeriods unit tests"
```

---

## Task 3: Create `routes/summary-range.js`

**Files:**
- Create: `routes/summary-range.js`
- Create: `tests/summary-range.test.js`

- [ ] **Step 1: Create the route file**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _parseDateRange(from, to) {
  if (!from || !to)                              return 'from and to are required (YYYY-MM-DD)';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return 'from and to are required (YYYY-MM-DD)';
  if (from > to)                                 return 'from must be before or equal to to';
  return null;
}

router.get('/by-range', (req, res) => {
  const err = _parseDateRange(req.query.from, req.query.to);
  if (err) return res.status(400).json({ error: err });

  const { from, to } = req.query;
  const uid = req.userId;

  const incomeRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE user_id = ? AND date >= ? AND date <= ?`
  ).get(uid, from, to);

  const spentRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?`
  ).get(uid, from, to);

  const byCategory = db.prepare(
    `SELECT c.name, c.colour, COALESCE(SUM(t.amount), 0) as total
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = ?
       AND t.date >= ? AND t.date <= ?
     WHERE c.user_id = ?
     GROUP BY c.id ORDER BY total DESC`
  ).all(uid, from, to, uid);

  res.json({
    income:     incomeRow.total,
    spent:      spentRow.total,
    remaining:  incomeRow.total - spentRow.total,
    byCategory,
  });
});

module.exports = router;
module.exports._parseDateRange = _parseDateRange;
```

- [ ] **Step 2: Create the test file**

```javascript
// tests/summary-range.test.js
const assert = require('assert');
const { _parseDateRange } = require('../routes/summary-range');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('returns null for valid range', () => {
  assert.strictEqual(_parseDateRange('2026-01-01', '2026-01-31'), null);
});

test('returns null when from equals to', () => {
  assert.strictEqual(_parseDateRange('2026-06-01', '2026-06-01'), null);
});

test('error when from missing', () => {
  assert.ok(_parseDateRange(undefined, '2026-06-30'));
});

test('error when to missing', () => {
  assert.ok(_parseDateRange('2026-06-01', undefined));
});

test('error when from has wrong format', () => {
  assert.ok(_parseDateRange('01-06-2026', '2026-06-30'));
});

test('error when to has wrong format', () => {
  assert.ok(_parseDateRange('2026-06-01', '30/06/2026'));
});

test('error when from is after to', () => {
  assert.ok(_parseDateRange('2026-06-30', '2026-06-01'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Run the tests**

```bash
node tests/summary-range.test.js
```
Expected: `7 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add routes/summary-range.js tests/summary-range.test.js
git commit -m "feat: add summary by-range API endpoint"
```

---

## Task 4: Add pay-period routes to `routes/settings.js`

**Files:**
- Modify: `routes/settings.js`

- [ ] **Step 1: Add `_parsePayPeriodBody` helper and two new routes**

At the end of `routes/settings.js`, directly before `module.exports = router;`, insert:

```javascript
function _parsePayPeriodBody(body) {
  const { mode, primary_schedule_id: pid } = body || {};
  if (mode !== undefined && !['monthly', 'pay_period'].includes(mode))
    return 'mode must be "monthly" or "pay_period"';
  if (pid !== undefined && pid !== null) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n < 1)
      return 'primary_schedule_id must be a positive integer or null';
  }
  return null;
}

// GET /api/settings/pay-period
router.get('/pay-period', (req, res) => {
  const modeRow  = stmtGet.get(req.userId, 'dashboard_mode');
  const schedRow = stmtGet.get(req.userId, 'primary_schedule_id');
  res.json({
    mode:                modeRow  ? modeRow.value  : 'monthly',
    primary_schedule_id: schedRow && schedRow.value ? Number(schedRow.value) : null,
  });
});

// POST /api/settings/pay-period
router.post('/pay-period', (req, res) => {
  const err = _parsePayPeriodBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const { mode, primary_schedule_id: pid } = req.body;
  if (mode !== undefined) stmtUpsert.run(req.userId, 'dashboard_mode', mode);
  if (pid  !== undefined) stmtUpsert.run(req.userId, 'primary_schedule_id', pid === null ? null : String(pid));
  res.json({ ok: true });
});
```

Then update the two existing export lines at the very bottom of the file:

```javascript
module.exports = router;
module.exports._migrate     = _migrate;
module.exports._parseTheme  = parseTheme;
module.exports._parsePayPeriodBody = _parsePayPeriodBody;
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "require('./routes/settings'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Quick smoke test of the new export**

```bash
node -e "const {_parsePayPeriodBody}=require('./routes/settings'); console.log(_parsePayPeriodBody({mode:'pay_period'})); console.log(_parsePayPeriodBody({mode:'bad'}))"
```
Expected:
```
null
mode must be "monthly" or "pay_period"
```

- [ ] **Step 4: Commit**

```bash
git add routes/settings.js
git commit -m "feat: add GET/POST /api/settings/pay-period routes"
```

---

## Task 5: Mount new route + update `index.html`

**Files:**
- Modify: `server.js`
- Modify: `public/index.html`

- [ ] **Step 1: Mount `summary-range` in `server.js`**

In `server.js`, find the line:
```javascript
app.use('/api/summary',          requireAuth, require('./routes/summary'));
```

Replace it with:
```javascript
app.use('/api/summary',          requireAuth, require('./routes/summary-range'));
app.use('/api/summary',          requireAuth, require('./routes/summary'));
```

- [ ] **Step 2: Verify the server starts**

```bash
node server.js
```
Expected: `FinTrack running on http://localhost:3000`  
Press `Ctrl+C` to stop.

- [ ] **Step 3: Add `period-utils.js` script to `index.html`**

In `public/index.html`, find the last two lines before `</body>`:
```html
  <script src="app.js"></script>
</body>
```

Replace with:
```html
  <script src="period-utils.js"></script>
  <script src="app.js"></script>
</body>
```

- [ ] **Step 4: Commit**

```bash
git add server.js public/index.html
git commit -m "feat: mount summary-range route and load period-utils in browser"
```

---

## Task 6: `app.js` — dashboard data fetch

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `_payPeriodSettings` state variable**

Find the line:
```javascript
let _dashData = null; // cached for edit mode re-renders without API calls
```

Add immediately after it:
```javascript
let _payPeriodSettings = null;
```

- [ ] **Step 2: Replace `pages.dashboard`**

Find and replace the entire `pages.dashboard` function:

```javascript
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

Replace with:

```javascript
pages.dashboard = async function () {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  if (!calYear) { calYear = year; calMonth = month; }

  invalidateAccounts();
  try {
    const [summary, accounts, layout, ppSettings, schedules] = await Promise.all([
      api(`/summary/${year}/${month}`),
      getAccounts(),
      api('/settings/dashboard'),
      api('/settings/pay-period'),
      api('/income/schedules'),
    ]);
    _payPeriodSettings = ppSettings;

    let paySchedule = null;
    if (ppSettings.mode === 'pay_period' && ppSettings.primary_schedule_id) {
      paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active);
    }

    if (paySchedule) {
      const periods = computePeriods(paySchedule, 6);
      const periodSummaries = await Promise.all(
        periods.map(p => api(`/summary/by-range?from=${p.from}&to=${p.to}`))
      );
      _dashData = { summary: periodSummaries[0], periods, periodSummaries, accounts, layout, payPeriodMode: true, noPrimarySchedule: false };
    } else {
      _dashData = { summary, accounts, layout, payPeriodMode: false, noPrimarySchedule: ppSettings.mode === 'pay_period' };
    }

    _renderDashboard(false, [...layout.order], [...layout.hidden], { ...layout.sizes });
  } catch {
    main().innerHTML = `<div class="card" style="color:var(--muted);padding:24px">Failed to load dashboard. Please refresh.</div>`;
  }
};
```

- [ ] **Step 3: Add `window.setDashMode`**

Directly after the closing `};` of `pages.dashboard`, add:

```javascript
window.setDashMode = async function(mode) {
  await api('/settings/pay-period', { method: 'POST', body: { mode } });
  pages.dashboard();
};
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: dashboard fetches pay-period settings and builds period summaries"
```

---

## Task 7: `app.js` — render changes (header, widgets, charts, calendar)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Update the `stats` case in `_widgetHtml`**

Find:
```javascript
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
```

Replace with:
```javascript
  if (id === 'stats') {
    const isPP = !!_dashData?.payPeriodMode;
    const periodLabel = isPP && _dashData?.periods ? _dashData.periods[0].label : '';
    return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Income</div>
        <div class="value">${fmt(summary.income)}</div>
        <div class="sub">${isPP ? periodLabel : 'This month'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Spent</div>
        <div class="value">${fmt(summary.spent)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.spent / summary.income * 100) : 0}% of income</div>
      </div>
      <div class="stat-card highlight">
        <div class="label">Remaining</div>
        <div class="value">${fmt(summary.remaining)}</div>
        <div class="sub">${summary.income > 0 ? Math.round(summary.remaining / summary.income * 100) : 0}% left${isPP ? ' · ' + periodLabel : ''}</div>
      </div>
    </div>`;
  }
```

- [ ] **Step 2: Update the `bar_chart` case in `_widgetHtml`**

Find:
```javascript
  if (id === 'bar_chart') return `
    <div class="card">
      <div class="chart-title">Income vs Spending (6 months)</div>
      <canvas id="barChart" height="180"></canvas>
    </div>`;
```

Replace with:
```javascript
  if (id === 'bar_chart') return `
    <div class="card">
      <div class="chart-title">${_dashData?.payPeriodMode ? 'Income vs Spending (6 pay periods)' : 'Income vs Spending (6 months)'}</div>
      <canvas id="barChart" height="180"></canvas>
    </div>`;
```

- [ ] **Step 3: Update `_renderDashboard` header HTML**

Find:
```javascript
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
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px">
      ${widgetsHtml}
    </div>
  `;
```

Replace with:
```javascript
  const isPP = !!_dashData?.payPeriodMode;
  const headerLabel = isPP && _dashData.periods
    ? _dashData.periods[0].label
    : `${monthName(calMonth)} ${calYear}`;
  const modeToggle = !editMode ? `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:20px;padding:2px;display:flex;gap:2px">
      <button style="border:none;border-radius:16px;padding:3px 12px;font-size:11px;font-weight:700;cursor:pointer;background:${!isPP ? 'var(--accent)' : 'transparent'};color:${!isPP ? '#111' : 'var(--muted)'}" onclick="window.setDashMode('monthly')">Monthly</button>
      <button style="border:none;border-radius:16px;padding:3px 12px;font-size:11px;font-weight:700;cursor:pointer;background:${isPP ? 'var(--accent)' : 'transparent'};color:${isPP ? '#111' : 'var(--muted)'}" onclick="window.setDashMode('pay_period')">Pay Period</button>
    </div>` : '';
  const noPrimaryBanner = _dashData.noPrimarySchedule ? `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;font-size:13px">
      <span style="color:var(--muted)">Pay Period mode is active but no primary schedule is set.</span>
      <button class="btn btn-ghost btn-sm" onclick="pages.settings('personalisation')">Configure in Settings →</button>
    </div>` : '';

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="color:var(--muted);font-size:13px">${headerLabel}</span>
        ${modeToggle}
        ${editMode
          ? `<button class="btn btn-primary btn-sm" id="dashDone">✓ Done</button>`
          : `<button class="btn btn-ghost btn-sm" id="dashEdit">✏️ Edit</button>`}
      </div>
    </div>
    ${noPrimaryBanner}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px">
      ${widgetsHtml}
    </div>
  `;
```

- [ ] **Step 4: Update bar chart initialisation in `_renderDashboard`**

Find:
```javascript
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
```

Replace with:
```javascript
  // Initialise bar chart if visible
  if (!editHidden.includes('bar_chart') && $('barChart')) {
    if (_dashData.payPeriodMode && _dashData.periodSummaries) {
      const chartPeriods   = [..._dashData.periods].reverse();
      const chartSummaries = [..._dashData.periodSummaries].reverse();
      barChart = new Chart($('barChart'), {
        type: 'bar',
        data: {
          labels: chartPeriods.map(p => p.label.split(' – ')[0]),
          datasets: [
            { label: 'Income',   data: chartSummaries.map(s => s.income), backgroundColor: '#ffffff44', borderColor: '#ffffff', borderWidth: 1 },
            { label: 'Spending', data: chartSummaries.map(s => s.spent),  backgroundColor: '#f7a4a288', borderColor: '#f7a4a2', borderWidth: 1 },
          ],
        },
        options: { responsive: true, plugins: { legend: { labels: { color: '#888' } } },
          scales: { x: { ticks: { color: '#888' }, grid: { color: '#2a2a2a' } },
                    y: { ticks: { color: '#888', callback: v => '£' + v }, grid: { color: '#2a2a2a' } } } },
      });
    } else {
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
  }
```

- [ ] **Step 5: Update calendar initialisation in `_renderDashboard`**

Find:
```javascript
  // Initialise calendar if visible
  if (!editHidden.includes('calendar')) {
    renderCalendar(calYear, calMonth);
  }
```

Replace with:
```javascript
  // Initialise calendar if visible
  if (!editHidden.includes('calendar')) {
    if (_dashData.payPeriodMode && _dashData.periods) {
      const ps = new Date(_dashData.periods[0].from + 'T00:00:00Z');
      renderCalendar(ps.getUTCFullYear(), ps.getUTCMonth() + 1);
    } else {
      renderCalendar(calYear, calMonth);
    }
  }
```

- [ ] **Step 6: Start the server and manually verify the dashboard**

```bash
node server.js
```

Open `http://localhost:3000`. Check:
- Dashboard loads normally in Monthly mode (no regression).
- Header shows "Monthly | Pay Period" toggle pill next to the month label.
- Clicking "Pay Period" while no primary schedule is set shows the "no primary schedule" banner.
- Monthly stats, charts, and calendar are unaffected.

Stop the server (`Ctrl+C`).

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: dashboard render — pay period header toggle, stat labels, bar chart, calendar"
```

---

## Task 8: `app.js` — Settings → Personalisation tab

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `ppSettings` and `schedules` to `pages.settings` fetch**

Find:
```javascript
  const [cats, version, allUsers] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '', version: '?' })),
    currentUser?.is_admin ? api('/users') : Promise.resolve([]),
  ]);
```

Replace with:
```javascript
  const [cats, version, allUsers, ppSettings, schedules] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '', version: '?' })),
    currentUser?.is_admin ? api('/users') : Promise.resolve([]),
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);
```

- [ ] **Step 2: Add DASHBOARD VIEW card to `personalisationHTML`**

Find the end of `personalisationHTML` (the reset button div):
```javascript
    <div style="display:flex;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="window.resetTheme()">Reset to defaults</button>
    </div>`;
```

Replace with:
```javascript
    <div style="display:flex;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="window.resetTheme()">Reset to defaults</button>
    </div>
    <div class="card" style="margin-top:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.5px;margin-bottom:14px">DASHBOARD VIEW</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:13px;font-weight:500">View mode</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Controls how stats, charts and calendar are calculated</div>
        </div>
        <div style="display:flex;background:var(--border);border-radius:20px;padding:3px;gap:3px">
          <button class="btn btn-sm ${ppSettings.mode !== 'pay_period' ? 'btn-primary' : 'btn-ghost'}" onclick="window.setDashModeSettings('monthly')">Monthly</button>
          <button class="btn btn-sm ${ppSettings.mode === 'pay_period' ? 'btn-primary' : 'btn-ghost'}" onclick="window.setDashModeSettings('pay_period')">Pay Period</button>
        </div>
      </div>
      <div>
        <div style="font-size:13px;font-weight:500;margin-bottom:3px">Primary pay schedule</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Defines the period boundaries in Pay Period mode</div>
        ${schedules.filter(s => s.active).length === 0
          ? `<p style="font-size:12px;color:var(--muted)">No active recurring income schedules. <button class="btn btn-ghost btn-sm" onclick="navigate('income')">Set up in Income →</button></p>`
          : `<select onchange="window.setPrimarySchedule(this.value)" style="width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:6px;font-size:13px">
              <option value="">— None selected —</option>
              ${schedules.filter(s => s.active).map(s => {
                const fl = s.frequency === 'monthly'
                  ? 'monthly · day ' + s.day_of_month
                  : s.frequency === 'weekly'
                  ? 'weekly · from ' + s.anchor_date
                  : 'every 4 weeks · from ' + s.anchor_date;
                return '<option value="' + s.id + '"' + (ppSettings.primary_schedule_id === s.id ? ' selected' : '') + '>' + esc(s.name) + ' · ' + fl + ' · ' + fmt(s.amount) + '</option>';
              }).join('')}
            </select>`}
      </div>
    </div>`;
```

- [ ] **Step 3: Add settings handlers**

Find the existing `window.resetTheme` function. Directly after its closing `};`, add:

```javascript
window.setDashModeSettings = async function(mode) {
  await api('/settings/pay-period', { method: 'POST', body: { mode } });
  pages.settings('personalisation');
};

window.setPrimarySchedule = async function(id) {
  await api('/settings/pay-period', { method: 'POST', body: { primary_schedule_id: id ? Number(id) : null } });
};
```

- [ ] **Step 4: Start the server and verify Settings → Personalisation**

```bash
node server.js
```

Open `http://localhost:3000`, navigate to Settings → Personalisation. Check:
- "DASHBOARD VIEW" section appears below the Reset button.
- Mode toggle shows Monthly active by default.
- Schedule picker lists active recurring income schedules.
- Selecting a schedule saves without error.
- Switching to "Pay Period" mode re-renders the tab with Pay Period active.
- Switching back to "Monthly" works.
- Returning to the Dashboard and using the header toggle also works.
- In Pay Period mode with a schedule selected, the dashboard stats/chart/calendar all update for the pay period.
- Bar chart x-axis shows period start dates (e.g. "25 May", "25 Apr") not month names.
- Stat sub-label shows the period date range.

Stop the server (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: settings personalisation tab — Dashboard View section with mode toggle and schedule picker"
```

---

## Task 9: Logout cleanup + version bump

**Files:**
- Modify: `public/app.js`
- Modify: `package.json`

- [ ] **Step 1: Clear pay-period state on logout**

Find the `logout()` function:
```javascript
async function logout() {
  closeMoreSheet();
  await fetch('\api\auth\logout', { method: 'POST' });
  invalidateAccounts();
  invalidateCategories();
  currentUser = null;
```

Add two lines after `invalidateCategories();`:
```javascript
  _payPeriodSettings = null;
  _dashData = null;
```

So it becomes:
```javascript
async function logout() {
  closeMoreSheet();
  await fetch('\api\auth\logout', { method: 'POST' });
  invalidateAccounts();
  invalidateCategories();
  _payPeriodSettings = null;
  _dashData = null;
  currentUser = null;
```

- [ ] **Step 2: Bump version in `package.json`**

Find:
```json
"version": "1.5.0",
```

Replace with:
```json
"version": "1.6.0",
```

- [ ] **Step 3: Verify version**

```bash
node -e "console.log(require('./package.json').version)"
```
Expected: `1.6.0`

- [ ] **Step 4: Run all tests**

```bash
node tests/settings.test.js && node tests/auth.test.js && node tests/db-migration.test.js && node tests/theme.test.js && node tests/period.test.js && node tests/summary-range.test.js
```
Expected: all test files report `0 failed`.

- [ ] **Step 5: Final browser check**

Start the server, log in, switch to Pay Period mode, log out, log back in — verify the dashboard reloads in the persisted mode without errors.

- [ ] **Step 6: Commit**

```bash
git add public/app.js package.json
git commit -m "feat: clear pay-period state on logout, bump version to 1.6.0"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `dashboard_mode` + `primary_schedule_id` in settings table | Task 4 |
| `GET /api/settings/pay-period` | Task 4 |
| `POST /api/settings/pay-period` with validation | Task 4 |
| `GET /api/summary/by-range?from=&to=` | Task 3 |
| Mount `summary-range` before `summary` | Task 5 |
| `computePeriods` for monthly / four_weekly / weekly | Task 1 |
| Today = pay-day edge case starts new period | Task 1 + 2 |
| `period-utils.js` loaded in browser | Task 5 |
| `pages.dashboard` fetches pay-period settings + schedules | Task 6 |
| 6 parallel range calls for pay period mode | Task 6 |
| Dashboard falls back to monthly when no primary schedule | Task 6 |
| "No primary schedule" banner shown | Task 7 |
| Header pill toggle (Monthly / Pay Period) | Task 7 |
| Stat sub-labels show period date range | Task 7 |
| Bar chart shows 6 pay periods (oldest → newest) | Task 7 |
| Bar chart title changes to "6 pay periods" | Task 7 |
| Calendar initialises at period start month | Task 7 |
| Settings → Personalisation: DASHBOARD VIEW section | Task 8 |
| Mode toggle in Settings saves and re-renders | Task 8 |
| Primary schedule picker populates from active schedules | Task 8 |
| `_payPeriodSettings` + `_dashData` cleared on logout | Task 9 |
| Version 1.6.0 | Task 9 |

All spec requirements covered. No placeholders.
