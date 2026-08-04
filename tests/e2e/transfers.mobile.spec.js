const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser, navigateToPage } = require('./helpers/app');

test('recurring transfer controls remain touch-friendly and contained', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'transfers');
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toBeVisible();
  await page.locator('#txfrRepeat').check();
  await expect(page.locator('#txfrRecurrenceFields')).toBeVisible();
  await page.locator('#txfrEndMode').selectOption('count');
  await expect(page.locator('#txfrCountField')).toBeVisible();

  for (const control of await page.locator(
    '#txfrForm input:visible, #txfrForm select:visible, #txfrForm button:visible'
  ).all()) {
    const box = await control.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
});
