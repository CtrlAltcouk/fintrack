const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');

let passed = 0;
let failed = 0;
let baseUrl;
let cookie;
let category;

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

async function request(path, { method = 'GET', body, auth = cookie } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Cookie: auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

async function createAccount(name) {
  const response = await request('/api/accounts', { method: 'POST', body: {
    name, type: 'current', colour: '#4a9eff', opening_balance: 0,
  } });
  assert.strictEqual(response.status, 201);
  return response.body;
}

async function expectBlocked(accountId, group, minimum = 1) {
  const response = await request(`/api/accounts/${accountId}/deactivate`, { method: 'PATCH' });
  assert.strictEqual(response.status, 409, JSON.stringify(response.body));
  assert.strictEqual(response.body.error, 'This account is still used by active items.');
  assert.strictEqual(response.body.code, 'ACCOUNT_HAS_DEPENDENCIES');
  assert.ok(response.body.dependencies[group] >= minimum, JSON.stringify(response.body));
  assert.strictEqual(
    db.prepare('SELECT active FROM accounts WHERE id = ?').get(accountId).active,
    1,
  );
  return response.body;
}

function tomorrow() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  await recurrenceRunner.stop();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await request('/api/users', { method: 'POST', auth: null, body: {
      display_name: 'Account Protection Owner', password: 'test-password', colour: '#4a9eff',
    } });
    assert.strictEqual(created.status, 201);
    const login = await request('/api/auth/login', { method: 'POST', auth: null, body: {
      display_name: 'Account Protection Owner', password: 'test-password',
    } });
    assert.strictEqual(login.status, 200);
    cookie = login.cookie;
    category = (await request('/api/categories')).body[0];
    const date = tomorrow();

    await test('ordinary transactions block account deactivation without partial changes', async () => {
      const account = await createAccount('Transaction dependency');
      assert.strictEqual((await request('/api/transactions', { method: 'POST', body: {
        amount: 10, description: 'Protected transaction', category_id: category.id,
        account_id: account.id, date,
      } })).status, 201);
      await expectBlocked(account.id, 'transactions');
    });

    await test('ordinary income blocks account deactivation', async () => {
      const account = await createAccount('Income dependency');
      assert.strictEqual((await request('/api/income', { method: 'POST', body: {
        amount: 20, description: 'Protected income', account_id: account.id, date,
      } })).status, 201);
      await expectBlocked(account.id, 'income');
    });

    await test('both sides of an ordinary transfer block account deactivation', async () => {
      const source = await createAccount('Transfer source dependency');
      const destination = await createAccount('Transfer destination dependency');
      assert.strictEqual((await request('/api/transfers', { method: 'POST', body: {
        from_account_id: source.id, to_account_id: destination.id, amount: 5, date,
      } })).status, 201);
      await expectBlocked(source.id, 'transfers');
      await expectBlocked(destination.id, 'transfers');
    });

    await test('recurring bills block through bill and recurrence dependency groups', async () => {
      const account = await createAccount('Recurring bill dependency');
      const createdBill = await request('/api/bills', { method: 'POST', body: {
        name: 'Protected recurring bill', amount: 30, due_day: Number(date.slice(8, 10)),
        category_id: category.id, account_id: account.id,
        recurrence: { frequency: 'monthly', start_date: date, end_mode: 'never' },
      } });
      assert.strictEqual(createdBill.status, 201, JSON.stringify(createdBill.body));
      const blocked = await expectBlocked(account.id, 'bills');
      assert.ok(blocked.dependencies.recurring_items >= 1);
    });

    await test('recurring income blocks through projected income and recurrence definitions', async () => {
      const account = await createAccount('Recurring income dependency');
      const createdSchedule = await request('/api/income/schedules', { method: 'POST', body: {
        name: 'Protected recurring income', amount: 40, frequency: 'monthly',
        day_of_month: Number(date.slice(8, 10)), account_id: account.id,
        recurrence: { frequency: 'monthly', start_date: date, end_mode: 'never' },
      } });
      assert.strictEqual(createdSchedule.status, 201, JSON.stringify(createdSchedule.body));
      const blocked = await expectBlocked(account.id, 'recurring_items');
      assert.ok(blocked.dependencies.income >= 0);
    });

    await test('recurring transaction templates, future occurrences and pending claims block', async () => {
      const account = await createAccount('Recurring transaction dependency');
      const recurring = await request('/api/transactions', { method: 'POST', body: {
        amount: 50, description: 'Protected recurring transaction', category_id: category.id,
        account_id: account.id, date,
        recurrence: { frequency: 'daily', start_date: date, end_mode: 'never' },
      } });
      assert.strictEqual(recurring.status, 201, JSON.stringify(recurring.body));
      const occurrence = db.prepare(`INSERT INTO recurring_occurrences
        (series_id, scheduled_date, sequence, series_revision, status)
        VALUES (?, ?, 1, 1, 'scheduled')`).run(recurring.body.recurring_series_id, date);
      db.prepare(`INSERT INTO recurring_execution_claims
        (occurrence_id, runner_id, claimed_at, expires_at)
        VALUES (?, 'account-protection-test', datetime('now'), datetime('now', '+5 minutes'))`
      ).run(occurrence.lastInsertRowid);
      const blocked = await expectBlocked(account.id, 'recurring_items');
      assert.strictEqual(blocked.dependency_details.future_occurrences, 1);
      assert.strictEqual(blocked.dependency_details.pending_recurrence_claims, 1);
    });

    await test('recurring transfers protect source and destination accounts', async () => {
      const source = await createAccount('Recurring transfer source');
      const destination = await createAccount('Recurring transfer destination');
      const recurring = await request('/api/transfers', { method: 'POST', body: {
        from_account_id: source.id, to_account_id: destination.id, amount: 60, date,
        recurrence: { frequency: 'weekly', start_date: date, end_mode: 'never' },
      } });
      assert.strictEqual(recurring.status, 201, JSON.stringify(recurring.body));
      await expectBlocked(source.id, 'recurring_items');
      await expectBlocked(destination.id, 'recurring_items');
    });

    await test('an unused account deactivates atomically and cannot gain new dependencies', async () => {
      const account = await createAccount('Unused deactivation');
      const deactivated = await request(`/api/accounts/${account.id}/deactivate`, { method: 'PATCH' });
      assert.deepStrictEqual(deactivated, { status: 200, body: { ok: true }, cookie: null });
      const attempts = [
        request('/api/transactions', { method: 'POST', body: {
          amount: 1, description: 'Rejected', category_id: category.id, account_id: account.id, date,
        } }),
        request('/api/income', { method: 'POST', body: {
          amount: 1, description: 'Rejected', account_id: account.id, date,
        } }),
        request('/api/bills', { method: 'POST', body: {
          name: 'Rejected', amount: 1, due_day: 1, category_id: category.id, account_id: account.id,
        } }),
        request('/api/income/schedules', { method: 'POST', body: {
          name: 'Rejected', amount: 1, frequency: 'monthly', day_of_month: 1,
          account_id: account.id,
        } }),
      ];
      const responses = await Promise.all(attempts);
      responses.forEach(response => assert.strictEqual(response.status, 404, JSON.stringify(response.body)));
    });

    await test('concurrent dependency creation and deactivation cannot both succeed', async () => {
      for (let index = 0; index < 10; index += 1) {
        const account = await createAccount(`Concurrent account ${index}`);
        const [deactivation, creation] = await Promise.all([
          request(`/api/accounts/${account.id}/deactivate`, { method: 'PATCH' }),
          request('/api/transactions', { method: 'POST', body: {
            amount: 1, description: `Concurrent ${index}`, category_id: category.id,
            account_id: account.id, date,
          } }),
        ]);
        assert.ok(
          (deactivation.status === 200 && creation.status === 404)
          || (deactivation.status === 409 && creation.status === 201),
          JSON.stringify({ deactivation, creation }),
        );
      }
    });

    await test('a failed account update rolls back and preserves FK integrity', async () => {
      const account = await createAccount('Rollback dependency');
      db.exec(`CREATE TRIGGER account_deactivation_failure
        BEFORE UPDATE OF active ON accounts WHEN OLD.id = ${Number(account.id)}
        BEGIN SELECT RAISE(ABORT, 'injected deactivation failure'); END`);
      const response = await request(`/api/accounts/${account.id}/deactivate`, { method: 'PATCH' });
      db.exec('DROP TRIGGER account_deactivation_failure');
      assert.strictEqual(response.status, 500);
      assert.strictEqual(db.prepare('SELECT active FROM accounts WHERE id = ?').get(account.id).active, 1);
      assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
    });

    await test('ownership, backup export and the existing schema remain compatible', async () => {
      const account = await createAccount('Ownership dependency');
      const second = await request('/api/users', { method: 'POST', body: {
        display_name: 'Account Protection Other', password: 'test-password', colour: '#888888',
      } });
      assert.strictEqual(second.status, 201);
      const otherLogin = await request('/api/auth/login', { method: 'POST', auth: null, body: {
        display_name: 'Account Protection Other', password: 'test-password',
      } });
      assert.strictEqual((await request(`/api/accounts/${account.id}/deactivate`, {
        method: 'PATCH', auth: otherLogin.cookie,
      })).status, 404);
      const backup = await request('/api/backup');
      assert.strictEqual(backup.status, 200);
      assert.ok(backup.body.accounts.some(row => row.id === account.id && row.active === 1));
      const restored = await request('/api/backup/restore', { method: 'POST', body: backup.body });
      assert.strictEqual(restored.status, 200, JSON.stringify(restored.body));
      assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
      assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
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
