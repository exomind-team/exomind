import { expect, test, type Page } from '@playwright/test';

async function setupIssue198Flags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('exomind:uiMode', 'new');
    localStorage.setItem('exomind:developerMode', 'true');
  });
}

test.describe('Issue #198 settings desktop shell（设置页桌面壳层）', () => {
  test.beforeEach(async ({ page }) => {
    await setupIssue198Flags(page);
  });

  test('desktop shows sidebar and settings nav（桌面显示侧栏和设置导航）', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('desktop-settings-nav')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-dashboard')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-now')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-tasks')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-agents')).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar-item-settings')).toBeVisible();
    await expect(page.locator('[data-testid^="desktop-sidebar-item-"]')).toHaveCount(5);
    await expect(page.getByTestId('mobile-bottom-tab')).toBeHidden();
  });

  test('mobile keeps bottom tab nav on settings（移动端保留底部导航）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
    await expect(page.getByRole('link', { name: '设置' })).toBeVisible();
    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
  });

  test('desktop adaptive switch can fallback to mobile shell（桌面适配开关可回退移动壳层）', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();

    const featureTogglesRow = page.getByText('功能开关');
    await featureTogglesRow.scrollIntoViewIfNeeded();
    await featureTogglesRow.click();

    await page.getByTestId('new-settings-desktop-adaptive-switch').click();

    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
  });

  test('desktop sidebar nav leaves settings desktop shell on non-settings route（桌面侧栏跳转非设置后回到移动壳层）', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await page.getByTestId('desktop-sidebar-item-dashboard').click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
    await expect(page.getByTestId('mobile-bottom-tab')).toBeVisible();
  });
});
