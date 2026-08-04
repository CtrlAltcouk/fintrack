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

test('account dependency feedback remains usable on mobile', async ({ page, request }, testInfo) => {
  await loginTestUser(page, request);
  const name = `Mobile protected ${testInfo.project.name} ${Date.now()}`;
  await page.goto('/');
  const records = await page.evaluate(async name => {
    const account = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'current', colour: '#4a9eff', opening_balance: 0 }),
    }).then(response => response.json());
    const category = (await fetch('/api/categories').then(response => response.json()))[0];
    const transaction = await fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 5, description: 'Mobile protected dependency', category_id: category.id,
        account_id: account.id, date: new Date().toISOString().slice(0, 10),
      }),
    }).then(response => response.json());
    return { accountId: account.id, transactionId: transaction.id };
  }, name);
  await navigateToPage(page, 'accounts');
  await page.locator('.accounts-card', { hasText: name })
    .getByRole('button', { name: `Edit ${name}` }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  const modal = page.getByRole('dialog', { name: `Deactivate "${name}"?` });
  await modal.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Transactions: 1');
  await expectNoHorizontalOverflow(page);
  const box = await modal.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.evaluate(async ({ accountId, transactionId }) => {
    await fetch(`/api/transactions/${transactionId}`, { method: 'DELETE' });
    await fetch(`/api/accounts/${accountId}/deactivate`, { method: 'PATCH' });
  }, records);
});
