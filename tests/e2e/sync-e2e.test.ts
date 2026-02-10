/**
 * E2E 多设备同步测试
 *
 * 测试场景：
 * 1. 用户 A 登录并创建事件
 * 2. 用户 B 登录并同步获取事件
 * 3. 验证双向同步
 * 4. 冲突场景测试
 */

import { test, expect } from '@playwright/test';

const SERVER_URL = process.env.SYNC_SERVER_URL || 'http://localhost:6984';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('多设备同步 E2E', () => {
  test.beforeAll(async () => {
    // 检查服务器是否可访问
    // 注意：实际测试时需要确保服务器已启动
  });

  test('用户 A 创建事件，用户 B 同步获取', async ({ browser }) => {
    // 创建两个浏览器上下文（模拟两个设备）
    const contextA = await browser.newContext({
      storageState: undefined, // 不使用预存的 state
    });
    const contextB = await browser.newContext({
      storageState: undefined,
    });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 设备 A 登录
    await test.step('设备 A 登录', async () => {
      await pageA.goto(`${APP_URL}/sync-test`);
      // 等待页面加载
      await pageA.waitForLoadState('networkidle');

      // 检查是否需要登录（根据实际页面逻辑调整）
      const loginButton = pageA.locator('button:has-text("登录")');
      if (await loginButton.isVisible()) {
        await pageA.fill('#username', 'test-user-a');
        await pageA.fill('#password', 'password-a');
        await loginButton.click();
        await pageA.waitForURL(/\/chat|sync-test/);
      }
    });

    // 设备 B 登录
    await test.step('设备 B 登录', async () => {
      await pageB.goto(`${APP_URL}/sync-test`);
      await pageB.waitForLoadState('networkidle');

      const loginButton = pageB.locator('button:has-text("登录")');
      if (await loginButton.isVisible()) {
        await pageB.fill('#username', 'test-user-b');
        await pageB.fill('#password', 'password-b');
        await loginButton.click();
        await pageB.waitForURL(/\/chat|sync-test/);
      }
    });

    // 连接设备 A 到同步服务器
    await test.step('设备 A 连接到同步服务器', async () => {
      await pageA.fill('#serverUrl', SERVER_URL);
      await pageA.fill('#username', 'test-user-a');
      await pageA.fill('#password', 'password-a');
      await pageA.click('button:has-text("连接服务器")');

      // 等待连接成功
      await pageA.waitForFunction(() => {
        const status = document.querySelector('[data-testid="sync-status"]');
        return status?.textContent?.includes('connected');
      }, { timeout: 10000 });
    });

    // 连接设备 B 到同步服务器
    await test.step('设备 B 连接到同步服务器', async () => {
      await pageB.fill('#serverUrl', SERVER_URL);
      await pageB.fill('#username', 'test-user-b');
      await pageB.fill('#password', 'password-b');
      await pageB.click('button:has-text("连接服务器")');

      await pageB.waitForFunction(() => {
        const status = document.querySelector('[data-testid="sync-status"]');
        return status?.textContent?.includes('connected');
      }, { timeout: 10000 });
    });

    // 设备 A 创建测试事件
    await test.step('设备 A 创建事件', async () => {
      await pageA.fill('[data-testid="event-content"]', 'Hello from device A - ' + Date.now());
      await pageA.click('button:has-text("发送")');
      await pageA.waitForTimeout(1000);
    });

    // 等待同步
    await test.step('等待同步完成', async () => {
      await pageA.waitForTimeout(2000);
      await pageB.waitForTimeout(2000);
    });

    // 验证设备 B 收到同步的事件
    await test.step('验证设备 B 收到事件', async () => {
      await pageB.waitForSelector('[data-testid="message-list"]:has-text("Hello from device A")', {
        timeout: 5000
      });
    });

    // 清理
    await contextA.close();
    await contextB.close();
  });

  test('实时同步测试 - 设备 A 发送，设备 B 实时接收', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 两台设备都连接到同步服务器
    await test.step('两台设备连接到服务器', async () => {
      // 设备 A
      await pageA.goto(`${APP_URL}/sync-test`);
      await pageA.waitForLoadState('networkidle');
      await pageA.fill('#serverUrl', SERVER_URL);
      await pageA.fill('#username', 'realtime-test-user');
      await pageA.fill('#password', 'password');
      await pageA.click('button:has-text("连接服务器")');

      // 设备 B
      await pageB.goto(`${APP_URL}/sync-test`);
      await pageB.waitForLoadState('networkidle');
      await pageB.fill('#serverUrl', SERVER_URL);
      await pageB.fill('#username', 'realtime-test-user');
      await pageB.fill('#password', 'password');
      await pageB.click('button:has-text("连接服务器")');

      // 等待两台设备都连接成功
      await Promise.all([
        pageA.waitForFunction(() => {
          const status = document.querySelector('[data-testid="sync-status"]');
          return status?.textContent?.includes('connected');
        }, { timeout: 10000 }),
        pageB.waitForFunction(() => {
          const status = document.querySelector('[data-testid="sync-status"]');
          return status?.textContent?.includes('connected');
        }, { timeout: 10000 })
      ]);
    });

    // 设备 A 发送消息
    const message = `实时消息 ${Date.now()}`;
    await test.step('设备 A 发送实时消息', async () => {
      await pageA.fill('[data-testid="message-input"]', message);
      await pageA.click('[data-testid="send-button"]');
    });

    // 设备 B 应该实时收到消息
    await test.step('设备 B 实时接收消息', async () => {
      // 使用 waitForSelector 的 timeout 来验证实时同步
      await expect.poll(() => {
        return pageB.locator('[data-testid="message-list"]').textContent();
      }).toContain(message);
    });

    await contextA.close();
    await contextB.close();
  });

  test('冲突场景测试 - 同时编辑同一事件', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 两台设备使用相同用户登录
    await test.step('两台设备使用相同账户登录', async () => {
      await pageA.goto(`${APP_URL}/sync-test`);
      await pageA.waitForLoadState('networkidle');
      await pageA.fill('#serverUrl', SERVER_URL);
      await pageA.fill('#username', 'conflict-test-user');
      await pageA.fill('#password', 'password');
      await pageA.click('button:has-text("连接服务器")');

      await pageB.goto(`${APP_URL}/sync-test`);
      await pageB.waitForLoadState('networkidle');
      await pageB.fill('#serverUrl', SERVER_URL);
      await pageB.fill('#username', 'conflict-test-user');
      await pageB.fill('#password', 'password');
      await pageB.click('button:has-text("连接服务器")');

      await Promise.all([
        pageA.waitForFunction(() => {
          const status = document.querySelector('[data-testid="sync-status"]');
          return status?.textContent?.includes('connected');
        }, { timeout: 10000 }),
        pageB.waitForFunction(() => {
          const status = document.querySelector('[data-testid="sync-status"]');
          return status?.textContent?.includes('connected');
        }, { timeout: 10000 })
      ]);
    });

    // 创建初始事件
    const eventId = `conflict-event-${Date.now()}`;
    await test.step('创建初始事件', async () => {
      await pageA.fill('[data-testid="event-content"]', eventId);
      await pageA.click('button:has-text("发送")');
      await pageA.waitForTimeout(2000);
    });

    // 等待页面B同步到该事件
    await pageB.waitForTimeout(2000);

    // 模拟冲突：两台设备几乎同时修改同一事件
    await test.step('触发冲突场景', async () => {
      // 设备 A 修改事件
      await pageA.fill('[data-testid="event-content"]', eventId + ' - modified by A');
      await pageA.click('button:has-text("发送")');

      // 设备 B 修改同一事件
      await pageB.fill('[data-testid="event-content"]', eventId + ' - modified by B');
      await pageB.click('button:has-text("发送")');

      // 等待同步
      await pageA.waitForTimeout(3000);
      await pageB.waitForTimeout(3000);
    });

    // 验证冲突检测
    await test.step('验证冲突检测', async () => {
      // 检查冲突列表是否显示冲突
      const conflictList = pageB.locator('[data-testid="conflict-list"]');
      await expect.poll(() => {
        return conflictList.isVisible();
      }).toBeTruthy();
    });

    await contextA.close();
    await contextB.close();
  });

  test.afterEach(async ({ browser }) => {
    // 清理所有浏览器上下文
    for (const context of browser.contexts()) {
      await context.close();
    }
  });
});
