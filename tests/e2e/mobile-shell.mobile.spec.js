const { test, expect } = require('@playwright/test');
const {
  expectLastControlClearOfBottomNav,
  expectNoHorizontalOverflow,
  expectReachable,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
});

test('mobile shell, key pages, scrolling, and navigation remain reachable', async ({ page }) => {
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#bottom-nav')).toBeVisible();

  for (const [pageName, heading] of [
    ['dashboard', 'Dashboard'],
    ['spending', 'Daily Spending'],
    ['bills', 'Bills'],
    ['income', 'Income'],
  ]) {
    await navigateToPage(page, pageName);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectReachable(page, page.locator('#main button:visible').first());
    await expectLastControlClearOfBottomNav(page);
  }
});

test('More sheet opens, closes, traps state, and navigates', async ({ page }) => {
  const more = page.locator('#more-btn');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#more-sheet')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#more-sheet')).toBeVisible();

  await page.locator('#more-sheet-close').click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#more-sheet')).toHaveAttribute('aria-hidden', 'true');

  await more.click();
  await page.locator('#more-sheet [data-page="accounts"]').click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(page.locator('#more-sheet')).toHaveAttribute('aria-hidden', 'true');
  await expectNoHorizontalOverflow(page);
});

test('a confirmation modal remains visible and dismissible', async ({ page }) => {
  await navigateToPage(page, 'bills');
  await page.locator('#bName').fill('Mobile modal bill');
  await page.locator('#bAmount').fill('10');
  await page.locator('#bDay').fill('20');
  await page.getByRole('button', { name: 'Add Bill' }).click();

  await page.locator('.list-item', { hasText: 'Mobile modal bill' })
    .last()
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const modal = page.locator('.modal');
  await expectReachable(page, modal);
  await expect(modal.getByRole('button', { name: 'Keep it' })).toBeVisible();
  await modal.getByRole('button', { name: 'Keep it' }).click();
  await expect(modal).toHaveCount(0);
});
