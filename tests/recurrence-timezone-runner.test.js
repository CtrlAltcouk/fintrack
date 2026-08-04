const assert = require('assert');
const db = require('../db');
const { createRecurrenceRunner } = require('../lib/recurrence/runner');
const {
  createBillWithSeries, materializeBillRange,
} = require('../lib/recurrence/service');
const { createIncomeScheduleWithSeries } = require('../lib/recurrence/income-service');
const { materializeSeriesRange } = require('../lib/recurrence/engine');
const { createRecurringTransaction } = require('../lib/recurrence/transaction-service');
const { createRecurringTransfer } = require('../lib/recurrence/transfer-service');
require('../lib/recurrence/bill-adapter');
require('../lib/recurrence/income-adapter');
require('../lib/recurrence/transaction-adapter');
require('../lib/recurrence/transfer-adapter');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed++; }
}

const userId = Number(db.prepare(`INSERT INTO users
  (display_name, password_hash, colour, is_admin)
  VALUES ('Calendar Owner', 'hash', '#123456', 1)`
).run().lastInsertRowid);
const categoryId = Number(db.prepare(`INSERT INTO categories
  (user_id, name, colour) VALUES (?, 'Calendar', '#123456')`
).run(userId).lastInsertRowid);
const account = db.prepare(`INSERT INTO accounts
  (user_id, name, type, colour, opening_balance) VALUES (?, ?, 'current', '#123456', ?)`);
const sourceId = Number(account.run(userId, 'Source', 1000).lastInsertRowid);
const destinationId = Number(account.run(userId, 'Destination', 100).lastInsertRowid);

function runnerAt(iso, batchSize = 50) {
  return createRecurrenceRunner(db, {
    enabled: true, intervalMs: 1000, batchSize, requestThrottleMs: 0,
    retryBaseMs: 1, retryMaxMs: 10, maxAttempts: 3,
  }, { now: () => new Date(iso) });
}

function generatedDates(seriesId, table) {
  return db.prepare(`SELECT destination.date FROM ${table} destination
    JOIN recurring_occurrences ro ON ro.id = destination.recurring_occurrence_id
    WHERE ro.series_id = ? ORDER BY destination.date, destination.id`
  ).all(seriesId).map(row => row.date);
}

(async () => {
  await test('Bills and Income projections preserve date-only rows across both UK DST boundaries', async () => {
    const bill = createBillWithSeries(db, userId, {
      name: 'DST bill', amount: 10, due_day: 28,
      category_id: categoryId, account_id: sourceId,
    }, {
      frequency: 'daily', start_date: '2026-03-28', time_zone: 'Europe/London',
      end_mode: 'count', max_occurrences: 4,
    });
    materializeBillRange(db, userId, '2026-03-28', '2026-03-31');
    materializeBillRange(db, userId, '2026-03-28', '2026-03-31');
    assert.deepStrictEqual(db.prepare(`SELECT bm.due_date FROM bill_months bm
      WHERE bm.bill_id = ? ORDER BY bm.due_date`).all(bill.billId).map(row => row.due_date),
    ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);

    const income = createIncomeScheduleWithSeries(db, userId, {
      name: 'DST income', amount: 25, frequency: 'daily', anchor_date: '2026-10-24',
      account_id: sourceId, recurrence: {
        frequency: 'daily', start_date: '2026-10-24', time_zone: 'Europe/London',
        end_mode: 'count', max_occurrences: 3,
      },
    });
    const incomeSeries = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(income.seriesId);
    materializeSeriesRange(db, incomeSeries, '2026-10-24', '2026-10-26');
    materializeSeriesRange(db, incomeSeries, '2026-10-24', '2026-10-26');
    assert.deepStrictEqual(generatedDates(income.seriesId, 'income'),
      ['2026-10-24', '2026-10-25', '2026-10-26']);
    assert.strictEqual(incomeSeries.time_zone, 'Europe/London');
  });

  await test('Transaction execution follows London local midnight at the BST start', async () => {
    const created = createRecurringTransaction(db, userId, {
      amount: 5, description: 'Spring DST', category_id: categoryId,
      account_id: sourceId, date: '2026-03-29',
    }, {
      frequency: 'daily', start_date: '2026-03-29', time_zone: 'Europe/London',
      end_mode: 'count', max_occurrences: 2,
    });
    assert.strictEqual((await runnerAt('2026-03-28T23:30:00Z').runOnce()).processed, 0);
    assert.strictEqual((await runnerAt('2026-03-29T00:30:00Z').runOnce()).processed, 1);
    assert.strictEqual((await runnerAt('2026-03-29T22:59:59Z').runOnce()).processed, 0);
    assert.strictEqual((await runnerAt('2026-03-29T23:00:00Z').runOnce()).processed, 1);
    assert.strictEqual((await runnerAt('2026-03-30T12:00:00Z').runOnce()).processed, 0);
    assert.deepStrictEqual(generatedDates(created.recurring_series_id, 'transactions'),
      ['2026-03-29', '2026-03-30']);
  });

  await test('Transfer execution is idempotent through the repeated hour at the BST end', async () => {
    const created = createRecurringTransfer(db, userId, {
      from_account_id: sourceId, to_account_id: destinationId,
      amount: 7, note: 'Autumn DST', date: '2026-10-25',
    }, {
      frequency: 'daily', start_date: '2026-10-25', time_zone: 'Europe/London',
      end_mode: 'count', max_occurrences: 2,
    });
    assert.strictEqual((await runnerAt('2026-10-24T22:59:59Z').runOnce()).processed, 0);
    assert.strictEqual((await runnerAt('2026-10-24T23:00:00Z').runOnce()).processed, 1);
    assert.strictEqual((await runnerAt('2026-10-25T00:30:00Z').runOnce()).processed, 0);
    assert.strictEqual((await runnerAt('2026-10-25T01:30:00Z').runOnce()).processed, 0);
    assert.strictEqual((await runnerAt('2026-10-26T00:00:00Z').runOnce()).processed, 1);
    assert.deepStrictEqual(generatedDates(created.recurring_series_id, 'transfers'),
      ['2026-10-25', '2026-10-26']);
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM recurring_occurrences
      WHERE series_id = ?`).get(created.recurring_series_id).count, 2);
  });

  await test('stored IANA metadata drives execution independently for extreme local dates', async () => {
    const created = createRecurringTransaction(db, userId, {
      amount: 3, description: 'Kiritimati date', category_id: categoryId,
      account_id: sourceId, date: '2026-08-03',
    }, {
      frequency: 'yearly', start_date: '2026-08-03', time_zone: 'Pacific/Kiritimati',
      end_mode: 'count', max_occurrences: 1,
    });
    assert.strictEqual((await runnerAt('2026-08-02T09:59:59Z').runOnce()).processed, 0);
    assert.strictEqual((await runnerAt('2026-08-02T10:00:00Z').runOnce()).processed, 1);
    assert.deepStrictEqual(generatedDates(created.recurring_series_id, 'transactions'), ['2026-08-03']);
    const stored = db.prepare('SELECT time_zone, status FROM recurring_series WHERE id = ?')
      .get(created.recurring_series_id);
    assert.deepStrictEqual(stored, { time_zone: 'Pacific/Kiritimati', status: 'completed' });
  });

  await test('runner batching remains deterministic by logical date and identifier', async () => {
    const ids = ['2026-12-03', '2026-12-01', '2026-12-02'].map((date, index) =>
      createRecurringTransaction(db, userId, {
        amount: 1, description: `Order ${index}`, category_id: categoryId,
        account_id: sourceId, date,
      }, {
        frequency: 'yearly', start_date: date, time_zone: 'UTC',
        end_mode: 'count', max_occurrences: 1,
      }).recurring_series_id
    );
    const runner = runnerAt('2026-12-03T12:00:00Z', 1);
    for (let expected = 1; expected <= 3; expected += 1) {
      assert.strictEqual((await runner.runOnce()).processed, 1);
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transactions t
        JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
        WHERE ro.series_id IN (?, ?, ?)`).get(...ids).count, expected);
    }
    assert.deepStrictEqual(db.prepare(`SELECT t.date FROM transactions t
      JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
      WHERE ro.series_id IN (?, ?, ?) ORDER BY t.id`).all(...ids).map(row => row.date),
    ['2026-12-01', '2026-12-02', '2026-12-03']);
  });

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  if (db.open) db.close();
  process.exitCode = 1;
});
