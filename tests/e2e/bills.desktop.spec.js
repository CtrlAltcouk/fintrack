const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

async function cancelAllActiveBills(page) {
  await page.evaluate(async () => {
    const now = new Date();
    const bills = await fetch(`/api/bills?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .then(response => response.json());
    await Promise.all(bills.filter(bill => bill.active).map(bill => fetch(`/api/bills/${bill.id}/cancel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    })));
  });
}

async function createBill(page, values) {
  return page.evaluate(async bill => {
    const [categories, accounts] = await Promise.all([
      fetch('/api/categories').then(response => response.json()),
      fetch('/api/accounts').then(response => response.json()),
    ]);
    const response = await fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bill.name,
        amount: bill.amount,
        due_day: bill.dueDay,
        category_id: categories[0].id,
        account_id: accounts[0].id,
      }),
    });
    return response.json();
  }, values);
}

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="bills"]').click();
  await expect(page.getByRole('heading', { name: 'Bills', exact: true })).toBeVisible();
});

test('empty state explains recurring bills and focuses the add form', async ({ page }) => {
  await cancelAllActiveBills(page);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();

  const emptyState = page.locator('.bills-empty-state');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.getByRole('heading', { name: 'No active bills yet' })).toBeVisible();
  await expect(emptyState).toContainText('monthly commitments');

  await page.locator('#emptyAddBill').click();
  await expect(page.locator('#bName')).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('bills expose overdue, due-today, upcoming, and paid states', async ({ page }) => {
  await cancelAllActiveBills(page);
  const now = new Date();
  await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), 15, 12));
  const prefix = `Status-${Date.now()}`;
  await createBill(page, { name: `${prefix}-overdue`, amount: 10, dueDay: 1 });
  await createBill(page, { name: `${prefix}-today`, amount: 20, dueDay: 15 });
  await createBill(page, { name: `${prefix}-upcoming`, amount: 30, dueDay: 16 });
  await createBill(page, { name: `${prefix}-paid`, amount: 40, dueDay: 2 });

  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();
  const paidCard = page.locator('.bills-card', { hasText: `${prefix}-paid` });
  page.once('dialog', dialog => dialog.accept('40'));
  await paidCard.getByRole('button', { name: 'Mark Paid' }).click();

  await expect(page.locator('.bills-card', { hasText: `${prefix}-overdue` })).toContainText('Overdue');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-today` })).toContainText('Due today');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-upcoming` })).toContainText('Upcoming');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-paid` })).toContainText('Paid');

  await page.locator('#billStatusFilter').selectOption('paid');
  await expect(page.locator('#billStatusFilter')).toHaveValue('paid');
  await expect(page.locator('.bills-card', { hasText: `${prefix}-paid` })).toBeVisible();
  await expect(page.locator('.bills-card', { hasText: `${prefix}-overdue` })).toHaveCount(0);
});

test('a long bill can be added, scanned, paid, and cancelled', async ({ page }) => {
  const name = `Long bill ${'description segment '.repeat(8)}end`;
  await page.locator('#bName').fill(name);
  await page.locator('#bAmount').fill('123.45');
  await page.locator('#bDay').fill('28');
  await page.locator('#bCat').selectOption({ label: 'Housing' });
  await page.locator('#bAcct').selectOption({ label: 'Current Account' });
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();

  let card = page.locator('.bills-card', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.locator('.bills-card-amount')).toHaveText('£123.45');
  await expect(card).toContainText('Current Account');
  await expect(card).toContainText('Housing');
  await expect(card).toContainText('Monthly');
  expect(await card.locator('h3').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();

  page.once('dialog', dialog => dialog.accept('123.45'));
  await card.getByRole('button', { name: 'Mark Paid' }).click();
  card = page.locator('.bills-card', { hasText: name });
  await expect(card).toContainText('Paid');

  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel Bill' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.bills-cancelled-item', { hasText: name })).toBeVisible();
});

test('desktop layout remains compact and contained', async ({ page }) => {
  const columns = await page.locator('#billForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBeGreaterThanOrEqual(6);
  await expect(page.locator('.bills-filter-bar')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a recurring bill can be created, skipped, paused, and resumed', async ({ page }) => {
  await cancelAllActiveBills(page);
  await page.locator('#sidebar [data-page="dashboard"]').click();
  await page.locator('#sidebar [data-page="bills"]').click();

  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const name = `Daily lifecycle ${Date.now()}`;
  await page.locator('#bName').fill(name);
  await page.locator('#bAmount').fill('12.34');
  await page.locator('#bDay').fill('1');
  await page.locator('#bFrequency').selectOption('daily');
  await page.locator('#bStartDate').fill(startDate);
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();

  let cards = page.locator('.bills-card', { hasText: name });
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toContainText('Daily');

  page.once('dialog', dialog => dialog.accept());
  await cards.first().getByRole('button', { name: 'Pause' }).click();
  cards = page.locator('.bills-card', { hasText: name });
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Paused');
  await cards.first().getByRole('button', { name: 'Resume' }).click();
  cards = page.locator('.bills-card', { hasText: name });
  await expect(cards.first().getByRole('button', { name: 'Pause' })).toBeVisible();
  const countBeforeSkip = await cards.count();
  page.once('dialog', dialog => dialog.accept());
  await cards.first().getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.bills-card', { hasText: name })).toHaveCount(countBeforeSkip - 1);
  await expectNoHorizontalOverflow(page);
});
