const assert = require('assert');
const fs = require('fs');
const db = require('../db');
const {
  INCOME_SCHEDULE_REPAIR_SCHEMA_VERSION, repairIncomeScheduleSeriesV10,
} = require('../db-migrations');
const {
  createIncomeScheduleWithSeries, editIncomeSchedule, materializeIncomeMonth,
} = require('../lib/recurrence/income-service');
const { scheduleRows } = require('../routes/income-schedules');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

function seedUser(name = `Repair User ${Date.now()}-${Math.random()}`) {
  const userId = Number(db.prepare(`INSERT INTO users
    (display_name, password_hash, colour, is_admin) VALUES (?, 'hash', '#123456', 1)`
  ).run(name).lastInsertRowid);
  const accountId = Number(db.prepare(`INSERT INTO accounts
    (user_id, name, type, colour, opening_balance, active)
    VALUES (?, 'Repair Account', 'current', '#123456', 0, 1)`
  ).run(userId).lastInsertRowid);
  return { userId, accountId };
}

function corruptScheduleLink(scheduleId, seriesId) {
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare('UPDATE income SET recurring_occurrence_id = NULL WHERE source_schedule_id = ?').run(scheduleId);
    db.prepare('DELETE FROM recurring_occurrences WHERE series_id = ?').run(seriesId);
    db.prepare('DELETE FROM recurring_series WHERE id = ?').run(seriesId);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  db.prepare('DELETE FROM schema_migrations WHERE version = ?')
    .run(INCOME_SCHEDULE_REPAIR_SCHEMA_VERSION);
  db.pragma('user_version = 9');
}

function addRevisionIncome({ id, seriesId, scheduleId, userId, accountId, date, sequence, amount, description }) {
  const occurrenceId = Number(db.prepare(`INSERT INTO recurring_occurrences
    (series_id, scheduled_date, sequence, series_revision, status)
    VALUES (?, ?, ?, 1, 'generated')`).run(seriesId, date, sequence).lastInsertRowid);
  db.prepare(`INSERT INTO income
    (id, user_id, amount, description, date, source_schedule_id, account_id, recurring_occurrence_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, amount, description, date, scheduleId, accountId, occurrenceId);
  return occurrenceId;
}

test('legacy active schedule and recurring history are repaired without changing IDs or duplicating data', () => {
  const { userId, accountId } = seedUser();
  const created = createIncomeScheduleWithSeries(db, userId, {
    name: 'Legacy Pay', amount: 2400, frequency: 'monthly', day_of_month: 15,
    account_id: accountId, recurrence: {
      frequency: 'monthly', start_date: '2026-07-15', end_mode: 'never',
    },
  });
  materializeIncomeMonth(db, userId, 2026, 8);
  const before = db.prepare(`SELECT id, source_schedule_id, date FROM income
    WHERE source_schedule_id = ? ORDER BY id`).all(created.scheduleId);
  assert.ok(before.length > 0);
  corruptScheduleLink(created.scheduleId, created.seriesId);
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM income_schedules i
    JOIN recurring_series s ON s.id = i.recurring_series_id WHERE i.id = ?`
  ).get(created.scheduleId).count, 0);
  assert.ok(db.prepare(`SELECT COUNT(*) AS count FROM income
    WHERE source_schedule_id = ?`).get(created.scheduleId).count > 0);
  assert.strictEqual(scheduleRows(userId).some(row => row.id === created.scheduleId), false);

  const repaired = repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH });
  assert.strictEqual(repaired.repaired, 1);
  assert.strictEqual(repaired.occurrences, before.length);
  assert.ok(repaired.backupPath && fs.statSync(repaired.backupPath).size > 0);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 10);
  const schedule = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(created.scheduleId);
  assert.strictEqual(schedule.id, created.scheduleId);
  assert.ok(schedule.recurring_series_id);
  assert.strictEqual(scheduleRows(userId).filter(row => row.active).some(row => row.id === created.scheduleId), true);
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM recurring_series
    WHERE id = ? AND kind = 'income' AND user_id = ?`).get(schedule.recurring_series_id, userId).count, 1);
  assert.deepStrictEqual(db.prepare(`SELECT id, source_schedule_id, date FROM income
    WHERE source_schedule_id = ? ORDER BY id`).all(created.scheduleId), before);
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS count FROM income
    WHERE source_schedule_id = ? AND recurring_occurrence_id IS NULL`).get(created.scheduleId).count, 0);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);

  const seriesCount = db.prepare("SELECT COUNT(*) AS count FROM recurring_series WHERE kind = 'income'").get().count;
  const occurrenceCount = db.prepare('SELECT COUNT(*) AS count FROM recurring_occurrences').get().count;
  assert.deepStrictEqual(repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH }), {
    migrated: false, backupPath: null, repaired: 0, occurrences: 0,
  });
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM recurring_series WHERE kind = 'income'").get().count, seriesCount);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM recurring_occurrences').get().count, occurrenceCount);
});

test('historical immutable revisions for two users pass startup without rewriting income', () => {
  const chris = seedUser('Chris');
  const sam = seedUser('Sam');
  const pay = createIncomeScheduleWithSeries(db, sam.userId, {
    name: 'Pay', amount: 800, frequency: 'four_weekly', anchor_date: '2026-01-02',
    account_id: sam.accountId,
  });
  const timken = createIncomeScheduleWithSeries(db, chris.userId, {
    name: 'Timken Salary', amount: 2100, frequency: 'monthly', day_of_month: 15,
    account_id: chris.accountId,
    recurrence: { frequency: 'monthly', start_date: '2026-01-15', end_mode: 'never' },
  });
  const baseId = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM income').get().id;
  const historicalIds = [baseId + 4, baseId + 29, baseId + 48, baseId + 49];
  const historicalOccurrences = [
    addRevisionIncome({ id: historicalIds[0], seriesId: pay.seriesId, scheduleId: pay.scheduleId,
      userId: sam.userId, accountId: sam.accountId, date: '2026-01-02', sequence: 1,
      amount: 800, description: 'Pay' }),
    addRevisionIncome({ id: historicalIds[1], seriesId: pay.seriesId, scheduleId: pay.scheduleId,
      userId: sam.userId, accountId: sam.accountId, date: '2026-01-30', sequence: 2,
      amount: 800, description: 'Pay' }),
    addRevisionIncome({ id: historicalIds[2], seriesId: timken.seriesId, scheduleId: timken.scheduleId,
      userId: chris.userId, accountId: chris.accountId, date: '2026-01-15', sequence: 1,
      amount: 2100, description: 'Timken Salary' }),
    addRevisionIncome({ id: historicalIds[3], seriesId: timken.seriesId, scheduleId: timken.scheduleId,
      userId: chris.userId, accountId: chris.accountId, date: '2026-02-15', sequence: 2,
      amount: 2100, description: 'Timken Salary' }),
  ];

  const paySchedule = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(pay.scheduleId);
  const paySeries = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(pay.seriesId);
  const revisedPay = editIncomeSchedule(db, paySchedule, paySeries, {
    name: 'Pay', amount: 825, frequency: 'four_weekly', anchor_date: '2099-01-02',
    account_id: sam.accountId,
    recurrence: { frequency: 'four_weekly', start_date: '2099-01-02', end_mode: 'never' },
  });
  const timkenSchedule = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(timken.scheduleId);
  const timkenSeries = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(timken.seriesId);
  const revisedTimken = editIncomeSchedule(db, timkenSchedule, timkenSeries, {
    name: 'Timken Salary', amount: 2200, frequency: 'monthly', day_of_month: 15,
    account_id: chris.accountId,
    recurrence: { frequency: 'monthly', start_date: '2099-01-15', end_mode: 'never' },
  });
  addRevisionIncome({ id: baseId + 60, seriesId: revisedPay.seriesId, scheduleId: pay.scheduleId,
    userId: sam.userId, accountId: sam.accountId, date: '2099-01-02', sequence: 1,
    amount: 825, description: 'Pay' });
  addRevisionIncome({ id: baseId + 61, seriesId: revisedTimken.seriesId, scheduleId: timken.scheduleId,
    userId: chris.userId, accountId: chris.accountId, date: '2099-01-15', sequence: 1,
    amount: 2200, description: 'Timken Salary' });

  const rejectedByOldRule = db.prepare(`SELECT i.id FROM income i
    JOIN income_schedules schedule ON schedule.id = i.source_schedule_id
    JOIN recurring_occurrences occurrence ON occurrence.id = i.recurring_occurrence_id
    WHERE i.id IN (${historicalIds.map(() => '?').join(',')})
      AND occurrence.series_id IS NOT schedule.recurring_series_id ORDER BY i.id`
  ).all(...historicalIds).map(row => row.id);
  assert.deepStrictEqual(rejectedByOldRule, historicalIds);
  const beforeIncome = db.prepare('SELECT * FROM income WHERE id >= ? ORDER BY id').all(baseId + 1);
  const beforeSeries = db.prepare("SELECT * FROM recurring_series WHERE kind = 'income' AND user_id IN (?, ?) ORDER BY id")
    .all(chris.userId, sam.userId);
  const beforeOccurrences = db.prepare(`SELECT * FROM recurring_occurrences
    WHERE id IN (${historicalOccurrences.map(() => '?').join(',')}) ORDER BY id`).all(...historicalOccurrences);
  db.prepare('DELETE FROM schema_migrations WHERE version = 10').run();
  db.pragma('user_version = 9');

  const migrated = repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH });
  assert.deepStrictEqual({ migrated: migrated.migrated, repaired: migrated.repaired, occurrences: migrated.occurrences }, {
    migrated: true, repaired: 0, occurrences: 0,
  });
  assert.deepStrictEqual(db.prepare('SELECT * FROM income WHERE id >= ? ORDER BY id').all(baseId + 1), beforeIncome);
  assert.deepStrictEqual(db.prepare("SELECT * FROM recurring_series WHERE kind = 'income' AND user_id IN (?, ?) ORDER BY id")
    .all(chris.userId, sam.userId), beforeSeries);
  assert.deepStrictEqual(db.prepare(`SELECT * FROM recurring_occurrences
    WHERE id IN (${historicalOccurrences.map(() => '?').join(',')}) ORDER BY id`).all(...historicalOccurrences), beforeOccurrences);
  assert.strictEqual(db.prepare('SELECT recurring_series_id FROM income_schedules WHERE id = ?')
    .get(pay.scheduleId).recurring_series_id, revisedPay.seriesId);
  assert.strictEqual(db.prepare('SELECT recurring_series_id FROM income_schedules WHERE id = ?')
    .get(timken.scheduleId).recurring_series_id, revisedTimken.seriesId);
  assert.deepStrictEqual(scheduleRows(sam.userId).filter(row => row.active).map(row => row.name), ['Pay']);
  assert.deepStrictEqual(scheduleRows(chris.userId).filter(row => row.active).map(row => row.name), ['Timken Salary']);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);

  const beforeSecondRun = {
    income: db.prepare('SELECT * FROM income WHERE id >= ? ORDER BY id').all(baseId + 1),
    series: db.prepare("SELECT * FROM recurring_series WHERE kind = 'income' AND user_id IN (?, ?) ORDER BY id")
      .all(chris.userId, sam.userId),
    occurrences: db.prepare(`SELECT * FROM recurring_occurrences
      WHERE series_id IN (?, ?, ?, ?) ORDER BY id`).all(
      pay.seriesId, timken.seriesId, revisedPay.seriesId, revisedTimken.seriesId
    ),
  };
  assert.deepStrictEqual(repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH }), {
    migrated: false, backupPath: null, repaired: 0, occurrences: 0,
  });
  assert.deepStrictEqual({
    income: db.prepare('SELECT * FROM income WHERE id >= ? ORDER BY id').all(baseId + 1),
    series: db.prepare("SELECT * FROM recurring_series WHERE kind = 'income' AND user_id IN (?, ?) ORDER BY id")
      .all(chris.userId, sam.userId),
    occurrences: db.prepare(`SELECT * FROM recurring_occurrences
      WHERE series_id IN (?, ?, ?, ?) ORDER BY id`).all(
      pay.seriesId, timken.seriesId, revisedPay.seriesId, revisedTimken.seriesId
    ),
  }, beforeSecondRun);
});

test('repairing a missing current link preserves a valid older recurrence revision', () => {
  const { userId, accountId } = seedUser();
  const created = createIncomeScheduleWithSeries(db, userId, {
    name: 'Revised legacy pay', amount: 100, frequency: 'daily', anchor_date: '2026-01-05',
    account_id: accountId,
  });
  const historicalId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM income').get().id;
  const historicalOccurrence = addRevisionIncome({
    id: historicalId, seriesId: created.seriesId, scheduleId: created.scheduleId,
    userId, accountId, date: '2026-01-05', sequence: 1,
    amount: 100, description: 'Revised legacy pay',
  });
  const schedule = db.prepare('SELECT * FROM income_schedules WHERE id = ?').get(created.scheduleId);
  const oldSeries = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(created.seriesId);
  const revised = editIncomeSchedule(db, schedule, oldSeries, {
    name: 'Revised legacy pay', amount: 120, frequency: 'daily', anchor_date: '2099-01-05',
    account_id: accountId,
    recurrence: { frequency: 'daily', start_date: '2099-01-05', end_mode: 'never' },
  });
  const futureId = historicalId + 1;
  addRevisionIncome({
    id: futureId, seriesId: revised.seriesId, scheduleId: created.scheduleId,
    userId, accountId, date: '2099-01-05', sequence: 1,
    amount: 120, description: 'Revised legacy pay',
  });
  const futureOccurrence = db.prepare('SELECT recurring_occurrence_id FROM income WHERE id = ?').get(futureId)
    .recurring_occurrence_id;
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare('UPDATE income SET recurring_occurrence_id = NULL WHERE id = ?').run(futureId);
    db.prepare('DELETE FROM recurring_occurrences WHERE id = ?').run(futureOccurrence);
    db.prepare('DELETE FROM recurring_series WHERE id = ?').run(revised.seriesId);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  db.prepare('DELETE FROM schema_migrations WHERE version = 10').run();
  db.pragma('user_version = 9');

  const result = repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH });
  assert.strictEqual(result.repaired, 1);
  assert.strictEqual(result.occurrences, 1);
  assert.strictEqual(db.prepare('SELECT recurring_occurrence_id FROM income WHERE id = ?').get(historicalId)
    .recurring_occurrence_id, historicalOccurrence);
  assert.notStrictEqual(db.prepare('SELECT recurring_occurrence_id FROM income WHERE id = ?').get(futureId)
    .recurring_occurrence_id, null);
  assert.strictEqual(db.prepare('SELECT status FROM recurring_series WHERE id = ?').get(created.seriesId).status, 'deleted');
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
});

test('an unsafe repair rolls back series, links, occurrences, version and migration record', () => {
  const { userId, accountId } = seedUser();
  const created = createIncomeScheduleWithSeries(db, userId, {
    name: 'Rollback Pay', amount: 100, frequency: 'weekly', anchor_date: '2026-08-03',
    account_id: accountId,
  });
  db.prepare(`INSERT INTO income
    (user_id, amount, description, date, source_schedule_id, account_id)
    VALUES (?, 100, 'Rollback Pay', '2026-08-03', ?, ?)`
  ).run(userId, created.scheduleId, accountId);
  corruptScheduleLink(created.scheduleId, created.seriesId);
  const seriesBefore = db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count;
  assert.throws(() => repairIncomeScheduleSeriesV10(db, {
    dbPath: process.env.FINTRACK_DB_PATH,
    beforeCommit() { throw new Error('injected income repair failure'); },
  }), /injected income repair failure/);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
  assert.strictEqual(db.prepare('SELECT recurring_series_id FROM income_schedules WHERE id = ?')
    .get(created.scheduleId).recurring_series_id, created.seriesId);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count, seriesBefore);
  assert.strictEqual(db.prepare('SELECT recurring_occurrence_id FROM income WHERE source_schedule_id = ?')
    .get(created.scheduleId).recurring_occurrence_id, null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10').get().count, 0);
  repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH });
});

test('ambiguous legacy dates fail with a clear diagnostic and preserve the original link', () => {
  const { userId, accountId } = seedUser();
  const created = createIncomeScheduleWithSeries(db, userId, {
    name: 'Ambiguous Pay', amount: 90, frequency: 'weekly', anchor_date: '2026-08-03',
    account_id: accountId,
  });
  const incomeId = Number(db.prepare(`INSERT INTO income
    (user_id, amount, description, date, source_schedule_id, account_id)
    VALUES (?, 90, 'Ambiguous Pay', '2026-08-04', ?, ?)`
  ).run(userId, created.scheduleId, accountId).lastInsertRowid);
  corruptScheduleLink(created.scheduleId, created.seriesId);
  const before = db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count;
  assert.throws(() => repairIncomeScheduleSeriesV10(db, {
    dbPath: process.env.FINTRACK_DB_PATH,
  }), new RegExp(`Income \\d+ is not on schedule ${created.scheduleId}`));
  assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
  assert.strictEqual(db.prepare('SELECT recurring_series_id FROM income_schedules WHERE id = ?')
    .get(created.scheduleId).recurring_series_id, created.seriesId);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count, before);
  db.prepare('DELETE FROM income WHERE id = ?').run(incomeId);
  repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH });
});

test('a same-user occurrence from another current schedule is still rejected', () => {
  const { userId, accountId } = seedUser();
  const first = createIncomeScheduleWithSeries(db, userId, {
    name: 'First source', amount: 10, frequency: 'daily', anchor_date: '2099-01-01',
    account_id: accountId,
  });
  const second = createIncomeScheduleWithSeries(db, userId, {
    name: 'Second source', amount: 20, frequency: 'daily', anchor_date: '2099-01-01',
    account_id: accountId,
  });
  const incomeId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM income').get().id;
  const occurrenceId = addRevisionIncome({
    id: incomeId, seriesId: second.seriesId, scheduleId: first.scheduleId,
    userId, accountId, date: '2099-01-01', sequence: 1,
    amount: 10, description: 'Wrong current source',
  });
  db.prepare('DELETE FROM schema_migrations WHERE version = 10').run();
  db.pragma('user_version = 9');
  assert.throws(() => repairIncomeScheduleSeriesV10(db, {
    dbPath: process.env.FINTRACK_DB_PATH,
  }), new RegExp(`Recurring income integrity check failed for income IDs: ${incomeId}`));
  db.prepare('DELETE FROM income WHERE id = ?').run(incomeId);
  db.prepare('DELETE FROM recurring_occurrences WHERE id = ?').run(occurrenceId);
  repairIncomeScheduleSeriesV10(db, { dbPath: process.env.FINTRACK_DB_PATH });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
