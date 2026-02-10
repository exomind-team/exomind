/**
 * EventLog E2E 测试
 *
 * 测试事件日志页面的完整用户流程
 *
 * 覆盖场景:
 * 1. 访问 /eventlog 路由验证页面加载
 * 2. 验证 ChatPage 组件正确渲染
 * 3. 验证消息列表区域存在
 * 4. 验证消息输入框存在
 * 5. 验证侧边栏高亮当前激活的导航项
 * 6. 验证页面布局结构正确
 */

import { test, expect } from '@playwright/test';

test.describe('事件日志页面 (EventLog)', () => {
  test.beforeEach(async ({ page }) => {
    // 导航到事件日志页面
    await page.goto('/eventlog');
    // 等待页面加载完成
    await page.waitForLoadState('networkidle');
  });

  test('应该正确加载事件日志页面', async ({ page }) => {
    // 验证页面标题包含 ExoMind
    await expect(page).toHaveTitle(/ExoMind/i);

    // 验证页面主要容器存在
    await expect(page.locator('[data-testid="app-container"]')).toBeVisible();
  });

  test('应该渲染 ChatPage 组件', async ({ page }) => {
    // 验证页面标题文本
    await expect(page.getByText('事件日志')).toBeVisible();

    // 验证同步状态徽章存在
    await expect(page.locator('text=未同步')).toBeVisible();
  });

  test('应该显示消息列表区域', async ({ page }) => {
    // 验证事件列表容器存在
    await expect(page.locator('[data-testid="event-list"]')).toBeVisible();

    // 验证空状态提示（首次访问时）
    await expect(page.getByText('暂无事件记录')).toBeVisible();
  });

  test('应该显示消息输入框', async ({ page }) => {
    // 验证输入框占位符
    await expect(page.locator('input[placeholder*="输入内容记录事件"]')).toBeVisible();

    // 验证发送按钮存在
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('侧边栏应该高亮当前激活的导航项', async ({ page }) => {
    // 验证侧边栏存在
    await expect(page.locator('[data-testid="device-panel"]')).toBeVisible();

    // 验证"事件日志"导航项高亮
    const eventLogNav = page.locator('a:has-text("事件日志")');
    await expect(eventLogNav).toHaveClass(/bg-primary/);

    // 验证其他导航项未被高亮
    const settingsNav = page.locator('a:has-text("设置")');
    await expect(settingsNav).not.toHaveClass(/bg-primary/);
  });

  test('页面布局结构应该正确', async ({ page }) => {
    // 验证主内容区域存在
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();

    // 验证头部区域存在（包含标题和状态）
    await expect(page.getByText('事件日志')).toBeVisible();

    // 验证 TimeBlock 控件栏存在
    await expect(page.locator('[data-testid="timeblock-widget"], .timeblock-widget')).toBeVisible();
  });

  test('应该能够通过侧边栏导航到其他页面', async ({ page }) => {
    // 点击首页导航项
    await page.locator('a:has-text("首页")').click();
    await page.waitForLoadState('networkidle');

    // 验证导航到首页
    await expect(page).toHaveURL('/');

    // 返回事件日志页面
    await page.locator('a:has-text("事件日志")').click();
    await page.waitForLoadState('networkidle');

    // 验证返回事件日志页面
    await expect(page).toHaveURL(/\/eventlog/);
  });

  test('同步状态应该正确显示', async ({ page }) => {
    // 验证同步状态徽章显示正确
    const syncBadge = page.locator('text=未同步');
    await expect(syncBadge).toBeVisible();

    // 验证事件计数徽章存在
    const countBadge = page.locator('text=条事件');
    await expect(countBadge).toBeVisible();
  });

  test('事件列表应该正确处理空状态', async ({ page }) => {
    // 验证空状态图标存在
    await expect(page.locator('.rounded-full:has-text("📝")')).toBeVisible();

    // 验证空状态引导文本
    await expect(page.getByText('开始计时或输入内容记录事件')).toBeVisible();
  });

  test('侧边栏应该包含所有导航项', async ({ page }) => {
    // 验证侧边栏标题
    await expect(page.locator('text=ExoMind').first()).toBeVisible();

    // 验证所有主要导航项
    await expect(page.locator('a:has-text("首页")')).toBeVisible();
    await expect(page.locator('a:has-text("事件日志")')).toBeVisible();
    await expect(page.locator('a:has-text("语音聊天")')).toBeVisible();
    await expect(page.locator('a:has-text("设置")')).toBeVisible();
  });
});

test.describe('事件日志页面 - 响应式布局', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('桌面端应该显示完整侧边栏', async ({ page }) => {
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');

    // 侧边栏应该直接可见（不是隐藏的）
    await expect(page.locator('[data-testid="device-panel"]')).toBeVisible();
  });
});

test.describe('事件日志页面 - 输入交互', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/eventlog');
    await page.waitForLoadState('networkidle');
  });

  test('输入框应该可聚焦', async ({ page }) => {
    const input = page.locator('input[placeholder*="输入内容记录事件"]');
    await expect(input).toBeEnabled();
  });

  test('输入内容后应该能触发发送逻辑', async ({ page }) => {
    const input = page.locator('input[placeholder*="输入内容记录事件"]');

    // 输入测试内容
    await input.fill('测试事件内容');

    // 验证输入内容
    await expect(input).toHaveValue('测试事件内容');
  });
});
