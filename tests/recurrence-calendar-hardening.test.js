const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  addDays, currentDateForSeries, dateInTimeZone, frequencyConfig, occurrenceAt, occurrencesBetween,
  parseDate, validateRecurrence,
} = require('../lib/recurrence/dates');
const { sqliteTimestampDateForSeries } = require('../lib/recurrence/service');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed++; }
}

function series(frequency, startDate, extra = {}) {
  const config = frequencyConfig(frequency);
  return {
    frequency_unit: config.unit,
    frequency_interval: config.interval,
    start_date: startDate,
    anchor_day: extra.anchor_day ?? Number(startDate.slice(8, 10)),
    anchor_month: extra.anchor_month ?? Number(startDate.slice(5, 7)),
    time_zone: extra.time_zone ?? 'Europe/London',
    end_mode: extra.end_mode ?? 'never',
    end_date: extra.end_date ?? null,
    max_occurrences: extra.max_occurrences ?? null,
  };
}

test('UK daylight-saving boundaries map instants to the correct local calendar date', () => {
  const london = instant => dateInTimeZone(new Date(instant), 'Europe/London');
  assert.strictEqual(london('2026-03-29T00:59:59Z'), '2026-03-29');
  assert.strictEqual(london('2026-03-29T01:00:00Z'), '2026-03-29');
  assert.strictEqual(london('2026-03-29T22:59:59Z'), '2026-03-29');
  assert.strictEqual(london('2026-03-29T23:00:00Z'), '2026-03-30');
  assert.strictEqual(london('2026-10-25T00:30:00Z'), '2026-10-25');
  assert.strictEqual(london('2026-10-25T01:30:00Z'), '2026-10-25');
  assert.strictEqual(london('2026-10-25T23:59:59Z'), '2026-10-25');
  assert.strictEqual(london('2026-10-26T00:00:00Z'), '2026-10-26');
});

test('daily, fortnightly, and four-week schedules cross both DST changes without shifting', () => {
  assert.deepStrictEqual(
    occurrencesBetween(series('daily', '2026-03-28'), '2026-03-28', '2026-03-31')
      .map(row => row.date),
    ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']
  );
  assert.deepStrictEqual(
    occurrencesBetween(series('fortnightly', '2026-03-15'), '2026-03-01', '2026-04-30')
      .map(row => row.date),
    ['2026-03-15', '2026-03-29', '2026-04-12', '2026-04-26']
  );
  assert.deepStrictEqual(
    occurrencesBetween(series('four_weekly', '2026-09-27'), '2026-09-01', '2026-12-31')
      .map(row => row.date),
    ['2026-09-27', '2026-10-25', '2026-11-22', '2026-12-20']
  );
});

test('month-end, quarterly, yearly, leap-year, and century rules retain anchors', () => {
  const monthly = series('monthly', '2027-01-31', { anchor_day: 31 });
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(sequence => occurrenceAt(monthly, sequence)),
    ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  const quarterly = series('quarterly', '2027-11-30', { anchor_day: 30 });
  assert.deepStrictEqual([1, 2, 3, 4].map(sequence => occurrenceAt(quarterly, sequence)),
    ['2027-11-30', '2028-02-29', '2028-05-30', '2028-08-30']);
  const leap = series('yearly', '2024-02-29', { anchor_day: 29, anchor_month: 2 });
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(sequence => occurrenceAt(leap, sequence)),
    ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  const century = series('yearly', '2096-02-29', { anchor_day: 29, anchor_month: 2 });
  assert.strictEqual(occurrenceAt(century, 5), '2100-02-28');
  assert.ok(parseDate('2000-02-29'));
  assert.strictEqual(parseDate('2100-02-29'), null);
});

test('end-date and occurrence-count boundaries remain inclusive for every frequency', () => {
  for (const frequency of Object.keys(require('../lib/recurrence/dates').FREQUENCIES)) {
    const base = series(frequency, '2024-02-29', { end_mode: 'count', max_occurrences: 3 });
    assert.strictEqual(occurrencesBetween(base, '2024-01-01', '2035-12-31').length, 3);
    const second = occurrenceAt(base, 2);
    const ended = { ...base, end_mode: 'date', end_date: second, max_occurrences: null };
    assert.deepStrictEqual(
      occurrencesBetween(ended, '2024-01-01', '2035-12-31').map(row => row.date),
      [occurrenceAt(base, 1), second]
    );
  }
});

test('stored IANA timezone metadata is validated and extreme zones resolve correctly', () => {
  for (const time_zone of ['UTC', 'Europe/London', 'America/New_York', 'Pacific/Kiritimati']) {
    const result = validateRecurrence({
      frequency: 'monthly', start_date: '2026-03-31', time_zone,
    });
    assert.strictEqual(result.value.time_zone, time_zone);
  }
  assert.ok(validateRecurrence({
    frequency: 'daily', start_date: '2026-01-01', time_zone: 'Not/A_Zone',
  }).error);
  const instant = new Date('2026-08-02T10:00:00Z');
  assert.strictEqual(dateInTimeZone(instant, 'Pacific/Kiritimati'), '2026-08-03');
  assert.strictEqual(dateInTimeZone(instant, 'America/Los_Angeles'), '2026-08-02');
  assert.strictEqual(currentDateForSeries({ time_zone: 'Pacific/Kiritimati' }, instant), '2026-08-03');
  assert.strictEqual(currentDateForSeries({ time_zone: 'America/Los_Angeles' }, instant), '2026-08-02');
  assert.strictEqual(sqliteTimestampDateForSeries(
    '2026-03-29 23:30:00', { time_zone: 'Europe/London' }
  ), '2026-03-30');
});

test('date-only calculations and browser date formatting are stable across host timezones', () => {
  const datesPath = path.resolve(__dirname, '../lib/recurrence/dates.js');
  const formatPath = path.resolve(__dirname, '../public/src/utils/format.js');
  const script = `
    const fs = require('fs');
    const vm = require('vm');
    const dates = require(${JSON.stringify(datesPath)});
    const shape = { frequency_unit: 'month', frequency_interval: 1,
      start_date: '2026-01-31', anchor_day: 31, anchor_month: 1,
      end_mode: 'never', end_date: null, max_occurrences: null };
    let source = fs.readFileSync(${JSON.stringify(formatPath)}, 'utf8').replace(/^export /gm, '');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(source + '; globalThis.client = {' +
      'input: toDateInput(new Date(2026, 2, 29, 0, 30, 0)),' +
      'label: formatDate("2026-03-29")};', sandbox);
    process.stdout.write(JSON.stringify({
      add: dates.addDays('2026-03-28', 3),
      occurrences: [1, 2, 3, 4].map(n => dates.occurrenceAt(shape, n)),
      client: sandbox.client,
    }));
  `;
  const outputs = ['UTC', 'Europe/London', 'America/Los_Angeles', 'Pacific/Kiritimati']
    .map(TZ => {
      const child = spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ }, encoding: 'utf8',
      });
      assert.strictEqual(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    });
  for (const output of outputs.slice(1)) assert.deepStrictEqual(output, outputs[0]);
  assert.deepStrictEqual(outputs[0], {
    add: '2026-03-31',
    occurrences: ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
    client: { input: '2026-03-29', label: 'Sun 29 Mar' },
  });
  assert.strictEqual(addDays('2026-10-24', 2), '2026-10-26');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
