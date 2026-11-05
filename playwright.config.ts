import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Visual baselines are Linux x86_64 Chromium only; see tests/e2e/recipes-visual.spec.ts.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled' } },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && npm run build && npm run start -- -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false, // the setup test needs a fresh DB
    timeout: 180_000,
    env: {
      SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      BASE_URL: 'http://localhost:3100',
      DATABASE_PATH: './data/e2e.db',
      // Next injects the socket peer as X-Forwarded-For when absent; trusting loopback lets the
      // rate-limit e2e pick distinct client IPs via the header.
      TRUSTED_PROXIES: '127.0.0.1,::1',
      RATE_LIMIT_LOGIN_EMAIL_MAX: '5',
    },
  },
});
