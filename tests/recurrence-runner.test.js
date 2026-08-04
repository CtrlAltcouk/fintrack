const assert = require('assert');
const db = require('../db');
const { CAPABILITIES, registerRecurrenceAdapter } = require('../lib/recurrence/registry');
const { createRecurrenceRunner, retryDelayMs } = require('../lib/recurrence/runner');
require('../lib/recurrence/bill-adapter');
require('../lib/recurrence/income-adapter');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack || error.message}`); failed++; }
}

db.exec(`
  CREATE TABLE runner_test_destination (
    occurrence_id INTEGER PRIMARY KEY,
    marker TEXT NOT NULL
  );
`);
const userId = Number(db.prepare(`INSERT INTO users
  (display_name, password_hash, colour, is_admin) VALUES ('Runner Owner', 'hash', '#123456', 1)`
).run().lastInsertRowid);

let execute = (database, occurrence) => {
  database.prepare('INSERT INTO runner_test_destination(occurrence_id, marker) VALUES (?, ?)')
    .run(occurrence.id, `sequence-${occurrence.sequence}`);
};
registerRecurrenceAdapter('runner_test', {
  capability: CAPABILITIES.AUTOMATIC_EXECUTION,
  materializeRange() { return []; },
  executeOccurrence(database, occurrence) { return execute(database, occurrence); },
});

let current = new Date('2026-01-10T12:00:00Z');
const now = () => new Date(current);
const config = {
  enabled: true, intervalMs: 1000, batchSize: 2, requestThrottleMs: 100,
  retryBaseMs: 1000, retryMaxMs: 8000, maxAttempts: 3,
};

function reset() {
  db.exec(`
    DELETE FROM recurring_execution_claims;
    DELETE FROM runner_test_destination;
    DELETE FROM recurring_occurrences;
    DELETE FROM recurring_series;
  `);
  execute = (database, occurrence) => {
    database.prepare('INSERT INTO runner_test_destination(occurrence_id, marker) VALUES (?, ?)')
      .run(occurrence.id, `sequence-${occurrence.sequence}`);
  };
  current = new Date('2026-01-10T12:00:00Z');
}

function series(kind = 'runner_test') {
  return Number(db.prepare(`INSERT INTO recurring_series
    (user_id, kind, frequency_unit, frequency_interval, start_date, anchor_day,
     time_zone, end_mode, status, next_due_date, next_sequence)
    VALUES (?, ?, 'day', 1, '2026-01-01', 1, 'UTC', 'never', 'active', '2026-01-01', 1)`
  ).run(userId, kind).lastInsertRowid);
}

function occurrence(seriesId, date, sequence, status = 'scheduled', extra = {}) {
  return Number(db.prepare(`INSERT INTO recurring_occurrences
    (series_id, scheduled_date, sequence, series_revision, status,
     attempt_count, next_retry_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).run(seriesId, date, sequence, status, extra.attempt_count ?? 0, extra.next_retry_at ?? null).lastInsertRowid);
}

(async () => {
  await test('empty queues are safe and retry delays are bounded exponential values', async () => {
    reset();
    const runner = createRecurrenceRunner(db, config, { now });
    assert.deepStrictEqual(await runner.runOnce(), { processed: 0, failed: 0, source: 'manual' });
    assert.deepStrictEqual([1, 2, 3, 8].map(attempt => retryDelayMs(attempt, config)), [1000, 2000, 4000, 8000]);
  });

  await test('start is idempotent, the timer is unreferenced, and stop clears it', async () => {
    reset();
    const timers = [];
    const cleared = [];
    const runner = createRecurrenceRunner(db, config, {
      now,
      setIntervalFn(callback, interval) {
        const timer = { callback, interval, unreferenced: false, unref() { this.unreferenced = true; } };
        timers.push(timer);
        return timer;
      },
      clearIntervalFn(timer) { cleared.push(timer); },
    });
    assert.strictEqual(runner.start(), true);
    assert.strictEqual(runner.start(), false);
    await runner.inFlight;
    assert.strictEqual(timers.length, 1);
    assert.strictEqual(timers[0].unreferenced, true);
    assert.strictEqual(runner.diagnostics().active, true);
    await runner.stop();
    assert.deepStrictEqual(cleared, timers);
    assert.strictEqual(runner.diagnostics().active, false);
  });

  await test('overlapping direct and request-triggered runs execute only once', async () => {
    reset();
    const sid = series();
    occurrence(sid, '2026-01-01', 1);
    const runner = createRecurrenceRunner(db, config, { now });
    runner.started = true;
    const first = runner.runOnce({ source: 'manual' });
    const overlap = runner.triggerCatchUp();
    assert.strictEqual((await overlap).skipped, 'overlap');
    assert.strictEqual((await first).processed, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM runner_test_destination').get().count, 1);
    assert.strictEqual((await runner.triggerCatchUp()).skipped, 'throttled');
  });

  await test('batching is oldest-first and continues deterministically across bounded runs', async () => {
    reset();
    const sid = series();
    const newest = occurrence(sid, '2026-01-05', 5);
    const oldest = occurrence(sid, '2026-01-01', 1);
    const middle = occurrence(sid, '2026-01-02', 2);
    const later = occurrence(sid, '2026-01-03', 3);
    const next = occurrence(sid, '2026-01-04', 4);
    const executionOrder = [];
    execute = (database, row) => {
      executionOrder.push(row.id);
      database.prepare('INSERT INTO runner_test_destination(occurrence_id, marker) VALUES (?, ?)')
        .run(row.id, `sequence-${row.sequence}`);
    };
    const runner = createRecurrenceRunner(db, config, { now });
    assert.strictEqual((await runner.runOnce()).processed, 2);
    assert.deepStrictEqual(executionOrder, [oldest, middle]);
    assert.strictEqual((await runner.runOnce()).processed, 2);
    assert.deepStrictEqual(executionOrder, [oldest, middle, later, next]);
    assert.strictEqual((await runner.runOnce()).processed, 1);
    assert.deepStrictEqual(executionOrder, [oldest, middle, later, next, newest]);
    assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(newest).status, 'generated');
  });

  await test('a failure before or during insertion rolls back and does not block another series', async () => {
    reset();
    const firstSeries = series();
    const secondSeries = series();
    const before = occurrence(firstSeries, '2026-01-01', 1);
    const during = occurrence(firstSeries, '2026-01-02', 2);
    const healthy = occurrence(secondSeries, '2026-01-01', 1);
    execute = (database, row) => {
      if (row.id === before) { const error = new Error('private detail'); error.code = 'TEMPORARY'; throw error; }
      database.prepare('INSERT INTO runner_test_destination VALUES (?, ?)').run(row.id, 'created');
      if (row.id === during) throw new Error('private detail after insert');
    };
    const runner = createRecurrenceRunner(db, { ...config, batchSize: 10 }, { now });
    const result = await runner.runOnce();
    assert.deepStrictEqual({ processed: result.processed, failed: result.failed }, { processed: 1, failed: 2 });
    assert.deepStrictEqual(db.prepare('SELECT occurrence_id FROM runner_test_destination').all(), [{ occurrence_id: healthy }]);
    const failures = db.prepare('SELECT id, attempt_count, failure_code, next_retry_at FROM recurring_occurrences WHERE status = ? ORDER BY id').all('failed');
    assert.strictEqual(failures.length, 2);
    assert.ok(failures.every(row => row.attempt_count === 1 && row.next_retry_at));
    assert.strictEqual(failures.find(row => row.id === before).failure_code, 'TEMPORARY');
    assert.strictEqual(failures.find(row => row.id === during).failure_code, 'EXECUTION_FAILED');
  });

  await test('retry attempts stop at the maximum and manual retry enables restart recovery', async () => {
    reset();
    const sid = series();
    const oid = occurrence(sid, '2026-01-01', 1);
    execute = () => { throw new Error('do not persist this message'); };
    const runner = createRecurrenceRunner(db, config, { now });
    await runner.runOnce();
    current = new Date(current.getTime() + 1000);
    await runner.runOnce();
    current = new Date(current.getTime() + 2000);
    await runner.runOnce();
    let failedRow = db.prepare('SELECT * FROM recurring_occurrences WHERE id = ?').get(oid);
    assert.strictEqual(failedRow.attempt_count, 3);
    assert.strictEqual(failedRow.next_retry_at, null);
    assert.strictEqual((await runner.runOnce()).processed, 0);

    assert.deepStrictEqual(runner.manualRetry(oid, userId), { ok: true, occurrence_id: oid });
    execute = (database, row) => database.prepare('INSERT INTO runner_test_destination VALUES (?, ?)').run(row.id, 'recovered');
    const restarted = createRecurrenceRunner(db, config, { now, runnerId: 'restart-runner' });
    assert.strictEqual((await restarted.runOnce({ source: 'startup' })).processed, 1);
    failedRow = db.prepare('SELECT * FROM recurring_occurrences WHERE id = ?').get(oid);
    assert.strictEqual(failedRow.status, 'generated');
  });

  await test('unexpired cross-process claims reject work and expired claims recover safely', async () => {
    reset();
    const sid = series();
    const oid = occurrence(sid, '2026-01-01', 1);
    db.prepare(`INSERT INTO recurring_execution_claims
      (occurrence_id, runner_id, claimed_at, expires_at)
      VALUES (?, 'other-process', '2026-01-10 11:59:00', '2026-01-10 12:01:00')`).run(oid);
    const runner = createRecurrenceRunner(db, config, { now });
    assert.strictEqual((await runner.runOnce()).processed, 0);
    current = new Date('2026-01-10T12:02:00Z');
    assert.strictEqual((await runner.runOnce()).processed, 1);
    assert.strictEqual((await runner.runOnce()).processed, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM runner_test_destination').get().count, 1);
  });

  await test('projection-only Bills and Income never enter the automatic queue', async () => {
    reset();
    const billSeries = series('bill');
    const incomeSeries = series('income');
    const billOccurrence = occurrence(billSeries, '2026-01-01', 1);
    const incomeOccurrence = occurrence(incomeSeries, '2026-01-01', 1);
    const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
    const transferCount = db.prepare('SELECT COUNT(*) AS count FROM transfers').get().count;
    const runner = createRecurrenceRunner(db, config, { now });
    assert.strictEqual((await runner.runOnce()).processed, 0);
    assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(billOccurrence).status, 'scheduled');
    assert.strictEqual(db.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(incomeOccurrence).status, 'scheduled');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, transactionCount);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM transfers').get().count, transferCount);
  });

  db.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  if (db.open) db.close();
  process.exitCode = 1;
});
