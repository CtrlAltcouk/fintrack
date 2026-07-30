const { expect } = require('@playwright/test');

const TEST_USER = {
  display_name: 'Mobile Test User',
  password: 'local-test-password',
  colour: '#4a9eff',
};

async function installChartStub(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.Chart = class Chart {
      constructor() {
        window.__chartLifecycle ??= { created: 0, destroyed: 0 };
        window.__chartLifecycle.created++;
      }
      destroy() {
        window.__chartLifecycle.destroyed++;
      }
    };
  });
}

async function ensureTestUser(request) {
  const picker = await request.get('/api/users/picker');
  const users = await picker.json();
  if (!users.some(user => user.display_name === TEST_USER.display_name)) {
    const created = await request.post('/api/users', { data: TEST_USER });
    expect(created.ok()).toBeTruthy();
  }
}

async function loginTestUser(page, request) {
  await ensureTestUser(request);
  await installChartStub(page);
  await page.goto('/');
  await expect(page.locator('#login-overlay')).toBeVisible();
  await page.getByText(TEST_USER.display_name, { exact: true }).click();
  await page.locator('#pwInput').fill(TEST_USER.password);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.locator('#login-overlay')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function navigateToPage(page, pageName) {
  const directPages = new Set(['dashboard', 'spending', 'bills', 'income']);
  if (directPages.has(pageName)) {
    await page.locator(`#bottom-nav [data-page="${pageName}"]`).click();
  } else {
    await page.locator('#more-btn').click();
    await page.locator(`#more-sheet [data-page="${pageName}"]`).click();
  }
}

async function expectNoHorizontalOverflow(page) {
  const { dimensions, offenders } = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const mainRight = main.getBoundingClientRect().right;
    return {
      dimensions: [
        ['document', document.documentElement.scrollWidth, document.documentElement.clientWidth],
        ['body', document.body.scrollWidth, document.body.clientWidth],
        ['main', main.scrollWidth, main.clientWidth],
      ],
      offenders: [...main.querySelectorAll('*')]
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className && typeof element.className === 'string' ? `.${element.className.trim().replaceAll(' ', '.')}` : ''}`,
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        })
        .filter(item => item.right > mainRight + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 5),
    };
  });
  for (const [name, scrollWidth, clientWidth] of dimensions) {
    expect(scrollWidth, `${name}: ${scrollWidth}px scroll / ${clientWidth}px client; offenders: ${JSON.stringify(offenders)}`)
      .toBeLessThanOrEqual(clientWidth + 1);
  }
}

async function expectReachable(page, locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeGreaterThan(0);
}

async function expectLastControlClearOfBottomNav(page) {
  const result = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const nav = document.querySelector('#bottom-nav');
    main.scrollTop = main.scrollHeight;
    const controls = [...main.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter(el => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    const last = controls.at(-1);
    return {
      mainScrollable: main.scrollHeight > main.clientHeight,
      mainScrollTop: main.scrollTop,
      overflowY: getComputedStyle(main).overflowY,
      lastBottom: last?.getBoundingClientRect().bottom ?? 0,
      navTop: nav.getBoundingClientRect().top,
    };
  });
  expect(['auto', 'scroll']).toContain(result.overflowY);
  if (result.mainScrollable) expect(result.mainScrollTop).toBeGreaterThan(0);
  expect(result.lastBottom).toBeLessThanOrEqual(result.navTop + 1);
}

module.exports = {
  TEST_USER,
  ensureTestUser,
  expectLastControlClearOfBottomNav,
  expectNoHorizontalOverflow,
  expectReachable,
  installChartStub,
  loginTestUser,
  navigateToPage,
};
