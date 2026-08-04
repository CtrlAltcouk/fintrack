const { test, expect } = require('@playwright/test');
const { loginTestUser } = require('./helpers/app');

test('browser policy preserves authenticated UI, charts, inline handlers, and downloads', async ({ page, request }) => {
  const policyErrors = [];
  page.on('console', message => {
    if (/content security policy|refused to (execute|load|apply)/i.test(message.text())) {
      policyErrors.push(message.text());
    }
  });

  const shell = await request.get('/');
  const headers = shell.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");

  await loginTestUser(page, request);
  await expect(page.locator('#barChart')).toBeVisible();
  expect(await page.evaluate(() => typeof window.Chart)).toBe('function');

  await page.locator('#sidebar [data-page="accounts"]').click();
  const firstEdit = page.locator('.accounts-card').first().getByRole('button', { name: /^Edit / });
  await firstEdit.click();
  await expect(page.getByRole('heading', { name: 'Edit account' })).toBeVisible();

  await page.locator('#sidebar [data-page="settings"]').click();
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^outflow-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(policyErrors).toEqual([]);
});
