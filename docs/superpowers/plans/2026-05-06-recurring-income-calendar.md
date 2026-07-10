# Recurring Income & Dashboard Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring income schedules (weekly/4-weekly/monthly) with auto-generation, and a full-month 7-column grid calendar on the dashboard showing bills and pay days as coloured pills.

**Architecture:** New `income_schedules` table + nullable `source_schedule_id` on `income` enable auto-generated entries via an `ensureIncomeEntries(year, month)` helper (mirrors the existing `ensureBillMonths` pattern). A new `/api/calendar/:year/:month` endpoint aggregates bill and income events for the widget. The dashboard replaces its existing bills panel with a navigable CSS grid calendar.

**Tech Stack:** Node.js/Express, better-sqlite3, Vanilla JS SPA, Chart.js 4 (CDN)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `db.js` | Add `income_schedules` table; migrate `income` with `source_schedule_id` |
| Create | `routes/income-schedules.js` | Schedule CRUD routes + exported `ensureIncomeEntries` helper |
| Modify | `routes/bills.js` | Export `ensureBillMonths` so calendar route can import it |
| Modify | `routes/income.js` | Import and call `ensureIncomeEntries` in GET handler |
| Modify | `routes/summary.js` | Import and call `ensureIncomeEntries` in GET handler |
| Create | `routes/calendar.js` | `GET /api/calendar/:year/:month` |
| Modify | `server.js` | Mount `/api/income/schedules` (before `/api/income`) and `/api/calendar` |
| Modify | `public/app.js` | Income page: one-off/recurring toggle + schedules list; Dashboard: calendar widget |
| Modify | `package.json` | Bump version to `1.1.1` |

---

## Task 1: Database Schema

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add `income_schedules` table and `source_schedule_id` migration to db.js**

Open `db.js`. After the closing `` `); `` of the existing `db.exec(...)` block (after line 59, before the seed categories block), insert:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS income_schedules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    amount       REAL    NOT NULL,
    frequency    TEXT    NOT NULL CHECK(frequency IN ('weekly','four_weekly','monthly')),
    day_of_month INTEGER,
    anchor_date  TEXT,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

try {
  db.exec(`ALTER TABLE income ADD COLUMN source_schedule_id INTEGER REFERENCES income_schedules(id)`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}
```

The try/catch allows the server to restart safely on an already-migrated database.

- [ ] **Step 2: Verify schema loads without error**

```bash
node -e "require('./db'); console.log('ok')"
```
Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add db.js
git commit -m "feat: add income_schedules table and source_schedule_id to income"
```

---

## Task 2: Schedule Routes and ensureIncomeEntries

**Files:**
- Create: `routes/income-schedules.js`

- [ ] **Step 1: Create routes/income-schedules.js**

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function ensureIncomeEntries(year, month) {
  const y = Number(year), m = Number(month);
  const monthPad = String(m).padStart(2, '0');
  const dim = daysInMonth(y, m);
  const monthStart = `${y}-${monthPad}-01`;
  const monthEnd   = `${y}-${monthPad}-${String(dim).padStart(2, '0')}`;

  const schedules = db.prepare('SELECT * FROM income_schedules WHERE active = 1').all();

  for (const sched of schedules) {
    if (sched.frequency === 'monthly') {
      const day = Math.min(sched.day_of_month, dim);
      const ym = `${y}-${monthPad}`;
      const exists = db.prepare(
        `SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND strftime('%Y-%m', date) = ?`
      ).get(sched.id, ym);
      if (exists.c === 0) {
        const dateStr = `${y}-${monthPad}-${String(day).padStart(2, '0')}`;
        db.prepare(
          'INSERT INTO income (amount, description, date, source_schedule_id) VALUES (?, ?, ?, ?)'
        ).run(sched.amount, sched.name, dateStr, sched.id);
      }
    } else if (sched.frequency === 'weekly') {
      const anchorDow = new Date(sched.anchor_date + 'T00:00:00Z').getUTCDay();
      for (let d = 1; d <= dim; d++) {
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (dow !== anchorDow) continue;
        const dateStr = `${y}-${monthPad}-${String(d).padStart(2, '0')}`;
        const exists = db.prepare(
          'SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?'
        ).get(sched.id, dateStr);
        if (exists.c === 0) {
          db.prepare(
            'INSERT INTO income (amount, description, date, source_schedule_id) VALUES (?, ?, ?, ?)'
          ).run(sched.amount, sched.name, dateStr, sched.id);
        }
      }
    } else if (sched.frequency === 'four_weekly') {
      let cur = sched.anchor_date;
      // Walk forward until cur >= monthStart
      while (cur < monthStart) cur = addDays(cur, 28);
      // Walk backward if cur is past monthEnd (anchor in future month)
      while (cur > monthEnd) cur = addDays(cur, -28);
      // Iterate through all occurrences in the month
      while (cur <= monthEnd) {
        if (cur >= monthStart) {
          const exists = db.prepare(
            'SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?'
          ).get(sched.id, cur);
          if (exists.c === 0) {
            db.prepare(
              'INSERT INTO income (amount, description, date, source_schedule_id) VALUES (?, ?, ?, ?)'
            ).run(sched.amount, sched.name, cur, sched.id);
          }
        }
        cur = addDays(cur, 28);
      }
    }
  }
}

// GET /api/income/schedules
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM income_schedules ORDER BY created_at DESC').all();
  res.json(rows);
});

// POST /api/income/schedules
router.post('/', (req, res) => {
  const { name, amount, frequency, day_of_month, anchor_date } = req.body;
  if (!name || amount == null || !frequency)
    return res.status(400).json({ error: 'name, amount, frequency required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  if (!['weekly', 'four_weekly', 'monthly'].includes(frequency))
    return res.status(400).json({ error: 'frequency must be weekly, four_weekly, or monthly' });
  if (frequency === 'monthly') {
    const day = Number(day_of_month);
    if (!day || day < 1 || day > 31)
      return res.status(400).json({ error: 'day_of_month required (1–31) for monthly frequency' });
  } else {
    if (!anchor_date)
      return res.status(400).json({ error: 'anchor_date required for weekly/four_weekly frequency' });
  }
  const result = db.prepare(
    'INSERT INTO income_schedules (name, amount, frequency, day_of_month, anchor_date) VALUES (?, ?, ?, ?, ?)'
  ).run(name, parsed, frequency, day_of_month ?? null, anchor_date ?? null);
  res.status(201).json({
    id: result.lastInsertRowid, name, amount: parsed,
    frequency, day_of_month: day_of_month ?? null, anchor_date: anchor_date ?? null, active: 1,
  });
});

// PATCH /api/income/schedules/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const sched = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'not found' });
  if (!sched.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE income_schedules SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ id: Number(req.params.id), active: false });
});

module.exports = { router, ensureIncomeEntries };
```

- [ ] **Step 2: Verify the file parses without error**

```bash
node -e "require('./routes/income-schedules'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/income-schedules.js
git commit -m "feat: income schedule routes and ensureIncomeEntries helper"
```

---

## Task 3: Wire Up ensureBillMonths Export and ensureIncomeEntries

**Files:**
- Modify: `routes/bills.js`
- Modify: `routes/income.js`
- Modify: `routes/summary.js`

- [ ] **Step 1: Export ensureBillMonths from routes/bills.js**

Change the last line of `routes/bills.js` from:
```javascript
module.exports = router;
```
To:
```javascript
module.exports = router;
module.exports.ensureBillMonths = ensureBillMonths;
```

- [ ] **Step 2: Verify ensureBillMonths is accessible**

```bash
node -e "const r = require('./routes/bills'); console.log(typeof r.ensureBillMonths)"
```
Expected: `function`

- [ ] **Step 3: Replace routes/income.js**

Full replacement of `routes/income.js`:

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');

// GET /api/income?year=2026&month=5
router.get('/', (req, res) => {
  const { year, month } = req.query;
  if (year && month) ensureIncomeEntries(year, month);
  let sql = 'SELECT * FROM income WHERE 1=1';
  const params = [];
  if (year && month) {
    sql += ` AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/income
router.post('/', (req, res) => {
  const { amount, description, date } = req.body;
  if (amount == null || !description || !date)
    return res.status(400).json({ error: 'amount, description, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  const result = db.prepare(
    'INSERT INTO income (amount, description, date) VALUES (?, ?, ?)'
  ).run(parsed, description, date);
  res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, date });
});

// DELETE /api/income/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM income WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 4: Replace routes/summary.js**

Full replacement of `routes/summary.js`:

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');

// GET /api/summary/:year/:month
router.get('/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthPad = String(month).padStart(2, '0');

  ensureIncomeEntries(year, month);

  const incomeRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM income
     WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?`
  ).get(year, monthPad);

  const spentRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?`
  ).get(year, monthPad);

  const byCategory = db.prepare(
    `SELECT c.name, c.colour, COALESCE(SUM(t.amount), 0) as total
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id
       AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?
     GROUP BY c.id ORDER BY total DESC`
  ).all(year, monthPad);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Number(year), Number(month) - 1 - i, 1);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const inc = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as t FROM income WHERE strftime('%Y',date)=? AND strftime('%m',date)=?`
    ).get(y, m).t;
    const spent = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE strftime('%Y',date)=? AND strftime('%m',date)=?`
    ).get(y, m).t;
    months.push({ year: y, month: m, income: inc, spent });
  }

  res.json({
    income: incomeRow.total,
    spent: spentRow.total,
    remaining: incomeRow.total - spentRow.total,
    byCategory,
    monthlyTrend: months,
  });
});

module.exports = router;
```

- [ ] **Step 5: Verify all modified route files load**

```bash
node -e "require('./routes/income'); require('./routes/summary'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add routes/bills.js routes/income.js routes/summary.js
git commit -m "feat: wire ensureIncomeEntries into income and summary GET handlers"
```

---

## Task 4: Calendar API

**Files:**
- Create: `routes/calendar.js`

- [ ] **Step 1: Create routes/calendar.js**

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureBillMonths } = require('./bills');
const { ensureIncomeEntries } = require('./income-schedules');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// GET /api/calendar/:year/:month
router.get('/:year/:month', (req, res) => {
  const year  = Number(req.params.year);
  const month = Number(req.params.month);
  const monthPad = String(month).padStart(2, '0');
  const dim = daysInMonth(year, month);

  ensureBillMonths(year, month);
  ensureIncomeEntries(year, month);

  const billRows = db.prepare(`
    SELECT b.name, b.amount, b.due_day, c.colour, bm.paid
    FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id
    JOIN categories c ON c.id = b.category_id
    WHERE bm.year = ? AND bm.month = ? AND b.active = 1
    ORDER BY b.due_day ASC
  `).all(year, month);

  const incomeRows = db.prepare(`
    SELECT amount, description, date, source_schedule_id
    FROM income
    WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
    ORDER BY date ASC
  `).all(String(year), monthPad);

  const events = [];

  for (const b of billRows) {
    const day = Math.min(b.due_day, dim);
    const dateStr = `${year}-${monthPad}-${String(day).padStart(2, '0')}`;
    events.push({ date: dateStr, type: 'bill', name: b.name, amount: b.amount, colour: b.colour, paid: b.paid });
  }

  for (const inc of incomeRows) {
    const type = inc.source_schedule_id != null ? 'income' : 'income_oneoff';
    events.push({ date: inc.date, type, name: inc.description, amount: inc.amount });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  res.json({ events });
});

module.exports = router;
```

- [ ] **Step 2: Verify the file loads**

```bash
node -e "require('./routes/calendar'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/calendar.js
git commit -m "feat: calendar API endpoint"
```

---

## Task 5: Mount New Routes in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Replace the route-mounting block in server.js**

Replace the existing block (lines 8–14) with the following. The `/api/income/schedules` mount **must come before** `/api/income` so Express matches the more-specific path first:

```javascript
app.use('/api/transactions',      require('./routes/transactions'));
app.use('/api/bills',             require('./routes/bills'));
app.use('/api/bill-months',       require('./routes/bills'));
app.use('/api/income/schedules',  require('./routes/income-schedules').router);
app.use('/api/income',            require('./routes/income'));
app.use('/api/categories',        require('./routes/categories'));
app.use('/api/summary',           require('./routes/summary'));
app.use('/api/calendar',          require('./routes/calendar'));
app.use('/api/update',            require('./routes/update'));
```

- [ ] **Step 2: Start the server and verify routes respond**

```bash
node server.js
```

In a separate terminal:
```bash
curl -s http://localhost:3000/api/income/schedules
# Expected: []

curl -s "http://localhost:3000/api/calendar/2026/5"
# Expected: {"events":[...]}
```

- [ ] **Step 3: Test schedule creation end-to-end**

```bash
# Create a monthly schedule (paid on the 25th)
curl -s -X POST http://localhost:3000/api/income/schedules \
  -H "Content-Type: application/json" \
  -d '{"name":"Salary","amount":2400,"frequency":"monthly","day_of_month":25}'

# Fetch income for May 2026 — an auto-generated entry should appear
curl -s "http://localhost:3000/api/income?year=2026&month=5"

# Calendar should include it as a green pay-day event
curl -s "http://localhost:3000/api/calendar/2026/5"

# Create a 4-weekly schedule
curl -s -X POST http://localhost:3000/api/income/schedules \
  -H "Content-Type: application/json" \
  -d '{"name":"Freelance","amount":500,"frequency":"four_weekly","anchor_date":"2026-05-02"}'

# Deactivate it
curl -s -X PATCH http://localhost:3000/api/income/schedules/2/deactivate
```

Stop the test server (`Ctrl+C`) when done.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: mount income schedules and calendar routes"
```

---

## Task 6: Income Page UI

**Files:**
- Modify: `public/app.js` — replace `pages.income`, add `renderFreqFields`, `deactivateSchedule`, update `deleteIncome`

- [ ] **Step 1: Replace the income page section of public/app.js**

Find the comment `// ── Income ────────────────────────────────────────────────────────────────` and replace everything from that line through (and including) the `window.deleteIncome` function with:

```javascript
// ── Income ────────────────────────────────────────────────────────────────
pages.income = async function (year, month, mode) {
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;
  mode  = mode  ?? 'oneoff';

  const [entries, schedules] = await Promise.all([
    api(`/income?year=${year}&month=${month}`),
    api('/income/schedules'),
  ]);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const activeSchedules = schedules.filter(s => s.active);

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Income</h1></div>

    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;gap:0;margin-bottom:16px">
        <button class="btn ${mode === 'oneoff' ? 'btn-primary' : 'btn-ghost'}"
          style="border-radius:6px 0 0 6px;border-right:none"
          onclick="pages.income(${year},${month},'oneoff')">One-off</button>
        <button class="btn ${mode === 'recurring' ? 'btn-primary' : 'btn-ghost'}"
          style="border-radius:0 6px 6px 0"
          onclick="pages.income(${year},${month},'recurring')">Recurring</button>
      </div>

      ${mode === 'oneoff' ? `
        <form id="incForm" class="form-row" style="margin:0">
          <input type="number" id="incAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
          <input type="text"   id="incDesc"   placeholder="Source / description" style="flex:1" required>
          <input type="date"   id="incDate"   value="${toDateInput(now)}" style="width:150px" required>
          <button class="btn btn-primary" type="submit">Add Income</button>
        </form>
      ` : `
        <form id="incSchedForm" class="form-row" style="margin:0;flex-wrap:wrap">
          <input type="text"   id="schedName"   placeholder="Name (e.g. Salary)" style="flex:1;min-width:160px" required>
          <input type="number" id="schedAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
          <select id="schedFreq" style="min-width:190px" onchange="renderFreqFields()">
            <option value="monthly">Specific day each month</option>
            <option value="weekly">Weekly</option>
            <option value="four_weekly">Every 4 weeks</option>
          </select>
          <div id="schedFreqFields" style="display:contents"></div>
          <button class="btn btn-primary" type="submit">Add Schedule</button>
        </form>
      `}
    </div>

    ${mode === 'recurring' ? `
      <div class="card" style="margin-bottom:20px">
        <div class="chart-title">Recurring Sources</div>
        <div class="list" style="margin-top:12px">
          ${activeSchedules.length === 0
            ? '<p style="color:var(--muted)">No recurring income sources set up yet.</p>'
            : activeSchedules.map(s => {
                const freqLabel = s.frequency === 'monthly'
                  ? `Day ${s.day_of_month} each month`
                  : s.frequency === 'weekly'
                  ? `Weekly from ${s.anchor_date}`
                  : `Every 4 weeks from ${s.anchor_date}`;
                return `<div class="list-item" id="sched-${s.id}">
                  <span class="dot" style="background:#4ade80"></span>
                  <span class="desc">${s.name}
                    <span style="color:var(--muted);font-size:12px">${freqLabel}</span>
                  </span>
                  <span class="amount">${fmt(s.amount)}</span>
                  <button class="btn btn-danger btn-sm" onclick="deactivateSchedule(${s.id})">Deactivate</button>
                </div>`;
              }).join('')}
        </div>
      </div>
    ` : ''}

    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="incPrev">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="incNext">▶</button>
    </div>
    <div class="stat-card" style="margin-bottom:20px;max-width:280px">
      <div class="label">Total Income</div>
      <div class="value">${fmt(total)}</div>
      <div class="sub">${monthName(month)} ${year}</div>
    </div>
    <div class="list">
      ${entries.length === 0
        ? '<p style="color:var(--muted)">No income entries this month.</p>'
        : entries.map(e => `
          <div class="list-item" id="inc-${e.id}">
            <span class="dot" style="background:${e.source_schedule_id != null ? '#4ade80' : 'var(--accent)'}"></span>
            <span class="desc">${e.description}${e.source_schedule_id != null
              ? ' <span style="color:var(--muted);font-size:11px">recurring</span>' : ''}</span>
            <span class="date">${formatDate(e.date)}</span>
            <span class="amount">${fmt(e.amount)}</span>
            ${e.source_schedule_id == null
              ? `<button class="btn btn-danger btn-sm" onclick="deleteIncome(${e.id})">Del</button>`
              : ''}
          </div>`).join('')}
    </div>
  `;

  if (mode === 'oneoff') {
    $('incForm').addEventListener('submit', async e => {
      e.preventDefault();
      await api('/income', { method: 'POST', body: {
        amount: parseFloat($('incAmount').value),
        description: $('incDesc').value,
        date: $('incDate').value,
      }});
      pages.income(year, month, 'oneoff');
    });
  }

  if (mode === 'recurring') {
    renderFreqFields();
    $('incSchedForm').addEventListener('submit', async e => {
      e.preventDefault();
      const freq = $('schedFreq').value;
      const body = {
        name: $('schedName').value,
        amount: parseFloat($('schedAmount').value),
        frequency: freq,
      };
      if (freq === 'monthly') {
        body.day_of_month = Number($('schedDay').value);
      } else {
        body.anchor_date = $('schedAnchor').value;
      }
      await api('/income/schedules', { method: 'POST', body });
      pages.income(year, month, 'recurring');
    });
  }

  $('incPrev').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.income(d.getFullYear(), d.getMonth() + 1, mode);
  });
  $('incNext').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.income(d.getFullYear(), d.getMonth() + 1, mode);
  });
};

window.renderFreqFields = function () {
  const freq = document.getElementById('schedFreq')?.value;
  const container = document.getElementById('schedFreqFields');
  if (!container) return;
  if (freq === 'monthly') {
    container.innerHTML = `<input type="number" id="schedDay" placeholder="Day of month (1–31)"
      min="1" max="31" style="width:185px" required>`;
  } else {
    container.innerHTML = `<input type="date" id="schedAnchor"
      title="First pay date" style="width:160px" required>`;
  }
};

window.deactivateSchedule = async function (id) {
  if (!confirm('Deactivate this recurring source? Existing entries stay; no new ones will be created.')) return;
  await api(`/income/schedules/${id}/deactivate`, { method: 'PATCH' });
  document.getElementById(`sched-${id}`)?.remove();
};

window.deleteIncome = async function (id) {
  if (!confirm('Delete this income entry?')) return;
  await api(`/income/${id}`, { method: 'DELETE' });
  document.getElementById(`inc-${id}`)?.remove();
};
```

- [ ] **Step 2: Verify income page UI in the browser**

Start the server (`node server.js`) and open `http://localhost:3000`. Navigate to Income.

Check:
- **One-off / Recurring buttons** toggle the form correctly.
- **One-off**: filling in amount, description, date and clicking Add Income creates an entry that appears in the list immediately.
- **Recurring → Specific day each month**: shows a number input "Day of month".
- **Recurring → Weekly or Every 4 weeks**: shows a date picker.
- Creating a monthly schedule (day 25) and then navigating to the month shows an auto-generated entry with a green dot and "recurring" label, and no Delete button.
- **Recurring Sources** card lists active schedules with a Deactivate button.
- Deactivate confirmation prompt fires; after confirming, the row is removed.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: income page one-off/recurring toggle, schedule form, and sources list"
```

---

## Task 7: Dashboard Calendar Widget

**Files:**
- Modify: `public/app.js` — replace `pages.dashboard`, add `renderCalendar` and `hexDarken` helpers

- [ ] **Step 1: Add calYear / calMonth state variable**

Find this line (just after the `// ── Dashboard` comment):
```javascript
let barChart = null, donutChart = null;
```
Add the calendar state on the next line:
```javascript
let calYear = null, calMonth = null;
```

- [ ] **Step 2: Replace pages.dashboard**

Replace the entire `pages.dashboard = async function () { … };` block with:

```javascript
pages.dashboard = async function () {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  if (!calYear) { calYear = year; calMonth = month; }

  const summary = await api(`/summary/${year}/${month}`);

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Dashboard</h1>
      <span style="color:var(--muted);font-size:13px">${monthName(month)} ${year}</span>
    </div>
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
    </div>
    <div class="chart-grid">
      <div class="card">
        <div class="chart-title">Income vs Spending (6 months)</div>
        <canvas id="barChart" height="180"></canvas>
      </div>
      <div class="card">
        <div class="chart-title">Spending by Category</div>
        <canvas id="donutChart" height="180"></canvas>
      </div>
    </div>
    <div class="card">
      <div id="calWidget" style="min-height:280px;display:flex;align-items:center;justify-content:center">
        <span style="color:var(--muted)">Loading calendar…</span>
      </div>
    </div>
  `;

  if (barChart)   { barChart.destroy();   barChart = null; }
  if (donutChart) { donutChart.destroy(); donutChart = null; }

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

  await renderCalendar(calYear, calMonth);
};
```

- [ ] **Step 3: Add renderCalendar and hexDarken after pages.dashboard**

Add the following two functions directly after the closing `};` of `pages.dashboard`, before the `ordinal` function:

```javascript
async function renderCalendar(year, month) {
  calYear = year; calMonth = month;
  const data = await api(`/calendar/${year}/${month}`);
  const widget = document.getElementById('calWidget');
  if (!widget) return;

  const eventsByDate = {};
  for (const ev of data.events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  const firstDow  = new Date(year, month - 1, 1).getDay();
  const dim       = new Date(year, month, 0).getDate();
  const todayStr  = new Date().toISOString().split('T')[0];
  const monthPad  = String(month).padStart(2, '0');
  const DOW       = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-day cal-other"></div>`;

  for (let d = 1; d <= dim; d++) {
    const dayPad  = String(d).padStart(2, '0');
    const dateStr = `${year}-${monthPad}-${dayPad}`;
    const isToday = dateStr === todayStr;
    const dayEvs  = eventsByDate[dateStr] || [];

    const pills = dayEvs.map(ev => {
      if (ev.type === 'bill') {
        const bg = hexDarken(ev.colour);
        const opa = ev.paid ? 'opacity:0.5;' : '';
        const str = ev.paid ? 'text-decoration:line-through;' : '';
        return `<div class="event-pill" style="background:${bg};color:${ev.colour};${opa}">${ev.name} <span style="${str}">${fmt(ev.amount)}</span></div>`;
      }
      return `<div class="event-pill" style="background:#166534;color:#4ade80">${ev.name} ${fmt(ev.amount)}</div>`;
    }).join('');

    cells += `<div class="cal-day${dayEvs.length ? ' cal-has' : ''}">
      <div class="cal-num${isToday ? ' cal-today' : ''}">${d}</div>
      ${pills}
    </div>`;
  }

  const rem = (firstDow + dim) % 7;
  if (rem !== 0) for (let i = 0; i < 7 - rem; i++) cells += `<div class="cal-day cal-other"></div>`;

  widget.innerHTML = `
    <style>
      .cal-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .cal-title{color:#fff;font-size:15px;font-weight:700}
      .cal-nav{background:#2a2a2a;border:none;color:#888;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
      .cal-nav:hover{color:#fff}
      .cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:1px}
      .cal-dow{color:#555;font-size:11px;text-align:center;padding:5px 0;font-weight:600}
      .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#2a2a2a;border-radius:6px;overflow:hidden}
      .cal-day{background:#111;min-height:72px;padding:4px}
      .cal-other{background:#0d0d0d}
      .cal-num{color:#888;font-size:11px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;margin-bottom:3px;border-radius:50%}
      .cal-has .cal-num{color:#fff}
      .cal-today{background:#f7a4a2!important;color:#1a1a1a!important;font-weight:700}
      .event-pill{font-size:10px;border-radius:3px;padding:2px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;line-height:1.4}
    </style>
    <div class="cal-hdr">
      <button class="cal-nav" id="calPrev">◀</button>
      <span class="cal-title">${monthName(month)} ${year}</span>
      <button class="cal-nav" id="calNext">▶</button>
    </div>
    <div class="cal-dow-row">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div style="margin-top:10px;display:flex;gap:16px;font-size:11px;color:#888">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#166534;margin-right:4px;vertical-align:middle"></span>Pay day / income</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#7f1d1d;margin-right:4px;vertical-align:middle"></span>Bill (category colour)</span>
    </div>
  `;

  document.getElementById('calPrev').addEventListener('click', () => {
    const d = new Date(calYear, calMonth - 2, 1);
    renderCalendar(d.getFullYear(), d.getMonth() + 1);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    const d = new Date(calYear, calMonth, 1);
    renderCalendar(d.getFullYear(), d.getMonth() + 1);
  });
}

function hexDarken(hex) {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.slice(0, 2), 16) * 0.25);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * 0.25);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * 0.25);
  return `rgb(${r},${g},${b})`;
}
```

- [ ] **Step 4: Verify the dashboard calendar in a browser**

Navigate to the Dashboard. Check:
- Calendar renders below the two charts as a full-month 7-column grid.
- ◀/▶ buttons navigate months and re-fetch the calendar API.
- Today's date has a pink circle background.
- Days from previous/next month are greyed out with no events.
- Bill pills show in a darkened version of their category colour (text is the category colour).
- Income pills are dark green with green text.
- Paid bills appear at 50% opacity with strikethrough on the amount.
- Charts still render correctly above the calendar.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: dashboard calendar grid widget with bill and pay-day events"
```

---

## Task 8: Version Bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version to 1.1.1**

In `package.json`, change:
```json
"version": "1.1.0",
```
to:
```json
"version": "1.1.1",
```

- [ ] **Step 2: Verify**

```bash
node -e "console.log(require('./package.json').version)"
```
Expected: `1.1.1`

- [ ] **Step 3: Commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 1.1.1"
git tag v1.1.1
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `income_schedules` table | Task 1 |
| `source_schedule_id` on `income` | Task 1 |
| `ensureIncomeEntries` called on GET /api/income | Task 3 |
| `ensureIncomeEntries` called on GET /api/summary | Task 3 |
| weekly auto-generation (same weekday as anchor) | Task 2 |
| four_weekly auto-generation (28-day steps from anchor) | Task 2 |
| monthly auto-generation (day_of_month, clamped) | Task 2 |
| Duplicate prevention per-date (weekly/4-weekly) and per-month (monthly) | Task 2 |
| GET/POST /api/income/schedules | Tasks 2, 5 |
| PATCH /api/income/schedules/:id/deactivate | Tasks 2, 5 |
| GET /api/calendar/:year/:month | Tasks 4, 5 |
| Calendar calls both ensure functions | Task 4 |
| Calendar returns bill events with colour and paid status | Task 4 |
| Calendar returns income events with type (income vs income_oneoff) | Task 4 |
| Income page one-off/recurring toggle | Task 6 |
| Recurring form: frequency select + conditional anchor/day fields | Task 6 |
| Recurring Sources card with deactivate | Task 6 |
| Recurring entries shown with green dot, no Delete button | Task 6 |
| Dashboard calendar replaces bills panel | Task 7 |
| 7-column CSS grid, Sun–Sat header | Task 7 |
| Today pink circle | Task 7 |
| Other-month cells greyed out | Task 7 |
| Bill pills: darkened category bg, category text colour | Task 7 |
| Paid bill: 50% opacity, strikethrough | Task 7 |
| Income pills: dark green bg, green text | Task 7 |
| ◀/▶ navigation re-fetches calendar | Task 7 |
| Version 1.1.1 | Task 8 |

All spec requirements are covered.
