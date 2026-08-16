const assert = require('assert');
const fs = require('fs');
const db = require('../db');
const {
  INCOME_SCHEDULE_REPAIR_SCHEMA_VERSION, repairIncomeScheduleSeriesV10,
} = require('../db-migrations');
const { createIncomeScheduleWithSeries, materializeIncomeMonth } = require('../lib/recurrence/income-service');
const { scheduleRows } = require('../routes/income-schedules');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed += 1; }
  catch (error) { console.error(`  \u2717 ${name}: ${error.stack || error.message}`); failed += 1; }
}

function seedUser() {
  const userId = Number(db.prepare(`INSERT INTO users
    (display_name, password_hash, colour, is_admin) VALUES (?, 'hash', '#123456', 1)`
  ).run(`Repair User ${Date.now()}-${Math.random()}`).lastInsertRowid);
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
  db.prepare(`INSERT INTO income
    (user_id, amount, description, date, source_schedule_id, account_id)
    VALUES (?, 90, 'Ambiguous Pay', '2026-08-04', ?, ?)`
  ).run(userId, created.scheduleId, accountId);
  corruptScheduleLink(created.scheduleId, created.seriesId);
  const before = db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count;
  assert.throws(() => repairIncomeScheduleSeriesV10(db, {
    dbPath: process.env.FINTRACK_DB_PATH,
  }), new RegExp(`Income \\d+ is not on schedule ${created.scheduleId}`));
  assert.strictEqual(db.pragma('user_version', { simple: true }), 9);
  assert.strictEqual(db.prepare('SELECT recurring_series_id FROM income_schedules WHERE id = ?')
    .get(created.scheduleId).recurring_series_id, created.seriesId);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM recurring_series').get().count, before);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
