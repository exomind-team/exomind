import { test, expect } from '@playwright/test';

test.describe('Settings Page Sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/new/settings');
  });

  test('More section is visible', async ({ page }) => {
    await expect(page.getByText('更多')).toBeVisible();
    await expect(page.getByText('更新')).toBeVisible();
    await expect(page.getByText('遥测')).toBeVisible();
    await expect(page.getByText('报告问题')).toBeVisible();
    await expect(page.getByText('调试日志')).toBeVisible();
  });

  test('Legal section is visible', async ({ page }) => {
    await expect(page.getByText('法律与支持')).toBeVisible();
    await expect(page.getByText('隐私政策')).toBeVisible();
    await expect(page.getByText('用户协议')).toBeVisible();
    await expect(page.getByText('官网')).toBeVisible();
    await expect(page.getByText('赞助开发者')).toBeVisible();
    await expect(page.getByText('开源软件使用声明')).toBeVisible();
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
