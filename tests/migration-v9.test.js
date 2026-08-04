const assert = require('assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { migrateLoginSecurityV9 } = require('../db-migrations');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

function version8() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now'))
  ); CREATE TABLE users (id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL);
  INSERT INTO users VALUES (7, 'Preserved User', 'preserved-hash');
  PRAGMA user_version = 8;`);
  return db;
}

test('Version 8 upgrades transactionally without rewriting users', () => {
  const db = version8();
  assert.deepStrictEqual(migrateLoginSecurityV9(db), { migrated: true });
  assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
  assert.deepStrictEqual(db.prepare('SELECT * FROM users').get(), {
    id: 7, display_name: 'Preserved User', password_hash: 'preserved-hash',
  });
  for (const table of ['login_rate_limits', 'login_attempt_claims']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  }
  assert.deepStrictEqual(migrateLoginSecurityV9(db), { migrated: false });
  db.close();
});

test('injected failure rolls back tables, migration record, and schema version', () => {
  const db = version8();
  assert.throws(() => migrateLoginSecurityV9(db, {
    beforeCommit() { throw new Error('injected login migration failure'); },
  }), /injected login migration failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 8);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'login_%'").get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9').get().count, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  db.close();
});

test('invalid limiter configuration fails startup before opening a database', () => {
  const databasePath = `${process.env.FINTRACK_DB_PATH}.invalid-login-config`;
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      FINTRACK_DB_PATH: databasePath,
      OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX: '0',
      PORT: '0',
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /OUTFLOW_LOGIN_ACCOUNT_SHORT_MAX/);
  assert.strictEqual(fs.existsSync(databasePath), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
