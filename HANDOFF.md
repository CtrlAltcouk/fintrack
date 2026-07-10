# Outflow — AI Handoff Document

> **For the next agent:** Read this before touching any code. It is the authoritative summary of what exists, what was just built, and what comes next.

---

## Project Context

**Outflow** is a self-hosted personal finance web app running on a Proxmox LXC container. It is a Node.js/Express 4 backend with a vanilla JS SPA frontend, using better-sqlite3 (synchronous SQLite). There is no build step — the frontend is plain HTML/CSS/JS served as static files.

**Repo:** `https://github.com/CtrlAltcouk/fintrack.git`  
**Production:** Proxmox LXC, accessible at `http://192.168.1.167:3000`  
**Current version:** `2.2.2`

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
- **Pay Period toggle** — dashboard switches between calendar-month and pay-period view (v1.6.0)
- **Daily Spending pay period mode** — spending page respects the global pay period toggle; ◀ Period ▶ nav replaces month nav when active (v1.7.0)
- **Outflow rebrand** — renamed from FinTrack; circle SVG logo in sidebar and login; SVG favicon; version 2.0.2
- **Backup & Restore** — admin-only JSON backup download and restore (replace/merge) in Settings → System (v2.1.0)
- **Avatar colour & profile photo** — users can change their avatar colour (7 presets) and upload a profile photo from Settings → Personalisation → PROFILE card; photo shown in sidebar pill, login picker, and admin Users tab (v2.2.0)
- **Calendar pay period mode** — calendar widget navigates by pay period when PP mode active; grid shows weeks overlapping the period; out-of-period days greyed; title shows period label; ◀/▶ disabled at boundaries (v2.3.0)
- **Schedule edit going forward + dom ≥ 29 fix** — Edit button on Recurring Sources updates schedule and deletes future entries so they regenerate; dom≥29 period boundary now correctly uses clamped pay day (v2.4.0)
- **Per-user "Clear My Data" + admin-gated "Clear All Data"** — Danger Zone now has a "Clear My Data" button (any user, wipes only their own transactions/income/bills/accounts/transfers) alongside the original "Clear All Data (All Users)" button, which is now restricted to admins both in the UI and the API (v2.2.1)
- **Fix false "Server did not restart" error on Update Now** — the update flow's restart-detection polling now allows 90s (not 15s) for the server to go down before flagging an error, since `git pull && npm install` run before the process exits and can take longer than 15s; the "come back up" timeout is now measured from when it actually went down instead of from the start (v2.2.2)

---

## Current Progress — Last Session (2026-07-10)

### Fix False "Server Did Not Restart" Error on Update (v2.2.2)

**Problem:** Clicking "Update Now" would correctly pull and install the update, but the frontend showed a red "Server did not restart" error anyway — user had to hard-refresh (Ctrl+Shift+R) to see it had actually worked.

**Root cause:** `POST /api/update` (`routes/update.js`) runs `git pull origin main && npm install --omit=dev --silent` *before* calling `process.exit(0)`. The frontend's `pollForRestart()` (`public/app.js`) only waited 15s for the server to go down before declaring failure — too short whenever `npm install` takes a while (new/updated deps, slower host). The update was still finishing quietly in the background the whole time, which is why the version showed correctly updated on the next page load.

**Fix:**
- `pollForRestart()` now takes explicit `phase1TimeoutMs` (wait to go down) and `phase2TimeoutMs` (wait to come back up) parameters, defaulting to the original 15s/45s.
- Critically, phase 2's timeout is now measured from the moment the server actually went down (`downAt`), not from the overall start — previously both phases shared one `elapsed` counter, so simply raising phase 1 would have silently broken phase 2 (it would fire almost immediately after going down).
- `triggerUpdate()` (the "Update Now" button) passes `phase1TimeoutMs = 90000`, since that path includes `git pull` + `npm install`. `triggerRestart()` ("Restart App", no code pull) keeps the default 15s, since that path should go down almost instantly.

| Area | What changed |
|------|-------------|
| `public/app.js` | `pollForRestart()` takes `phase1TimeoutMs`/`phase2TimeoutMs` params; phase 2 timeout now measured from `downAt` not `start`; `triggerUpdate()` passes `90000` for phase 1 |
| `package.json` | version bumped `2.2.1` → `2.2.2` |

---

## Current Progress — Previous Session (2026-07-10)

### Per-user Data Clear + Admin Gating (v2.2.1)

**Problem:** The existing "Clear All Data" button in Settings → System → Danger Zone had no admin check — any authenticated user could wipe every user's transactions, income, bills, accounts, and transfers. There was also no way for a non-admin to clear just their own data.

**Fix:**
- `POST /api/update/clear-data` (all users) now returns 403 unless `req.user.is_admin`.
- New `POST /api/update/clear-my-data` deletes only rows scoped to `req.user.id` across `transactions`, `income`, `income_schedules`, `bills` (+ their `bill_months`), `accounts`, and `transfers` (transfers scoped via a join on the user's own `accounts`, since `transfers.user_id` is always NULL).
- Danger Zone UI always shows "Clear My Data"; "Clear All Data (All Users)" only renders when `currentUser.is_admin`. Both share one confirm-modal helper, `_clearDataModal()`, in `app.js`.

Verified end-to-end in a real browser session (not just unit tests): created an admin + non-admin user, gave the non-admin an account with a balance, confirmed non-admin sees only "Clear My Data" and no Users/Backup tabs, clicked it, confirmed only that user's data was wiped and the admin's account was untouched.

**Note:** `package.json` was still at `2.2.0` despite this file's "Current version" previously reading `2.4.0` — v2.3.0/v2.4.0 feature commits didn't bump `package.json`. This session bumped `package.json` directly to `2.2.1` per explicit user request; the version numbers in this doc and in `package.json` are now both `2.2.1`, but the gap means the About page in earlier deployments said "v2.2.0" while already running v2.4.0-era features. Next agent: flag to the user whether historical version numbers need reconciling, or whether `package.json` should just continue forward from here.

| Area | What changed |
|------|-------------|
| `routes/update.js` | `POST /clear-data` now admin-only (403 otherwise); new `POST /clear-my-data` route |
| `public/app.js` | Danger Zone renders "Clear My Data" always, "Clear All Data (All Users)" only for admins; `_clearDataModal()` helper shared by `clearMyData()` and `clearAllData()` |
| `package.json` | version bumped `2.2.0` → `2.2.1` |

---

## Current Progress — Previous Session (2026-06-14)

### Schedule Edit Going Forward + dom ≥ 29 Fix (v2.4.0)

**dom ≥ 29 fix:** `computePeriods` (monthly) now uses `Math.min(dom, daysInCurrentMonth)` for the period-start comparison. Previously, the clamped pay day (e.g. Apr 30 when dom=31) was treated as "before the pay day" and fell into the previous period.

**Schedule Edit:** Each Recurring Source row now has an **Edit** button. Clicking it expands an inline pre-filled form. On save, `PATCH /api/income/schedules/:id` updates the schedule and deletes all linked income entries from today onwards — they auto-regenerate with the new values next time that month is loaded. Past entries are untouched.

| Area | What changed |
|------|-------------|
| `public/period-utils.js` | `daysInCurrentMonth` + `Math.min(dom, daysInCurrentMonth)` in period-start check |
| `tests/period.test.js` | 2 new edge-case tests (15 total) |
| `routes/income-schedules.js` | New `PATCH /:id` route (edit going forward) |
| `public/app.js` | `_scheduleEditData` module-level var; Edit button on schedule rows; `editSchedule`, `_seditFreqChange`, `saveScheduleEdit` window functions |

---

## Active Work-in-Progress

**None.** All tasks reviewed, fixed, committed, and pushed.

---

## Known Minor Issues (not blocking)

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

### Income schedule edit — important notes
- `PATCH /api/income/schedules/:id` is registered **before** `PATCH /api/income/schedules/:id/deactivate` in `routes/income-schedules.js`. No conflict — Express treats `/5` and `/5/deactivate` as different path depths.
- On save, all `income` rows with `source_schedule_id = id AND date >= today` are deleted. They are auto-regenerated by `ensureIncomeEntries` the next time that month is viewed.
- `_scheduleEditData = { schedules, accounts }` is set in `pages.income` at render time so `editSchedule(id)` can pre-fill the inline form without an extra API call. It is `null` until the income page has been rendered at least once.

### Calendar pay period mode — important notes
- `calGridBounds` is in `public/calendar-utils.js` (loaded between period-utils.js and app.js). Dual-env: browser global + `module.exports`. Uses local time (`T00:00:00` no Z) to match the monthly calendar path.
- `calPeriodIndex` (module-level in app.js, default 0): 0 = current period, 1 = one period back. Resets to 0 only when `renderCalendar(year, month)` is called with args. PP nav calls `renderCalendar()` without args to preserve position.
- `_renderDashboard` PP branch: passes args (resets `calPeriodIndex`) only when `!editMode`. Edit-mode re-renders call `renderCalendar()` without args so the user's navigated period is preserved.
- `computePeriods` is called with count=8 inside `renderCalendar` (vs count=6 used by the dashboard summary widget). Allows 8 periods of back-navigation.
- If PP mode is active but no valid primary schedule → falls through silently to the monthly view (no banner in the calendar widget; banner is only on the dashboard summary area).

### Mobile layout — important notes
- Script order in `index.html` must be: `period-utils.js` → `calendar-utils.js` → `app.js` (last three scripts before `</body>`).
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
  calendar-utils.js         — calGridBounds() — dual-env grid boundary helper for calendar PP mode
  app.js                    — entire SPA (~2260 lines, vanilla JS); theme engine; mobile sheet JS; pay-period dashboard + calendar; income schedule edit
  style.css                 — dark theme + component styles + mobile @media block
tests/
  settings.test.js          — _migrate() unit tests
  auth.test.js              — bcrypt + requireAuth unit tests
  db-migration.test.js      — schema/column existence checks
  theme.test.js             — parseTheme() unit tests
  period.test.js            — computePeriods() unit tests (15 tests)
  summary-range.test.js     — _parseDateRange() unit tests (7 tests)
  pay-period-settings.test.js — _parsePayPeriodBody() unit tests (10 tests)
  calendar-pp.test.js       — calGridBounds() + calendar PP logic unit tests (14 tests)
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
node tests/calendar-pp.test.js

# Start dev server (auto-restart on file change)
npm run dev

# Start production server
npm start

# Deploy to Proxmox (run on Proxmox LXC shell)
git pull && npm install && pm2 restart fintrack
# OR: git pull && npm install && sudo systemctl restart fintrack
```
