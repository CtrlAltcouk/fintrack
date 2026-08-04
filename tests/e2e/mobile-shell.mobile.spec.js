const { test, expect } = require('@playwright/test');
const {
  expectLastControlClearOfBottomNav,
  expectNoHorizontalOverflow,
  expectReachable,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
});

test('mobile shell, key pages, scrolling, and navigation remain reachable', async ({ page }) => {
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#bottom-nav')).toBeVisible();

  for (const [pageName, heading] of [
    ['dashboard', 'Dashboard'],
    ['spending', 'Daily Spending'],
    ['bills', 'Bills'],
    ['income', 'Income'],
  ]) {
    await navigateToPage(page, pageName);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectReachable(page, page.locator('#main button:visible').first());
    await expectLastControlClearOfBottomNav(page);
  }
});

test('More sheet opens, closes, traps state, and navigates', async ({ page }) => {
  const more = page.locator('#more-btn');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#more-sheet')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#more-sheet')).toBeVisible();

  await page.locator('#more-sheet-close').click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#more-sheet')).toHaveAttribute('aria-hidden', 'true');

  await more.click();
  await page.locator('#more-sheet [data-page="accounts"]').click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.locator('#more-sheet')).toHaveAttribute('aria-hidden', 'true');
  await expectNoHorizontalOverflow(page);
});

test('shared headers, forms, cards, stats, lists, and tabs stay contained', async ({ page }) => {
  const longValue = '£12,345,678,901.23';
  await page.locator('.stat-card .value').first().evaluate((element, value) => {
    element.textContent = value;
  }, longValue);
  const statValue = page.locator('.stat-card .value').first();
  await expect(statValue).toHaveText(longValue);
  expect(await statValue.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await expectNoHorizontalOverflow(page);

  await navigateToPage(page, 'spending');
  await page.locator('.page-title').evaluate(element => {
    element.textContent = 'Daily Spending With A Deliberately Long Responsive Heading';
  });
  await expectNoHorizontalOverflow(page);

  const formBox = await page.locator('#txnForm').boundingBox();
  for (const control of await page.locator(
    '#txnForm input:visible, #txnForm select:visible, #txnForm button:visible'
  ).all()) {
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(formBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(formBox.x + formBox.width + 1);
  }

  const longDescription = `Long-${'description-'.repeat(14)}end`;
  await page.locator('#txnAmount').fill('12.34');
  await page.locator('#txnDesc').fill(longDescription);
  await page.locator('#txnForm').getByRole('button', { name: 'Add Transaction', exact: true }).click();
  const row = page.locator('.list-item', { hasText: longDescription }).last();
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(row.getByRole('button', { name: /Delete/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await navigateToPage(page, 'settings');
  const tabs = page.locator('.tabs-nav');
  await expect(tabs).toBeVisible();
  for (const tab of await tabs.locator('.tab-btn').all()) {
    expect((await tab.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
});

test('dashboard hierarchy adapts without changing widget content', async ({ page }) => {
  await expect(page.locator('.dashboard-summary-grid .dashboard-stat')).toHaveCount(3);
  await expect(page.locator('.dashboard-card')).toHaveCount(4);
  await expect(page.locator('.dashboard-calendar')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const viewport = page.viewportSize();
  const barWidget = page.locator('[data-widget="bar_chart"]');
  const donutWidget = page.locator('[data-widget="donut_chart"]');
  const barBox = await barWidget.boundingBox();
  const donutBox = await donutWidget.boundingBox();

  if (viewport.width <= 600) {
    expect(donutBox.y).toBeGreaterThan(barBox.y + 1);
    expect(Math.abs(donutBox.width - barBox.width)).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs(donutBox.y - barBox.y)).toBeLessThanOrEqual(1);
    expect(donutBox.x).toBeGreaterThan(barBox.x);
  }

  for (const frame of await page.locator('.dashboard-chart-frame').all()) {
    const box = await frame.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThanOrEqual(220);
  }
});

test('a confirmation modal remains visible and dismissible', async ({ page }) => {
  await navigateToPage(page, 'bills');
  const billName = `Mobile modal bill ${Date.now()}`;
  await page.locator('#bName').fill(billName);
  await page.locator('#bAmount').fill('10');
  await page.locator('#bDay').fill('20');
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();

  const cancelButton = page.locator('.bills-card', { hasText: billName })
    .getByRole('button', { name: 'Cancel', exact: true });
  await cancelButton.click();
  const modal = page.locator('.modal');
  await expectReachable(page, modal);
  expect(await modal.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  await expect(modal).toHaveAttribute('role', 'dialog');
  const keepButton = modal.getByRole('button', { name: 'Keep it' });
  await expect(keepButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(cancelButton).toBeFocused();

  await cancelButton.click();
  await modal.getByRole('button', { name: 'Keep it' }).click();
  await expect(modal).toHaveCount(0);
});
