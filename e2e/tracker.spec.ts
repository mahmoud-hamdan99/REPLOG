import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5 acceptance checks that only a real browser can make.
 *
 * The unit suite proves the store's reliability contract against a real
 * IndexedDB; what it cannot prove is that a genuine reload — a new JavaScript
 * realm, a cold boot of the app — finds the same data, or that the route guard
 * actually stops a navigation. Those need a browser.
 */

/** Starts an empty session and adds one exercise through the picker. */
async function startQuickWorkout(page: Page, search: string): Promise<void> {
  await page.goto('/train');
  await page.getByRole('button', { name: 'Quick workout' }).click();
  // Generous on purpose: on a first run the catalog is still seeding, and
  // IndexedDB serialises that transaction against the one creating the
  // session. Measured at about six seconds on WebKit, under half a second
  // once the catalog is on disk.
  await expect(page).toHaveURL(/\/train\/active$/, { timeout: 20_000 });

  await page.getByRole('button', { name: 'Add exercise' }).first().click();
  const picker = page.locator('rl-exercise-picker dialog');
  await expect(picker).toBeVisible();

  await picker.getByRole('searchbox').fill(search);
  // The catalog may still be seeding on a first run; the picker says so rather
  // than claiming nothing matches.
  await picker.getByRole('option').first().click({ timeout: 20_000 });
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

/**
 * Closes the rest sheet that a confirmed set brings up.
 *
 * It is a modal `<dialog>`, so anything behind it is genuinely unclickable —
 * which is the point, and which means a test that wants the tracker again has
 * to dismiss it exactly as a user would.
 */
async function dismissRest(page: Page): Promise<void> {
  const sheet = page.locator('rl-rest-timer dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Skip rest' }).click();
  await expect(sheet).toBeHidden();
}

test('a confirmed set survives a full reload of the app', async ({ page }) => {
  await startQuickWorkout(page, 'bench');
  await logSet(page, '100', '5');
  await dismissRest(page);

  const row = page.locator('rl-set-row').first();
  await expect(row.locator('.row__check')).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.row__field').first()).toHaveText('100');

  // The real thing: a new realm, reading only what reached the disk.
  await page.reload();

  // Never resumes on its own — the user has to choose.
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await expect(resume).toBeVisible();
  await resume.click();

  const recovered = page.locator('rl-set-row').first();
  await expect(recovered.locator('.row__check')).toHaveAttribute('aria-pressed', 'true');
  await expect(recovered.locator('.row__field').first()).toHaveText('100');
  await expect(recovered.locator('.row__field').nth(1)).toHaveText('5');
});

test('leaving the tracker is impossible without an explicit choice', async ({ page }) => {
  await startQuickWorkout(page, 'bench');
  await logSet(page, '60', '8');
  await dismissRest(page);

  // Any navigation away, including the browser's own back button.
  await page.goBack();

  await expect(page.getByText('Leave this workout?')).toBeVisible();
  // While the question is open the tracker is still the rendered screen, with
  // the logged set on it. The address bar has already moved — the browser did
  // that before the guard ran — and the router puts it back once the guard
  // resolves, which is what the assertion after the answer checks.
  await expect(page.getByRole('button', { name: 'Weight, set 1' })).toHaveText('60');

  await page.getByRole('button', { name: 'Keep training' }).click();
  await expect(page.getByText('Leave this workout?')).toBeHidden();
  await expect(page).toHaveURL(/\/train\/active$/);
});

test('pausing and leaving keeps the session, and the Train screen offers it back', async ({
  page,
}) => {
  await startQuickWorkout(page, 'bench');
  await logSet(page, '80', '6');
  await dismissRest(page);

  await page.goBack();
  await page.getByRole('button', { name: 'Pause and exit' }).click();

  await expect(page).toHaveURL(/\/train$/);
  await expect(page.getByText('Workout in progress')).toBeVisible();
});

test('finishing writes the session to history and shows measured totals', async ({ page }) => {
  await startQuickWorkout(page, 'bench');
  await logSet(page, '100', '5');
  await dismissRest(page);

  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish workout' }).click();

  await expect(page).toHaveURL(/\/train\/summary\//);
  await expect(page.getByText('Workout complete')).toBeVisible();

  // 100 × 5 = 500, and the two rows that were never confirmed are reported
  // rather than quietly dropped.
  await expect(page.getByText('500')).toBeVisible();
  await expect(page.getByText(/never confirmed|unconfirmed/)).toBeVisible();
});

test('the rest timer counts down from a timestamp', async ({ page }) => {
  await startQuickWorkout(page, 'bench');
  await logSet(page, '100', '5');

  // Confirming a set auto-starts the rest and brings up its sheet.
  const sheet = page.locator('rl-rest-timer dialog');
  await expect(sheet).toBeVisible();

  const first = await sheet.locator('.rest__time').innerText();
  await page.waitForTimeout(1500);
  const second = await sheet.locator('.rest__time').innerText();

  expect(second).not.toEqual(first);
  await expect(sheet.getByText(/No alert can sound/)).toBeVisible();
});
