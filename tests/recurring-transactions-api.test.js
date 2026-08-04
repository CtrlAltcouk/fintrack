const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const { createRecurrenceRunner } = require('../lib/recurrence/runner');

let passed = 0, failed = 0, baseUrl;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed++; }
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
  return { status: response.status, body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function createAndLogin(name, adminCookie) {
  const created = await request('/api/users', {
    method: 'POST', cookie: adminCookie,
    body: { display_name: name, password: 'test-password', colour: '#4a9eff' },
  });
  assert.strictEqual(created.status, 201);
  const login = await request('/api/auth/login', {
    method: 'POST', body: { display_name: name, password: 'test-password' },
  });
  assert.strictEqual(login.status, 200);
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
    retryBaseMs: 10, retryMaxMs: 100, maxAttempts: 3,
  }, { now: () => new Date(`${date}T12:00:00Z`) });
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await recurrenceRunner.stop();
  try {
    const owner = await createAndLogin('Transaction Owner');
    const other = await createAndLogin('Transaction Other', owner.cookie);
    const categories = (await request('/api/categories', { cookie: owner.cookie })).body;
    const category = categories[0];
    const accountResponse = await request('/api/accounts', { method: 'POST', cookie: owner.cookie, body: {
      name: 'Runner current', type: 'current', colour: '#123456', opening_balance: 100,
    }});
    const account = accountResponse.body;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = addDays(today, 1);

    await test('legacy transaction payload remains immediate and response-compatible', async () => {
      const created = await request('/api/transactions', { method: 'POST', cookie: owner.cookie, body: {
        amount: 5, description: 'Legacy transaction', category_id: category.id,
        account_id: account.id, date: today,
      }});
      assert.strictEqual(created.status, 201);
      assert.ok(created.body.id);
      assert.strictEqual(created.body.recurring_series_id, undefined);
      assert.strictEqual(db.prepare('SELECT recurring_occurrence_id FROM transactions WHERE id = ?')
        .get(created.body.id).recurring_occurrence_id, null);
    });

    await test('future recurring transactions never materialize before their due date', async () => {
      const created = await request('/api/transactions', { method: 'POST', cookie: owner.cookie, body: {
        amount: 7, description: 'Future only', category_id: category.id,
        account_id: account.id, date: tomorrow,
        recurrence: { frequency: 'daily', start_date: tomorrow, end_mode: 'count', max_occurrences: 2 },
      }});
      assert.strictEqual(created.status, 201);
      assert.ok(created.body.recurring_series_id);
      await runnerAt(today).runOnce();
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transactions t
        JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
        WHERE ro.series_id = ?`).get(created.body.recurring_series_id).count, 0);
    });

    let dailySeries;
    let generatedId;
    await test('due execution is atomic, concurrent-safe, restart-safe, and balance-correct', async () => {
      const created = await request('/api/transactions', { method: 'POST', cookie: owner.cookie, body: {
        amount: 10, description: 'Daily runner', category_id: category.id,
        account_id: account.id, date: today,
        recurrence: { frequency: 'daily', start_date: today, end_mode: 'never' },
      }});
      dailySeries = created.body.recurring_series_id;
      const runner = runnerAt(today);
      const [first, overlap] = await Promise.all([runner.runOnce(), runner.runOnce()]);
      assert.strictEqual(first.processed + overlap.processed, 1);
      await runnerAt(today).runOnce();
      const rows = db.prepare(`SELECT t.* FROM transactions t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ?`).all(dailySeries);
      assert.strictEqual(rows.length, 1);
      generatedId = rows[0].id;
      const balance = (await request('/api/accounts', { cookie: owner.cookie })).body
        .find(row => row.id === account.id).balance;
      assert.strictEqual(balance, 85);
    });

    await test('single and future edits preserve history and update only the template when requested', async () => {
      const single = await request(`/api/transactions/${generatedId}`, {
        method: 'PUT', cookie: owner.cookie,
        body: { amount: 11, description: 'Single override', category_id: category.id, scope: 'single' },
      });
      assert.strictEqual(single.status, 200);
      assert.strictEqual(db.prepare('SELECT amount FROM recurring_transaction_templates WHERE recurring_series_id = ?')
        .get(dailySeries).amount, 10);
      const future = await request(`/api/transactions/${generatedId}`, {
        method: 'PUT', cookie: owner.cookie,
        body: { amount: 12, description: 'Future override', category_id: category.id, scope: 'future' },
      });
      assert.strictEqual(future.status, 200);
      assert.strictEqual(db.prepare('SELECT amount FROM recurring_transaction_templates WHERE recurring_series_id = ?')
        .get(dailySeries).amount, 12);
      await runnerAt(tomorrow).runOnce();
      const amounts = db.prepare(`SELECT t.amount FROM transactions t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ? ORDER BY t.date`).all(dailySeries);
      assert.deepStrictEqual(amounts.map(row => row.amount), [12, 12]);
    });

    await test('pause, resume, skip next, and stop preserve generated history', async () => {
      let response = await request(`/api/recurring/${dailySeries}/pause`, {
        method: 'POST', cookie: owner.cookie,
      });
      assert.strictEqual(response.status, 200);
      response = await request(`/api/recurring/${dailySeries}/resume`, {
        method: 'POST', cookie: owner.cookie, body: { resume_date: addDays(tomorrow, 1) },
      });
      assert.strictEqual(response.status, 200);
      response = await request(`/api/recurring/${dailySeries}/skip-next`, {
        method: 'POST', cookie: owner.cookie,
      });
      assert.strictEqual(response.status, 200);
      response = await request(`/api/recurring/${dailySeries}/stop`, {
        method: 'POST', cookie: owner.cookie,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_series WHERE id = ?').get(dailySeries).status, 'deleted');
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transactions t JOIN recurring_occurrences ro
        ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ?`).get(dailySeries).count, 2);
    });

    await test('deleting a generated row marks its occurrence deleted and ownership remains enforced', async () => {
      const occurrenceId = db.prepare('SELECT recurring_occurrence_id FROM transactions WHERE id = ?')
        .get(generatedId).recurring_occurrence_id;
      const removed = await request(`/api/transactions/${generatedId}`, {
        method: 'DELETE', cookie: owner.cookie,
      });
      assert.strictEqual(removed.status, 204);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(occurrenceId).status, 'deleted');
      await runnerAt(addDays(today, 10)).runOnce();
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE recurring_occurrence_id = ?')
        .get(occurrenceId).count, 0);

      const forbidden = await request('/api/transactions', { method: 'POST', cookie: other.cookie, body: {
        amount: 5, description: 'Cross-user', category_id: category.id, account_id: account.id,
        date: today, recurrence: { frequency: 'monthly', start_date: today, end_mode: 'never' },
      }});
      assert.strictEqual(forbidden.status, 404);
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
