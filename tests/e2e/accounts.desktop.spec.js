const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="accounts"]').click();
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
});

test('an account can be created, edited, and deactivated without changing its payload', async ({ page }) => {
  const originalName = `Travel ${'savings account '.repeat(7)}end`;
  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  await expect(page.locator('#accName')).toBeFocused();

  await page.locator('#accName').fill(originalName);
  await page.locator('#accType').selectOption('savings');
  await page.locator('#accOpening').fill('1200');
  await page.getByRole('button', { name: 'Use account colour #4ade80' }).click();
  await page.getByRole('button', { name: 'Save Account' }).click();

  let card = page.locator('.accounts-card', { hasText: originalName });
  await expect(card).toBeVisible();
  await expect(card.locator('.accounts-balance .ui-currency')).toHaveText('£1,200.00');
  await expect(card).toContainText('Opening balance £1,200.00');
  await expect(card).toContainText('Savings');
  expect(await card.locator('h3').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();

  await card.getByRole('button', { name: `Edit ${originalName}` }).click();
  await expect(page.locator('#accName')).toHaveValue(originalName);
  await expect(page.locator('#accType')).toHaveValue('savings');
  await expect(page.locator('#accOpening')).toHaveValue('1200');
  await expect(page.getByRole('button', { name: 'Use account colour #4ade80' })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#accName').fill('Travel Reserve');
  await page.locator('#accType').selectOption('current');
  await page.locator('#accOpening').fill('1500');
  await page.getByRole('button', { name: 'Use account colour #c39bd3' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();

  card = page.locator('.accounts-card', { hasText: 'Travel Reserve' });
  await expect(card).toBeVisible();
  await expect(card.locator('.accounts-balance .ui-currency')).toHaveText('£1,500.00');
  await expect(card).toContainText('Current account');
  const saved = await page.evaluate(async () => {
    const accounts = await fetch('/api/accounts').then(response => response.json());
    return accounts.find(account => account.name === 'Travel Reserve');
  });
  expect(saved).toMatchObject({
    name: 'Travel Reserve',
    type: 'current',
    opening_balance: 1500,
    colour: '#c39bd3',
    balance: 1500,
  });

  await card.getByRole('button', { name: 'Edit Travel Reserve' }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Deactivate "Travel Reserve"?' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('account balances still include transfers', async ({ page }) => {
  const names = { source: `Transfer source ${Date.now()}`, destination: `Transfer destination ${Date.now()}` };
  const ids = await page.evaluate(async names => {
    const create = (name, opening_balance) => fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'current', colour: '#4a9eff', opening_balance }),
    }).then(response => response.json());
    const [source, destination] = await Promise.all([
      create(names.source, 1000),
      create(names.destination, 100),
    ]);
    const transfer = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_account_id: source.id,
        to_account_id: destination.id,
        amount: 250,
        date: new Date().toISOString().slice(0, 10),
        note: 'Accounts regression transfer',
      }),
    }).then(response => response.json());
    return { source: source.id, destination: destination.id, transfer: transfer.id };
  }, names);

  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="accounts"]').click();
  await expect(page.locator('.accounts-card', { hasText: names.source }).locator('.accounts-balance .ui-currency'))
    .toHaveText('£750.00');
  await expect(page.locator('.accounts-card', { hasText: names.destination }).locator('.accounts-balance .ui-currency'))
    .toHaveText('£350.00');

  await page.evaluate(async ids => {
    await fetch(`/api/transfers/${ids.transfer}`, { method: 'DELETE' });
    await Promise.all([ids.source, ids.destination].map(id =>
      fetch(`/api/accounts/${id}/deactivate`, { method: 'PATCH' })
    ));
  }, ids);
  await expectNoHorizontalOverflow(page);
});

test('dependency conflicts stay in the dialog and show grouped counts', async ({ page }) => {
  const name = `Protected account ${Date.now()}`;
  await page.evaluate(async name => {
    const account = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'current', colour: '#4a9eff', opening_balance: 0 }),
    }).then(response => response.json());
    const category = (await fetch('/api/categories').then(response => response.json()))[0];
    await fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 5, description: 'Protected account dependency', category_id: category.id,
        account_id: account.id, date: new Date().toISOString().slice(0, 10),
      }),
    });
  }, name);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="accounts"]').click();
  const card = page.locator('.accounts-card', { hasText: name });
  await card.getByRole('button', { name: `Edit ${name}` }).click();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  const modal = page.getByRole('dialog', { name: `Deactivate "${name}"?` });
  await modal.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('alert')).toContainText('This account is still used by active items.');
  await expect(modal.getByRole('alert')).toContainText('Transactions: 1');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#accName')).toHaveValue(name);
});

test('the empty state opens the create form', async ({ page }) => {
  await page.route('**/api/accounts', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="accounts"]').click();

  const emptyState = page.locator('.accounts-empty-state');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.getByRole('heading', { name: 'No active accounts' })).toBeVisible();
  await emptyState.getByRole('button', { name: 'Add Account' }).click();
  await expect(page.locator('#accName')).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
