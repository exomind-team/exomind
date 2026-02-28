import { expect, test } from '@playwright/test';

const zhRoutes = ['/', '/features', '/download', '/changelog', '/docs', '/about'];
const enRoutes = ['/en/', '/en/features', '/en/download', '/en/changelog', '/en/docs', '/en/about'];

test.describe('官网冒烟测试 (Website Smoke Tests)', () => {
  test('主页应可访问并显示品牌名 (Homepage should render brand)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ExoMind/i);
    await expect(page.getByRole('link', { name: 'ExoMind' }).first()).toBeVisible();
  });

  test('中文核心页面应返回 200 并可见主内容 (ZH routes should be healthy)', async ({ page }) => {
    for (const path of zhRoutes) {
      const response = await page.goto(path);
      expect(response?.status(), `Unexpected status for ${path}`).toBe(200);
      await expect(page.locator('main')).toBeVisible();
    }
  });

  test('英文核心页面应返回 200 并可见主内容 (EN routes should be healthy)', async ({ page }) => {
    for (const path of enRoutes) {
      const response = await page.goto(path);
      expect(response?.status(), `Unexpected status for ${path}`).toBe(200);
      await expect(page.locator('main')).toBeVisible();
    }
  });
});
