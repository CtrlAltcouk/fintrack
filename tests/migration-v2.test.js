const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateRecurringBillsV2 } = require('../db-migrations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-migration-v2-'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

function createV1(name) {
  const dbPath = path.join(root, name);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL);
    INSERT INTO users VALUES (1, 'Owner', 'hash');
    CREATE TABLE categories (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, colour TEXT, created_at TEXT);
    INSERT INTO categories VALUES (1, 1, 'Bills', '#123456', '2025-01-01 00:00:00');
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, type TEXT, colour TEXT, opening_balance REAL, active INTEGER, created_at TEXT);
    INSERT INTO accounts VALUES (1, 1, 'Current', 'current', '#123456', 0, 1, '2025-01-01 00:00:00');
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT NOT NULL,
      amount REAL NOT NULL, due_day INTEGER NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
      account_id INTEGER REFERENCES accounts(id), active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, cancelled_at TEXT
    );
    INSERT INTO bills VALUES (41, 1, 'Mortgage', 900, 31, 1, 1, 1, '2025-01-02 00:00:00', NULL);
    CREATE TABLE bill_months (
      id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id), year INTEGER NOT NULL,
      month INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, amount_paid REAL, paid_date TEXT,
      UNIQUE(bill_id, year, month)
    );
    INSERT INTO bill_months VALUES (91, 41, 2025, 1, 1, 875, '2025-01-31');
    INSERT INTO bill_months VALUES (92, 41, 2025, 2, 0, NULL, NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')));
    INSERT INTO schema_migrations(version, name) VALUES (1, 'preserve-legacy-multi-user');
    PRAGMA user_version = 1;
  `);
  return { db, dbPath };
}

test('migration preserves bill-month IDs, payments, ownership, and foreign keys', () => {
  const { db, dbPath } = createV1('preserve.db');
  const result = migrateRecurringBillsV2(db, { dbPath });
  assert.strictEqual(result.migrated, true);
  assert.ok(result.backupPath && fs.statSync(result.backupPath).size > 0);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 2);
  const paid = db.prepare('SELECT * FROM bill_months WHERE id = 91').get();
  assert.strictEqual(paid.amount_paid, 875);
  assert.strictEqual(paid.paid_date, '2025-01-31');
  assert.strictEqual(paid.due_date, '2025-01-31');
  assert.ok(paid.recurring_occurrence_id);
  assert.strictEqual(db.prepare('SELECT user_id FROM recurring_series').get().user_id, 1);
  assert.strictEqual(db.prepare('SELECT recurring_series_id FROM bills WHERE id = 41').get().recurring_series_id, 1);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

test('migration backups never overwrite an existing backup', () => {
  const first = createV1('backup.db');
  fs.writeFileSync(`${first.dbPath}.pre-recurring-bills-v2.backup`, 'existing');
  const result = migrateRecurringBillsV2(first.db, { dbPath: first.dbPath });
  assert.ok(result.backupPath.endsWith('.backup.1'));
  assert.strictEqual(fs.readFileSync(`${first.dbPath}.pre-recurring-bills-v2.backup`, 'utf8'), 'existing');
  first.db.close();
});

test('injected failure rolls back schema, data, version, and ownership links', () => {
  const { db, dbPath } = createV1('rollback.db');
  assert.throws(() => migrateRecurringBillsV2(db, {
    dbPath,
    beforeCommit: () => { throw new Error('simulated v2 failure'); },
  }), /simulated v2 failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  assert.strictEqual(db.prepare('SELECT paid, amount_paid FROM bill_months WHERE id = 91').get().amount_paid, 875);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='recurring_series'").get().count, 0);
  assert.ok(!db.prepare('PRAGMA table_info(bills)').all().some(column => column.name === 'recurring_series_id'));
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
