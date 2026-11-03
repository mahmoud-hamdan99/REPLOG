import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 acceptance checks that need a real browser.
 *
 * The domain and store suites prove the rules — what is plausible, what a
 * delta means, what a merge keeps. What they cannot prove is the promise the
 * whole canonical-storage decision rests on: **switching units changes every
 * number on screen and no number on disk.** That one needs a real unit
 * setting, a real render and a real read back out of IndexedDB.
 */

// A first run seeds the built-in catalog before anything can be entered.
test.describe.configure({ timeout: 120_000 });

/** The live measurement rows, straight out of IndexedDB. */
async function storedMeasurements(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('replog');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = db.transaction('measurements').objectStore('measurements').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.filter((row) => row['deletedAt'] === null);
  });
}

/** Opens the entry sheet and fills fields by their visible labels. */
async function addEntry(
  page: Page,
  values: Readonly<Record<string, string>>,
  options: { day?: string } = {},
): Promise<void> {
  // On an empty database the screen is its empty state, whose action is the
  // only way in; after that it is the 'Add measurements' button above the
  // list. Either name matches, so this also waits out the first load.
  await page
    .getByRole('button', { name: /Add your first entry|Add measurements/ })
    .first()
    .click();
  const sheet = page.locator('rl-sheet dialog[open]').first();
  await expect(sheet).toBeVisible();

  if (options.day !== undefined) {
    await sheet.locator('input[type="date"]').fill(options.day);
  }

  const labels = Object.keys(values);
  // Everything but body weight lives behind the disclosure, which is where it
  // belongs: most days a person only weighs themselves.
  if (labels.some((label) => label !== 'Body weight')) {
    await sheet.getByRole('button', { name: 'More measurements' }).click();
  }

  for (const [label, value] of Object.entries(values)) {
    await sheet.getByLabel(label, { exact: true }).fill(value);
  }

  await sheet.getByRole('button', { name: 'Save entry' }).click();
}

test('switching units changes every number on screen and none on disk', async ({ page }) => {
  await page.goto('/body');
  await addEntry(page, { 'Body weight': '80.4', Waist: '86.4' });

  const list = page.locator('.page');
  await expect(list.getByText('80.4 kg').first()).toBeVisible();
  await expect(list.getByText('86.4 cm')).toBeVisible();

  const before = await storedMeasurements(page);

  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Pounds' }).check();
  await page.getByRole('radio', { name: 'Inches' }).check();

  await page.goto('/body');
  // 80.4 kg is 177.25 lb, shown at scale precision rather than snapped to the
  // plate grid a *load* would use. 86.4 cm is 34.02 in.
  await expect(list.getByText('177.3 lb').first()).toBeVisible();
  await expect(list.getByText('34 in')).toBeVisible();
  await expect(list.getByText('80.4 kg')).toHaveCount(0);

  // The record itself is untouched: the display unit never reaches storage.
  expect(await storedMeasurements(page)).toEqual(before);
});

test('an entry keeps the day it was measured, not the day it was typed', async ({ page }) => {
  await page.goto('/body');
  await addEntry(page, { 'Body weight': '82.5' }, { day: '2026-10-20' });

  // `recordedAt` is when it was typed in and `measuredAt` is what it measures;
  // showing the former would date every backfilled entry to today.
  // Either order the locale puts them in; what matters is that it is the
  // twentieth of October and not today.
  await expect(page.locator('.entry__open')).toHaveText(/Tue, (20 Oct|Oct 20)/);

  const [stored] = await storedMeasurements(page);
  expect(stored?.['measuredAt']).toBe('2026-10-20');
});

test('an unusual value is questioned, then saved exactly as typed', async ({ page }) => {
  await page.goto('/body');
  await addEntry(page, { 'Body weight': '650' });

  // Questioned, because 650 kg is almost certainly a slip — and then saved as
  // 650, because replacing someone's number with a nicer one is fabrication.
  await expect(page.getByText('Does that look right?')).toBeVisible();
  await expect(page.getByText('That is unusual for Body weight. Is 650 kg right?')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, save it' }).click();

  const [stored] = await storedMeasurements(page);
  expect(stored?.['weightKg']).toBe(650);
});

test('a weight-only entry is a complete entry', async ({ page }) => {
  await page.goto('/body');
  await addEntry(page, { 'Body weight': '80' });

  const entry = page.locator('rl-card.entry').first();
  await expect(entry.getByText('Body weight')).toBeVisible();
  // One recorded value and no row of blanks: a partial entry is the normal
  // case, and blanks would make it read as a failed one.
  await expect(entry.locator('.entry__pair')).toHaveCount(1);
});

test('a second entry on the same day offers to merge rather than stacking', async ({ page }) => {
  await page.goto('/body');
  await addEntry(page, { 'Body weight': '80.4' });
  await expect(page.locator('rl-card.entry')).toHaveCount(1);

  await addEntry(page, { Waist: '86.4' });
  await expect(page.getByText('Already an entry for this day')).toBeVisible();
  await page.getByRole('button', { name: 'Merge into the existing entry' }).click();

  // One entry carrying both values, not two entries for one morning.
  await expect(page.locator('rl-card.entry')).toHaveCount(1);
  const entry = page.locator('rl-card.entry').first();
  await expect(entry.getByText('80.4 kg').first()).toBeVisible();
  await expect(entry.getByText('86.4 cm')).toBeVisible();
});

test('an archived custom measurement stays readable where it was recorded', async ({ page }) => {
  await page.goto('/body');
  await page.getByRole('button', { name: 'Custom measurements' }).click();

  const custom = page.locator('rl-sheet dialog[open]').filter({ hasText: 'Custom measurements' });
  await custom.getByLabel('Name').fill('Wrist');
  await custom.getByRole('button', { name: 'Add a custom measurement' }).click();
  await expect(custom.getByText('Wrist')).toBeVisible();
  await page.keyboard.press('Escape');

  await addEntry(page, { 'Body weight': '80', Wrist: '17' });
  await expect(page.locator('rl-card.entry').first().getByText('17 cm')).toBeVisible();

  await page.getByRole('button', { name: 'Custom measurements' }).click();
  await custom.getByRole('button', { name: 'Archive' }).click();
  // Scoped to the definition row: the sheet's own note starts with the same
  // word.
  await expect(custom.locator('.def').getByText('Archived')).toBeVisible();
  await expect(custom.getByRole('button', { name: 'Restore' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Archiving stops it appearing in new entries; it does not erase the value
  // already recorded against it.
  await expect(page.locator('rl-card.entry').first().getByText('17 cm')).toBeVisible();
  await page.getByRole('button', { name: 'Add measurements' }).first().click();
  const sheet = page.locator('rl-sheet dialog[open]').first();
  await sheet.getByRole('button', { name: 'More measurements' }).click();
  await expect(sheet.getByLabel('Wrist', { exact: true })).toHaveCount(0);
});

test('reads and writes Arabic-Indic digits when that is what the user picked', async ({ page }) => {
  await page.goto('/');
  // Seeded rather than clicked: the numeral system is a stored preference that
  // the formatting layer already honours, but Settings has no control for it
  // until the preferences screen is built.
  await page.evaluate(() =>
    localStorage.setItem(
      'replog.prefs.v1',
      JSON.stringify({ prefsVersion: 1, language: 'ar', numerals: 'arab' }),
    ),
  );

  await page.goto('/body');
  await page.getByRole('button', { name: 'أضف أول إدخال' }).click();
  const sheet = page.locator('rl-sheet dialog[open]').first();
  // An Arabic keyboard emits these; a field that dropped them would be
  // unusable for the people the Arabic interface exists for.
  await sheet.getByLabel('وزن الجسم', { exact: true }).fill('٨٠٫٤');
  await sheet.getByRole('button', { name: 'حفظ الإدخال' }).click();

  await expect(page.locator('.page').getByText('٨٠٫٤ كجم').first()).toBeVisible();
  const [stored] = await storedMeasurements(page);
  expect(stored?.['weightKg']).toBe(80.4);
});
