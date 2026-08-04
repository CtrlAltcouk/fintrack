const assert = require('assert');
const { DEFAULTS, loadRunnerConfig } = require('../lib/recurrence/runner-config');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

test('defaults are explicit and production-safe', () => {
  assert.deepStrictEqual(loadRunnerConfig({}), DEFAULTS);
});

test('environment overrides are parsed and validated', () => {
  const config = loadRunnerConfig({
    RECURRENCE_RUNNER_ENABLED: 'false', RECURRENCE_RUNNER_INTERVAL_MS: '10',
    RECURRENCE_RUNNER_BATCH_SIZE: '3', RECURRENCE_RUNNER_REQUEST_THROTTLE_MS: '0',
    RECURRENCE_RUNNER_RETRY_BASE_MS: '5', RECURRENCE_RUNNER_RETRY_MAX_MS: '20',
    RECURRENCE_RUNNER_MAX_ATTEMPTS: '2',
  });
  assert.strictEqual(config.enabled, false);
  assert.strictEqual(config.intervalMs, 10);
  assert.strictEqual(config.batchSize, 3);
  assert.strictEqual(config.maxAttempts, 2);
});

test('invalid booleans, bounds, and retry ordering fail at startup', () => {
  assert.throws(() => loadRunnerConfig({ RECURRENCE_RUNNER_ENABLED: 'maybe' }), /must be true/);
  assert.throws(() => loadRunnerConfig({ RECURRENCE_RUNNER_BATCH_SIZE: '0' }), /between 1 and 1000/);
  assert.throws(() => loadRunnerConfig({
    RECURRENCE_RUNNER_RETRY_BASE_MS: '100', RECURRENCE_RUNNER_RETRY_MAX_MS: '10',
  }), /must be at least/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
