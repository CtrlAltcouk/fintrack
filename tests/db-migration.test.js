// tests/db-migration.test.js
const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// Require db to trigger migration
const db = require('../db');

test('users table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  assert.ok(row, 'users table missing');
});

test('categories has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(categories)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from categories');
});

test('settings has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(settings)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from settings');
});

test('transactions has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(transactions)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from transactions');
});

test('accounts has user_id column', () => {
  const cols = db.prepare('PRAGMA table_info(accounts)').all();
  assert.ok(cols.find(c => c.name === 'user_id'), 'user_id missing from accounts');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
