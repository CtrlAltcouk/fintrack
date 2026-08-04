const assert = require('assert');
const {
  dateInTimeZone, frequencyConfig, nextOccurrence, occurrenceAt, occurrencesBetween,
  validateRecurrence,
} = require('../lib/recurrence/dates');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

function series(frequency, startDate, extra = {}) {
  const config = frequencyConfig(frequency);
  return {
    frequency_unit: config.unit,
    frequency_interval: config.interval,
    start_date: startDate,
    anchor_day: extra.anchor_day ?? Number(startDate.slice(8, 10)),
    anchor_month: extra.anchor_month ?? Number(startDate.slice(5, 7)),
    end_mode: extra.end_mode ?? 'never',
    end_date: extra.end_date ?? null,
    max_occurrences: extra.max_occurrences ?? null,
  };
}

test('daily, weekly, fortnightly, and four-weekly intervals are exact', () => {
  assert.deepStrictEqual(occurrencesBetween(series('daily', '2026-01-01'), '2026-01-01', '2026-01-03').map(o => o.date),
    ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.strictEqual(occurrenceAt(series('weekly', '2026-01-01'), 2), '2026-01-08');
  assert.strictEqual(occurrenceAt(series('fortnightly', '2026-01-01'), 2), '2026-01-15');
  assert.strictEqual(occurrenceAt(series('four_weekly', '2026-01-01'), 2), '2026-01-29');
});

test('monthly and quarterly schedules retain a day-31 anchor', () => {
  const monthly = series('monthly', '2026-01-31', { anchor_day: 31 });
  assert.strictEqual(occurrenceAt(monthly, 2), '2026-02-28');
  assert.strictEqual(occurrenceAt(monthly, 3), '2026-03-31');
  const quarterly = series('quarterly', '2026-01-31', { anchor_day: 31 });
  assert.strictEqual(occurrenceAt(quarterly, 2), '2026-04-30');
});

test('yearly leap-day schedules return to February 29', () => {
  const yearly = series('yearly', '2024-02-29', { anchor_day: 29, anchor_month: 2 });
  assert.strictEqual(occurrenceAt(yearly, 2), '2025-02-28');
  assert.strictEqual(occurrenceAt(yearly, 5), '2028-02-29');
});

test('date and occurrence-count endings are inclusive', () => {
  const byDate = series('daily', '2026-03-28', { end_mode: 'date', end_date: '2026-03-30' });
  assert.deepStrictEqual(occurrencesBetween(byDate, '2026-03-01', '2026-04-01').map(o => o.date),
    ['2026-03-28', '2026-03-29', '2026-03-30']);
  const byCount = series('weekly', '2026-01-01', { end_mode: 'count', max_occurrences: 2 });
  assert.strictEqual(occurrencesBetween(byCount, '2026-01-01', '2026-12-31').length, 2);
  assert.strictEqual(nextOccurrence(byCount, '2026-01-09'), null);
});

test('date-only schedules remain stable across UK DST boundaries', () => {
  const daily = series('daily', '2026-03-28');
  assert.deepStrictEqual(occurrencesBetween(daily, '2026-03-28', '2026-03-30').map(o => o.date),
    ['2026-03-28', '2026-03-29', '2026-03-30']);
  assert.deepStrictEqual(occurrencesBetween(series('daily', '2026-10-24'), '2026-10-24', '2026-10-26').map(o => o.date),
    ['2026-10-24', '2026-10-25', '2026-10-26']);
  assert.strictEqual(dateInTimeZone(new Date('2026-03-29T00:30:00Z'), 'Europe/London'), '2026-03-29');
  assert.strictEqual(dateInTimeZone(new Date('2026-03-29T23:30:00Z'), 'Europe/London'), '2026-03-30');
});

test('recurrence validation accepts every supported frequency and rejects invalid endings', () => {
  for (const frequency of ['daily','weekly','fortnightly','four_weekly','monthly','quarterly','yearly']) {
    assert.ok(validateRecurrence({ frequency, start_date: '2026-01-01' }).value);
  }
  assert.ok(validateRecurrence({ frequency: 'monthly', start_date: '2026-02-30' }).error);
  assert.ok(validateRecurrence({ frequency: 'monthly', start_date: '2026-01-01', end_mode: 'count', max_occurrences: 0 }).error);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
