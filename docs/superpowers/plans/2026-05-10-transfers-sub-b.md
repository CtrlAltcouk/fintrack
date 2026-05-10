# Transfers Between Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Transfers page where users can move money between accounts, with full transfer history and correct balance impact on both accounts.

**Architecture:** New `transfers` table in SQLite; dedicated `routes/transfers.js` for GET/POST/DELETE; balance formula in `routes/accounts.js` gains two new terms (credit to destination, debit from source); new `pages.transfers` in `public/app.js` following the same pattern as `pages.bills`.

**Tech Stack:** Node.js, Express 4, better-sqlite3 (synchronous), vanilla JS SPA, no test framework (verify via curl + browser).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `db.js` | Modify | Add `transfers` table DDL |
| `routes/transfers.js` | Create | GET / POST / DELETE endpoints |
| `routes/accounts.js` | Modify | Add transfer terms to balance formula |
| `routes/update.js` | Modify | Add `DELETE FROM transfers` to clear-data |
| `server.js` | Modify | Mount `/api/transfers` route |
| `public/index.html` | Modify | Add 🔁 Transfers sidebar entry |
| `public/app.js` | Modify | Add `pages.transfers` + `window.deleteTransfer` |
| `package.json` | Modify | Bump version to 1.3.0 |

---

### Task 1: Database — add transfers table

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add the transfers table DDL to `db.js`**

In `db.js`, after the existing `db.exec(...)` block that creates the `accounts` table (around line 84), add a new `db.exec()` call:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS transfers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
    amount          REAL    NOT NULL,
    date            TEXT    NOT NULL,
    note            TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);
```

- [ ] **Step 2: Verify the table is created**

Restart the server (`npm run dev` or your usual start command), then run:

```bash
node -e "const db = require('./db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='transfers'\").get());"
```

Expected output:
```
{ name: 'transfers' }
```

- [ ] **Step 3: Commit**

```bash
git add db.js
git commit -m "feat: add transfers table"
```

---

### Task 2: Transfers API

**Files:**
- Create: `routes/transfers.js`

- [ ] **Step 1: Create `routes/transfers.js`**

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');

const stmtList = db.prepare(`
  SELECT t.id, t.from_account_id, t.to_account_id, t.amount, t.date, t.note, t.created_at,
         fa.name as from_account_name, fa.colour as from_account_colour,
         ta.name as to_account_name,   ta.colour as to_account_colour
  FROM transfers t
  JOIN accounts fa ON fa.id = t.from_account_id
  JOIN accounts ta ON ta.id = t.to_account_id
  ORDER BY t.date DESC, t.id DESC
`);

// GET /api/transfers
router.get('/', (_req, res) => {
  res.json(stmtList.all());
});

// POST /api/transfers
router.post('/', (req, res) => {
  const { from_account_id, to_account_id, amount, date, note } = req.body;

  const amt = parseFloat(amount);
  if (!amount || isNaN(amt) || amt <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' });
  if (!date || !String(date).trim())
    return res.status(400).json({ error: 'date required' });
  if (!from_account_id || !to_account_id)
    return res.status(400).json({ error: 'from_account_id and to_account_id required' });
  if (Number(from_account_id) === Number(to_account_id))
    return res.status(400).json({ error: 'from and to accounts must be different' });

  const fromAcct = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1').get(from_account_id);
  const toAcct   = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1').get(to_account_id);
  if (!fromAcct || !toAcct)
    return res.status(400).json({ error: 'invalid or inactive account' });

  const result = db.prepare(
    'INSERT INTO transfers (from_account_id, to_account_id, amount, date, note) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(from_account_id), Number(to_account_id), amt, String(date).trim(), note ?? null);

  const created = db.prepare('SELECT * FROM transfers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// DELETE /api/transfers/:id
router.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT id FROM transfers WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM transfers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Mount the route in `server.js`**

In `server.js`, add the transfers mount after the accounts line:

```javascript
app.use('/api/accounts',          require('./routes/accounts'));
app.use('/api/transfers',         require('./routes/transfers'));
```

- [ ] **Step 3: Verify GET returns empty array**

```bash
curl -s http://localhost:3000/api/transfers
```

Expected: `[]`

- [ ] **Step 4: Verify POST creates a transfer**

First get your account IDs:
```bash
curl -s http://localhost:3000/api/accounts | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); d.forEach(a=>console.log(a.id, a.name));"
```

Then create a transfer (replace `1` and `2` with your actual account IDs):
```bash
curl -s -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d '{"from_account_id":1,"to_account_id":2,"amount":100,"date":"2026-05-10","note":"test"}'
```

Expected: `{"id":1,"from_account_id":1,"to_account_id":2,"amount":100,"date":"2026-05-10","note":"test","created_at":"..."}`

- [ ] **Step 5: Verify validation rejects same-account transfer**

```bash
curl -s -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d '{"from_account_id":1,"to_account_id":1,"amount":50,"date":"2026-05-10"}'
```

Expected: `{"error":"from and to accounts must be different"}`

- [ ] **Step 6: Verify DELETE removes the transfer**

```bash
curl -s -X DELETE http://localhost:3000/api/transfers/1
```

Expected: `{"ok":true}`

Then confirm it's gone:
```bash
curl -s http://localhost:3000/api/transfers
```

Expected: `[]`

- [ ] **Step 7: Commit**

```bash
git add routes/transfers.js server.js
git commit -m "feat: transfers API — GET, POST, DELETE"
```

---

### Task 3: Balance formula — include transfers

**Files:**
- Modify: `routes/accounts.js`

- [ ] **Step 1: Add two new prepared statements at module scope in `routes/accounts.js`**

After the existing `stmtBalBill` declaration (around line 11), add:

```javascript
const stmtBalTxfTo   = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE to_account_id = ?');
const stmtBalTxfFrom = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE from_account_id = ?');
```

- [ ] **Step 2: Update `calcBalance` to include transfer terms**

Replace the existing `calcBalance` function:

```javascript
function calcBalance(accountId, openingBalance) {
  return openingBalance
    + stmtBalInc.get(accountId).s
    - stmtBalTxn.get(accountId).s
    - stmtBalBill.get(accountId).s
    + stmtBalTxfTo.get(accountId).s
    - stmtBalTxfFrom.get(accountId).s;
}
```

- [ ] **Step 3: Verify balance changes correctly**

Create a transfer of £100 from account 1 to account 2:

```bash
curl -s -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d '{"from_account_id":1,"to_account_id":2,"amount":100,"date":"2026-05-10"}'
```

Check balances:

```bash
curl -s http://localhost:3000/api/accounts
```

Account 1's balance should be £100 lower and account 2's balance should be £100 higher than before the transfer.

- [ ] **Step 4: Commit**

```bash
git add routes/accounts.js
git commit -m "feat: include transfers in account balance calculation"
```

---

### Task 4: Clear-data includes transfers

**Files:**
- Modify: `routes/update.js`

- [ ] **Step 1: Add `DELETE FROM transfers` to the clear-data handler in `routes/update.js`**

Find the `POST /api/update/clear-data` handler. It currently reads:

```javascript
router.post('/clear-data', (req, res) => {
  const db = require('../db');
  db.prepare('DELETE FROM bill_months').run();
  db.prepare('DELETE FROM bills').run();
  db.prepare('DELETE FROM income').run();
  db.prepare('DELETE FROM income_schedules').run();
  db.prepare('DELETE FROM transactions').run();
  db.prepare('DELETE FROM accounts').run();
  res.json({ ok: true });
});
```

Add `DELETE FROM transfers` before `DELETE FROM accounts` (transfers reference accounts via FK, so must be deleted first):

```javascript
router.post('/clear-data', (req, res) => {
  const db = require('../db');
  db.prepare('DELETE FROM bill_months').run();
  db.prepare('DELETE FROM bills').run();
  db.prepare('DELETE FROM income').run();
  db.prepare('DELETE FROM income_schedules').run();
  db.prepare('DELETE FROM transactions').run();
  db.prepare('DELETE FROM transfers').run();
  db.prepare('DELETE FROM accounts').run();
  res.json({ ok: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add routes/update.js
git commit -m "fix: clear-data also deletes transfers"
```

---

### Task 5: Sidebar navigation entry

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add the Transfers link in `public/index.html`**

Find the sidebar nav. It currently reads:

```html
<a data-page="accounts">🏦 Accounts</a>
<a data-page="spending">💳 Daily Spending</a>
```

Add the Transfers link between Accounts and Spending:

```html
<a data-page="accounts">🏦 Accounts</a>
<a data-page="transfers">🔁 Transfers</a>
<a data-page="spending">💳 Daily Spending</a>
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:3000 — the sidebar should now show "🔁 Transfers" between Accounts and Daily Spending. Clicking it should render nothing (page not implemented yet) without errors in the console.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add Transfers entry to sidebar"
```

---

### Task 6: Frontend — pages.transfers

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `pages.transfers` to `public/app.js`**

Add this block after the `// ── Income` section (after `window.deleteIncome`) and before the `// ── Reports` section:

```javascript
// ── Transfers ─────────────────────────────────────────────────────────────
pages.transfers = async function () {
  const [transfers, accounts] = await Promise.all([
    api('/transfers'),
    getAccounts(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const acctOptions = accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');

  main().innerHTML = `
    <div class="page-header"><h1 class="page-title">Transfers</h1></div>

    <div class="card" style="margin-bottom:20px">
      <form id="txfrForm" class="form-row" style="margin:0;flex-wrap:wrap">
        <select id="txfrFrom" style="min-width:160px" required>${acctOptions}</select>
        <span style="color:var(--muted);font-size:18px;align-self:center">→</span>
        <select id="txfrTo" style="min-width:160px" required>${acctOptions}</select>
        <input type="number" id="txfrAmount" placeholder="Amount £" min="0.01" step="0.01" style="width:120px" required>
        <input type="date"   id="txfrDate"   value="${today}" style="width:150px" required>
        <input type="text"   id="txfrNote"   placeholder="Note (optional)" style="flex:1;min-width:160px">
        <button class="btn btn-primary" type="submit">Transfer</button>
      </form>
    </div>

    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">History</div>
      <div class="list" id="txfrList">
        ${transfers.length === 0
          ? '<p style="color:var(--muted)">No transfers yet.</p>'
          : transfers.map(t => `
            <div class="list-item" id="txfr-${t.id}">
              <span class="dot" style="background:${esc(t.from_account_colour)}"></span>
              <span style="font-size:13px">${esc(t.from_account_name)}</span>
              <span style="color:var(--muted)">→</span>
              <span class="dot" style="background:${esc(t.to_account_colour)}"></span>
              <span class="desc">${esc(t.to_account_name)}${t.note ? ` <span style="color:var(--muted);font-size:12px">${esc(t.note)}</span>` : ''}</span>
              <span class="date">${formatDate(t.date)}</span>
              <span class="amount">${fmt(t.amount)}</span>
              <button class="btn btn-danger btn-sm" onclick="deleteTransfer(${t.id})">Del</button>
            </div>`).join('')}
      </div>
    </div>
  `;

  $('txfrForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fromId = Number($('txfrFrom').value);
    const toId   = Number($('txfrTo').value);
    if (fromId === toId) {
      alert('From and To accounts must be different.');
      return;
    }
    await api('/transfers', { method: 'POST', body: {
      from_account_id: fromId,
      to_account_id:   toId,
      amount:          parseFloat($('txfrAmount').value),
      date:            $('txfrDate').value,
      note:            $('txfrNote').value || null,
    }});
    invalidateAccounts();
    pages.transfers();
  });
};

window.deleteTransfer = async function (id) {
  if (!confirm('Delete this transfer?')) return;
  await api(`/transfers/${id}`, { method: 'DELETE' });
  invalidateAccounts();
  document.getElementById(`txfr-${id}`)?.remove();
  const list = document.getElementById('txfrList');
  if (list && list.children.length === 0)
    list.innerHTML = '<p style="color:var(--muted)">No transfers yet.</p>';
};
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:3000 and click 🔁 Transfers. You should see:
- A form row with two account dropdowns, amount, date (defaulting to today), note, and Transfer button
- An empty "No transfers yet." history

- [ ] **Step 3: Create a transfer via the form**

Pick two different accounts, enter an amount, click Transfer. Verify:
- The transfer appears in the history list with correct from → to, amount, and date
- Navigating to Accounts shows the source account balance decreased and destination increased by that amount

- [ ] **Step 4: Delete a transfer**

Click Del on the transfer you just created. Confirm the dialog. Verify:
- The row is removed from the history
- Accounts balances return to their previous values

- [ ] **Step 5: Verify the same-account guard**

Select the same account in both From and To, click Transfer. An alert should appear: "From and To accounts must be different."

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: Transfers page — form, history, delete"
```

---

### Task 7: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version in `package.json`**

Change `"version": "1.2.0"` to `"version": "1.3.0"`.

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 1.3.0"
```
