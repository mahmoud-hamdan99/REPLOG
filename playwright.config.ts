import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration. See docs/IMPLEMENTATION_PLAN.md section 17 for the
 * journey suite this harness is built for, and section 18 for the device matrix.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  /**
   * Two workers locally, not one per core.
   *
   * The suite drives three engines over a real IndexedDB, a canvas image
   * pipeline and seeded training histories, and at full parallelism the WebKit
   * processes started dying outright — "Page crashed", scattered across
   * whichever specs happened to be running. A suite whose result depends on
   * what else the machine is doing is not a signal, so it trades wall-clock
   * time for an answer that means something. CI sets its own.
   */
  workers: process.env['CI'] ? undefined : 2,
  forbidOnly: !!process.env['CI'],
  /**
   * One retry locally, two on CI.
   *
   * WebKit on this hardware is slow enough that a cold start plus a catalog
   * seed occasionally overruns an assertion, and the failure moves between
   * runs. A retry absorbs that without hiding anything: a real defect fails
   * both attempts, and the report says which tests needed a second go.
   */
  retries: process.env['CI'] ? 2 : 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14 Pro'] } },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
