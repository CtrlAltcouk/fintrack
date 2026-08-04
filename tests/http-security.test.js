const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const { securityHeaders } = require('../lib/http-security');

let passed = 0;
let failed = 0;
let baseUrl;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  \u2717 ${name}: ${error.stack || error.message}`);
    failed += 1;
  }
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

function assertBaselineHeaders(headers) {
  const csp = headers.get('content-security-policy');
  assert.ok(csp);
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("script-src-attr 'unsafe-inline'"));
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
  assert.strictEqual(headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(headers.get('referrer-policy'), 'no-referrer');
  assert.strictEqual(headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.strictEqual(headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.strictEqual(headers.get('origin-agent-cluster'), '?1');
  assert.strictEqual(headers.get('x-powered-by'), null);
  assert.strictEqual(headers.get('cross-origin-embedder-policy'), null);
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  await recurrenceRunner.stop();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await test('HTML and static assets receive security headers with safe cache rules', async () => {
      const index = await request('/');
      assert.strictEqual(index.response.status, 200);
      assertBaselineHeaders(index.response.headers);
      assert.strictEqual(index.response.headers.get('cache-control'), 'no-store');
      assert.strictEqual(index.response.headers.get('pragma'), 'no-cache');
      assert.strictEqual(index.response.headers.get('strict-transport-security'), null);

      const stylesheet = await request('/style.css');
      assert.strictEqual(stylesheet.response.status, 200);
      assertBaselineHeaders(stylesheet.response.headers);
      assert.strictEqual(
        stylesheet.response.headers.get('cache-control'),
        'public, max-age=0, must-revalidate',
      );
    });

    await test('API success, authentication failures and 404 responses cannot be cached', async () => {
      for (const path of ['/api/health', '/api/ready', '/api/accounts', '/api/does-not-exist']) {
        const result = await request(path);
        assertBaselineHeaders(result.response.headers);
        assert.strictEqual(result.response.headers.get('cache-control'), 'no-store');
        assert.strictEqual(result.response.headers.get('pragma'), 'no-cache');
        assert.strictEqual(result.response.headers.get('expires'), '0');
        assert.strictEqual(result.response.headers.get('surrogate-control'), 'no-store');
        assert.strictEqual(result.response.headers.get('etag'), null);
      }
    });

    await test('backup downloads retain attachment behaviour and sensitive cache protection', async () => {
      const created = await request('/api/users', { method: 'POST', body: {
        display_name: 'HTTP Security Admin', password: 'test-password', colour: '#4a9eff',
      } });
      assert.strictEqual(created.response.status, 201);
      const login = await request('/api/auth/login', { method: 'POST', body: {
        display_name: 'HTTP Security Admin', password: 'test-password',
      } });
      const cookie = login.response.headers.get('set-cookie').split(';')[0];
      const backup = await request('/api/backup', { cookie });
      assert.strictEqual(backup.response.status, 200);
      assert.match(backup.response.headers.get('content-disposition'), /^attachment; filename="outflow-backup-/);
      assert.strictEqual(backup.response.headers.get('cache-control'), 'no-store');
      assertBaselineHeaders(backup.response.headers);
    });

    await test('production policy adds HSTS and mixed-content upgrading', async () => {
      const values = new Map();
      let continued = false;
      securityHeaders({ production: true })(null, {
        setHeader(name, value) { values.set(name.toLowerCase(), value); },
      }, () => { continued = true; });
      assert.strictEqual(continued, true);
      assert.strictEqual(
        values.get('strict-transport-security'),
        'max-age=31536000',
      );
      assert.ok(values.get('content-security-policy').includes('upgrade-insecure-requests'));
    });
  } finally {
    await recurrenceRunner.stop();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
