const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser } = require('./helpers/app');

test('desktop sidebar navigation remains available', async ({ page, request }) => {
  await loginTestUser(page, request);
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeHidden();

  await page.locator('#sidebar [data-page="spending"]').click();
  await expect(page.getByRole('heading', { name: 'Daily Spending' })).toBeVisible();
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByRole('heading', { name: 'Bills' })).toBeVisible();
  await page.locator('#sidebar [data-page="income"]').click();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
