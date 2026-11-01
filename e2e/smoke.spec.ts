import { expect, test } from '@playwright/test';

test('application boots and renders its root component', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('rl-root')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('REPLOG');
});
