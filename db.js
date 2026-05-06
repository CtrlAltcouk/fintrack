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

try {
  db.exec(`ALTER TABLE income ADD COLUMN source_schedule_id INTEGER REFERENCES income_schedules(id)`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

const seedCategories = [
  { name: 'Housing',       colour: '#f7a4a2' },
  { name: 'Groceries',     colour: '#a8d8a8' },
  { name: 'Transport',     colour: '#ffd700' },
  { name: 'Utilities',     colour: '#87ceeb' },
  { name: 'Eating Out',    colour: '#ffb347' },
  { name: 'Entertainment', colour: '#c39bd3' },
  { name: 'Health',        colour: '#76d7c4' },
  { name: 'Other',         colour: '#888888' },
];

const countRow = db.prepare('SELECT COUNT(*) as c FROM categories').get();
if (countRow.c === 0) {
  const insert = db.prepare('INSERT INTO categories (name, colour) VALUES (?, ?)');
  for (const cat of seedCategories) insert.run(cat.name, cat.colour);
}

module.exports = db;
