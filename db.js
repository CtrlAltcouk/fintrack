const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { resolveDatabasePath } = require('./lib/database-path');
const {
  migrateToMultiUserV1, migrateRecurringBillsV2, migrateRecurringIncomeV3,
  migrateRecurrenceRunnerV4,
  migrateRecurringTransactionsV5,
  migrateRecurringTransfersV6,
  migrateSessionSecurityV7,
  migrateFinancialConstraintsV8,
  migrateLoginSecurityV9,
  assertSupportedSchemaVersion,
} = require('./db-migrations');

const dbPath = resolveDatabasePath(process.env, __dirname);
const dataDir = path.dirname(dbPath);
fs.mkdirSync(dataDir, { recursive: true });

if (process.env.NODE_ENV === 'production') {
  console.log(`[database] Using persistent database: ${dbPath}`);
}

const db = new Database(dbPath);

assertSupportedSchemaVersion(db);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

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
    session_token_hash TEXT,
    session_created_at TEXT,
    session_expires_at TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Preserve legacy single-user rows with NULL ownership. The first explicitly
// created admin account claims those rows transactionally.
migrateToMultiUserV1(db, { dbPath });
migrateRecurringBillsV2(db, { dbPath });
migrateRecurringIncomeV3(db, { dbPath });
migrateRecurrenceRunnerV4(db, { dbPath });
migrateRecurringTransactionsV5(db, { dbPath });
migrateRecurringTransfersV6(db, { dbPath });
migrateSessionSecurityV7(db);
migrateFinancialConstraintsV8(db, { dbPath });
migrateLoginSecurityV9(db);

module.exports = db;
