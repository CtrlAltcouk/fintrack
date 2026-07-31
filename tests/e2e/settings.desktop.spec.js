const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
} = require('./helpers/app');

test.beforeEach(async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="settings"]').click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('categories can be added, edited, and deleted from the modern settings layout', async ({ page }) => {
  const categoryName = `Settings category ${Date.now()}`;
  await page.locator('#catName').fill(categoryName);
  await page.locator('#catColour').fill('#76d7c4');
  await page.getByRole('button', { name: 'Add Category' }).click();

  let category = page.locator('.settings-category-item', { hasText: categoryName });
  await expect(category).toBeVisible();
  await category.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#ec-name')).toBeFocused();
  await expect(page.locator('#ec-colour')).toHaveValue('#76d7c4');

  const editedName = `${categoryName} edited`;
  await page.locator('#ec-name').fill(editedName);
  await page.locator('#ec-colour').fill('#c39bd3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  category = page.locator('.settings-category-item', { hasText: editedName });
  await expect(category).toBeVisible();
  const saved = await page.evaluate(async name => {
    const categories = await fetch('/api/categories').then(response => response.json());
    return categories.find(category => category.name === name);
  }, editedName);
  expect(saved).toMatchObject({ name: editedName, colour: '#c39bd3' });

  page.once('dialog', dialog => dialog.accept());
  await category.getByRole('button', { name: 'Delete' }).click();
  await expect(category).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('theme and dashboard preferences save and load through their existing APIs', async ({ page }) => {
  await page.evaluate(async () => {
    await fetch('/api/settings/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'dark', accent: '#f7a4a2', bg: '#111111' }),
    });
    await fetch('/api/settings/pay-period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'monthly' }),
    });
  });

  await page.getByRole('button', { name: 'Personalisation' }).click();
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Use accent colour #4a9eff' }).click();
  await expect(page.getByRole('button', { name: 'Use accent colour #4a9eff' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Pay Period' }).click();
  await expect(page.getByRole('button', { name: 'Pay Period' })).toHaveAttribute('aria-pressed', 'true');

  const saved = await page.evaluate(async () => ({
    theme: await fetch('/api/settings/theme').then(response => response.json()),
    period: await fetch('/api/settings/pay-period').then(response => response.json()),
  }));
  expect(saved.theme).toEqual({ mode: 'dark', accent: '#4a9eff', bg: '#111111' });
  expect(saved.period.mode).toBe('pay_period');

  await page.reload();
  await page.locator('#sidebar [data-page="settings"]').click();
  await page.getByRole('button', { name: 'Personalisation' }).click();
  await expect(page.getByRole('button', { name: 'Use accent colour #4a9eff' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pay Period' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.getByRole('button', { name: 'Monthly' }).click();
  await expectNoHorizontalOverflow(page);
});

test('all settings sections remain available without changing their actions', async ({ page }) => {
  const expectedSections = {
    Categories: 'Spending categories',
    Personalisation: 'Profile',
    Updates: 'Application updates',
    System: 'Restart application',
    Users: 'People with access',
  };

  for (const [tab, heading] of Object.entries(expectedSections)) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: tab, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);
  }
});
