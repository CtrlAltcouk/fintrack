const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

async function seedReportData(page, suffix) {
  await page.evaluate(async suffix => {
    const [categories, accounts] = await Promise.all([
      fetch('/api/categories').then(response => response.json()),
      fetch('/api/accounts').then(response => response.json()),
    ]);
    const byName = Object.fromEntries(categories.map(category => [category.name, category]));
    const post = (url, body) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    await Promise.all([
      post('/api/income', {
        amount: 1000,
        description: `Report income ${suffix}`,
        date: '2023-04-10',
        account_id: accounts[0].id,
      }),
      post('/api/transactions', {
        amount: 300,
        description: `Report groceries current ${suffix}`,
        category_id: byName.Groceries.id,
        date: '2023-04-12',
        account_id: accounts[0].id,
      }),
      post('/api/transactions', {
        amount: 120,
        description: `Report transport current ${suffix}`,
        category_id: byName.Transport.id,
        date: '2023-04-14',
        account_id: accounts[0].id,
      }),
      post('/api/transactions', {
        amount: 200,
        description: `Report groceries previous ${suffix}`,
        category_id: byName.Groceries.id,
        date: '2023-03-12',
        account_id: accounts[0].id,
      }),
      post('/api/transactions', {
        amount: 80,
        description: `Report utilities previous ${suffix}`,
        category_id: byName.Utilities.id,
        date: '2023-03-16',
        account_id: accounts[0].id,
      }),
    ]);
  }, suffix);
}

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="reports"]').click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
});

test('monthly report preserves KPI, category ranking, chart, and comparison calculations', async ({ page }) => {
  const suffix = Date.now();
  await seedReportData(page, suffix);
  await page.evaluate(() => pages.reports(2023, 4));

  await expect(page.locator('.reports-month-nav .month-label')).toHaveText('Apr 2023');
  await expect(page.locator('.reports-kpi-income .ui-currency')).toHaveText('£1,000.00');
  await expect(page.locator('.reports-kpi-spent .ui-currency')).toHaveText('£420.00');
  await expect(page.locator('.reports-kpi-positive .ui-currency')).toHaveText('£580.00');

  const ranking = page.locator('.reports-ranking-item');
  await expect(ranking).toHaveCount(2);
  await expect(ranking.nth(0)).toContainText('Groceries');
  await expect(ranking.nth(0)).toContainText('£300.00');
  await expect(ranking.nth(1)).toContainText('Transport');
  await expect(page.getByRole('img', { name: /spending by category for Apr 2023/i })).toBeVisible();

  const groceries = page.locator('.reports-table tbody tr', { hasText: 'Groceries' });
  await expect(groceries).toContainText('£200.00');
  await expect(groceries).toContainText('£300.00');
  await expect(groceries).toContainText('+£100.00');
  const utilities = page.locator('.reports-table tbody tr', { hasText: 'Utilities' });
  await expect(utilities).toContainText('£-80.00');

  const beforeNavigation = await page.evaluate(() => ({ ...window.__chartLifecycle }));
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.reports-month-nav .month-label')).toHaveText('Mar 2023');
  const afterNavigation = await page.evaluate(() => ({ ...window.__chartLifecycle }));
  expect(afterNavigation.destroyed).toBeGreaterThan(beforeNavigation.destroyed);
  expect(afterNavigation.created).toBeGreaterThan(beforeNavigation.created);
  await expectNoHorizontalOverflow(page);
});

test('an empty month presents report-specific empty states', async ({ page }) => {
  await page.evaluate(() => pages.reports(1999, 1));

  await expect(page.locator('.reports-chart-empty')).toBeVisible();
  await expect(page.locator('.reports-ranking-empty')).toBeVisible();
  await expect(page.locator('.reports-comparison-empty')).toBeVisible();
  await expect(page.locator('#reportChart')).toHaveCount(0);
  await expect(page.locator('.reports-kpi-income .ui-currency')).toHaveText('£0.00');
  await expectNoHorizontalOverflow(page);
});

test('desktop report layout remains dense and the comparison table stays contained', async ({ page }) => {
  await seedReportData(page, `layout-${Date.now()}`);
  await page.evaluate(() => pages.reports(2023, 4));

  const analyticsColumns = await page.locator('.reports-analytics-grid').evaluate(
    grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length,
  );
  expect(analyticsColumns).toBe(2);
  await expect(page.locator('.reports-chart-wrap')).toHaveCSS('height', '320px');
  await expect(page.locator('.reports-table-scroll')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
