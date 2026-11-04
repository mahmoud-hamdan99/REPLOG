import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 11 promises that only a real browser can check.
 *
 * The unit suite proves the round trip, the validator branches and the merge
 * rules. What it cannot prove is that the guards standing between a user and
 * an unrecoverable action are actually wired to the buttons — a typed
 * confirmation that enabled on the wrong keystroke, or a blocking report that
 * still offered an import, would pass every test in `domain/` and destroy
 * somebody's training history.
 */

test.describe.configure({ timeout: 120_000 });

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

test('a file that is not a backup is reported and cannot be imported', async ({ page }) => {
  await page.goto('/settings/data');
  await stubFilePicker(page, '{"hello":"world"}', 'not-a-backup.json');

  await page.getByRole('button', { name: 'Choose a file' }).click();

  await expect(page.getByText('This is not a REPLOG backup file.')).toBeVisible({
    timeout: 20_000,
  });
  // The whole point of a blocking report: no way forward but a different file.
  await expect(page.getByRole('button', { name: 'Merge' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replace everything' })).toHaveCount(0);

  // And dismissing it gives the picker back rather than a fresh complaint
  // about a file nobody chose.
  await page.getByRole('button', { name: 'Choose a different file' }).click();
  await expect(page.getByRole('button', { name: 'Choose a file' })).toBeVisible();
});

test('a backup with a broken checksum warns and still offers to import', async ({ page }) => {
  const backup = {
    format: 'replog-backup',
    formatVersion: 1,
    schemaVersion: 1,
    appVersion: '0.0.0',
    exportedAt: '2026-10-01T08:05:00.000Z',
    deviceId: 'another-phone',
    options: { includePhotos: false, includeDeleted: false },
    counts: { measurements: 0 },
    integrity: { algorithm: 'sha-256', value: 'deadbeef' },
    prefs: { language: 'en', numerals: 'latn', theme: 'dark' },
    data: { measurements: [] },
    photoBlobs: [],
  };

  await page.goto('/settings/data');
  await stubFilePicker(page, JSON.stringify(backup), 'edited.json');
  await page.getByRole('button', { name: 'Choose a file' }).click();

  // A hand-edited backup is still better than no backup, so this warns
  // rather than refuses.
  await expect(page.getByText(/does not match its own checksum/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Merge' })).toBeVisible();
});

test('reset is gated on typing the exact phrase', async ({ page }) => {
  await page.goto('/settings/data');
  await page.getByRole('button', { name: 'Reset everything' }).click();

  const dialog = page.locator('dialog[open]');
  const confirm = dialog.getByRole('button', { name: 'Reset everything' });
  await expect(confirm).toBeDisabled();

  const field = dialog.getByRole('textbox');
  await field.fill('DELET');
  await expect(confirm).toBeDisabled();

  await field.fill('delete');
  await expect(confirm).toBeDisabled();

  await field.fill('DELETE');
  await expect(confirm).toBeEnabled();

  // Nothing is confirmed here: the assertion is about the gate, and a test
  // that wiped the database would take the rest of the suite with it.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('the integrity check reports on the real database rather than guessing', async ({ page }) => {
  await page.goto('/settings/data');
  await page.getByRole('button', { name: 'Run check' }).click();

  // Either outcome is correct; what matters is that it answers from the data
  // rather than leaving the card in its unrun state.
  await expect(
    page.getByText('Nothing to fix.').or(page.getByText('Export before fixing anything.')),
  ).toBeVisible({ timeout: 30_000 });
});

test('the recovery screen states the window it promises', async ({ page }) => {
  await page.goto('/settings/deleted');

  await expect(page.getByText(/waits here for 30 days/)).toBeVisible({ timeout: 20_000 });
});

test('the data screen mirrors and translates', async ({ page }) => {
  // Language stays on the Settings hub rather than moving to a sub-screen,
  // because it changes the whole interface the instant it is touched.
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'العربية' }).check({ timeout: 20_000 });

  await page.goto('/settings/data');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('تصدير نسخة احتياطية')).toBeVisible({ timeout: 20_000 });

  // The typed phrase has to be one an Arabic keyboard can produce.
  await page.getByRole('button', { name: 'احذف كل شيء' }).first().click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByText(/اكتب «احذف» للتأكيد/)).toBeVisible();

  await dialog.getByRole('button', { name: 'إلغاء' }).click();

  // Put it back: the preference is stored, and a later test in this file
  // would otherwise meet an interface it does not expect.
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'English' }).check();
});
