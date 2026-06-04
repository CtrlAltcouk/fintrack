# Outflow — AI Handoff Document

> **For the next agent:** Read this before touching any code. It is the authoritative summary of what exists, what was just built, and what comes next.

---

## Project Context

**Outflow** is a self-hosted personal finance web app running on a Proxmox LXC container. It is a Node.js/Express 4 backend with a vanilla JS SPA frontend, using better-sqlite3 (synchronous SQLite). There is no build step — the frontend is plain HTML/CSS/JS served as static files.

**Repo:** `https://github.com/CtrlAltcouk/fintrack.git`  
**Production:** Proxmox LXC, accessible at `http://192.168.1.167:3000`  
**Current version:** `2.0.2`

### Core features (all shipped)
- Accounts (current / savings / card) with live balance calculation
- Transactions with categories
- Bills with auto bill_months generation, pay/cancel
- Income with recurring schedules (weekly, four-weekly, monthly)
- Transfers between accounts
- Dashboard with charts + customisable widget grid
- Calendar view (bills + income events)
- Reports page
- Self-update system (pulls from GitHub)
- Multi-user — fully isolated local accounts (v1.5.0)
- Per-user theme personalisation — accent/background colour pickers + light/dark mode
- Mobile responsive layout — bottom nav bar + slide-up More sheet
- **Pay Period toggle** — dashboard switches between calendar-month and pay-period view (just shipped)
- **Daily Spending pay period mode** — spending page respects the global pay period toggle; ◀ Period ▶ nav replaces month nav when active (v1.7.0)
- **Outflow rebrand** — renamed from FinTrack; circle SVG logo in sidebar and login; SVG favicon; version 2.0.2

---

## Current Progress — Last Session (2026-06-04)

### Outflow Rebrand (v2.0.0 → 2.0.2)

Full rename from FinTrack to Outflow. Circle SVG icon (dusty-rose with white wave) replaces the emoji in the sidebar and login screen. SVG favicon added. Internal names left unchanged: `fintrack_session` cookie, `fintrack.db` database file, pm2 process name, GitHub repo URLs.

v2.0.1 + v2.0.2: fixed white corners on all SVG logos — wave fill path was bleeding outside the circle because the original `clipPath` was omitted. Added `<clipPath>` + `<g clip-path="...">` wrapper to `favicon.svg`, sidebar SVG in `index.html`, and both login SVGs in `app.js`. Used unique ids per SVG (`oc-s`, `oc-l`, `oc-l2`) to avoid document-level id conflicts.

| Area | What changed |
|------|-------------|
| `public/favicon.svg` | New — circle icon SVG for browser tab; clipPath fix in v2.0.1 |
| `public/index.html` | Title → Outflow, favicon link, sidebar logo; clipPath fix in v2.0.2 |
| `public/app.js` | Login logos ×2, "Who's using Outflow?", About label; clipPath fix in v2.0.2 |
| `package.json` | name → outflow, version → 2.0.2 |
| `server.js` | Startup log → "Outflow running on..." |
| `README.md` | Title updated |

---

## Active Work-in-Progress

**None.** All tasks reviewed, fixed, committed, and pushed.

---

## Known Minor Issues (not blocking)

- **`dom ≥ 29` clamped payday edge case** — `computePeriods` monthly: on the clamped pay day itself (e.g. dom=31, today=April 30), the algorithm places today in the *previous* period rather than the new one. Affects users with dom=29–31 in short months, only on that one day. Fix: compare `< Math.min(dom, daysInCurrentMonth)` instead of `< dom` in `period-utils.js`.
- **`_payPeriodSettings` module-level var** is set in `pages.dashboard` but not consumed elsewhere in `app.js`. Leftover from an earlier design. Harmless but cosmetic.

---

## The Next Step Priority

No specific next feature has been requested. Logical candidates in order of value:

1. **Avatar colour change UI** — `PATCH /api/users/:id/colour` exists in `routes/users.js` but there is no UI. Users can only set their colour at account creation.
2. **Session expiry** — tokens live forever (`users.session_token`, no expiry). A `last_active` timestamp + configurable auto-logout after N days would harden security without breaking UX.
3. **Recurring income calendar visualisation** — the calendar page shows bills + income events but there is no "next occurrence" preview for schedules. See `docs/superpowers/plans/2026-05-06-recurring-income-calendar.md` for a prior plan.

Wait for user direction before starting any of these.

---

## Technical Debt / Gotchas

### Database
- **`transfers` has a `user_id` column that is always NULL** — isolation is enforced via JOIN on `accounts.user_id`. Do not add queries that filter `transfers WHERE user_id = ?` — they will return nothing.
- **SQLite WAL mode** is enabled. DB file at `data/fintrack.db`. Never delete it while the server is running.
- **Migration is idempotent** — `db.js` runs every startup. Fresh-start wipe is guarded by `userCount === 0`. Safe to restart freely.

### Auth
- `GET /api/users/picker` and `POST /api/users` are intentionally **unauthenticated** — login screen needs them before any session exists.
- `POST /api/auth/logout` **does** require auth.
- No rate limiting on login. No minimum password length enforced server-side.

### Frontend — critical patterns
- `esc()` — global HTML-escape helper. Use it for every user-supplied string in innerHTML. Never skip it.
- `api()` — authenticated fetch wrapper. Auto-calls `showLogin()` on 401. Never use raw `fetch()` for authenticated calls.
- `currentUser` — module-level var: `{ id, display_name, colour, is_admin }`. Set after login, nulled on logout.
- `invalidateAccounts()` + `invalidateCategories()` — call both on logout/user switch to clear in-memory caches.
- `pages.settings(activeTab)` — re-renders settings. Users tab only renders when `currentUser.is_admin`.
- **`app.js` is ~1960 lines** — a single large file. Read carefully before adding; functions can be far from each other.
- **Theme CSS vars** — `applyTheme()` sets `--accent`, `--bg`, `--card`, `--border`, `--text`, `--muted` on `document.documentElement.style`. Any new components should use these vars, not hard-coded colours.

### Pay Period feature — important notes
- `computePeriods` is in `public/period-utils.js` (loaded as a `<script>` before `app.js`). It is a browser global AND a Node.js `module.exports`. Tests can `require('../public/period-utils')`.
- `primary_schedule_id` is stored as an empty string `""` in the settings table when cleared (NOT as SQL NULL — the `value` column is NOT NULL). The GET handler returns JS `null` when the value is absent or empty. Do not change this.
- `_dashData` in pay-period mode has extra fields: `{ ..., payPeriodMode: true, periods: [...], periodSummaries: [...], noPrimarySchedule: false }`. Monthly mode: `{ ..., payPeriodMode: false, noPrimarySchedule: bool }`.
- `noPrimarySchedule: true` triggers a banner on the dashboard — user is in pay_period mode but no valid primary schedule is set/active.
- Bar chart in pay-period mode: `periods` and `periodSummaries` are reversed before use (so chart shows oldest-to-newest left-to-right). Both are always the same length.

### Mobile layout — important notes
- `<script src="period-utils.js">` → `<script src="app.js">` must remain the **last two scripts before `</body>`** in that order.
- `MORE_PAGES = new Set(['accounts', 'transfers', 'reports', 'settings'])` in `app.js` must stay in sync with `.sheet-nav-item` elements in `index.html`.
- Bottom nav z-index is **90** (below modals at 100). Sheet backdrop is 200, sheet itself is 201, login overlay is 1000.
- `#sheet-user-pill` is a `<button>` (not a div) — keeps keyboard accessibility correct.

### Settings table
- Composite PK `(user_id, key)`. `stmtUpsert` uses `ON CONFLICT(user_id, key)`. Do not revert to single-column conflict target.
- `_migrate(layout, userId)` in `routes/settings.js` skips the DB write when `userId` is null — intentional for unit tests.
- Keys in use: `dashboard_layout`, `theme`, `dashboard_mode`, `primary_schedule_id`.

### Proxmox deployment
- Process manager on LXC: check with `pm2 list` or `systemctl list-units | grep fintrack`.
- After `git pull`, always run `npm install` before restart — deps may have changed.
- LXC IP: `192.168.1.167`. If `localhost:3000` on the Proxmox host appears as a separate process, kill with `pkill -f "node server.js"` on the host.

---

## File Map

```
server.js                   — Express app entry, route mounting
db.js                       — Schema creation + migration (runs at startup)
middleware/
  auth.js                   — requireAuth middleware
routes/
  auth.js                   — login / logout / me
  users.js                  — user CRUD + seeding
  accounts.js               — accounts CRUD + balance calc
  transactions.js           — transactions CRUD
  transfers.js              — transfers (user isolation via accounts JOIN)
  income.js                 — income CRUD
  income-schedules.js       — recurring schedules + ensureIncomeEntries()
  bills.js                  — bills CRUD + ensureBillMonths()
  categories.js             — categories CRUD
  summary.js                — dashboard aggregations (calendar month)
  summary-range.js          — dashboard aggregations (arbitrary date range)
  calendar.js               — calendar events (bills + income)
  settings.js               — dashboard layout + theme + pay-period mode persistence
  update.js                 — self-update from GitHub
public/
  index.html                — app shell; login overlay; desktop sidebar; mobile bottom-nav + more-sheet
  favicon.svg               — circle icon (dusty-rose + white wave) for browser tab
  period-utils.js           — computePeriods() — dual-env period boundary calculator
  app.js                    — entire SPA (~1960 lines, vanilla JS); theme engine; mobile sheet JS; pay-period dashboard
  style.css                 — dark theme + component styles + mobile @media block
tests/
  settings.test.js          — _migrate() unit tests
  auth.test.js              — bcrypt + requireAuth unit tests
  db-migration.test.js      — schema/column existence checks
  theme.test.js             — parseTheme() unit tests
  period.test.js            — computePeriods() unit tests (13 tests)
  summary-range.test.js     — _parseDateRange() unit tests (7 tests)
  pay-period-settings.test.js — _parsePayPeriodBody() unit tests (10 tests)
data/
  fintrack.db               — SQLite database (gitignored)
docs/superpowers/
  specs/                    — design docs for each feature
  plans/                    — implementation plans (task checklists)
```

---

## Commands

```bash
# Run all tests
node tests/settings.test.js
node tests/auth.test.js
node tests/db-migration.test.js
node tests/theme.test.js
node tests/period.test.js
node tests/summary-range.test.js
node tests/pay-period-settings.test.js

# Start dev server (auto-restart on file change)
npm run dev

# Start production server
npm start

# Deploy to Proxmox (run on Proxmox LXC shell)
git pull && npm install && pm2 restart fintrack
# OR: git pull && npm install && sudo systemctl restart fintrack
```
