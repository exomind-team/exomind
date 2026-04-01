import { test, expect } from '@playwright/test';

test.describe('SyncTestPage 静态测试（RT-only）', () => {
  test('SyncTestPage 组件文件应该存在并导出', async () => {
    const { existsSync } = await import('fs');
    const path = await import('path');
    const filePath = path.resolve('./src/ui/pages/SyncTestPage.tsx');
    expect(existsSync(filePath)).toBe(true);

    const { SyncTestPage } = await import('@/ui/pages/SyncTestPage');
    expect(SyncTestPage).toBeDefined();
    expect(typeof SyncTestPage).toBe('function');
  });

  test('路由应该继续保留 /sync-test 兼容入口', async () => {
    const fs = await import('fs');
    const routesContent = fs.readFileSync('./src/routes.tsx', 'utf-8');
    expect(routesContent).toContain("path: '/sync-test'");
    expect(routesContent).toContain('SyncTestPage');
  });

  test('页面文案应该切到 RT-only，同步旧 Pouch 入口应被移除', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
    expect(content).toContain('RT 同步状态');
    expect(content).toContain('旧的 Pouch 同步测试入口已下线');
    expect(content).not.toContain('连接服务器');
    expect(content).not.toContain('同步配置');
  });
});
