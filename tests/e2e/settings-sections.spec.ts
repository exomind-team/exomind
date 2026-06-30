import { test, expect } from '@playwright/test';

test.describe('Settings Page Sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/new/settings');
  });

  test('More section is visible', async ({ page }) => {
    await expect(page.getByText('更多')).toBeVisible();
    await expect(page.getByText('更新')).toBeVisible();
    await expect(page.getByText('调试日志')).toBeVisible();
    // 遥测/报告问题/法律与支持/赞助开发者等已随精简移除。
    await expect(page.getByText('遥测')).toHaveCount(0);
    await expect(page.getByText('报告问题')).toHaveCount(0);
    await expect(page.getByText('法律与支持')).toHaveCount(0);
    await expect(page.getByText('赞助开发者')).toHaveCount(0);
  });

  test('About section is visible', async ({ page }) => {
    await expect(page.getByText('关于')).toBeVisible();
    await expect(page.getByText('版本')).toBeVisible();
    await expect(page.getByText('构建')).toBeVisible();
  });

  test('User card does not show activate button（不显示激活按钮）', async ({ page }) => {
    await expect(page.getByText('激活')).toHaveCount(0);
  });
});
