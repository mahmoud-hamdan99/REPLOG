import { expect, test, type Page } from '@playwright/test';

import { buildSoakDataset } from './soak-data';

/**
 * The soak pass: every screen against two years of history.
 *
 * IMPLEMENTATION_PLAN §17 task 3. It runs against the production build rather
 * than `ng serve`, because a figure measured against a dev build with no
 * optimisation and a live reload socket is not a figure about the app.
 *
 * What it guards is shape, not milliseconds: a screen that reads 10 000 set
 * logs through an index stays flat as the dataset grows, and one that scans
 * does not. The ceiling is therefore deliberately loose — this is desktop
 * Chromium on whatever machine happens to run it, and the §10.5 budget that
 * mentions a phone is a Lighthouse figure against a deployed site, which no
 * test here can honestly produce. The measured numbers are printed and
 * recorded in the plan; the assertion catches a regression of the kind that
 * changes an order of magnitude.
 */

const CEILING_MS = 5_000;

/** Screens, each with the thing on it that proves the data arrived. */
const SCREENS: { route: string; waitFor: (page: Page) => unknown; label: string }[] = [
  { route: '', label: 'dashboard', waitFor: (page) => page.getByText('This week') },
  { route: 'history', label: 'history', waitFor: (page) => page.locator('rl-card.row').first() },
  {
    route: 'progress',
    label: 'progress',
    waitFor: (page) => page.getByRole('heading', { level: 1 }),
  },
  {
    route: 'progress/volume',
    label: 'volume chart',
    waitFor: (page) => page.locator('svg').first(),
  },
  { route: 'progress/body', label: 'body chart', waitFor: (page) => page.locator('svg').first() },
  { route: 'records', label: 'records', waitFor: (page) => page.locator('.grp__name').first() },
  {
    route: 'body',
    label: 'measurements',
    waitFor: (page) => page.getByRole('heading', { level: 1 }),
  },
  { route: 'photos', label: 'photos', waitFor: (page) => page.locator('img').first() },
  { route: 'exercises', label: 'library', waitFor: (page) => page.getByRole('searchbox') },
  {
    route: 'train',
    label: 'train',
    waitFor: (page) => page.getByRole('button', { name: 'Quick workout' }),
  },
  { route: 'settings/data', label: 'data', waitFor: (page) => page.getByText('Export a backup') },
];

/** Hands the app a file instead of opening the native picker. */
async function stubFilePicker(page: Page, text: string, name: string): Promise<void> {
  await page.evaluate(
    ({ text: contents, name: fileName }) => {
      const realClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
        if (this.type !== 'file') {
          realClick.call(this);
          return;
        }
        const transfer = new DataTransfer();
        transfer.items.add(new File([contents], fileName, { type: 'application/json' }));
        this.files = transfer.files;
        setTimeout(() => this.dispatchEvent(new Event('change', { bubbles: true })), 0);
      };
    },
    { text, name },
  );
}

function countRows(page: Page, store: string): Promise<number> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('replog');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<number>((resolve) => {
      const query = db.transaction(name).objectStore(name).count();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => resolve(-1);
    });
  }, store);
}

test('every screen works against two years of history', async ({ page }) => {
  test.setTimeout(600_000);

  const soak = buildSoakDataset();
  console.log(
    `soak dataset: ${(soak.bytes / 1024 / 1024).toFixed(1)} MB — ` +
      Object.entries(soak.counts)
        .map(([store, count]) => `${count} ${store}`)
        .join(', '),
  );

  // The catalog is seeded by the library screen, not by an app initializer,
  // and the dataset references its ids. So it is seeded first, deliberately:
  // importing into an empty catalog would leave the history pointing at
  // exercises that do not exist yet, which is a different test.
  await page.goto('exercises');
  await expect(page.getByRole('searchbox')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => countRows(page, 'exercises'), { timeout: 60_000 }).toBeGreaterThan(100);

  await page.goto('settings/data');
  await stubFilePicker(page, soak.text, 'soak.json');

  const readStarted = Date.now();
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await expect(page.getByText('What this file contains')).toBeVisible({ timeout: 120_000 });
  console.log(`soak import: validated in ${Date.now() - readStarted} ms`);

  // The app's own validator checking this generator. A record this file shaped
  // wrongly is reported here, naming the store, rather than turning into an
  // empty screen three assertions later.
  await expect(page.getByText(/malformed|orphan|not a list|could not be/i)).toHaveCount(0);

  const importStarted = Date.now();
  await page.getByRole('button', { name: 'Merge' }).click();
  await expect
    .poll(() => countRows(page, 'setLogs'), { timeout: 300_000, intervals: [1_000] })
    .toBe(soak.counts.setLogs);
  console.log(
    `soak import: ${soak.counts.setLogs} set logs applied in ${Date.now() - importStarted} ms`,
  );

  expect(await countRows(page, 'workouts')).toBe(soak.counts.workouts);
  expect(await countRows(page, 'workoutExercises')).toBe(soak.counts.workoutExercises);
  expect(await countRows(page, 'measurements')).toBe(soak.counts.measurements);
  expect(await countRows(page, 'photos')).toBe(soak.counts.photos);

  // Rebuilt from the set logs by the import itself, never read from the file.
  // Polled, not read once: the rebuild is the step after the records land, so
  // a straight read races it — which is exactly what it did, passing on one
  // run and failing on the next with the same data.
  await expect
    .poll(() => countRows(page, 'personalRecords'), { timeout: 120_000, intervals: [1_000] })
    .toBeGreaterThan(0);

  const timings: string[] = [];
  const slow: string[] = [];

  for (const screen of SCREENS) {
    const started = Date.now();
    await page.goto(screen.route);
    await expect(screen.waitFor(page) as ReturnType<Page['locator']>).toBeVisible({
      timeout: CEILING_MS * 3,
    });
    const elapsed = Date.now() - started;

    timings.push(`${screen.label}: ${elapsed} ms`);
    if (elapsed > CEILING_MS) slow.push(`${screen.label} took ${elapsed} ms`);
  }

  // One session's detail and one exercise's whole history: the two reads that
  // grow with the dataset rather than with the screen.
  await page.goto('history');
  const detailStarted = Date.now();
  await page.locator('rl-card.row button').first().click();
  await expect(page.getByText(soak.leadExerciseName).first()).toBeVisible({ timeout: 30_000 });
  timings.push(`workout detail: ${Date.now() - detailStarted} ms`);

  const historyStarted = Date.now();
  await page.getByRole('button', { name: 'See every session of this exercise' }).first().click();
  await expect(page.locator('.xh__name')).toBeVisible({ timeout: 30_000 });
  const exerciseHistoryMs = Date.now() - historyStarted;
  timings.push(`exercise history: ${exerciseHistoryMs} ms`);
  if (exerciseHistoryMs > CEILING_MS) slow.push(`exercise history took ${exerciseHistoryMs} ms`);

  console.log(`soak timings — ${timings.join(' · ')}`);
  expect(slow, slow.join('\n')).toEqual([]);
});
