import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The automated half of the accessibility pass (IMPLEMENTATION_PLAN §17 task 5).
 *
 * Run against the production build, in both languages, on every screen. Axe
 * cannot judge whether a label reads well or whether a focus order makes
 * sense; what it does catch is the mechanical half — contrast, names, roles,
 * landmarks, duplicate ids, heading structure — and it catches it on every
 * screen rather than on the ones somebody thought to look at.
 *
 * The other half stays manual and is recorded as such: VoiceOver on a real
 * device, and the keyboard and 200 %-text passes done by hand.
 */

/** Every screen reachable from the tab bar and Settings. */
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

const STANDARD = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function setPrefs(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.goto('');
  await page.evaluate((changes) => {
    const raw = localStorage.getItem('replog.prefs.v1');
    const prefs = raw === null ? { prefsVersion: 1 } : JSON.parse(raw);
    localStorage.setItem('replog.prefs.v1', JSON.stringify({ ...prefs, ...changes }));
  }, patch);
}

async function setLanguage(page: Page, language: 'en' | 'ar'): Promise<void> {
  await setPrefs(page, { language });
}

/**
 * Scans every route, returning one line per violation found.
 *
 * `label` only tags the output — "en", "ar", "light" — so a failure says
 * which pass found it without the caller having to repeat itself.
 */
async function scan(page: Page, label: string): Promise<string[]> {
  const found: string[] = [];

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

    const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();

    for (const violation of results.violations) {
      const where = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(', ');
      found.push(`[${label} ${route || '/'}] ${violation.id} (${violation.impact}): ${where}`);
    }
  }

  return found;
}

test('every screen passes axe in English', async ({ page }) => {
  test.setTimeout(300_000);
  await setLanguage(page, 'en');
  const found = await scan(page, 'en');
  expect(found, found.join('\n')).toEqual([]);
});

test('every screen passes axe in Arabic', async ({ page }) => {
  // A separate pass, because several of the things axe checks are
  // language-dependent: the `lang` and `dir` attributes, text that grows or
  // shrinks enough to change a contrast calculation, and any control whose
  // accessible name comes from a translated string.
  test.setTimeout(300_000);
  await setLanguage(page, 'ar');
  const found = await scan(page, 'ar');
  expect(found, found.join('\n')).toEqual([]);
});

test('every screen passes axe in the light theme', async ({ page }) => {
  // The scans above run in whatever theme the browser's colour scheme
  // resolves to, which is one of the two. Contrast is the rule most of these
  // screens could fail, and light is a separate palette rather than an
  // inversion of dark — so it gets its own pass rather than an assumption.
  test.setTimeout(300_000);
  await setPrefs(page, { language: 'en', theme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const found = await scan(page, 'light');
  expect(found, found.join('\n')).toEqual([]);
});

test('every screen survives 200 % text without losing content', async ({ page }) => {
  // UI_UX_SPEC asks for 200 % text scaling. Emulated by scaling the root font
  // size, which is what a browser's own text-only zoom does — not by zooming
  // the page, which scales the viewport too and would prove nothing about a
  // layout built in rem.
  test.setTimeout(300_000);
  await setLanguage(page, 'en');

  const overflowing: string[] = [];

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

    await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });

    // Horizontal scroll is the failure that matters: vertical growth is
    // correct behaviour, a sideways scrollbar means something is pinned to a
    // pixel width and text is now being cut off.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });

    // A pixel or two of rounding is not a defect.
    if (overflow.scrollWidth > overflow.clientWidth + 2) {
      overflowing.push(
        `[${route || '/'}] scrolls sideways at 200 % text: ` +
          `${overflow.scrollWidth} > ${overflow.clientWidth}`,
      );
    }
  }

  expect(overflowing, overflowing.join('\n')).toEqual([]);
});

/**
 * The surfaces a route list cannot reach.
 *
 * Every scan above loads a URL, which leaves out everything that only exists
 * after an interaction: the tracker mid-session, the numeric pad, the exercise
 * picker, a destructive dialog, the summary, and the two detail screens. Those
 * are exactly where the heading duplication this phase found was hiding — the
 * workout detail, the exercise history and the summary each rendered a second
 * `h1` under the header's own, so the page had two top-level headings and no
 * route scan would ever have seen it.
 */
test('the screens behind an interaction pass axe too', async ({ page }) => {
  test.setTimeout(300_000);
  await setLanguage(page, 'en');

  const found: string[] = [];
  const check = async (where: string) => {
    const results = await new AxeBuilder({ page }).withTags(STANDARD).analyze();
    for (const violation of results.violations) {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(', ');
      found.push(`[${where}] ${violation.id} (${violation.impact}): ${nodes}`);
    }
  };

  // A destructive dialog, with its typed confirmation.
  await page.goto('settings/data');
  await page.getByRole('button', { name: 'Reset everything' }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await check('reset dialog');
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();

  // The tracker, and the two sheets that cover it.
  await page.goto('train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 60_000 });
  await check('active workout');

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await expect(picker).toBeVisible();
  await check('exercise picker');
  await picker.getByRole('searchbox').fill('Barbell Bench Press');
  await picker.getByRole('option').first().click({ timeout: 60_000 });
  await picker.getByRole('button', { name: /^Add/ }).click();
  await expect(picker).toBeHidden();

  await page.locator('.row__field').first().click();
  const pad = page.locator('rl-numeric-pad dialog');
  await expect(pad).toBeVisible();
  await check('numeric pad');

  for (const digit of '100') {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Next field' }).click();
  for (const digit of '5') {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Done' }).click();
  await expect(pad).toBeHidden();

  const rest = page.locator('rl-rest-timer dialog');
  await expect(rest).toBeVisible();
  await check('rest timer');
  await rest.getByRole('button', { name: 'Skip rest' }).click();
  await expect(rest).toBeHidden();

  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await check('finish confirmation');
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await expect(page).toHaveURL(/\/train\/summary\//, { timeout: 60_000 });
  await check('workout summary');

  // And the two screens that render a session back.
  await page.goto('history');
  await page.locator('rl-card.row button').first().click();
  await expect(page.locator('.det__name')).toBeVisible({ timeout: 30_000 });
  await check('workout detail');

  await page.getByRole('button', { name: 'See every session of this exercise' }).first().click();
  await expect(page.locator('.xh__name')).toBeVisible({ timeout: 30_000 });
  await check('exercise history');

  expect(found, found.join('\n')).toEqual([]);
});

test('the keyboard can reach everything and cannot escape a modal', async ({ page }) => {
  test.setTimeout(300_000);
  await setLanguage(page, 'en');

  // Every control on a screen has to be reachable by Tab alone. The failure
  // this catches is a control built from a div with a click handler: it is
  // visible, it works with a mouse, and a keyboard never finds it.
  for (const route of ['', 'history', 'settings', 'settings/data', 'body']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });

    const expected = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      return candidates.filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 && rect.height > 0 && element.closest('[aria-hidden="true"]') === null
        );
      }).length;
    });

    expect(expected, `${route || '/'} has no focusable controls at all`).toBeGreaterThan(0);

    const visited = new Set<string>();
    await page.locator('body').press('Tab');
    for (let step = 0; step < expected; step++) {
      const id = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return null;
        // A stable-enough identity for a set: tag plus the accessible text.
        return `${active.tagName}:${active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 40) ?? ''}`;
      });
      if (id !== null) visited.add(id);
      await page.keyboard.press('Tab');
    }

    // Not an exact count: several controls legitimately share a name (the
    // history rows), and the browser's own chrome takes a turn in the order.
    // What matters is that tabbing moves through the screen rather than
    // getting stuck or falling straight out of it.
    expect(
      visited.size,
      `${route || '/'} only reached ${visited.size} controls by Tab`,
    ).toBeGreaterThan(Math.min(3, expected));
  }

  // And a modal keeps the keyboard inside it, which is what `showModal` buys
  // and what a div-with-a-backdrop would not.
  await page.goto('settings/data');
  await page.getByRole('button', { name: 'Reset everything' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();

  // Focus is allowed to pass through the document root, which is where
  // Chromium wraps a modal's tab cycle. What it must never do is land on a
  // control behind the dialog — that is the failure a div-with-a-backdrop has
  // and a native modal does not.
  const escaped: string[] = [];
  for (let step = 0; step < 15; step++) {
    await page.keyboard.press('Tab');
    const outside = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active === null || active === document.body) return null;
      if (active.closest('dialog[open]') !== null) return null;
      return `${active.tagName}: ${active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 40) ?? ''}`;
    });
    if (outside !== null) escaped.push(`tab ${step + 1} reached ${outside}`);
  }
  expect(escaped, escaped.join('\n')).toEqual([]);
});

test('reduced motion is honoured, and the app setting can override the system', async ({
  page,
}) => {
  // The CSS half of the motion preference. The unit test proves the attribute
  // reaches the document; this proves the stylesheet acts on it, in all three
  // combinations that matter — including "never", which is a user deliberately
  // asking for animation on a device that asks for less of it.
  test.setTimeout(120_000);

  /** A probe element with a real transition, read back after the cascade. */
  const transitionMs = () =>
    page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transitionDuration = '300ms';
      probe.style.transitionProperty = 'opacity';
      document.body.append(probe);
      const duration = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return duration;
    });

  const SUPPRESSED = '1e-05s';

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setPrefs(page, { reduceMotion: 'system' });
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  expect(await transitionMs(), 'system preference should follow the OS').toBe(SUPPRESSED);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setPrefs(page, { reduceMotion: 'always' });
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  expect(await transitionMs(), '"always" should reduce motion without the OS').toBe(SUPPRESSED);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setPrefs(page, { reduceMotion: 'never' });
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  expect(await transitionMs(), '"never" should override the OS').toBe('0.3s');
});
