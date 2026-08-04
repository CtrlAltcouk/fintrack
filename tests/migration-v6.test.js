const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateRecurringTransfersV6 } = require('../db-migrations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-migration-v6-'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

function createV5(name, populated = false) {
  const dbPath = path.join(root, name);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE transfers (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
      from_account_id INTEGER NOT NULL REFERENCES accounts(id),
      to_account_id INTEGER NOT NULL REFERENCES accounts(id), amount REAL NOT NULL,
      date TEXT NOT NULL, note TEXT
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
    INSERT INTO schema_migrations VALUES (1, 'v1'), (2, 'v2'), (3, 'v3'), (4, 'v4'), (5, 'v5');
    ${populated ? `
      INSERT INTO users VALUES (1);
      INSERT INTO accounts VALUES (2, 1, 1), (3, 1, 1);
      INSERT INTO transfers VALUES (9, 1, 2, 3, 45.5, '2026-08-01', 'Preserved');
    ` : ''}
    PRAGMA user_version = 5;
  `);
  return { db, dbPath };
}

test('fresh Version 5 schema gains recurring transfer structures', () => {
  const { db, dbPath } = createV5('fresh.db');
  const result = migrateRecurringTransfersV6(db, { dbPath });
  assert.deepStrictEqual(result, { migrated: true, backupPath: null, transfers: 0 });
  assert.strictEqual(db.pragma('user_version', { simple: true }), 6);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recurring_transfer_templates'").get());
  assert.ok(db.prepare('PRAGMA table_info(transfers)').all().some(row => row.name === 'recurring_occurrence_id'));
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

test('populated upgrade preserves transfers and creates a non-overwriting backup', () => {
  const { db, dbPath } = createV5('populated.db', true);
  const sentinel = `${dbPath}.pre-recurring-transfers-v6.backup`;
  fs.writeFileSync(sentinel, 'existing');
  const result = migrateRecurringTransfersV6(db, { dbPath });
  assert.notStrictEqual(result.backupPath, sentinel);
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'existing');
  assert.ok(fs.statSync(result.backupPath).size > 0);
  assert.deepStrictEqual(db.prepare('SELECT id, amount, note FROM transfers').get(), {
    id: 9, amount: 45.5, note: 'Preserved',
  });
  assert.deepStrictEqual(migrateRecurringTransfersV6(db, { dbPath }), {
    migrated: false, backupPath: null, transfers: 0,
  });
  db.close();
});

test('injected failure rolls back schema, triggers, data, and version', () => {
  const { db, dbPath } = createV5('rollback.db', true);
  assert.throws(() => migrateRecurringTransfersV6(db, {
    dbPath, beforeCommit: () => { throw new Error('simulated v6 failure'); },
  }), /simulated v6 failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 5);
  assert.ok(!db.prepare('PRAGMA table_info(transfers)').all().some(row => row.name === 'recurring_occurrence_id'));
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recurring_transfer_templates'").get());
  assert.strictEqual(db.prepare('SELECT note FROM transfers WHERE id = 9').get().note, 'Preserved');
  db.close();
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
