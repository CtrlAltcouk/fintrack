const assert = require('assert');
const { loadRuntimeConfig, parsePort } = require('../lib/runtime-config');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

test('runtime defaults to development on port 3000', () => {
  assert.deepStrictEqual(loadRuntimeConfig({}), {
    nodeEnv: 'development', production: false, port: 3000,
  });
});

test('production and test environments are explicit', () => {
  assert.deepStrictEqual(loadRuntimeConfig({ NODE_ENV: 'production', PORT: '443' }), {
    nodeEnv: 'production', production: true, port: 443,
  });
  assert.strictEqual(loadRuntimeConfig({ NODE_ENV: 'test', PORT: '0' }).port, 0);
});

test('invalid environment and port configuration fails before startup', () => {
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: 'prod' }), /NODE_ENV/);
  for (const value of ['abc', '-1', '65536', '3.5']) {
    assert.throws(() => parsePort(value, 'development'), /PORT/);
  }
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: 'production', PORT: '0' }), /PORT/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
