const { test, expect } = require('@playwright/test');
const {
  expectLastControlClearOfBottomNav,
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Reports remains readable and contained across responsive viewports', async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.evaluate(async () => {
    const [categories, accounts] = await Promise.all([
      fetch('/api/categories').then(response => response.json()),
      fetch('/api/accounts').then(response => response.json()),
    ]);
    const groceries = categories.find(category => category.name === 'Groceries');
    const transport = categories.find(category => category.name === 'Transport');
    const post = (body) => fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, account_id: accounts[0].id }),
    });
    await Promise.all([
      post({ amount: 48.5, description: `Responsive groceries ${Date.now()}`, category_id: groceries.id, date: '2024-06-08' }),
      post({ amount: 22.25, description: `Responsive transport ${Date.now()}`, category_id: transport.id, date: '2024-05-08' }),
    ]);
  });

  await navigateToPage(page, 'reports');
  await page.evaluate(() => pages.reports(2024, 6));
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();

  const viewport = page.viewportSize();
  const kpiColumns = await page.locator('.reports-kpi-grid').evaluate(
    grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length,
  );
  expect(kpiColumns).toBe(viewport.width <= 360 ? 1 : 2);

  for (const button of await page.locator('.reports-month-nav button').all()) {
    expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('.reports-chart-wrap')).toBeVisible();
  await expect(page.getByRole('img', { name: /spending by category/i })).toBeVisible();

  const tableRegion = page.locator('.reports-table-scroll');
  await expect(tableRegion).toBeVisible();
  const tableDimensions = await tableRegion.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(tableDimensions.scrollWidth).toBeGreaterThanOrEqual(tableDimensions.clientWidth);
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await expectLastControlClearOfBottomNav(page);
});
