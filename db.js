const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'fintrack.db'));

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    colour TEXT NOT NULL DEFAULT '#888888',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    due_day INTEGER NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS bill_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id),
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    amount_paid REAL,
    paid_date TEXT,
    UNIQUE(bill_id, year, month)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS income_schedules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    amount       REAL    NOT NULL,
    frequency    TEXT    NOT NULL CHECK(frequency IN ('weekly','four_weekly','monthly')),
    day_of_month INTEGER,
    anchor_date  TEXT,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    type            TEXT    NOT NULL CHECK(type IN ('current','savings','card')),
    colour          TEXT    NOT NULL DEFAULT '#888888',
    opening_balance REAL    NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

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

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

for (const col of [
  `ALTER TABLE transactions     ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE income           ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE bills            ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
  `ALTER TABLE income_schedules ADD COLUMN account_id INTEGER REFERENCES accounts(id)`,
]) {
  try { db.exec(col); } catch (e) { if (!e.message.includes('duplicate column name')) throw e; }
}

try {
  db.exec(`ALTER TABLE income ADD COLUMN source_schedule_id INTEGER REFERENCES income_schedules(id)`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

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
  db.exec(`DROP TABLE IF EXISTS categories_old`);
  db.exec(`DROP TABLE categories`);
  db.exec(`
    CREATE TABLE categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      name       TEXT    NOT NULL,
      colour     TEXT    NOT NULL DEFAULT '#888888',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    )
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

try {
  db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

// Fresh-start wipe: only runs when no users exist (first migration)
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  db.pragma('foreign_keys = OFF');
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
  db.pragma('foreign_keys = ON');
}

module.exports = db;
