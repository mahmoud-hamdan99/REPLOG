import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Checks that only make sense against a production build.
 *
 * Development builds log things production does not, and strip nothing, so a
 * console assertion against `ng serve` would be measuring the wrong artifact.
 * These run against `dist/`, served the way it will be served.
 */

/** Every route reachable from the tab bar and Settings, relative to the base. */
const ROUTES = [
  '',
  'plans',
  'exercises',
  'exercises/new',
  'train',
  'history',
  'progress',
  'progress/volume',
  'progress/body',
  'records',
  'body',
  'photos',
  'settings',
  'settings/profile',
  'settings/units',
  'settings/workout',
  'settings/data',
  'settings/deleted',
  'settings/about',
];

/**
 * Console output a browser produces about the page rather than from it.
 *
 * Kept deliberately short. Every entry is something the app cannot prevent
 * and that says nothing about its own correctness; anything else is a defect
 * and should fail this test rather than be added here.
 */
const NOT_OURS = [
  // Chromium's own notice when a service worker takes over navigation.
  /ServiceWorker/i,
  // Devtools-only noise from the Angular CLI's dev overlay, which the
  // production build does not include but which can appear once during
  // teardown when a page is closed mid-navigation.
  /Failed to load resource.*favicon/i,
];

function isOurs(message: ConsoleMessage): boolean {
  return !NOT_OURS.some((pattern) => pattern.test(message.text()));
}

/** Collects every error and warning a page emits, with its route attached. */
function collect(page: Page, route: string, into: string[]): void {
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (!isOurs(message)) return;
    into.push(`[${route}] ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    into.push(`[${route}] pageerror: ${error.message}`);
  });
}

test('every screen loads without a console error or warning', async ({ page, context }) => {
  // The acceptance criterion is "no console errors or warnings in
  // production". It is worth asserting rather than eyeballing: a warning that
  // appears on one screen in one language is exactly the kind of thing that
  // survives a manual pass and then turns out to be a real bug.
  const problems: string[] = [];

  for (const route of ROUTES) {
    const fresh = await context.newPage();
    collect(fresh, route || '/', problems);
    await fresh.goto(route);
    await expect(fresh.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await fresh.close();
  }

  expect(problems, problems.join('\n')).toEqual([]);
  void page;
});

test('every screen loads cleanly in Arabic too', async ({ context }) => {
  // Separate pass: the Arabic bundle is a different chunk with different
  // plural machinery, and a missing key logs a warning only in the language
  // that is missing it.
  const problems: string[] = [];

  const setup = await context.newPage();
  await setup.goto('');
  await setup.evaluate(() => {
    const raw = localStorage.getItem('replog.prefs.v1');
    const prefs = raw === null ? { prefsVersion: 1 } : JSON.parse(raw);
    localStorage.setItem(
      'replog.prefs.v1',
      JSON.stringify({ ...prefs, language: 'ar', numerals: 'arab' }),
    );
  });
  await setup.close();

  for (const route of ROUTES) {
    const fresh = await context.newPage();
    collect(fresh, `ar ${route || '/'}`, problems);
    await fresh.goto(route);
    await expect(fresh.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(fresh.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await fresh.close();
  }

  expect(problems, problems.join('\n')).toEqual([]);
});

test('no raw translation key is rendered on any screen', async ({ context }) => {
  // The i18n gate proves the two dictionaries agree with each other. It
  // cannot prove a template asks for a key that is in *neither*, and the
  // symptom of that is the key itself appearing on screen — "data.export.title"
  // where a heading should be.
  //
  // Checked by reading the rendered text rather than by asking the app what
  // it logged: the app's own record needs the Angular devtools global, which
  // production builds do not ship, so that version of this test could only
  // ever skip itself.
  const looksLikeAKey = /^[a-z][a-zA-Z]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,4}$/;

  // Real text that would otherwise trip the pattern. Both are file names the
  // app genuinely displays.
  const ALLOWED = new Set(['index.html', 'manifest.webmanifest']);

  const page = await context.newPage();
  const found: string[] = [];

  for (const language of ['en', 'ar']) {
    await page.goto('');
    await page.evaluate((lang) => {
      const raw = localStorage.getItem('replog.prefs.v1');
      const prefs = raw === null ? { prefsVersion: 1 } : JSON.parse(raw);
      localStorage.setItem('replog.prefs.v1', JSON.stringify({ ...prefs, language: lang }));
    }, language);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

      const suspects = await page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? '';
          if (text.length > 0 && text.length < 60) out.push(text);
        }
        return out;
      });

      for (const text of suspects) {
        if (looksLikeAKey.test(text) && !ALLOWED.has(text)) {
          found.push(`[${language} ${route || '/'}] ${text}`);
        }
      }
    }
  }

  expect(found, found.join('\n')).toEqual([]);
});

test('no dropdown offers a raw enum value as its label', async ({ context }) => {
  // The sibling of the raw-key check, for the other way untranslated text
  // reaches a screen. Phase 14 found the exercise form's movement-pattern
  // select listing "horizontal-push" and "vertical-pull" — every other select
  // on that form translated, this one printed the enum. It is invisible to
  // the i18n gate (nothing asks for a missing key) and to the raw-key scan
  // (no dots), and it reads as English text in Arabic.
  //
  // The tell: an option whose visible label is its own value, where that
  // value is identifier-shaped — hyphenated or camelCase. The shape test is
  // what keeps it honest, because several stores are legitimately labelled
  // with the word they are named after ("plans", "photos"), and flagging
  // those would have made this test something to suppress rather than read.
  // It follows that a single-word enum rendered raw slips past; a set of
  // them does not, which is the case that matters.
  const identifierShaped = /-|[a-z][A-Z]/;
  const page = await context.newPage();
  const found: string[] = [];

  for (const language of ['en', 'ar']) {
    await page.goto('');
    await page.evaluate((lang) => {
      const raw = localStorage.getItem('replog.prefs.v1');
      const prefs = raw === null ? { prefsVersion: 1 } : JSON.parse(raw);
      localStorage.setItem('replog.prefs.v1', JSON.stringify({ ...prefs, language: lang }));
    }, language);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

      const raw = await page.evaluate(() =>
        [...document.querySelectorAll('option')]
          .filter((option) => option.value !== '' && option.textContent?.trim() === option.value)
          .map((option) => option.value),
      );

      for (const value of raw) {
        if (!identifierShaped.test(value)) continue;
        found.push(`[${language} ${route || '/'}] <option>${value}</option>`);
      }
    }
  }

  expect(found, found.join('\n')).toEqual([]);
});
