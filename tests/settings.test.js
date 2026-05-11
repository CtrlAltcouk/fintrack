// tests/settings.test.js
const assert = require('assert');
const { _migrate } = require('../routes/settings');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

function base(sizesOverride) {
  return {
    order: ['stats', 'accounts', 'bar_chart', 'donut_chart', 'calendar'],
    hidden: [],
    sizes: sizesOverride ?? { stats: 2, accounts: 2, bar_chart: 1, donut_chart: 1, calendar: 2 },
  };
}

// --- Migration: old number format ---

test('migrates numeric 2 to { w:4, h:1 }', () => {
  const { layout } = _migrate(base());
  assert.deepStrictEqual(layout.sizes.stats,    { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.accounts, { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.calendar, { w: 4, h: 1 });
});

test('migrates numeric 1 to { w:2, h:1 }', () => {
  const { layout } = _migrate(base());
  assert.deepStrictEqual(layout.sizes.bar_chart,   { w: 2, h: 1 });
  assert.deepStrictEqual(layout.sizes.donut_chart, { w: 2, h: 1 });
});

test('sets changed=true when numeric sizes are migrated', () => {
  const { changed } = _migrate(base());
  assert.strictEqual(changed, true);
});

// --- Passthrough: already { w, h } ---

test('passes through valid { w, h } unchanged', () => {
  const clean = {
    stats: { w: 4, h: 1 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 2, h: 1 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout, changed } = _migrate(base(clean));
  assert.deepStrictEqual(layout.sizes.stats,       { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.donut_chart, { w: 2, h: 1 });
  assert.strictEqual(changed, false);
});

test('passes through non-default { w, h } unchanged', () => {
  const custom = {
    stats: { w: 3, h: 2 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 1, h: 1 }, donut_chart: { w: 2, h: 3 }, calendar: { w: 4, h: 2 },
  };
  const { layout } = _migrate(base(custom));
  assert.deepStrictEqual(layout.sizes.stats,       { w: 3, h: 2 });
  assert.deepStrictEqual(layout.sizes.donut_chart, { w: 2, h: 3 });
});

// --- Invalid / missing sizes ---

test('fills missing size with default', () => {
  const { layout } = _migrate(base({}));
  assert.deepStrictEqual(layout.sizes.stats,    { w: 4, h: 1 });
  assert.deepStrictEqual(layout.sizes.bar_chart, { w: 2, h: 1 });
});

test('replaces { w:0, h:1 } with default', () => {
  const sizes = {
    stats: { w: 0, h: 1 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 2, h: 1 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout } = _migrate(base(sizes));
  assert.deepStrictEqual(layout.sizes.stats, { w: 4, h: 1 });
});

test('replaces { w:2, h:5 } with default', () => {
  const sizes = {
    stats: { w: 4, h: 1 }, accounts: { w: 4, h: 1 },
    bar_chart: { w: 2, h: 5 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout } = _migrate(base(sizes));
  assert.deepStrictEqual(layout.sizes.bar_chart, { w: 2, h: 1 });
});

test('replaces { w:5, h:2 } with default', () => {
  const sizes = {
    stats: { w: 4, h: 1 }, accounts: { w: 5, h: 2 },
    bar_chart: { w: 2, h: 1 }, donut_chart: { w: 2, h: 1 }, calendar: { w: 4, h: 1 },
  };
  const { layout } = _migrate(base(sizes));
  assert.deepStrictEqual(layout.sizes.accounts, { w: 4, h: 1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
