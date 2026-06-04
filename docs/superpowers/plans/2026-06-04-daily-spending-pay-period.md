# Daily Spending — Pay Period Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Pay Period mode is enabled in settings, the Daily Spending page shows transactions within the current pay period and provides ◀ Period ▶ navigation instead of the calendar month nav.

**Architecture:** Two changes — extend `routes/transactions.js` to accept `from`/`to` date range params as an alternative to `year`/`month`, then update `pages.spending` in `public/app.js` to read pay period settings, compute period boundaries using the existing `computePeriods()` global, and fetch + render accordingly.

**Tech Stack:** Node.js/Express, better-sqlite3, vanilla JS SPA (no build step)

---

## File Map

| File | Change |
|------|--------|
| `routes/transactions.js` | Add `from`/`to` query filtering (lines 7 and 15–18) |
| `public/app.js` | Replace `pages.spending` function (lines 832–942) |

---

## Task 1: Backend — add `from`/`to` date range filtering to `GET /api/transactions`

**Files:**
- Modify: `routes/transactions.js:7,15-18`

The current filter block only supports `year`+`month`. We need to also accept `from`/`to` (ISO date strings). When both `from` and `to` are present they take precedence; otherwise fall through to the existing `year`+`month` logic.

- [ ] **Step 1: Edit `routes/transactions.js`**

Replace line 7 (destructure) and lines 15–18 (the year/month if-block) as follows.

Current code at lines 6–22:
```js
router.get('/', (req, res) => {
  const { year, month, category_id, account_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour,
             a.name as account_name, a.colour as account_colour
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts   a ON t.account_id  = a.id
             WHERE t.user_id = ?`;
  const params = [req.userId];
  if (year && month) {
    sql += ` AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (category_id) { sql += ` AND t.category_id = ?`; params.push(category_id); }
  if (account_id)  { sql += ` AND t.account_id  = ?`; params.push(account_id); }
  sql += ` ORDER BY t.date DESC, t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});
```

New code:
```js
router.get('/', (req, res) => {
  const { year, month, from, to, category_id, account_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour,
             a.name as account_name, a.colour as account_colour
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts   a ON t.account_id  = a.id
             WHERE t.user_id = ?`;
  const params = [req.userId];
  if (from && to) {
    sql += ` AND t.date >= ? AND t.date <= ?`;
    params.push(from, to);
  } else if (year && month) {
    sql += ` AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (category_id) { sql += ` AND t.category_id = ?`; params.push(category_id); }
  if (account_id)  { sql += ` AND t.account_id  = ?`; params.push(account_id); }
  sql += ` ORDER BY t.date DESC, t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});
```

- [ ] **Step 2: Verify the server starts cleanly**

```bash
npm start
```

Expected: server starts on port 3000 with no errors. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add routes/transactions.js
git commit -m "feat: add from/to date range filtering to GET /api/transactions"
```

---

## Task 2: Frontend — update `pages.spending` for pay period mode

**Files:**
- Modify: `public/app.js:832-942`

Replace the entire `pages.spending` function. The new version:
1. Fetches `ppSettings` and `schedules` in parallel with `cats` and `accounts`
2. In pay period mode with no valid schedule: renders a banner and returns early
3. In pay period mode with a valid schedule: uses `computePeriods()` + `from`/`to` API params + period label nav
4. In monthly mode: identical behaviour to today

- [ ] **Step 1: Replace `pages.spending` in `public/app.js`**

Find and replace the entire function from the comment on line 832 through the closing `};` on line 942.

Old block (lines 832–942):
```js
// ── Daily Spending ────────────────────────────────────────────────────────
pages.spending = async function (year, month, categoryId = null, accountId = null) {
  invalidateAccounts();
  const now = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  const catQuery  = categoryId ? `&category_id=${categoryId}` : '';
  const acctQuery = accountId  ? `&account_id=${accountId}`   : '';
  const [cats, txns, accounts] = await Promise.all([
    getCategories(),
    api(`/transactions?year=${year}&month=${month}${catQuery}${acctQuery}`),
    getAccounts(),
  ]);

  const grouped = {};
  for (const t of txns) {
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push(t);
  }

  const catOptions = cats.map(c =>
    `<option value="${c.id}">${c.name}</option>`).join('');

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Daily Spending</h1>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="color:var(--muted);font-size:12px">Filter:</label>
        <select id="catFilter" style="min-width:140px">
          <option value="">All categories</option>
          ${catOptions}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn ${!accountId ? 'btn-primary' : 'btn-ghost'} btn-sm"
        onclick="pages.spending(${year},${month},${JSON.stringify(categoryId)},null)">All</button>
      ${accounts.map(a => `
        <button class="btn ${accountId === a.id ? 'btn-primary' : 'btn-ghost'} btn-sm"
          style="display:flex;align-items:center;gap:5px"
          onclick="pages.spending(${year},${month},${JSON.stringify(categoryId)},${a.id})">
          <span style="width:8px;height:8px;border-radius:50%;background:${esc(a.colour)};display:inline-block;flex-shrink:0"></span>${esc(a.name)}
        </button>`).join('')}
    </div>
    <div class="card" style="margin-bottom:20px">
      <form id="txnForm" class="form-row" style="margin:0">
        <input type="number" id="txnAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="text"   id="txnDesc"   placeholder="Description" style="flex:1;min-width:160px" required>
        <select id="txnCat"  style="flex:1;min-width:140px">${catOptions}</select>
        <select id="txnAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}" ${accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <input type="date" id="txnDate" value="${toDateInput(now)}" style="width:150px" required>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="prevMonth">◀</button>
      <span class="month-label">${monthName(month)} ${year}</span>
      <button class="btn btn-ghost btn-sm" id="nextMonth">▶</button>
    </div>
    <div id="txnList">
      ${Object.keys(grouped).sort((a,b) => b.localeCompare(a)).map(date => {
        const items = grouped[date];
        const dayTotal = items.reduce((s, t) => s + t.amount, 0);
        return `<div class="day-group">
          <div class="day-header"><span>${formatDate(date)}</span><span>${fmt(dayTotal)}</span></div>
          <div class="list">
            ${items.map(t => `
              <div class="list-item" id="txn-${t.id}">
                <span class="dot" style="background:${t.category_colour}"></span>
                <span class="desc">${esc(t.description)}
                  <br><span style="color:var(--muted);font-size:12px">${esc(t.category_name)} · <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${esc(t.account_colour ?? 'var(--muted)')};vertical-align:middle;margin-right:3px"></span>${t.account_name ? esc(t.account_name) : 'Unassigned'}</span>
                </span>
                <span class="amount">${fmt(t.amount)}</span>
                <button class="btn btn-ghost btn-sm" onclick="editTxn(${t.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteTxn(${t.id})">Del</button>
              </div>`).join('')}
          </div>
        </div>`;
      }).join('') || '<p style="color:var(--muted)">No transactions this month.</p>'}
    </div>
  `;

  $('txnForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/transactions', { method: 'POST', body: {
      amount: parseFloat($('txnAmount').value),
      description: $('txnDesc').value,
      category_id: Number($('txnCat').value),
      account_id: $('txnAcct').value ? Number($('txnAcct').value) : null,
      date: $('txnDate').value,
    }});
    pages.spending(year, month, categoryId, accountId);
  });

  $('catFilter').addEventListener('change', () => {
    const catId = $('catFilter').value;
    pages.spending(year, month, catId ? Number(catId) : null, accountId);
  });

  $('prevMonth').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
  });
  $('nextMonth').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
  });
};
```

New block:
```js
// ── Daily Spending ────────────────────────────────────────────────────────
pages.spending = async function (year, month, categoryId = null, accountId = null, periodIndex = 0) {
  invalidateAccounts();
  const now = new Date();

  const catQuery  = categoryId ? `&category_id=${categoryId}` : '';
  const acctQuery = accountId  ? `&account_id=${accountId}`   : '';

  const [cats, accounts, ppSettings, schedules] = await Promise.all([
    getCategories(),
    getAccounts(),
    api('/settings/pay-period'),
    api('/income/schedules'),
  ]);

  const isPP = ppSettings.mode === 'pay_period';
  let paySchedule = null, periods = [], safeIndex = 0, period = null;

  if (isPP && ppSettings.primary_schedule_id) {
    paySchedule = schedules.find(s => s.id === ppSettings.primary_schedule_id && s.active) || null;
  }
  if (isPP && paySchedule) {
    periods = computePeriods(paySchedule, 8);
  }

  if (isPP && periods.length === 0) {
    main().innerHTML = `
      <div class="page-header"><h1 class="page-title">Daily Spending</h1></div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;font-size:13px">
        <span style="color:var(--muted)">Pay Period mode is active but no primary schedule is set.</span>
        <button class="btn btn-ghost btn-sm" onclick="pages.settings('personalisation')">Configure in Settings →</button>
      </div>
    `;
    return;
  }

  let txns, navLabel;
  if (isPP) {
    safeIndex = Math.min(Math.max(0, periodIndex), periods.length - 1);
    period    = periods[safeIndex];
    txns      = await api(`/transactions?from=${period.from}&to=${period.to}${catQuery}${acctQuery}`);
    navLabel  = esc(period.label);
  } else {
    year     = year  ?? now.getFullYear();
    month    = month ?? now.getMonth() + 1;
    txns     = await api(`/transactions?year=${year}&month=${month}${catQuery}${acctQuery}`);
    navLabel = `${monthName(month)} ${year}`;
  }

  const grouped = {};
  for (const t of txns) {
    if (!grouped[t.date]) grouped[t.date] = [];
    grouped[t.date].push(t);
  }

  const catOptions   = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const allOnclick   = isPP
    ? `pages.spending(null,null,${JSON.stringify(categoryId)},null,${safeIndex})`
    : `pages.spending(${year},${month},${JSON.stringify(categoryId)},null)`;
  const acctOnclick  = (aId) => isPP
    ? `pages.spending(null,null,${JSON.stringify(categoryId)},${aId},${safeIndex})`
    : `pages.spending(${year},${month},${JSON.stringify(categoryId)},${aId})`;
  const prevDisabled = isPP && safeIndex >= periods.length - 1 ? 'disabled' : '';
  const nextDisabled = isPP && safeIndex === 0 ? 'disabled' : '';

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Daily Spending</h1>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="color:var(--muted);font-size:12px">Filter:</label>
        <select id="catFilter" style="min-width:140px">
          <option value="">All categories</option>
          ${catOptions}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn ${!accountId ? 'btn-primary' : 'btn-ghost'} btn-sm"
        onclick="${allOnclick}">All</button>
      ${accounts.map(a => `
        <button class="btn ${accountId === a.id ? 'btn-primary' : 'btn-ghost'} btn-sm"
          style="display:flex;align-items:center;gap:5px"
          onclick="${acctOnclick(a.id)}">
          <span style="width:8px;height:8px;border-radius:50%;background:${esc(a.colour)};display:inline-block;flex-shrink:0"></span>${esc(a.name)}
        </button>`).join('')}
    </div>
    <div class="card" style="margin-bottom:20px">
      <form id="txnForm" class="form-row" style="margin:0">
        <input type="number" id="txnAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="text"   id="txnDesc"   placeholder="Description" style="flex:1;min-width:160px" required>
        <select id="txnCat"  style="flex:1;min-width:140px">${catOptions}</select>
        <select id="txnAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}" ${accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        <input type="date" id="txnDate" value="${toDateInput(now)}" style="width:150px" required>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
    <div class="month-nav">
      <button class="btn btn-ghost btn-sm" id="prevMonth" ${prevDisabled}>◀</button>
      <span class="month-label">${navLabel}</span>
      <button class="btn btn-ghost btn-sm" id="nextMonth" ${nextDisabled}>▶</button>
    </div>
    <div id="txnList">
      ${Object.keys(grouped).sort((a,b) => b.localeCompare(a)).map(date => {
        const items    = grouped[date];
        const dayTotal = items.reduce((s, t) => s + t.amount, 0);
        return `<div class="day-group">
          <div class="day-header"><span>${formatDate(date)}</span><span>${fmt(dayTotal)}</span></div>
          <div class="list">
            ${items.map(t => `
              <div class="list-item" id="txn-${t.id}">
                <span class="dot" style="background:${t.category_colour}"></span>
                <span class="desc">${esc(t.description)}
                  <br><span style="color:var(--muted);font-size:12px">${esc(t.category_name)} · <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${esc(t.account_colour ?? 'var(--muted)')};vertical-align:middle;margin-right:3px"></span>${t.account_name ? esc(t.account_name) : 'Unassigned'}</span>
                </span>
                <span class="amount">${fmt(t.amount)}</span>
                <button class="btn btn-ghost btn-sm" onclick="editTxn(${t.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteTxn(${t.id})">Del</button>
              </div>`).join('')}
          </div>
        </div>`;
      }).join('') || `<p style="color:var(--muted)">No transactions this ${isPP ? 'period' : 'month'}.</p>`}
    </div>
  `;

  $('txnForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/transactions', { method: 'POST', body: {
      amount:      parseFloat($('txnAmount').value),
      description: $('txnDesc').value,
      category_id: Number($('txnCat').value),
      account_id:  $('txnAcct').value ? Number($('txnAcct').value) : null,
      date:        $('txnDate').value,
    }});
    isPP
      ? pages.spending(null, null, categoryId, accountId, safeIndex)
      : pages.spending(year, month, categoryId, accountId);
  });

  $('catFilter').addEventListener('change', () => {
    const catId = $('catFilter').value;
    isPP
      ? pages.spending(null, null, catId ? Number(catId) : null, accountId, safeIndex)
      : pages.spending(year, month, catId ? Number(catId) : null, accountId);
  });

  $('prevMonth').addEventListener('click', () => {
    if (isPP) {
      pages.spending(null, null, categoryId, accountId, safeIndex + 1);
    } else {
      const d = new Date(year, month - 2, 1);
      pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
    }
  });
  $('nextMonth').addEventListener('click', () => {
    if (isPP) {
      pages.spending(null, null, categoryId, accountId, safeIndex - 1);
    } else {
      const d = new Date(year, month, 1);
      pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
    }
  });
};
```

- [ ] **Step 2: Start the dev server and verify monthly mode is unchanged**

```bash
npm run dev
```

Open `http://localhost:3000`. Log in, click **Daily Spending**. Check:
- Transactions for the current month load as before
- ◀ / ▶ navigate to previous/next month
- Category filter still works
- Account filter buttons still work
- Adding a transaction still works

- [ ] **Step 3: Verify pay period mode (no primary schedule set)**

In Settings → Personalisation, switch Dashboard View to **Pay Period** but leave Primary pay schedule as **— None selected —**.

Navigate to Daily Spending. Expected: a banner saying "Pay Period mode is active but no primary schedule is set." with a "Configure in Settings →" button. No transaction list shown.

- [ ] **Step 4: Verify pay period mode (with primary schedule set)**

In Settings → Personalisation, pick an active recurring income schedule as the primary schedule.

Navigate to Daily Spending. Check:
- Page shows the current pay period's transactions
- Nav label shows the period date range (e.g. `14 May – 10 Jun`) not a month name
- ◀ navigates to the previous pay period; ▶ navigates forward
- ▶ is disabled when viewing the current (most recent) period
- ◀ is disabled when viewing the oldest computed period
- Category and account filters still work within the period
- Adding a transaction refreshes the same period view

- [ ] **Step 5: Switch back to monthly mode and verify**

In Settings → Personalisation, switch Dashboard View back to **Monthly**.

Navigate to Daily Spending. Expected: back to standard month nav with no regressions.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: pay period mode on Daily Spending page"
```

---

## Task 3: Update HANDOFF.md

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update HANDOFF.md**

Update the version to `1.7.0`. In the **Core features** list add:
```
- **Daily Spending pay period mode** — spending page respects the global pay period toggle; ◀ Period ▶ nav replaces month nav when active (v1.7.0)
```

In the **Current Progress** section replace the last session block with:
```
### Daily Spending Pay Period Mode (v1.7.0)

When `dashboard_mode === 'pay_period'`, `pages.spending` fetches pay period settings and schedules at load, computes period boundaries via `computePeriods()`, fetches transactions with `from`/`to` params, and shows a period label nav. A banner appears when no primary schedule is configured. Monthly mode is unchanged.

| Area | What changed |
|------|-------------|
| `routes/transactions.js` | Added `from`/`to` query params as alternative to `year`/`month` |
| `public/app.js` | `pages.spending` updated — new `periodIndex` param, pay period render path, banner state |
```

Update **Active Work-in-Progress** to `None.`

- [ ] **Step 2: Bump version in `package.json`**

Change `"version"` from `"1.6.0"` to `"1.7.0"`.

- [ ] **Step 3: Commit**

```bash
git add HANDOFF.md package.json
git commit -m "docs: update handoff and bump version to 1.7.0"
```

---

## Task 4: Push to GitHub

- [ ] **Step 1: Push**

```bash
git push origin main
```

Expected: `main -> main` confirmed in output.
