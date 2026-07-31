const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { server } = require('../server');
const db = require('../db');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
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

async function createUser(displayName, cookie) {
  return request('/api/users', {
    method: 'POST',
    cookie,
    body: { display_name: displayName, password: 'test-password', colour: '#4a9eff' },
  });
}

async function login(displayName) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { display_name: displayName, password: 'test-password' },
  });
  assert.strictEqual(response.status, 200);
  assert.ok(response.cookie);
  return response.cookie;
}

let baseUrl;

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const createdA = await createUser('Owner A');
    assert.strictEqual(createdA.status, 201);
    const cookieA = await login('Owner A');
    const createdB = await createUser('Owner B', cookieA);
    assert.strictEqual(createdB.status, 201);
    const cookieB = await login('Owner B');

    const [accountsAResponse, accountsBResponse, categoriesAResponse, categoriesBResponse] = await Promise.all([
      request('/api/accounts', { cookie: cookieA }),
      request('/api/accounts', { cookie: cookieB }),
      request('/api/categories', { cookie: cookieA }),
      request('/api/categories', { cookie: cookieB }),
    ]);
    const accountA = accountsAResponse.body[0];
    const accountB = accountsBResponse.body[0];
    const categoryA = categoriesAResponse.body[0];
    const categoryB = categoriesBResponse.body[0];

    await test('user A cannot create a transaction against user B account', async () => {
      const response = await request('/api/transactions', {
        method: 'POST', cookie: cookieA,
        body: { amount: 10, description: 'cross account', category_id: categoryA.id, account_id: accountB.id, date: '2026-07-01' },
      });
      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.error, 'account not found');
    });

    await test('user A cannot create or edit a transaction with user B category', async () => {
      const create = await request('/api/transactions', {
        method: 'POST', cookie: cookieA,
        body: { amount: 5, description: 'valid transaction', category_id: categoryA.id, account_id: accountA.id, date: '2026-07-02' },
      });
      assert.strictEqual(create.status, 201);
      const crossCreate = await request('/api/transactions', {
        method: 'POST', cookie: cookieA,
        body: { amount: 5, description: 'cross category', category_id: categoryB.id, account_id: accountA.id, date: '2026-07-02' },
      });
      assert.strictEqual(crossCreate.status, 404);
      const crossEdit = await request(`/api/transactions/${create.body.id}`, {
        method: 'PUT', cookie: cookieA,
        body: { category_id: categoryB.id },
      });
      assert.strictEqual(crossEdit.status, 404);
    });

    await test('user A cannot create a bill with user B account or category', async () => {
      const baseBill = { name: 'Ownership bill', amount: 25, due_day: 10 };
      const crossAccount = await request('/api/bills', {
        method: 'POST', cookie: cookieA,
        body: { ...baseBill, category_id: categoryA.id, account_id: accountB.id },
      });
      assert.strictEqual(crossAccount.status, 404);
      const crossCategory = await request('/api/bills', {
        method: 'POST', cookie: cookieA,
        body: { ...baseBill, category_id: categoryB.id, account_id: accountA.id },
      });
      assert.strictEqual(crossCategory.status, 404);
    });

    await test('user A cannot cancel or pay user B bill', async () => {
      const created = await request('/api/bills', {
        method: 'POST', cookie: cookieB,
        body: { name: 'Owner B bill', amount: 40, due_day: 12, category_id: categoryB.id, account_id: accountB.id },
      });
      assert.strictEqual(created.status, 201);
      const cancel = await request(`/api/bills/${created.body.id}/cancel`, { method: 'PATCH', cookie: cookieA });
      assert.strictEqual(cancel.status, 404);

      const now = new Date();
      const listed = await request(`/api/bills?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { cookie: cookieB });
      const occurrence = listed.body.find(row => row.id === created.body.id);
      assert.ok(occurrence?.bill_month_id);
      const pay = await request(`/api/bill-months/${occurrence.bill_month_id}/pay`, {
        method: 'POST', cookie: cookieA, body: { amount_paid: 40 },
      });
      assert.strictEqual(pay.status, 404);
    });

    await test('user A cannot create income against user B account', async () => {
      const response = await request('/api/income', {
        method: 'POST', cookie: cookieA,
        body: { amount: 30, description: 'cross income', account_id: accountB.id, date: '2026-07-01' },
      });
      assert.strictEqual(response.status, 404);
    });

    let scheduleA;
    let scheduleB;
    await test('user A cannot create or edit a schedule against user B account', async () => {
      const crossCreate = await request('/api/income/schedules', {
        method: 'POST', cookie: cookieA,
        body: { name: 'Cross schedule', amount: 100, frequency: 'monthly', day_of_month: 25, account_id: accountB.id },
      });
      assert.strictEqual(crossCreate.status, 404);
      const validA = await request('/api/income/schedules', {
        method: 'POST', cookie: cookieA,
        body: { name: 'Owner A schedule', amount: 100, frequency: 'monthly', day_of_month: 25, account_id: accountA.id },
      });
      assert.strictEqual(validA.status, 201);
      scheduleA = validA.body;
      const crossEdit = await request(`/api/income/schedules/${scheduleA.id}`, {
        method: 'PATCH', cookie: cookieA,
        body: { name: 'Owner A schedule', amount: 100, frequency: 'monthly', day_of_month: 25, account_id: accountB.id },
      });
      assert.strictEqual(crossEdit.status, 404);

      const validB = await request('/api/income/schedules', {
        method: 'POST', cookie: cookieB,
        body: { name: 'Owner B schedule', amount: 200, frequency: 'monthly', day_of_month: 26, account_id: accountB.id },
      });
      assert.strictEqual(validB.status, 201);
      scheduleB = validB.body;
    });

    await test('user A cannot edit or deactivate user B schedule ID', async () => {
      const edit = await request(`/api/income/schedules/${scheduleB.id}`, {
        method: 'PATCH', cookie: cookieA,
        body: { name: 'Cross schedule edit', amount: 200, frequency: 'monthly', day_of_month: 26, account_id: accountA.id },
      });
      assert.strictEqual(edit.status, 404);
      const deactivate = await request(`/api/income/schedules/${scheduleB.id}/deactivate`, {
        method: 'PATCH', cookie: cookieA,
      });
      assert.strictEqual(deactivate.status, 404);
    });

    await test('user A cannot select user B schedule as the primary schedule', async () => {
      const response = await request('/api/settings/pay-period', {
        method: 'POST', cookie: cookieA,
        body: { primary_schedule_id: scheduleB.id },
      });
      assert.strictEqual(response.status, 404);
      const valid = await request('/api/settings/pay-period', {
        method: 'POST', cookie: cookieA,
        body: { primary_schedule_id: scheduleA.id },
      });
      assert.strictEqual(valid.status, 200);
    });

    let secondAccountA;
    await test('transfers reject either cross-user endpoint and allow same-user accounts', async () => {
      const accountResponse = await request('/api/accounts', {
        method: 'POST', cookie: cookieA,
        body: { name: 'Owner A savings', type: 'savings', colour: '#abcdef', opening_balance: 0 },
      });
      assert.strictEqual(accountResponse.status, 201);
      secondAccountA = accountResponse.body;
      for (const [from, to] of [[accountB.id, accountA.id], [accountA.id, accountB.id]]) {
        const rejected = await request('/api/transfers', {
          method: 'POST', cookie: cookieA,
          body: { from_account_id: from, to_account_id: to, amount: 10, date: '2026-07-03' },
        });
        assert.strictEqual(rejected.status, 404);
      }
      const valid = await request('/api/transfers', {
        method: 'POST', cookie: cookieA,
        body: { from_account_id: accountA.id, to_account_id: secondAccountA.id, amount: 10, date: '2026-07-03' },
      });
      assert.strictEqual(valid.status, 201);
      assert.strictEqual(valid.body.user_id, createdA.body.id);
    });

    await test('valid same-user income and bill requests continue to work', async () => {
      const income = await request('/api/income', {
        method: 'POST', cookie: cookieA,
        body: { amount: 30, description: 'valid income', account_id: accountA.id, date: '2026-07-01' },
      });
      assert.strictEqual(income.status, 201);
      const bill = await request('/api/bills', {
        method: 'POST', cookie: cookieA,
        body: { name: 'Valid bill', amount: 25, due_day: 10, category_id: categoryA.id, account_id: accountA.id },
      });
      assert.strictEqual(bill.status, 201);
    });

    await test('account balances exclude malformed rows owned by another user', async () => {
      const before = await request('/api/accounts', { cookie: cookieA });
      const beforeBalance = before.body.find(account => account.id === accountA.id).balance;
      db.exec('DROP TRIGGER income_owner_insert');
      db.prepare(`INSERT INTO income (user_id, amount, description, date, account_id)
        VALUES (?, 999, 'malformed cross-user row', '2026-07-01', ?)`).run(createdB.body.id, accountA.id);
      const after = await request('/api/accounts', { cookie: cookieA });
      const afterBalance = after.body.find(account => account.id === accountA.id).balance;
      assert.strictEqual(afterBalance, beforeBalance);
      db.prepare("DELETE FROM income WHERE description = 'malformed cross-user row'").run();
    });

    await test('database ownership triggers reject direct cross-user writes', async () => {
      assert.throws(() => db.prepare(`INSERT INTO transactions
        (user_id, amount, description, category_id, date, account_id)
        VALUES (?, 1, 'direct attack', ?, '2026-07-01', ?)`)
        .run(createdA.body.id, categoryB.id, accountA.id), /ownership violation/);
      assert.throws(() => db.prepare(`INSERT INTO transfers
        (user_id, from_account_id, to_account_id, amount, date)
        VALUES (?, ?, ?, 1, '2026-07-01')`)
        .run(createdA.body.id, accountA.id, accountB.id), /ownership violation/);
    });

    await test('backup restore rejects cross-user references', async () => {
      const exported = await request('/api/backup', { cookie: cookieA });
      assert.strictEqual(exported.status, 200);
      const transaction = exported.body.transactions.find(row => row.user_id === createdA.body.id);
      transaction.account_id = accountB.id;
      const restore = await request('/api/backup/restore?mode=replace', {
        method: 'POST', cookie: cookieA, body: exported.body,
      });
      assert.strictEqual(restore.status, 400);
      assert.match(restore.body.error, /Invalid backup ownership/);
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (db.open) db.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
