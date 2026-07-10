# FinTrack — Personal Finance App Design Spec

**Date:** 2026-05-05  
**Status:** Approved

---

## Overview

A self-hosted personal finance web app running in a Debian 12 LXC container on Proxmox. Accessible from any device on the local network. Tracks income, daily spending, and recurring monthly bills. Presents data via a dark-themed dashboard with charts.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express.js |
| Database | SQLite via `better-sqlite3` |
| Frontend | Vanilla HTML / CSS / JS |
| Charts | Chart.js |
| Process manager | pm2 |
| Host | Proxmox LXC (Debian 12, ~512MB RAM) |
| Port | 3000 |

No build step. Express serves static files from `public/`. Single-page app with client-side routing via sidebar navigation.

---

## Design

- **Theme:** Dark mode
- **Primary accent:** `#f7a4a2` (soft pink/rose)
- **Text:** White (`#ffffff`) and muted grey (`#888888`)
- **Backgrounds:** `#111111` (page), `#1a1a1a` (cards), `#2a2a2a` (borders)

---

## Database Schema

### `categories`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | e.g. "Groceries" |
| colour | TEXT | Hex colour string |
| created_at | TEXT | ISO timestamp |

### `transactions`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| amount | REAL | Positive number, GBP |
| description | TEXT | |
| category_id | INTEGER FK | → categories |
| date | TEXT | YYYY-MM-DD |
| created_at | TEXT | ISO timestamp |

### `income`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| amount | REAL | GBP |
| description | TEXT | e.g. "Salary", "Freelance" |
| date | TEXT | YYYY-MM-DD |
| created_at | TEXT | ISO timestamp |

### `bills`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | e.g. "Rent", "Electric" |
| amount | REAL | Expected monthly amount, GBP |
| due_day | INTEGER | Day of month (1–31) |
| category_id | INTEGER FK | → categories |
| active | INTEGER | 1 = active, 0 = cancelled |
| created_at | TEXT | ISO timestamp |
| cancelled_at | TEXT | NULL if still active |

### `bill_months`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| bill_id | INTEGER FK | → bills |
| year | INTEGER | |
| month | INTEGER | 1–12 |
| paid | INTEGER | 0 = unpaid, 1 = paid |
| amount_paid | REAL | Actual amount paid (may differ from bill.amount) |
| paid_date | TEXT | NULL until paid |

**Bill generation rule:** On every request to `/api/bills` or `/api/summary`, the server checks all `active = 1` bills and creates a `bill_months` record for the current year/month if one doesn't already exist. This means bills appear correctly even if the user doesn't open the app on the 1st of the month. Cancelling a bill sets `active = 0` and records `cancelled_at` — no new `bill_months` records are created after that point, but all historical records are preserved.

**due_day edge case:** If `due_day` exceeds the number of days in a given month (e.g. due_day = 31 in June), the last day of that month is used when displaying the due date.

---

## File Structure

```
fintrack/
├── server.js              # Express entry point, static file serving
├── db.js                  # SQLite init, schema creation, seed categories
├── routes/
│   ├── transactions.js    # CRUD for daily spending
│   ├── bills.js           # Bill management + bill_months
│   ├── income.js          # CRUD for income entries
│   ├── categories.js      # CRUD for categories
│   └── summary.js         # Dashboard aggregation queries
├── public/
│   ├── index.html         # Shell: sidebar nav + content area
│   ├── style.css          # Dark theme, colour variables
│   └── app.js             # Page rendering, API calls, Chart.js setup
├── data/
│   └── fintrack.db        # SQLite database (gitignored)
└── package.json
```

---

## API Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/summary/:year/:month` | Dashboard totals: income, spent, remaining, bills status |
| GET | `/api/transactions` | List transactions (query: `?year=&month=&category_id=`) |
| POST | `/api/transactions` | Add transaction |
| PUT | `/api/transactions/:id` | Edit transaction |
| DELETE | `/api/transactions/:id` | Delete transaction |
| GET | `/api/bills` | List all bills with current month status |
| POST | `/api/bills` | Add new recurring bill |
| PATCH | `/api/bills/:id/cancel` | Cancel bill (sets active=0, preserves history) |
| POST | `/api/bill-months/:id/pay` | Mark bill month as paid (with actual amount) |
| GET | `/api/income` | List income (query: `?year=&month=`) |
| POST | `/api/income` | Add income entry |
| DELETE | `/api/income/:id` | Delete income entry |
| GET | `/api/categories` | List all categories |
| POST | `/api/categories` | Add category |
| PUT | `/api/categories/:id` | Edit category |
| DELETE | `/api/categories/:id` | Delete category (only if no transactions reference it) |

---

## Pages

### 1. Dashboard
- Summary cards: Income / Spent / Remaining for current month
- Bar chart (Chart.js): Income vs spending, last 6 months
- Donut chart (Chart.js): Spending by category, current month
- Bills panel: list of this month's bills with paid/unpaid/overdue status

### 2. Daily Spending
- Add transaction form: amount, description, category (dropdown), date (default today)
- Transaction list grouped by day, current month shown by default
- Month picker to browse past months
- Filter by category
- Edit and delete each entry

### 3. Bills
- Active bills list with this month's paid/unpaid status and due day
- Mark as paid (modal to enter actual amount — defaults to bill amount)
- Add new bill form: name, expected amount, due day, category
- Cancel bill button — confirmation dialog, explains history is kept
- Cancelled bills section showing archived bills and their payment history

### 4. Income
- Add income form: amount, description/source, date
- Income list grouped by month
- Monthly income total

### 5. Reports
- Month picker (default: current month)
- Spending breakdown bar chart by category
- Month-over-month comparison table (current vs previous month)
- Top spending categories ranked

### 6. Settings
- Manage categories: add, rename, change colour, delete
- Default categories seeded on first run: Housing, Groceries, Transport, Utilities, Eating Out, Entertainment, Health, Other

---

## Proxmox Deployment

1. Create Debian 12 LXC container (512MB RAM, 4GB disk)
2. Install Node.js 20 LTS + npm
3. Clone/copy app files into `/opt/fintrack`
4. `npm install`
5. `npm install -g pm2`
6. `pm2 start server.js --name fintrack`
7. `pm2 startup && pm2 save` (survive reboots)
8. Access at `http://<lxc-ip>:3000`

---

## Currency

GBP (£) throughout. Amounts stored as plain `REAL` values. Currency symbol applied in the frontend only.

---

## Out of Scope

- User authentication (single-user, local network only)
- Mobile app
- Bank import / Open Banking integration
- Multi-currency
- Budget limits / alerts
