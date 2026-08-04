const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateRecurringIncomeV3 } = require('../db-migrations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-migration-v3-'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

function createV2(name) {
  const dbPath = path.join(root, name);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL);
    INSERT INTO users VALUES (1, 'Owner', 'hash');
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT);
    INSERT INTO accounts VALUES (2, 1, 'Current');
    CREATE TABLE recurring_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL,
      frequency_unit TEXT NOT NULL, frequency_interval INTEGER NOT NULL, start_date TEXT NOT NULL,
      anchor_day INTEGER, anchor_month INTEGER, time_zone TEXT NOT NULL DEFAULT 'UTC',
      end_mode TEXT NOT NULL DEFAULT 'never', end_date TEXT, max_occurrences INTEGER,
      status TEXT NOT NULL DEFAULT 'active', next_due_date TEXT, next_sequence INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1, paused_at TEXT, deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE recurring_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, series_id INTEGER NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL, sequence INTEGER NOT NULL, series_revision INTEGER NOT NULL,
      status TEXT NOT NULL, skip_reason TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT, next_retry_at TEXT, failure_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(series_id, scheduled_date), UNIQUE(series_id, sequence)
    );
    CREATE TABLE income_schedules (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL,
      frequency TEXT NOT NULL CHECK(frequency IN ('weekly','four_weekly','monthly')),
      day_of_month INTEGER, anchor_date TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, account_id INTEGER REFERENCES accounts(id), user_id INTEGER REFERENCES users(id)
    );
    INSERT INTO income_schedules VALUES
      (31, 'Salary', 2500, 'monthly', 31, NULL, 1, '2025-01-01 00:00:00', 2, 1),
      (32, 'Allowance', 50, 'weekly', NULL, '2025-01-03', 0, '2025-01-01 00:00:00', 2, 1);
    CREATE TABLE income (
      id INTEGER PRIMARY KEY, amount REAL NOT NULL, description TEXT NOT NULL, date TEXT NOT NULL,
      created_at TEXT NOT NULL, account_id INTEGER REFERENCES accounts(id),
      source_schedule_id INTEGER REFERENCES income_schedules(id), user_id INTEGER REFERENCES users(id)
    );
    INSERT INTO income VALUES
      (71, 2500, 'Salary', '2025-01-31', '2025-01-01 00:00:00', 2, 31, 1),
      (72, 2500, 'Salary', '2025-02-28', '2025-01-01 00:00:00', 2, 31, 1),
      (73, 125, 'Manual', '2025-02-10', '2025-02-10 00:00:00', 2, NULL, 1),
      (74, 50, 'Allowance', '2025-01-03', '2025-01-01 00:00:00', 2, 32, 1);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')));
    INSERT INTO schema_migrations(version, name) VALUES (1, 'preserve-legacy-multi-user'), (2, 'recurring-bills-foundation');
    PRAGMA user_version = 2;
  `);
  return { db, dbPath };
}

test('migration preserves schedule and income IDs, projections, ownership, and foreign keys', () => {
  const { db, dbPath } = createV2('preserve.db');
  const result = migrateRecurringIncomeV3(db, { dbPath });
  assert.strictEqual(result.migrated, true);
  assert.ok(result.backupPath && fs.statSync(result.backupPath).size > 0);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 3);
  assert.deepStrictEqual(db.prepare('SELECT id FROM income ORDER BY id').all().map(row => row.id), [71, 72, 73, 74]);
  assert.deepStrictEqual(db.prepare('SELECT id FROM income_schedules ORDER BY id').all().map(row => row.id), [31, 32]);
  assert.strictEqual(db.prepare('SELECT amount FROM income WHERE id = 71').get().amount, 2500);
  assert.strictEqual(db.prepare('SELECT recurring_occurrence_id FROM income WHERE id = 73').get().recurring_occurrence_id, null);
  assert.ok(db.prepare('SELECT recurring_occurrence_id FROM income WHERE id = 71').get().recurring_occurrence_id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM recurring_series WHERE kind = 'income'").get().count, 2);
  assert.strictEqual(db.prepare("SELECT status FROM recurring_series s JOIN income_schedules i ON i.recurring_series_id=s.id WHERE i.id=32").get().status, 'deleted');
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

test('migration backups never overwrite an existing backup', () => {
  const { db, dbPath } = createV2('backup.db');
  fs.writeFileSync(`${dbPath}.pre-recurring-income-v3.backup`, 'existing');
  const result = migrateRecurringIncomeV3(db, { dbPath });
  assert.ok(result.backupPath.endsWith('.backup.1'));
  assert.strictEqual(fs.readFileSync(`${dbPath}.pre-recurring-income-v3.backup`, 'utf8'), 'existing');
  db.close();
});

test('injected failure rolls back tables, data, version, and recurrence links', () => {
  const { db, dbPath } = createV2('rollback.db');
  assert.throws(() => migrateRecurringIncomeV3(db, {
    dbPath, beforeCommit: () => { throw new Error('simulated v3 failure'); },
  }), /simulated v3 failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 2);
  assert.strictEqual(db.prepare('SELECT amount FROM income WHERE id = 71').get().amount, 2500);
  assert.ok(!db.prepare('PRAGMA table_info(income)').all().some(column => column.name === 'recurring_occurrence_id'));
  assert.ok(!db.prepare('PRAGMA table_info(income_schedules)').all().some(column => column.name === 'recurring_series_id'));
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM recurring_series WHERE kind = 'income'").get().count, 0);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
