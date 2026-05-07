# Multi-Account Support — Sub-project A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named bank accounts to FinTrack — users assign transactions, income, and bills to accounts, each showing a live running balance.

**Architecture:** New `accounts` table with nullable `account_id` FK added to transactions, income, bills, and income_schedules via ALTER TABLE. A new `routes/accounts.js` calculates balance per account using inline subqueries. Existing route handlers accept and filter by `account_id`. The frontend adds an Accounts page with a stat-grid of balance cards, an account dropdown on all add forms, and filter pills on the spending page.

**Tech Stack:** Node.js/Express 4, better-sqlite3, Vanilla JS SPA

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `db.js` | `accounts` table; ALTER TABLE on 4 tables; seed default account + migrate existing income |
| Create | `routes/accounts.js` | GET (with balance), POST, PATCH/:id, PATCH/:id/deactivate |
| Modify | `server.js` | Mount `/api/accounts` |
| Modify | `routes/transactions.js` | `account_id` in POST body; `?account_id=` GET filter; JOIN accounts for name/colour |
| Modify | `routes/income.js` | `account_id` in POST body; `?account_id=` GET filter |
| Modify | `routes/income-schedules.js` | `account_id` in POST; pass to auto-generated income rows in `ensureIncomeEntries` |
| Modify | `routes/bills.js` | `account_id` in POST body; `?account_id=` GET filter |
| Modify | `public/index.html` | Add Accounts nav link between Dashboard and Spending |
| Modify | `public/app.js` | `_accounts` cache; `pages.accounts`; `window.deactivateAccount`; spending filter pills + account dropdown + account in list; income form dropdown; bills form dropdown |
| Modify | `package.json` | Bump version to `1.2.0` |

---

### Task 1: DB — accounts table, migrations, seed

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add `accounts` table and four ALTER TABLE migrations**

In `db.js`, after the closing `` `); `` of the second `db.exec(...)` block (the `income_schedules` CREATE, which ends around line 72), and before the `try { db.exec(\`ALTER TABLE income...` block, insert:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    type            TEXT    NOT NULL CHECK(type IN ('current','savings','card')),
    colour          TEXT    NOT NULL DEFAULT '#888888',
    opening_balance REAL    NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

for (const col of [
  `ALTER TABLE transactions     ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE income           ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE bills            ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE income_schedules ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
]) {
  try { db.exec(col); } catch (e) { if (!e.message.includes('duplicate column name')) throw e; }
}
```

- [ ] **Step 2: Add default account seed and income migration**

After the existing category seed block (the `if (countRow.c === 0) { ... }` block, around line 94), add:

```javascript
const acctCount = db.prepare('SELECT COUNT(*) as c FROM accounts').get();
if (acctCount.c === 0) {
  db.prepare(
    `INSERT INTO accounts (name, type, colour, opening_balance) VALUES (?, ?, ?, ?)`
  ).run('Current Account', 'current', '#4a9eff', 0);
}

const defaultAcct = db.prepare(`SELECT id FROM accounts ORDER BY id ASC LIMIT 1`).get();
if (defaultAcct) {
  db.prepare(`UPDATE income SET account_id = ? WHERE account_id IS NULL`).run(defaultAcct.id);
}
```

- [ ] **Step 3: Verify schema**

Run:

```bash
node -e "
const db = require('./db');
console.log('accounts:', db.prepare('SELECT * FROM accounts').all());
console.log('income sample:', db.prepare('SELECT id, account_id FROM income LIMIT 3').all());
console.log('txn cols:', db.prepare('PRAGMA table_info(transactions)').all().map(c=>c.name));
"
```

Expected: `accounts` array with 1 row (Current Account, colour `#4a9eff`). Income rows have `account_id` set to 1. `transactions` columns include `account_id`.

- [ ] **Step 4: Commit**

```bash
git add db.js
git commit -m "feat: accounts table, account_id migrations, default account seed"
```

---

### Task 2: Accounts API

**Files:**
- Create: `routes/accounts.js`
- Modify: `server.js`

- [ ] **Step 1: Create routes/accounts.js**

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');

function calcBalance(accountId, openingBalance) {
  const inc  = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM income WHERE account_id = ?').get(accountId).s;
  const txn  = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE account_id = ?').get(accountId).s;
  const bill = db.prepare(`
    SELECT COALESCE(SUM(bm.amount_paid),0) as s
    FROM bill_months bm JOIN bills b ON bm.bill_id = b.id
    WHERE b.account_id = ? AND bm.paid = 1
  `).get(accountId).s;
  return openingBalance + inc - txn - bill;
}

// GET /api/accounts
router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE active = 1 ORDER BY id ASC').all();
  res.json(accounts.map(a => ({ ...a, balance: calcBalance(a.id, a.opening_balance) })));
});

// POST /api/accounts
router.post('/', (req, res) => {
  const { name, type, colour, opening_balance } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!['current','savings','card'].includes(type))
    return res.status(400).json({ error: 'type must be current, savings, or card' });
  const ob = parseFloat(opening_balance ?? 0);
  if (isNaN(ob)) return res.status(400).json({ error: 'opening_balance must be a number' });
  const result = db.prepare(
    `INSERT INTO accounts (name, type, colour, opening_balance) VALUES (?, ?, ?, ?)`
  ).run(name.trim(), type, colour ?? '#888888', ob);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), type, colour: colour ?? '#888888', opening_balance: ob, balance: ob, active: 1 });
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  const { name, colour, type, opening_balance } = req.body;
  const updName = name !== undefined ? name.trim() : a.name;
  const updColour = colour ?? a.colour;
  const updType = type ?? a.type;
  const updOb = opening_balance !== undefined ? parseFloat(opening_balance) : a.opening_balance;
  if (!['current','savings','card'].includes(updType))
    return res.status(400).json({ error: 'type must be current, savings, or card' });
  if (isNaN(updOb)) return res.status(400).json({ error: 'opening_balance must be a number' });
  db.prepare('UPDATE accounts SET name=?, colour=?, type=?, opening_balance=? WHERE id=?')
    .run(updName, updColour, updType, updOb, req.params.id);
  res.json({ id: Number(req.params.id), name: updName, colour: updColour, type: updType, opening_balance: updOb, balance: calcBalance(a.id, updOb), active: a.active });
});

// PATCH /api/accounts/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE accounts SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Mount in server.js**

Replace the full `server.js` with:

```javascript
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/accounts',          require('./routes/accounts'));
app.use('/api/transactions',      require('./routes/transactions'));
app.use('/api/bills',             require('./routes/bills'));
app.use('/api/bill-months',       require('./routes/bills'));
app.use('/api/income/schedules',  require('./routes/income-schedules').router);
app.use('/api/income',            require('./routes/income'));
app.use('/api/categories',        require('./routes/categories'));
app.use('/api/summary',           require('./routes/summary'));
app.use('/api/calendar',          require('./routes/calendar'));
app.use('/api/update',            require('./routes/update'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinTrack running on http://localhost:${PORT}`));
```

- [ ] **Step 3: Verify**

Start server: `node server.js`

```bash
# List — returns Current Account with balance
curl http://localhost:3000/api/accounts

# Create
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Cash Card","type":"card","colour":"#ff6b6b","opening_balance":0}'

# Edit
curl -X PATCH http://localhost:3000/api/accounts/2 \
  -H "Content-Type: application/json" \
  -d '{"opening_balance":50}'

# Deactivate
curl -X PATCH http://localhost:3000/api/accounts/2/deactivate

# List again — only Current Account
curl http://localhost:3000/api/accounts
```

Expected: GET returns `[{"id":1,"name":"Current Account","balance":...}]`. POST returns 201. PATCH returns updated row with `balance`. Deactivate returns `{"ok":true}`.

Stop server.

- [ ] **Step 4: Commit**

```bash
git add routes/accounts.js server.js
git commit -m "feat: accounts API with balance calculation"
```

---

### Task 3: Transactions — account_id

**Files:**
- Modify: `routes/transactions.js`

- [ ] **Step 1: Replace GET handler**

```javascript
router.get('/', (req, res) => {
  const { year, month, category_id, account_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour,
             a.name as account_name, a.colour as account_colour
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts a ON t.account_id = a.id
             WHERE 1=1`;
  const params = [];
  if (year && month) {
    sql += ` AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (category_id) { sql += ` AND t.category_id = ?`; params.push(category_id); }
  if (account_id)  { sql += ` AND t.account_id = ?`;  params.push(account_id); }
  sql += ` ORDER BY t.date DESC, t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});
```

- [ ] **Step 2: Replace POST handler**

```javascript
router.post('/', (req, res) => {
  const { amount, description, category_id, date, account_id } = req.body;
  if (amount == null || !description || !category_id || !date)
    return res.status(400).json({ error: 'amount, description, category_id, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  try {
    const result = db.prepare(
      'INSERT INTO transactions (amount, description, category_id, date, account_id) VALUES (?, ?, ?, ?, ?)'
    ).run(parsed, description, category_id, date, account_id ?? null);
    res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, category_id, date, account_id: account_id ?? null });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY')
      return res.status(400).json({ error: 'category_id does not exist' });
    throw err;
  }
});
```

- [ ] **Step 3: Verify**

```bash
node server.js
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{"amount":10.50,"description":"Coffee","category_id":2,"date":"2026-05-07","account_id":1}'
curl "http://localhost:3000/api/transactions?account_id=1"
```

Expected: POST returns `account_id: 1`. GET returns entries with `account_name` and `account_colour` fields.

- [ ] **Step 4: Commit**

```bash
git add routes/transactions.js
git commit -m "feat: transactions accept and filter by account_id"
```

---

### Task 4: Income and income-schedules — account_id

**Files:**
- Modify: `routes/income.js`
- Modify: `routes/income-schedules.js`

- [ ] **Step 1: Replace GET handler in routes/income.js**

```javascript
router.get('/', (req, res) => {
  const { year, month, account_id } = req.query;
  if (year && month) ensureIncomeEntries(year, month);
  let sql = 'SELECT * FROM income WHERE 1=1';
  const params = [];
  if (year && month) {
    sql += ` AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (account_id) { sql += ` AND account_id = ?`; params.push(account_id); }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});
```

- [ ] **Step 2: Replace POST handler in routes/income.js**

```javascript
router.post('/', (req, res) => {
  const { amount, description, date, account_id } = req.body;
  if (amount == null || !description || !date)
    return res.status(400).json({ error: 'amount, description, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  const result = db.prepare(
    'INSERT INTO income (amount, description, date, account_id) VALUES (?, ?, ?, ?)'
  ).run(parsed, description, date, account_id ?? null);
  res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, date, account_id: account_id ?? null });
});
```

- [ ] **Step 3: Replace POST handler in routes/income-schedules.js**

```javascript
router.post('/', (req, res) => {
  const { name, amount, frequency, day_of_month, anchor_date, account_id } = req.body;
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
    'INSERT INTO income_schedules (name, amount, frequency, day_of_month, anchor_date, account_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, parsed, frequency, day_of_month ?? null, anchor_date ?? null, account_id ?? null);
  res.status(201).json({
    id: result.lastInsertRowid, name, amount: parsed,
    frequency, day_of_month: day_of_month ?? null, anchor_date: anchor_date ?? null,
    account_id: account_id ?? null, active: 1,
  });
});
```

- [ ] **Step 4: Update ensureIncomeEntries to pass account_id**

In `routes/income-schedules.js`, find all three `db.prepare('INSERT INTO income ...')` calls inside `ensureIncomeEntries`. Change each from `(amount, description, date, source_schedule_id)` to include `account_id`:

Monthly block (around line 33):
```javascript
db.prepare(
  'INSERT INTO income (amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?)'
).run(sched.amount, sched.name, dateStr, sched.id, sched.account_id ?? null);
```

Weekly block (around line 47):
```javascript
db.prepare(
  'INSERT INTO income (amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?)'
).run(sched.amount, sched.name, dateStr, sched.id, sched.account_id ?? null);
```

Four-weekly block (around line 64):
```javascript
db.prepare(
  'INSERT INTO income (amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?)'
).run(sched.amount, sched.name, cur, sched.id, sched.account_id ?? null);
```

- [ ] **Step 5: Verify**

```bash
node server.js
curl -X POST http://localhost:3000/api/income \
  -H "Content-Type: application/json" \
  -d '{"amount":2400,"description":"Salary","date":"2026-05-01","account_id":1}'
curl "http://localhost:3000/api/income?year=2026&month=5"
```

Expected: POST returns `account_id: 1`. GET entries include `account_id` field.

- [ ] **Step 6: Commit**

```bash
git add routes/income.js routes/income-schedules.js
git commit -m "feat: income and schedules accept and filter by account_id"
```

---

### Task 5: Bills — account_id

**Files:**
- Modify: `routes/bills.js`

- [ ] **Step 1: Replace GET handler**

```javascript
router.get('/', (req, res) => {
  const now = new Date();
  const year  = Number(req.query.year  ?? now.getFullYear());
  const month = Number(req.query.month ?? now.getMonth() + 1);
  const { account_id } = req.query;
  ensureBillMonths(year, month);

  let sql = `
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           bm.id as bill_month_id, bm.paid, bm.amount_paid, bm.paid_date
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    LEFT JOIN bill_months bm ON bm.bill_id = b.id AND bm.year = ? AND bm.month = ?
    WHERE 1=1`;
  const params = [year, month];
  if (account_id) { sql += ` AND b.account_id = ?`; params.push(account_id); }
  sql += ` ORDER BY b.active DESC, b.due_day ASC`;
  res.json(db.prepare(sql).all(...params));
});
```

- [ ] **Step 2: Replace POST handler**

```javascript
router.post('/', (req, res) => {
  const { name, amount, due_day, category_id, account_id } = req.body;
  if (!name || amount == null || !due_day || !category_id)
    return res.status(400).json({ error: 'name, amount, due_day, category_id required' });
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).json({ error: 'amount must be a number' });
  const parsedDay = Number(due_day);
  if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31)
    return res.status(400).json({ error: 'due_day must be 1-31' });
  try {
    const result = db.prepare(
      'INSERT INTO bills (name, amount, due_day, category_id, account_id) VALUES (?, ?, ?, ?, ?)'
    ).run(name, parsedAmount, parsedDay, category_id, account_id ?? null);
    res.status(201).json({ id: result.lastInsertRowid, name, amount: parsedAmount, due_day: parsedDay, category_id, account_id: account_id ?? null, active: 1 });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY')
      return res.status(400).json({ error: 'category_id does not exist' });
    throw err;
  }
});
```

- [ ] **Step 3: Verify**

```bash
node server.js
curl -X POST http://localhost:3000/api/bills \
  -H "Content-Type: application/json" \
  -d '{"name":"Rent","amount":750,"due_day":1,"category_id":1,"account_id":1}'
curl "http://localhost:3000/api/bills?year=2026&month=5"
```

Expected: POST returns `account_id: 1`. GET returns bills with `account_id` field.

- [ ] **Step 4: Commit**

```bash
git add routes/bills.js
git commit -m "feat: bills accept and filter by account_id"
```

---

### Task 6: Frontend — sidebar link + _accounts cache

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Add Accounts link to sidebar in index.html**

Replace the `<nav id="sidebar">` block with:

```html
<nav id="sidebar">
  <div class="logo">💰 FinTrack</div>
  <a data-page="dashboard"  class="active">📊 Dashboard</a>
  <a data-page="accounts">🏦 Accounts</a>
  <a data-page="spending">💳 Daily Spending</a>
  <a data-page="bills">📅 Bills</a>
  <a data-page="income">💼 Income</a>
  <a data-page="reports">📈 Reports</a>
  <a data-page="settings">⚙️ Settings</a>
</nav>
```

- [ ] **Step 2: Add _accounts cache to app.js**

After the line `function invalidateCategories() { _categories = []; }` (around line 28), add:

```javascript
let _accounts = [];
async function getAccounts() {
  if (!_accounts.length) _accounts = await api('/accounts');
  return _accounts;
}
function invalidateAccounts() { _accounts = []; }
```

- [ ] **Step 3: Verify**

Start server. Open `http://localhost:3000`. Confirm "🏦 Accounts" link appears between Dashboard and Spending in the sidebar.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: sidebar Accounts link, _accounts cache"
```

---

### Task 7: Frontend — accounts page

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add pages.accounts and window.deactivateAccount**

Add the following block after the closing `}` of the `hexDarken` function:

```javascript
// ── Accounts ──────────────────────────────────────────────────────────────
const ACCT_SWATCHES = ['#4a9eff','#f7a4a2','#ff6b6b','#ffd700','#4ade80','#c39bd3'];

pages.accounts = async function(mode = null, editId = null) {
  invalidateAccounts();
  const accounts = await getAccounts();
  const editAcc = editId ? accounts.find(a => a.id === editId) : null;

  const cardsHtml = accounts.length === 0
    ? '<p style="color:var(--muted)">No accounts yet.</p>'
    : `<div class="stat-grid" style="margin-bottom:20px">${accounts.map(a => `
        <div class="stat-card" style="border-left:3px solid ${a.colour}">
          <div class="label">${a.name}</div>
          <div class="value">${fmt(a.balance)}</div>
          <div class="sub">Opening ${fmt(a.opening_balance)}</div>
          <div style="margin-top:12px">
            <button class="btn btn-ghost btn-sm" onclick="pages.accounts('edit',${a.id})">Edit</button>
          </div>
        </div>`).join('')}</div>`;

  const formAcc = editAcc ?? { name: '', type: 'current', opening_balance: 0, colour: ACCT_SWATCHES[0] };
  const swatchesHtml = ACCT_SWATCHES.map(c => `
    <div class="acct-swatch" data-colour="${c}"
      onclick="window._acctColour='${c}';document.querySelectorAll('.acct-swatch').forEach(s=>s.style.outline='none');this.style.outline='2px solid #fff';this.style.outlineOffset='2px'"
      style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;display:inline-block;${formAcc.colour===c?'outline:2px solid #fff;outline-offset:2px':''}">
    </div>`).join('');

  const formHtml = `
    <div class="card">
      <div class="chart-title" style="margin-bottom:14px">${mode === 'edit' ? 'Edit Account' : 'New Account'}</div>
      <div class="form-row">
        <input type="text"   id="accName"    placeholder="Account name" value="${formAcc.name}" style="flex:2;min-width:160px">
        <select id="accType" style="flex:1;min-width:120px">
          <option value="current" ${formAcc.type==='current'?'selected':''}>Current</option>
          <option value="savings" ${formAcc.type==='savings'?'selected':''}>Savings</option>
          <option value="card"    ${formAcc.type==='card'   ?'selected':''}>Card</option>
        </select>
        <input type="number" id="accOpening" placeholder="Opening balance (£)" value="${formAcc.opening_balance}" step="0.01" style="min-width:170px">
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:12px;color:var(--muted)">Colour:</span>
        ${swatchesHtml}
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="accSaveBtn">${mode === 'edit' ? 'Save Changes' : 'Save Account'}</button>
        <button class="btn btn-ghost" onclick="pages.accounts()">Cancel</button>
        ${mode === 'edit' ? `<button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="deactivateAccount(${editId},'${formAcc.name}')">Deactivate</button>` : ''}
      </div>
    </div>`;

  main().innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Accounts</h1>
      ${mode
        ? `<button class="btn btn-ghost" onclick="pages.accounts()">Cancel</button>`
        : `<button class="btn btn-primary" onclick="pages.accounts('add')">+ Add Account</button>`}
    </div>
    ${cardsHtml}
    ${mode ? formHtml : ''}
  `;

  if (mode) {
    window._acctColour = formAcc.colour;
    $('accSaveBtn').addEventListener('click', async () => {
      const name    = $('accName').value.trim();
      const type    = $('accType').value;
      const opening = parseFloat($('accOpening').value) || 0;
      const colour  = window._acctColour || ACCT_SWATCHES[0];
      if (!name) { $('accName').focus(); return; }
      if (mode === 'edit') {
        await api(`/accounts/${editId}`, { method: 'PATCH', body: { name, type, opening_balance: opening, colour } });
      } else {
        await api('/accounts', { method: 'POST', body: { name, type, opening_balance: opening, colour } });
      }
      pages.accounts();
    });
  }
};

window.deactivateAccount = async function(id, name) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3>Deactivate "${name}"?</h3>
      <p>This account will be hidden. Existing transactions and balances are kept.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="dAccNo">Cancel</button>
        <button class="btn btn-danger" id="dAccYes">Deactivate</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  $('dAccNo').addEventListener('click', () => modal.remove());
  $('dAccYes').addEventListener('click', async () => {
    modal.remove();
    await api(`/accounts/${id}/deactivate`, { method: 'PATCH' });
    pages.accounts();
  });
};
```

- [ ] **Step 2: Verify**

Start server. Click "Accounts" in the sidebar. Check:
- Current Account card shows with balance and opening balance, coloured left border
- `+ Add Account` button visible top right
- Clicking it shows the form with name, type, opening balance, 6 colour swatches, Save/Cancel
- Clicking a swatch highlights it with a white ring
- Saving a new account reloads the page showing the new card
- Edit button pre-fills the form; Deactivate button appears with a confirm modal

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: accounts page with balance cards, add/edit form, deactivate modal"
```

---

### Task 8: Frontend — spending page

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Update pages.spending signature and fetches**

Find `pages.spending = async function (year, month, categoryId = null) {` and the `Promise.all` block immediately after. Replace those lines with:

```javascript
pages.spending = async function (year, month, categoryId = null, accountId = null) {
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
```

- [ ] **Step 2: Replace main().innerHTML in pages.spending**

Replace the entire `main().innerHTML = \`...\`` assignment (from the opening backtick to the closing backtick + semicolon) with:

```javascript
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
          <span style="width:8px;height:8px;border-radius:50%;background:${a.colour};display:inline-block;flex-shrink:0"></span>${a.name}
        </button>`).join('')}
    </div>
    <div class="card" style="margin-bottom:20px">
      <form id="txnForm" class="form-row" style="margin:0">
        <input type="number" id="txnAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="text"   id="txnDesc"   placeholder="Description" style="flex:1;min-width:160px" required>
        <select id="txnCat"  style="flex:1;min-width:140px">${catOptions}</select>
        <select id="txnAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}" ${accountId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
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
                <span class="desc">${t.description}
                  <br><span style="color:var(--muted);font-size:12px">${t.category_name} · <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${t.account_colour ?? 'var(--muted)'};vertical-align:middle;margin-right:3px"></span>${t.account_name ?? 'Unassigned'}</span>
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
```

- [ ] **Step 3: Update all event listeners in pages.spending**

Replace the form submit listener:

```javascript
  $('txnForm').addEventListener('submit', async e => {
    e.preventDefault();
    await api('/transactions', { method: 'POST', body: {
      amount: parseFloat($('txnAmount').value),
      description: $('txnDesc').value,
      category_id: Number($('txnCat').value),
      account_id: Number($('txnAcct').value) || null,
      date: $('txnDate').value,
    }});
    pages.spending(year, month, categoryId, accountId);
  });
```

Replace the catFilter listener:

```javascript
  $('catFilter').addEventListener('change', () => {
    const catId = $('catFilter').value;
    pages.spending(year, month, catId ? Number(catId) : null, accountId);
  });
```

Replace the prevMonth / nextMonth listeners:

```javascript
  $('prevMonth').addEventListener('click', () => {
    const d = new Date(year, month - 2, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
  });
  $('nextMonth').addEventListener('click', () => {
    const d = new Date(year, month, 1);
    pages.spending(d.getFullYear(), d.getMonth() + 1, categoryId, accountId);
  });
```

- [ ] **Step 4: Verify**

Start server. Navigate to Daily Spending. Check:
- Account filter pills row shows "All" + one pill per account
- "All" is highlighted by default
- Add transaction form has an Account dropdown
- Adding a transaction shows `Category · ● Account Name` on the second line of the list item
- Transactions for unassigned entries show `· Unassigned`
- Clicking an account pill re-fetches and filters the list
- Month nav preserves the selected account pill

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: spending — account filter pills, dropdown on form, account in list items"
```

---

### Task 9: Frontend — income and bills form dropdowns

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add accounts to pages.income Promise.all**

Find in `pages.income`:

```javascript
  const [entries, schedules] = await Promise.all([
    api(`/income?year=${year}&month=${month}`),
    api('/income/schedules'),
  ]);
```

Replace with:

```javascript
  const [entries, schedules, accounts] = await Promise.all([
    api(`/income?year=${year}&month=${month}`),
    api('/income/schedules'),
    getAccounts(),
  ]);
```

- [ ] **Step 2: Add account dropdown to one-off income form**

Find the one-off form HTML (inside the `${mode === 'oneoff' ? \`...\` : \`...\`}` block):

```javascript
        <form id="incForm" class="form-row" style="margin:0">
          <input type="number" id="incAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
          <input type="text"   id="incDesc"   placeholder="Source / description" style="flex:1" required>
          <input type="date"   id="incDate"   value="${toDateInput(now)}" style="width:150px" required>
          <button class="btn btn-primary" type="submit">Add Income</button>
        </form>
```

Replace with:

```javascript
        <form id="incForm" class="form-row" style="margin:0">
          <input type="number" id="incAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:140px" required>
          <input type="text"   id="incDesc"   placeholder="Source / description" style="flex:1" required>
          <select id="incAcct" style="min-width:160px">
            ${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
          </select>
          <input type="date"   id="incDate"   value="${toDateInput(now)}" style="width:150px" required>
          <button class="btn btn-primary" type="submit">Add Income</button>
        </form>
```

- [ ] **Step 3: Add account dropdown to recurring schedule form**

In the recurring form, find the closing `</select>` of `schedFreq` and the `<div id="schedFreqFields"...>` line. Insert the account select between them:

```javascript
          <select id="schedFreq" style="min-width:190px" onchange="renderFreqFields()">
            <option value="monthly">Specific day each month</option>
            <option value="weekly">Weekly</option>
            <option value="four_weekly">Every 4 weeks</option>
          </select>
          <select id="schedAcct" style="min-width:160px">
            ${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
          </select>
          <div id="schedFreqFields" style="display:contents"></div>
          <button class="btn btn-primary" type="submit">Add Schedule</button>
```

- [ ] **Step 4: Update one-off form submit to include account_id**

Find in `pages.income` (inside the `if (mode === 'oneoff')` block):

```javascript
      await api('/income', { method: 'POST', body: {
        amount: parseFloat($('incAmount').value),
        description: $('incDesc').value,
        date: $('incDate').value,
      }});
```

Replace with:

```javascript
      await api('/income', { method: 'POST', body: {
        amount: parseFloat($('incAmount').value),
        description: $('incDesc').value,
        account_id: Number($('incAcct').value) || null,
        date: $('incDate').value,
      }});
```

- [ ] **Step 5: Update recurring form submit to include account_id**

Find in `pages.income` (inside the `if (mode === 'recurring')` block):

```javascript
      const body = {
        name: $('schedName').value,
        amount: parseFloat($('schedAmount').value),
        frequency: freq,
      };
```

Replace with:

```javascript
      const body = {
        name: $('schedName').value,
        amount: parseFloat($('schedAmount').value),
        frequency: freq,
        account_id: Number($('schedAcct').value) || null,
      };
```

- [ ] **Step 6: Add accounts to pages.bills Promise.all**

Find in `pages.bills`:

```javascript
  const [cats, bills] = await Promise.all([
    getCategories(),
    api(`/bills?year=${year}&month=${month}`),
  ]);
```

Replace with:

```javascript
  const [cats, bills, accounts] = await Promise.all([
    getCategories(),
    api(`/bills?year=${year}&month=${month}`),
    getAccounts(),
  ]);
```

- [ ] **Step 7: Add account dropdown to bill add form**

Find:

```javascript
      <form id="billForm" class="form-row" style="margin:0">
        <input type="text"   id="bName"   placeholder="Bill name" style="flex:1" required>
        <input type="number" id="bAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:110px" required>
        <input type="number" id="bDay"    placeholder="Due day" min="1" max="31" style="width:90px" required>
        <select id="bCat" style="flex:1">${catOptions}</select>
        <button class="btn btn-primary" type="submit">Add Bill</button>
      </form>
```

Replace with:

```javascript
      <form id="billForm" class="form-row" style="margin:0">
        <input type="text"   id="bName"   placeholder="Bill name" style="flex:1" required>
        <input type="number" id="bAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:110px" required>
        <input type="number" id="bDay"    placeholder="Due day" min="1" max="31" style="width:90px" required>
        <select id="bCat"  style="flex:1">${catOptions}</select>
        <select id="bAcct" style="min-width:160px">
          ${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
        </select>
        <button class="btn btn-primary" type="submit">Add Bill</button>
      </form>
```

- [ ] **Step 8: Update bill form submit to include account_id**

Find:

```javascript
    await api('/bills', { method: 'POST', body: {
      name: $('bName').value,
      amount: parseFloat($('bAmount').value),
      due_day: Number($('bDay').value),
      category_id: Number($('bCat').value),
    }});
```

Replace with:

```javascript
    await api('/bills', { method: 'POST', body: {
      name: $('bName').value,
      amount: parseFloat($('bAmount').value),
      due_day: Number($('bDay').value),
      category_id: Number($('bCat').value),
      account_id: Number($('bAcct').value) || null,
    }});
```

- [ ] **Step 9: Verify**

Start server. Check:
1. Income → one-off: Account dropdown visible. Add an entry and confirm it appears with the correct account assigned (check via curl or browser).
2. Income → recurring: Account dropdown visible in schedule form.
3. Bills: Account dropdown visible in add bill form.

- [ ] **Step 10: Commit**

```bash
git add public/app.js
git commit -m "feat: account dropdowns on income and bills add forms"
```

---

### Task 10: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "1.1.1"` to `"version": "1.2.0"`.

- [ ] **Step 2: Commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 1.2.0"
git tag v1.2.0
```
