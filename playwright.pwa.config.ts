import { defineConfig, devices } from '@playwright/test';

/**
 * The offline and update suite, run against a **production build**.
 *
 * Separate from the main config for one reason: Angular disables the service
 * worker in development builds, so these tests against `ng serve` would pass
 * without ever registering a worker — proving the opposite of what they
 * claim. They need `dist/`, which means they need a build, which is too slow
 * to put in front of every end-to-end run.
 *
 * Chromium only. Playwright's WebKit does not implement service workers
 * closely enough for an offline assertion to mean anything, and a test that
 * cannot fail on the engine it is meant to cover is worse than no test:
 * Safari behaviour is a device-matrix question (section 18), not one this
 * harness can answer. That limitation is recorded rather than papered over.
 */
/**
 * Where the build is served from.
 *
 * `PAGES_BASE=/REPLOG/` runs the same suite against the shape GitHub Pages
 * actually serves — a repository subpath — which is the only way to catch an
 * asset path, a manifest URL or a worker scope that is correct at the root
 * and wrong where it will live. A separate port so both can run without
 * fighting over one service worker registration.
 */
const BASE = process.env['PAGES_BASE'] ?? '/';
const PORT = BASE === '/' ? 4301 : 4302;

export default defineConfig({
  testDir: './e2e-pwa',
  fullyParallel: false,
  // Service worker registration, install and activation are global to the
  // origin; two tests racing them would be testing the harness.
  workers: 1,
  retries: process.env['CI'] ? 2 : 1,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  timeout: 120_000,
  use: {
    // Always ends with "/", because every path in the suite is relative to
    // it. A leading slash in `page.goto` would reset the path and skip the
    // subpath entirely, which would make the Pages run silently test the
    // root — passing, and proving nothing about deployment.
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve-dist.mjs --port ${PORT} --base ${BASE}`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
