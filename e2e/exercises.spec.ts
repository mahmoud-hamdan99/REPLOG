import { expect, test } from '@playwright/test';

/**
 * Custom exercises, and the one dialog in the app that cannot be undone from
 * inside it.
 *
 * Phase 14's copy review found this dialog reading "Delete" over the words
 * "Your exercise" — a destructive confirmation that named nothing and
 * promised nothing. It has no automated coverage at all, which is how it got
 * that way, so the fix comes with a test that reads the sentence.
 */

test.describe.configure({ timeout: 120_000 });

const NAME = 'Zercher Carry Test';

test('a custom exercise can be created, found, and deleted with a warning that says what happens', async ({
  page,
}) => {
  await page.goto('/exercises/new');
  await page.getByLabel('Name (English)').fill(NAME);
  await page.getByLabel('Name (Arabic)').fill('حمل زيرشر');
  await page.getByRole('button', { name: 'Save' }).click();

  // Saving navigates to the new exercise. Waited for rather than assumed:
  // leaving the page while the write is in flight loses it, which is exactly
  // what the first draft of this test did.
  await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByText('Your exercise')).toBeVisible();

  // Findable by search, which is the only way a library of 169 is usable.
  await page.goto('/exercises');
  await page.getByRole('searchbox').fill('zercher');
  await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(NAME).first().click();
  await expect(page.getByText('Your exercise')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Delete' }).first().click();

  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByText('Delete this exercise?')).toBeVisible();
  // The three facts the old copy left out: which exercise, what happens to
  // history, and that there is no undo.
  await expect(dialog).toContainText(NAME);
  await expect(dialog).toContainText('keep the name they recorded');
  await expect(dialog).toContainText('not listed under Recently deleted');

  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/exercises$/, { timeout: 30_000 });

  await page.getByRole('searchbox').fill('zercher');
  await expect(page.getByText(NAME)).toHaveCount(0);
});
