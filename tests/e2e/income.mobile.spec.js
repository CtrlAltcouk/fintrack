const { test, expect } = require('@playwright/test');
const {
  expectNoHorizontalOverflow,
  loginTestUser,
  navigateToPage,
} = require('./helpers/app');

test('Income controls, summaries, forms, and cards adapt to the responsive viewport', async ({ page, request }) => {
  await loginTestUser(page, request);
  await navigateToPage(page, 'income');
  await expect(page.getByRole('heading', { name: 'Income', exact: true })).toBeVisible();

  const viewport = page.viewportSize();
  await expect(page.locator('.income-summary-card')).toHaveCount(3);
  await expect(page.locator('.income-month-nav')).toBeVisible();
  await expect(page.locator('.income-mode-options')).toBeVisible();

  const oneOffColumns = await page.locator('#incForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(oneOffColumns).toBe(viewport.width <= 360 ? 1 : viewport.width <= 600 ? 2 : 3);

  for (const control of await page.locator('#incForm input, #incForm select, #incForm button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('button', { name: 'Recurring schedules' }).click();
  await expect(page.getByRole('button', { name: 'Recurring schedules' })).toHaveAttribute('aria-pressed', 'true');
  const recurringColumns = await page.locator('#incSchedForm').evaluate(
    form => getComputedStyle(form).gridTemplateColumns.split(' ').length,
  );
  expect(recurringColumns).toBe(viewport.width <= 360 ? 1 : viewport.width <= 600 ? 2 : 3);

  for (const control of await page.locator('#incSchedForm input:visible, #incSchedForm select:visible, #incSchedForm button:visible').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  const name = `Mobile recurring income ${page.viewportSize().width}`;
  const todayDay = String(new Date().getDate());
  await page.locator('#schedName').fill(name);
  await page.locator('#schedAmount').fill('500');
  await page.locator('#schedFreq').selectOption('monthly');
  await page.locator('#schedDay').fill(todayDay);
  await page.locator('#incSchedForm').getByRole('button', { name: 'Add Schedule' }).click();
  const card = page.locator('.income-schedule-card', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  for (const control of await card.locator('button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  const entry = page.locator('.income-entry-card', { hasText: name });
  await expect(entry.getByRole('button', { name: 'Edit recurring' })).toBeVisible();
  await entry.getByRole('button', { name: 'Edit recurring' }).click();
  const editor = page.locator('.income-schedule-edit');
  await expect(editor).toBeVisible();
  await expect(editor.locator('input').first()).toBeFocused();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(entry.getByRole('button', { name: `Delete ${name} income entry` })).toBeVisible();
  await entry.getByRole('button', { name: `Delete ${name} income entry` }).click();
  const entryModal = page.getByRole('dialog', { name: 'Delete this income entry?' });
  await expect(entryModal).toContainText('The recurring schedule will remain active.');
  for (const control of await entryModal.locator('button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await entryModal.getByRole('button', { name: 'Cancel' }).click();
  await expect(entryModal).toHaveCount(0);
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Delete recurring income?' });
  await expect(modal).toBeVisible();
  for (const control of await modal.locator('button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(modal).toHaveCount(0);
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmedModal = page.getByRole('dialog', { name: 'Delete recurring income?' });
  await confirmedModal.getByRole('button', { name: 'Delete recurring income' }).click();
  await page.getByRole('button', { name: 'One-off income' }).click();
  const inactiveEntry = page.locator('.income-entry-card', { hasText: name }).first();
  await expect(inactiveEntry.getByRole('button', { name: 'Restore recurring' })).toBeVisible();
  await expect(inactiveEntry.getByRole('button', { name: 'Edit recurring' })).toHaveCount(0);
  await inactiveEntry.getByRole('button', { name: 'Restore recurring' }).click();
  const restoreEditor = page.locator('.income-schedule-edit');
  await expect(restoreEditor.getByRole('button', { name: 'Restore recurring income' })).toBeVisible();
  for (const control of await restoreEditor.locator('input, select, button').all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await restoreEditor.getByRole('button', { name: 'Cancel' }).click();
  await expectNoHorizontalOverflow(page);
});
