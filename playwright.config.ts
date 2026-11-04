import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration. See docs/IMPLEMENTATION_PLAN.md section 17 for the
 * journey suite this harness is built for, and section 18 for the device matrix.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  /**
   * One worker locally. CI sets its own.
   *
   * The suite drives three engines over a real IndexedDB, a canvas image
   * pipeline and seeded training histories. At one worker per core the WebKit
   * processes died outright — "Page crashed", scattered across whichever
   * specs happened to be running — so Phase 10 dropped it to two. Phase 11
   * added six specs and two more screens, and two workers started failing the
   * same way: ten "Target page, context or browser has been closed" errors in
   * one run, across four unrelated specs, every one of which passes on its
   * own. The same specs at one worker pass in half a minute.
   *
   * A suite whose result depends on what else the machine is doing is not a
   * signal. This trades wall-clock time for an answer that means something,
   * which is the same trade made last phase, one step further along.
   */
  workers: process.env['CI'] ? undefined : 1,
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
