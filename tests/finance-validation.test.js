const assert = require('assert');
const {
  FinanceValidationError, MONEY_MAX_ABS, parseIntegerId, parseIsoDate, parseMoney,
  parseOptionalPositiveInteger, parsePositiveInteger, parsePositiveMoney, validateDateRange,
} = require('../lib/finance-validation');

let passed = 0;
function test(name, fn) {
  fn();
  console.log(`  \u2713 ${name}`);
  passed += 1;
}
function rejects(fn, pattern) {
  assert.throws(fn, error => error instanceof FinanceValidationError && pattern.test(error.message));
}

test('money accepts JSON numbers and plain decimal strings without changing precision', () => {
  assert.strictEqual(parseMoney(12.345), 12.345);
  assert.strictEqual(parseMoney('0.25'), 0.25);
  assert.strictEqual(parsePositiveMoney('.5'), 0.5);
});

test('money rejects partial, decorated, blank, compound, and non-primitive values', () => {
  for (const value of ['12junk', '1.2.3', 'Â£10', '10 GBP', '', ' ', ' 10', '10 ']) {
    rejects(() => parseMoney(value), /valid number/);
  }
  for (const value of [NaN, Infinity, -Infinity, [], {}, true, false, null, undefined]) {
    rejects(() => parseMoney(value), /(valid|finite) number/);
  }
});

test('positive money rejects zero and negative values and enforces the documented bound', () => {
  rejects(() => parsePositiveMoney(0), /greater than zero/);
  rejects(() => parsePositiveMoney(-1), /greater than zero/);
  assert.strictEqual(parseMoney(MONEY_MAX_ABS), MONEY_MAX_ABS);
  assert.strictEqual(parseMoney(-MONEY_MAX_ABS), -MONEY_MAX_ABS);
  rejects(() => parseMoney(MONEY_MAX_ABS + 1), /must be between/);
});

test('negative zero is normalized and negative opening-balance values remain supported', () => {
  assert.strictEqual(Object.is(parseMoney(-0), -0), false);
  assert.strictEqual(parseMoney('-250.75'), -250.75);
});

test('identifiers and bounded recurrence integers reject unsafe or invalid values', () => {
  assert.strictEqual(parseIntegerId('42'), 42);
  assert.strictEqual(parsePositiveInteger(10_000), 10_000);
  assert.strictEqual(parseOptionalPositiveInteger(null), null);
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, true, {}, '12junk']) {
    rejects(() => parseIntegerId(value), /(integer|number|least)/);
  }
  rejects(() => parsePositiveInteger(10_001), /at most 10000/);
});

test('ISO dates are real date-only calendar values and ranges are ordered', () => {
  assert.strictEqual(parseIsoDate('2028-02-29'), '2028-02-29');
  for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00',
    '2026-1-01', '2026-01-01T00:00:00Z', 20260101, null]) {
    rejects(() => parseIsoDate(value), /valid date/);
  }
  assert.deepStrictEqual(validateDateRange('2026-01-01', '2026-01-01'), {
    start: '2026-01-01', end: '2026-01-01',
  });
  rejects(() => validateDateRange('2026-02-01', '2026-01-31'), /on or after/);
});

console.log(`\n${passed} passed, 0 failed`);
