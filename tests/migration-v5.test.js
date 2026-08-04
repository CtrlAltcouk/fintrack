const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateRecurringTransactionsV5 } = require('../db-migrations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-migration-v5-'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed++; }
}

function createV4(name, populated = false) {
  const dbPath = path.join(root, name);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount REAL NOT NULL,
      description TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id),
      date TEXT NOT NULL, account_id INTEGER REFERENCES accounts(id)
    );
    CREATE TABLE recurring_series (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL,
      status TEXT NOT NULL, start_date TEXT NOT NULL
    );
    CREATE TABLE recurring_occurrences (
      id INTEGER PRIMARY KEY, series_id INTEGER NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL, sequence INTEGER NOT NULL, series_revision INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, 'v1'), (2, 'v2'), (3, 'v3'), (4, 'v4');
    ${populated ? `
      INSERT INTO users VALUES (1);
      INSERT INTO categories VALUES (2, 1);
      INSERT INTO accounts VALUES (3, 1);
      INSERT INTO transactions VALUES (7, 1, 12.5, 'Preserved', 2, '2026-07-01', 3);
    ` : ''}
    PRAGMA user_version = 4;
  `);
  return { db, dbPath };
}

test('fresh Version 4 schema gains recurring transaction structures', () => {
  const { db, dbPath } = createV4('fresh.db');
  const result = migrateRecurringTransactionsV5(db, { dbPath });
  assert.deepStrictEqual(result, { migrated: true, backupPath: null, transactions: 0 });
  assert.strictEqual(db.pragma('user_version', { simple: true }), 5);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recurring_transaction_templates'").get());
  assert.ok(db.prepare('PRAGMA table_info(transactions)').all().some(row => row.name === 'recurring_occurrence_id'));
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

test('populated upgrade preserves transactions and creates a non-overwriting backup', () => {
  const { db, dbPath } = createV4('populated.db', true);
  const sentinel = `${dbPath}.pre-recurring-transactions-v5.backup`;
  fs.writeFileSync(sentinel, 'existing');
  const result = migrateRecurringTransactionsV5(db, { dbPath });
  assert.notStrictEqual(result.backupPath, sentinel);
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'existing');
  assert.ok(fs.statSync(result.backupPath).size > 0);
  assert.deepStrictEqual(db.prepare('SELECT id, amount, description FROM transactions').get(), {
    id: 7, amount: 12.5, description: 'Preserved',
  });
  assert.deepStrictEqual(migrateRecurringTransactionsV5(db, { dbPath }), {
    migrated: false, backupPath: null, transactions: 0,
  });
  db.close();
});

test('injected failure rolls back schema, triggers, data, and version', () => {
  const { db, dbPath } = createV4('rollback.db', true);
  assert.throws(() => migrateRecurringTransactionsV5(db, {
    dbPath, beforeCommit: () => { throw new Error('simulated v5 failure'); },
  }), /simulated v5 failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 4);
  assert.ok(!db.prepare('PRAGMA table_info(transactions)').all().some(row => row.name === 'recurring_occurrence_id'));
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recurring_transaction_templates'").get());
  assert.strictEqual(db.prepare('SELECT description FROM transactions WHERE id = 7').get().description, 'Preserved');
  db.close();
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
