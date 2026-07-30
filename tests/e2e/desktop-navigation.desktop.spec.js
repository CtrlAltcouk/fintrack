const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser } = require('./helpers/app');

test('desktop sidebar navigation remains available', async ({ page, request }) => {
  await loginTestUser(page, request);
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeHidden();

  await expect(page.locator('.dashboard-summary-grid .dashboard-stat')).toHaveCount(3);
  await expect(page.locator('.dashboard-card')).toHaveCount(4);
  const barBox = await page.locator('[data-widget="bar_chart"]').boundingBox();
  const donutBox = await page.locator('[data-widget="donut_chart"]').boundingBox();
  expect(Math.abs(donutBox.y - barBox.y)).toBeLessThanOrEqual(1);
  expect(donutBox.x).toBeGreaterThan(barBox.x);
  await expectNoHorizontalOverflow(page);

  await page.locator('#sidebar [data-page="spending"]').click();
  await expect(page.getByRole('heading', { name: 'Daily Spending' })).toBeVisible();
  await expect(page.locator('#txnForm')).toHaveCSS('display', 'grid');
  expect((await page.locator('#txnForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  ))).toBeGreaterThanOrEqual(6);
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByRole('heading', { name: 'Bills', exact: true })).toBeVisible();
  await page.locator('#sidebar [data-page="income"]').click();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('dashboard editor persists visibility, order, and size changes', async ({ page, request }) => {
  await loginTestUser(page, request);

  await page.getByRole('button', { name: /Edit/ }).click();
  await page.locator('.dash-widget[data-widget="accounts"] .dash-remove-btn').click();
  await expect(page.locator('.dash-ghost[data-widget="accounts"]')).toBeVisible();
  await page.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByRole('heading', { name: 'Account balances' })).toHaveCount(0);

  await page.locator('#sidebar [data-page="spending"]').click();
  await expect(page.getByRole('heading', { name: 'Daily Spending' })).toBeVisible();
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await expect(page.locator('.dashboard-grid > [data-widget]')).not.toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Account balances' })).toHaveCount(0);

  await page.getByRole('button', { name: /Edit/ }).click();
  await page.locator('.dash-ghost[data-widget="accounts"] .dash-restore-btn').click();
  const accounts = page.locator('.dash-widget[data-widget="accounts"]');
  const stats = page.locator('.dash-widget[data-widget="stats"]');
  await accounts.dragTo(stats);

  const handle = page.locator('.dash-resize-handle[data-widget="bar_chart"]');
  await handle.click();
  const threeByTwo = page.locator('.dash-picker-cell[data-w="3"][data-h="2"]');
  await threeByTwo.dispatchEvent('mousemove', { bubbles: true });
  await threeByTwo.dispatchEvent('mouseup', { bubbles: true, button: 0 });
  await expect(page.locator('.dash-widget[data-widget="bar_chart"]'))
    .toHaveAttribute('style', /--dash-w:3;--dash-h:2/);

  await page.getByRole('button', { name: /Done/ }).click();
  await page.locator('#sidebar [data-page="spending"]').click();
  await expect(page.getByRole('heading', { name: 'Daily Spending' })).toBeVisible();
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await expect(page.locator('.dashboard-grid > [data-widget]')).not.toHaveCount(0);
  const savedOrder = await page.locator('.dashboard-grid > [data-widget]').evaluateAll(
    widgets => widgets.map(widget => widget.dataset.widget),
  );
  expect(savedOrder.slice(0, 2)).toEqual(['accounts', 'stats']);
  await expect(page.locator('[data-widget="bar_chart"]'))
    .toHaveAttribute('style', /--dash-w:3;--dash-h:2/);

  const lifecycle = await page.evaluate(() => window.__chartLifecycle);
  expect(lifecycle.created).toBeGreaterThanOrEqual(4);
  expect(lifecycle.destroyed).toBeGreaterThanOrEqual(2);

  // Restore the default layout so this test leaves no surprising saved state.
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.locator('.dash-widget[data-widget="stats"]')
    .dragTo(page.locator('.dash-widget[data-widget="accounts"]'));
  const resetHandle = page.locator('.dash-resize-handle[data-widget="bar_chart"]');
  await resetHandle.click();
  const twoByOne = page.locator('.dash-picker-cell[data-w="2"][data-h="1"]');
  await twoByOne.dispatchEvent('mousemove', { bubbles: true });
  await twoByOne.dispatchEvent('mouseup', { bubbles: true, button: 0 });
  await page.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByRole('heading', { name: 'Account balances' })).toBeVisible();
});

test('calendar switches between monthly and configured pay-period modes', async ({ page, request }) => {
  await loginTestUser(page, request);
  await expect(page.locator('.dashboard-calendar .cal-title')).toContainText(/\w+ \d{4}/);

  const schedule = await page.evaluate(async () => {
    const accounts = await fetch('/api/accounts').then(response => response.json());
    const response = await fetch('/api/income/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dashboard calendar test salary',
        amount: 2500,
        frequency: 'monthly',
        day_of_month: 15,
        account_id: accounts[0].id,
      }),
    });
    return response.json();
  });
  await page.evaluate(async scheduleId => {
    await fetch('/api/settings/pay-period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_schedule_id: scheduleId }),
    });
  }, schedule.id);

  await page.getByRole('button', { name: 'Pay Period' }).click();
  await expect(page.getByRole('button', { name: 'Pay Period' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dashboard-calendar .cal-title')).toContainText('–');
  await expect(page.locator('.dashboard-notice')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Monthly' }).click();
  await expect(page.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dashboard-calendar .cal-title')).toContainText(/\w+ \d{4}/);
});
