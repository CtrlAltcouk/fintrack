const assert = require('assert');
const fs = require('fs');
const db = require('../db');
const {
  auditFinancialRows, migrateFinancialConstraintsV8,
} = require('../db-migrations');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}
function dropFinanceTriggers(database) {
  const names = database.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE '%_finance_%'`).all();
  for (const { name } of names) database.exec(`DROP TRIGGER ${name}`);
}
function downgrade() {
  dropFinanceTriggers(db);
  db.exec('DROP TABLE IF EXISTS login_attempt_claims; DROP TABLE IF EXISTS login_rate_limits;');
  db.prepare('DELETE FROM schema_migrations WHERE version = 9').run();
  db.prepare('DELETE FROM schema_migrations WHERE version = 8').run();
  db.pragma('user_version = 7');
}

test('fresh schema includes Version 8 constraints and the current Version 10 migration', () => {
  assert.strictEqual(db.pragma('user_version', { simple: true }), 10);
  assert.deepStrictEqual(migrateFinancialConstraintsV8(db), { migrated: false, backupPath: null });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='transactions_finance_insert'").get());
});

test('populated Version 7 upgrade preserves values and creates a non-overwriting backup', () => {
  const user = db.prepare(`INSERT INTO users (display_name, password_hash, colour, is_admin)
    VALUES ('Finance migration', 'hash', '#123456', 1)`).run().lastInsertRowid;
  const category = db.prepare(`INSERT INTO categories (user_id, name, colour)
    VALUES (?, 'Finance category', '#123456')`).run(user).lastInsertRowid;
  const account = db.prepare(`INSERT INTO accounts (user_id, name, type, opening_balance)
    VALUES (?, 'Finance account', 'current', -25.125)`).run(user).lastInsertRowid;
  db.prepare(`INSERT INTO transactions (user_id, amount, description, category_id, account_id, date)
    VALUES (?, 12.345, 'preserved', ?, ?, '2026-08-02')`).run(user, category, account);
  downgrade();
  const result = migrateFinancialConstraintsV8(db, { dbPath: process.env.FINTRACK_DB_PATH });
  assert.strictEqual(result.migrated, true);
  assert.ok(result.backupPath && fs.existsSync(result.backupPath));
  assert.strictEqual(db.prepare("SELECT amount FROM transactions WHERE description='preserved'").get().amount, 12.345);
  assert.strictEqual(db.prepare('SELECT opening_balance FROM accounts WHERE id=?').get(account).opening_balance, -25.125);
  assert.deepStrictEqual(auditFinancialRows(db), []);
});

test('database triggers reject invalid direct finance writes', () => {
  const row = db.prepare("SELECT user_id, category_id, account_id FROM transactions WHERE description='preserved'").get();
  assert.throws(() => db.prepare(`INSERT INTO transactions
    (user_id, amount, description, category_id, account_id, date) VALUES (?, 0, 'bad', ?, ?, '2026-08-02')`
  ).run(row.user_id, row.category_id, row.account_id), /invalid transaction finance data/);
  assert.throws(() => db.prepare("UPDATE accounts SET opening_balance = ? WHERE id = ?")
    .run(1_000_000_000_001, row.account_id), /invalid account opening balance/);
});

test('malformed legacy rows block migration with exact table and row and no mutation', () => {
  downgrade();
  const row = db.prepare("SELECT id FROM transactions WHERE description='preserved'").get();
  db.prepare('UPDATE transactions SET amount = -1, date = ? WHERE id = ?').run('2026-02-30', row.id);
  assert.throws(() => migrateFinancialConstraintsV8(db), error =>
    /transactions:\d+\(amount\)/.test(error.message) && /transactions:\d+\(date\)/.test(error.message));
  assert.strictEqual(db.pragma('user_version', { simple: true }), 7);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE '%_finance_%'").get().count, 0);
  db.prepare('UPDATE transactions SET amount = 12.345, date = ? WHERE id = ?').run('2026-08-02', row.id);
});

test('injected migration failure rolls back triggers, version, and migration record', () => {
  assert.throws(() => migrateFinancialConstraintsV8(db, {
    beforeCommit() { throw new Error('simulated v8 failure'); },
  }), /simulated v8 failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 7);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version=8").get().count, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE '%_finance_%'").get().count, 0);
  migrateFinancialConstraintsV8(db);
});

db.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
