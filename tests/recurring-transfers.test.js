const assert = require('assert');
const db = require('../db');
const { createRecurrenceRunner } = require('../lib/recurrence/runner');
const { createRecurringTransfer } = require('../lib/recurrence/transfer-service');
require('../lib/recurrence/transfer-adapter');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

const userId = Number(db.prepare(`INSERT INTO users
  (display_name, password_hash, colour, is_admin) VALUES ('Transfer Frequency Owner', 'hash', '#123456', 1)`
).run().lastInsertRowid);
const createAccount = db.prepare(`INSERT INTO accounts
  (user_id, name, type, colour, opening_balance) VALUES (?, ?, 'current', '#123456', ?)`);
const sourceId = Number(createAccount.run(userId, 'Transfer source', 1000).lastInsertRowid);
const destinationId = Number(createAccount.run(userId, 'Transfer destination', 100).lastInsertRowid);

function runnerAt(iso) {
  return createRecurrenceRunner(db, {
    enabled: true, intervalMs: 1000, batchSize: 50, requestThrottleMs: 0,
    retryBaseMs: 1, retryMaxMs: 10, maxAttempts: 3,
  }, { now: () => new Date(iso) });
}

(async () => {
  await test('all frequencies execute once and preserve transfer balance symmetry', async () => {
    const frequencies = ['daily', 'weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly', 'yearly'];
    const ids = frequencies.map(frequency => createRecurringTransfer(db, userId, {
      from_account_id: sourceId, to_account_id: destinationId,
      amount: 2, note: frequency, date: '2028-02-29',
    }, { frequency, start_date: '2028-02-29', end_mode: 'count', max_occurrences: 1 }).recurring_series_id);
    const runner = runnerAt('2028-02-29T12:00:00Z');
    assert.strictEqual((await runner.runOnce()).processed, 7);
    assert.strictEqual((await runner.runOnce()).processed, 0);
    for (const id of ids) {
      assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM transfers t
        JOIN recurring_occurrences ro ON ro.id = t.recurring_occurrence_id
        WHERE ro.series_id = ?`).get(id).count, 1);
    }
    const total = db.prepare('SELECT SUM(amount) AS total FROM transfers').get().total;
    assert.strictEqual(total, 14);
  });

  await test('month-end, leap-year, and DST dates never execute early', async () => {
    const monthly = createRecurringTransfer(db, userId, {
      from_account_id: sourceId, to_account_id: destinationId,
      amount: 3, note: 'Month end', date: '2028-01-31',
    }, { frequency: 'monthly', start_date: '2028-01-31', end_mode: 'count', max_occurrences: 3,
      time_zone: 'Europe/London' });
    await runnerAt('2028-02-28T23:30:00Z').runOnce();
    let dates = db.prepare(`SELECT t.date FROM transfers t JOIN recurring_occurrences ro
      ON ro.id = t.recurring_occurrence_id WHERE ro.series_id = ? ORDER BY t.date`
    ).all(monthly.recurring_series_id).map(row => row.date);
    assert.deepStrictEqual(dates, ['2028-01-31']);
    await runnerAt('2028-02-29T00:30:00Z').runOnce();
    await runnerAt('2028-03-30T23:30:00Z').runOnce();
    dates = db.prepare(`SELECT t.date FROM transfers t JOIN recurring_occurrences ro
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
