const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Bills controls and cards adapt to the responsive viewport', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'bills');

  const name = `Mobile-${Date.now()} ${'with a long name '.repeat(6)}end`;
  await page.locator('#bName').fill(name);
  await page.locator('#bAmount').fill('64.20');
  await page.locator('#bDay').fill('27');
  await page.locator('#billForm').getByRole('button', { name: 'Add Bill', exact: true }).click();
  const card = page.locator('.bills-card', { hasText: name });
  await expect(card).toBeVisible();

  const viewport = page.viewportSize();
  const columns = await page.locator('#billForm').evaluate(
    form => new Set(
      [...form.querySelectorAll(':scope > .ui-field')]
        .map(field => Math.round(field.getBoundingClientRect().x)),
    ).size,
  );
  expect(columns).toBe(viewport.width <= 360 ? 1 : viewport.width <= 600 ? 2 : 3);

  for (const control of await page.locator('#billForm input:visible, #billForm select:visible, #billForm button:visible').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('#bFrequency')).toBeVisible();
  await expect(page.locator('#bEndMode')).toBeVisible();
  for (const control of await page.locator('.bills-filter-bar select').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }

  await expect(card.locator('.bills-card-amount')).toBeVisible();
  await expect(card.locator('.bills-card-actions')).toBeVisible();
  expect(await card.locator('h3').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await expectNoHorizontalOverflow(page);
});

test('future four-weekly pay periods remain usable without mobile overflow', async ({ page, request }, testInfo) => {
  await loginTestUser(page, request);
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await page.clock.setFixedTime(new Date('2026-08-16T12:00:00Z'));
  const fixture = await page.evaluate(async uniqueSuffix => {
    const [accounts, categories] = await Promise.all([
      fetch('/api/accounts').then(response => response.json()),
      fetch('/api/categories').then(response => response.json()),
    ]);
    const schedule = await fetch('/api/income/schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Mobile Future Pay ${uniqueSuffix}`,
        amount: 1844.33,
        frequency: 'four_weekly',
        anchor_date: '2026-09-12',
        account_id: accounts[0].id,
      }),
    }).then(response => response.json());
    const billName = `Mobile period bill ${uniqueSuffix}`;
    await fetch('/api/bills', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: billName, amount: 45.67, due_day: 20,
        category_id: categories[0].id, account_id: accounts[0].id,
        recurrence: { frequency: 'monthly', start_date: '2026-01-20', end_mode: 'never' },
      }),
    });
    await fetch('/api/settings/pay-period', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'pay_period', primary_schedule_id: schedule.id }),
    });
    return { billName };
  }, suffix);

  await navigateToPage(page, 'bills');
  await expect(page.locator('.bills-month-nav .month-label')).toHaveText('15 Aug – 11 Sep');
  await expect(page.locator('.bills-card', { hasText: fixture.billName })).toBeVisible();
  await expect(page.getByText(/primary pay schedule|cannot currently be used/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => fetch('/api/settings/pay-period', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'monthly' }),
  }));
});
