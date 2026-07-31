const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Accounts cards and create form adapt to the responsive viewport', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();

  await expect(page.locator('.accounts-card')).not.toHaveCount(0);
  await expect(page.locator('.accounts-balance')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  const viewport = page.viewportSize();
  const columns = await page.locator('.accounts-form-grid').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(viewport.width <= 360 ? 1 : 2);

  for (const control of await page.locator('.accounts-form-card input, .accounts-form-card select, .accounts-form-card button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('.accounts-colour-swatch')).toHaveCount(6);
  await expectNoHorizontalOverflow(page);
});
