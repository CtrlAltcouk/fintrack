const assert = require('assert');
const express = require('express');
const { once } = require('events');

process.env.PORT = '0';
const { server } = require('../server');
const db = require('../db');
const { createUpdateRouter } = require('../routes/update');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

let baseUrl;
async function request(path, { method = 'GET', body, rawBody, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined && rawBody === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

async function login(displayName, password = 'test-password') {
  const response = await request('/api/auth/login', {
    method: 'POST', body: { display_name: displayName, password },
  });
  assert.strictEqual(response.status, 200);
  return response.cookie;
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = await request('/api/users', {
      method: 'POST', body: { display_name: 'Security Admin', password: 'test-password' },
    });
    let adminCookie = await login('Security Admin');
    const normal = await request('/api/users', {
      method: 'POST', cookie: adminCookie,
      body: { display_name: 'Security User', password: 'test-password' },
    });
    const normalCookie = await login('Security User');

    await test('unauthenticated API requests remain 401', async () => {
      const response = await request('/api/accounts');
      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'unauthenticated');
    });

    await test('normal users receive 403 for every operational and global endpoint', async () => {
      const cases = [
        ['/api/update/check', 'GET'],
        ['/api/update/status', 'GET'],
        ['/api/update', 'POST'],
        ['/api/update/restart', 'POST'],
        ['/api/update/clear-data', 'POST'],
        ['/api/backup', 'GET'],
        ['/api/backup/restore', 'POST'],
        ['/api/recurring/runner', 'GET'],
        ['/api/recurring/runner/run', 'POST'],
        ['/api/users', 'GET'],
        [`/api/users/${admin.body.id}`, 'DELETE'],
      ];
      for (const [path, method] of cases) {
        const response = await request(path, {
          method, cookie: normalCookie, body: method === 'POST' ? {} : undefined,
        });
        assert.strictEqual(response.status, 403, `${method} ${path}`);
      }
      const createUser = await request('/api/users', {
        method: 'POST', cookie: normalCookie,
        body: { display_name: 'Forbidden user', password: 'not-logged' },
      });
      assert.strictEqual(createUser.status, 403);

      const clearOwnData = await request('/api/update/clear-my-data', {
        method: 'POST', cookie: normalCookie,
      });
      assert.strictEqual(clearOwnData.status, 200);
      assert.deepStrictEqual(clearOwnData.body, { ok: true });
    });

    await test('security audit records exclude request secrets and cannot block requests', async () => {
      const entries = [];
      const originalInfo = console.info;
      console.info = value => entries.push(String(value));
      try {
        await request('/api/users', {
          method: 'POST', cookie: normalCookie,
          body: { display_name: 'Audit target', password: 'super-secret-value' },
        });
      } finally {
        console.info = originalInfo;
      }
      assert.ok(entries.some(entry => entry.includes('users.create') && entry.includes('denied')));
      assert.ok(entries.every(entry => !entry.includes('super-secret-value')));

      console.info = () => { throw new Error('simulated audit sink failure'); };
      try {
        const response = await request('/api/update/restart', { method: 'POST', cookie: normalCookie });
        assert.strictEqual(response.status, 403);
        assert.strictEqual(response.body.error, 'administrator access required');
      } finally {
        console.info = originalInfo;
      }
    });

    await test('administrators retain backup and user-management access', async () => {
      const users = await request('/api/users', { cookie: adminCookie });
      assert.strictEqual(users.status, 200);
      assert.ok(users.body.some(user => user.id === normal.body.id));
      const backup = await request('/api/backup', { cookie: adminCookie });
      assert.strictEqual(backup.status, 200);
      assert.strictEqual(backup.body.meta.app, 'outflow');
    });

    await test('runner diagnostics and direct execution are administrator-only and contain no occurrence data', async () => {
      const diagnostics = await request('/api/recurring/runner', { cookie: adminCookie });
      assert.strictEqual(diagnostics.status, 200);
      assert.strictEqual(typeof diagnostics.body.active, 'boolean');
      assert.strictEqual(typeof diagnostics.body.running, 'boolean');
      assert.ok(Object.hasOwn(diagnostics.body, 'last_processed'));
      assert.ok(Object.hasOwn(diagnostics.body, 'last_failed'));
      assert.ok(Object.hasOwn(diagnostics.body, 'next_run_at'));
      assert.ok(!Object.hasOwn(diagnostics.body, 'occurrences'));

      const run = await request('/api/recurring/runner/run', {
        method: 'POST', cookie: adminCookie,
      });
      assert.strictEqual(run.status, 200);
      assert.deepStrictEqual(
        { processed: run.body.processed, failed: run.body.failed, source: run.body.source },
        { processed: 0, failed: 0, source: 'admin' }
      );
    });

    await test('ordinary JSON requests over 100 KB receive a JSON 413', async () => {
      const response = await request('/api/auth/login', {
        method: 'POST',
        body: { display_name: 'Security User', password: 'x'.repeat(150000) },
      });
      assert.strictEqual(response.status, 413);
      assert.strictEqual(response.body.error, 'Request body too large');

      const avatar = await request(`/api/users/${normal.body.id}/avatar`, {
        method: 'PATCH', cookie: normalCookie,
        body: { avatar: `data:image/png;base64,${'x'.repeat(150000)}` },
      });
      assert.strictEqual(avatar.status, 200);
    });

    await test('controlled backup restore accepts a valid payload above the ordinary limit', async () => {
      const backup = await request('/api/backup', { cookie: adminCookie });
      backup.body.meta.padding = 'x'.repeat(150000);
      const restored = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: adminCookie, body: backup.body,
      });
      assert.strictEqual(restored.status, 200);
      assert.deepStrictEqual(restored.body, { ok: true, mode: 'replace' });
      adminCookie = await login('Security Admin');
    });

    await test('backup restore rejects unexpected columns before building SQL', async () => {
      const backup = await request('/api/backup', { cookie: adminCookie });
      backup.body.users[0].malicious_column = 'value';
      const response = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: adminCookie, body: backup.body,
      });
      assert.strictEqual(response.status, 400);
      assert.match(response.body.error, /invalid columns/);
    });

    await test('invalid JSON receives a contained JSON 400', async () => {
      const response = await request('/api/auth/login', { method: 'POST', rawBody: '{broken' });
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Invalid JSON request body');
    });

    await test('unknown API routes receive a JSON 404', async () => {
      const response = await request('/api/not-a-real-route', { cookie: adminCookie });
      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.error, 'API endpoint not found');
    });

    await test('restore validation failures preserve existing data', async () => {
      const malformed = {
        meta: { app: 'outflow' },
        users: [{ id: 999999 }], categories: [], accounts: [], income_schedules: [],
        bills: [], income: [], transactions: [], transfers: [], bill_months: [], settings: [],
      };
      const before = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      const response = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: adminCookie, body: malformed,
      });
      assert.strictEqual(response.status, 400);
      assert.match(response.body.error, /Invalid backup|Restore validation failed/);
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, before);
    });

    await test('pinned managed updates are accepted without command execution while restart remains controlled', async () => {
      const scheduled = [];
      const exits = [];
      const requested = [];
      const target = 'a'.repeat(40);
      const operationalApp = express();
      operationalApp.use(express.json());
      operationalApp.use((req, _res, next) => {
        req.user = { id: admin.body.id, is_admin: 1 };
        req.userId = admin.body.id;
        next();
      });
      operationalApp.use('/api/update', createUpdateRouter({
        updates: {
          detectLayout: () => 'managed',
          installed: async () => ({ version: '2.3.0', sha: 'b'.repeat(40), hash: 'bbbbbbb', message: 'Installed' }),
          check: async () => ({
            current: { sha: 'b'.repeat(40) }, target: { sha: target, message: 'Target' },
            upToDate: false, behind: null, deployment: 'managed',
          }),
          status: () => ({ status: 'requested', target }),
          async request(value, userId) {
            requested.push({ value, userId });
            return { status: 'requested', target: value, current: 'b'.repeat(40) };
          },
        },
        schedule(callback, delay) { scheduled.push({ callback, delay }); },
        exitProcess(code) { exits.push(code); },
      }));
      const operationalServer = operationalApp.listen(0);
      await once(operationalServer, 'listening');
      const operationalUrl = `http://127.0.0.1:${operationalServer.address().port}`;
      try {
        const checked = await fetch(`${operationalUrl}/api/update/check`);
        assert.strictEqual(checked.status, 200);
        assert.strictEqual((await checked.json()).target.sha, target);
        const update = await fetch(`${operationalUrl}/api/update`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        });
        assert.strictEqual(update.status, 202);
        assert.deepStrictEqual(requested, [{ value: target, userId: admin.body.id }]);
        assert.deepStrictEqual(scheduled, []);
        assert.deepStrictEqual(exits, []);

        const restart = await fetch(`${operationalUrl}/api/update/restart`, { method: 'POST' });
        assert.strictEqual(restart.status, 200);
        assert.strictEqual(scheduled[0].delay, 300);
        scheduled.shift().callback();
        assert.deepStrictEqual(exits, [0]);
      } finally {
        await new Promise((resolve, reject) => operationalServer.close(error => error ? reject(error) : resolve()));
      }
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (db.open) db.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
