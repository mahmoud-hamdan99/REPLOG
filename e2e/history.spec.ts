import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 6 acceptance checks that need a real browser.
 *
 * The store suite proves paging, snapshots and the delete/restore cascade
 * against a real IndexedDB. What it cannot prove is that the screens are wired
 * to it — that finishing a workout puts a row in history, that correcting a
 * set there writes through, and that the undo on a deletion actually restores.
 */

// Each test records a workout before it can assert anything about history,
// and on a first run that includes seeding the built-in catalog. The default
// per-test budget is sized for a single interaction, not a whole session.
test.describe.configure({ timeout: 120_000 });

/** Logs one set of a quick workout and finishes it, leaving a history row. */
async function recordWorkout(page: Page, weight: string, reps: string): Promise<void> {
  await page.goto('/train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  // Starting a session on a cold database also seeds the exercise catalog,
  // which on WebKit is seconds rather than milliseconds.
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 40_000 });

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await picker.getByRole('searchbox').fill('bench');
  await picker.getByRole('option').first().click({ timeout: 20_000 });
  await picker.getByRole('button', { name: /^Add/ }).click();

  await page.locator('.row__field').first().click();
  const pad = page.locator('rl-numeric-pad dialog');
  for (const digit of weight) {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Next field' }).click();
  for (const digit of reps) {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Done' }).click();

  const rest = page.locator('rl-rest-timer dialog');
  await expect(rest).toBeVisible();
  await rest.getByRole('button', { name: 'Skip rest' }).click();

  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout' }).click();
  // Finishing writes the whole session in one transaction and detects records
  // inside it, so this is a piece of real work rather than a navigation.
  await expect(page).toHaveURL(/\/train\/summary\//, { timeout: 30_000 });
}

test('a finished workout appears in history with its measured totals', async ({ page }) => {
  await recordWorkout(page, '100', '5');

  await page.goto('/history');
  const row = page.locator('.row').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Quick workout');
  // 100 × 5 = 500, recomputed from the set logs rather than asserted by the
  // workout record.
  await expect(row).toContainText('500');
});

test('a correction writes through and marks the workout as edited', async ({ page }) => {
  await recordWorkout(page, '100', '5');

  await page.goto('/history');
  await page.locator('.row__btn').first().click();
  await expect(page).toHaveURL(/\/history\/[^/]+$/);

  await page.getByRole('button', { name: 'Correct a mistake' }).click();
  await page.locator('.row__field').first().click();

  const pad = page.locator('rl-numeric-pad dialog');
  await pad.getByRole('button', { name: 'Clear' }).click();
  for (const digit of '120') {
    await pad.getByRole('button', { name: `Digit ${digit}` }).click();
  }
  await pad.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('.row__field').first()).toHaveText('120');
  await expect(page.getByText('Edited')).toBeVisible();
  // 120 × 5 = 600; the rollups follow the sets, not the other way round.
  await expect(page.getByText('600')).toBeVisible();
});

test('deleting a workout is undoable, and brings its sets back', async ({ page }) => {
  await recordWorkout(page, '100', '5');

  await page.goto('/history');
  await page.locator('.row__btn').first().click();
  // Wait for the router before reading the URL: the click resolves immediately
  // and `page.url()` would still be the list.
  await expect(page).toHaveURL(/\/history\/[^/]+$/);
  const detailUrl = page.url();

  await page.getByRole('button', { name: 'Delete workout' }).first().click();

  // Scoped to the dialog: the page's own Delete button carries the same label,
  // and a positional match between the two is a coin toss waiting to land.
  const confirm = page.locator('rl-dialog dialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete workout' }).click();

  await expect(page).toHaveURL(/\/history$/);
  await expect(page.locator('.row')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.row')).toHaveCount(1);

  // Restored whole, not as an empty shell: the cascade is identified by when
  // the children were tombstoned relative to their workout.
  await page.goto(detailUrl);
  await expect(page.locator('rl-set-row')).toHaveCount(1);
  await expect(page.getByText('500')).toBeVisible();
});
