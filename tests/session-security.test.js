const assert = require('assert');
const bcrypt = require('bcryptjs');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const {
  DEFAULT_SESSION_TTL_HOURS, authenticateSession, digestSessionToken,
  generateSessionToken, issueSession, loadSessionConfig, revokeUserSessions,
} = require('../lib/session');

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
  const text = await response.text();
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: setCookie?.split(';')[0] ?? null,
    setCookie,
  };
}

async function login(name, password) {
  return request('/api/auth/login', {
    method: 'POST', body: { display_name: name, password },
  });
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  await recurrenceRunner.stop();
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await test('fresh schema and 256-bit tokens store only a domain-separated digest', async () => {
      assert.strictEqual(db.pragma('user_version', { simple: true }), 10);
      const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
      for (const column of ['session_token_hash', 'session_created_at', 'session_expires_at']) {
        assert.ok(userColumns.has(column), `missing ${column}`);
      }
      const tokens = new Set(Array.from({ length: 32 }, generateSessionToken));
      assert.strictEqual(tokens.size, 32);
      assert.ok([...tokens].every(token => /^[a-f0-9]{64}$/.test(token)));

      const result = db.prepare(`
        INSERT INTO users (display_name, password_hash, colour, is_admin)
        VALUES ('Session Service', 'hash', '#123456', 0)
      `).run();
      const userId = Number(result.lastInsertRowid);
      const session = issueSession(db, userId);
      const stored = db.prepare('SELECT session_token, session_token_hash FROM users WHERE id = ?').get(userId);
      assert.strictEqual(stored.session_token, null);
      assert.notStrictEqual(stored.session_token_hash, session.token);
      assert.strictEqual(stored.session_token_hash, digestSessionToken(session.token));
      assert.strictEqual(authenticateSession(db, session.token).id, userId);
      assert.strictEqual(authenticateSession(db, generateSessionToken()), null);
      revokeUserSessions(db, userId);
      assert.strictEqual(authenticateSession(db, session.token), null);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });

    await test('session TTL and proxy configuration reject unsafe startup values', async () => {
      assert.strictEqual(loadSessionConfig({}).ttlHours, DEFAULT_SESSION_TTL_HOURS);
      assert.strictEqual(loadSessionConfig({ OUTFLOW_SESSION_TTL_HOURS: '24' }).ttlHours, 24);
      for (const value of ['0', '-1', 'NaN', '721', 'Infinity']) {
        assert.throws(() => loadSessionConfig({ OUTFLOW_SESSION_TTL_HOURS: value }), /OUTFLOW_SESSION_TTL_HOURS/);
      }
      for (const value of ['-1', 'yes', '17']) {
        assert.throws(() => loadSessionConfig({ OUTFLOW_TRUST_PROXY_HOPS: value }), /OUTFLOW_TRUST_PROXY_HOPS/);
      }
    });

    const password = 'session-test-password';
    const created = await request('/api/users', { method: 'POST', body: {
      display_name: 'Session Admin', password,
    } });
    assert.strictEqual(created.status, 201);

    await test('login rotates sessions, failed login does not, and development cookies are explicit', async () => {
      const first = await login('Session Admin', password);
      assert.strictEqual(first.status, 200);
      assert.match(first.setCookie, /HttpOnly/i);
      assert.match(first.setCookie, /SameSite=Lax/i);
      assert.match(first.setCookie, /Path=\//i);
      assert.match(first.setCookie, /Max-Age=/i);
      assert.match(first.setCookie, /Expires=/i);
      assert.doesNotMatch(first.setCookie, /;\s*Secure/i);
      assert.strictEqual((await request('/api/auth/me', { cookie: first.cookie })).status, 200);

      const failedLogin = await login('Session Admin', 'incorrect-password');
      assert.strictEqual(failedLogin.status, 401);
      assert.strictEqual((await request('/api/auth/me', { cookie: first.cookie })).status, 200);

      const second = await login('Session Admin', password);
      assert.strictEqual(second.status, 200);
      assert.notStrictEqual(second.cookie, first.cookie);
      assert.strictEqual((await request('/api/auth/me', { cookie: first.cookie })).status, 401);
      assert.strictEqual((await request('/api/auth/me', { cookie: second.cookie })).status, 200);
    });

    await test('production cookies are Secure without trusting forwarded headers by default', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const response = await login('Session Admin', password);
        assert.strictEqual(response.status, 200);
        assert.match(response.setCookie, /;\s*Secure/i);
        assert.match(response.setCookie, /HttpOnly/i);
        assert.match(response.setCookie, /SameSite=Lax/i);
        assert.match(response.setCookie, /Path=\//i);
        assert.match(response.setCookie, /Expires=/i);
        const logout = await request('/api/auth/logout', { method: 'POST', cookie: response.cookie });
        assert.strictEqual(logout.status, 200);
        assert.match(logout.setCookie, /;\s*Secure/i);
        assert.match(logout.setCookie, /SameSite=Lax/i);
        assert.match(logout.setCookie, /Path=\//i);
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    });

    await test('expired sessions fail uniformly and clear the matching cookie scope', async () => {
      const active = await login('Session Admin', password);
      db.prepare(`
        UPDATE users SET session_expires_at = '2000-01-01T00:00:00.000Z'
        WHERE display_name = 'Session Admin'
      `).run();
      const expired = await request('/api/auth/me', { cookie: active.cookie });
      assert.strictEqual(expired.status, 401);
      assert.deepStrictEqual(expired.body, { error: 'unauthenticated' });
      assert.match(expired.setCookie, /fintrack_session=;/);
      assert.match(expired.setCookie, /Path=\//i);
      assert.match(expired.setCookie, /SameSite=Lax/i);
      assert.match(expired.setCookie, /HttpOnly/i);
      assert.strictEqual(db.prepare(`
        SELECT session_token_hash FROM users WHERE display_name = 'Session Admin'
      `).get().session_token_hash, null);
    });

    await test('logout and password changes revoke server-side state', async () => {
      let active = await login('Session Admin', password);
      const logout = await request('/api/auth/logout', { method: 'POST', cookie: active.cookie });
      assert.strictEqual(logout.status, 200);
      assert.match(logout.setCookie, /Path=\//i);
      assert.match(logout.setCookie, /SameSite=Lax/i);
      assert.match(logout.setCookie, /HttpOnly/i);
      assert.strictEqual((await request('/api/auth/me', { cookie: active.cookie })).status, 401);

      active = await login('Session Admin', password);
      const changed = await request(`/api/users/${created.body.id}/password`, {
        method: 'PATCH', cookie: active.cookie,
        body: { current_password: password, new_password: password },
      });
      assert.strictEqual(changed.status, 200);
      assert.deepStrictEqual(changed.body, { ok: true, reauthenticate: true });
      assert.strictEqual((await request('/api/auth/me', { cookie: active.cookie })).status, 401);
    });

    await test('user deletion removes its active session with the user row', async () => {
      const admin = await login('Session Admin', password);
      const target = await request('/api/users', { method: 'POST', cookie: admin.cookie, body: {
        display_name: 'Disposable Session User', password: 'disposable-password',
      } });
      assert.strictEqual(target.status, 201);
      const targetLogin = await login('Disposable Session User', 'disposable-password');
      const removed = await request(`/api/users/${target.body.id}`, {
        method: 'DELETE', cookie: admin.cookie,
      });
      assert.strictEqual(removed.status, 200);
      assert.strictEqual((await request('/api/auth/me', { cookie: targetLogin.cookie })).status, 401);
    });

    await test('backup export and every restore format exclude and invalidate session credentials', async () => {
      let admin = await login('Session Admin', password);
      const row = db.prepare(`SELECT session_token_hash FROM users WHERE display_name = 'Session Admin'`).get();
      const exported = await request('/api/backup', { cookie: admin.cookie });
      assert.strictEqual(exported.status, 200);
      for (const user of exported.body.users) {
        assert.strictEqual(Object.hasOwn(user, 'session_token'), false);
        assert.strictEqual(Object.hasOwn(user, 'session_token_hash'), false);
        assert.strictEqual(Object.hasOwn(user, 'session_created_at'), false);
        assert.strictEqual(Object.hasOwn(user, 'session_expires_at'), false);
      }
      assert.doesNotMatch(JSON.stringify(exported.body), new RegExp(row.session_token_hash));

      const legacy = structuredClone(exported.body);
      legacy.meta.schema_version = 1;
      for (const user of legacy.users) user.session_token = generateSessionToken();
      const restoredLegacy = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: admin.cookie, body: legacy,
      });
      assert.strictEqual(restoredLegacy.status, 200);
      assert.strictEqual((await request('/api/auth/me', { cookie: admin.cookie })).status, 401);

      admin = await login('Session Admin', password);
      const modern = structuredClone(exported.body);
      for (const user of modern.users) {
        user.session_token_hash = digestSessionToken(generateSessionToken());
        user.session_created_at = '2026-01-01T00:00:00.000Z';
        user.session_expires_at = '2026-01-02T00:00:00.000Z';
      }
      const restoredModern = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: admin.cookie, body: modern,
      });
      assert.strictEqual(restoredModern.status, 200);
      assert.strictEqual((await request('/api/auth/me', { cookie: admin.cookie })).status, 401);
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM users WHERE session_token_hash IS NOT NULL').get().count, 0);
    });

    await test('failed restore preserves the active session and returns no session internals', async () => {
      const admin = await login('Session Admin', password);
      const exported = await request('/api/backup', { cookie: admin.cookie });
      exported.body.users[0].unexpected = 'invalid';
      const failedRestore = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: admin.cookie, body: exported.body,
      });
      assert.strictEqual(failedRestore.status, 400);
      assert.strictEqual((await request('/api/auth/me', { cookie: admin.cookie })).status, 200);
      assert.doesNotMatch(JSON.stringify(failedRestore.body), /session_token|session_expires|password_hash/i);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
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
