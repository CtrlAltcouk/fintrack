const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="spending"]').click();
  await expect(page.getByRole('heading', { name: 'Daily Spending' })).toBeVisible();
});

test('empty state explains the page and focuses the add form', async ({ page }) => {
  await page.evaluate(() => pages.spending(1999, 1));
  const emptyState = page.locator('.spending-empty-state');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.getByRole('heading', { name: 'No transactions this month' })).toBeVisible();
  await expect(emptyState).toContainText('keep your balances and spending reports up to date');

  await page.locator('#emptyAddTxn').click();
  await expect(page.locator('#txnAmount')).toBeFocused();

  await page.locator('#prevMonth').click();
  await expect(page.locator('.spending-month-nav .month-label')).toHaveText('Dec 1998');
  await page.locator('#nextMonth').click();
  await expect(page.locator('.spending-month-nav .month-label')).toHaveText('Jan 1999');
  await expectNoHorizontalOverflow(page);
});

test('a transaction can be added, edited, and deleted from its card', async ({ page }) => {
  const originalDescription = `Desktop-${'long-description-'.repeat(10)}end`;
  await page.locator('#txnAmount').fill('45.67');
  await page.locator('#txnDesc').fill(originalDescription);
  await page.locator('#txnCat').selectOption({ label: 'Groceries' });
  await page.locator('#txnForm').getByRole('button', { name: 'Add Transaction', exact: true }).click();

  let card = page.locator('.spending-transaction', { hasText: originalDescription });
  await expect(card).toBeVisible();
  await expect(card.locator('.amount')).toHaveText('£45.67');
  await expect(card).toContainText('Groceries');
  await expect(card).toContainText('Current Account');
  expect(await card.locator('.spending-transaction-description').evaluate(
    element => element.scrollWidth <= element.clientWidth + 1,
  )).toBeTruthy();

  await page.locator('#catFilter').selectOption({ label: 'Groceries' });
  await expect(page.locator('#catFilter')).toHaveValue(
    await page.locator('#catFilter option', { hasText: 'Groceries' }).getAttribute('value'),
  );
  await page.locator('#catFilter').selectOption('');

  const cardId = await card.getAttribute('id');
  card = page.locator(`#${cardId}`);
  await card.getByRole('button', { name: /Edit/ }).click();
  card = page.locator(`#${cardId}`);
  await expect(card).toHaveClass(/is-editing/);
  await expect(card.locator('#ec')).toHaveValue(
    await page.locator('#txnCat option', { hasText: 'Groceries' }).getAttribute('value'),
  );
  await card.locator('#ea').fill('54.32');
  await card.locator('#ed').fill('Edited weekly groceries');
  await card.locator('#ec').selectOption({ label: 'Transport' });
  await card.getByRole('button', { name: 'Save Changes' }).click();

  card = page.locator('.spending-transaction', { hasText: 'Edited weekly groceries' });
  await expect(card).toBeVisible();
  await expect(card.locator('.amount')).toHaveText('£54.32');
  await expect(card).toContainText('Transport');
  await expect(card).toContainText('Current Account');

  const siblingDescription = `Same-day-sibling-${Date.now()}`;
  await page.locator('#txnAmount').fill('9.99');
  await page.locator('#txnDesc').fill(siblingDescription);
  await page.locator('#txnForm').getByRole('button', { name: 'Add Transaction', exact: true }).click();
  const siblingCard = page.locator('.spending-transaction', { hasText: siblingDescription });
  await expect(siblingCard).toBeVisible();
  card = page.locator('.spending-transaction', { hasText: 'Edited weekly groceries' });

  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: /Delete/ }).click();
  await expect(card).toHaveCount(0);
  await expect(siblingCard).toBeVisible();
  await expect(siblingCard.locator('xpath=ancestor::section[contains(@class,"spending-day-group")]')).toBeVisible();
});

test('many transactions remain dense, scannable, and contained on desktop', async ({ page }) => {
  const prefix = `Volume-${Date.now()}-`;
  await page.evaluate(async ({ prefix }) => {
    const [categories, accounts] = await Promise.all([
      fetch('/api/categories').then(response => response.json()),
      fetch('/api/accounts').then(response => response.json()),
    ]);
    const date = new Date().toISOString().split('T')[0];
    await Promise.all(Array.from({ length: 24 }, (_, index) => fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 5 + index,
        description: `${prefix}${String(index + 1).padStart(2, '0')}`,
        category_id: categories[index % categories.length].id,
        account_id: accounts[0].id,
        date,
      }),
    })));
  }, { prefix });

  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="spending"]').click();
  const volumeCards = page.locator('.spending-transaction').filter({ hasText: prefix });
  await expect(volumeCards).toHaveCount(24);
  await expect(volumeCards.first().locator('.spending-transaction-actions')).toBeVisible();

  const formColumns = await page.locator('#txnForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(formColumns).toBeGreaterThanOrEqual(6);
  await expectNoHorizontalOverflow(page);
});
