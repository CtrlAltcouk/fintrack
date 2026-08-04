const assert = require('assert');
const {
  recurrenceInputForSchedule, validateIncomeRecurrence,
} = require('../lib/recurrence/income-service');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

test('legacy monthly schedule fields map to the shared recurrence shape', () => {
  const result = validateIncomeRecurrence({ frequency: 'monthly', day_of_month: 31 });
  assert.ok(result.value);
  assert.strictEqual(result.value.frequency_unit, 'month');
  assert.strictEqual(result.value.frequency_interval, 1);
  assert.strictEqual(result.value.anchor_day, 31);
});

test('non-monthly legacy anchor dates remain valid', () => {
  const result = validateIncomeRecurrence({ frequency: 'four_weekly', anchor_date: '2026-07-03' });
  assert.strictEqual(result.value.start_date, '2026-07-03');
  assert.strictEqual(result.value.frequency_unit, 'week');
  assert.strictEqual(result.value.frequency_interval, 4);
});

test('end settings are preserved when an existing schedule is edited', () => {
  const input = recurrenceInputForSchedule({
    frequency: 'fortnightly', anchor_date: '2027-01-01',
  }, {
    anchor_day: 15, start_date: '2026-01-15', time_zone: 'UTC',
    end_mode: 'count', end_date: null, max_occurrences: 12,
  });
  assert.strictEqual(input.frequency, 'fortnightly');
  assert.strictEqual(input.start_date, '2027-01-01');
  assert.strictEqual(input.end_mode, 'count');
  assert.strictEqual(input.max_occurrences, 12);
});

test('invalid end dates and missing non-monthly anchors are rejected', () => {
  assert.ok(validateIncomeRecurrence({ frequency: 'weekly' }).error);
  assert.ok(validateIncomeRecurrence({
    frequency: 'daily', anchor_date: '2026-01-02',
    recurrence: { frequency: 'daily', start_date: '2026-01-02', end_mode: 'date', end_date: '2026-01-01' },
  }).error);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
