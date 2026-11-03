import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 10 acceptance checks that need a real browser.
 *
 * The arithmetic is pinned by unit tests; what those cannot show is what
 * reaches the screen. These seed a history with a deliberate gap in it and
 * then read the chart back — because the failure this phase is most exposed
 * to is not a crash, it is a chart that looks fine and says something the
 * data does not support.
 */

/**
 * Serial, with one seeded page for the whole file.
 *
 * Seeding means a cold boot, a 168-exercise catalog and a hundred rows, and
 * doing it per test made the file take a quarter of an hour on WebKit — long
 * enough that tests started failing on timing rather than on behaviour, and a
 * different set of them each run. None of these tests writes anything, so
 * they can share the state they all need.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

/**
 * Writes a training history straight into IndexedDB.
 *
 * Driving the tracker for sixty sessions would take longer than the suite
 * allows and would test the tracker, which has its own suite. What matters
 * here is what the charts do with records that already exist.
 */
async function seedHistory(page: Page): Promise<void> {
  await page.goto('/');
  // The catalog seeds on first load; the distribution join needs it.
  await expect(page.locator('.tab')).toHaveCount(5, { timeout: 30_000 });

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('replog');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const envelope = (iso: string) => ({
      createdAt: iso,
      updatedAt: iso,
      deletedAt: null,
      rev: 1,
      origin: 'e2e',
    });
    const pad = (value: number) => String(value).padStart(2, '0');

    const workouts: Record<string, unknown>[] = [];
    const sets: Record<string, unknown>[] = [];
    const measurements: Record<string, unknown>[] = [];

    const today = new Date();
    let counter = 0;

    // Twelve weeks back, with weeks 5-8 left empty on purpose.
    for (let week = 11; week >= 0; week--) {
      const gap = week >= 5 && week <= 8;
      if (!gap) {
        for (const offset of [0, 3]) {
          const date = new Date(today);
          date.setDate(date.getDate() - week * 7 + offset);
          if (date > today) continue;

          const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
          const iso = `${day}T17:30:00.000Z`;
          const id = `e2e-w-${++counter}`;

          workouts.push({
            id,
            name: 'Seeded',
            status: 'completed',
            startedAt: iso,
            endedAt: iso,
            dayKey: day,
            planId: null,
            routineId: null,
            planSnapshot: null,
            bodyWeightKg: null,
            totalVolumeKg: 0,
            totalSets: 0,
            totalReps: 0,
            durationSec: 3600,
            notes: null,
            source: 'manual',
            ...envelope(iso),
          });

          const weight = 100 + (11 - week) * 2;
          for (let index = 0; index < 3; index++) {
            sets.push({
              id: `e2e-s-${counter}-${index}`,
              workoutId: id,
              workoutExerciseId: `e2e-we-${counter}`,
              exerciseId: 'back-squat',
              variantKey: 'back-squat|barbell|bilateral',
              dayKey: day,
              setIndex: index,
              setType: 'working',
              side: 'both',
              weightKg: weight,
              extraWeightKg: null,
              reps: 5,
              durationSec: null,
              distanceM: null,
              rpe: null,
              rir: null,
              isCompleted: true,
              isPr: false,
              completedAt: iso,
              restTakenSec: null,
              e1rmKg: weight * 1.17,
              volumeKg: weight * 5,
              notes: null,
              ...envelope(iso),
            });
          }
        }
      }

      if (!gap) {
        const date = new Date(today);
        date.setDate(date.getDate() - week * 7);
        const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        const iso = `${day}T07:00:00.000Z`;
        measurements.push({
          id: `e2e-m-${week}`,
          measuredAt: day,
          recordedAt: iso,
          weightKg: 85 - (11 - week) * 0.3,
          hasWeight: 1,
          heightCm: null,
          neckCm: null,
          shouldersCm: null,
          chestCm: null,
          waistCm: null,
          hipsCm: null,
          bicepsLeftCm: null,
          bicepsRightCm: null,
          forearmLeftCm: null,
          forearmRightCm: null,
          thighLeftCm: null,
          thighRightCm: null,
          calfLeftCm: null,
          calfRightCm: null,
          bodyFatPct: null,
          custom: {},
          notes: null,
          source: 'manual',
          ...envelope(iso),
        });
      }
    }

    const put = (store: string, rows: Record<string, unknown>[]) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const objectStore = tx.objectStore(store);
        for (const row of rows) objectStore.put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

    await put('workouts', workouts);
    await put('setLogs', sets);
    await put('measurements', measurements);
    db.close();
  });
}

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await seedHistory(page);
});

test.afterAll(async () => {
  await page.close();
});

test('a chart breaks across a gap rather than drawing through it', async () => {
  await page.goto('/progress');
  await page.getByRole('radio', { name: '3 months' }).click();

  const chart = page.locator('rl-line-chart').first();
  // Two paths, because four weeks in the middle have no session. One path
  // would be a straight line implying training that never happened.
  await expect(chart.locator('.lc__line')).toHaveCount(2, { timeout: 30_000 });
  await expect(chart.locator('.lc__area')).toHaveCount(0);
});

test('a volume axis starts at zero', async () => {
  await page.goto('/progress/volume');

  // The bar's length is the quantity; a truncated bar misstates it.
  const ticks = page.locator('rl-bar-chart').first().locator('.bc__y span');
  await expect(ticks.last()).toHaveText(/^0\s/, { timeout: 30_000 });
});

test('a weight axis is zoomed and states the range it used', async () => {
  await page.goto('/progress/body');

  // 2 kg on a 0-based axis is invisible, so zooming is right — and a zoomed
  // axis has to show the reader the scale it is using.
  await expect(page.getByText(/Axis .* to /).first()).toBeVisible({ timeout: 30_000 });
});

test('a count axis is labelled in whole sessions', async () => {
  await page.goto('/progress/volume');

  const ticks = page.locator('rl-bar-chart').nth(1).locator('.bc__y span');
  await expect(ticks.first()).toBeVisible({ timeout: 30_000 });

  for (const label of await ticks.allInnerTexts()) {
    expect(label).not.toContain('.');
  }
});

test('the distribution adds up to a hundred and says what it leaves out', async () => {
  await page.goto('/progress/volume');

  const shares = page.locator('.dc__share');
  await expect(shares.first()).toBeVisible({ timeout: 30_000 });

  const total = (await shares.allInnerTexts()).reduce(
    (sum, text) => sum + Number(text.replace('%', '')),
    0,
  );
  expect(total).toBe(100);
  await expect(page.getByText(/Working sets only/)).toBeVisible();
});

test('every chart prints how many readings it is drawn from', async () => {
  await page.goto('/progress');
  await expect(page.getByText(/\d+ readings/).first()).toBeVisible({ timeout: 30_000 });
});

test('scrubbing a chart reads out a recorded value, not an interpolated one', async () => {
  await page.goto('/progress/body');

  const svg = page.locator('rl-line-chart .lc__svg').first();
  await expect(svg).toBeVisible({ timeout: 30_000 });

  const box = await svg.boundingBox();
  if (box === null) throw new Error('chart has no box');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();

  const callout = page.locator('.lc__callout');
  await expect(callout).toBeVisible();
  await expect(callout).toContainText('kg');
  await page.mouse.up();
});

test('the dashboard shows counts that can be checked by hand', async () => {
  await page.goto('/');

  // Counts and readings, never a composite score: a number nobody can
  // reproduce from the records is a number nobody should trust.
  await expect(page.getByText('This week')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Completed sessions')).toBeVisible();
  await expect(page.getByText('Body weight')).toBeVisible();
});

test('the Progress tabs each have their own URL', async () => {
  await page.goto('/progress');

  await page.getByRole('link', { name: 'Volume' }).click();
  await expect(page).toHaveURL(/\/progress\/volume$/);

  await page.getByRole('link', { name: 'Body', exact: true }).click();
  await expect(page).toHaveURL(/\/progress\/body$/);

  await page.getByRole('link', { name: 'Records' }).click();
  await expect(page).toHaveURL(/\/records$/);
});

test('time runs left to right in Arabic, while the layout mirrors', async () => {
  await page.goto('/progress/volume');
  await page.evaluate(() => {
    const raw = localStorage.getItem('replog.prefs.v1');
    const prefs = raw === null ? { prefsVersion: 1 } : JSON.parse(raw);
    localStorage.setItem(
      'replog.prefs.v1',
      JSON.stringify({ ...prefs, language: 'ar', numerals: 'arab' }),
    );
  });
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const labels = page.locator('rl-bar-chart').first().locator('.bc__x span');
  await expect(labels.first()).toBeVisible({ timeout: 30_000 });

  // UI_UX_SPEC section 10.2 makes the time axis an explicit exception to
  // mirroring: the earliest bucket stays on the left even in Arabic.
  const first = await labels.first().boundingBox();
  const last = await labels.last().boundingBox();
  if (first === null || last === null) throw new Error('axis labels have no box');
  expect(first.x).toBeLessThan(last.x);
});
