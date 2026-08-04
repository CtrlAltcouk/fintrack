const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser } = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="transfers"]').click();
  await expect(page.getByRole('heading', { name: 'Transfers', exact: true })).toBeVisible();
});

test('recurring transfer supports execution, edit scopes, lifecycle, and occurrence deletion', async ({ page }) => {
  const note = `Recurring transfer ${Date.now()}`;
  if (await page.locator('#txfrFrom option').count() < 2) {
    await page.evaluate(async () => {
      const response = await fetch('/api/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Transfer destination ${Date.now()}`, type: 'current',
          colour: '#4a9eff', opening_balance: 100,
        }),
      });
      if (!response.ok) throw new Error(`account setup failed: ${response.status}`);
      await pages.transfers();
    });
  }
  const options = page.locator('#txfrFrom option');
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  const from = await options.nth(0).getAttribute('value');
  const to = await options.nth(1).getAttribute('value');
  await page.locator('#txfrFrom').selectOption(from);
  await page.locator('#txfrTo').selectOption(to);
  await page.locator('#txfrAmount').fill('18.50');
  await page.locator('#txfrNote').fill(note);
  await page.locator('#txfrRepeat').check();
  await page.locator('#txfrFrequency').selectOption('daily');
  await page.locator('#txfrEndMode').selectOption('count');
  await page.locator('#txfrOccurrenceCount').fill('4');
  await page.locator('#txfrForm').getByRole('button', { name: 'Transfer', exact: true }).click();

  let series = page.locator('.transfers-recurring-item', { hasText: note });
  await expect(series).toBeVisible();
  await page.evaluate(async () => {
    const response = await fetch('/api/recurring/runner/run', { method: 'POST' });
    if (!response.ok) throw new Error(`runner failed: ${response.status}`);
  });
  await page.evaluate(() => pages.transfers());

  let row = page.locator('.transfers-item', { hasText: note });
  await expect(row).toBeVisible();
  let rowId = await row.getAttribute('id');
  await row.getByRole('button', { name: 'Edit' }).click();
  row = page.locator(`#${rowId}`);
  await row.locator('#editTxfrScope').selectOption('future');
  await row.locator('#editTxfrAmount').fill('20.00');
  await row.locator('#editTxfrNote').fill(`${note} future`);
  await row.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.transfers-recurring-item', { hasText: `${note} future` })).toBeVisible();

  row = page.locator('.transfers-item', { hasText: `${note} future` });
  rowId = await row.getAttribute('id');
  await row.getByRole('button', { name: 'Edit' }).click();
  row = page.locator(`#${rowId}`);
  await row.locator('#editTxfrScope').selectOption('single');
  await row.locator('#editTxfrAmount').fill('21.00');
  await row.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.transfers-item', { hasText: `${note} future` }).locator('.amount')).toHaveText('£21.00');

  series = page.locator('.transfers-recurring-item', { hasText: `${note} future` });
  await series.getByRole('button', { name: 'Pause' }).click();
  series = page.locator('.transfers-recurring-item', { hasText: `${note} future` });
  await expect(series.getByRole('button', { name: 'Resume' })).toBeVisible();
  await series.getByRole('button', { name: 'Resume' }).click();
  series = page.locator('.transfers-recurring-item', { hasText: `${note} future` });
  await series.getByRole('button', { name: 'Skip next' }).click();
  series = page.locator('.transfers-recurring-item', { hasText: `${note} future` });
  page.once('dialog', dialog => dialog.accept());
  await series.getByRole('button', { name: 'Stop recurring' }).click();
  await expect(page.locator('.transfers-recurring-item', { hasText: `${note} future` })).toHaveCount(0);

  row = page.locator('.transfers-item', { hasText: `${note} future` });
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
