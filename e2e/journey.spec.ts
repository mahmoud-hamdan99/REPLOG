import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

/**
 * The journeys a user actually makes, end to end through the screens.
 *
 * The rest of the suite checks one promise each. These three check that the
 * promises join up: that a plan turns into a session and the session turns
 * into history; that a session logged in the tracker reaches the records and
 * the charts; and that a backup taken from the Data screen can actually bring
 * everything back after the database is wiped — which is the single most
 * important thing this app does and, until now, was only proven at the store
 * level. A round trip that works in a unit test and not on the screen is
 * worth nothing to the person whose phone just died.
 */

test.describe.configure({ timeout: 180_000 });

/** The one exercise these journeys log, named so it can be looked for later. */
const EXERCISE = 'Barbell Bench Press';

/** Starts an empty session and adds `EXERCISE` through the picker. */
async function startQuickWorkout(page: Page): Promise<void> {
  await page.goto('/train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  // Generous: a first run is still seeding the 168-exercise catalog, and
  // IndexedDB serialises that against the transaction creating the session.
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await expect(picker).toBeVisible();
  await picker.getByRole('searchbox').fill(EXERCISE);

  // By name rather than by position: the journeys that follow look this name
  // up on three other screens, so picking whatever happened to sort first
  // would make those assertions about nothing.
  await picker
    .getByRole('option', { name: new RegExp(EXERCISE, 'i') })
    .first()
    .click({
      timeout: 30_000,
    });
  await picker.getByRole('button', { name: /^Add/ }).click();
  await expect(picker).toBeHidden();
}

/** Types a load and a rep count on the pad, then commits with Done. */
async function logSet(page: Page, weight: string, reps: string): Promise<void> {
  await page.locator('.row__field').first().click();

  const pad = page.locator('rl-numeric-pad dialog');
  await expect(pad).toBeVisible();
  for (const digit of weight) {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Next field' }).click();
  for (const digit of reps) {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Done' }).click();
  await expect(pad).toBeHidden();
}

/** Finishes the session and lands on the summary. */
async function finishWorkout(page: Page): Promise<void> {
  // A confirmed set always raises the rest sheet, and it is a modal dialog:
  // the Finish button behind it is genuinely unclickable until it is gone.
  const rest = page.locator('rl-rest-timer dialog');
  await expect(rest).toBeVisible();
  await rest.getByRole('button', { name: 'Skip rest' }).click();
  await expect(rest).toBeHidden();

  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout' }).click();
  await expect(page).toHaveURL(/\/train\/summary\//, { timeout: 30_000 });
}

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

/** Rows currently in a store, read straight out of IndexedDB. */
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

test('a logged session reaches history and then the charts', async ({ page }) => {
  await startQuickWorkout(page);
  await logSet(page, '100', '5');
  await finishWorkout(page);

  // History: the list is keyed on the session, so the row carries the
  // workout's name; the exercise shows up one level in, on the detail.
  await page.goto('/history');
  await expect(page.getByText('Quick workout').first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('Quick workout').first().click();

  await expect(page).toHaveURL(/\/history\//, { timeout: 30_000 });
  await expect(page.getByText(EXERCISE).first()).toBeVisible();
  // The set as logged, not a rounded or re-derived figure.
  await expect(page.getByText('100').first()).toBeVisible();

  // Records: one working set with a weight on it earns a first record.
  await page.goto('/records');
  await expect(page.getByText(EXERCISE).first()).toBeVisible({ timeout: 30_000 });

  // Analytics: the same session, counted. "This week" is a count of stored
  // completed workouts, so one finished session has to move it off zero.
  await page.goto('/');
  const weekTile = page.locator('rl-stat-tile').filter({ hasText: 'This week' });
  await expect(weekTile).toBeVisible({ timeout: 30_000 });
  await expect(weekTile).toContainText('Completed sessions');
  // One, not an em dash: the tile distinguishes "none this week" from "no
  // data", and a finished session today is this week by definition.
  await expect(weekTile.locator('.tile__value')).toHaveText('1');

  await page.goto('/progress/volume');
  await expect(page.getByRole('heading', { level: 1, name: 'Volume' })).toBeVisible({
    timeout: 30_000,
  });
});

test('a backup taken from the Data screen restores everything after a reset', async ({ page }) => {
  // The promise the whole backup feature exists for, exercised through the
  // screens rather than through the store: export, wipe, import, compare.
  await startQuickWorkout(page);
  await logSet(page, '100', '5');
  await finishWorkout(page);

  const before = {
    workouts: await countRows(page, 'workouts'),
    setLogs: await countRows(page, 'setLogs'),
  };
  expect(before.workouts).toBeGreaterThan(0);
  expect(before.setLogs).toBeGreaterThan(0);

  await page.goto('/settings/data');

  // Export, capturing the file the browser is handed.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const saved = await (await download).path();
  const backup = await readFile(saved, 'utf8');
  expect(JSON.parse(backup).format).toBe('replog-backup');

  // Wipe it. The typed phrase is the guard, and it has to be exact.
  await page.getByRole('button', { name: 'Reset everything' }).click();
  const resetDialog = page.locator('dialog[open]');
  await resetDialog.getByRole('textbox').fill('DELETE');
  await resetDialog.getByRole('button', { name: 'Reset everything' }).click();
  await expect(resetDialog).toBeHidden({ timeout: 30_000 });

  await expect.poll(() => countRows(page, 'workouts'), { timeout: 30_000 }).toBe(0);
  expect(await countRows(page, 'setLogs')).toBe(0);

  // And bring it back.
  await stubFilePicker(page, backup, 'replog-backup.json');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await expect(page.getByText('What this file contains')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Merge' }).click();

  await expect.poll(() => countRows(page, 'workouts'), { timeout: 60_000 }).toBe(before.workouts);
  expect(await countRows(page, 'setLogs')).toBe(before.setLogs);

  // And the restored session is readable on the screen it belongs on, not
  // merely present in the database. Opened rather than glanced at, because
  // the row renders from the workout alone while the detail has to resolve
  // the exercise and its set logs — which is where a broken restore shows.
  await page.goto('/history');
  await page.getByText('Quick workout').first().click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/history\//, { timeout: 30_000 });
  await expect(page.getByText(EXERCISE).first()).toBeVisible();
  await expect(page.getByText('100').first()).toBeVisible();
});

test('a plan becomes a workout, and the workout becomes history', async ({ page }) => {
  // The journey IMPLEMENTATION_PLAN §17 names first: plan → train → finish →
  // history. The other journey in this file starts from a quick workout,
  // which skips the planner entirely — so the half of the app that turns an
  // intention into a session had no end-to-end coverage at all.
  await page.goto('/plans');
  await page.getByRole('button', { name: 'New plan' }).first().click();
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+$/, { timeout: 30_000 });

  await page.getByLabel('Plan name').fill('Week A');
  await page.getByLabel('Plan name').blur();

  await page.getByRole('button', { name: 'New workout day' }).click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+$/, { timeout: 30_000 });

  await page.getByLabel('Name', { exact: true }).fill('Push day');
  await page.getByLabel('Name', { exact: true }).blur();

  // Flexible rather than fixed to a weekday: a scheduled day would only
  // appear on Train one day in seven, and a test that passes on Tuesdays is
  // not a test.
  await page.getByRole('radio', { name: 'Flexible' }).check();

  // The planner has its own picker sheet rather than the tracker's
  // rl-exercise-picker — a duplicate worth collapsing one day, and the reason
  // this journey could not simply reuse the helper above.
  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('dialog[open]');
  await expect(picker).toBeVisible();
  await picker.getByRole('searchbox').fill(EXERCISE);
  await picker.getByRole('button', { name: EXERCISE, exact: true }).first().click({
    timeout: 30_000,
  });
  await picker.getByRole('button', { name: /^Add/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText(EXERCISE).first()).toBeVisible();

  // Train offers the day, and starting it carries the plan's name into the
  // session rather than inventing one.
  await page.goto('/train');
  await page.getByText('Push day').first().click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 30_000 });
  await expect(page.getByText(EXERCISE).first()).toBeVisible();

  await logSet(page, '80', '8');
  await finishWorkout(page);

  // And history calls it what the plan called it.
  await page.goto('/history');
  await expect(page.getByText('Push day').first()).toBeVisible({ timeout: 30_000 });
});
