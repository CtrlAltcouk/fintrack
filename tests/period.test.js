// tests/period.test.js
const assert = require('assert');
const { computePeriods } = require('../public/period-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// ── Monthly ────────────────────────────────────────────────────────────────
const mSched = { frequency: 'monthly', day_of_month: 25 };

test('monthly: period spans pay-day to day-before-next pay-day', () => {
  const [cur] = computePeriods(mSched, 1, '2026-06-10');
  assert.strictEqual(cur.from, '2026-05-25');
  assert.strictEqual(cur.to,   '2026-06-24');
});

test('monthly: new period starts on pay-day itself', () => {
  const [cur] = computePeriods(mSched, 1, '2026-06-25');
  assert.strictEqual(cur.from, '2026-06-25');
  assert.strictEqual(cur.to,   '2026-07-24');
});

test('monthly: clamps dom=31 in February', () => {
  const s = { frequency: 'monthly', day_of_month: 31 };
  const [cur] = computePeriods(s, 1, '2026-02-10');
  assert.strictEqual(cur.from, '2026-01-31');
  assert.strictEqual(cur.to,   '2026-02-27');
});

test('monthly: dom=31 on clamped pay day (Apr 30) starts new period, not previous', () => {
  const s = { frequency: 'monthly', day_of_month: 31 };
  const [cur] = computePeriods(s, 1, '2026-04-30');
  assert.strictEqual(cur.from, '2026-04-30');
  assert.strictEqual(cur.to,   '2026-05-30');
});

test('monthly: dom=31 day before clamped pay day (Apr 29) is in previous period', () => {
  const s = { frequency: 'monthly', day_of_month: 31 };
  const [cur] = computePeriods(s, 1, '2026-04-29');
  assert.strictEqual(cur.from, '2026-03-31');
  assert.strictEqual(cur.to,   '2026-04-29');
});

test('monthly: dom=1 period ends on last day of same month', () => {
  const s = { frequency: 'monthly', day_of_month: 1 };
  const [cur] = computePeriods(s, 1, '2026-06-10');
  assert.strictEqual(cur.from, '2026-06-01');
  assert.strictEqual(cur.to,   '2026-06-30');
});

test('monthly: returns 6 periods newest first', () => {
  const ps = computePeriods(mSched, 6, '2026-06-10');
  assert.strictEqual(ps.length, 6);
  assert.strictEqual(ps[0].from, '2026-05-25');
  assert.strictEqual(ps[5].from, '2025-12-25');
});

test('monthly: label formatted correctly', () => {
  const [cur] = computePeriods(mSched, 1, '2026-06-10');
  assert.strictEqual(cur.label, '25 May – 24 Jun');
});

test('monthly: future series start does not hide the current calendar cycle', () => {
  const s = { frequency: 'monthly', day_of_month: 25, start_date: '2026-09-25' };
  const [cur] = computePeriods(s, 1, '2026-08-16');
  assert.deepStrictEqual({ from: cur.from, to: cur.to }, {
    from: '2026-07-25', to: '2026-08-24',
  });
});

// ── Four-weekly ────────────────────────────────────────────────────────────
const fwSched = { frequency: 'four_weekly', anchor_date: '2026-05-02' };

test('four_weekly: finds current 28-day period', () => {
  const [cur] = computePeriods(fwSched, 1, '2026-06-10');
  assert.strictEqual(cur.from, '2026-05-30');
  assert.strictEqual(cur.to,   '2026-06-26');
});

test('four_weekly: period starts today when today is a step date', () => {
  const [cur] = computePeriods(fwSched, 1, '2026-05-30');
  assert.strictEqual(cur.from, '2026-05-30');
  assert.strictEqual(cur.to,   '2026-06-26');
});

test('four_weekly: period starts on anchor when today equals anchor', () => {
  const [cur] = computePeriods(fwSched, 1, '2026-05-02');
  assert.strictEqual(cur.from, '2026-05-02');
  assert.strictEqual(cur.to,   '2026-05-29');
});

test('four_weekly: future anchor steps backwards to the period containing today', () => {
  const s = { frequency: 'four_weekly', anchor_date: '2026-09-12' };
  const [cur] = computePeriods(s, 1, '2026-08-16');
  assert.strictEqual(cur.from, '2026-08-15');
  assert.strictEqual(cur.to, '2026-09-11');
  assert.ok(cur.from <= '2026-08-16' && cur.to >= '2026-08-16');
});

// ── Weekly ─────────────────────────────────────────────────────────────────
const wSched = { frequency: 'weekly', anchor_date: '2026-05-12' }; // Tuesday

test('weekly: finds most recent anchor weekday', () => {
  const [cur] = computePeriods(wSched, 1, '2026-06-10'); // Wednesday
  assert.strictEqual(cur.from, '2026-06-09'); // Tuesday
  assert.strictEqual(cur.to,   '2026-06-15');
});

test('weekly: period starts today when today is anchor weekday', () => {
  const [cur] = computePeriods(wSched, 1, '2026-06-09'); // Tuesday
  assert.strictEqual(cur.from, '2026-06-09');
  assert.strictEqual(cur.to,   '2026-06-15');
});

test('weekly: returns 6 periods newest first with correct dates', () => {
  const ps = computePeriods(wSched, 6, '2026-06-10');
  assert.strictEqual(ps.length, 6);
  assert.strictEqual(ps[0].from, '2026-06-09'); // most recent Tuesday
  assert.strictEqual(ps[5].from, '2026-05-05'); // 5 weeks back
  assert.ok(ps[0].from > ps[5].from);
});

test('weekly: future anchor steps backwards on the same cycle', () => {
  const s = { frequency: 'weekly', anchor_date: '2026-09-12' };
  const [cur] = computePeriods(s, 1, '2026-08-16');
  assert.deepStrictEqual({ from: cur.from, to: cur.to }, {
    from: '2026-08-15', to: '2026-08-21',
  });
});

test('fortnightly: future anchor steps backwards on the same cycle', () => {
  const s = { frequency: 'fortnightly', anchor_date: '2026-09-12' };
  const [cur] = computePeriods(s, 1, '2026-08-16');
  assert.deepStrictEqual({ from: cur.from, to: cur.to }, {
    from: '2026-08-15', to: '2026-08-28',
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
