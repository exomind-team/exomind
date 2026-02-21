import { test, expect } from '@playwright/test';

/**
 * 首页 E2E 测试
 *
 * 测试场景：
 * 1. 访问首页验证页面正确加载
 * 2. 验证侧边栏显示所有导航项
 * 3. 验证首页标题 "ExoMind" 正确显示
 * 4. 验证侧边栏导航链接可点击
 * 5. 验证响应式布局（桌面端侧边栏应显示）
 * 6. 验证 app-container 正确渲染
 */

test.describe('首页 (/)，', () => {
  test.beforeEach(async ({ page }) => {
    // 访问首页
    await page.goto('/');
    // 等待页面加载完成
    await page.waitForLoadState('networkidle');
  });

  test('应该正确加载页面', async ({ page }) => {
    // 验证页面标题
    await expect(page).toHaveTitle(/ExoMind/i);

    // 验证 app-container 存在
    const appContainer = page.locator('[class*="flex h-screen"]');
    await expect(appContainer).toBeVisible();
  });

  test('应该显示侧边栏和所有导航项', async ({ page }) => {
    // 验证侧边栏存在
    const sidebar = page.locator('[data-testid="device-panel"]');
    await expect(sidebar).toBeVisible();

    // 验证所有导航项都存在（Sidebar 定义的导航）
    await expect(page.getByRole('link', { name: '聊天' })).toBeVisible();
    await expect(page.getByRole('link', { name: '设备' })).toBeVisible();
    await expect(page.getByRole('link', { name: '设置' })).toBeVisible();
  });

  test('应该显示 ExoMind 标题', async ({ page }) => {
    // 验证侧边栏中的 ExoMind 标题
    const sidebarTitle = page.locator('aside h1');
    await expect(sidebarTitle).toHaveText('ExoMind');

    // 验证主页面的 ExoMind 标题
    const mainTitle = page.locator('main h1');
    await expect(mainTitle).toHaveText('ExoMind');
  });

  test('侧边栏导航链接应该可点击并导航', async ({ page }) => {
    // 点击设置链接
    await page.getByRole('link', { name: '设置' }).click();
    await page.waitForLoadState('networkidle');

    // 验证 URL 变化
    await expect(page).toHaveURL(/\/settings/);
  });

  test('桌面端响应式布局 - 侧边栏应该显示', async ({ page }) => {
    // 设置桌面视口
    await page.setViewportSize({ width: 1280, height: 720 });

    // 验证侧边栏在桌面端可见
    const sidebar = page.locator('[data-testid="device-panel"]');
    await expect(sidebar).toBeVisible();

    // 验证侧边栏宽度
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox?.width).toBeGreaterThan(200);
  });

  test('app-container 应该正确渲染', async ({ page }) => {
    // 验证主内容区域存在
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // 验证主内容区域有内容
    const mainContent = page.locator('main .max-w-4xl');
    await expect(mainContent).toBeVisible();

    // 验证功能导航卡片存在
    const featureCards = page.locator('main a[href="/eventlog"]');
    await expect(featureCards.first()).toBeVisible();

    // 验证使用指南区域存在
    const guideSection = page.locator('main .border.rounded-lg').first();
    await expect(guideSection).toBeVisible();
  });
});

test.describe('首页导航流程', () => {
  test('应该能从侧边栏导航到事件日志', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 点击事件日志卡片
    await page.getByRole('link', { name: '事件日志' }).click();
    await page.waitForLoadState('networkidle');

    // 验证 URL 变化
    await expect(page).toHaveURL(/\/eventlog/);
  });

  test('应该能从侧边栏导航到设备页面', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 点击设备链接
    await page.getByRole('link', { name: '设备' }).click();
    await page.waitForLoadState('networkidle');

    // 验证 URL 变化
    await expect(page).toHaveURL(/\/devices/);
  });
});

test.describe('首页布局结构', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('应该包含正确的布局结构', async ({ page }) => {
    // 验证 flex 布局
    const container = page.locator('.flex h-screen');
    await expect(container).toBeVisible();

    // 验证侧边栏在左侧
    const sidebar = page.locator('aside.w-64');
    await expect(sidebar).toBeVisible();

    // 验证主内容区域在右侧
    const main = page.locator('main.flex-1');
    await expect(main).toBeVisible();
  });

  test('应该显示欢迎信息和副标题', async ({ page }) => {
    // 验证副标题存在
    const subtitle = page.locator('main .text-xl.text-muted-foreground');
    await expect(subtitle).toContainText('生命成长助手');
  });
});
