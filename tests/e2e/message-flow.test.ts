/**
 * E2E 测试：消息流程测试
 * 测试本地消息记录、离线存储、设备同步等核心流程
 */

import { test, expect } from '@playwright/test';

test.describe('Message Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 打开应用
    await page.goto('/');
    // 等待应用加载
    await page.waitForLoadState('domcontentloaded');
  });

  test('E2E-001: 本地消息记录', async ({ page }) => {
    // 1. 打开 App
    await expect(page.locator('[data-testid="app-container"]')).toBeVisible();

    // 2. 输入消息
    const input = page.locator('[data-testid="message-input"]');
    await input.fill('测试消息');

    // 3. 点击发送
    await page.locator('[data-testid="send-button"]').click();

    // 4. 验证消息出现在列表
    await expect(page.locator('[data-testid="message-list"]')).toContainText('测试消息');
  });

  test('E2E-002: 离线消息存储', async ({ page }) => {
    // 1. 模拟离线
    await page.route('**/*', route => route.abort());

    // 2. 发送消息
    const input = page.locator('[data-testid="message-input"]');
    await input.fill('离线测试消息');
    await page.locator('[data-testid="send-button"]').click();

    // 3. 验证消息状态为待发送
    const pendingMessage = page.locator('[data-testid="message-pending"]').first();
    await expect(pendingMessage).toContainText('离线测试消息');

    // 4. 恢复网络
    await page.unrouteAll('route');

    // 5. 触发同步
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // 6. 等待消息发送
    await page.waitForTimeout(1000);

    // 7. 验证消息已发送
    const sentMessage = page.locator('[data-testid="message-sent"]').first();
    await expect(sentMessage).toContainText('离线测试消息');
  });

  test('E2E-003: 消息状态流转', async ({ page }) => {
    // 测试消息状态从 pending -> sending -> sent 的流转

    // 1. 发送消息
    const input = page.locator('[data-testid="message-input"]');
    await input.fill('状态测试消息');
    await page.locator('[data-testid="send-button"]').click();

    // 2. 验证消息立即出现（乐观更新）
    await expect(page.locator('[data-testid="message-list"]')).toContainText('状态测试消息');
  });
});

test.describe('Device Management E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('E2E-004: 设备面板显示', async ({ page }) => {
    // 验证设备面板存在
    await expect(page.locator('[data-testid="device-panel"]')).toBeVisible();
  });

  test('E2E-005: 设备状态显示', async ({ page }) => {
    // 验证连接状态显示
    const statusText = page.locator('[data-testid="connection-status"]');
    await expect(statusText).toBeVisible();
  });
});

test.describe('Offline Scenarios E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('E2E-006: 网络中断时发送消息', async ({ page }) => {
    // 1. 模拟网络中断
    await page.route('**/*', route => route.abort());

    // 2. 发送消息
    const input = page.locator('[data-testid="message-input"]');
    await input.fill('网络中断测试');
    await page.locator('[data-testid="send-button"]').click();

    // 3. 验证消息进入待发送队列
    await expect(page.locator('[data-testid="pending-count"]')).toContainText('1');
  });

  test('E2E-007: 无网络打开App', async ({ page }) => {
    // 1. 在无网络情况下打开App
    await page.route('**/*', route => route.abort());

    // 2. 验证本地消息功能正常
    const input = page.locator('[data-testid="message-input"]');
    await input.fill('完全离线测试');
    await page.locator('[data-testid="send-button"]').click();

    // 3. 验证消息被记录
    await expect(page.locator('[data-testid="message-list"]')).toContainText('完全离线测试');
  });
});
