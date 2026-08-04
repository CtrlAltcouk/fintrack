const assert = require('assert');
const express = require('express');
const { once } = require('events');
const { LoginRateLimiter, digestBucket } = require('../lib/login-security');
const authRouter = require('../routes/auth');
const { loadSessionConfig } = require('../lib/session');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');

let passed = 0;
let failed = 0;
let baseUrl;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
    retryAfter: response.headers.get('retry-after'),
  };
}

const login = (displayName, password, options = {}) => request('/api/auth/login', {
  method: 'POST', body: { display_name: displayName, password }, ...options,
});

(async () => {
  if (!server.listening) await once(server, 'listening');
  await recurrenceRunner.stop();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await request('/api/users', { method: 'POST', body: {
      display_name: 'Login Security Admin', password: 'correct-password',
    } });
    assert.strictEqual(created.status, 201);

    await test('known and unknown credential failures are indistinguishable and audit-safe', async () => {
      const entries = [];
      const originalInfo = console.info;
      console.info = line => entries.push(String(line));
      let known;
      let unknown;
      try {
        known = await login('Login Security Admin', 'wrong-password');
        unknown = await login('No Such Display Name', 'wrong-password');
      } finally {
        console.info = originalInfo;
      }
      assert.strictEqual(known.status, 401);
      assert.strictEqual(unknown.status, 401);
      assert.deepStrictEqual(known.body, unknown.body);
      assert.deepStrictEqual(known.body, {
        error: 'Invalid display name or password', code: 'AUTH_INVALID_CREDENTIALS',
      });
      const output = entries.join('\n');
      assert.match(output, /"action":"auth.login"/);
      assert.match(output, /"outcome":"failed"/);
      assert.doesNotMatch(output, /wrong-password|Login Security Admin|No Such Display Name/);
    });

    await test('trimmed case variants authenticate and success clears account failures only', async () => {
      const response = await login('  LOGIN SECURITY ADMIN  ', 'correct-password');
      assert.strictEqual(response.status, 200);
      const accountKey = digestBucket('account', 'login security admin');
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM login_rate_limits
        WHERE bucket_type = 'account' AND bucket_key = ?`).get(accountKey).count, 0);
      assert.ok(db.prepare(`SELECT COUNT(*) AS count FROM login_rate_limits
        WHERE bucket_type = 'ip'`).get().count > 0);
    });

    await test('the account threshold returns stable 429 metadata and blocks valid passwords without a session', async () => {
      const adminLogin = await login('Login Security Admin', 'correct-password');
      const target = await request('/api/users', { method: 'POST', cookie: adminLogin.cookie, body: {
        display_name: 'Throttled Account', password: 'target-password',
      } });
      assert.strictEqual(target.status, 201);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await login(attempt % 2 ? 'Throttled Account' : ' throttled account ', 'wrong');
        assert.strictEqual(response.status, 401, `attempt ${attempt}`);
      }
      const threshold = await login('THROTTLED ACCOUNT', 'wrong');
      assert.strictEqual(threshold.status, 429);
      assert.strictEqual(threshold.body.code, 'AUTH_RATE_LIMITED');
      assert.ok(Number(threshold.retryAfter) > 0);
      assert.strictEqual(threshold.body.retry_after, Number(threshold.retryAfter));
      const validWhileBlocked = await login('Throttled Account', 'target-password');
      assert.strictEqual(validWhileBlocked.status, 429);
      assert.strictEqual(validWhileBlocked.cookie, null);

      const key = digestBucket('account', 'throttled account');
      db.prepare(`UPDATE login_rate_limits SET short_window_started_at = 0, short_failures = 0,
        long_window_started_at = 0, long_failures = 0, cooldown_until = 0
        WHERE bucket_type = 'account' AND bucket_key = ?`).run(key);
      assert.strictEqual((await login('Throttled Account', 'target-password')).status, 200);
    });

    await test('direct deployments ignore spoofed forwarding headers and bound malformed credentials', async () => {
      const spoofed = await login('spoof-check', 'wrong', { headers: { 'X-Forwarded-For': '198.51.100.200' } });
      assert.strictEqual(spoofed.status, 401);
      assert.ok(db.prepare(`SELECT 1 FROM login_rate_limits
        WHERE bucket_type = 'ip' AND bucket_key = ?`).get(digestBucket('ip', '127.0.0.1')));
      assert.ok(!db.prepare(`SELECT 1 FROM login_rate_limits
        WHERE bucket_type = 'ip' AND bucket_key = ?`).get(digestBucket('ip', '198.51.100.200')));

      assert.strictEqual((await login('x'.repeat(101), 'wrong')).status, 401);
      assert.strictEqual((await login('bounded-input', 'x'.repeat(1025))).status, 401);
      const malformed = await request('/api/auth/login', { method: 'POST', body: {
        display_name: ['not', 'text'], password: { value: 'not text' },
      } });
      assert.strictEqual(malformed.status, 400);
      assert.strictEqual(malformed.body.code, 'AUTH_INVALID_REQUEST');
    });

    await test('an explicitly bounded proxy hop uses the validated forwarded client address', async () => {
      const proxyApp = express();
      proxyApp.set('trust proxy', 1);
      proxyApp.use(express.json());
      proxyApp.use('/api/auth', authRouter.createAuthRouter({
        database: db,
        sessionConfig: { ...loadSessionConfig(), trustProxyHops: 1 },
      }));
      const proxyServer = proxyApp.listen(0);
      await once(proxyServer, 'listening');
      try {
        const response = await fetch(`http://127.0.0.1:${proxyServer.address().port}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.210' },
          body: JSON.stringify({ display_name: 'proxy-unknown', password: 'wrong' }),
        });
        assert.strictEqual(response.status, 401);
        assert.ok(db.prepare(`SELECT 1 FROM login_rate_limits
          WHERE bucket_type = 'ip' AND bucket_key = ?`).get(digestBucket('ip', '198.51.100.210')));
      } finally {
        await new Promise((resolve, reject) => proxyServer.close(error => error ? reject(error) : resolve()));
      }
    });

    await test('preflight-throttled requests perform no password comparison', async () => {
      let comparisons = 0;
      const limiter = new LoginRateLimiter(db, {
        accountShortMax: 1, accountShortWindowSeconds: 60,
        accountLongMax: 2, accountLongWindowSeconds: 300,
        ipMax: 10, ipWindowSeconds: 300,
        cooldownBaseSeconds: 10, cooldownMaxSeconds: 60, claimTtlSeconds: 5,
      });
      const app = express();
      app.set('trust proxy', 1);
      app.use(express.json());
      app.use('/api/auth', authRouter.createAuthRouter({
        database: db,
        limiter,
        sessionConfig: { ...loadSessionConfig(), trustProxyHops: 1 },
        comparePassword: async () => { comparisons += 1; return false; },
      }));
      const isolatedServer = app.listen(0);
      await once(isolatedServer, 'listening');
      try {
        const attempt = () => fetch(`http://127.0.0.1:${isolatedServer.address().port}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.230' },
          body: JSON.stringify({ display_name: 'comparison-target', password: 'wrong' }),
        });
        assert.strictEqual((await attempt()).status, 429);
        assert.strictEqual(comparisons, 1);
        assert.strictEqual((await attempt()).status, 429);
        assert.strictEqual(comparisons, 1);
      } finally {
        await new Promise((resolve, reject) => isolatedServer.close(error => error ? reject(error) : resolve()));
      }
    });

    await test('concurrent requests reserve account attempts before asynchronous bcrypt work', async () => {
      const adminLogin = await login('Login Security Admin', 'correct-password');
      const target = await request('/api/users', { method: 'POST', cookie: adminLogin.cookie, body: {
        display_name: 'Concurrent Account', password: 'concurrent-password',
      } });
      assert.strictEqual(target.status, 201);
      let eventLoopAdvanced = false;
      setImmediate(() => { eventLoopAdvanced = true; });
      const responses = await Promise.all(Array.from({ length: 6 }, () =>
        login('Concurrent Account', 'wrong-concurrent-password')));
      assert.strictEqual(eventLoopAdvanced, true);
      assert.ok(responses.filter(response => response.status === 429).length >= 1);
      assert.ok(responses.every(response => response.status === 401 || response.status === 429));
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_attempt_claims').get().count, 0);
    });

    await test('limiter state is excluded from backup data and contains no raw identifiers', async () => {
      const loginResponse = await login('Login Security Admin', 'correct-password');
      const backup = await request('/api/backup', { cookie: loginResponse.cookie });
      assert.strictEqual(backup.status, 200);
      assert.strictEqual(Object.hasOwn(backup.body, 'login_rate_limits'), false);
      assert.strictEqual(Object.hasOwn(backup.body, 'login_attempt_claims'), false);
      const state = JSON.stringify(db.prepare('SELECT * FROM login_rate_limits').all());
      assert.doesNotMatch(state, /Login Security Admin|wrong-password|correct-password|127\.0\.0\.1/);
      assert.ok(db.prepare('SELECT COUNT(*) AS count FROM login_rate_limits').get().count > 0);
      const restored = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: loginResponse.cookie, body: backup.body,
      });
      assert.strictEqual(restored.status, 200);
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_rate_limits').get().count, 0);
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM login_attempt_claims').get().count, 0);
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (db.open) db.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  if (server.listening) server.close();
  if (db.open) db.close();
  process.exitCode = 1;
});
