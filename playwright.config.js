const { defineConfig } = require('@playwright/test');

const mobileViewports = [
  ['mobile-320x568', { width: 320, height: 568 }],
  ['mobile-390x844', { width: 390, height: 844 }],
  ['mobile-430x932', { width: 430, height: 932 }],
  ['tablet-768x1024', { width: 768, height: 1024 }],
];

module.exports = defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/artifacts',
  globalSetup: require.resolve('./tests/e2e/helpers/test-server'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    ...mobileViewports.map(([name, viewport]) => ({
      name,
      testMatch: '**/*.mobile.spec.js',
      use: { viewport },
    })),
    {
      name: 'desktop-1280x800',
      testMatch: '**/*.desktop.spec.js',
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
});
