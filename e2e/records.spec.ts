import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 acceptance checks that need a real browser.
 *
 * The engine suite proves detection, variant scoping and rebuild determinism
 * against real IndexedDB. What it cannot prove is that the screens keep the
 * promises the records themselves rest on: that an estimate is marked on
 * screen, and that a suggestion never commits anything on its own.
 */

// Each test records a workout before it can assert anything, and on a first
// run that includes seeding the built-in catalog.
test.describe.configure({ timeout: 120_000 });

/** Logs one set of a quick workout and finishes it. */
async function recordWorkout(page: Page, weight: string, reps: string): Promise<void> {
  await page.goto('/train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await picker.getByRole('searchbox').fill('barbell bench press');
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
  await expect(page).toHaveURL(/\/train\/summary\//);
}

test('a finished workout announces the records it earned', async ({ page }) => {
  await recordWorkout(page, '100', '5');

  // Type, value and what it beat — a first record says so rather than
  // claiming an improvement over nothing.
  await expect(page.getByText('Heaviest weight')).toBeVisible();
  await expect(page.getByText('First record').first()).toBeVisible();
});

test('every estimated value on screen is marked and names its formula', async ({ page }) => {
  await recordWorkout(page, '100', '5');

  const estimate = page.locator('rl-card').filter({ hasText: 'Estimated one-rep max' });
  await expect(estimate).toBeVisible();
  await expect(estimate.getByText('Epley formula')).toBeVisible();

  await page.goto('/progress');
  const onRecords = page.locator('rl-card').filter({ hasText: 'Estimated one-rep max' }).first();
  await expect(onRecords.getByText('Epley formula')).toBeVisible();
});

test('records are grouped per variant, and the screen says why', async ({ page }) => {
  await recordWorkout(page, '100', '5');

  await page.goto('/progress');
  await expect(page.getByText(/never replaces a barbell press/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Records' })).toBeVisible();
  // One card per exercise under "All records", never one merged list.
  await expect(page.locator('.grp')).toHaveCount(1);
});

test('a suggestion fills the row but never commits it', async ({ page }) => {
  // One session to have something to suggest from.
  await recordWorkout(page, '100', '5');

  await page.goto('/train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await picker.getByRole('searchbox').fill('barbell bench press');
  await picker.getByRole('option').first().click({ timeout: 20_000 });
  await picker.getByRole('button', { name: /^Add/ }).click();

  const hint = page.locator('rl-suggestion-hint');
  await expect(hint).toBeVisible();
  await expect(hint.getByText('Try next')).toBeVisible();
  // The reason is part of the offer, not an optional extra.
  await expect(hint.locator('.hint__reason')).not.toBeEmpty();

  const row = page.locator('rl-set-row').first();
  await expect(row.locator('.row__field').first()).toHaveText('—');

  await hint.getByRole('button', { name: 'Use this' }).click();

  // Filled in, and still not logged: the tick is untouched.
  await expect(row.locator('.row__field').first()).not.toHaveText('—');
  await expect(row.locator('.row__check')).toHaveAttribute('aria-pressed', 'false');
});

test('no suggestion is offered for an exercise with no history', async ({ page }) => {
  await page.goto('/train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await picker.getByRole('searchbox').fill('barbell bench press');
  await picker.getByRole('option').first().click({ timeout: 20_000 });
  await picker.getByRole('button', { name: /^Add/ }).click();

  // The honest answer, rather than a starting weight invented for the user.
  await expect(page.getByText('No history yet')).toBeVisible();
  await expect(page.locator('rl-suggestion-hint')).toHaveCount(0);
});
