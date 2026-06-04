// tests/calendar-pp.test.js
const assert = require('assert');
const { calGridBounds } = require('../public/calendar-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// ── Grid bounds ───────────────────────────────────────────────────────────
// 2026-05-15 = Friday (day 5). Sunday before = 2026-05-10.
// 2026-06-11 = Thursday (day 4). Saturday after = 2026-06-13.
test('cross-month period: startSunday is the Sunday on or before period.from', () => {
  const { startSunday } = calGridBounds('2026-05-15', '2026-06-11');
  assert.strictEqual(startSunday, '2026-05-10');
});

test('cross-month period: endSaturday is the Saturday on or after period.to', () => {
  const { endSaturday } = calGridBounds('2026-05-15', '2026-06-11');
  assert.strictEqual(endSaturday, '2026-06-13');
});

test('period starting on Sunday: startSunday equals period.from', () => {
  // 2026-05-10 = Sunday
  const { startSunday } = calGridBounds('2026-05-10', '2026-06-06');
  assert.strictEqual(startSunday, '2026-05-10');
});

test('period ending on Saturday: endSaturday equals period.to', () => {
  // 2026-06-06 = Saturday
  const { endSaturday } = calGridBounds('2026-05-10', '2026-06-06');
  assert.strictEqual(endSaturday, '2026-06-06');
});

test('exact 4-week period Sun→Sat: grid is exactly 28 days', () => {
  // 2026-05-10 Sun → 2026-06-06 Sat
  const { startSunday, endSaturday } = calGridBounds('2026-05-10', '2026-06-06');
  const start = new Date(startSunday + 'T00:00:00');
  const end   = new Date(endSaturday + 'T00:00:00');
  const days  = (end - start) / 86400000 + 1;
  assert.strictEqual(days, 28);
});

test('same-month period: bounds can fall outside that month', () => {
  // 2026-06-01 = Monday → startSunday = 2026-05-31
  // 2026-06-30 = Tuesday → endSaturday = 2026-07-04
  const { startSunday, endSaturday } = calGridBounds('2026-06-01', '2026-06-30');
  assert.strictEqual(startSunday, '2026-05-31');
  assert.strictEqual(endSaturday, '2026-07-04');
});

// ── Event filtering ───────────────────────────────────────────────────────
// Mirrors: results.flatMap(r => r.events).filter(ev => ev.date >= from && ev.date <= to)

test('event filter: excludes events outside period boundaries', () => {
  const from = '2026-05-15', to = '2026-06-11';
  const events = [
    { date: '2026-05-14', name: 'before' },
    { date: '2026-05-15', name: 'first' },
    { date: '2026-06-11', name: 'last' },
    { date: '2026-06-12', name: 'after' },
  ];
  const filtered = events.filter(ev => ev.date >= from && ev.date <= to);
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0].name, 'first');
  assert.strictEqual(filtered[1].name, 'last');
});

test('event filter: flatMap merges two months of events correctly', () => {
  const from = '2026-05-15', to = '2026-06-11';
  const results = [
    { events: [{ date: '2026-05-20', name: 'MayEv' }, { date: '2026-05-14', name: 'TooEarly' }] },
    { events: [{ date: '2026-06-05', name: 'JunEv' }, { date: '2026-06-12', name: 'TooLate' }] },
  ];
  const allEvents = results.flatMap(r => r.events).filter(ev => ev.date >= from && ev.date <= to);
  assert.strictEqual(allEvents.length, 2);
  assert.ok(allEvents.some(ev => ev.name === 'MayEv'));
  assert.ok(allEvents.some(ev => ev.name === 'JunEv'));
});

// ── safeIdx clamping ──────────────────────────────────────────────────────
// Mirrors: Math.min(Math.max(0, calPeriodIndex), periods.length - 1)

test('safeIdx: clamps negative index to 0', () => {
  const safeIdx = Math.min(Math.max(0, -1), 7);
  assert.strictEqual(safeIdx, 0);
});

test('safeIdx: clamps index beyond last period to last index', () => {
  const safeIdx = Math.min(Math.max(0, 10), 7);
  assert.strictEqual(safeIdx, 7);
});

test('safeIdx: leaves in-range index unchanged', () => {
  const safeIdx = Math.min(Math.max(0, 3), 7);
  assert.strictEqual(safeIdx, 3);
});

// ── Cross-month detection ─────────────────────────────────────────────────
// Mirrors: fromDate.getMonth() !== toDate.getMonth() || fromDate.getFullYear() !== toDate.getFullYear()

test('cross-month detection: same month → false', () => {
  const from = new Date('2026-06-01T00:00:00');
  const to   = new Date('2026-06-30T00:00:00');
  const isCross = from.getFullYear() !== to.getFullYear() || from.getMonth() !== to.getMonth();
  assert.strictEqual(isCross, false);
});

test('cross-month detection: adjacent months → true', () => {
  const from = new Date('2026-05-15T00:00:00');
  const to   = new Date('2026-06-11T00:00:00');
  const isCross = from.getFullYear() !== to.getFullYear() || from.getMonth() !== to.getMonth();
  assert.strictEqual(isCross, true);
});

test('cross-month detection: year boundary → true', () => {
  const from = new Date('2025-12-15T00:00:00');
  const to   = new Date('2026-01-11T00:00:00');
  const isCross = from.getFullYear() !== to.getFullYear() || from.getMonth() !== to.getMonth();
  assert.strictEqual(isCross, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
