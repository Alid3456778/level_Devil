const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.PLAYWRIGHT_PORT || '3020';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  testIgnore: ['**/ui-smoke.spec.js'],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    channel: 'msedge',
    browserName: 'chromium',
  },
  webServer: {
    command: `node server/server.js`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: true,
    env: {
      ...process.env,
      PORT,
      MONGODB_URI: '',
    },
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop-edge',
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'pixel-7',
      use: {
        ...devices['Pixel 7'],
        channel: 'msedge',
        browserName: 'chromium',
      },
    },
    {
      name: 'iphone-13',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 13'].userAgent,
        channel: 'msedge',
        browserName: 'chromium',
      },
    },
  ],
});
