const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const {
  claimLegacyData,
  migrateToMultiUserV1,
} = require('../db-migrations');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

const root = path.dirname(process.env.FINTRACK_DB_PATH);

function createLegacyDatabase(filename, { populated = false, includeUsers = true } = {}) {
  const dbPath = path.join(root, filename);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  if (includeUsers) {
    db.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      colour TEXT NOT NULL DEFAULT '#4a9eff',
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }
  db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      colour TEXT NOT NULL DEFAULT '#888888',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      colour TEXT NOT NULL,
      opening_balance REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE income_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      frequency TEXT NOT NULL,
      day_of_month INTEGER,
      anchor_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      account_id INTEGER REFERENCES accounts(id)
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      account_id INTEGER REFERENCES accounts(id)
    );
    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      account_id INTEGER REFERENCES accounts(id),
      source_schedule_id INTEGER REFERENCES income_schedules(id)
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      due_day INTEGER NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cancelled_at TEXT,
      account_id INTEGER REFERENCES accounts(id)
    );
    CREATE TABLE bill_months (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      amount_paid REAL,
      paid_date TEXT,
      UNIQUE(bill_id, year, month)
    );
    CREATE TABLE transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account_id INTEGER NOT NULL REFERENCES accounts(id),
      to_account_id INTEGER NOT NULL REFERENCES accounts(id),
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (populated) {
    db.exec(`
      INSERT INTO categories (id, name, colour) VALUES (11, 'Legacy category', '#123456');
      INSERT INTO accounts (id, name, type, colour, opening_balance) VALUES
        (21, 'Legacy current', 'current', '#111111', 250),
        (22, 'Legacy savings', 'savings', '#222222', 500);
      INSERT INTO income_schedules
        (id, name, amount, frequency, day_of_month, account_id)
        VALUES (31, 'Legacy salary', 100, 'monthly', 25, 21);
      INSERT INTO transactions
        (id, amount, description, category_id, date, account_id)
        VALUES (41, 12.5, 'Legacy spend', 11, '2026-07-02', 21);
      INSERT INTO income
        (id, amount, description, date, account_id, source_schedule_id)
        VALUES (51, 100, 'Legacy income', '2026-07-01', 21, 31);
      INSERT INTO bills
        (id, name, amount, due_day, category_id, account_id)
        VALUES (61, 'Legacy bill', 25, 3, 11, 21);
      INSERT INTO bill_months
        (id, bill_id, year, month, paid, amount_paid, paid_date)
        VALUES (71, 61, 2026, 7, 1, 25, '2026-07-03');
      INSERT INTO transfers
        (id, from_account_id, to_account_id, amount, date, note)
        VALUES (81, 21, 22, 10, '2026-07-04', 'Legacy transfer');
      INSERT INTO settings (key, value) VALUES ('dashboard_mode', 'monthly');
    `);
  }
  return { db, dbPath };
}

test('fresh database migrates without creating a backup or owner', () => {
  const { db, dbPath } = createLegacyDatabase('migration-fresh.db');
  const result = migrateToMultiUserV1(db, { dbPath });
  assert.strictEqual(result.migrated, true);
  assert.strictEqual(result.backupPath, null);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  db.close();
});

test('populated legacy migration preserves rows, totals, IDs, and links', () => {
  const { db, dbPath } = createLegacyDatabase('migration-populated.db', { populated: true });
  const tables = ['categories','accounts','income_schedules','bills','bill_months','income','transactions','transfers','settings'];
  const rowCounts = Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
  const before = {
    transactions: db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM transactions').get(),
    income: db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM income').get(),
    bills: db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM bills').get(),
    transfers: db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM transfers').get(),
  };
  const result = migrateToMultiUserV1(db, { dbPath });
  assert.ok(result.backupPath && fs.existsSync(result.backupPath));
  for (const table of tables) {
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, rowCounts[table], `${table} row count changed`);
  }
  assert.deepStrictEqual(
    db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM transactions').get(),
    before.transactions
  );
  assert.deepStrictEqual(db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM income').get(), before.income);
  assert.deepStrictEqual(db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM bills').get(), before.bills);
  assert.deepStrictEqual(db.prepare('SELECT COUNT(*) AS count, SUM(amount) AS total FROM transfers').get(), before.transfers);
  assert.deepStrictEqual(
    db.prepare('SELECT id, category_id, account_id FROM transactions WHERE id = 41').get(),
    { id: 41, category_id: 11, account_id: 21 }
  );
  assert.strictEqual(db.prepare('SELECT bill_id FROM bill_months WHERE id = 71').get().bill_id, 61);

  const ownerId = Number(db.prepare(`INSERT INTO users
    (display_name, password_hash, colour, is_admin) VALUES ('Legacy Owner', 'chosen-by-user', '#4a9eff', 1)`)
    .run().lastInsertRowid);
  assert.strictEqual(claimLegacyData(db, ownerId), true);
  for (const table of ['categories','accounts','income_schedules','bills','income','transactions','transfers','settings']) {
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id != ? OR user_id IS NULL`).get(ownerId).count, 0);
  }
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);

  const second = migrateToMultiUserV1(db, { dbPath });
  assert.deepStrictEqual(second, { migrated: false, backupPath: null, legacyRows: 0 });
  assert.strictEqual(fs.readdirSync(root).filter(name => name.startsWith('migration-populated.db.pre-multi-user')).length, 1);

  const backup = new Database(result.backupPath, { readonly: true });
  assert.strictEqual(backup.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 1);
  assert.strictEqual(backup.prepare('SELECT SUM(amount) AS total FROM income').get().total, 100);
  backup.close();
  db.close();
});

test('db.js upgrades a realistic pre-user database and waits for explicit owner activation', () => {
  const { db, dbPath } = createLegacyDatabase('migration-realistic.db', {
    populated: true,
    includeUsers: false,
  });
  db.close();
  const child = spawnSync(process.execPath, ['-e', "const db=require('./db'); db.close();"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, FINTRACK_DB_PATH: dbPath },
    encoding: 'utf8',
  });
  assert.strictEqual(child.status, 0, child.stderr);

  const upgraded = new Database(dbPath);
  upgraded.pragma('foreign_keys = ON');
  assert.strictEqual(upgraded.pragma('user_version', { simple: true }), 10);
  assert.strictEqual(upgraded.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  assert.strictEqual(upgraded.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 1);
  assert.strictEqual(upgraded.prepare('SELECT SUM(amount) AS total FROM income').get().total, 100);
  assert.strictEqual(upgraded.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id IS NULL').get().count, 2);
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('migration-realistic.db.pre-multi-user-v1.backup')));
  upgraded.close();

  const activationCode = `
    process.env.PORT = '0';
    const bcrypt = require('bcryptjs');
    const { server } = require('./server');
    const db = require('./db');
    (async () => {
      if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'Chosen Owner', password: 'owner-chosen-password', colour: '#4a9eff' }),
      });
      if (response.status !== 201) throw new Error('activation returned ' + response.status + ': ' + await response.text());
      const user = db.prepare("SELECT * FROM users WHERE display_name = 'Chosen Owner'").get();
      if (!user || !bcrypt.compareSync('owner-chosen-password', user.password_hash)) throw new Error('chosen credentials were not stored');
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      db.close();
    })().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
  `;
  const activation = spawnSync(process.execPath, ['-e', activationCode], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, FINTRACK_DB_PATH: dbPath },
    encoding: 'utf8',
  });
  assert.strictEqual(activation.status, 0, activation.stderr);

  const activated = new Database(dbPath, { readonly: true });
  const ownerId = activated.prepare("SELECT id FROM users WHERE display_name = 'Chosen Owner'").get().id;
  assert.strictEqual(activated.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(ownerId).count, 1);
  assert.strictEqual(activated.prepare('SELECT COUNT(*) AS count FROM bill_months bm JOIN bills b ON b.id = bm.bill_id WHERE b.user_id = ?').get(ownerId).count, 1);
  assert.strictEqual(activated.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?').get(ownerId).count, 1);
  assert.strictEqual(activated.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').get(ownerId).count, 2);
  activated.close();
});

test('simulated migration failure rolls back every schema and data change', () => {
  const { db, dbPath } = createLegacyDatabase('migration-rollback.db', { populated: true });
  assert.throws(() => migrateToMultiUserV1(db, {
    dbPath,
    beforeCommit: () => { throw new Error('simulated migration failure'); },
  }), /simulated migration failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0);
  assert.ok(!db.prepare('PRAGMA table_info(categories)').all().some(column => column.name === 'user_id'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 1);
  assert.strictEqual(db.prepare('SELECT SUM(amount) AS total FROM income').get().total, 100);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger'").get().count, 0);
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('migration-rollback.db.pre-multi-user-v1.backup')));
  db.close();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
