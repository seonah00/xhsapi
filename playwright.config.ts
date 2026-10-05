import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against an already-started local stack:
 *   pnpm db:local && pnpm dev:worker & pnpm dev:web
 * Uses the preinstalled Chromium when present.
 */
const executablePath = process.env.PW_CHROMIUM ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, grepInvert: /@mobile-only/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } }, grep: /@mobile/ },
  ],
});
