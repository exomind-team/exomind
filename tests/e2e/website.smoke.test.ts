import { expect, test } from '@playwright/test';

const zhRoutes = ['/', '/features', '/download', '/changelog', '/docs', '/about'];
const enRoutes = ['/en/', '/en/features', '/en/download', '/en/changelog', '/en/docs', '/en/about'];

test.describe('官网冒烟测试 (Website Smoke Tests)', () => {
  test('主页应可访问并显示品牌名 (Homepage should render brand)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ExoMind/i);
    await expect(page.getByRole('link', { name: 'ExoMind' }).first()).toBeVisible();
  });

  test('首页应体现认知主权叙事 (Homepage should reflect cognitive sovereignty messaging)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('本地优先 · 事件驱动 · 认知主权')).toBeVisible();
  });

  test('文档页不应再是占位页 (Docs page should no longer be a coming-soon placeholder)', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByText('文档正在编写中，敬请期待...')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '治理与所有制' })).toBeVisible();
  });

  test('更新日志页应展示当前版本 (Changelog should show current release)', async ({ page }) => {
    await page.goto('/changelog');
    await expect(page.getByText('v0.3.6 开发中')).toBeVisible();
  });

  test('下载页只宣传真实可下载平台 (Download page should only promote real installers)', async ({ page }) => {
    await page.route('**/api/versions?channel=release', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          channel: 'release',
          latest: {
            version: 'v0.3.6',
            tag: 'release/v0.3.6',
            published_at: '2026-03-18T00:00:00Z',
            assets: {
              'windows-x64-setup': {
                url: 'release/v0.3.6/ExoMind-v0.3.6-windows-x64-setup.exe',
                size: 1024,
                sha256: 'windows',
              },
              'android-arm64': {
                url: 'release/v0.3.6/ExoMind-v0.3.6-android-arm64.apk',
                size: 2048,
                sha256: 'android',
              },
            },
          },
        }),
      });
    });

    await page.goto('/download');

    await expect(page.locator('[data-platform="windows-x64-setup"] .card-download-btn')).toBeVisible();
    await expect(page.locator('[data-platform="android-arm64"] .card-download-btn')).toBeVisible();
    await expect(page.locator('[data-platform="macos-aarch64"]')).toContainText('即将推出');
    await expect(page.locator('[data-platform="linux-x64-appimage"]')).toContainText('即将推出');
    await expect(page.getByText('暂无可用版本')).toHaveCount(0);
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
