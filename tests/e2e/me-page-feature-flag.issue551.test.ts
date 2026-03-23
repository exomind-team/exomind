import { expect, test, type Page } from '@playwright/test';

async function setupIssue551Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:developerMode', 'true');
    localStorage.setItem('exomind:commandPaletteEnabled', 'true');
  });
}

test.describe('Issue #551 me page feature flag（Me 页面功能开关）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue551Flags(page);
  });

  test('me entry stays hidden by default and /me redirects to settings（默认隐藏入口且 /me 跳转设置）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks');
    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();

    await expect(page.getByRole('link', { name: 'Me' })).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByTestId('command-palette-overlay')).toBeVisible();
    await page.getByTestId('command-palette-input').fill('Me');
    await expect(page.getByTestId('command-palette-item-navigate:me')).toHaveCount(0);

    await page.goto('/me');
    await expect(page).toHaveURL(/\/settings$/);
  });
});
