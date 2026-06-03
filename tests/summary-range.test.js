// tests/summary-range.test.js
const assert = require('assert');
const { _parseDateRange } = require('../routes/summary-range');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('returns null for valid range', () => {
  assert.strictEqual(_parseDateRange('2026-01-01', '2026-01-31'), null);
});

test('returns null when from equals to', () => {
  assert.strictEqual(_parseDateRange('2026-06-01', '2026-06-01'), null);
});

test('error when from missing', () => {
  assert.ok(_parseDateRange(undefined, '2026-06-30'));
});

test('error when to missing', () => {
  assert.ok(_parseDateRange('2026-06-01', undefined));
});

test('error when from has wrong format', () => {
  assert.ok(_parseDateRange('01-06-2026', '2026-06-30'));
});

test('error when to has wrong format', () => {
  assert.ok(_parseDateRange('2026-06-01', '30/06/2026'));
});

test('error when from is after to', () => {
  assert.ok(_parseDateRange('2026-06-30', '2026-06-01'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
