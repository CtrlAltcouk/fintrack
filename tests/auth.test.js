// tests/auth.test.js
const assert = require('assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('bcrypt hash and compare work', () => {
  const hash = bcrypt.hashSync('secret', 10);
  assert.ok(bcrypt.compareSync('secret', hash));
  assert.ok(!bcrypt.compareSync('wrong', hash));
});

test('session token is 64 hex chars', () => {
  const token = crypto.randomBytes(32).toString('hex');
  assert.strictEqual(token.length, 64);
  assert.ok(/^[0-9a-f]+$/.test(token));
});

test('requireAuth returns 401 when no cookie', () => {
  const requireAuth = require('../middleware/auth');
  const req = { cookies: {} };
  let status = null, body = null;
  const res = { status: s => { status = s; return { json: b => { body = b; } }; } };
  const next = () => { throw new Error('next() should not be called'); };
  requireAuth(req, res, next);
  assert.strictEqual(status, 401);
  assert.strictEqual(body.error, 'unauthenticated');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
