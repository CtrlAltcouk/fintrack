const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { server } = require('../server');
const db = require('../db');

let passed = 0, failed = 0, baseUrl;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
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
  return login.cookie;
}

async function billReferences(cookie) {
  const categories = await request('/api/categories', { cookie });
  let accounts = await request('/api/accounts', { cookie });
  if (!accounts.body.length) {
    await request('/api/accounts', { method: 'POST', cookie, body: {
      name: 'Current', type: 'current', colour: '#123456', opening_balance: 0,
    }});
    accounts = await request('/api/accounts', { cookie });
  }
  return { category: categories.body[0], account: accounts.body[0] };
}

async function createBill(cookie, refs, overrides = {}) {
  return request('/api/bills', { method: 'POST', cookie, body: {
    name: overrides.name ?? 'Recurring bill', amount: 25,
    due_day: overrides.due_day ?? 1,
    category_id: refs.category.id, account_id: refs.account.id,
    ...(overrides.recurrence ? { recurrence: overrides.recurrence } : {}),
  }});
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const ownerCookie = await createAndLogin('Recurring Owner');
    const otherCookie = await createAndLogin('Recurring Other', ownerCookie);
    const refs = await billReferences(ownerCookie);

    await test('legacy bill payload remains monthly and payment endpoint is unchanged', async () => {
      const created = await createBill(ownerCookie, refs, { name: 'Legacy monthly', due_day: 31 });
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.body.recurrence.frequency, 'monthly');
      const now = new Date();
      const listed = await request(`/api/bills?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, { cookie: ownerCookie });
      const bill = listed.body.find(row => row.id === created.body.id);
      assert.ok(bill?.bill_month_id);
      const paid = await request(`/api/bill-months/${bill.bill_month_id}/pay`, {
        method: 'POST', cookie: ownerCookie, body: { amount_paid: 24.5 },
      });
      assert.strictEqual(paid.status, 200);
      assert.strictEqual(paid.body.amount_paid, 24.5);
    });

    await test('daily recurrence materializes exactly once and obeys occurrence count', async () => {
      const created = await createBill(ownerCookie, refs, { name: 'Daily three', recurrence: {
        frequency: 'daily', start_date: '2026-08-01', end_mode: 'count', max_occurrences: 3,
      }});
      assert.strictEqual(created.status, 201);
      const first = await request('/api/bills/by-range?from=2026-08-01&to=2026-08-10', { cookie: ownerCookie });
      const second = await request('/api/bills/by-range?from=2026-08-01&to=2026-08-10', { cookie: ownerCookie });
      assert.strictEqual(first.body.filter(row => row.id === created.body.id && row.due_date).length, 3);
      assert.strictEqual(second.body.filter(row => row.id === created.body.id && row.due_date).length, 3);
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM bill_months WHERE bill_id = ?').get(created.body.id).count, 3);
    });

    await test('fortnightly occurrence can be skipped without affecting the rest', async () => {
      const created = await createBill(ownerCookie, refs, { name: 'Fortnight skip', recurrence: {
        frequency: 'fortnightly', start_date: '2026-09-01', end_mode: 'count', max_occurrences: 3,
      }});
      const skipped = await request(`/api/recurring/${created.body.recurring_series_id}/skip`, {
        method: 'POST', cookie: ownerCookie, body: { date: '2026-09-15' },
      });
      assert.strictEqual(skipped.status, 200);
      const rows = await request('/api/bills/by-range?from=2026-09-01&to=2026-10-01', { cookie: ownerCookie });
      assert.deepStrictEqual(rows.body.filter(row => row.id === created.body.id && row.due_date).map(row => row.due_date),
        ['2026-09-01', '2026-09-29']);
    });

    await test('pause and resume preserve the series and ownership', async () => {
      const created = await createBill(ownerCookie, refs, { name: 'Pause bill', recurrence: {
        frequency: 'quarterly', start_date: '2099-10-05', end_mode: 'never',
      }});
      await request('/api/bills/by-range?from=2099-10-01&to=2099-10-31', { cookie: ownerCookie });
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM bill_months WHERE bill_id = ?').get(created.body.id).count, 1);
      const denied = await request(`/api/recurring/${created.body.recurring_series_id}/pause`, {
        method: 'POST', cookie: otherCookie,
      });
      assert.strictEqual(denied.status, 404);
      const paused = await request(`/api/recurring/${created.body.recurring_series_id}/pause`, {
        method: 'POST', cookie: ownerCookie,
      });
      assert.strictEqual(paused.status, 200);
      assert.strictEqual(paused.body.status, 'paused');
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM bill_months WHERE bill_id = ?').get(created.body.id).count, 0);
      const resumed = await request(`/api/recurring/${created.body.recurring_series_id}/resume`, {
        method: 'POST', cookie: ownerCookie,
      });
      assert.strictEqual(resumed.status, 200);
      assert.strictEqual(resumed.body.status, 'active');
      const regenerated = await request('/api/bills/by-range?from=2099-10-01&to=2099-10-31', { cookie: ownerCookie });
      assert.strictEqual(regenerated.body.filter(row => row.id === created.body.id && row.due_date).length, 1);
    });

    await test('cancelling a bill soft-deletes its series and preserves occurrences', async () => {
      const created = await createBill(ownerCookie, refs, { name: 'Cancel series', recurrence: {
        frequency: 'yearly', start_date: '2026-11-10', end_mode: 'never',
      }});
      await request('/api/bills/by-range?from=2026-11-01&to=2026-11-30', { cookie: ownerCookie });
      const before = db.prepare('SELECT COUNT(*) AS count FROM bill_months WHERE bill_id = ?').get(created.body.id).count;
      const cancelled = await request(`/api/bills/${created.body.id}/cancel`, { method: 'PATCH', cookie: ownerCookie });
      assert.strictEqual(cancelled.status, 200);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_series WHERE id = ?').get(created.body.recurring_series_id).status, 'deleted');
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM bill_months WHERE bill_id = ?').get(created.body.id).count, before);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (db.open) db.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
