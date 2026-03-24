import { expect, test } from '@playwright/test';

test.describe('官网暗色模式 (Website Dark Mode)', () => {
  test('should toggle dark mode and persist the preference', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const html = page.locator('html');
    const themeToggle = page.getByTestId('theme-toggle');

    await expect(themeToggle).toBeVisible();
    await expect(html).not.toHaveClass(/dark/);

    await themeToggle.click();
    await expect(html).toHaveClass(/dark/);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(html).toHaveClass(/dark/);
  });
});
