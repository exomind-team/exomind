/**
 * E2E 测试：消息流程测试
 * 测试本地消息记录、设备管理等核心功能
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

  test('E2E-003: 消息状态流转', async ({ page }) => {
    // 测试消息状态流转

    // 1. 发送消息
    const input = page.locator('[data-testid="message-input"]');
    await input.fill('状态测试消息');
    await page.locator('[data-testid="send-button"]').click();

    // 2. 验证消息立即出现
    await expect(page.locator('[data-testid="message-list"]')).toContainText('状态测试消息');
  });

  test('E2E-006: 消息持久化（刷新后保留）', async ({ page }) => {
    // 测试消息在刷新后仍然保留

    // 1. 发送一条消息
    const testMessage = `持久化测试 ${Date.now()}`;
    const input = page.locator('[data-testid="message-input"]');
    await input.fill(testMessage);
    await page.locator('[data-testid="send-button"]').click();

    // 2. 验证消息出现在列表
    await expect(page.locator('[data-testid="message-list"]')).toContainText(testMessage);

    // 3. 刷新页面
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 4. 验证消息仍然存在
    await expect(page.locator('[data-testid="message-list"]')).toContainText(testMessage);
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
