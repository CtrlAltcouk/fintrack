const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const { MONEY_MAX_ABS } = require('../lib/finance-validation');

let passed = 0, failed = 0, baseUrl, cookie, account, otherAccount, category;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}
async function request(path, { method = 'GET', body, auth = cookie } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Cookie: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}
function snapshot() {
  return {
    transactions: db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count,
    income: db.prepare('SELECT COUNT(*) AS count FROM income').get().count,
    bills: db.prepare('SELECT COUNT(*) AS count FROM bills').get().count,
    transfers: db.prepare('SELECT COUNT(*) AS count FROM transfers').get().count,
    series: db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count,
    occurrences: db.prepare('SELECT COUNT(*) AS count FROM recurring_occurrences').get().count,
  };
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  await recurrenceRunner.stop();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await request('/api/users', { method: 'POST', auth: null,
      body: { display_name: 'Finance Validator', password: 'test-password', colour: '#123456' } });
    assert.strictEqual(created.status, 201);
    const login = await request('/api/auth/login', { method: 'POST', auth: null,
      body: { display_name: 'Finance Validator', password: 'test-password' } });
    cookie = login.cookie;
    category = (await request('/api/categories')).body[0];
    account = (await request('/api/accounts')).body[0];
    otherAccount = (await request('/api/accounts', { method: 'POST', body: {
      name: 'Finance savings', type: 'savings', colour: '#654321', opening_balance: '-500.25',
    } })).body;
    const today = '2026-08-02';

    await test('transactions share strict create/edit validation and failures preserve balances', async () => {
      const valid = await request('/api/transactions', { method: 'POST', body: {
        amount: '12.345', description: 'Valid precision', category_id: category.id,
        account_id: account.id, date: today,
      } });
      assert.strictEqual(valid.status, 201);
      assert.strictEqual(valid.body.amount, 12.345);
      const before = snapshot();
      for (const amount of [0, -1, '12junk', 'Infinity', ' ', true, {}, MONEY_MAX_ABS + 1]) {
        const response = await request('/api/transactions', { method: 'POST', body: {
          amount, description: 'Rejected', category_id: category.id, account_id: account.id, date: today,
        } });
        assert.strictEqual(response.status, 400, JSON.stringify({ amount, response }));
        assert.deepStrictEqual(Object.keys(response.body), ['error']);
      }
      const edited = await request(`/api/transactions/${valid.body.id}`, { method: 'PUT', body: {
        amount: '10junk', date: '2026-02-30',
      } });
      assert.strictEqual(edited.status, 400);
      assert.deepStrictEqual(snapshot(), before);
    });

    await test('income and recurring income reject invalid values atomically', async () => {
      const valid = await request('/api/income', { method: 'POST', body: {
        amount: '.75', description: 'Valid income', date: today, account_id: account.id,
      } });
      assert.strictEqual(valid.status, 201);
      const before = snapshot();
      for (const body of [
        { amount: 0, description: 'bad', date: today, account_id: account.id },
        { amount: '10 GBP', description: 'bad', date: today, account_id: account.id },
        { amount: 10, description: 'bad', date: '2026-13-01', account_id: account.id },
        { amount: 10, description: 'bad', date: today, account_id: '1junk' },
      ]) assert.strictEqual((await request('/api/income', { method: 'POST', body })).status, 400);
      const recurring = await request('/api/income/schedules', { method: 'POST', body: {
        name: 'Bad schedule', amount: '-1', frequency: 'monthly', day_of_month: 2,
        account_id: account.id, recurrence: { frequency: 'monthly', start_date: today,
          end_mode: 'count', max_occurrences: true },
      } });
      assert.strictEqual(recurring.status, 400);
      assert.deepStrictEqual(snapshot(), before);
    });

    let billMonthId;
    await test('bills reject malformed inputs while partial payments and existing overpayment remain valid', async () => {
      const invalidBefore = snapshot();
      const invalid = await request('/api/bills', { method: 'POST', body: {
        name: 'Invalid bill', amount: '1.2.3', due_day: 2,
        category_id: category.id, account_id: account.id,
      } });
      assert.strictEqual(invalid.status, 400);
      assert.deepStrictEqual(snapshot(), invalidBefore);
      const valid = await request('/api/bills', { method: 'POST', body: {
        name: 'Payment policy', amount: '50', due_day: 2,
        category_id: category.id, account_id: account.id,
      } });
      assert.strictEqual(valid.status, 201);
      const rows = (await request('/api/bills?year=2026&month=8')).body;
      billMonthId = rows.find(row => row.id === valid.body.id).bill_month_id;
      for (const amount_paid of [0, -2, '12junk']) {
        assert.strictEqual((await request(`/api/bill-months/${billMonthId}/pay`, {
          method: 'POST', body: { amount_paid },
        })).status, 400);
        assert.strictEqual(db.prepare('SELECT paid FROM bill_months WHERE id=?').get(billMonthId).paid, 0);
      }
      const partial = await request(`/api/bill-months/${billMonthId}/pay`, {
        method: 'POST', body: { amount_paid: '25.50' },
      });
      assert.strictEqual(partial.status, 200);
      assert.strictEqual(partial.body.amount_paid, 25.5);
      const overpay = await request(`/api/bill-months/${billMonthId}/pay`, {
        method: 'POST', body: { amount_paid: '75' },
      });
      assert.strictEqual(overpay.status, 200);
      assert.strictEqual(overpay.body.amount_paid, 75);
    });

    await test('transfers and recurring transfer templates use identical strict validation', async () => {
      const before = snapshot();
      for (const body of [
        { from_account_id: account.id, to_account_id: otherAccount.id, amount: 0, date: today },
        { from_account_id: account.id, to_account_id: account.id, amount: 10, date: today },
        { from_account_id: '1junk', to_account_id: otherAccount.id, amount: 10, date: today },
        { from_account_id: account.id, to_account_id: otherAccount.id, amount: '10junk', date: today },
        { from_account_id: account.id, to_account_id: otherAccount.id, amount: 10, date: '2026-02-30' },
      ]) assert.strictEqual((await request('/api/transfers', { method: 'POST', body })).status, 400);
      const recurring = await request('/api/transfers', { method: 'POST', body: {
        from_account_id: account.id, to_account_id: otherAccount.id, amount: -1, date: today,
        recurrence: { frequency: 'daily', start_date: today, end_mode: 'never' },
      } });
      assert.strictEqual(recurring.status, 400);
      assert.deepStrictEqual(snapshot(), before);
    });

    await test('accounts preserve valid negative opening balances and reject non-finite or excessive values', async () => {
      assert.strictEqual(otherAccount.opening_balance, -500.25);
      for (const opening_balance of ['Infinity', '12junk', true, MONEY_MAX_ABS + 1]) {
        const response = await request('/api/accounts', { method: 'POST', body: {
          name: 'Rejected account', type: 'current', colour: '#123456', opening_balance,
        } });
        assert.strictEqual(response.status, 400);
      }
      const response = await request(`/api/accounts/${otherAccount.id}`, { method: 'PATCH', body: {
        opening_balance: '-0',
      } });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(Object.is(response.body.opening_balance, -0), false);
    });

    await test('recurrence dates and occurrence counts reject invalid values without partial rows', async () => {
      const before = snapshot();
      for (const recurrence of [
        { frequency: 'daily', start_date: '2026-02-30', end_mode: 'never' },
        { frequency: 'daily', start_date: today, end_mode: 'date', end_date: '2026-08-01' },
        { frequency: 'daily', start_date: today, end_mode: 'count', max_occurrences: '2junk' },
        { frequency: 'daily', start_date: today, end_mode: 'count', max_occurrences: 10001 },
      ]) {
        const response = await request('/api/transactions', { method: 'POST', body: {
          amount: 5, description: 'Bad recurrence', category_id: category.id,
          account_id: account.id, date: today, recurrence,
        } });
        assert.strictEqual(response.status, 400);
      }
      assert.deepStrictEqual(snapshot(), before);
    });

    await test('restore rejects malformed finance semantics before replacement and preserves the database', async () => {
      const exported = await request('/api/backup');
      assert.strictEqual(exported.status, 200);
      const before = snapshot();
      const malformed = structuredClone(exported.body);
      malformed.transactions[0].amount = '12junk';
      assert.strictEqual((await request('/api/backup/restore', { method: 'POST', body: malformed })).status, 400);
      assert.deepStrictEqual(snapshot(), before);
      const impossible = structuredClone(exported.body);
      impossible.transactions[0].date = '2026-02-30';
      assert.strictEqual((await request('/api/backup/restore', { method: 'POST', body: impossible })).status, 400);
      assert.deepStrictEqual(snapshot(), before);
    });
  } finally {
    await recurrenceRunner.stop();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
