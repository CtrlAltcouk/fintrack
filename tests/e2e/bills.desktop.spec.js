const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

async function cancelAllActiveBills(page) {
  await page.evaluate(async () => {
    const now = new Date();
    const bills = await fetch(`/api/bills?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .then(response => response.json());
    await Promise.all(bills.filter(bill => bill.active).map(bill => fetch(`/api/bills/${bill.id}/cancel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    })));
  });
}

async function createBill(page, values) {
  return page.evaluate(async bill => {
    const [categories, accounts] = await Promise.all([
      fetch('/api/categories').then(response => response.json()),
      fetch('/api/accounts').then(response => response.json()),
    ]);
    const response = await fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bill.name,
        amount: bill.amount,
        due_day: bill.dueDay,
        category_id: categories[0].id,
        account_id: accounts[0].id,
        ...(bill.recurrence ? { recurrence: bill.recurrence } : {}),
      }),
    });
    return response.json();
  }, values);
}

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByRole('heading', { name: 'Bills', exact: true })).toBeVisible();
});

test('empty state explains recurring bills and focuses the add form', async ({ page }) => {
  await cancelAllActiveBills(page);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();

  const emptyState = page.locator('.bills-empty-state');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.getByRole('heading', { name: 'No active bills yet' })).toBeVisible();
  await expect(emptyState).toContainText('monthly commitments');

  await page.locator('#emptyAddBill').click();
  await expect(page.locator('#bName')).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('bills expose overdue, due-today, upcoming, and paid states', async ({ page }) => {
  await cancelAllActiveBills(page);
  const now = new Date();
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), 15, 12));
  const prefix = `Status-${Date.now()}`;
  const recurrence = dueDay => ({
    frequency: 'monthly',
    start_date: `${now.getFullYear()}-01-${String(dueDay).padStart(2, '0')}`,
    end_mode: 'never',
  });
  await createBill(page, { name: `${prefix}-overdue`, amount: 10, dueDay: 1, recurrence: recurrence(1) });
  await createBill(page, { name: `${prefix}-today`, amount: 20, dueDay: 15, recurrence: recurrence(15) });
  await createBill(page, { name: `${prefix}-upcoming`, amount: 30, dueDay: 16, recurrence: recurrence(16) });
  await createBill(page, { name: `${prefix}-paid`, amount: 40, dueDay: 2, recurrence: recurrence(2) });

  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();
  const paidCard = page.locator('.bills-card', { hasText: `${prefix}-paid` });
  page.once('dialog', dialog => dialog.accept('40'));
  await paidCard.getByRole('button', { name: 'Mark Paid' }).click();

  await expect(page.locator('.bills-card', { hasText: `${prefix}-overdue` })).toContainText('Overdue');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-today` })).toContainText('Due today');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-upcoming` })).toContainText('Upcoming');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-paid` })).toContainText('Paid');

  await page.locator('#billStatusFilter').selectOption('paid');
  await expect(page.locator('#billStatusFilter')).toHaveValue('paid');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-paid` })).toBeVisible();
  await expect(page.locator('.bills-card', { hasText: `${prefix}-overdue` })).toHaveCount(0);
});

test('a long bill can be added, scanned, paid, and cancelled', async ({ page }) => {
  const name = `Long bill ${'description segment '.repeat(8)}end`;
  await page.locator('#bName').fill(name);
  await page.locator('#bAmount').fill('123.45');
  await page.locator('#bDay').fill('28');
  await page.locator('#bCat').selectOption({ label: 'Housing' });
  await page.locator('#bAcct').selectOption({ label: 'Current Account' });
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();

  let card = page.locator('.bills-card', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.locator('.bills-card-amount')).toHaveText('£123.45');
  await expect(card).toContainText('Current Account');
  await expect(card).toContainText('Housing');
  await expect(card).toContainText('Monthly');
  expect(await card.locator('h3').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();

  page.once('dialog', dialog => dialog.accept('123.45'));
  await card.getByRole('button', { name: 'Mark Paid' }).click();
  card = page.locator('.bills-card', { hasText: name });
  await expect(card).toContainText('Paid');

  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel Bill' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.bills-cancelled-item', { hasText: name })).toBeVisible();
});

test('desktop layout remains compact and contained', async ({ page }) => {
  const columns = await page.locator('#billForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBeGreaterThanOrEqual(6);
  await expect(page.locator('.bills-filter-bar')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('future four-weekly pay anchor shows the current Bills period and shared Dashboard period', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-16T12:00:00Z'));
  await cancelAllActiveBills(page);
  const fixture = await page.evaluate(async () => {
    const accounts = await fetch('/api/accounts').then(response => response.json());
    const scheduleResponse = await fetch('/api/income/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Future Pay ${Date.now()}`,
        amount: 1844.33,
        frequency: 'monthly',
        day_of_month: 15,
        account_id: accounts[0].id,
      }),
    });
    const original = await scheduleResponse.json();
    await fetch('/api/income?year=2026&month=8');
    await fetch(`/api/income/schedules/${original.id}/deactivate`, { method: 'PATCH' });
    const schedule = await fetch(`/api/income/schedules/${original.id}/restore`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: original.name,
        amount: original.amount,
        frequency: 'four_weekly',
        anchor_date: '2026-09-12',
        account_id: accounts[0].id,
        recurrence: {
          frequency: 'four_weekly', start_date: '2026-09-12', end_mode: 'never',
        },
      }),
    }).then(response => response.json());
    await fetch('/api/settings/pay-period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'pay_period', primary_schedule_id: schedule.id }),
    });
    return {
      schedule,
      originalScheduleId: original.id,
      originalSeriesId: original.recurring_series_id,
    };
  });

  expect(fixture.schedule.id).toBe(fixture.originalScheduleId);
  expect(fixture.schedule.active).toBe(1);
  expect(fixture.schedule.recurring_series_id).not.toBe(fixture.originalSeriesId);

  const insideName = `Inside period ${Date.now()}`;
  const outsideName = `Outside period ${Date.now()}`;
  await createBill(page, {
    name: insideName, amount: 123.45, dueDay: 20,
    recurrence: { frequency: 'monthly', start_date: '2026-01-20', end_mode: 'never' },
  });
  await createBill(page, {
    name: outsideName, amount: 67.89, dueDay: 12,
    recurrence: { frequency: 'monthly', start_date: '2026-01-12', end_mode: 'never' },
  });

  await page.locator('#sidebar [data-page="settings"]').click();
  await page.getByRole('button', { name: 'Personalisation' }).click();
  await expect(page.locator('#settingsPrimarySchedule')).toHaveValue(String(fixture.schedule.id));
  await expect(page.locator('#settingsPrimarySchedule option:checked')).toContainText('Future Pay');

  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.locator('.bills-month-nav .month-label')).toHaveText('15 Aug – 11 Sep');
  await expect(page.locator('.bills-card', { hasText: insideName })).toBeVisible();
  await expect(page.locator('.bills-card', { hasText: outsideName })).toHaveCount(0);
  await expect(page.locator('.bills-total')).toContainText('£123.45');
  await expect(page.getByText(/primary pay schedule|cannot currently be used/)).toHaveCount(0);

  await page.locator('#sidebar [data-page="dashboard"]').click();
  await expect(page.locator('.dashboard-calendar .cal-title')).toHaveText('15 Aug – 11 Sep');
  await expect(page.locator('.dashboard-notice')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => fetch('/api/settings/pay-period', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'monthly' }),
  }));
});

test('Bills distinguishes unconfigured, unavailable, stopped, and unsupported pay schedules', async ({ page }) => {
  await page.evaluate(() => fetch('/api/settings/pay-period', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'pay_period', primary_schedule_id: null }),
  }));
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByText('Choose a primary pay schedule in Settings.')).toBeVisible();

  const schedules = await page.evaluate(async () => {
    const accounts = await fetch('/api/accounts').then(response => response.json());
    const create = body => fetch('/api/income/schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, account_id: accounts[0].id, ...body }),
    }).then(response => response.json());
    return {
      unavailable: await create({ name: `Unavailable ${Date.now()}`, frequency: 'monthly', day_of_month: 20 }),
      stopped: await create({ name: `Stopped ${Date.now()}`, frequency: 'monthly', day_of_month: 15 }),
      unsupported: await create({ name: `Unsupported ${Date.now()}`, frequency: 'daily', anchor_date: '2026-08-16' }),
    };
  });

  await page.evaluate(async id => {
    await fetch('/api/settings/pay-period', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_schedule_id: id }),
    });
    await fetch(`/api/income/schedules/${id}/deactivate`, { method: 'PATCH' });
  }, schedules.unavailable.id);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByText('The selected primary pay schedule is unavailable. Choose another schedule.')).toBeVisible();

  await page.evaluate(async id => {
    const now = new Date();
    await fetch(`/api/income?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`);
    await fetch('/api/settings/pay-period', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_schedule_id: id }),
    });
    await fetch(`/api/income/schedules/${id}/deactivate`, { method: 'PATCH' });
  }, schedules.stopped.id);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByText('The selected primary pay schedule is stopped. Restore it or choose another schedule.')).toBeVisible();

  await page.evaluate(id => fetch('/api/settings/pay-period', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary_schedule_id: id }),
  }), schedules.unsupported.id);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByText('The selected schedule cannot currently be used for Pay Period view.')).toBeVisible();

  await page.evaluate(() => fetch('/api/settings/pay-period', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'monthly', primary_schedule_id: null }),
  }));
});

test('a recurring bill can be created, skipped, paused, and resumed', async ({ page }) => {
  await cancelAllActiveBills(page);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();

  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const name = `Daily lifecycle ${Date.now()}`;
  await page.locator('#bName').fill(name);
  await page.locator('#bAmount').fill('12.34');
  await page.locator('#bDay').fill('1');
  await page.locator('#bFrequency').selectOption('daily');
  await page.locator('#bStartDate').fill(startDate);
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();

  let cards = page.locator('.bills-card', { hasText: name });
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toContainText('Daily');

  page.once('dialog', dialog => dialog.accept());
  await cards.first().getByRole('button', { name: 'Pause' }).click();
  cards = page.locator('.bills-card', { hasText: name });
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Paused');
  await cards.first().getByRole('button', { name: 'Resume' }).click();
  cards = page.locator('.bills-card', { hasText: name });
  await expect(cards.first().getByRole('button', { name: 'Pause' })).toBeVisible();
  const countBeforeSkip = await cards.count();
  page.once('dialog', dialog => dialog.accept());
  await cards.first().getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.bills-card', { hasText: name })).toHaveCount(countBeforeSkip - 1);
  await expectNoHorizontalOverflow(page);
});
