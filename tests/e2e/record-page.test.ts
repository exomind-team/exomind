/**
 * E2E 测试：记录页面测试
 * 测试 RecordPage 的核心功能：普通记录、时间块、历史面板等
 */

import { test, expect } from '@playwright/test';

test.describe('Record Page E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 打开记录页面
    await page.goto('/test/record');
    await page.waitForLoadState('domcontentloaded');
  });

  test('E2E-REC-001: 打开记录页面', async ({ page }) => {
    // 验证记录页面加载
    await expect(page.locator('[data-testid="record-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="record-title"]')).toHaveText('记录');
    await expect(page.locator('[data-testid="record-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="record-send-button"]')).toBeVisible();
  });

  test('E2E-REC-002: 发送普通记录', async ({ page }) => {
    const testMessage = `普通记录测试 ${Date.now()}`;

    // 输入消息
    const input = page.locator('[data-testid="record-input"]');
    await input.fill(testMessage);

    // 点击发送
    await page.locator('[data-testid="record-send-button"]').click();

    // 验证消息出现在列表
    await expect(page.locator('[data-testid="event-list"]')).toContainText(testMessage);

    // 验证输入框已清空
    await expect(input).toHaveValue('');
  });

  test('E2E-REC-003: 使用开始/结束命令', async ({ page }) => {
    const blockName = `测试时间块 ${Date.now()}`;

    // 开始时间块
    await page.locator('[data-testid="record-input"]').fill(`开始${blockName}`);
    await page.locator('[data-testid="record-send-button"]').click();

    // 验证活跃状态显示
    await expect(page.locator('[data-testid="record-status"]')).toContainText('记录中');
    await expect(page.locator('[data-testid="record-status"]')).toContainText(blockName);

    // 验证开始标记出现在列表
    await expect(page.locator('[data-testid="event-list"]')).toContainText(blockName);
    await expect(page.locator('[data-testid="event-list"]')).toContainText('🔷');

    // 结束时间块
    await page.locator('[data-testid="record-input"]').fill('结束');
    await page.locator('[data-testid="record-send-button"]').click();

    // 验证结束标记
    await expect(page.locator('[data-testid="event-list"]')).toContainText('🔴');
  });

  test('E2E-REC-004: 添加带标签的记录', async ({ page }) => {
    const testTag = `标签${Date.now()}`;
    const testMessage = `带标签的记录`;

    // 输入带标签的消息
    await page.locator('[data-testid="record-input"]').fill(`${testMessage} #${testTag}`);
    await page.locator('[data-testid="record-send-button"]').click();

    // 验证消息和标签都出现
    await expect(page.locator('[data-testid="event-list"]')).toContainText(testMessage);
    await expect(page.locator('[data-testid="event-list"]')).toContainText(`#${testTag}`);
  });

  test('E2E-REC-005: 查看活跃状态', async ({ page }) => {
    const blockName = `活跃测试 ${Date.now()}`;

    // 初始状态：显示"随时记录"
    await expect(page.locator('[data-testid="record-status"]')).toContainText('随时记录');

    // 开始时间块
    await page.locator('[data-testid="record-input"]').fill(`开始${blockName}`);
    await page.locator('[data-testid="record-send-button"]').click();

    // 验证状态变为"记录中"
    await expect(page.locator('[data-testid="record-status"]')).toContainText('记录中');
    await expect(page.locator('[data-testid="record-status"]')).toContainText(blockName);

    // 输入框提示更新
    await expect(page.locator('[data-testid="record-input"]')).toHaveAttribute(
      'placeholder',
      `记录中: ${blockName}...`
    );
  });

  test('E2E-REC-006: 打开历史面板', async ({ page }) => {
    // 初始状态：历史面板不应可见
    await expect(page.locator('[data-testid="history-panel"]')).not.toBeVisible();

    // 点击历史按钮
    await page.locator('[data-testid="history-toggle"]').click();

    // 验证历史面板显示
    await expect(page.locator('[data-testid="history-panel"]')).toBeVisible();

    // 再次点击隐藏
    await page.locator('[data-testid="history-toggle"]').click();
    await expect(page.locator('[data-testid="history-panel"]')).not.toBeVisible();
  });
});

test.describe('Record Page - Time Block Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/record');
    await page.waitForLoadState('domcontentloaded');
  });

  test('E2E-REC-007: 时间块完整流程', async ({ page }) => {
    const blockName = `完整流程测试 ${Date.now()}`;

    // 1. 开始时间块
    await page.locator('[data-testid="record-input"]').fill(`开始${blockName}`);
    await page.locator('[data-testid="record-send-button"]').click();
    await expect(page.locator('[data-testid="record-status"]')).toContainText(blockName);

    // 2. 在时间块中添加记录
    const note1 = '时间块内的第一条记录';
    await page.locator('[data-testid="record-input"]').fill(note1);
    await page.locator('[data-testid="record-send-button"]').click();
    await expect(page.locator('[data-testid="event-list"]')).toContainText(note1);

    // 3. 添加更多记录
    const note2 = '时间块内的第二条记录';
    await page.locator('[data-testid="record-input"]').fill(note2);
    await page.locator('[data-testid="record-send-button"]').click();
    await expect(page.locator('[data-testid="event-list"]')).toContainText(note2);

    // 4. 结束时间块
    await page.locator('[data-testid="record-input"]').fill('结束');
    await page.locator('[data-testid="record-send-button"]').click();

    // 5. 打开历史面板查看
    await page.locator('[data-testid="history-toggle"]').click();
    await expect(page.locator('[data-testid="history-panel"]')).toBeVisible();

    // 验证历史面板中有该时间块
    const historyBlock = page.locator('[data-testid^="history-block-"]').first();
    await expect(historyBlock).toBeVisible();
    await expect(historyBlock).toContainText(blockName);
  });
});
