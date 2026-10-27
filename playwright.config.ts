import { defineConfig, devices } from '@playwright/test';

/**
 * Browser journeys against the production build, served by `vite preview`.
 *
 * Port 4183 keeps it apart from the dev server (5183), and from the model
 * files a browser may have cached for that origin: these tests never use a
 * real model. Only Chromium is configured, so CI installs only Chromium.
 */
const PORT = 4183;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Each worker is a full Chromium running axe scans. Playwright's default (half
  // the logical CPUs, 8 on a 16-thread laptop) started so many browsers at once
  // that first page loads took over 13 s and tests hit the 30 s limit.
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Builds first, so the journeys always run against the current code.
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
