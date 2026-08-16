const assert = require('assert');
const { once } = require('events');

process.env.PORT = '0';
const { recurrenceRunner, server } = require('../server');
const db = require('../db');
const backupRouter = require('../routes/backup');
const {
  calculateBackupBalances, validateBackupSemantics, validateRestoredDatabase,
} = require('../lib/backup-validation');
const { validateBackupOwnership } = require('../lib/ownership');

const TABLES = [
  'users', 'categories', 'accounts', 'income_schedules', 'recurring_series',
  'recurring_transaction_templates', 'recurring_transfer_templates', 'bills',
  'income', 'transactions', 'transfers', 'recurring_occurrences', 'bill_months', 'settings',
];

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
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

function clone(value) {
  return structuredClone(value);
}

function databaseSnapshot() {
  return Object.fromEntries(TABLES.map(table => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

function assertIntegrity(backup) {
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  const semanticError = validateBackupSemantics(backup);
  assert.strictEqual(semanticError, null, semanticError);
  validateRestoredDatabase(db, backup, calculateBackupBalances(backup));
}

function stripKind(backup, kind) {
  const seriesIds = new Set(
    backup.recurring_series.filter(row => row.kind === kind).map(row => String(row.id))
  );
  const occurrenceIds = new Set(
    backup.recurring_occurrences
      .filter(row => seriesIds.has(String(row.series_id)))
      .map(row => String(row.id))
  );
  backup.recurring_series = backup.recurring_series.filter(row => !seriesIds.has(String(row.id)));
  backup.recurring_occurrences = backup.recurring_occurrences
    .filter(row => !occurrenceIds.has(String(row.id)));
  if (kind === 'transaction') {
    delete backup.recurring_transaction_templates;
    for (const row of backup.transactions) delete row.recurring_occurrence_id;
  } else if (kind === 'transfer') {
    delete backup.recurring_transfer_templates;
    for (const row of backup.transfers) delete row.recurring_occurrence_id;
  } else if (kind === 'income') {
    for (const row of backup.income_schedules) delete row.recurring_series_id;
    for (const row of backup.income) delete row.recurring_occurrence_id;
  } else if (kind === 'bill') {
    for (const row of backup.bills) delete row.recurring_series_id;
    for (const row of backup.bill_months) {
      delete row.due_date;
      delete row.recurring_occurrence_id;
    }
  }
}

function versionBackup(current, version) {
  const backup = clone(current);
  backup.meta.schema_version = version;
  if (version < 6) stripKind(backup, 'transfer');
  if (version < 5) stripKind(backup, 'transaction');
  if (version < 3) stripKind(backup, 'income');
  if (version < 2) {
    stripKind(backup, 'bill');
    delete backup.recurring_series;
    delete backup.recurring_occurrences;
  }
  return backup;
}

function emptyBackup() {
  return {
    meta: { app: 'outflow', schema_version: 6 },
    ...Object.fromEntries(TABLES.map(table => [table, []])),
  };
}

(async () => {
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await recurrenceRunner.stop();

  try {
    const created = await request('/api/users', { method: 'POST', body: {
      display_name: 'Restore Admin', password: 'test-password', colour: '#123456',
    } });
    assert.strictEqual(created.status, 201);
    const login = await request('/api/auth/login', { method: 'POST', body: {
      display_name: 'Restore Admin', password: 'test-password',
    } });
    const cookie = login.cookie;
    const authenticate = async () => {
      const response = await request('/api/auth/login', { method: 'POST', body: {
        display_name: 'Restore Admin', password: 'test-password',
      } });
      assert.strictEqual(response.status, 200);
      return response.cookie;
    };
    const categories = (await request('/api/categories', { cookie })).body;
    const accounts = (await request('/api/accounts', { cookie })).body;
    const accountA = accounts[0];
    const accountB = (await request('/api/accounts', { method: 'POST', cookie, body: {
      name: 'Restore savings', type: 'savings', colour: '#654321', opening_balance: 200,
    } })).body;
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const day = Number(today.slice(8, 10));
    const recurrence = { frequency: 'monthly', start_date: today, end_mode: 'count', max_occurrences: 1 };

    const bill = await request('/api/bills', { method: 'POST', cookie, body: {
      name: 'Restore bill', amount: 35, due_day: day, category_id: categories[0].id,
      account_id: accountA.id, recurrence,
    } });
    assert.strictEqual(bill.status, 201);
    assert.strictEqual((await request(`/api/bills/by-range?from=${today}&to=${today}`, { cookie })).status, 200);

    const schedule = await request('/api/income/schedules', { method: 'POST', cookie, body: {
      name: 'Restore income', amount: 120, frequency: 'monthly', day_of_month: day,
      account_id: accountA.id, recurrence,
    } });
    assert.strictEqual(schedule.status, 201);
    assert.strictEqual((await request(`/api/income?year=${year}&month=${month}`, { cookie })).status, 200);

    assert.strictEqual((await request('/api/transactions', { method: 'POST', cookie, body: {
      amount: 18, description: 'Restore transaction', category_id: categories[0].id,
      account_id: accountA.id, date: today,
      recurrence: { frequency: 'daily', start_date: today, end_mode: 'count', max_occurrences: 1 },
    } })).status, 201);
    assert.strictEqual((await request('/api/transfers', { method: 'POST', cookie, body: {
      from_account_id: accountA.id, to_account_id: accountB.id, amount: 22,
      date: today, note: 'Restore transfer',
      recurrence: { frequency: 'daily', start_date: today, end_mode: 'count', max_occurrences: 1 },
    } })).status, 201);
    assert.strictEqual((await request('/api/recurring/runner/run', { method: 'POST', cookie })).status, 200);

    const exported = await request('/api/backup', { cookie });
    assert.strictEqual(exported.status, 200);
    const version6 = exported.body;
    assert.ok(version6.bill_months.some(row => row.recurring_occurrence_id != null));
    assert.ok(version6.income.some(row => row.recurring_occurrence_id != null));
    assert.ok(version6.transactions.some(row => row.recurring_occurrence_id != null));
    assert.ok(version6.transfers.some(row => row.recurring_occurrence_id != null));

    await test('dependency order is explicit and every current table is inserted once', async () => {
      assert.deepStrictEqual(backupRouter.TABLES_INSERT, [
        'users', 'categories', 'accounts', 'recurring_series', 'recurring_occurrences',
        'recurring_transaction_templates', 'recurring_transfer_templates',
        'bills', 'income_schedules', 'bill_months', 'income', 'transactions',
        'transfers', 'settings',
      ]);
    });

    await test('empty and populated replace restores are complete and foreign-key safe', async () => {
      backupRouter.restoreBackup(db, emptyBackup());
      assert.deepStrictEqual(databaseSnapshot(), Object.fromEntries(TABLES.map(table => [table, []])));
      backupRouter.restoreBackup(db, version6);
      assertIntegrity(version6);
    });

    await test('replace restore over populated data removes unrelated rows and preserves balances', async () => {
      db.prepare(`INSERT INTO transactions
        (user_id, amount, description, category_id, date, account_id)
        VALUES (?, 999, 'must disappear', ?, ?, ?)`
      ).run(created.body.id, categories[0].id, today, accountA.id);
      backupRouter.restoreBackup(db, version6);
      assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE description = 'must disappear'").get().count, 0);
      assertIntegrity(version6);
    });

    await test('Version 1 through Version 7 JSON backups upgrade and restore safely', async () => {
      for (let version = 1; version <= 7; version += 1) {
        const restoreCookie = await authenticate();
        const response = await request('/api/backup/restore?mode=replace', {
          method: 'POST', cookie: restoreCookie, body: versionBackup(version6, version),
        });
        assert.strictEqual(response.status, 200, `Version ${version}: ${JSON.stringify(response.body)}`);
        const normalized = validateBackupOwnership(backupRouter.upgradeBackup(versionBackup(version6, version))).backup;
        assert.ok(normalized, `Version ${version} ownership normalization`);
        assertIntegrity(normalized);
        if (version === 2) {
          const legacyCookie = await authenticate();
          const schedules = await request('/api/income/schedules', { cookie: legacyCookie });
          assert.strictEqual(schedules.status, 200);
          assert.ok(schedules.body.some(row => row.id === schedule.body.id && row.active));
          assert.ok(db.prepare(`SELECT COUNT(*) AS count FROM income
            WHERE source_schedule_id = ?`).get(schedule.body.id).count > 0);
        }
      }
    });

    await test('merge and unknown modes are rejected before any mutation', async () => {
      const activeCookie = await authenticate();
      const before = databaseSnapshot();
      const merge = await request('/api/backup/restore?mode=merge', { method: 'POST', cookie: activeCookie, body: version6 });
      assert.strictEqual(merge.status, 409);
      assert.match(merge.body.error, /disabled/);
      const unknown = await request('/api/backup/restore?mode=unexpected', { method: 'POST', cookie: activeCookie, body: version6 });
      assert.strictEqual(unknown.status, 400);
      assert.deepStrictEqual(databaseSnapshot(), before);
    });

    await test('duplicate IDs, recurrence corruption, and ownership/FK corruption are rejected', async () => {
      const cases = [];
      const duplicate = clone(version6);
      duplicate.accounts.push(clone(duplicate.accounts[0]));
      cases.push([duplicate, /duplicate id/]);

      const recurrenceCorruption = clone(version6);
      recurrenceCorruption.recurring_series[0].time_zone = 'Not/A_Timezone';
      cases.push([recurrenceCorruption, /timezone/]);

      const orphan = clone(version6);
      const generated = orphan.recurring_occurrences.find(row => row.status === 'generated');
      for (const table of ['bill_months', 'income', 'transactions', 'transfers']) {
        orphan[table] = orphan[table].filter(row => row.recurring_occurrence_id !== generated.id);
      }
      cases.push([orphan, /exactly one destination/]);

      const foreignKey = clone(version6);
      foreignKey.transactions[0].account_id = 999999;
      cases.push([foreignKey, /ownership|account/]);

      for (const [payload, message] of cases) {
        const activeCookie = await authenticate();
        const before = databaseSnapshot();
        const response = await request('/api/backup/restore?mode=replace', {
          method: 'POST', cookie: activeCookie, body: payload,
        });
        assert.strictEqual(response.status, 400);
        assert.match(response.body.error, message);
        assert.deepStrictEqual(databaseSnapshot(), before);
      }
    });

    await test('constraint failures and interrupted restores roll back to the original database', async () => {
      backupRouter.restoreBackup(db, version6);
      const before = databaseSnapshot();
      const invalidForeignKey = clone(version6);
      invalidForeignKey.transactions[0].account_id = 999999;
      assert.throws(() => backupRouter.restoreBackup(db, invalidForeignKey), /ownership violation|FOREIGN KEY/);
      assert.deepStrictEqual(databaseSnapshot(), before);

      assert.throws(() => backupRouter.restoreBackup(db, version6, {
        beforeCommit() { throw new Error('simulated interrupted restore'); },
      }), /simulated interrupted restore/);
      assert.deepStrictEqual(databaseSnapshot(), before);
      assertIntegrity(version6);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (db.open) db.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  if (server.listening) server.close();
  if (db.open) db.close();
  process.exitCode = 1;
});
