const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Bills controls and cards adapt to the responsive viewport', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'bills');

  const name = `Mobile-${Date.now()} ${'with a long name '.repeat(6)}end`;
  await page.locator('#bName').fill(name);
  await page.locator('#bAmount').fill('64.20');
  await page.locator('#bDay').fill('27');
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();

  const viewport = page.viewportSize();
  const columns = await page.locator('#billForm').evaluate(
    form => new Set(
      [...form.querySelectorAll(':scope > .ui-field')]
        .map(field => Math.round(field.getBoundingClientRect().x)),
    ).size,
  );
  expect(columns).toBe(viewport.width <= 360 ? 1 : viewport.width <= 600 ? 2 : 3);

  for (const control of await page.locator('#billForm input, #billForm select, #billForm button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  for (const control of await page.locator('.bills-filter-bar select').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }

  const card = page.locator('.bills-card', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.locator('.bills-card-amount')).toBeVisible();
  await expect(card.locator('.bills-card-actions')).toBeVisible();
  expect(await card.locator('h3').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await expectNoHorizontalOverflow(page);
});
