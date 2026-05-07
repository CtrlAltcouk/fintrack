# FinTrack — Multi-Account Support (Sub-project A)

**Date:** 2026-05-07
**Version target:** 1.2.0
**Status:** Approved

---

## Overview

Users can define multiple bank accounts (current, savings, card). Every transaction, income entry, and bill is assigned to an account. Each account displays a live running balance. This is Sub-project A — account management and assignment. Transfers between accounts are Sub-project B (separate spec).

---

## Database

### New table: `accounts`

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  type            TEXT    NOT NULL CHECK(type IN ('current','savings','card')),
  colour          TEXT    NOT NULL DEFAULT '#888888',
  opening_balance REAL    NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### Migrations (ALTER TABLE)

Add nullable `account_id` to four existing tables. Each uses the same try/catch duplicate-column pattern already in `db.js`:

```sql
ALTER TABLE transactions      ADD COLUMN account_id INTEGER REFERENCES accounts(id);
ALTER TABLE income            ADD COLUMN account_id INTEGER REFERENCES accounts(id);
ALTER TABLE bills             ADD COLUMN account_id INTEGER REFERENCES accounts(id);
ALTER TABLE income_schedules  ADD COLUMN account_id INTEGER REFERENCES accounts(id);
```

### Seed / migration logic (runs on every start)

1. If the `accounts` table is empty, insert a default "Current Account" (type `current`, colour `#4a9eff`, opening_balance `0`).
2. After ensuring the default account exists, set `account_id` to its `id` on all `income` rows where `account_id IS NULL`.

This means users who already have data are silently migrated — all existing income is assigned to "Current Account". Existing transactions and bills remain `NULL` (unassigned) and will appear under "All" in filters but not under any specific account.

---

## Balance Formula

Calculated server-side per account:

```
balance = opening_balance
        + COALESCE(SUM of income.amount WHERE account_id = ?)
        - COALESCE(SUM of transactions.amount WHERE account_id = ?)
        - COALESCE(SUM of bill_months.amount_paid WHERE bill account_id = ? AND paid = 1)
```

---

## API Routes

All new routes live in a new file `routes/accounts.js`, mounted at `/api/accounts` in `server.js`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/accounts` | List all active accounts with calculated balance |
| POST | `/api/accounts` | Create a new account |
| PATCH | `/api/accounts/:id` | Edit name, colour, type, or opening_balance |
| PATCH | `/api/accounts/:id/deactivate` | Soft-delete (sets `active = 0`) |

### GET `/api/accounts` response shape

```json
[
  {
    "id": 1,
    "name": "Current Account",
    "type": "current",
    "colour": "#4a9eff",
    "opening_balance": 1200.00,
    "balance": 843.50,
    "active": 1
  }
]
```

### POST `/api/accounts` request body

```json
{ "name": "Cash Card", "type": "card", "colour": "#ff6b6b", "opening_balance": 0 }
```

Validation: `name` required and non-empty; `type` must be one of `current`, `savings`, `card`; `opening_balance` must be a finite number (defaults to 0 if omitted).

### PATCH `/api/accounts/:id` request body

Any subset of `name`, `colour`, `type`, `opening_balance`. Returns updated account row with balance.

### PATCH `/api/accounts/:id/deactivate`

Sets `active = 0`. Returns `{ ok: true }`. Does not delete data — existing assignments remain.

### Changes to existing endpoints

Each of the following endpoints gains:
- Optional `account_id` field accepted in POST/PATCH request bodies (stored as-is, `null` if omitted)
- Optional `?account_id=<id>` query parameter on GET routes — filters results to that account only; omitting returns all

Affected endpoints: `/api/transactions`, `/api/income`, `/api/bills`, `/api/income/schedules`

---

## UI

### Sidebar

Add **Accounts** link in the sidebar navigation, between Dashboard and Spending.

### Accounts Page (`pages.accounts`)

**Layout:**
- Page header: `Accounts` title left, `+ Add Account` button (`.btn-primary`) right
- Account cards in a `stat-grid` (3-column responsive grid), one card per active account
- Each card: coloured left border (3px solid, account colour), account name as `.label`, balance as `.value`, opening balance as `.sub`, `Edit` button (`.btn-ghost.btn-sm`)
- Clicking `+ Add Account` toggles a form card below the grid; button changes to `Cancel`
- Clicking `Edit` on a card populates the same form for editing (button becomes `Save Changes`)

**Add/Edit form fields:**
- Account name (text input)
- Type (select: Current / Savings / Card)
- Opening balance (number input, £)
- Colour (row of 6 preset circle swatches: `#4a9eff`, `#f7a4a2`, `#ff6b6b`, `#ffd700`, `#4ade80`, `#c39bd3`). Clicking a swatch selects it (white outlined ring). A hidden input stores the hex value.

**Deactivate:** small `Deactivate` link (danger colour) on each edit form, shows a confirm modal before calling `PATCH /api/accounts/:id/deactivate`.

### Account dropdown on forms

Add an **Account** dropdown (`<select>`) to:
- Add Transaction form
- Add Income form (one-off mode only — recurring schedules also get it)
- Add Bill form

The select is populated by fetching `/api/accounts` when the page loads. It shows account name with a colour dot prefix. Default selection is the first account in the list (typically "Current Account"). `account_id` is included in every POST body.

### Spending page filter

Above the existing month navigation on the Spending page, add a row of filter pills:
- **All** (default, selected state: accent border + faint accent background)
- One pill per active account (colour dot + name, unselected state: ghost border + muted text)

Selecting a pill re-fetches transactions with `?account_id=<id>` and re-renders the list. "All" clears the filter. Only one pill active at a time.

### Transaction list items

Each `.list-item` gains a second line below the description showing:
`<category name> · <colour dot> <account name>`

If `account_id` is `null`, show `· Unassigned` in muted text.

---

## Out of Scope

- Transfers between accounts (Sub-project B)
- Per-account summary/chart breakdowns on the Dashboard
- Editing or reassigning historical transactions in bulk
- Deleting accounts (deactivate only)
