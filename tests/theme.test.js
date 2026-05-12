// tests/theme.test.js
const assert = require('assert');
// _parseTheme will be exported in the next step
const { _parseTheme } = require('../routes/settings');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

test('returns dark defaults for invalid JSON', () => {
  const r = _parseTheme('not-json');
  assert.strictEqual(r.mode,   'dark');
  assert.strictEqual(r.accent, '#f7a4a2');
  assert.strictEqual(r.bg,     '#111111');
});

test('returns dark defaults when mode is missing', () => {
  const r = _parseTheme('{"accent":"#f7a4a2","bg":"#111111"}');
  assert.strictEqual(r.mode, 'dark');
});

test('returns dark defaults for invalid mode value', () => {
  const r = _parseTheme('{"mode":"purple","accent":"#f7a4a2","bg":"#111111"}');
  assert.strictEqual(r.mode, 'dark');
});

test('parses valid dark theme', () => {
  const r = _parseTheme('{"mode":"dark","accent":"#4a9eff","bg":"#0d1117"}');
  assert.strictEqual(r.mode,   'dark');
  assert.strictEqual(r.accent, '#4a9eff');
  assert.strictEqual(r.bg,     '#0d1117');
});

test('parses valid light theme', () => {
  const r = _parseTheme('{"mode":"light","accent":"#c45c5a","bg":"#f0e8f0"}');
  assert.strictEqual(r.mode,   'light');
  assert.strictEqual(r.accent, '#c45c5a');
  assert.strictEqual(r.bg,     '#f0e8f0');
});

test('falls back accent to dark default when hex invalid', () => {
  const r = _parseTheme('{"mode":"dark","accent":"red","bg":"#111111"}');
  assert.strictEqual(r.accent, '#f7a4a2');
});

test('falls back accent to light default when hex invalid', () => {
  const r = _parseTheme('{"mode":"light","accent":"bad","bg":"#f0e8f0"}');
  assert.strictEqual(r.accent, '#c45c5a');
});

test('falls back bg to dark default when hex invalid', () => {
  const r = _parseTheme('{"mode":"dark","accent":"#f7a4a2","bg":"black"}');
  assert.strictEqual(r.bg, '#111111');
});

test('falls back bg to light default when hex invalid', () => {
  const r = _parseTheme('{"mode":"light","accent":"#c45c5a","bg":"white"}');
  assert.strictEqual(r.bg, '#f0e8f0');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
