const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const { createRecurrenceRunner } = require('../lib/recurrence/runner');

let passed = 0, failed = 0, baseUrl;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}
async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}
async function createAndLogin(name, adminCookie) {
  const created = await request('/api/users', { method: 'POST', cookie: adminCookie,
    body: { display_name: name, password: 'test-password', colour: '#4a9eff' } });
  assert.strictEqual(created.status, 201);
  const login = await request('/api/auth/login', { method: 'POST',
    body: { display_name: name, password: 'test-password' } });
  return { cookie: login.cookie, user: login.body };
}
function addDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function runnerAt(date) {
  return createRecurrenceRunner(db, {
    enabled: true, intervalMs: 1000, batchSize: 50, requestThrottleMs: 0,
    retryBaseMs: 1, retryMaxMs: 10, maxAttempts: 3,
  }, { now: () => new Date(`${date}T12:00:00Z`) });
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await recurrenceRunner.stop();
  try {
    const owner = await createAndLogin('Transfer Owner');
    const other = await createAndLogin('Transfer Other', owner.cookie);
    const createAccount = async (cookie, name, opening_balance) => (await request('/api/accounts', {
      method: 'POST', cookie, body: { name, type: 'current', colour: '#123456', opening_balance },
    })).body;
    const source = await createAccount(owner.cookie, 'Recurring source', 1000);
    const destination = await createAccount(owner.cookie, 'Recurring destination', 100);
    const otherAccount = await createAccount(other.cookie, 'Other account', 50);
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = addDays(today, 1);

    await test('legacy payload stays immediate and invalid account combinations are rejected', async () => {
      const legacy = await request('/api/transfers', { method: 'POST', cookie: owner.cookie, body: {
        from_account_id: source.id, to_account_id: destination.id,
        amount: 25, date: today, note: 'Legacy',
      }});
      assert.strictEqual(legacy.status, 201);
      assert.ok(legacy.body.id);
      assert.strictEqual(legacy.body.recurring_occurrence_id, null);
      const same = await request('/api/transfers', { method: 'POST', cookie: owner.cookie, body: {
        from_account_id: source.id, to_account_id: source.id, amount: 1, date: today,
      }});
      assert.strictEqual(same.status, 400);
      const crossUser = await request('/api/transfers', { method: 'POST', cookie: owner.cookie, body: {
        from_account_id: source.id, to_account_id: otherAccount.id, amount: 1, date: today,
        recurrence: { frequency: 'daily', start_date: today, end_mode: 'never' },
      }});
      assert.strictEqual(crossUser.status, 404);
    });

    await test('future recurring transfer remains absent until due', async () => {
      const created = await request('/api/transfers', { method: 'POST', cookie: owner.cookie, body: {
        from_account_id: source.id, to_account_id: destination.id, amount: 10,
        date: tomorrow, note: 'Future',
        recurrence: { frequency: 'daily', start_date: tomorrow, end_mode: 'count', max_occurrences: 2 },
      }});
      assert.strictEqual(created.status, 201);
      await runnerAt(today).runOnce();
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transfers t
        JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
        WHERE ro.series_id = ?`).get(created.body.recurring_series_id).count, 0);
    });

    let seriesId, generatedId;
    await test('due execution is atomic, concurrent-safe, restart-safe, and balance-correct', async () => {
      const created = await request('/api/transfers', { method: 'POST', cookie: owner.cookie, body: {
        from_account_id: source.id, to_account_id: destination.id, amount: 40,
        date: today, note: 'Automatic transfer',
        recurrence: { frequency: 'daily', start_date: today, end_mode: 'never' },
      }});
      seriesId = created.body.recurring_series_id;
      const runner = runnerAt(today);
      const [a, b] = await Promise.all([runner.runOnce(), runner.runOnce()]);
      assert.strictEqual(a.processed + b.processed, 1);
      await runnerAt(today).runOnce();
      const rows = db.prepare(`SELECT t.* FROM transfers t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ?`).all(seriesId);
      assert.strictEqual(rows.length, 1);
      generatedId = rows[0].id;
      const accounts = (await request('/api/accounts', { cookie: owner.cookie })).body;
      assert.strictEqual(accounts.find(row => row.id === source.id).balance, 935);
      assert.strictEqual(accounts.find(row => row.id === destination.id).balance, 165);
    });

    await test('single/future edit and pause/resume/skip/stop preserve history', async () => {
      let response = await request(`/api/transfers/${generatedId}`, { method: 'PUT', cookie: owner.cookie,
        body: { amount: 41, scope: 'single' } });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(db.prepare('SELECT amount FROM recurring_transfer_templates WHERE recurring_series_id = ?')
        .get(seriesId).amount, 40);
      response = await request(`/api/transfers/${generatedId}`, { method: 'PUT', cookie: owner.cookie,
        body: { amount: 42, note: 'Future transfer', scope: 'future' } });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(db.prepare('SELECT amount FROM recurring_transfer_templates WHERE recurring_series_id = ?')
        .get(seriesId).amount, 42);
      await runnerAt(tomorrow).runOnce();
      assert.deepStrictEqual(db.prepare(`SELECT t.amount FROM transfers t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ? ORDER BY t.date`).all(seriesId)
        .map(row => row.amount), [42, 42]);
      assert.strictEqual((await request(`/api/recurring/${seriesId}/pause`, { method: 'POST', cookie: owner.cookie })).status, 200);
      assert.strictEqual((await request(`/api/recurring/${seriesId}/resume`, { method: 'POST', cookie: owner.cookie,
        body: { resume_date: addDays(tomorrow, 1) } })).status, 200);
      assert.strictEqual((await request(`/api/recurring/${seriesId}/skip-next`, { method: 'POST', cookie: owner.cookie })).status, 200);
      assert.strictEqual((await request(`/api/recurring/${seriesId}/stop`, { method: 'POST', cookie: owner.cookie })).status, 200);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_series WHERE id = ?').get(seriesId).status, 'deleted');
    });

    await test('deleting one occurrence prevents regeneration and failures retry atomically', async () => {
      const occurrenceId = db.prepare('SELECT recurring_occurrence_id FROM transfers WHERE id = ?')
        .get(generatedId).recurring_occurrence_id;
      assert.strictEqual((await request(`/api/transfers/${generatedId}`, { method: 'DELETE', cookie: owner.cookie })).status, 200);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(occurrenceId).status, 'deleted');

      const retry = await request('/api/transfers', { method: 'POST', cookie: owner.cookie, body: {
        from_account_id: source.id, to_account_id: destination.id, amount: 5,
        date: today, recurrence: { frequency: 'daily', start_date: today, end_mode: 'count', max_occurrences: 1 },
      }});
      db.prepare('UPDATE accounts SET active = 0 WHERE id = ?').run(destination.id);
      const failedRun = await runnerAt(today).runOnce();
      assert.strictEqual(failedRun.failed, 1);
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transfers t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ?`).get(retry.body.recurring_series_id).count, 0);
      db.prepare('UPDATE accounts SET active = 1 WHERE id = ?').run(destination.id);
      const failedOccurrence = db.prepare('SELECT id FROM recurring_occurrences WHERE series_id = ?')
        .get(retry.body.recurring_series_id);
      runnerAt(today).manualRetry(failedOccurrence.id, owner.user.id);
      assert.strictEqual((await runnerAt(today).runOnce()).processed, 1);
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transfers t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ?`).get(retry.body.recurring_series_id).count, 1);
    });

    await test('backup export and restore preserve transfer templates and occurrence links', async () => {
      const exported = await request('/api/backup', { cookie: owner.cookie });
      assert.strictEqual(exported.status, 200);
      assert.ok(exported.body.recurring_transfer_templates.length > 0);
      assert.ok(exported.body.transfers.some(row => row.recurring_occurrence_id != null));
      const restored = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: owner.cookie, body: exported.body,
      });
      assert.strictEqual(restored.status, 200);
      assert.strictEqual(db.pragma('foreign_key_check').length, 0);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  if (server.listening) server.close();
  if (db.open) db.close();
  process.exitCode = 1;
});
