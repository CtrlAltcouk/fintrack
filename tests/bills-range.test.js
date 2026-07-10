// tests/bills-range.test.js
const assert = require('assert');
const { monthsBetween, resolveDueDate } = require('../routes/bills');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('monthsBetween: range within a single month', () => {
  assert.deepStrictEqual(monthsBetween('2026-07-01', '2026-07-31'), [{ year: 2026, month: 7 }]);
});

test('monthsBetween: range spanning two months', () => {
  assert.deepStrictEqual(monthsBetween('2026-06-25', '2026-07-24'), [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
  ]);
});

test('monthsBetween: range spanning a year boundary', () => {
  assert.deepStrictEqual(monthsBetween('2026-12-15', '2027-01-14'), [
    { year: 2026, month: 12 },
    { year: 2027, month: 1 },
  ]);
});

test('resolveDueDate: mid-month day unaffected', () => {
  assert.strictEqual(resolveDueDate(15, 2026, 7), '2026-07-15');
});

test('resolveDueDate: clamps day 31 in a 30-day month', () => {
  assert.strictEqual(resolveDueDate(31, 2026, 4), '2026-04-30');
});

test('resolveDueDate: clamps day 30 in February (2026 is not a leap year)', () => {
  assert.strictEqual(resolveDueDate(30, 2026, 2), '2026-02-28');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
