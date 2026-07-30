const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Daily Spending controls and empty state adapt to the mobile viewport', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'spending');
  await expect(page.getByRole('heading', { name: 'Daily Spending', exact: true })).toBeVisible();
  await page.evaluate(() => pages.spending(1999, 1));

  const viewport = page.viewportSize();
  const columns = await page.locator('#txnForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(viewport.width <= 360 ? 1 : viewport.width <= 430 ? 2 : 3);

  for (const control of await page.locator('#txnForm input, #txnForm select, #txnForm button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  for (const chip of await page.locator('.spending-filter-chip').all()) {
    expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }

  await expect(page.locator('.spending-empty-state')).toBeVisible();
  await expect(page.locator('#emptyAddTxn')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
