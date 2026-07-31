const { test, expect } = require('@playwright/test');
const {
  expectLastControlClearOfBottomNav,
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Settings sections and controls adapt to the responsive viewport', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  const viewport = page.viewportSize();
  await expect(page.locator('.settings-tabs')).toBeVisible();
  await expect(page.locator('.settings-category-item')).not.toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Personalisation' }).click();
  const columns = await page.locator('.settings-personalisation-grid').evaluate(
    grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(viewport.width <= 768 ? 1 : 2);

  for (const control of await page.locator('.settings-content button, .settings-content input, .settings-content select').all()) {
    const box = await control.boundingBox();
    if (box) {
      const descriptor = await control.evaluate(element =>
        `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
      );
      expect(box.height, descriptor).toBeGreaterThanOrEqual(44);
    }
  }
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'System' }).click();
  await expect(page.getByRole('heading', { name: 'Restart application' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectLastControlClearOfBottomNav(page);
});
