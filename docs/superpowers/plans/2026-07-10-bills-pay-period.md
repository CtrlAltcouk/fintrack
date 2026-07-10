# Bills Page: Pay Period Mode + Total Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Settings → Pay Period mode is active, the Bills page shows only the bills due in the currently viewed pay period (instead of a calendar month), navigated the same way Daily Spending already does it, and shows a running total of whatever bills are currently listed.

**Architecture:** A new `GET /api/bills/by-range?from&to` route resolves which calendar month(s) a period touches, reuses the existing `ensureBillMonths()` helper for each, computes each bill's clamped due date, and returns only in-range active occurrences plus the full (unfiltered) cancelled-bill history. The frontend's `pages.bills()` follows the exact pattern already established by `pages.spending()`: fetch pay-period settings + schedules, compute periods via `computePeriods()`, and branch between the existing month-based fetch and the new range-based fetch.

**Tech Stack:** Node.js/Express, better-sqlite3, vanilla JS SPA (no build step)

## Global Constraints

- Cancelled Bills stays unscoped/full-history in both monthly and period mode — only Active Bills + the total are period-aware.
- The total is the sum of ALL active bills shown (paid + unpaid), not just unpaid/remaining.
- The Bills page follows the global Settings → Pay Period toggle automatically — no separate per-page toggle.
- No backend `total` field — the frontend computes it identically in both modes via `active.reduce((s,b) => s+b.amount, 0)`.
- Full spec: `docs/superpowers/specs/2026-07-10-bills-pay-period.md`

---

## Task 1: Backend pure helpers — `monthsBetween` and `resolveDueDate`

**Files:**
- Modify: `routes/bills.js`
- Test: `tests/bills-range.test.js` (create)

**Interfaces:**
- Produces: `monthsBetween(from, to)` — takes two `YYYY-MM-DD` strings, returns an array of `{ year: number, month: number }` objects (1-indexed months) for every calendar month the range touches, inclusive of both endpoints.
- Produces: `resolveDueDate(dueDay, year, month)` — takes a bill's `due_day` (1–31) plus a year/month, returns the clamped `YYYY-MM-DD` due date string for that month (mirrors the existing client-side `clampDueDay` logic in `public/app.js`).
- Both are exported from `routes/bills.js` alongside the existing `ensureBillMonths` export, with no DB access — pure functions, unit-testable without touching the database.

- [ ] **Step 1: Write the failing tests**

Create `tests/bills-range.test.js`:

```javascript
// tests/bills-range.test.js
const assert = require('assert');
const { monthsBetween, resolveDueDate } = require('../routes/bills');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('monthsBetween: range within a single month', () => {
  assert.deepStrictEqual(monthsBetween('2026-07-01', '2026-07-31'), [{ year: 2026, month: 7 }]);
});

test('monthsBetween: range spanning two months', () => {
  assert.deepStrictEqual(monthsBetween('2026-06-25', '2026-07-24'), [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
  ]);
});

test('monthsBetween: range spanning a year boundary', () => {
  assert.deepStrictEqual(monthsBetween('2026-12-15', '2027-01-14'), [
    { year: 2026, month: 12 },
    { year: 2027, month: 1 },
  ]);
});

test('resolveDueDate: mid-month day unaffected', () => {
  assert.strictEqual(resolveDueDate(15, 2026, 7), '2026-07-15');
});

test('resolveDueDate: clamps day 31 in a 30-day month', () => {
  assert.strictEqual(resolveDueDate(31, 2026, 4), '2026-04-30');
});

test('resolveDueDate: clamps day 30 in February (2026 is not a leap year)', () => {
  assert.strictEqual(resolveDueDate(30, 2026, 2), '2026-02-28');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/bills-range.test.js`
Expected: fails immediately with something like `TypeError: monthsBetween is not a function` (the functions don't exist yet).

- [ ] **Step 3: Implement the two helpers in `routes/bills.js`**

Open `routes/bills.js`. Add these two functions directly after the existing `ensureBillMonths` function (after line 9, before the `// GET /api/bills` comment):

```javascript
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
```

Then change the export block at the bottom of the file from:

```javascript
module.exports = router;
module.exports.ensureBillMonths = ensureBillMonths;
```

to:

```javascript
module.exports = router;
module.exports.ensureBillMonths = ensureBillMonths;
module.exports.monthsBetween = monthsBetween;
module.exports.resolveDueDate = resolveDueDate;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/bills-range.test.js`
Expected: `6 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add routes/bills.js tests/bills-range.test.js
git commit -m "feat: add monthsBetween and resolveDueDate helpers for bill date-range queries"
```

---

## Task 2: Backend `GET /api/bills/by-range` route

**Files:**
- Modify: `routes/bills.js`

**Interfaces:**
- Consumes: `monthsBetween(from, to)` and `resolveDueDate(dueDay, year, month)` from Task 1; `ensureBillMonths(year, month, userId)` (already exists); `_parseDateRange(from, to)` exported from `routes/summary-range.js` (returns `null` on valid input, an error string otherwise).
- Produces: `GET /api/bills/by-range?from=YYYY-MM-DD&to=YYYY-MM-DD` → flat JSON array, same row shape as the existing `GET /api/bills` response, with an added `due_date` field (`YYYY-MM-DD` string on active in-range rows, `null` on cancelled rows).

- [ ] **Step 1: Add the route**

Open `routes/bills.js`. Add `const { _parseDateRange } = require('./summary-range');` near the top, after the existing `const db = require('../db');` line. Then add the new route directly after the existing `GET /` route (after its closing `});`, before `// POST /api/bills`):

```javascript
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
```

- [ ] **Step 2: Verify the file loads without error**

Run: `node -e "require('./routes/bills'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Manual verification against a running server**

Start the server: `npm run dev`

In another terminal, log in (replace `<display_name>`/`<password>` with an existing local user's credentials) and save the session cookie:

```bash
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"display_name":"<display_name>","password":"<password>"}'
```

Expected: JSON with your user's `id`, `display_name`, etc. (not an error).

Fetch your categories to get a valid `category_id` to use next:

```bash
curl -s -b cookies.txt http://localhost:3000/api/categories
```

Create a test bill due on the 20th of each month (substitute a real `category_id` from the previous response):

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/bills \
  -H "Content-Type: application/json" \
  -d '{"name":"Range Test Bill","amount":50,"due_day":20,"category_id":<category_id>,"account_id":null}'
```

Query a period that only contains the *July* occurrence of this bill (due 2026-07-20 falls inside 2026-06-25–2026-07-24; the June occurrence, 2026-06-20, falls just before the window starts):

```bash
curl -s -b cookies.txt "http://localhost:3000/api/bills/by-range?from=2026-06-25&to=2026-07-24"
```

Expected: the JSON array contains **exactly one** row named `"Range Test Bill"`, with `"due_date":"2026-07-20"` — not two (confirming the bill isn't double-counted across the two touched months), and not the June occurrence.

Cancel the test bill and confirm it still appears (in the same response, since Cancelled Bills is unscoped):

```bash
curl -s -b cookies.txt -X PATCH "http://localhost:3000/api/bills/$(curl -s -b cookies.txt "http://localhost:3000/api/bills/by-range?from=2026-06-25&to=2026-07-24" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).find(b=>b.name==='Range Test Bill').id))")/cancel"
curl -s -b cookies.txt "http://localhost:3000/api/bills/by-range?from=2026-06-25&to=2026-07-24"
```

Expected: `"Range Test Bill"` still appears in the array, now with `"active":0` and `"due_date":null`.

Stop the dev server (`Ctrl+C`) when done. Delete `cookies.txt` — it's a local scratch file, not part of the repo.

- [ ] **Step 4: Commit**

```bash
git add routes/bills.js
git commit -m "feat: add GET /api/bills/by-range endpoint"
```

---

## Task 3: Frontend — `pages.bills` period-mode support

**Files:**
- Modify: `public/app.js:1157-1250` (the `// ── Bills` section header through the end of `pages.bills`)

**Interfaces:**
- Consumes: `GET /api/bills/by-range` (Task 2); `api('/settings/pay-period')`, `api('/income/schedules')`, `computePeriods(schedule, count)` (all already used identically by `pages.spending`); existing helpers `clampDueDay`, `formatDate`, `fmt`, `esc`, `ordinal`, `monthName`.
- Produces: `pages.bills(year, month, periodIndex = 0)` — same public entry point, now period-mode aware. `payBill`/`cancelBill` (Task 4) will need to know the current view state; this task does **not** change them yet — they keep calling bare `pages.bills()` for now (fixed next task).

- [ ] **Step 1: Replace `pages.bills`**

In `public/app.js`, replace the entire `pages.bills = async function (year, month) { … };` block (from `pages.bills = async function` through its closing `};`, i.e. current lines 1158–1250) with:

```javascript
pages.bills = async function (year, month, periodIndex = 0) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const [cats, accounts, ppSettings, schedules] = await Promise.all([
    getCategories(),
    getAccounts(),
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);

  const isPP = ppSettings.mode === 'pay_period';
  let paySchedule = null, periods = [], safeIndex = 0;

  if (isPP && ppSettings.primary_schedule_id) {
    paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active) || null;
  }
  if (isPP && paySchedule) {
    periods = computePeriods(paySchedule, 8);
  }

  if (isPP && periods.length === 0) {
    main().innerHTML = `
      <div class="page-header"><h1 class="page-title">Bills</h1></div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;font-size:13px">
        <span style="color:var(--muted)">Pay Period mode is active but no primary schedule is set.</span>
        <button class="btn btn-ghost btn-sm" onclick="pages.settings('personalisation')">Configure in Settings →</button>
      </div>
    `;
    return;
  }

  let bills, navLabel;
  if (isPP) {
    safeIndex     = Math.min(Math.max(0, periodIndex), periods.length - 1);
    const period  = periods[safeIndex];
    bills         = await api(`/bills/by-range?from=${period.from}&to=${period.to}`);
    navLabel      = esc(period.label);
  } else {
    year  = year  ?? now.getFullYear();
    month = month ?? now.getMonth() + 1;
    bills = await api(`/bills?year=${year}&month=${month}`);
    navLabel = `${monthName(month)} ${year}`;
  }

  const active    = bills.filter(b => b.active);
  const cancelled = bills.filter(b => !b.active);
  const total     = active.reduce((s, b) => s + b.amount, 0);
  const catOptions = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const prevDisabled = isPP && safeIndex >= periods.length - 1 ? 'disabled' : '';
  const nextDisabled = isPP && safeIndex === 0 ? 'disabled' : '';

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Bills</h1></div>
    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="billPrev" ${prevDisabled}>◀</button>
      <span class="month-label">${navLabel}</span>
      <button class="btn btn-ghost btn-sm" id="billNext" ${nextDisabled}>▶</button>
    </div>

    <div class="card" style="margin-bottom:20px">
      <form id="billForm" class="form-row" style="margin:0">
        <input type="text"   id="bName"   placeholder="Bill name" style="flex:1" required>
        <input type="number" id="bAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:110px" required>
        <input type="number" id="bDay"    placeholder="Due day" min="1" max="31" style="width:90px" required>
        <select id="bCat"  style="flex:1">${catOptions}</select>
        <select id="bAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" type="submit">Add Bill</button>
      </form>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:12px;display:flex;justify-content:space-between">
        <span>Active Bills</span>
        <span>${fmt(total)}</span>
      </div>
      <div class="list">
        ${active.length === 0 ? '<p style="color:var(--muted)">No active bills.</p>' :
          active.map(b => {
            let overdue, label;
            if (isPP) {
              overdue = !b.paid && b.due_date < todayStr && safeIndex === 0;
              label   = b.paid ? 'PAID' : overdue ? 'OVERDUE' : `DUE ${formatDate(b.due_date)}`;
            } else {
              const today = now.getDate();
              overdue = !b.paid && b.due_day < today && year === now.getFullYear() && month === now.getMonth()+1;
              const effectiveDay = clampDueDay(b.due_day, year, month);
              label = b.paid ? 'PAID' : overdue ? 'OVERDUE' : `DUE ${effectiveDay}${ordinal(effectiveDay)}`;
            }
            const badge = b.paid ? 'badge-paid' : overdue ? 'badge-overdue' : 'badge-unpaid';
            return `<div class="list-item">
              <span class="dot" style="background:${b.category_colour}"></span>
              <span class="desc"><strong>${b.name}</strong> <span style="color:var(--muted);font-size:12px">${b.category_name}</span></span>
              <span class="amount">${fmt(b.amount)}</span>
              <span class="badge ${badge}">${label}</span>
              ${!b.paid ? `<button class="btn btn-primary btn-sm" onclick="payBill(${b.bill_month_id},${b.amount})">Mark Paid</button>` : ''}
              <button class="btn btn-danger btn-sm" data-bname="${esc(b.name)}" onclick="cancelBill(${b.id},this.dataset.bname)">Cancel</button>
            </div>`;
          }).join('')}
      </div>
    </div>

    ${cancelled.length > 0 ? `
    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">Cancelled Bills</div>
      <div class="list">
        ${cancelled.map(b => `
          <div class="list-item" style="opacity:0.5">
            <span class="dot" style="background:${b.category_colour}"></span>
            <span class="desc">${b.name}</span>
            <span style="color:var(--muted);font-size:12px">Cancelled</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `;

  $('billForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/bills', { method: 'POST', body: {
      name: $('bName').value,
      amount: parseFloat($('bAmount').value),
      due_day: Number($('bDay').value),
      category_id: Number($('bCat').value),
      account_id: $('bAcct').value ? Number($('bAcct').value) : null,
    }});
    isPP ? pages.bills(null, null, safeIndex) : pages.bills(year, month);
  });

  $('billPrev').addEventListener('click', () => {
    if (isPP) {
      pages.bills(null, null, safeIndex + 1);
    } else {
      const d = new Date(year, month - 2, 1);
      pages.bills(d.getFullYear(), d.getMonth() + 1);
    }
  });
  $('billNext').addEventListener('click', () => {
    if (isPP) {
      pages.bills(null, null, safeIndex - 1);
    } else {
      const d = new Date(year, month, 1);
      pages.bills(d.getFullYear(), d.getMonth() + 1);
    }
  });
};
```

Leave `window.payBill` and `window.cancelBill` (the two functions immediately below) completely unchanged for this task — they still call bare `pages.bills()`. That's fixed in Task 4.

- [ ] **Step 2: Verify the file loads without error**

Run: `node -c public/app.js`
Expected: no output (success).

- [ ] **Step 3: Manual browser verification**

Start the server: `npm run dev`. Open `http://localhost:3000` and log in.

With Pay Period mode **off** (Settings → Personalisation): go to Bills. Confirm it looks and behaves exactly as before — month nav, Active/Cancelled Bills, "DUE Nth" labels — with the one visible addition being the total next to "Active Bills".

Turn Pay Period mode **on** but leave "Primary schedule" unset: go to Bills. Confirm you see only the header and the "Pay Period mode is active but no primary schedule is set" banner with a working "Configure in Settings →" button — no bill list, no add-bill form.

Set a primary schedule (any active recurring income schedule) in Settings → Personalisation: go to Bills. Confirm:
- The month nav is replaced by `◀ <period label> ▶`.
- The Active Bills list only shows bills whose due date falls in the shown period, with due labels like "DUE Fri 25 Jul" instead of "DUE 25th".
- The total updates to match whatever's shown.
- ◀ eventually disables at the oldest period (period 8), ▶ disables on the current (newest) period.
- Cancelled Bills still shows full history regardless of which period you're viewing.

Turn Pay Period mode back off: confirm Bills reverts to the monthly view unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: bills page respects pay period mode, adds bills total"
```

---

## Task 4: Frontend — preserve view state after pay/cancel

**Files:**
- Modify: `public/app.js` (the `pages.bills` function from Task 3, plus `window.payBill` and `window.cancelBill`)

**Interfaces:**
- Produces: a module-level `_billsView` variable (pattern already used elsewhere in this file for the same purpose, e.g. `calYear`/`calMonth`, `_dashData`) so `payBill`/`cancelBill` can refresh the page without losing the user's navigated position.

- [ ] **Step 1: Declare `_billsView` and set it inside `pages.bills`**

In `public/app.js`, find the line `// ── Bills ─────────────────────────────────────────────────────────────────` and add this line directly after it:

```javascript
let _billsView = { isPP: false, year: null, month: null, periodIndex: 0 };
```

Inside `pages.bills` (from Task 3), find the early-return "no schedule" banner block:

```javascript
  if (isPP && periods.length === 0) {
    main().innerHTML = `
```

Change it to set `_billsView` right before rendering:

```javascript
  if (isPP && periods.length === 0) {
    _billsView = { isPP: true, year: null, month: null, periodIndex: 0 };
    main().innerHTML = `
```

Then find this line (added in Task 3, right after computing `total`/`catOptions`):

```javascript
  const catOptions = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
```

Add directly after it:

```javascript
  _billsView = isPP
    ? { isPP: true, year: null, month: null, periodIndex: safeIndex }
    : { isPP: false, year, month, periodIndex: 0 };
```

- [ ] **Step 2: Update `payBill` and `cancelBill` to use it**

Replace:

```javascript
window.payBill = async function(billMonthId, defaultAmount) {
  const input = prompt(`Amount paid (default: £${defaultAmount}):`, defaultAmount);
  if (input === null) return;
  const amount_paid = parseFloat(input) || defaultAmount;
  await api(`/bill-months/${billMonthId}/pay`, { method: 'POST', body: { amount_paid } });
  pages.bills();
};
```

with:

```javascript
window.payBill = async function(billMonthId, defaultAmount) {
  const input = prompt(`Amount paid (default: £${defaultAmount}):`, defaultAmount);
  if (input === null) return;
  const amount_paid = parseFloat(input) || defaultAmount;
  await api(`/bill-months/${billMonthId}/pay`, { method: 'POST', body: { amount_paid } });
  _billsView.isPP
    ? pages.bills(null, null, _billsView.periodIndex)
    : pages.bills(_billsView.year, _billsView.month);
};
```

Replace the `await api(\`/bills/${id}/cancel\`, { method: 'PATCH' }); pages.bills();` line inside `window.cancelBill`'s `cancelYes` click handler with:

```javascript
    await api(`/bills/${id}/cancel`, { method: 'PATCH' });
    _billsView.isPP
      ? pages.bills(null, null, _billsView.periodIndex)
      : pages.bills(_billsView.year, _billsView.month);
```

- [ ] **Step 3: Verify the file loads without error**

Run: `node -c public/app.js`
Expected: no output (success).

- [ ] **Step 4: Manual browser verification**

With Pay Period mode on and a primary schedule set: navigate ◀ back one period (not the current one), mark a bill paid. Confirm the page stays on that same past period (still shows `◀ <that period's label> ▶`) instead of jumping back to the current period.

Repeat for cancelling a bill while viewing a past period, and again for both actions in monthly mode navigated to a past month — confirm the view stays put in all four cases.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "fix: bills page keeps current period/month after paying or cancelling a bill"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-------------------|------|
| `GET /api/bills/by-range` endpoint, reusing `ensureBillMonths` | Tasks 1, 2 |
| `_parseDateRange` reused from `summary-range.js` | Task 2 |
| Cancelled bills always included, unfiltered by date | Task 2 |
| `due_date` field on active rows for period-mode display | Tasks 2, 3 |
| Bills page follows global Pay Period toggle automatically | Task 3 |
| No-schedule banner (verbatim Daily Spending pattern) | Task 3 |
| Period nav with ◀/▶ boundary disabling (count=8) | Task 3 |
| Monthly mode unchanged when Pay Period is off | Task 3 |
| Due label difference (ordinal vs formatDate) | Task 3 |
| Overdue flag difference (`safeIndex === 0` check) | Task 3 |
| Total = sum of all active bills shown, paid + unpaid, computed client-side in both modes | Task 3 |
| Cancelled Bills stays unscoped under period mode | Task 3 (unchanged rendering) |
| View position preserved after pay/cancel | Task 4 |

All spec requirements are covered.

**Note on versioning:** this plan does not include a `package.json`/`HANDOFF.md` version bump — in this project that's been a separate, explicit step the user directs after the feature is implemented and verified (not baked into the implementation plan itself).
