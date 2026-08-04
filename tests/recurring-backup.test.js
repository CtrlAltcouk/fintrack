const assert = require('assert');
const backupRouter = require('../routes/backup');

function run() {
  const backup = {
    meta: { app: 'outflow' },
    bills: [{
      id: 4, user_id: 2, name: 'Rent', amount: 900, due_day: 31,
      active: 1, cancelled_at: null, created_at: '2025-01-01 10:00:00',
    }],
    bill_months: [
      { id: 8, bill_id: 4, year: 2025, month: 1, paid: 1 },
      { id: 9, bill_id: 4, year: 2025, month: 3, paid: 0 },
    ],
  };

  const upgraded = backupRouter.upgradeLegacyBackup(backup);
  assert.strictEqual(upgraded.recurring_series.length, 1);
  assert.strictEqual(upgraded.recurring_occurrences.length, 2);
  assert.strictEqual(upgraded.bills[0].recurring_series_id, 1);
  assert.strictEqual(upgraded.bill_months[0].id, 8);
  assert.strictEqual(upgraded.bill_months[0].due_date, '2025-01-31');
  assert.strictEqual(upgraded.bill_months[1].due_date, '2025-03-31');
  assert.strictEqual(upgraded.recurring_series[0].next_sequence, 4);
  assert.strictEqual(upgraded.recurring_series[0].next_due_date, '2025-04-30');
  assert.strictEqual(backup.bills[0].recurring_series_id, undefined);
  console.log('\u2713 legacy backups are upgraded without changing bill-month IDs or history');

  const incomeBackup = {
    recurring_series: [], recurring_occurrences: [],
    income_schedules: [{
      id: 3, user_id: 2, name: 'Salary', amount: 2500, frequency: 'monthly',
      day_of_month: 31, anchor_date: null, active: 1,
      created_at: '2025-01-01 00:00:00', account_id: 7,
    }],
    income: [{
      id: 10, user_id: 2, amount: 2500, description: 'Salary', date: '2025-01-31',
      source_schedule_id: 3, account_id: 7, created_at: '2025-01-01 00:00:00',
    }],
  };
  const incomeUpgraded = backupRouter.upgradeIncomeBackup(incomeBackup);
  assert.strictEqual(incomeUpgraded.income_schedules[0].id, 3);
  assert.strictEqual(incomeUpgraded.income[0].id, 10);
  assert.ok(incomeUpgraded.income_schedules[0].recurring_series_id);
  assert.ok(incomeUpgraded.income[0].recurring_occurrence_id);
  assert.strictEqual(incomeUpgraded.recurring_series[0].kind, 'income');
  assert.strictEqual(incomeUpgraded.recurring_occurrences[0].scheduled_date, '2025-01-31');
  assert.strictEqual(incomeBackup.income_schedules[0].recurring_series_id, undefined);
  console.log('\u2713 pre-v3 income backups preserve schedule and income IDs');

  const transactionBackup = {
    transactions: [{ id: 12, user_id: 2, amount: 5, description: 'Legacy',
      category_id: 4, account_id: 7, date: '2026-01-01' }],
  };
  const transactionUpgraded = backupRouter.upgradeTransactionBackup(transactionBackup);
  assert.deepStrictEqual(transactionUpgraded.recurring_transaction_templates, []);
  assert.strictEqual(transactionUpgraded.transactions[0].recurring_occurrence_id, null);
  assert.strictEqual(transactionBackup.transactions[0].recurring_occurrence_id, undefined);
  console.log('\u2713 pre-v5 backups gain empty transaction recurrence data without changing history');

  const transferBackup = {
    transfers: [{ id: 15, user_id: 2, from_account_id: 7, to_account_id: 8,
      amount: 25, date: '2026-08-01', note: 'Legacy transfer' }],
  };
  const transferUpgraded = backupRouter.upgradeTransferBackup(transferBackup);
  assert.deepStrictEqual(transferUpgraded.recurring_transfer_templates, []);
  assert.strictEqual(transferUpgraded.transfers[0].recurring_occurrence_id, null);
  assert.strictEqual(transferBackup.transfers[0].recurring_occurrence_id, undefined);
  console.log('\u2713 pre-v6 backups gain empty transfer recurrence data without changing history');
}

try {
  run();
  console.log('\n4 recurring-backup tests passed.');
} catch (error) {
  console.error('\u2717 recurring-backup test failed:', error);
  process.exitCode = 1;
}
