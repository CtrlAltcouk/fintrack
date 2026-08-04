const DEFAULTS = Object.freeze({
  enabled: true,
  intervalMs: 60000,
  batchSize: 50,
  requestThrottleMs: 15000,
  retryBaseMs: 60000,
  retryMaxMs: 3600000,
  maxAttempts: 5,
});

function booleanValue(name, value, fallback) {
  if (value === undefined) return fallback;
  if (['1', 'true'].includes(String(value).toLowerCase())) return true;
  if (['0', 'false'].includes(String(value).toLowerCase())) return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function integerValue(name, value, fallback, { min, max }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function loadRunnerConfig(env = process.env) {
  const config = {
    enabled: booleanValue('RECURRENCE_RUNNER_ENABLED', env.RECURRENCE_RUNNER_ENABLED, DEFAULTS.enabled),
    intervalMs: integerValue('RECURRENCE_RUNNER_INTERVAL_MS', env.RECURRENCE_RUNNER_INTERVAL_MS,
      DEFAULTS.intervalMs, { min: 10, max: 86400000 }),
    batchSize: integerValue('RECURRENCE_RUNNER_BATCH_SIZE', env.RECURRENCE_RUNNER_BATCH_SIZE,
      DEFAULTS.batchSize, { min: 1, max: 1000 }),
    requestThrottleMs: integerValue(
      'RECURRENCE_RUNNER_REQUEST_THROTTLE_MS', env.RECURRENCE_RUNNER_REQUEST_THROTTLE_MS,
      DEFAULTS.requestThrottleMs, { min: 0, max: 86400000 }
    ),
    retryBaseMs: integerValue('RECURRENCE_RUNNER_RETRY_BASE_MS', env.RECURRENCE_RUNNER_RETRY_BASE_MS,
      DEFAULTS.retryBaseMs, { min: 1, max: 86400000 }),
    retryMaxMs: integerValue('RECURRENCE_RUNNER_RETRY_MAX_MS', env.RECURRENCE_RUNNER_RETRY_MAX_MS,
      DEFAULTS.retryMaxMs, { min: 1, max: 604800000 }),
    maxAttempts: integerValue('RECURRENCE_RUNNER_MAX_ATTEMPTS', env.RECURRENCE_RUNNER_MAX_ATTEMPTS,
      DEFAULTS.maxAttempts, { min: 1, max: 100 }),
  };
  if (config.retryMaxMs < config.retryBaseMs) {
    throw new Error('RECURRENCE_RUNNER_RETRY_MAX_MS must be at least RECURRENCE_RUNNER_RETRY_BASE_MS');
  }
  return Object.freeze(config);
}

module.exports = { DEFAULTS, loadRunnerConfig };
