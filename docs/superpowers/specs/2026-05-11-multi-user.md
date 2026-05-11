# FinTrack v1.5.0: Multi-User Local Accounts

## Overview

Add local multi-user support so multiple people in a household can each have their own fully isolated FinTrack account on the same server. Each user's data — accounts, transactions, income, bills, categories, settings — is completely separate. No shared data.

---

## Authentication Model

### Login flow (Netflix-style)

1. App loads → calls `GET /api/auth/me`
   - `401` → show login screen
   - `200` → proceed as normal user session
2. Login screen:
   - **No users exist** → show "Create admin account" form (first-run)
   - **Users exist** → show profile picker (avatar grid)
3. Profile picker: click an avatar → password input appears below it → submit → `POST /api/auth/login` → load app
4. Any mid-session `401` from any API call → `showLogin()` drops back to picker

### Session tokens

- On successful login: generate a 32-byte random hex token, store in `users.session_token`, set as `HttpOnly` cookie named `fintrack_session`
- On logout: clear `session_token` in DB, expire the cookie
- Auth middleware reads the cookie on every request, looks up user by token, sets `req.userId` / `req.user`, returns `401` if missing or invalid

### Passwords

- Hashed with `bcryptjs` (cost factor 10)
- New dependency: `bcryptjs`

---

## Database

### New `users` table

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name  TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  colour        TEXT    NOT NULL DEFAULT '#4a9eff',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  session_token TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

First user ever inserted gets `is_admin = 1` automatically.

### `user_id` added to existing tables

`ALTER TABLE … ADD COLUMN user_id INTEGER REFERENCES users(id)` applied to:

- `categories`
- `transactions`
- `income`
- `bills`
- `income_schedules`
- `accounts`
- `transfers`

`bill_months` is not changed — user is derived via its `bills` join.

### Tables recreated with updated constraints

Two tables cannot have their constraints changed via `ALTER TABLE` in SQLite, so they are recreated:

**`settings`** — primary key changes from `key` to `(user_id, key)`:
```sql
CREATE TABLE settings_new (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key     TEXT    NOT NULL,
  value   TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);
```

**`categories`** — unique constraint changes from `UNIQUE(name)` to `UNIQUE(user_id, name)`:
```sql
CREATE TABLE categories_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT    NOT NULL,
  colour     TEXT    NOT NULL DEFAULT '#888888',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
```

### Migration (fresh start)

All existing rows are deleted from every data table. The app detects `SELECT COUNT(*) FROM users = 0` and shows the first-run "Create admin account" screen.

Migration runs in `db.js` at startup:
1. Create `users` table if not exists
2. Recreate `settings` and `categories` with new constraints (copy-drop-rename pattern)
3. `ALTER TABLE` to add `user_id` to the remaining six tables (guarded with try/catch on duplicate column)
4. Delete all rows from: `categories`, `transactions`, `income`, `bills`, `bill_months`, `income_schedules`, `accounts`, `transfers`, `settings`

The delete-all step only runs once — guarded by checking `SELECT COUNT(*) FROM users = 0` before wiping.

---

## API

### New files

#### `middleware/auth.js`

```javascript
module.exports = function requireAuth(req, res, next) {
  const token = req.cookies?.fintrack_session;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const user = db.prepare('SELECT * FROM users WHERE session_token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  req.userId = user.id;
  req.user   = user;
  next();
};
```

Applied to all existing route mounts in `server.js`.

#### `routes/auth.js`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | none | Verify password, set cookie |
| `POST` | `/api/auth/logout` | required | Clear token + cookie |
| `GET`  | `/api/auth/me` | none (returns 401) | Return current user or 401 |

#### `routes/users.js`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`    | `/api/users/picker` | none | Public list for login screen — returns only `[{ id, display_name, colour }]` |
| `GET`    | `/api/users` | admin | Full user list (id, display_name, colour, is_admin) — no hashes |
| `POST`   | `/api/users` | none if 0 users, admin otherwise | Create user; first user becomes admin |
| `DELETE` | `/api/users/:id` | admin | Delete user + all their data (categories, transactions, income, bills, bill_months, income_schedules, accounts, transfers, settings); admin cannot delete themselves |
| `PATCH`  | `/api/users/:id/password` | own account | Change password (requires current password) |
| `PATCH`  | `/api/users/:id/colour` | own account | Change avatar colour |

### Changes to existing routes

Every existing route handler gains `req.userId` filtering:

- All `SELECT` queries add `AND user_id = ?` (or `WHERE user_id = ?`)
- All `INSERT` queries include `user_id = req.userId`
- All `DELETE`/`UPDATE` queries add `AND user_id = ?` so users can only touch their own rows

The `categories` seed (8 default categories) moves from `db.js` (one-time global) to the `POST /api/users` handler — seeded per user on creation.

The `accounts` seed (default "Current Account") also moves to `POST /api/users`.

### `server.js` changes

- Add `cookie-parser` middleware (new dependency)
- Mount `requireAuth` before all existing API routes
- Mount `/api/auth` and `/api/users` without `requireAuth` (they handle their own auth)

New dependencies: `bcryptjs`, `cookie-parser`

---

## Frontend — `public/app.js`

### Startup

```javascript
async function init() {
  const me = await api('/auth/me').catch(() => null);
  if (!me) { showLogin(); return; }
  currentUser = me;
  // existing app init...
}
```

All `api()` calls gain a 401 interceptor: if any response is 401, call `showLogin()`.

### `showLogin()`

1. Call `GET /api/users/picker` (no auth — returns `[{ id, display_name, colour }]`)
2. If empty → render first-run "Create admin account" form
3. If users exist → render profile picker

Profile picker: avatar grid, click an avatar → show password `<input>` below it + "Enter" button. Submit calls `POST /api/auth/login`. On success, reload app.

First-run form: display name + password + colour picker → `POST /api/users` → auto-login → load app.

### Header

Pill badge added to the right of the nav header: coloured avatar circle + display name + ⇄ icon. Clicking it calls `POST /api/auth/logout` then `showLogin()`.

### Settings page — Users section (admin only)

New collapsible section, rendered only when `currentUser.is_admin`:

- Lists all users: avatar, display name, role badge ("Admin" / "User")
- Delete button on non-admin users → confirm dialog ("Delete Sarah and all their data?") → `DELETE /api/users/:id`
- "Add user" button → inline form: display name, password, colour picker → `POST /api/users`
- "Change password" section (all users): current password + new password → `PATCH /api/users/:id/password`

---

## CSS — `public/style.css`

New classes for:
- `.user-picker` — full-screen login overlay
- `.user-avatar` — coloured circle with initial
- `.user-pill` — header badge (avatar + name + switch icon)
- `.users-section` — settings panel user list rows

---

## Version

`package.json` bumped to `1.5.0`.

---

## Out of Scope

- Password reset (no email on a local app)
- Roles beyond admin / user
- Shared/household data between users
- Session expiry timeout (token lives until explicit logout)
- Profile photos
