import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Visual baselines are generated in the pinned Playwright image; run scripts/update-visual-baselines.sh.
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
  webServer: [
    {
      command:
        'rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && rm -rf data/e2e-uploads && npm run build && npm run start -- -p 3100',
      url: 'http://localhost:3100/login',
      reuseExistingServer: false, // the setup test needs a fresh DB
      timeout: 180_000,
      env: {
        SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        BASE_URL: 'http://localhost:3100',
        DATABASE_PATH: './data/e2e.db',
        UPLOADS_DIR: './data/e2e-uploads',
        // Next injects the socket peer as X-Forwarded-For when absent; trusting loopback lets the
        // rate-limit e2e pick distinct client IPs via the header.
        TRUSTED_PROXIES: '127.0.0.1,::1',
        RATE_LIMIT_LOGIN_EMAIL_MAX: '5',
      },
    },
    {
      // Second instance for the import e2e: `next dev` (NODE_ENV=development), same DB. Env
      // parsing only accepts IMPORT_ALLOW_LOCAL_FETCH outside production and a production
      // build inlines NODE_ENV, so a built server can never enable it. With the seam on, the
      // importer may reach the loopback fixture server; the :3100 server keeps the SSRF guard on.
      // Dev output lives in .next/dev, so it does not disturb the production build above.
      command: 'npm run dev -- -p 3101',
      url: 'http://localhost:3101/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        BASE_URL: 'http://localhost:3101',
        DATABASE_PATH: './data/e2e.db',
        UPLOADS_DIR: './data/e2e-uploads',
        TRUSTED_PROXIES: '127.0.0.1,::1',
        IMPORT_ALLOW_LOCAL_FETCH: 'true',
        // Cover URLs are upgraded to https; the fixture image server uses a self-signed cert.
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
    },
    {
      // Stub of the headless sidecar for import-headless.spec.ts (control surface in the file).
      command: 'node tests/e2e/stub-sidecar.mjs',
      url: 'http://127.0.0.1:3199/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { STUB_SIDECAR_PORT: '3199' },
    },
    {
      // Third instance: like :3101 (local fixture seam) but with HEADLESS_URL pointing at the
      // stub, so the static -> headless -> paste chain is exercised. :3101 keeps HEADLESS_URL
      // unset ("headless off"). Own dist dir: two `next dev` cannot share one.
      command: 'npm run dev -- -p 3102',
      url: 'http://localhost:3102/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e-headless',
        SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
        BASE_URL: 'http://localhost:3102',
        DATABASE_PATH: './data/e2e.db',
        UPLOADS_DIR: './data/e2e-uploads',
        TRUSTED_PROXIES: '127.0.0.1,::1',
        IMPORT_ALLOW_LOCAL_FETCH: 'true',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        HEADLESS_URL: 'http://127.0.0.1:3199',
        HEADLESS_TIMEOUT_MS: '20000',
        // Small per-user cap so the "a headless import counts once" flow can reach it.
        RATE_LIMIT_IMPORT_MAX: '10',
      },
    },
  ],
});
