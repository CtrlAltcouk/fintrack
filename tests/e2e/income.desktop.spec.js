const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="income"]').click();
  await expect(page.getByRole('heading', { name: 'Income', exact: true })).toBeVisible();
});

test('one-off income supports empty state, month navigation, add, and delete', async ({ page }) => {
  await page.evaluate(() => pages.income(1999, 1, 'oneoff'));

  const emptyState = page.locator('.income-entries-empty');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.getByRole('heading', { name: 'No income this month' })).toBeVisible();
  await emptyState.getByRole('button', { name: 'Add Income' }).click();
  await expect(page.locator('#incAmount')).toBeFocused();

  await page.locator('#incPrev').click();
  await expect(page.locator('.income-month-nav .month-label')).toHaveText('Dec 1998');
  await page.locator('#incNext').click();
  await expect(page.locator('.income-month-nav .month-label')).toHaveText('Jan 1999');

  const description = `Consulting ${'project payment '.repeat(8)}end`;
  await page.locator('#incAmount').fill('987.65');
  await page.locator('#incDesc').fill(description);
  await page.locator('#incAcct').selectOption({ label: 'Current Account' });
  await page.locator('#incDate').fill('1999-01-15');
  await page.locator('#incForm').getByRole('button', { name: 'Add Income', exact: true }).click();

  const card = page.locator('.income-entry-card', { hasText: description });
  await expect(card).toBeVisible();
  await expect(card.locator('.income-card-amount')).toHaveText('£987.65');
  await expect(card).toContainText('Current Account');
  await expect(card).toContainText('One-off');
  expect(await card.locator('h3').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();

  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: `Delete ${description}` }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.income-entries-empty')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('recurring income preserves schedule values through edit and deactivate', async ({ page }) => {
  await page.evaluate(async () => {
    const schedules = await fetch('/api/income/schedules').then(response => response.json());
    await Promise.all(schedules.filter(schedule => schedule.active).map(schedule =>
      fetch(`/api/income/schedules/${schedule.id}/deactivate`, { method: 'PATCH' })
    ));
  });
  await page.getByRole('button', { name: 'Recurring schedules' }).click();

  const emptyState = page.locator('.income-schedules-empty');
  await expect(emptyState).toBeVisible();
  await emptyState.getByRole('button', { name: 'Add Recurring Income' }).click();
  await expect(page.locator('#schedName')).toBeFocused();

  const originalName = `Monthly ${'salary source '.repeat(7)}end`;
  await page.locator('#schedName').fill(originalName);
  await page.locator('#schedAmount').fill('2500');
  await page.locator('#schedFreq').selectOption('monthly');
  await page.locator('#schedDay').fill('15');
  await page.locator('#schedAcct').selectOption({ label: 'Current Account' });
  await page.locator('#incSchedForm').getByRole('button', { name: 'Add Schedule' }).click();

  let card = page.locator('.income-schedule-card', { hasText: originalName });
  await expect(card).toBeVisible();
  await expect(page.locator('.income-summary-card').filter({ hasText: 'Recurring sources' }).locator('.value')).toHaveText('1');
  await expect(card.locator('.income-card-amount')).toHaveText('£2,500.00');
  await expect(card).toContainText('Day 15 each month');
  await expect(card).toContainText('Current Account');
  await expect(card).toContainText('Active');

  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.locator('.income-schedule-edit');
  await expect(edit).toBeVisible();
  await expect(edit.locator('[id^="sedit-freq-"]')).toHaveValue('monthly');
  await expect(edit.locator('[id^="sedit-acct-"]')).toHaveValue(
    await page.locator('#schedAcct option', { hasText: 'Current Account' }).getAttribute('value'),
  );
  await expect(edit.locator('[id^="sedit-endmode-"]')).toHaveValue('never');

  await edit.locator('[id^="sedit-name-"]').fill('Weekly salary');
  await edit.locator('[id^="sedit-amount-"]').fill('2600');
  await edit.locator('[id^="sedit-freq-"]').selectOption('weekly');
  await edit.locator('[id^="sedit-anchor-"]').fill('2026-07-03');
  await edit.locator('[id^="sedit-endmode-"]').selectOption('count');
  await edit.locator('[id^="sedit-endcount-"]').fill('12');
  await edit.getByRole('button', { name: 'Save Changes' }).click();

  card = page.locator('.income-schedule-card', { hasText: 'Weekly salary' });
  await expect(card).toBeVisible();
  await expect(card.locator('.income-card-amount')).toHaveText('£2,600.00');
  await expect(card).toContainText('Weekly from 2026-07-03');
  await expect(card).toContainText('12 occurrences');
  await expect(card).toContainText('Current Account');

  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: 'Stop recurring' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.income-schedules-empty')).toBeVisible();
  await expect(page.locator('.income-summary-card').filter({ hasText: 'Recurring sources' }).locator('.value')).toHaveText('0');
  const savedSchedule = await page.evaluate(async () => {
    const schedules = await fetch('/api/income/schedules').then(response => response.json());
    return schedules.find(schedule => schedule.name === 'Weekly salary');
  });
  expect(savedSchedule.active).toBe(0);
  expect(savedSchedule.frequency).toBe('weekly');
  expect(savedSchedule.anchor_date).toBe('2026-07-03');
  await expectNoHorizontalOverflow(page);
});

test('recurring income supports end counts, pause, resume, and skip', async ({ page }) => {
  await page.getByRole('button', { name: 'Recurring schedules' }).click();
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const name = `Daily income lifecycle ${Date.now()}`;

  await page.locator('#schedName').fill(name);
  await page.locator('#schedAmount').fill('45.67');
  await page.locator('#schedFreq').selectOption('daily');
  await page.locator('#schedAnchor').fill(startDate);
  await page.locator('#schedAcct').selectOption({ label: 'Current Account' });
  await page.locator('#schedEndMode').selectOption('count');
  await page.locator('#schedEndCount').fill('1');
  await page.locator('#incSchedForm').getByRole('button', { name: 'Add Schedule' }).click();

  let card = page.locator('.income-schedule-card', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText('1 occurrence');

  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: 'Pause' }).click();
  card = page.locator('.income-schedule-card', { hasText: name });
  await expect(card).toContainText('Paused');
  await card.getByRole('button', { name: 'Resume' }).click();
  card = page.locator('.income-schedule-card', { hasText: name });
  await expect(card.getByRole('button', { name: 'Pause' })).toBeVisible();

  const entry = page.locator('.income-entry-card', { hasText: name }).first();
  await expect(entry).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await entry.getByRole('button', { name: new RegExp(`Skip ${name}`) }).click();
  await expect(page.locator('.income-entry-card', { hasText: name })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
