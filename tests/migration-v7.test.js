const assert = require('assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  assertSupportedSchemaVersion, migrateSessionSecurityV7,
} = require('../db-migrations');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

function version6Database() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      colour TEXT NOT NULL DEFAULT '#4a9eff',
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      avatar TEXT
    );
    INSERT INTO users
      (id, display_name, password_hash, colour, is_admin, session_token, avatar)
    VALUES (7, 'Legacy User', 'preserved-password-hash', '#123456', 1, 'legacy-bearer', 'avatar-data');
    PRAGMA user_version = 6;
  `);
  return database;
}

test('Version 6 upgrades transactionally while preserving users and invalidating plaintext sessions', () => {
  const database = version6Database();
  const result = migrateSessionSecurityV7(database);
  assert.deepStrictEqual(result, { migrated: true });
  assert.strictEqual(database.pragma('user_version', { simple: true }), 7);
  const user = database.prepare('SELECT * FROM users WHERE id = 7').get();
  assert.strictEqual(user.display_name, 'Legacy User');
  assert.strictEqual(user.password_hash, 'preserved-password-hash');
  assert.strictEqual(user.avatar, 'avatar-data');
  assert.strictEqual(user.session_token, null);
  assert.strictEqual(user.session_token_hash, null);
  assert.strictEqual(user.session_created_at, null);
  assert.strictEqual(user.session_expires_at, null);
  assert.ok(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_session_token_hash'`).get());
  database.close();
});

test('Version 7 migration is idempotent', () => {
  const database = version6Database();
  migrateSessionSecurityV7(database);
  assert.deepStrictEqual(migrateSessionSecurityV7(database), { migrated: false });
  assert.strictEqual(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 7").get().count, 1);
  database.close();
});

test('injected migration failure rolls back schema, version, and legacy user data', () => {
  const database = version6Database();
  assert.throws(() => migrateSessionSecurityV7(database, {
    beforeCommit() { throw new Error('simulated migration failure'); },
  }), /simulated migration failure/);
  assert.strictEqual(database.pragma('user_version', { simple: true }), 6);
  const columns = database.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  assert.strictEqual(columns.includes('session_token_hash'), false);
  assert.strictEqual(database.prepare('SELECT session_token FROM users WHERE id = 7').get().session_token, 'legacy-bearer');
  database.close();
});

test('unsupported future schemas are rejected before mutation', () => {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES (\'untouched\'); PRAGMA user_version = 10;');
  assert.throws(() => assertSupportedSchemaVersion(database), /newer than this Outflow version supports/);
  assert.strictEqual(database.prepare('SELECT value FROM sentinel').get().value, 'untouched');
  database.close();
});

test('invalid session configuration fails startup before creating a database', () => {
  const databasePath = `${process.env.FINTRACK_DB_PATH}.invalid-session-config`;
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      FINTRACK_DB_PATH: databasePath,
      OUTFLOW_SESSION_TTL_HOURS: '0',
      PORT: '0',
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /OUTFLOW_SESSION_TTL_HOURS/);
  assert.strictEqual(fs.existsSync(databasePath), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
