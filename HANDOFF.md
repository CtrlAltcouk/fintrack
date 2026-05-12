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
- **Multi-user** — fully isolated local accounts (v1.5.0, just shipped)

---

## Current Progress — Last Session

**v1.5.0 multi-user local accounts was fully implemented and pushed.**

### What was built (20 tasks, all complete)

| Area | What changed |
|------|-------------|
| `db.js` | `users` table; `categories` + `settings` recreated with composite keys; `user_id` added to all data tables; fresh-start wipe on first run |
| `middleware/auth.js` | `requireAuth` reads `fintrack_session` HttpOnly cookie, sets `req.userId` / `req.user` |
| `routes/auth.js` | `POST /login`, `POST /logout`, `GET /me` |
| `routes/users.js` | `GET /picker` (public), `GET /` (admin), `POST /` (first user = admin, seeds 8 categories + 1 account), `DELETE /:id` (cascade wipe), `PATCH /:id/password`, `PATCH /:id/colour` |
| `server.js` | cookie-parser added; `/api/auth` + `/api/users` bypass `requireAuth`; all other routes wrapped |
| All route files | Every query scoped to `req.userId` |
| `public/index.html` | Login overlay div + user pill in sidebar |
| `public/app.js` | `init()`, `showLogin()`, `doLogin()`, `logout()`, profile picker, first-run form, admin Users tab in Settings |
| `public/style.css` | Login overlay, user picker grid, colour picker, user pill |

### Auth model
- bcryptjs (cost 10) for password hashing
- 32-byte hex session token stored in `users.session_token`
- HttpOnly cookie named `fintrack_session`, `sameSite: Lax`
- No expiry (token lives until explicit logout)

### Tests (all passing)
```
tests/settings.test.js      9 passed, 0 failed
tests/auth.test.js          3 passed, 0 failed
tests/db-migration.test.js  5 passed, 0 failed
```

---

## Active Work-in-Progress

**None.** No half-finished files or TODO comments in project source. All 20 tasks were reviewed, fixed, and committed.

---

## The Next Step Priority

No specific next feature has been requested. Based on what exists, the most logical candidates are:

1. **PATCH /api/users/:id/colour** — the route exists in `routes/users.js` but there is no UI for it (the colour picker only appears at account creation). Admin and users can't change their avatar colour after creation.
2. **Session expiry** — tokens live forever; a `last_active` timestamp + auto-logout after N days would harden security.
3. **Mobile layout** — the sidebar doesn't collapse on small screens.

Wait for user direction before starting any of these.

---

## Technical Debt / Gotchas

### Database
- **`transfers` has a `user_id` column but it is never populated** — isolation is enforced via JOIN on `accounts.user_id`. The column exists (added by migration) but is always NULL. Either populate it or remove it. Don't add queries that filter `transfers WHERE user_id = ?` — they will return nothing.
- **SQLite WAL mode** is enabled. The DB file is at `data/fintrack.db`. Never delete it manually without stopping the server first.
- **Migration is idempotent** — `db.js` runs on every startup. The fresh-start wipe is guarded by `userCount === 0` so it only fires once (when there are no users). Safe to restart freely.

### Auth
- `GET /api/users/picker` and `POST /api/users` are intentionally **unauthenticated** — the login screen needs them before any session exists.
- `POST /api/auth/logout` **does** require auth (uses `requireAuth`).
- No rate limiting on login. No minimum password length enforced server-side.

### Frontend
- `esc()` is a global HTML-escape helper defined early in `app.js` — use it whenever inserting user-supplied strings into innerHTML.
- `api()` is the fetch wrapper — it automatically calls `showLogin()` on any 401 response. Do not use raw `fetch()` for authenticated calls.
- `currentUser` is a module-level variable set after login. It contains `{ id, display_name, colour, is_admin }`.
- `invalidateAccounts()` and `invalidateCategories()` clear in-memory caches — call both on logout/user switch.
- The Settings page tabs are rendered by `pages.settings(activeTab)`. The Users tab only renders when `currentUser.is_admin`.

### Proxmox deployment
- Installed via a one-line installer script (see early git commits: `feat: Proxmox one-line installer`).
- The process manager used on the LXC is unknown (PM2 or systemd — check with `pm2 list` or `systemctl list-units | grep fintrack`).
- After any `git pull`, run `npm install` before restarting — new deps may have been added.
- The LXC IP is `192.168.1.167`. `localhost:3000` on the Proxmox **host** is a separate process — kill with `pkill -f "node server.js"` on the host if it appears.

### Settings
- `settings` table has a composite PK `(user_id, key)`. The `stmtUpsert` uses `ON CONFLICT(user_id, key)`. Do not revert to single-column conflict target.
- The `_migrate(layout, userId)` function in `routes/settings.js` skips the DB write if `userId` is null/undefined — this is intentional for the unit tests which call it without a user context.

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
  settings.js               — dashboard layout persistence
  update.js                 — self-update from GitHub
public/
  index.html                — app shell + login overlay + user pill
  app.js                    — entire SPA (~1700 lines, vanilla JS)
  style.css                 — dark theme + all component styles
tests/
  settings.test.js          — _migrate() unit tests
  auth.test.js              — bcrypt + requireAuth unit tests
  db-migration.test.js      — schema/column existence checks
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

# Start dev server (with auto-restart on file change)
npm run dev

# Start production server
npm start

# Deploy to Proxmox (run on Proxmox LXC shell)
git pull && npm install && pm2 restart fintrack
# OR: git pull && npm install && sudo systemctl restart fintrack
```
