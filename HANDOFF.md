# FinTrack — AI Handoff Document

> **For the next agent:** Read this before touching any code. It is the authoritative summary of what exists, what was just built, and what comes next.

---

## Project Context

**FinTrack** is a self-hosted personal finance web app running on a Proxmox LXC container. It is a Node.js/Express 4 backend with a vanilla JS SPA frontend, using better-sqlite3 (synchronous SQLite). There is no build step — the frontend is plain HTML/CSS/JS served as static files.

**Repo:** `https://github.com/CtrlAltcouk/fintrack.git`  
**Production:** Proxmox LXC, accessible at `http://192.168.1.167:3000`  
**Current version:** `1.5.0`

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
- **Per-user theme personalisation** — accent/background colour pickers + light/dark mode (just shipped)
- **Mobile responsive layout** — bottom nav bar + slide-up More sheet (just shipped)

---

## Current Progress — Last Session (2026-05-12/13)

Two features were fully implemented, reviewed, and pushed.

### 1. Personalisation tab in Settings

Per-user theme customisation stored in the `settings` table.

| Area | What changed |
|------|-------------|
| `routes/settings.js` | `GET /api/settings/theme` + `POST /api/settings/theme`; `parseTheme()` validates mode/hex; `DARK_THEME_DEFAULTS` / `LIGHT_THEME_DEFAULTS` constants; `module.exports._parseTheme` exported for tests |
| `public/app.js` | `applyTheme()`, `loadTheme()`, `DARK_DEFAULTS`, `LIGHT_DEFAULTS`, `DARK_VARS`, `LIGHT_VARS`; `ACCENT_PRESETS`, `BG_DARK_PRESETS`, `BG_LIGHT_PRESETS`; `window.setMode`, `window.pickAccent`, `window.pickBg`, `window.resetTheme`; `loadTheme()` called in `init()` and `doLogin()`; `applyTheme(DARK_DEFAULTS)` on logout |
| `public/style.css` | `.swatch`, `.swatch:hover`, `.swatch.selected`, `.swatch-custom` classes appended |
| `tests/theme.test.js` | 9 unit tests for `parseTheme` (invalid JSON, bad mode, hex fallbacks) — all passing |

**Defaults:** dark mode + `#111111` background + `#f7a4a2` (pink) accent. Light mode defaults: `#f0e8f0` + `#c45c5a`.

### 2. Mobile responsive layout

Breakpoint: `≤768px`. Desktop sidebar unchanged.

| Area | What changed |
|------|-------------|
| `public/index.html` | `<nav id="bottom-nav">` (5 buttons: Home/Spending/Bills/Income/More), `<div id="more-backdrop">`, `<div id="more-sheet">` with 4 nav items + `#sheet-user-pill`. Full ARIA: `role="dialog"`, `aria-expanded`, `aria-controls`, `aria-modal`, focus trap close button. `<script>` tag moved to end of `<body>` (after mobile elements). `viewport-fit=cover` added to meta viewport. |
| `public/style.css` | `@media (max-width: 768px)` block: sidebar hidden, `#bottom-nav` fixed at bottom (z-index 90, `100dvh`, safe-area insets), sheet slides up with `transform` animation (z-index 201), `prefers-reduced-motion` guard, `.form-row` stacks vertically, `.tabs-nav` horizontal scroll |
| `public/app.js` | `MORE_PAGES` Set; `navigate()` extended to sync bottom-nav active state; `openMoreSheet()` / `closeMoreSheet()` with ARIA + focus management; bottom-nav click listeners; sheet nav listeners; Escape key + focus trap handler; `logout()` calls `closeMoreSheet()` first; `init()` / `doLogin()` / `logout()` sync `#sheet-user-pill` |

### Tests — all passing
```
tests/settings.test.js      9 passed, 0 failed
tests/auth.test.js          3 passed, 0 failed
tests/db-migration.test.js  5 passed, 0 failed
tests/theme.test.js         9 passed, 0 failed
```

---

## Active Work-in-Progress

**None.** No half-finished files or TODO comments anywhere in the source. All tasks were reviewed (spec compliance + code quality), fixed, and committed.

---

## The Next Step Priority

No specific next feature has been requested. Logical candidates in order of value:

1. **Avatar colour change UI** — `PATCH /api/users/:id/colour` exists in `routes/users.js` but there is no UI. Users can only set their colour at account creation. Add a colour picker in the Settings → Profile (or Users admin) tab.
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
- **`app.js` is ~1870 lines** — a single large file. Read carefully before adding; functions can be far from each other.
- **Theme CSS vars** — `applyTheme()` sets `--accent`, `--bg`, `--card`, `--border`, `--text`, `--muted` on `document.documentElement.style`. Any new components should use these vars, not hard-coded colours.

### Mobile layout — important notes
- `<script src="app.js">` is the **last element before `</body>`** (after the mobile HTML elements). This is intentional — moving it earlier will cause null-reference crashes because the mobile elements won't exist in the DOM when the script runs.
- `MORE_PAGES = new Set(['accounts', 'transfers', 'reports', 'settings'])` in `app.js` must stay in sync with `.sheet-nav-item` elements in `index.html`. If you add a page to the sheet, add it to the Set too.
- Bottom nav z-index is **90** (below modals at 100). Sheet backdrop is 200, sheet itself is 201, login overlay is 1000.
- `#sheet-user-pill` is a `<button>` (not a div) — keeps keyboard accessibility correct.

### Settings table
- Composite PK `(user_id, key)`. `stmtUpsert` uses `ON CONFLICT(user_id, key)`. Do not revert to single-column conflict target.
- `_migrate(layout, userId)` in `routes/settings.js` skips the DB write when `userId` is null — intentional for unit tests.

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
  summary.js                — dashboard aggregations
  calendar.js               — calendar events (bills + income)
  settings.js               — dashboard layout + theme persistence
  update.js                 — self-update from GitHub
public/
  index.html                — app shell; login overlay; desktop sidebar; mobile bottom-nav + more-sheet
  app.js                    — entire SPA (~1870 lines, vanilla JS); theme engine; mobile sheet JS
  style.css                 — dark theme + component styles + mobile @media block
tests/
  settings.test.js          — _migrate() unit tests
  auth.test.js              — bcrypt + requireAuth unit tests
  db-migration.test.js      — schema/column existence checks
  theme.test.js             — parseTheme() unit tests
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

# Start dev server (auto-restart on file change)
npm run dev

# Start production server
npm start

# Deploy to Proxmox (run on Proxmox LXC shell)
git pull && npm install && pm2 restart fintrack
# OR: git pull && npm install && sudo systemctl restart fintrack
```
