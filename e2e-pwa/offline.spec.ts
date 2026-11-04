import { expect, test, type Page } from '@playwright/test';

/**
 * The offline promise, checked against a production build.
 *
 * This is the claim the About screen makes out loud — "REPLOG works fully
 * offline after its first load" — and the one a user discovers is false in a
 * basement gym with no signal, which is exactly where this app is meant to be
 * used. So it is checked by turning the network off, not by inspecting
 * configuration.
 */

/**
 * Waits until the app is genuinely usable offline.
 *
 * Activation is not the finish line, which is the trap this helper exists to
 * avoid: Angular's worker activates immediately and only then populates its
 * caches, so a test that went offline on `activated` would be testing an
 * empty cache and failing for the wrong reason. The condition that matters is
 * that the build is actually stored.
 */
async function waitForOfflineReady(page: Page): Promise<void> {
  // `expect.poll` with `page.evaluate`, not `page.waitForFunction`.
  // waitForFunction does not await an async predicate: it sees the returned
  // Promise, finds it truthy and resolves on the first poll. This wait was
  // written that way at first and passed instantly while the cache was still
  // empty — a wait that never waits is worse than none, because every test
  // after it fails somewhere misleading.
  // Every URL the worker's own manifest says it prefetches — not a round
  // number. "More than fifty of about eighty" was the first attempt, and it
  // cut the network mid-prefetch: whichever chunks had not landed yet failed,
  // so a different test failed on each run and none of them was the one at
  // fault.
  const expected = await prefetchedUrlCount(page);
  expect(expected).toBeGreaterThan(50);

  await expect
    .poll(async () => (await isControlling(page)) && (await cachedCount(page)) >= expected, {
      timeout: 90_000,
      message: `service worker should control the page and cache all ${expected} prefetched files`,
    })
    .toBe(true);
}

/** How many files `ngsw.json` declares for eager prefetch. */
async function prefetchedUrlCount(page: Page): Promise<number> {
  const manifest = (await (await page.request.get('/ngsw.json')).json()) as {
    assetGroups: { installMode: string; urls: string[] }[];
  };
  return manifest.assetGroups
    .filter((group) => group.installMode === 'prefetch')
    .reduce((total, group) => total + group.urls.length, 0);
}

/**
 * Whether a worker is both activated **and** controlling this page.
 *
 * Activation alone is not enough and was the second trap here: a worker can
 * be activated while the page that registered it is still uncontrolled, and
 * an uncontrolled page intercepts nothing — so going offline at that moment
 * tests the network, finds it gone, and blames the app.
 */
function isControlling(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return (
      registration?.active?.state === 'activated' && navigator.serviceWorker.controller !== null
    );
  });
}

/** How many responses the worker is holding. */
function cachedCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    let total = 0;
    for (const name of await caches.keys()) {
      total += (await caches.open(name).then((cache) => cache.keys())).length;
    }
    return total;
  });
}

/** Every route the tab bar and Settings can reach. */
const ROUTES = [
  '/',
  '/plans',
  '/exercises',
  '/train',
  '/history',
  '/progress',
  '/progress/volume',
  '/progress/body',
  '/records',
  '/body',
  '/photos',
  '/settings',
  '/settings/profile',
  '/settings/units',
  '/settings/workout',
  '/settings/data',
  '/settings/deleted',
  '/settings/about',
];

test('registers a service worker and caches the whole application', async ({ page }) => {
  await page.goto('/');
  await waitForOfflineReady(page);

  // Not just "a worker exists": the point of prefetching every chunk is that
  // a route never visited online still works offline, so assert the cache
  // actually holds the build rather than a shell.
  expect(await cachedCount(page)).toBeGreaterThan(50);
});

test('cold starts with the network disabled', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);

  await context.setOffline(true);

  // Away and back, rather than `page.reload()`. Both fetch the document
  // again, but reload is a distinct path in Chromium that this harness does
  // not drive reliably under offline emulation — it fails here while the same
  // reload succeeds when driven directly, which makes it a test of Playwright
  // rather than of the app. Navigating away and back is the same thing from
  // the worker's side: a navigation request it must answer from cache.
  await page.goto('about:blank');
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home', { timeout: 30_000 });
  // The navigation landmark, not the `rl-tab-bar` host: the host is an inline
  // box of zero size because the bar inside it is `position: fixed`, so
  // asserting on the host tests the layout rather than whether the user can
  // actually get anywhere.
  await expect(page.getByRole('navigation')).toBeVisible();

  await context.setOffline(false);
});

test('every route loads offline, including ones never opened online', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);

  await context.setOffline(true);

  for (const route of ROUTES) {
    // A full navigation each time, so each one goes through the worker's
    // navigation handling rather than the router's in-memory lazy loading.
    await page.goto(route);
    await expect(page.locator('rl-root')).toBeVisible({ timeout: 30_000 });
    // The shell rendering is not enough — a route whose chunk is missing
    // renders the shell and an empty main.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  }

  await context.setOffline(false);
});

test('the exercise catalog seeds offline', async ({ page, context }) => {
  await page.goto('/');
  await waitForOfflineReady(page);

  // Clear the database so the catalog has to be seeded from its lazy chunk,
  // then go offline before anything asks for it.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('replog');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  await context.setOffline(true);
  await page.goto('/exercises');

  // 168 built-in exercises, written from a chunk the worker prefetched.
  await expect(page.getByRole('searchbox')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Barbell Bench Press').first()).toBeVisible({ timeout: 60_000 });

  await context.setOffline(false);
});

test('the manifest and icons are reachable under the served base path', async ({ page }) => {
  // A manifest that 404s costs the install prompt silently: the browser
  // simply does not offer it, with nothing in the UI to notice.
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);

  const parsed = (await manifest.json()) as { icons: { src: string }[]; start_url: string };
  // Relative, so the app survives being moved to a repository subpath.
  expect(parsed.start_url).toBe('./');

  for (const icon of parsed.icons) {
    const response = await page.request.get(`/${icon.src}`);
    expect(response.status(), `${icon.src} should be served`).toBe(200);
  }

  const apple = await page.request.get('/icons/apple-touch-icon.png');
  expect(apple.status()).toBe(200);
});
