const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const { createRecurrenceRunner } = require('../lib/recurrence/runner');
const {
  GLOBAL_DELETE_STEPS, USER_DELETE_STEPS, deleteUserData,
} = require('../lib/data-deletion');
const { issueSession } = require('../lib/session');

let passed = 0;
let failed = 0;
let baseUrl;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.stack || error.message}`);
    failed += 1;
  }
}

async function request(path, { method = 'GET', cookie } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function createUser(name, { admin = false } = {}) {
  const result = db.prepare(`INSERT INTO users
    (display_name, password_hash, colour, is_admin)
    VALUES (?, 'test-hash', '#123456', ?)`
  ).run(name, admin ? 1 : 0);
  const session = issueSession(db, Number(result.lastInsertRowid));
  return {
    id: Number(result.lastInsertRowid),
    cookie: `fintrack_session=${session.token}`,
  };
}

function createSeries(userId, kind) {
  return Number(db.prepare(`INSERT INTO recurring_series
    (user_id, kind, frequency_unit, frequency_interval, start_date, anchor_day,
     time_zone, end_mode, status, next_due_date, next_sequence)
    VALUES (?, ?, 'day', 1, '2026-01-01', 1, 'UTC', 'never', 'active', NULL, 10)`
  ).run(userId, kind).lastInsertRowid);
}

function createOccurrence(seriesId, sequence, status) {
  const date = `2026-01-${String(sequence).padStart(2, '0')}`;
  return Number(db.prepare(`INSERT INTO recurring_occurrences
    (series_id, scheduled_date, sequence, series_revision, status,
     attempt_count, next_retry_at, failure_code)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    seriesId, date, sequence, status,
    status === 'failed' ? 2 : 0,
    status === 'failed' ? '2026-01-10 00:00:00' : null,
    status === 'failed' ? 'TEST_FAILURE' : null
  ).lastInsertRowid);
}

function seedRecurringData(userId, label) {
  const categoryId = Number(db.prepare(
    'INSERT INTO categories(user_id, name, colour) VALUES (?, ?, ?)'
  ).run(userId, `${label} category`, '#abcdef').lastInsertRowid);
  const sourceId = Number(db.prepare(`INSERT INTO accounts
    (user_id, name, type, colour, opening_balance) VALUES (?, ?, 'current', '#123456', 1000)`
  ).run(userId, `${label} source`).lastInsertRowid);
  const destinationId = Number(db.prepare(`INSERT INTO accounts
    (user_id, name, type, colour, opening_balance) VALUES (?, ?, 'savings', '#654321', 100)`
  ).run(userId, `${label} destination`).lastInsertRowid);
  db.prepare('INSERT INTO settings(user_id, key, value) VALUES (?, ?, ?)')
    .run(userId, 'pay_period', JSON.stringify({ anchor: '2026-01-01' }));

  const transactionSeries = createSeries(userId, 'transaction');
  db.prepare(`INSERT INTO recurring_transaction_templates
    (recurring_series_id, account_id, category_id, amount, description)
    VALUES (?, ?, ?, 12, ?)`
  ).run(transactionSeries, sourceId, categoryId, `${label} recurring transaction`);
  const transactionOccurrence = createOccurrence(transactionSeries, 1, 'generated');
  db.prepare(`INSERT INTO transactions
    (user_id, amount, description, category_id, date, account_id, recurring_occurrence_id)
    VALUES (?, 12, ?, ?, '2026-01-01', ?, ?)`
  ).run(userId, `${label} generated transaction`, categoryId, sourceId, transactionOccurrence);
  const scheduledOccurrence = createOccurrence(transactionSeries, 2, 'scheduled');
  const failedOccurrence = createOccurrence(transactionSeries, 3, 'failed');
  createOccurrence(transactionSeries, 4, 'skipped');
  createOccurrence(transactionSeries, 5, 'deleted');
  const runnableOccurrence = createOccurrence(transactionSeries, 6, 'scheduled');
  db.prepare(`INSERT INTO recurring_execution_claims
    (occurrence_id, runner_id, claimed_at, expires_at)
    VALUES (?, 'fixture-runner', '2026-01-01 00:00:00', '2099-01-01 00:00:00')`
  ).run(failedOccurrence);

  const transferSeries = createSeries(userId, 'transfer');
  db.prepare(`INSERT INTO recurring_transfer_templates
    (recurring_series_id, from_account_id, to_account_id, amount, note)
    VALUES (?, ?, ?, 25, ?)`
  ).run(transferSeries, sourceId, destinationId, `${label} recurring transfer`);
  const transferOccurrence = createOccurrence(transferSeries, 1, 'generated');
  db.prepare(`INSERT INTO transfers
    (user_id, from_account_id, to_account_id, amount, date, note, recurring_occurrence_id)
    VALUES (?, ?, ?, 25, '2026-01-01', ?, ?)`
  ).run(userId, sourceId, destinationId, `${label} generated transfer`, transferOccurrence);

  const billSeries = createSeries(userId, 'bill');
  const billId = Number(db.prepare(`INSERT INTO bills
    (user_id, name, amount, due_day, category_id, account_id, recurring_series_id)
    VALUES (?, ?, 40, 1, ?, ?, ?)`
  ).run(userId, `${label} bill`, categoryId, sourceId, billSeries).lastInsertRowid);
  const billOccurrence = createOccurrence(billSeries, 1, 'generated');
  db.prepare(`INSERT INTO bill_months
    (bill_id, year, month, due_date, recurring_occurrence_id, paid, amount_paid, paid_date)
    VALUES (?, 2026, 1, '2026-01-01', ?, 1, 40, '2026-01-01')`
  ).run(billId, billOccurrence);

  const incomeSeries = createSeries(userId, 'income');
  const scheduleId = Number(db.prepare(`INSERT INTO income_schedules
    (name, amount, frequency, anchor_date, active, account_id, user_id, recurring_series_id)
    VALUES (?, 100, 'daily', '2026-01-01', 1, ?, ?, ?)`
  ).run(`${label} income`, sourceId, userId, incomeSeries).lastInsertRowid);
  const incomeOccurrence = createOccurrence(incomeSeries, 1, 'generated');
  db.prepare(`INSERT INTO income
    (user_id, amount, description, date, account_id, source_schedule_id, recurring_occurrence_id)
    VALUES (?, 100, ?, '2026-01-01', ?, ?, ?)`
  ).run(userId, `${label} generated income`, sourceId, scheduleId, incomeOccurrence);

  return {
    categoryId, sourceId, destinationId, transactionSeries, transferSeries,
    scheduledOccurrence, runnableOccurrence,
  };
}

function count(sql, ...params) {
  return db.prepare(sql).get(...params).count;
}

function snapshotUser(userId) {
  return {
    user: count('SELECT COUNT(*) AS count FROM users WHERE id = ?', userId),
    categories: count('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?', userId),
    accounts: count('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?', userId),
    settings: count('SELECT COUNT(*) AS count FROM settings WHERE user_id = ?', userId),
    bills: count('SELECT COUNT(*) AS count FROM bills WHERE user_id = ?', userId),
    billMonths: count(`SELECT COUNT(*) AS count FROM bill_months bm
      JOIN bills b ON b.id = bm.bill_id WHERE b.user_id = ?`, userId),
    incomeSchedules: count('SELECT COUNT(*) AS count FROM income_schedules WHERE user_id = ?', userId),
    income: count('SELECT COUNT(*) AS count FROM income WHERE user_id = ?', userId),
    transactions: count('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?', userId),
    transfers: count('SELECT COUNT(*) AS count FROM transfers WHERE user_id = ?', userId),
    series: count('SELECT COUNT(*) AS count FROM recurring_series WHERE user_id = ?', userId),
    occurrences: count(`SELECT COUNT(*) AS count FROM recurring_occurrences ro
      JOIN recurring_series rs ON rs.id = ro.series_id WHERE rs.user_id = ?`, userId),
    transactionTemplates: count(`SELECT COUNT(*) AS count FROM recurring_transaction_templates t
      JOIN recurring_series rs ON rs.id = t.recurring_series_id WHERE rs.user_id = ?`, userId),
    transferTemplates: count(`SELECT COUNT(*) AS count FROM recurring_transfer_templates t
      JOIN recurring_series rs ON rs.id = t.recurring_series_id WHERE rs.user_id = ?`, userId),
    claims: count(`SELECT COUNT(*) AS count FROM recurring_execution_claims c
      JOIN recurring_occurrences ro ON ro.id = c.occurrence_id
      JOIN recurring_series rs ON rs.id = ro.series_id WHERE rs.user_id = ?`, userId),
  };
}

function assertNoRecurringOrphans() {
  const checks = [
    `SELECT COUNT(*) AS count FROM recurring_occurrences ro
      LEFT JOIN recurring_series rs ON rs.id = ro.series_id WHERE rs.id IS NULL`,
    `SELECT COUNT(*) AS count FROM recurring_execution_claims c
      LEFT JOIN recurring_occurrences ro ON ro.id = c.occurrence_id WHERE ro.id IS NULL`,
    `SELECT COUNT(*) AS count FROM recurring_transaction_templates t
      LEFT JOIN recurring_series rs ON rs.id = t.recurring_series_id WHERE rs.id IS NULL`,
    `SELECT COUNT(*) AS count FROM recurring_transfer_templates t
      LEFT JOIN recurring_series rs ON rs.id = t.recurring_series_id WHERE rs.id IS NULL`,
    `SELECT COUNT(*) AS count FROM transactions t
      LEFT JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
      WHERE t.recurring_occurrence_id IS NOT NULL AND ro.id IS NULL`,
    `SELECT COUNT(*) AS count FROM transfers t
      LEFT JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
      WHERE t.recurring_occurrence_id IS NOT NULL AND ro.id IS NULL`,
  ];
  for (const sql of checks) assert.strictEqual(count(sql), 0);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
}

async function accountBalances(cookie) {
  const response = await request('/api/accounts', { cookie });
  assert.strictEqual(response.status, 200);
  return response.body.map(account => ({ id: account.id, balance: account.balance }));
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await recurrenceRunner.stop();

  try {
    await test('deletion helpers expose the required order and reject implicit user identifiers', async () => {
      const expected = [
        'bill_months', 'income', 'transactions', 'transfers', 'bills',
        'income_schedules', 'recurring_transaction_templates',
        'recurring_transfer_templates', 'recurring_execution_claims',
        'recurring_occurrences', 'recurring_series', 'settings', 'accounts', 'categories',
      ];
      assert.deepStrictEqual(GLOBAL_DELETE_STEPS.map(([table]) => table), [
        'login_attempt_claims', 'login_rate_limits', ...expected,
      ]);
      assert.deepStrictEqual(USER_DELETE_STEPS.map(([table]) => table), expected);
      assert.throws(() => deleteUserData(db, '1'), /positive integer/);
      assert.throws(() => deleteUserData(db, 0), /positive integer/);
    });

    const admin = createUser('Deletion Admin', { admin: true });
    seedRecurringData(admin.id, 'global');
    await test('clear-all removes every financial and recurring row in dependency order', async () => {
      const runnerStateBefore = db.prepare('SELECT id FROM recurrence_runner_state WHERE id = 1').get();
      const response = await request('/api/update/clear-data', { method: 'POST', cookie: admin.cookie });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { ok: true });
      const snapshot = snapshotUser(admin.id);
      assert.deepStrictEqual(snapshot, {
        user: 1, categories: 0, accounts: 0, settings: 0, bills: 0, billMonths: 0,
        incomeSchedules: 0, income: 0, transactions: 0, transfers: 0,
        series: 0, occurrences: 0, transactionTemplates: 0, transferTemplates: 0, claims: 0,
      });
      assert.deepStrictEqual(db.prepare('SELECT id FROM recurrence_runner_state WHERE id = 1').get(), runnerStateBefore);
      assertNoRecurringOrphans();
    });

    const owner = createUser('Deletion Owner');
    const survivor = createUser('Deletion Survivor');
    seedRecurringData(owner.id, 'owner');
    seedRecurringData(survivor.id, 'survivor');
    await test('clear-my-data preserves another user and leaves their runner work valid', async () => {
      const survivorBefore = snapshotUser(survivor.id);
      const response = await request('/api/update/clear-my-data', { method: 'POST', cookie: owner.cookie });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { ok: true });
      assert.strictEqual(snapshotUser(owner.id).user, 1);
      assert.ok(Object.entries(snapshotUser(owner.id)).every(([key, value]) => key === 'user' || value === 0));
      assert.deepStrictEqual(snapshotUser(survivor.id), survivorBefore);
      assertNoRecurringOrphans();

      const runner = createRecurrenceRunner(db, {
        enabled: true, intervalMs: 1000, batchSize: 50, requestThrottleMs: 0,
        retryBaseMs: 1, retryMaxMs: 10, maxAttempts: 3,
      }, { now: () => new Date('2026-01-10T12:00:00Z') });
      const result = await runner.runOnce();
      assert.ok(result.processed >= 1);
      assertNoRecurringOrphans();
    });

    const target = createUser('Deletion Target');
    const unrelated = createUser('Deletion Unrelated');
    seedRecurringData(target.id, 'target');
    seedRecurringData(unrelated.id, 'unrelated');
    await test('administrator deletion removes the target only after all dependencies', async () => {
      const adminBefore = snapshotUser(admin.id);
      const unrelatedBefore = snapshotUser(unrelated.id);
      const response = await request(`/api/users/${target.id}`, { method: 'DELETE', cookie: admin.cookie });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, { ok: true });
      assert.deepStrictEqual(snapshotUser(target.id), {
        user: 0, categories: 0, accounts: 0, settings: 0, bills: 0, billMonths: 0,
        incomeSchedules: 0, income: 0, transactions: 0, transfers: 0,
        series: 0, occurrences: 0, transactionTemplates: 0, transferTemplates: 0, claims: 0,
      });
      assert.deepStrictEqual(snapshotUser(admin.id), adminBefore);
      assert.deepStrictEqual(snapshotUser(unrelated.id), unrelatedBefore);
      assertNoRecurringOrphans();
    });

    const rollbackUser = createUser('Deletion Rollback');
    seedRecurringData(rollbackUser.id, 'rollback');
    await test('an injected leaf-deletion failure rolls back rows, balances, and recurrence state', async () => {
      const before = snapshotUser(rollbackUser.id);
      const balancesBefore = await accountBalances(rollbackUser.cookie);
      assert.throws(() => db.transaction(() => {
        deleteUserData(db, rollbackUser.id, {
          onStep({ table }) {
            if (table === 'transfers') throw new Error('injected deletion failure');
          },
        });
      })(), /injected deletion failure/);
      assert.deepStrictEqual(snapshotUser(rollbackUser.id), before);
      assert.deepStrictEqual(await accountBalances(rollbackUser.cookie), balancesBefore);
      assertNoRecurringOrphans();
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
