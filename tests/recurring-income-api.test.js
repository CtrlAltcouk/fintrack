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

async function account(cookie) {
  let accounts = await request('/api/accounts', { cookie });
  if (!accounts.body.length) {
    await request('/api/accounts', { method: 'POST', cookie, body: {
      name: 'Current', type: 'current', colour: '#123456', opening_balance: 0,
    }});
    accounts = await request('/api/accounts', { cookie });
  }
  return accounts.body[0];
}

async function createSchedule(cookie, accountId, overrides = {}) {
  return request('/api/income/schedules', { method: 'POST', cookie, body: {
    name: overrides.name ?? 'Recurring income', amount: overrides.amount ?? 100,
    frequency: overrides.frequency ?? 'monthly', account_id: accountId,
    ...(overrides.day_of_month == null ? {} : { day_of_month: overrides.day_of_month }),
    ...(overrides.anchor_date == null ? {} : { anchor_date: overrides.anchor_date }),
    ...(overrides.recurrence == null ? {} : { recurrence: overrides.recurrence }),
  }});
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const ownerCookie = await createAndLogin('Income Owner');
    const otherCookie = await createAndLogin('Income Other', ownerCookie);
    const ownerAccount = await account(ownerCookie);

    await test('legacy monthly payload and future projection behaviour remain compatible', async () => {
      const created = await createSchedule(ownerCookie, ownerAccount.id, {
        name: 'Legacy salary', day_of_month: 31,
      });
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.body.frequency, 'monthly');
      assert.strictEqual(created.body.day_of_month, 31);
      assert.strictEqual(created.body.recurrence_frequency, 'monthly');
      const future = await request('/api/income?year=2099&month=2', { cookie: ownerCookie });
      const entry = future.body.find(row => row.source_schedule_id === created.body.id);
      assert.strictEqual(entry.date, '2099-02-28');
      const past = await request('/api/income?year=1999&month=2', { cookie: ownerCookie });
      assert.strictEqual(past.body.some(row => row.source_schedule_id === created.body.id), false);
    });

    await test('all Version 3.2 frequencies create Income series', async () => {
      const cases = [
        ['daily', '2099-01-01'], ['weekly', '2099-01-02'],
        ['fortnightly', '2099-01-03'], ['four_weekly', '2099-01-04'],
        ['quarterly', '2099-01-05'], ['yearly', '2099-01-06'],
      ];
      for (const [frequency, anchorDate] of cases) {
        const created = await createSchedule(ownerCookie, ownerAccount.id, {
          name: `${frequency} income`, frequency, anchor_date: anchorDate,
          recurrence: { frequency, start_date: anchorDate, end_mode: 'count', max_occurrences: 2 },
        });
        assert.strictEqual(created.status, 201, `${frequency}: ${JSON.stringify(created.body)}`);
        assert.strictEqual(created.body.recurrence_frequency, frequency);
      }
      const dated = await createSchedule(ownerCookie, ownerAccount.id, {
        name: 'Dated daily income', frequency: 'daily', anchor_date: '2099-02-01',
        recurrence: {
          frequency: 'daily', start_date: '2099-02-01',
          end_mode: 'date', end_date: '2099-02-03',
        },
      });
      const entries = await request('/api/income?year=2099&month=2', { cookie: ownerCookie });
      assert.deepStrictEqual(
        entries.body.filter(row => row.source_schedule_id === dated.body.id).map(row => row.date).sort(),
        ['2099-02-01', '2099-02-02', '2099-02-03']
      );
    });

    await test('occurrence counts are idempotent and individual income can be skipped', async () => {
      const created = await createSchedule(ownerCookie, ownerAccount.id, {
        name: 'Daily three income', frequency: 'daily', anchor_date: '2099-08-01',
        recurrence: { frequency: 'daily', start_date: '2099-08-01', end_mode: 'count', max_occurrences: 3 },
      });
      const first = await request('/api/income?year=2099&month=8', { cookie: ownerCookie });
      const second = await request('/api/income?year=2099&month=8', { cookie: ownerCookie });
      assert.strictEqual(first.body.filter(row => row.source_schedule_id === created.body.id).length, 3);
      assert.strictEqual(second.body.filter(row => row.source_schedule_id === created.body.id).length, 3);
      const skipped = await request(`/api/recurring/${created.body.recurring_series_id}/skip`, {
        method: 'POST', cookie: ownerCookie, body: { date: '2099-08-02' },
      });
      assert.strictEqual(skipped.status, 200);
      const after = await request('/api/income?year=2099&month=8', { cookie: ownerCookie });
      assert.deepStrictEqual(
        after.body.filter(row => row.source_schedule_id === created.body.id).map(row => row.date).sort(),
        ['2099-08-01', '2099-08-03']
      );
    });

    await test('pause and resume remove and safely regenerate future projections', async () => {
      const created = await createSchedule(ownerCookie, ownerAccount.id, {
        name: 'Paused income', frequency: 'weekly', anchor_date: '2099-09-04',
      });
      await request('/api/income?year=2099&month=9', { cookie: ownerCookie });
      assert.ok(db.prepare('SELECT COUNT(*) AS count FROM income WHERE source_schedule_id = ?').get(created.body.id).count > 0);
      const denied = await request(`/api/recurring/${created.body.recurring_series_id}/pause`, {
        method: 'POST', cookie: otherCookie,
      });
      assert.strictEqual(denied.status, 404);
      const paused = await request(`/api/recurring/${created.body.recurring_series_id}/pause`, {
        method: 'POST', cookie: ownerCookie,
      });
      assert.strictEqual(paused.body.status, 'paused');
      assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM income WHERE source_schedule_id = ?').get(created.body.id).count, 0);
      const resumed = await request(`/api/recurring/${created.body.recurring_series_id}/resume`, {
        method: 'POST', cookie: ownerCookie,
      });
      assert.strictEqual(resumed.body.status, 'active');
      const regenerated = await request('/api/income?year=2099&month=9', { cookie: ownerCookie });
      assert.ok(regenerated.body.some(row => row.source_schedule_id === created.body.id));
    });

    await test('editing supports every schedule field while preserving historical income', async () => {
      const secondAccount = await request('/api/accounts', { method: 'POST', cookie: ownerCookie, body: {
        name: 'Income Savings', type: 'savings', colour: '#654321', opening_balance: 0,
      }});
      assert.strictEqual(secondAccount.status, 201);
      const created = await createSchedule(ownerCookie, ownerAccount.id, {
        name: 'Editable income', frequency: 'monthly', day_of_month: 10,
        recurrence: { frequency: 'monthly', start_date: '2026-07-10', end_mode: 'never' },
      });
      const historicalOccurrence = Number(db.prepare(`INSERT INTO recurring_occurrences
        (series_id, scheduled_date, sequence, series_revision, status)
        VALUES (?, '2026-07-10', 1, 1, 'generated')`).run(created.body.recurring_series_id).lastInsertRowid);
      const historicalIncome = Number(db.prepare(`INSERT INTO income
        (user_id, amount, description, date, account_id, source_schedule_id, recurring_occurrence_id)
        SELECT user_id, amount, name, '2026-07-10', account_id, id, ?
        FROM income_schedules WHERE id = ?`).run(historicalOccurrence, created.body.id).lastInsertRowid);
      await request('/api/income?year=2099&month=10', { cookie: ownerCookie });
      const edited = await request(`/api/income/schedules/${created.body.id}`, {
        method: 'PATCH', cookie: ownerCookie, body: {
          name: 'Edited fortnightly income', amount: 125, frequency: 'fortnightly',
          anchor_date: '2099-10-10', account_id: secondAccount.body.id,
          recurrence: {
            frequency: 'fortnightly', start_date: '2099-10-10',
            end_mode: 'date', end_date: '2099-11-30',
          },
        },
      });
      assert.strictEqual(edited.status, 200);
      assert.strictEqual(edited.body.id, created.body.id);
      assert.strictEqual(edited.body.frequency, 'fortnightly');
      assert.strictEqual(edited.body.account_id, secondAccount.body.id);
      assert.strictEqual(edited.body.end_mode, 'date');
      assert.strictEqual(edited.body.end_date, '2099-11-30');
      assert.notStrictEqual(edited.body.recurring_series_id, created.body.recurring_series_id);
      const historical = db.prepare('SELECT * FROM income WHERE id = ?').get(historicalIncome);
      assert.strictEqual(historical.description, 'Editable income');
      assert.strictEqual(historical.amount, 100);
      assert.strictEqual(historical.account_id, ownerAccount.id);
      assert.strictEqual(historical.recurring_occurrence_id, historicalOccurrence);
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM income
        WHERE source_schedule_id = ? AND date >= '2099-01-01'`).get(created.body.id).count, 0);
      const entries = await request('/api/income?year=2099&month=10', { cookie: ownerCookie });
      assert.ok(entries.body.filter(row => row.source_schedule_id === created.body.id)
        .every(row => row.description === 'Edited fortnightly income'
          && row.amount === 125 && row.account_id === secondAccount.body.id));

      const monthly = await request(`/api/income/schedules/${created.body.id}`, {
        method: 'PATCH', cookie: ownerCookie, body: {
          name: 'Counted monthly income', amount: 130, frequency: 'monthly',
          day_of_month: 20, account_id: secondAccount.body.id,
          recurrence: { frequency: 'monthly', end_mode: 'count', max_occurrences: 2 },
        },
      });
      assert.strictEqual(monthly.status, 200);
      assert.strictEqual(monthly.body.day_of_month, 20);
      assert.strictEqual(monthly.body.end_mode, 'count');
      assert.strictEqual(monthly.body.max_occurrences, 2);
      assert.strictEqual(db.prepare('SELECT description FROM income WHERE id = ?').get(historicalIncome).description, 'Editable income');

      const denied = await request(`/api/income/schedules/${created.body.id}`, {
        method: 'PATCH', cookie: otherCookie, body: {
          name: 'Stolen', amount: 1, frequency: 'monthly', day_of_month: 1,
          account_id: secondAccount.body.id,
        },
      });
      assert.strictEqual(denied.status, 404);

      const inactiveAccount = await request('/api/accounts', { method: 'POST', cookie: ownerCookie, body: {
        name: 'Inactive Income Account', type: 'current', colour: '#111111', opening_balance: 0,
      }});
      await request(`/api/accounts/${inactiveAccount.body.id}/deactivate`, { method: 'PATCH', cookie: ownerCookie });
      const rejected = await request(`/api/income/schedules/${created.body.id}`, {
        method: 'PATCH', cookie: ownerCookie, body: {
          name: 'Rejected edit', amount: 140, frequency: 'monthly', day_of_month: 21,
          account_id: inactiveAccount.body.id,
        },
      });
      assert.strictEqual(rejected.status, 404);
      assert.strictEqual(db.prepare('SELECT name FROM income_schedules WHERE id = ?').get(created.body.id).name, 'Counted monthly income');
    });

    await test('stop recurring is idempotent, removes future projections, and retains history', async () => {
      const created = await createSchedule(ownerCookie, ownerAccount.id, {
        name: 'Deactivate income', frequency: 'yearly', anchor_date: '2099-11-12',
      });
      db.prepare(`INSERT INTO income
        (user_id, amount, description, date, account_id, source_schedule_id)
        VALUES ((SELECT user_id FROM income_schedules WHERE id = ?), 100,
          'Historical deactivate income', '2026-01-12', ?, ?)`
      ).run(created.body.id, ownerAccount.id, created.body.id);
      await request('/api/income?year=2099&month=11', { cookie: ownerCookie });
      assert.ok(db.prepare(`SELECT COUNT(*) AS count FROM income
        WHERE source_schedule_id = ? AND date >= '2099-01-01'`).get(created.body.id).count > 0);
      const denied = await request(`/api/income/schedules/${created.body.id}/deactivate`, {
        method: 'PATCH', cookie: otherCookie,
      });
      assert.strictEqual(denied.status, 404);
      const deactivated = await request(`/api/income/schedules/${created.body.id}/deactivate`, {
        method: 'PATCH', cookie: ownerCookie,
      });
      assert.strictEqual(deactivated.status, 200);
      assert.ok(deactivated.body.removed_future > 0);
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM income
        WHERE source_schedule_id = ? AND date >= '2099-01-01'`).get(created.body.id).count, 0);
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM income
        WHERE source_schedule_id = ? AND date = '2026-01-12'`).get(created.body.id).count, 1);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_series WHERE id = ?').get(created.body.recurring_series_id).status, 'deleted');
      const repeated = await request(`/api/income/schedules/${created.body.id}/deactivate`, {
        method: 'PATCH', cookie: ownerCookie,
      });
      assert.deepStrictEqual(repeated.body, { id: created.body.id, active: false, removed_future: 0 });
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
