const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser, navigateToPage } = require('./helpers/app');

test('strict spending validation remains contained and keyboard accessible', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'spending');
  const amount = page.locator('#txnAmount');
  await expect(amount).toHaveAttribute('min', '0.01');
  await expect(amount).toHaveAttribute('max', '1000000000000');
  const submit = page.locator('#txnForm button[type="submit"]');
  const box = await submit.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await amount.focus();
  await expect(amount).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await page.locator('#txnDesc').fill('Invalid amount check');

  const dialogPromise = page.waitForEvent('dialog');
  await amount.evaluate(input => { input.value = '0'; });
  await page.locator('#txnForm').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('must be greater than zero');
  await dialog.accept();
  await expect(submit).toBeEnabled();
});
