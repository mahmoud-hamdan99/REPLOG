import { expect, test } from '@playwright/test';

/**
 * Phase 1 acceptance checks that only a real browser can make: pre-paint theme
 * and direction, instant reload-free language switching, persistence across a
 * reload, and deep-linked routing.
 */

test('boots and renders the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('rl-root')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home');
  await expect(page.locator('.tab')).toHaveCount(5);
});

test('skip link is the first focusable element and targets main', async ({ page }) => {
  await page.goto('/');
  // Wait for the shell to render: goto resolves on load, before Angular boots.
  await expect(page.locator('.tab')).toHaveCount(5);
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip');
  await expect(skip).toBeFocused();

  // Activating it moves focus into the content, past the chrome.
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
});

test('resolves theme and direction before Angular boots', async ({ page }) => {
  // Seed preferences, then load: the inline pre-paint script must apply them
  // so there is no flash of the wrong theme or direction.
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'replog.prefs.v1',
      JSON.stringify({ prefsVersion: 1, language: 'ar', theme: 'light' }),
    ),
  );
  await page.reload();

  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('switches language instantly, without a reload', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.getByRole('radio', { name: 'العربية' }).check();

  // Same document, no navigation: direction and copy change in place.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الإعدادات');
});

test('persists language across a reload', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'العربية' }).check();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الإعدادات');
});

test('switches theme and updates the status bar colour', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Light' }).check();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f7f8');

  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b0c0e');
});

test('resolves a deep-linked route and sets the document title', async ({ page }) => {
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('History');
  await expect(page).toHaveTitle(/History · REPLOG/);
});

test('shows a not-found page for an unknown route rather than redirecting', async ({ page }) => {
  await page.goto('/nope/not-a-route');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('bottom navigation moves between destinations', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab', { hasText: 'Plans' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plans');
  await expect(page.locator('.tab--active')).toContainText('Plans');
});

test('hides the tab bar on the active workout screen', async ({ page }) => {
  await page.goto('/train/active');
  // With no session in progress the screen says so rather than rendering a
  // tracker over nothing; either way the tab bar stays hidden, because leaving
  // a workout must be a deliberate choice and not a stray tab tap.
  await expect(page.getByText('No workout in progress')).toBeVisible();
  await expect(page.locator('.tab')).toHaveCount(0);
});
