const { test, expect } = require('@playwright/test');
const { TEST_USER, installChartStub, loginTestUser } = require('./helpers/app');

test('Settings forms submit immediately by keyboard and mouse without duplicate requests', async ({ page, request }) => {
  await loginTestUser(page, request);
  await page.locator('#sidebar [data-page="settings"]').click();
  await page.getByRole('button', { name: 'Users' }).click();

  let userCreates = 0;
  let passwordChanges = 0;
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.pathname === '/api/users' && outgoing.method() === 'POST') userCreates++;
    if (/^\/api\/users\/\d+\/password$/.test(url.pathname) && outgoing.method() === 'PATCH') passwordChanges++;
  });

  const hostileName = `O'Brien "quoted" <script>window.__injected=1</script> Ω`;
  await page.locator('#newUserDisplay').fill(hostileName);
  await page.locator('#newUserPassword').fill('hostile-name-password');
  await page.locator('#newUserPassword').press('Enter');
  await expect(page.getByText(hostileName, { exact: true })).toBeVisible();
  expect(userCreates).toBe(1);
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();

  await page.getByRole('button', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'Users' }).click();
  const mouseName = `Mouse ' " <tag> 日本語`;
  await page.locator('#newUserDisplay').fill(mouseName);
  await page.locator('#newUserPassword').fill('mouse-password');
  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText(mouseName, { exact: true })).toBeVisible();
  expect(userCreates).toBe(2);

  await page.locator('#cpCurrent').fill('wrong-password');
  await page.locator('#cpNew').fill('temporary-password');
  await page.locator('#cpNew').press('Enter');
  await expect(page.locator('#changePwStatus')).toContainText('current password incorrect');
  expect(passwordChanges).toBe(1);

  await page.locator('#cpCurrent').fill(TEST_USER.password);
  await page.locator('#cpNew').fill('temporary-password');
  await page.getByRole('button', { name: 'Update Password' }).click();
  await expect(page.locator('#changePwStatus')).toHaveText('Password updated.');
  expect(passwordChanges).toBe(2);

  await page.locator('#cpCurrent').fill('temporary-password');
  await page.locator('#cpNew').fill(TEST_USER.password);
  await page.locator('#cpNew').press('Enter');
  await expect(page.locator('#changePwStatus')).toHaveText('Password updated.');
  expect(passwordChanges).toBe(3);

  page.on('dialog', dialog => dialog.accept());
  await page.locator('.settings-user-item').filter({ hasText: hostileName }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(hostileName, { exact: true })).toHaveCount(0);
  await page.locator('.settings-user-item').filter({ hasText: mouseName }).getByRole('button', { name: 'Delete' }).click();
});

test('desktop navigation, user switching, and login work with the keyboard', async ({ page, request }) => {
  await loginTestUser(page, request);

  const dashboardLink = page.locator('#sidebar [data-page="dashboard"]');
  const accountsLink = page.locator('#sidebar [data-page="accounts"]');
  await dashboardLink.focus();
  await page.keyboard.press('Tab');
  await expect(accountsLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(accountsLink).toHaveAttribute('aria-current', 'page');

  const userPill = page.locator('#user-pill');
  await userPill.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#login-overlay')).toBeVisible();
  const picker = page.locator('#pickerGrid .user-picker-item').filter({ hasText: TEST_USER.display_name });
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pwInput')).toBeFocused();
  await page.locator('#pwInput').fill(TEST_USER.password);
  await page.locator('#pwInput').press('Enter');
  await expect(page.locator('#login-overlay')).toBeHidden();
});

test('normal users cannot see administrator operations and hostile picker names remain inert', async ({ page, request }) => {
  await loginTestUser(page, request);
  const normalName = `Normal ' " <script>window.__pickerInjected=1</script> Ω`;
  const created = await page.request.post('/api/users', {
    data: { display_name: normalName, password: 'normal-password', colour: '#a8d8a8' },
  });
  expect(created.status()).toBe(201);
  const createdUser = await created.json();

  await page.locator('#user-pill').click();
  await expect(page.getByText(normalName, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__pickerInjected)).toBeUndefined();
  await page.getByText(normalName, { exact: true }).click();
  await page.locator('#pwInput').fill('normal-password');
  await page.locator('#pwInput').press('Enter');
  await page.locator('#sidebar [data-page="settings"]').click();

  await expect(page.getByRole('button', { name: 'Updates' })).toHaveCount(0);
  await page.getByRole('button', { name: 'System' }).click();
  await expect(page.getByRole('button', { name: 'Restart App' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Backup' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Clear All Data/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();

  await page.locator('#user-pill').click();
  await page.getByText(TEST_USER.display_name, { exact: true }).click();
  await page.locator('#pwInput').fill(TEST_USER.password);
  await page.locator('#pwInput').press('Enter');
  await expect(page.locator('#login-overlay')).toBeHidden();
  const deleted = await page.request.delete(`/api/users/${createdUser.id}`);
  expect(deleted.ok()).toBeTruthy();
});

test('first-run account setup is a keyboard-submittable form', async ({ page }) => {
  await installChartStub(page);
  let createdPayload;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ status: 401, json: { error: 'unauthenticated' } });
    if (url.pathname === '/api/users/picker') return route.fulfill({ json: [] });
    if (url.pathname === '/api/users' && route.request().method() === 'POST') {
      createdPayload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 1, ...createdPayload, is_admin: 1 } });
    }
    if (url.pathname === '/api/auth/login') {
      return route.fulfill({ json: { id: 1, display_name: createdPayload.display_name, colour: createdPayload.colour, is_admin: 1, avatar: null } });
    }
    if (url.pathname === '/api/settings/theme') {
      return route.fulfill({ json: { mode: 'dark', accent: '#4a9eff', bg: '#101010' } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/');
  await expect(page.locator('#frName')).toBeFocused();
  await page.locator('#frName').fill('Keyboard Owner');
  await page.locator('#frPass').fill('keyboard-password');
  await page.locator('#frPass').press('Enter');
  await expect.poll(() => createdPayload).toMatchObject({
    display_name: 'Keyboard Owner', password: 'keyboard-password', colour: '#4a9eff',
  });
  await expect(page.locator('#login-overlay')).toBeHidden();
});

test('shared API client normalizes failures, preserves 401 handling, and times out', async ({ page }) => {
  await page.route('**/api/client-test/*', route => {
    const status = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    route.fulfill({
      status,
      json: { error: status === 500 ? 'sensitive server stack' : status === 401 ? 'unauthenticated' : `safe ${status}` },
    });
  });
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { createApi } = await import('/src/core/api.js');
    let unauthorized = 0;
    const { api } = createApi(() => { unauthorized++; });
    const errors = {};
    for (const status of [400, 401, 403, 404, 413, 500]) {
      try { await api(`/client-test/${status}`); }
      catch (error) { errors[status] = { status: error.status, message: error.message }; }
    }

    const originalFetch = window.fetch;
    window.fetch = (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    try { await api('/client-test/slow', { timeout: 10 }); }
    catch (error) { errors.timeout = { status: error.status, code: error.code, message: error.message }; }
    finally { window.fetch = originalFetch; }
    return { errors, unauthorized };
  });

  expect(result.unauthorized).toBe(1);
  for (const status of [400, 401, 403, 404, 413, 500]) expect(result.errors[status].status).toBe(status);
  expect(result.errors[403].message).toBe('safe 403');
  expect(result.errors[500].message).not.toContain('sensitive');
  expect(result.errors.timeout).toMatchObject({ status: 408, code: 'timeout' });
});
