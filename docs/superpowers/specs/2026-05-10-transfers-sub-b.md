# FinTrack v1.3.0: Transfers Between Accounts (Sub-project B)

## Overview

Users can move money between their defined accounts (e.g. Current → Savings). Transfers affect account balances correctly — debiting the source and crediting the destination — without appearing as spending transactions or income entries.

---

## Database

### New table: `transfers`

```sql
CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount          REAL    NOT NULL,
  date            TEXT    NOT NULL,
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

Added via `db.exec()` in `db.js` using the same `CREATE TABLE IF NOT EXISTS` pattern as all other tables.

### Balance formula update

The existing balance formula in `routes/accounts.js` gains two new terms:

```
balance = opening_balance
        + SUM(income WHERE account_id = ?)
        - SUM(transactions WHERE account_id = ?)
        - SUM(paid bill_months WHERE bill.account_id = ?)
        + SUM(transfers WHERE to_account_id = ?)
        - SUM(transfers WHERE from_account_id = ?)
```

Two new prepared statements are added at module scope alongside the existing `stmtBalInc`, `stmtBalTxn`, `stmtBalBill`:

```javascript
const stmtBalTxfTo   = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE to_account_id = ?');
const stmtBalTxfFrom = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE from_account_id = ?');
```

---

## API — `routes/transfers.js`

Mounted at `/api/transfers` in `server.js`.

### `GET /api/transfers`

Returns all transfers newest-first, joined with account names and colours for display.

```json
[
  {
    "id": 1,
    "from_account_id": 1,
    "from_account_name": "Current Account",
    "from_account_colour": "#4a9eff",
    "to_account_id": 2,
    "to_account_name": "Savings",
    "to_account_colour": "#4ade80",
    "amount": 500.00,
    "date": "2026-05-10",
    "note": "monthly savings move",
    "created_at": "2026-05-10T12:00:00"
  }
]
```

### `POST /api/transfers`

Body: `{ from_account_id, to_account_id, amount, date, note? }`

Validation:
- `amount` must be a positive number
- `from_account_id` and `to_account_id` must both be valid, active account IDs
- `from_account_id` must not equal `to_account_id`
- `date` must be a non-empty string

Returns `201` with `{ id, from_account_id, to_account_id, amount, date, note, created_at }` on success.
Returns `400` with `{ error: '...' }` on validation failure.

### `DELETE /api/transfers/:id`

Deletes the transfer. Returns `{ ok: true }`. Returns `404` if not found.

---

## Clear-data

`routes/update.js` `POST /api/update/clear-data` gets `DELETE FROM transfers` added (before `DELETE FROM accounts`).

---

## Frontend

### Sidebar

`public/index.html` gets a new nav entry between Accounts and Spending:

```html
<a data-page="transfers">🔁 Transfers</a>
```

### `pages.transfers` in `public/app.js`

Follows the same `pages.bills` / `pages.income` pattern.

**Structure:**

```
[ From ▾ ] → [ To ▾ ]  [ £0.00 ]  [ 2026-05-10 ]  [ optional note ]  [ Transfer ]

──── HISTORY ────────────────────────────────────────────────────
● Current  →  ● Savings   £500.00   10 May 2026   monthly savings   🗑
● Savings  →  ● Current   £200.00    3 May 2026                     🗑
```

**Form fields:**
- `#txfrFrom` — account select, populated from `getAccounts()`
- `#txfrTo` — account select, populated from `getAccounts()`
- `#txfrAmount` — number input, `min="0.01"`, `step="0.01"`
- `#txfrDate` — date input, defaults to today (`new Date().toISOString().slice(0,10)`)
- `#txfrNote` — text input, optional, placeholder "Note (optional)"
- Submit button calls `POST /api/transfers`, then refreshes history and invalidates accounts cache via `invalidateAccounts()`

**History list:**
- Loaded via `GET /api/transfers` on page render
- Each row: coloured dot + from account name → coloured dot + to account name, formatted amount, formatted date, note (if set), delete button
- Delete button calls `DELETE /api/transfers/:id`, confirms with a brief `confirm()` dialog, then refreshes history and calls `invalidateAccounts()`
- XSS: all user-supplied strings rendered via `esc()`. Account IDs (not names) passed in `onclick` handlers.

**Empty state:** "No transfers yet" when history is empty.

---

## Version

`package.json` version bumped to `1.3.0`.

---

## Out of Scope

- Editing a transfer (delete and re-create instead)
- Filtering transfer history by account or date
- Transfers appearing on the Dashboard summary
