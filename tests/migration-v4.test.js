const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateRecurrenceRunnerV4 } = require('../db-migrations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outflow-migration-v4-'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

function createV3(name, populated = false) {
  const dbPath = path.join(root, name);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    ${populated ? 'INSERT INTO users VALUES (1);' : ''}
    CREATE TABLE recurring_series (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL,
      status TEXT NOT NULL, start_date TEXT NOT NULL
    );
    CREATE TABLE recurring_occurrences (
      id INTEGER PRIMARY KEY, series_id INTEGER NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE,
      scheduled_date TEXT NOT NULL, sequence INTEGER NOT NULL, series_revision INTEGER NOT NULL,
      status TEXT NOT NULL, skip_reason TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT, next_retry_at TEXT, failure_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ${populated ? `
      INSERT INTO recurring_series VALUES (4, 1, 'bill', 'active', '2026-01-01');
      INSERT INTO recurring_occurrences(id, series_id, scheduled_date, sequence, series_revision, status)
        VALUES (9, 4, '2026-01-01', 1, 1, 'generated');
    ` : ''}
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, 'v1'), (2, 'v2'), (3, 'v3');
    PRAGMA user_version = 3;
  `);
  return { db, dbPath };
}

test('fresh Version 3 schema gains runner metadata without a backup', () => {
  const { db } = createV3('fresh.db');
  const result = migrateRecurrenceRunnerV4(db);
  assert.deepStrictEqual(result, { migrated: true, backupPath: null });
  assert.strictEqual(db.pragma('user_version', { simple: true }), 4);
  assert.strictEqual(db.prepare('SELECT active FROM recurrence_runner_state WHERE id = 1').get().active, 0);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

test('populated Version 3 data is untouched and repeated migration is idempotent', () => {
  const { db, dbPath } = createV3('populated.db', true);
  const sentinel = `${dbPath}.pre-recurrence-runner-v4.backup`;
  fs.writeFileSync(sentinel, 'existing');
  migrateRecurrenceRunnerV4(db);
  assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = 9').get().status, 'generated');
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'existing');
  assert.deepStrictEqual(migrateRecurrenceRunnerV4(db), { migrated: false, backupPath: null });
  db.close();
});

test('injected failure rolls back runner tables and schema version', () => {
  const { db } = createV3('rollback.db', true);
  assert.throws(() => migrateRecurrenceRunnerV4(db, {
    beforeCommit: () => { throw new Error('simulated v4 failure'); },
  }), /simulated v4 failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 3);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='recurring_execution_claims'").get().count, 0);
  assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = 9').get().status, 'generated');
  db.close();
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
