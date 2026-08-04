const { test, expect } = require('@playwright/test');
const { loginTestUser } = require('./helpers/app');

async function submitInvalid(page, formSelector, inputSelector) {
  const dialogPromise = page.waitForEvent('dialog');
  await page.locator(inputSelector).evaluate(input => { input.value = '0'; });
  await page.locator(formSelector).evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('must be greater than zero');
  await dialog.accept();
}

test('finance forms surface strict backend errors and accept corrected values', async ({ page, request }) => {
  await loginTestUser(page, request);

  await page.locator('#sidebar [data-page="spending"]').click();
  await page.locator('#txnDesc').fill('Invalid amount check');
  await submitInvalid(page, '#txnForm', '#txnAmount');
  await expect(page.locator('#txnForm button[type="submit"]')).toBeEnabled();
  await page.locator('#txnAmount').fill('1.25');
  await page.locator('#txnDesc').fill(`Validation corrected ${Date.now()}`);
  await page.locator('#txnForm button[type="submit"]').click();
  await expect(page.locator('.spending-transaction').first()).toBeVisible();

  await page.locator('#sidebar [data-page="bills"]').click();
  await page.locator('#bName').fill('Invalid amount check');
  await submitInvalid(page, '#billForm', '#bAmount');
  await expect(page.locator('#billForm button[type="submit"]')).toBeEnabled();

  await page.locator('#sidebar [data-page="income"]').click();
  await page.locator('#incDesc').fill('Invalid amount check');
  await submitInvalid(page, '#incForm', '#incAmount');
  await expect(page.locator('#incForm button[type="submit"]')).toBeEnabled();

  await page.locator('#sidebar [data-page="transfers"]').click();
  if (await page.locator('#txfrFrom option').count() < 2) {
    await page.evaluate(async () => {
      await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Validation account ${Date.now()}`, type: 'current',
          colour: '#123456', opening_balance: 0 }) });
      await pages.transfers();
    });
  }
  const first = await page.locator('#txfrFrom option').nth(0).getAttribute('value');
  const second = await page.locator('#txfrTo option').nth(1).getAttribute('value');
  await page.locator('#txfrFrom').selectOption(first);
  await page.locator('#txfrTo').selectOption(second);
  await submitInvalid(page, '#txfrForm', '#txfrAmount');
  await expect(page.locator('#txfrForm button[type="submit"]')).toBeEnabled();
});
