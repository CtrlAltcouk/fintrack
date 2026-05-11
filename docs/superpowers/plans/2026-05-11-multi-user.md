# FinTrack v1.5.0: Multi-User Local Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add isolated local user accounts so multiple household members can use FinTrack on the same server, each with their own data.

**Architecture:** Single SQLite database with `user_id` on every data table. Session tokens stored in the `users` row and sent as an HTTP-only cookie. Profile picker + password login; first user created becomes admin.

**Tech Stack:** Node.js/Express 4, better-sqlite3, bcryptjs (new), cookie-parser (new), vanilla JS SPA.

---

## File Map

**New files:**
- `middleware/auth.js` — requireAuth middleware
- `routes/auth.js` — login / logout / me
- `routes/users.js` — user CRUD + per-user data seeding

**Modified files:**
- `db.js` — users table, recreate categories+settings, add user_id columns, wipe migration
- `server.js` — cookie-parser, mount new routes, apply requireAuth
- `routes/categories.js` — user_id filter
- `routes/accounts.js` — user_id filter
- `routes/transactions.js` — user_id filter
- `routes/transfers.js` — user_id via accounts join, remove module-level stmts
- `routes/income.js` — user_id filter
- `routes/income-schedules.js` — userId param on ensureIncomeEntries
- `routes/bills.js` — userId param on ensureBillMonths, user_id filter
- `routes/settings.js` — user_id in stmtGet/stmtUpsert, userId in _migrate
- `routes/summary.js` — user_id filter, userId to ensureIncomeEntries
- `routes/calendar.js` — userId to both ensure fns, user_id filter
- `public/index.html` — login overlay div, user pill in sidebar
- `public/app.js` — currentUser, 401 in api(), showLogin/doLogin, init(), settings users section
- `public/style.css` — login overlay, user picker, user pill styles
- `package.json` — version 1.5.0, bcryptjs + cookie-parser deps

**Test file:**
- `tests/auth.test.js` — auth middleware unit tests

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd "C:\Users\chris\Desktop\Finaces add"
npm install bcryptjs cookie-parser
```

Expected output: `added 2 packages` (or similar, no errors)

- [ ] **Step 2: Verify**

```bash
node -e "require('bcryptjs'); require('cookie-parser'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add bcryptjs and cookie-parser"
```

---

### Task 2: `db.js` — users table + migration

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Write the failing test**

Create `tests/db-migration.test.js`:

```javascript
// tests/db-migration.test.js
const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// Require db to trigger migration
const db = require('../db');

test('users table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  assert.ok(row, 'users table missing');
});

test('categories has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(categories)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from categories');
});

test('settings has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(settings)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from settings');
});

test('transactions has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(transactions)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from transactions');
});

test('accounts has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(accounts)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from accounts');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test — verify it fails**

```bash
node tests/db-migration.test.js
```

Expected: failures on `users table exists` and `user_id column` checks.

- [ ] **Step 3: Implement — add to `db.js`**

Add the following block to `db.js`, **after** all existing `db.exec(...)` calls and **before** the seed category / seed account blocks at the bottom.

Replace the entire section from the seed categories block to `module.exports = db;` with:

```javascript
// ── Multi-user migration ──────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name  TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    colour        TEXT    NOT NULL DEFAULT '#4a9eff',
    is_admin      INTEGER NOT NULL DEFAULT 0,
    session_token TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Recreate categories with UNIQUE(user_id, name) if not yet migrated
const catCols = db.prepare('PRAGMA table_info(categories)').all();
if (!catCols.find(c => c.name === 'user_id')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    ALTER TABLE categories RENAME TO categories_old;
    CREATE TABLE categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      name       TEXT    NOT NULL,
      colour     TEXT    NOT NULL DEFAULT '#888888',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );
    DROP TABLE categories_old;
  `);
  db.pragma('foreign_keys = ON');
}

// Recreate settings with (user_id, key) primary key if not yet migrated
const settingsCols = db.prepare('PRAGMA table_info(settings)').all();
if (!settingsCols.find(c => c.name === 'user_id')) {
  db.exec(`
    DROP TABLE IF EXISTS settings;
    CREATE TABLE settings (
      user_id INTEGER NOT NULL REFERENCES users(id),
      key     TEXT    NOT NULL,
      value   TEXT    NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `);
}

// Add user_id to remaining tables (guarded — safe to re-run)
for (const col of [
  `ALTER TABLE transactions     ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE income           ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE income_schedules ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE accounts         ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE transfers        ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE bills            ADD COLUMN user_id INTEGER REFERENCES users(id)`,
]) {
  try { db.exec(col); } catch (e) { if (!e.message.includes('duplicate column name')) throw e; }
}

// Fresh-start wipe: only runs when no users exist (first migration)
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  db.exec(`
    DELETE FROM bill_months;
    DELETE FROM bills;
    DELETE FROM income;
    DELETE FROM income_schedules;
    DELETE FROM transactions;
    DELETE FROM transfers;
    DELETE FROM accounts;
    DELETE FROM categories;
    DELETE FROM settings;
  `);
}

module.exports = db;
```

**Important:** Remove the old seed categories block and old seed accounts block that were previously at the bottom of db.js — they are now handled per-user in `routes/users.js` (Task 4).

- [ ] **Step 4: Run test — verify it passes**

```bash
node tests/db-migration.test.js
```

Expected: `5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add db.js tests/db-migration.test.js
git commit -m "feat: users table + multi-user DB migration"
```

---

### Task 3: `middleware/auth.js`

**Files:**
- Create: `middleware/auth.js`

- [ ] **Step 1: Write the failing test**

Create `tests/auth.test.js`:

```javascript
// tests/auth.test.js
const assert = require('assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('bcrypt hash and compare work', () => {
  const hash = bcrypt.hashSync('secret', 10);
  assert.ok(bcrypt.compareSync('secret', hash));
  assert.ok(!bcrypt.compareSync('wrong', hash));
});

test('session token is 64 hex chars', () => {
  const token = crypto.randomBytes(32).toString('hex');
  assert.strictEqual(token.length, 64);
  assert.ok(/^[0-9a-f]+$/.test(token));
});

test('requireAuth returns 401 when no cookie', () => {
  const requireAuth = require('../middleware/auth');
  const req = { cookies: {} };
  let status = null, body = null;
  const res = { status: s => { status = s; return { json: b => { body = b; } }; } };
  const next = () => { throw new Error('next() should not be called'); };
  requireAuth(req, res, next);
  assert.strictEqual(status, 401);
  assert.strictEqual(body.error, 'unauthenticated');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test — verify it fails**

```bash
node tests/auth.test.js
```

Expected: fails on `requireAuth returns 401` (module not found).

- [ ] **Step 3: Create `middleware/auth.js`**

Create new file `middleware/auth.js`:

```javascript
const db = require('../db');

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

- [ ] **Step 4: Run test — verify it passes**

```bash
node tests/auth.test.js
```

Expected: `3 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add middleware/auth.js tests/auth.test.js
git commit -m "feat: requireAuth middleware"
```

---

### Task 4: `routes/auth.js`

**Files:**
- Create: `routes/auth.js`

- [ ] **Step 1: Create `routes/auth.js`**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const requireAuth = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { display_name, password } = req.body;
  if (!display_name || !password)
    return res.status(400).json({ error: 'display_name and password required' });
  const user = db.prepare('SELECT * FROM users WHERE display_name = ?').get(display_name);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET session_token = ? WHERE id = ?').run(token, user.id);
  res.cookie('fintrack_session', token, { httpOnly: true, sameSite: 'Lax' });
  res.json({ id: user.id, display_name: user.display_name, colour: user.colour, is_admin: user.is_admin });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(req.userId);
  res.clearCookie('fintrack_session');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.fintrack_session;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const user = db.prepare(
    'SELECT id, display_name, colour, is_admin FROM users WHERE session_token = ?'
  ).get(token);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });
  res.json(user);
});

module.exports = router;
```

- [ ] **Step 2: Verify the file is syntactically valid**

```bash
node -e "require('./routes/auth'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/auth.js
git commit -m "feat: auth routes (login, logout, me)"
```

---

### Task 5: `routes/users.js`

**Files:**
- Create: `routes/users.js`

- [ ] **Step 1: Create `routes/users.js`**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const requireAuth = require('../middleware/auth');

const SEED_CATEGORIES = [
  { name: 'Housing',       colour: '#f7a4a2' },
  { name: 'Groceries',     colour: '#a8d8a8' },
  { name: 'Transport',     colour: '#ffd700' },
  { name: 'Utilities',     colour: '#87ceeb' },
  { name: 'Eating Out',    colour: '#ffb347' },
  { name: 'Entertainment', colour: '#c39bd3' },
  { name: 'Health',        colour: '#76d7c4' },
  { name: 'Other',         colour: '#888888' },
];

// GET /api/users/picker — public, no auth, for login screen
router.get('/picker', (req, res) => {
  res.json(db.prepare('SELECT id, display_name, colour FROM users ORDER BY id ASC').all());
});

// GET /api/users — admin only
router.get('/', requireAuth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  res.json(db.prepare('SELECT id, display_name, colour, is_admin, created_at FROM users ORDER BY id ASC').all());
});

// POST /api/users — no auth if first user, admin auth otherwise
router.post('/', (req, res) => {
  const { display_name, password, colour } = req.body;
  if (!display_name || !String(display_name).trim())
    return res.status(400).json({ error: 'display_name required' });
  if (!password)
    return res.status(400).json({ error: 'password required' });

  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (totalUsers > 0) {
    const token = req.cookies?.fintrack_session;
    const caller = token ? db.prepare('SELECT * FROM users WHERE session_token = ?').get(token) : null;
    if (!caller || !caller.is_admin) return res.status(403).json({ error: 'admin only' });
  }

  const isAdmin = totalUsers === 0 ? 1 : 0;
  const hash = bcrypt.hashSync(password, 10);
  let userId;
  try {
    const result = db.prepare(
      'INSERT INTO users (display_name, password_hash, colour, is_admin) VALUES (?, ?, ?, ?)'
    ).run(String(display_name).trim(), hash, colour ?? '#4a9eff', isAdmin);
    userId = result.lastInsertRowid;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE')
      return res.status(409).json({ error: 'display_name already taken' });
    throw err;
  }

  // Seed categories for this user
  const insertCat = db.prepare('INSERT INTO categories (user_id, name, colour) VALUES (?, ?, ?)');
  for (const cat of SEED_CATEGORIES) insertCat.run(userId, cat.name, cat.colour);

  // Seed default account for this user
  db.prepare(
    'INSERT INTO accounts (user_id, name, type, colour, opening_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'Current Account', 'current', '#4a9eff', 0);

  res.status(201).json({
    id: userId,
    display_name: String(display_name).trim(),
    colour: colour ?? '#4a9eff',
    is_admin: isAdmin,
  });
});

// DELETE /api/users/:id — admin only, deletes user + all their data
router.delete('/:id', requireAuth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  const targetId = Number(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'cannot delete your own account' });
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(targetId))
    return res.status(404).json({ error: 'not found' });

  db.prepare('DELETE FROM bill_months WHERE bill_id IN (SELECT id FROM bills WHERE user_id = ?)').run(targetId);
  db.prepare('DELETE FROM bills            WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM income           WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM income_schedules WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM transactions     WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM transfers WHERE from_account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(targetId);
  db.prepare('DELETE FROM transfers WHERE to_account_id   IN (SELECT id FROM accounts WHERE user_id = ?)').run(targetId);
  db.prepare('DELETE FROM accounts         WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM categories       WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM settings         WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM users            WHERE id = ?').run(targetId);

  res.json({ ok: true });
});

// PATCH /api/users/:id/password — own account only
router.patch('/:id/password', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId !== req.userId) return res.status(403).json({ error: 'can only change your own password' });
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return res.status(401).json({ error: 'current password incorrect' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), targetId);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./routes/users'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/users.js
git commit -m "feat: users management routes"
```

---

### Task 6: `server.js` — wire everything together

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Replace `server.js` entirely**

```javascript
const express     = require('express');
const path        = require('path');
const cookieParser = require('cookie-parser');
const requireAuth  = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Auth + user management — no requireAuth wrapper (handle their own auth)
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// All other routes require a valid session
app.use('/api/accounts',         requireAuth, require('./routes/accounts'));
app.use('/api/transfers',        requireAuth, require('./routes/transfers'));
app.use('/api/transactions',     requireAuth, require('./routes/transactions'));
app.use('/api/bills',            requireAuth, require('./routes/bills'));
app.use('/api/bill-months',      requireAuth, require('./routes/bills'));
app.use('/api/income/schedules', requireAuth, require('./routes/income-schedules').router);
app.use('/api/income',           requireAuth, require('./routes/income'));
app.use('/api/categories',       requireAuth, require('./routes/categories'));
app.use('/api/summary',          requireAuth, require('./routes/summary'));
app.use('/api/calendar',         requireAuth, require('./routes/calendar'));
app.use('/api/update',           requireAuth, require('./routes/update'));
app.use('/api/settings',         requireAuth, require('./routes/settings'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinTrack running on http://localhost:${PORT}`));
```

- [ ] **Step 2: Start the server and verify it boots**

```bash
node server.js
```

Expected: `FinTrack running on http://localhost:3000` — no crash.
Stop with Ctrl+C.

- [ ] **Step 3: Verify health endpoint still works**

```bash
node server.js &
sleep 2
curl http://localhost:3000/api/health
kill %1
```

Expected: `{"ok":true}`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: wire auth middleware and new routes in server.js"
```

---

### Task 7: Update `routes/categories.js`

**Files:**
- Modify: `routes/categories.js`

- [ ] **Step 1: Replace `routes/categories.js` entirely**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/categories
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name').all(req.userId));
});

// POST /api/categories
router.post('/', (req, res) => {
  const { name, colour = '#888888' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('INSERT INTO categories (user_id, name, colour) VALUES (?, ?, ?)').run(req.userId, name, colour);
    res.status(201).json({ id: result.lastInsertRowid, name, colour });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'name already exists' });
    throw err;
  }
});

// PUT /api/categories/:id
router.put('/:id', (req, res) => {
  const { name, colour } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  const existing = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  try {
    db.prepare('UPDATE categories SET name = ?, colour = ? WHERE id = ? AND user_id = ?')
      .run(name ?? existing.name, colour ?? existing.colour, req.params.id, req.userId);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'name already exists' });
    throw err;
  }
  res.json({ id: Number(req.params.id), name: name ?? existing.name, colour: colour ?? existing.colour });
});

// DELETE /api/categories/:id
router.delete('/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE category_id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (used.c > 0) return res.status(409).json({ error: 'Category in use by transactions' });
  const result = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./routes/categories'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/categories.js
git commit -m "feat: scope categories to logged-in user"
```

---

### Task 8: Update `routes/accounts.js`

**Files:**
- Modify: `routes/accounts.js`

- [ ] **Step 1: Replace `routes/accounts.js` entirely**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

function calcBalance(accountId, openingBalance) {
  const inc  = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM income        WHERE account_id=? AND date<=date('now')").get(accountId).s;
  const txn  = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions  WHERE account_id=?').get(accountId).s;
  const bill = db.prepare(`SELECT COALESCE(SUM(bm.amount_paid),0) as s FROM bill_months bm JOIN bills b ON bm.bill_id=b.id WHERE b.account_id=? AND bm.paid=1`).get(accountId).s;
  const tin  = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM transfers     WHERE to_account_id=?").get(accountId).s;
  const tout = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM transfers     WHERE from_account_id=?").get(accountId).s;
  return openingBalance + inc - txn - bill + tin - tout;
}

// GET /api/accounts
router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND active = 1 ORDER BY id ASC').all(req.userId);
  res.json(accounts.map(a => ({ ...a, balance: calcBalance(a.id, a.opening_balance) })));
});

// POST /api/accounts
router.post('/', (req, res) => {
  const { name, type, colour, opening_balance } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!['current','savings','card'].includes(type)) return res.status(400).json({ error: 'type must be current, savings, or card' });
  const ob = parseFloat(opening_balance ?? 0);
  if (isNaN(ob)) return res.status(400).json({ error: 'opening_balance must be a number' });
  const result = db.prepare(
    'INSERT INTO accounts (user_id, name, type, colour, opening_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, name.trim(), type, colour ?? '#888888', ob);
  res.status(201).json({ id: result.lastInsertRowid, user_id: req.userId, name: name.trim(), type, colour: colour ?? '#888888', opening_balance: ob, balance: ob, active: 1 });
});

// PATCH /api/accounts/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE accounts SET active = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!a) return res.status(404).json({ error: 'not found' });
  const { name, colour, type, opening_balance } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  const updName = name !== undefined ? name.trim() : a.name;
  const updColour = colour ?? a.colour;
  const updType = type ?? a.type;
  const updOb = opening_balance !== undefined ? parseFloat(opening_balance) : a.opening_balance;
  if (!['current','savings','card'].includes(updType)) return res.status(400).json({ error: 'type must be current, savings, or card' });
  if (isNaN(updOb)) return res.status(400).json({ error: 'opening_balance must be a number' });
  db.prepare('UPDATE accounts SET name=?, colour=?, type=?, opening_balance=? WHERE id=? AND user_id=?')
    .run(updName, updColour, updType, updOb, req.params.id, req.userId);
  res.json({ id: Number(req.params.id), name: updName, colour: updColour, type: updType, opening_balance: updOb, balance: calcBalance(a.id, updOb), active: a.active });
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./routes/accounts'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add routes/accounts.js
git commit -m "feat: scope accounts to logged-in user"
```

---

### Task 9: Update `routes/transactions.js`

**Files:**
- Modify: `routes/transactions.js`

- [ ] **Step 1: Replace `routes/transactions.js` entirely**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/transactions
router.get('/', (req, res) => {
  const { year, month, category_id, account_id } = req.query;
  let sql = `SELECT t.*, c.name as category_name, c.colour as category_colour,
             a.name as account_name, a.colour as account_colour
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             LEFT JOIN accounts   a ON t.account_id  = a.id
             WHERE t.user_id = ?`;
  const params = [req.userId];
  if (year && month) {
    sql += ` AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (category_id) { sql += ` AND t.category_id = ?`; params.push(category_id); }
  if (account_id)  { sql += ` AND t.account_id  = ?`; params.push(account_id); }
  sql += ` ORDER BY t.date DESC, t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

// POST /api/transactions
router.post('/', (req, res) => {
  const { amount, description, category_id, date, account_id } = req.body;
  if (amount == null || !description || !category_id || !date)
    return res.status(400).json({ error: 'amount, description, category_id, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  try {
    const result = db.prepare(
      'INSERT INTO transactions (user_id, amount, description, category_id, date, account_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, parsed, description, category_id, date, account_id ?? null);
    res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, category_id, date, account_id: account_id ?? null });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'category_id does not exist' });
    throw err;
  }
});

// PUT /api/transactions/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { amount, description, category_id, date } = req.body;
  const parsedAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
  if (isNaN(parsedAmount)) return res.status(400).json({ error: 'amount must be a number' });
  db.prepare('UPDATE transactions SET amount=?, description=?, category_id=?, date=? WHERE id=? AND user_id=?')
    .run(parsedAmount, description ?? existing.description,
         category_id ?? existing.category_id, date ?? existing.date,
         req.params.id, req.userId);
  res.json({ id: Number(req.params.id), amount: parsedAmount,
             description: description ?? existing.description,
             category_id: category_id ?? existing.category_id,
             date: date ?? existing.date });
});

// DELETE /api/transactions/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./routes/transactions'); console.log('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add routes/transactions.js
git commit -m "feat: scope transactions to logged-in user"
```

---

### Task 10: Update `routes/transfers.js`

**Files:**
- Modify: `routes/transfers.js`

- [ ] **Step 1: Replace `routes/transfers.js` entirely**

The module-level prepared statements are removed because they need `req.userId` at query time.

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/transfers
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT t.id, t.from_account_id, t.to_account_id, t.amount, t.date, t.note, t.created_at,
           fa.name as from_account_name, fa.colour as from_account_colour,
           ta.name as to_account_name,   ta.colour as to_account_colour
    FROM transfers t
    JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = ?
    JOIN accounts ta ON ta.id = t.to_account_id   AND ta.user_id = ?
    ORDER BY t.date DESC, t.id DESC
  `).all(req.userId, req.userId));
});

// POST /api/transfers
router.post('/', (req, res) => {
  const { from_account_id, to_account_id, amount, date, note } = req.body;
  const amt = parseFloat(amount);
  if (amount == null || isNaN(amt) || amt <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' });
  if (!date || !String(date).trim())
    return res.status(400).json({ error: 'date required' });
  if (!from_account_id || !to_account_id)
    return res.status(400).json({ error: 'from_account_id and to_account_id required' });
  if (Number(from_account_id) === Number(to_account_id))
    return res.status(400).json({ error: 'from and to accounts must be different' });

  const fromAcct = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1 AND user_id = ?').get(from_account_id, req.userId);
  const toAcct   = db.prepare('SELECT id FROM accounts WHERE id = ? AND active = 1 AND user_id = ?').get(to_account_id,   req.userId);
  if (!fromAcct || !toAcct) return res.status(400).json({ error: 'invalid or inactive account' });

  try {
    const result = db.prepare(
      'INSERT INTO transfers (from_account_id, to_account_id, amount, date, note) VALUES (?, ?, ?, ?, ?)'
    ).run(Number(from_account_id), Number(to_account_id), amt, String(date).trim(), note ?? null);
    res.status(201).json(db.prepare('SELECT * FROM transfers WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'invalid account' });
    throw err;
  }
});

// DELETE /api/transfers/:id
router.delete('/:id', (req, res) => {
  // Verify the transfer belongs to this user via accounts join
  const t = db.prepare(`
    SELECT t.id FROM transfers t
    JOIN accounts fa ON fa.id = t.from_account_id AND fa.user_id = ?
    WHERE t.id = ?
  `).get(req.userId, req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM transfers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./routes/transfers'); console.log('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add routes/transfers.js
git commit -m "feat: scope transfers to logged-in user"
```

---

### Task 11: Update `routes/income-schedules.js` and `routes/income.js`

**Files:**
- Modify: `routes/income-schedules.js`
- Modify: `routes/income.js`

- [ ] **Step 1: Replace `routes/income-schedules.js` entirely**

`ensureIncomeEntries` now takes `userId` as a third parameter.

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function ensureIncomeEntries(year, month, userId) {
  const y = Number(year), m = Number(month);
  const now = new Date();
  if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) return;

  const monthPad  = String(m).padStart(2, '0');
  const dim       = daysInMonth(y, m);
  const monthStart = `${y}-${monthPad}-01`;
  const monthEnd   = `${y}-${monthPad}-${String(dim).padStart(2, '0')}`;

  const schedules = db.prepare('SELECT * FROM income_schedules WHERE active = 1 AND user_id = ?').all(userId);

  for (const sched of schedules) {
    if (sched.frequency === 'monthly') {
      const day = Math.min(sched.day_of_month, dim);
      const ym  = `${y}-${monthPad}`;
      if (db.prepare(`SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND strftime('%Y-%m', date) = ?`).get(sched.id, ym).c === 0) {
        db.prepare('INSERT INTO income (user_id, amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(userId, sched.amount, sched.name, `${y}-${monthPad}-${String(day).padStart(2, '0')}`, sched.id, sched.account_id ?? null);
      }
    } else if (sched.frequency === 'weekly') {
      const anchorDow = new Date(sched.anchor_date + 'T00:00:00Z').getUTCDay();
      for (let d = 1; d <= dim; d++) {
        if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== anchorDow) continue;
        const dateStr = `${y}-${monthPad}-${String(d).padStart(2, '0')}`;
        if (db.prepare('SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?').get(sched.id, dateStr).c === 0) {
          db.prepare('INSERT INTO income (user_id, amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, sched.amount, sched.name, dateStr, sched.id, sched.account_id ?? null);
        }
      }
    } else if (sched.frequency === 'four_weekly') {
      let cur = sched.anchor_date;
      while (cur < monthStart) cur = addDays(cur, 28);
      while (cur > monthEnd)   cur = addDays(cur, -28);
      while (cur <= monthEnd) {
        if (cur >= monthStart) {
          if (db.prepare('SELECT COUNT(*) as c FROM income WHERE source_schedule_id = ? AND date = ?').get(sched.id, cur).c === 0) {
            db.prepare('INSERT INTO income (user_id, amount, description, date, source_schedule_id, account_id) VALUES (?, ?, ?, ?, ?, ?)')
              .run(userId, sched.amount, sched.name, cur, sched.id, sched.account_id ?? null);
          }
        }
        cur = addDays(cur, 28);
      }
    }
  }
}

// GET /api/income/schedules
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM income_schedules WHERE user_id = ? ORDER BY created_at DESC').all(req.userId));
});

// POST /api/income/schedules
router.post('/', (req, res) => {
  const { name, amount, frequency, day_of_month, anchor_date, account_id } = req.body;
  if (!name || amount == null || !frequency)
    return res.status(400).json({ error: 'name, amount, frequency required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  if (!['weekly','four_weekly','monthly'].includes(frequency))
    return res.status(400).json({ error: 'frequency must be weekly, four_weekly, or monthly' });
  if (frequency === 'monthly') {
    const day = Number(day_of_month);
    if (!day || day < 1 || day > 31) return res.status(400).json({ error: 'day_of_month required (1–31) for monthly frequency' });
  } else {
    if (!anchor_date) return res.status(400).json({ error: 'anchor_date required for weekly/four_weekly frequency' });
  }
  const result = db.prepare(
    'INSERT INTO income_schedules (user_id, name, amount, frequency, day_of_month, anchor_date, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, name, parsed, frequency, day_of_month ?? null, anchor_date ?? null, account_id ?? null);
  res.status(201).json({ id: result.lastInsertRowid, name, amount: parsed, frequency, day_of_month: day_of_month ?? null, anchor_date: anchor_date ?? null, account_id: account_id ?? null, active: 1 });
});

// PATCH /api/income/schedules/:id/deactivate
router.patch('/:id/deactivate', (req, res) => {
  const sched = db.prepare('SELECT * FROM income_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!sched) return res.status(404).json({ error: 'not found' });
  if (!sched.active) return res.status(409).json({ error: 'already inactive' });
  db.prepare('UPDATE income_schedules SET active = 0 WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ id: Number(req.params.id), active: false });
});

module.exports = { router, ensureIncomeEntries };
```

- [ ] **Step 2: Replace `routes/income.js` entirely**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');

// GET /api/income
router.get('/', (req, res) => {
  const { year, month, account_id } = req.query;
  if (year && month) ensureIncomeEntries(year, month, req.userId);
  let sql = 'SELECT * FROM income WHERE user_id = ?';
  const params = [req.userId];
  if (year && month) {
    sql += ` AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`;
    params.push(String(year), String(month).padStart(2, '0'));
  }
  if (account_id) { sql += ` AND account_id = ?`; params.push(account_id); }
  sql += ' ORDER BY date DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/income
router.post('/', (req, res) => {
  const { amount, description, date, account_id } = req.body;
  if (amount == null || !description || !date)
    return res.status(400).json({ error: 'amount, description, date required' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return res.status(400).json({ error: 'amount must be a number' });
  const result = db.prepare(
    'INSERT INTO income (user_id, amount, description, date, account_id) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, parsed, description, date, account_id ?? null);
  res.status(201).json({ id: result.lastInsertRowid, amount: parsed, description, date, account_id: account_id ?? null });
});

// DELETE /api/income/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM income WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./routes/income-schedules'); require('./routes/income'); console.log('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add routes/income-schedules.js routes/income.js
git commit -m "feat: scope income and schedules to logged-in user"
```

---

### Task 12: Update `routes/bills.js`

**Files:**
- Modify: `routes/bills.js`

- [ ] **Step 1: Replace `routes/bills.js` entirely**

`ensureBillMonths` now takes `userId` as a third parameter.

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');

function ensureBillMonths(year, month, userId) {
  const activeBills = db.prepare('SELECT id FROM bills WHERE active = 1 AND user_id = ?').all(userId);
  const insert = db.prepare('INSERT OR IGNORE INTO bill_months (bill_id, year, month) VALUES (?, ?, ?)');
  for (const bill of activeBills) insert.run(bill.id, year, month);
}

// GET /api/bills
router.get('/', (req, res) => {
  const now = new Date();
  const year  = Number(req.query.year  ?? now.getFullYear());
  const month = Number(req.query.month ?? now.getMonth() + 1);
  const { account_id } = req.query;
  ensureBillMonths(year, month, req.userId);

  let sql = `
    SELECT b.*, c.name as category_name, c.colour as category_colour,
           bm.id as bill_month_id, bm.paid, bm.amount_paid, bm.paid_date
    FROM bills b
    JOIN categories c ON b.category_id = c.id
    LEFT JOIN bill_months bm ON bm.bill_id = b.id AND bm.year = ? AND bm.month = ?
    WHERE b.user_id = ?`;
  const params = [year, month, req.userId];
  if (account_id != null) { sql += ` AND b.account_id = ?`; params.push(account_id); }
  sql += ` ORDER BY b.active DESC, b.due_day ASC`;
  res.json(db.prepare(sql).all(...params));
});

// POST /api/bills
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
      'INSERT INTO bills (user_id, name, amount, due_day, category_id, account_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, name, parsedAmount, parsedDay, category_id, account_id ?? null);
    res.status(201).json({ id: result.lastInsertRowid, name, amount: parsedAmount, due_day: parsedDay, category_id, account_id: account_id ?? null, active: 1 });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'invalid category_id or account_id' });
    throw err;
  }
});

// PATCH /api/bills/:id/cancel
router.patch('/:id/cancel', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!bill) return res.status(404).json({ error: 'not found' });
  if (!bill.active) return res.status(409).json({ error: 'already cancelled' });
  db.prepare("UPDATE bills SET active = 0, cancelled_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  res.json({ id: Number(req.params.id), cancelled: true });
});

// POST /api/bill-months/:id/pay
router.post('/:id/pay', (req, res) => {
  const bm = db.prepare(`
    SELECT bm.* FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id AND b.user_id = ?
    WHERE bm.id = ?
  `).get(req.userId, req.params.id);
  if (!bm) return res.status(404).json({ error: 'not found' });
  const bill = db.prepare('SELECT amount FROM bills WHERE id = ?').get(bm.bill_id);
  const amount_paid = req.body.amount_paid != null ? parseFloat(req.body.amount_paid) : bill.amount;
  if (isNaN(amount_paid)) return res.status(400).json({ error: 'amount_paid must be a number' });
  db.prepare("UPDATE bill_months SET paid = 1, amount_paid = ?, paid_date = date('now') WHERE id = ?")
    .run(amount_paid, req.params.id);
  res.json({ id: Number(req.params.id), paid: true, amount_paid });
});

module.exports = router;
module.exports.ensureBillMonths = ensureBillMonths;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./routes/bills'); console.log('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add routes/bills.js
git commit -m "feat: scope bills to logged-in user"
```

---

### Task 13: Update `routes/settings.js`

**Files:**
- Modify: `routes/settings.js`

- [ ] **Step 1: Read the current file to confirm its structure**

The file is at `routes/settings.js`. The key changes needed:
- `stmtGet` query changes from `WHERE key = ?` to `WHERE user_id = ? AND key = ?`
- `stmtUpsert` changes to include `user_id` and `ON CONFLICT(user_id, key)`
- `_migrate(layout)` gains a `userId` parameter and uses it when upserting

- [ ] **Step 2: Apply the three targeted edits**

**Edit 1** — update `stmtGet`:

Find:
```javascript
const stmtGet    = db.prepare('SELECT value FROM settings WHERE key = ?');
```
Replace with:
```javascript
const stmtGet    = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?');
```

**Edit 2** — update `stmtUpsert`:

Find:
```javascript
const stmtUpsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
```
Replace with:
```javascript
const stmtUpsert = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value');
```

**Edit 3** — update `_migrate` signature and its upsert call.

Find:
```javascript
function _migrate(layout) {
```
Replace with:
```javascript
function _migrate(layout, userId) {
```

Find (the upsert inside `_migrate` — it is called when `changed` is true):
```javascript
    stmtUpsert.run('dashboard_layout', JSON.stringify(layout));
```
Replace with:
```javascript
    if (userId != null) stmtUpsert.run(userId, 'dashboard_layout', JSON.stringify(layout));
```

**Edit 4** — update `GET /api/settings/dashboard` handler.

Find:
```javascript
  const row = stmtGet.get('dashboard_layout');
```
Replace with:
```javascript
  const row = stmtGet.get(req.userId, 'dashboard_layout');
```

Find the `_migrate` call in the GET handler:
```javascript
  const { layout, changed } = _migrate(parsed);
  if (changed) stmtUpsert.run('dashboard_layout', JSON.stringify(layout));
```
Replace with:
```javascript
  const { layout } = _migrate(parsed, req.userId);
```

**Edit 5** — update `POST /api/settings/dashboard` handler upsert call.

Find:
```javascript
  stmtUpsert.run('dashboard_layout', JSON.stringify(body));
```
Replace with:
```javascript
  stmtUpsert.run(req.userId, 'dashboard_layout', JSON.stringify(body));
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./routes/settings'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 4: Verify existing settings tests still pass**

```bash
node tests/settings.test.js
```

Expected: `9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add routes/settings.js
git commit -m "feat: scope settings to logged-in user"
```

---

### Task 14: Update `routes/summary.js` and `routes/calendar.js`

**Files:**
- Modify: `routes/summary.js`
- Modify: `routes/calendar.js`

- [ ] **Step 1: Replace `routes/summary.js` entirely**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { ensureIncomeEntries } = require('./income-schedules');

router.get('/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthPad = String(month).padStart(2, '0');
  const uid = req.userId;

  ensureIncomeEntries(year, month, uid);

  const incomeRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM income
     WHERE user_id = ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ? AND date <= date('now')`
  ).get(uid, year, monthPad);

  const spentRow = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?`
  ).get(uid, year, monthPad);

  const byCategory = db.prepare(
    `SELECT c.name, c.colour, COALESCE(SUM(t.amount), 0) as total
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = ?
       AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = ?
     WHERE c.user_id = ?
     GROUP BY c.id ORDER BY total DESC`
  ).all(uid, year, monthPad, uid);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Number(year), Number(month) - 1 - i, 1);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const inc = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as t FROM income WHERE user_id=? AND strftime('%Y',date)=? AND strftime('%m',date)=? AND date<=date('now')`
    ).get(uid, y, m).t;
    const spent = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=? AND strftime('%Y',date)=? AND strftime('%m',date)=?`
    ).get(uid, y, m).t;
    months.push({ year: y, month: m, income: inc, spent });
  }

  res.json({
    income: incomeRow.total,
    spent: spentRow.total,
    remaining: incomeRow.total - spentRow.total,
    byCategory,
    monthlyTrend: months,
  });
});

module.exports = router;
```

- [ ] **Step 2: Replace `routes/calendar.js` entirely**

```javascript
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { ensureBillMonths }    = require('./bills');
const { ensureIncomeEntries } = require('./income-schedules');

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

router.get('/:year/:month', (req, res) => {
  const year     = Number(req.params.year);
  const month    = Number(req.params.month);
  const monthPad = String(month).padStart(2, '0');
  const dim      = daysInMonth(year, month);
  const uid      = req.userId;

  ensureBillMonths(year, month, uid);
  ensureIncomeEntries(year, month, uid);

  const billRows = db.prepare(`
    SELECT b.name, b.amount, b.due_day, c.colour, bm.paid
    FROM bill_months bm
    JOIN bills b ON b.id = bm.bill_id AND b.user_id = ?
    JOIN categories c ON c.id = b.category_id
    WHERE bm.year = ? AND bm.month = ? AND b.active = 1
    ORDER BY b.due_day ASC
  `).all(uid, year, month);

  const incomeRows = db.prepare(`
    SELECT amount, description, date, source_schedule_id
    FROM income
    WHERE user_id = ? AND strftime('%Y', date) = ? AND strftime('%m', date) = ?
    ORDER BY date ASC
  `).all(uid, String(year), monthPad);

  const events = [];
  for (const b of billRows) {
    const day = Math.min(b.due_day, dim);
    events.push({ date: `${year}-${monthPad}-${String(day).padStart(2,'0')}`, type: 'bill', name: b.name, amount: b.amount, colour: b.colour, paid: b.paid });
  }
  for (const inc of incomeRows) {
    events.push({ date: inc.date, type: inc.source_schedule_id != null ? 'income' : 'income_oneoff', name: inc.description, amount: inc.amount });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ events });
});

module.exports = router;
```

- [ ] **Step 3: Verify syntax**

```bash
node -e "require('./routes/summary'); require('./routes/calendar'); console.log('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add routes/summary.js routes/calendar.js
git commit -m "feat: scope summary and calendar to logged-in user"
```

---

### Task 15: `public/index.html` — login overlay + user pill

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace `public/index.html` entirely**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FinTrack</title>
  <link rel="stylesheet" href="style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
</head>
<body>
  <div id="login-overlay" class="login-overlay" style="display:none"></div>
  <nav id="sidebar">
    <div class="logo">💰 FinTrack</div>
    <a data-page="dashboard"  class="active">📊 Dashboard</a>
    <a data-page="accounts">🏦 Accounts</a>
    <a data-page="transfers">🔁 Transfers</a>
    <a data-page="spending">💳 Daily Spending</a>
    <a data-page="bills">📅 Bills</a>
    <a data-page="income">💼 Income</a>
    <a data-page="reports">📈 Reports</a>
    <a data-page="settings">⚙️ Settings</a>
    <div style="flex:1"></div>
    <div id="user-pill" class="user-pill" style="display:none">
      <div id="user-pill-avatar" class="user-pill-avatar"></div>
      <span id="user-pill-name" class="user-pill-name"></span>
      <span class="user-pill-switch">⇄</span>
    </div>
  </nav>
  <main id="main"></main>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add login overlay and user pill to HTML"
```

---

### Task 16: `public/app.js` — auth integration

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `currentUser` module-level variable**

Find the existing module-level variable block (around line 23, after `let _categories = []`):
```javascript
let _accounts = [];
async function getAccounts() {
```

Insert **before** that block:
```javascript
let currentUser = null;
```

- [ ] **Step 2: Update `api()` to intercept 401**

Find:
```javascript
  if (res.status === 204) return null;
  return res.json();
```
Replace with:
```javascript
  if (res.status === 401) { showLogin(); return null; }
  if (res.status === 204) return null;
  return res.json();
```

- [ ] **Step 3: Replace the last line of `app.js`**

Find the very last line:
```javascript
navigate('dashboard');
```
Replace with:
```javascript
async function init() {
  const me = await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!me) { showLogin(); return; }
  currentUser = me;
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = me.colour;
  document.getElementById('user-pill-avatar').textContent = me.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = me.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  navigate('dashboard');
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  invalidateAccounts();
  invalidateCategories();
  currentUser = null;
  document.getElementById('user-pill').style.display = 'none';
  showLogin();
}

async function showLogin() {
  invalidateAccounts();
  invalidateCategories();
  const overlay = document.getElementById('login-overlay');
  overlay.style.display = 'flex';
  const users = await fetch('/api/users/picker').then(r => r.json()).catch(() => []);

  if (users.length === 0) {
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-logo">💰 FinTrack</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Create your admin account to get started.</p>
        <form id="firstRunForm">
          <input type="text" id="frName" placeholder="Your name" required autocomplete="off" style="width:100%;margin-bottom:10px">
          <input type="password" id="frPass" placeholder="Password" required style="width:100%;margin-bottom:12px">
          <div style="margin-bottom:14px">
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Avatar colour</div>
            <div class="colour-picker-row" id="frColours">
              ${['#4a9eff','#f7a4a2','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'].map((c,i) =>
                `<div class="colour-opt${i===0?' selected':''}" data-colour="${c}" style="background:${c}" onclick="pickColour(this)"></div>`
              ).join('')}
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%">Create Account</button>
        </form>
      </div>`;
    document.getElementById('firstRunForm').addEventListener('submit', async e => {
      e.preventDefault();
      const name   = document.getElementById('frName').value.trim();
      const pass   = document.getElementById('frPass').value;
      const colour = document.querySelector('.colour-opt.selected')?.dataset.colour ?? '#4a9eff';
      const r = await fetch('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name: name, password: pass, colour }) }).then(x => x.json());
      if (r.error) { alert(r.error); return; }
      await doLogin(name, pass);
    });
  } else {
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-logo">💰 FinTrack</div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;text-align:center">Who's using FinTrack?</p>
        <div class="user-picker-grid" id="pickerGrid">
          ${users.map(u => `
            <div class="user-picker-item" onclick="selectUser(${u.id},${JSON.stringify(u.display_name)})">
              <div class="user-avatar-circle" style="background:${u.colour}">${u.display_name[0].toUpperCase()}</div>
              <div class="user-picker-name">${esc(u.display_name)}</div>
            </div>`).join('')}
        </div>
        <div id="pwPrompt" style="display:none;margin-top:16px;width:100%">
          <p id="pwPromptLabel" style="text-align:center;font-size:13px;color:var(--muted);margin-bottom:10px"></p>
          <input type="password" id="pwInput" placeholder="Password" style="width:100%;margin-bottom:10px" autocomplete="current-password">
          <button class="btn btn-primary" style="width:100%;margin-bottom:6px" onclick="submitPw()">Enter</button>
          <button class="btn btn-ghost" style="width:100%" onclick="showLogin()">← Back</button>
        </div>
      </div>`;
  }
}

let _loginUserId = null, _loginUserName = null;

window.selectUser = function(id, name) {
  _loginUserId   = id;
  _loginUserName = name;
  document.getElementById('pickerGrid').style.display   = 'none';
  document.getElementById('pwPrompt').style.display      = 'block';
  document.getElementById('pwPromptLabel').textContent   = `Enter password for ${name}`;
  document.getElementById('pwInput').value = '';
  document.getElementById('pwInput').focus();
};

window.submitPw = async function() {
  await doLogin(_loginUserName, document.getElementById('pwInput').value);
};

window.pickColour = function(el) {
  document.querySelectorAll('.colour-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
};

async function doLogin(display_name, password) {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name, password }),
  }).then(x => x.json());
  if (r.error) { alert('Incorrect password'); return; }
  currentUser = r;
  document.getElementById('login-overlay').style.display = 'none';
  const pill = document.getElementById('user-pill');
  document.getElementById('user-pill-avatar').style.background = r.colour;
  document.getElementById('user-pill-avatar').textContent = r.display_name[0].toUpperCase();
  document.getElementById('user-pill-name').textContent = r.display_name;
  pill.style.display = 'flex';
  pill.onclick = logout;
  navigate('dashboard');
}

init();
```

- [ ] **Step 4: Verify the server starts and serves the page without JS errors**

Start the server, open `http://localhost:3000` in a browser. You should see the login overlay (since no users exist yet). Open browser DevTools console — no errors.

```bash
node server.js
```

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: login overlay and auth integration in app.js"
```

---

### Task 17: `public/app.js` — Settings users section

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Update `pages.settings` to add a `users` tab for admins**

Find the line in `pages.settings`:
```javascript
  const tab = t => {
    const labels = { categories: 'Categories', updates: 'Updates', system: 'System' };
```
Replace with:
```javascript
  const tab = t => {
    const labels = { categories: 'Categories', updates: 'Updates', system: 'System', users: 'Users' };
```

Find:
```javascript
  const [cats, version] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '', version: '?' })),
  ]);
```
Replace with:
```javascript
  const [cats, version, allUsers] = await Promise.all([
    getCategories(),
    api('/update/version').catch(() => ({ hash: 'unknown', message: '', date: '', version: '?' })),
    currentUser?.is_admin ? api('/users') : Promise.resolve([]),
  ]);
```

Find the tab bar HTML (the line that renders the tab buttons). It currently renders `categories`, `updates`, `system`. Find:
```javascript
    ${[tab('categories'), tab('updates'), tab('system')].join('')}
```
Replace with:
```javascript
    ${[tab('categories'), tab('updates'), tab('system'), ...(currentUser?.is_admin ? [tab('users')] : [])].join('')}
```

Add a `usersHTML` variable after `const systemHTML = ...` block (find the closing backtick of systemHTML and the line after it):

Find (the line after the systemHTML closing backtick that leads to `main().innerHTML`):
```javascript
  main().innerHTML = `
```
Insert before it:
```javascript
  const usersHTML = currentUser?.is_admin ? `
    <div class="card" style="margin-bottom:20px">
      <div class="chart-title" style="margin-bottom:16px">Users</div>
      <div class="list" id="usersList">
        ${allUsers.map(u => `
          <div class="list-item">
            <div class="user-avatar-circle" style="background:${u.colour};width:28px;height:28px;font-size:11px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">${esc(u.display_name)[0].toUpperCase()}</div>
            <span class="desc">${esc(u.display_name)}</span>
            <span class="badge" style="font-size:10px;padding:2px 8px">${u.is_admin ? 'Admin' : 'User'}</span>
            ${u.id === currentUser.id ? '' : `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${esc(u.display_name)}')">Delete</button>`}
          </div>`).join('')}
      </div>
      <form id="addUserForm" style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
        <div class="form-row">
          <input type="text" id="newUserDisplay" placeholder="Display name" style="flex:1" required autocomplete="off">
          <input type="password" id="newUserPassword" placeholder="Password" style="flex:1" required>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--muted)">Colour:</span>
          <div class="colour-picker-row" id="addUserColours">
            ${['#4a9eff','#f7a4a2','#a8d8a8','#ffd700','#c39bd3','#ff8c42','#76d7c4'].map((c,i) =>
              `<div class="colour-opt${i===0?' selected':''}" data-colour="${c}" style="background:${c}" onclick="pickColour(this)"></div>`
            ).join('')}
          </div>
          <button class="btn btn-primary btn-sm" type="submit">Add User</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">Change Password</div>
      <form id="changePwForm" style="display:flex;flex-direction:column;gap:8px">
        <input type="password" id="cpCurrent" placeholder="Current password" style="max-width:300px">
        <input type="password" id="cpNew"     placeholder="New password"     style="max-width:300px">
        <div><button type="submit" class="btn btn-ghost btn-sm">Update Password</button></div>
      </form>
    </div>` : `
    <div class="card">
      <div class="chart-title" style="margin-bottom:12px">Change Password</div>
      <form id="changePwForm" style="display:flex;flex-direction:column;gap:8px">
        <input type="password" id="cpCurrent" placeholder="Current password" style="max-width:300px">
        <input type="password" id="cpNew"     placeholder="New password"     style="max-width:300px">
        <div><button type="submit" class="btn btn-ghost btn-sm">Update Password</button></div>
      </form>
    </div>`;

```

Now wire up the tab in the `main().innerHTML` template. Find the line that selects which HTML to show (it currently uses `activeTab`):
```javascript
    ${activeTab === 'categories' ? categoriesHTML : activeTab === 'updates' ? updatesHTML : systemHTML}
```
Replace with:
```javascript
    ${activeTab === 'categories' ? categoriesHTML : activeTab === 'updates' ? updatesHTML : activeTab === 'users' ? usersHTML : systemHTML}
```

- [ ] **Step 2: Add `deleteUser` and change-password event handlers at the bottom of `app.js` (before `init()`)**

Find the line `init();` at the very bottom and insert before it:

```javascript
window.deleteUser = async function(id, name) {
  if (!confirm(`Delete ${name} and all their data? This cannot be undone.`)) return;
  await api(`/users/${id}`, { method: 'DELETE' });
  pages.settings('users');
};

// Wire up add-user and change-password forms after settings renders
document.addEventListener('click', e => {
  const addForm = document.getElementById('addUserForm');
  if (addForm && !addForm._wired) {
    addForm._wired = true;
    addForm.addEventListener('submit', async ev => {
      ev.preventDefault();
      const colour = addForm.querySelector('.colour-opt.selected')?.dataset.colour ?? '#4a9eff';
      const r = await api('/users', { method: 'POST', body: {
        display_name: document.getElementById('newUserDisplay').value.trim(),
        password:     document.getElementById('newUserPassword').value,
        colour,
      }});
      if (r?.error) { alert(r.error); return; }
      pages.settings('users');
    });
  }
  const cpForm = document.getElementById('changePwForm');
  if (cpForm && !cpForm._wired) {
    cpForm._wired = true;
    cpForm.addEventListener('submit', async ev => {
      ev.preventDefault();
      const r = await api(`/users/${currentUser.id}/password`, { method: 'PATCH', body: {
        current_password: document.getElementById('cpCurrent').value,
        new_password:     document.getElementById('cpNew').value,
      }});
      if (r?.error) { alert(r.error); return; }
      alert('Password updated.');
      document.getElementById('cpCurrent').value = '';
      document.getElementById('cpNew').value = '';
    });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: admin users section in settings"
```

---

### Task 18: `public/style.css` — login overlay + user pill CSS

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Append new CSS to the end of `public/style.css`**

```css
/* ── Login overlay ──────────────────────────────────────────────────────── */
.login-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-box {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px 28px;
  width: 320px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.login-logo {
  font-size: 22px;
  font-weight: 700;
  color: var(--accent);
  text-align: center;
  margin-bottom: 20px;
}

/* ── User picker grid ───────────────────────────────────────────────────── */
.user-picker-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
}

.user-picker-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: background 0.15s;
}

.user-picker-item:hover { background: #222; }

.user-avatar-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #111;
}

.user-picker-name {
  font-size: 11px;
  color: var(--muted);
}

/* ── Colour picker ──────────────────────────────────────────────────────── */
.colour-picker-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.colour-opt {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}

.colour-opt.selected { border-color: #fff; }

/* ── User pill (sidebar bottom) ─────────────────────────────────────────── */
.user-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  background: #111;
  border: 1px solid var(--border);
  margin-top: 4px;
  transition: background 0.15s;
}

.user-pill:hover { background: #1f1f1f; }

.user-pill-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #111;
  flex-shrink: 0;
}

.user-pill-name {
  font-size: 12px;
  color: var(--muted);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-pill-switch {
  font-size: 12px;
  color: #555;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: login overlay and user pill CSS"
```

---

### Task 19: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version**

In `package.json`, change:
```json
"version": "1.4.3",
```
to:
```json
"version": "1.5.0",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 1.5.0"
```

---

### Task 20: End-to-end smoke test

**Files:**
- None modified

- [ ] **Step 1: Run all existing tests**

```bash
node tests/settings.test.js
node tests/auth.test.js
node tests/db-migration.test.js
```

Expected: all pass with 0 failures.

- [ ] **Step 2: Start server and create first user**

```bash
node server.js
```

Open `http://localhost:3000`. You should see the login overlay with "Create your admin account" form. Fill in a name, password, and colour. Click "Create Account". The overlay closes and the dashboard loads.

- [ ] **Step 3: Verify user pill appears**

The sidebar should show the user pill at the bottom with the user's coloured avatar and name.

- [ ] **Step 4: Verify data isolation**

Go to Settings → Users tab. Add a second user. Click the pill → ⇄ → log in as the second user. Confirm the second user sees empty data (no transactions, their own default "Current Account").

- [ ] **Step 5: Verify admin delete**

Log in as admin. Go to Settings → Users. Delete the second user. Confirm they no longer appear on the picker.

- [ ] **Step 6: Final commit if any fixes were made, then push**

```bash
git push
```
