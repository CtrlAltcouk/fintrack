const { test, expect } = require('@playwright/test');
const { expectNoHorizontalOverflow, loginTestUser } = require('./helpers/app');

async function createUserFromPage(page, displayName, password) {
  const result = await page.evaluate(async ({ displayName, password }) => {
    const response = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, password, colour: '#76d7c4' }),
    });
    return { status: response.status, body: await response.json() };
  }, { displayName, password });
  expect(result.status).toBe(201);
}

test('login throttling is generic, keyboard-safe, single-submit, and recoverable for another account', async ({ page, request }) => {
  await loginTestUser(page, request);
  const displayName = 'Desktop Brute Force Target';
  await createUserFromPage(page, displayName, 'correct-target-password');
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.reload();
  await page.getByText(displayName, { exact: true }).click();

  let loginRequests = 0;
  page.on('request', outgoing => {
    if (new URL(outgoing.url()).pathname === '/api/auth/login') loginRequests += 1;
  });
  await page.locator('#pwInput').fill('wrong-password');
  await page.evaluate(() => {
    const form = document.getElementById('pwPrompt');
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.locator('#loginError')).toHaveText('The display name or password is incorrect.');
  expect(loginRequests).toBe(1);
  await expect(page.locator('#pwInput')).toBeFocused();
  await expect(page.locator('#loginSubmit')).toBeEnabled();

  for (let attempt = 2; attempt <= 4; attempt += 1) {
    await page.locator('#pwInput').fill(`wrong-password-${attempt}`);
    const responsePromise = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/auth/login');
    await page.locator('#pwInput').press('Enter');
    expect((await responsePromise).status()).toBe(401);
  }
  await page.locator('#pwInput').fill('wrong-password-5');
  const throttledPromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/login');
  await page.locator('#pwInput').press('Enter');
  const throttled = await throttledPromise;
  expect(throttled.status()).toBe(429);
  expect(Number(throttled.headers()['retry-after'])).toBeGreaterThan(0);
  await expect(page.locator('#loginError')).toContainText('Too many sign-in attempts. Try again in');
  await expect(page.locator('#loginError')).toHaveAttribute('aria-live', 'assertive');
  await expect(page.locator('#pwInput')).toBeFocused();
  await expect(page.locator('#loginSubmit')).toBeEnabled();
  await expectNoHorizontalOverflow(page);

  await page.locator('#loginBack').click();
  await page.getByText('Mobile Test User', { exact: true }).click();
  await page.locator('#pwInput').fill('local-test-password');
  await page.locator('#pwInput').press('Enter');
  await expect(page.locator('#login-overlay')).toBeHidden();
});
