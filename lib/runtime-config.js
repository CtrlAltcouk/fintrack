const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);

function parsePort(value, nodeEnv) {
  const raw = value === undefined || value === '' ? '3000' : String(value);
  if (!/^\d+$/.test(raw)) throw new Error('PORT must be an integer between 1 and 65535');
  const port = Number(raw);
  const minimum = nodeEnv === 'production' ? 1 : 0;
  if (!Number.isSafeInteger(port) || port < minimum || port > 65535) {
    throw new Error(`PORT must be an integer between ${minimum} and 65535`);
  }
  return port;
}

function loadRuntimeConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  return Object.freeze({
    nodeEnv,
    production: nodeEnv === 'production',
    port: parsePort(env.PORT, nodeEnv),
  });
}

module.exports = { loadRuntimeConfig, parsePort, VALID_NODE_ENVS };
