const express     = require('express');
const path        = require('path');
const cookieParser = require('cookie-parser');
const {
  preventSensitiveCaching, securityHeaders, setStaticCacheHeaders,
} = require('./lib/http-security');
const { loadRuntimeConfig } = require('./lib/runtime-config');
const { setShutdownHandler } = require('./lib/shutdown');
const { loadLoginSecurityConfig } = require('./lib/login-security');
const { loadSessionConfig } = require('./lib/session');
const { loadRunnerConfig } = require('./lib/recurrence/runner-config');
const { createRecurrenceRunner } = require('./lib/recurrence/runner');
const { setRecurrenceRunner } = require('./lib/recurrence/runner-runtime');
const runtimeConfig = loadRuntimeConfig();
const sessionConfig = loadSessionConfig();
loadLoginSecurityConfig();
const runnerConfig = loadRunnerConfig();
const db = require('./db');
const { LATEST_SCHEMA_VERSION } = require('./db-migrations');
const { version: appVersion } = require('./package.json');
const requireAuth  = require('./middleware/auth');
require('./lib/recurrence/bill-adapter');
require('./lib/recurrence/income-adapter');
require('./lib/recurrence/transaction-adapter');
require('./lib/recurrence/transfer-adapter');

const recurrenceRunner = createRecurrenceRunner(db, runnerConfig);
setRecurrenceRunner(recurrenceRunner);

const app = express();
let shuttingDown = false;
let shutdownPromise = null;
app.disable('x-powered-by');
app.disable('etag');
if (sessionConfig.trustProxyHops > 0) app.set('trust proxy', sessionConfig.trustProxyHops);
app.use(securityHeaders({ production: runtimeConfig.production }));
app.use('/api', preventSensitiveCaching);
app.use('/api/backup/restore', express.json({ limit: '10mb' }));
app.use(/^\/api\/users\/\d+\/avatar$/, express.json({ limit: '512kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  setHeaders: setStaticCacheHeaders,
}));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/ready', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ ok: false });
  try {
    db.prepare('SELECT 1').get();
    const schemaVersion = db.pragma('user_version', { simple: true });
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    if (schemaVersion !== LATEST_SCHEMA_VERSION || foreignKeys !== 1) {
      return res.status(503).json({ ok: false });
    }
    return res.json({ ok: true });
  } catch (_error) {
    return res.status(503).json({ ok: false });
  }
});
app.use('/api', (_req, _res, next) => {
  void recurrenceRunner.triggerCatchUp().catch(() => {});
  next();
});

// Auth + user management — no requireAuth wrapper (handle their own auth)
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// All other routes require a valid session
app.use('/api/accounts',         requireAuth, require('./routes/accounts'));
app.use('/api/transfers',        requireAuth, require('./routes/transfers'));
app.use('/api/transactions',     requireAuth, require('./routes/transactions'));
app.use('/api/bills',            requireAuth, require('./routes/bills'));
app.use('/api/bill-months',      requireAuth, require('./routes/bills'));
app.use('/api/recurring',        requireAuth, require('./routes/recurring'));
app.use('/api/income/schedules', requireAuth, require('./routes/income-schedules').router);
app.use('/api/income',           requireAuth, require('./routes/income'));
app.use('/api/categories',       requireAuth, require('./routes/categories'));
app.use('/api/summary',          requireAuth, require('./routes/summary-range'));
app.use('/api/summary',          requireAuth, require('./routes/summary'));
app.use('/api/calendar',         requireAuth, require('./routes/calendar'));
app.use('/api/update',           requireAuth, require('./routes/update'));
app.use('/api/settings',         requireAuth, require('./routes/settings'));
app.use('/api/backup',           requireAuth, require('./routes/backup'));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.use((err, req, res, _next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err instanceof SyntaxError && err?.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }
  console.error(`[api-error] ${req.method} ${req.originalUrl}:`, err?.message ?? 'Unknown error');
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(runtimeConfig.port, () => {
  try {
    recurrenceRunner.start();
    const boundPort = server.address()?.port ?? runtimeConfig.port;
    console.log(`[startup] Outflow ${appVersion} listening on port ${boundPort}; environment=${runtimeConfig.nodeEnv}; schema=${LATEST_SCHEMA_VERSION}`);
  } catch (error) {
    console.error(`[startup] Recurrence runner failed to start: ${error.message}`);
    void shutdown('startup-failure', { exitCode: 1 });
  }
});

function closeHttpServer() {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function removeSignalHandlers() {
  process.removeListener('SIGTERM', handleSigterm);
  process.removeListener('SIGINT', handleSigint);
}

async function shutdown(reason = 'requested', { exitCode = 0 } = {}) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  removeSignalHandlers();
  console.info(`[shutdown] ${reason}; stopping HTTP listener and recurrence runner`);
  shutdownPromise = (async () => {
    await Promise.all([closeHttpServer(), recurrenceRunner.stop()]);
    if (db.open) db.close();
    process.exitCode = exitCode;
    console.info('[shutdown] complete');
  })().catch(error => {
    process.exitCode = 1;
    console.error(`[shutdown] failed: ${error.message}`);
    throw error;
  });
  return shutdownPromise;
}

function handleSigterm() { void shutdown('SIGTERM'); }
function handleSigint() { void shutdown('SIGINT'); }
process.once('SIGTERM', handleSigterm);
process.once('SIGINT', handleSigint);
setShutdownHandler(shutdown);

server.once('close', () => {
  removeSignalHandlers();
  setShutdownHandler(null);
  if (!shuttingDown) void recurrenceRunner.stop().catch(() => {});
});

module.exports = {
  app, isShuttingDown: () => shuttingDown, recurrenceRunner, server, shutdown,
};
