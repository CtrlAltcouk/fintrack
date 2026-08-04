const assert = require('assert');
const db = require('../db');
const { createRecurrenceRunner } = require('../lib/recurrence/runner');
const { createRecurringTransaction } = require('../lib/recurrence/transaction-service');
require('../lib/recurrence/transaction-adapter');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed++; }
}

const userId = Number(db.prepare(`INSERT INTO users
  (display_name, password_hash, colour, is_admin) VALUES ('Frequency Owner', 'hash', '#123456', 1)`
).run().lastInsertRowid);
const categoryId = Number(db.prepare(
  "INSERT INTO categories(user_id, name, colour) VALUES (?, 'Frequency', '#123456')"
).run(userId).lastInsertRowid);
const accountId = Number(db.prepare(`INSERT INTO accounts
  (user_id, name, type, colour, opening_balance) VALUES (?, 'Frequency account', 'current', '#123456', 0)`
).run(userId).lastInsertRowid);

function runnerAt(iso) {
  return createRecurrenceRunner(db, {
    enabled: true, intervalMs: 1000, batchSize: 50, requestThrottleMs: 0,
    retryBaseMs: 100, retryMaxMs: 1000, maxAttempts: 3,
  }, { now: () => new Date(iso) });
}

(async () => {
  await test('all supported frequencies execute their first due transaction exactly once', async () => {
    const frequencies = ['daily', 'weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly', 'yearly'];
    const seriesIds = frequencies.map(frequency => createRecurringTransaction(db, userId, {
      amount: 1, description: frequency, category_id: categoryId,
      account_id: accountId, date: '2028-02-29',
    }, { frequency, start_date: '2028-02-29', end_mode: 'count', max_occurrences: 1 }).recurring_series_id);
    const runner = runnerAt('2028-02-29T12:00:00Z');
    assert.strictEqual((await runner.runOnce()).processed, 7);
    assert.strictEqual((await runner.runOnce()).processed, 0);
    for (const seriesId of seriesIds) {
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transactions t
        JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
        WHERE ro.series_id = ?`).get(seriesId).count, 1);
      assert.strictEqual(db.prepare('SELECT status FROM recurring_series WHERE id = ?').get(seriesId).status, 'completed');
    }
  });

  await test('month-end and leap-year series do not create future transaction rows', async () => {
    const monthly = createRecurringTransaction(db, userId, {
      amount: 2, description: 'Month end', category_id: categoryId,
      account_id: accountId, date: '2028-01-31',
    }, { frequency: 'monthly', start_date: '2028-01-31', end_mode: 'count', max_occurrences: 3 });
    await runnerAt('2028-02-28T23:30:00Z').runOnce();
    let dates = db.prepare(`SELECT t.date FROM transactions t JOIN recurring_occurrences ro
      ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ? ORDER BY t.date`
    ).all(monthly.recurring_series_id).map(row => row.date);
    assert.deepStrictEqual(dates, ['2028-01-31']);
    assert.ok(!dates.includes('2028-03-31'));
    await runnerAt('2028-02-29T00:30:00Z').runOnce();
    await runnerAt('2028-03-31T12:00:00Z').runOnce();
    dates = db.prepare(`SELECT t.date FROM transactions t JOIN recurring_occurrences ro
      ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ? ORDER BY t.date`
    ).all(monthly.recurring_series_id).map(row => row.date);
    assert.deepStrictEqual(dates, ['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  if (db.open) db.close();
  process.exitCode = 1;
});
