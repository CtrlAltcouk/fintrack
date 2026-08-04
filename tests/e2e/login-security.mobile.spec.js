const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser } = require('./helpers/app');

test('mobile login remains usable and exposes a clear throttled state', async ({ page, request }, testInfo) => {
  await loginTestUser(page, request);
  const displayName = `Mobile Throttle ${testInfo.project.name}`;
  const password = 'mobile-throttle-password';
  const created = await page.evaluate(async ({ displayName, password }) => {
    const response = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, password, colour: '#c39bd3' }),
    });
    return response.status;
  }, { displayName, password });
  expect(created).toBe(201);
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.reload();
  await page.getByText(displayName, { exact: true }).click();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.locator('#pwInput').fill(`wrong-mobile-${attempt}`);
    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/auth/login');
    await page.locator('#pwInput').press('Enter');
    const response = await responsePromise;
    expect(response.status()).toBe(attempt < 5 ? 401 : 429);
  }
  await expect(page.locator('#loginError')).toContainText('Too many sign-in attempts.');
  await expect(page.locator('#pwInput')).toBeFocused();
  await expect(page.locator('#loginSubmit')).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
