// tests/pay-period-settings.test.js
const assert = require('assert');
const { _parsePayPeriodBody } = require('../routes/settings');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('empty body is valid', () => {
  assert.strictEqual(_parsePayPeriodBody({}), null);
});

test('null body is valid', () => {
  assert.strictEqual(_parsePayPeriodBody(null), null);
});

test('mode monthly is valid', () => {
  assert.strictEqual(_parsePayPeriodBody({ mode: 'monthly' }), null);
});

test('mode pay_period is valid', () => {
  assert.strictEqual(_parsePayPeriodBody({ mode: 'pay_period' }), null);
});

test('invalid mode returns error', () => {
  assert.ok(_parsePayPeriodBody({ mode: 'weekly' }));
});

test('primary_schedule_id null is valid', () => {
  assert.strictEqual(_parsePayPeriodBody({ primary_schedule_id: null }), null);
});

test('primary_schedule_id positive integer is valid', () => {
  assert.strictEqual(_parsePayPeriodBody({ primary_schedule_id: 42 }), null);
});

test('primary_schedule_id zero is invalid', () => {
  assert.ok(_parsePayPeriodBody({ primary_schedule_id: 0 }));
});

test('primary_schedule_id negative is invalid', () => {
  assert.ok(_parsePayPeriodBody({ primary_schedule_id: -1 }));
});

test('primary_schedule_id string "abc" is invalid', () => {
  assert.ok(_parsePayPeriodBody({ primary_schedule_id: 'abc' }));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
