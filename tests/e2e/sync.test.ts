/**
 * SyncTestPage E2E 测试
 *
 * 测试同步测试页面的功能：
 * 1. 组件文件存在性和正确性
 * 2. 路由注册正确
 * 3. 依赖组件导入
 * 4. UI 元素验证
 * 5. 功能定义验证
 * 6. 侧边栏导航配置
 */

import { test, expect } from '@playwright/test';

test.describe('SyncTestPage 静态测试', () => {
  test.describe('SyncTestPage 组件文件测试', () => {
    test('SyncTestPage.tsx 文件应该存在', async () => {
      const { existsSync } = await import('fs');
      const path = await import('path');
      const filePath = path.resolve('./src/ui/pages/SyncTestPage.tsx');
      expect(existsSync(filePath)).toBe(true);
    });

    test('SyncTestPage 组件应该导出', async () => {
      const { SyncTestPage } = await import('@/ui/pages/SyncTestPage');
      expect(SyncTestPage).toBeDefined();
      expect(typeof SyncTestPage).toBe('function');
    });
  });

  test.describe('SyncTestPage 路由注册测试', () => {
    test('路由应该导入 SyncTestPage', async () => {
      const fs = await import('fs');
      const routesContent = fs.readFileSync('./src/routes-new.tsx', 'utf-8');
      expect(routesContent).toContain('SyncTestPage');
    });

    test('路由应该定义 /sync-test 路径', async () => {
      const fs = await import('fs');
      const routesContent = fs.readFileSync('./src/routes-new.tsx', 'utf-8');
      expect(routesContent).toContain("path: '/sync-test'");
    });

    test('路由应该使用 SyncTestPage 组件', async () => {
      const fs = await import('fs');
      const routesContent = fs.readFileSync('./src/routes-new.tsx', 'utf-8');
      expect(routesContent).toContain('<SyncTestPage />');
    });
  });

  test.describe('SyncTestPage 依赖组件测试', () => {
    test('应该导入 Card 组件', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("from '@/components/ui/card'");
    });

    test('应该导入 Button 组件', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("from '@/components/ui/button'");
    });

    test('应该导入 Input 组件', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("from '@/components/ui/input'");
    });

    test('应该导入 Label 组件', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("from '@/components/ui/label'");
    });

    test('应该导入 Badge 组件', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("from '@/components/ui/badge'");
    });

    test('应该导入 useSyncStore', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("from '@/ui/stores/sync-store'");
    });

    test('应该导入 Conflict 类型', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain("type { Conflict }");
      expect(content).toContain("from '@/environment/interfaces/sync.port'");
    });
  });

  test.describe('SyncTestPage UI 元素测试', () => {
    test('应该包含同步测试标题', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('同步测试');
    });

    test('应该包含连接设置标题', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('连接设置');
    });

    test('应该包含同步控制标题', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('同步控制');
    });

    test('应该包含冲突列表标题', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('冲突列表');
    });

    test('应该包含导入导出标题', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('导入导出');
    });

    test('应该包含测试日志标题', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('测试日志');
    });

    test('应该包含服务器地址输入框', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('serverUrl');
      expect(content).toContain('id="serverUrl"');
    });

    test('应该包含用户名输入框', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('username');
      expect(content).toContain('id="username"');
    });

    test('应该包含密码输入框', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('password');
      expect(content).toContain('id="password"');
      expect(content).toContain('type="password"');
    });

    test('应该包含登录按钮', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('登录');
    });

    test('应该包含退出登录按钮', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('退出登录');
    });

    test('应该包含连接服务器按钮', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('连接服务器');
    });

    test('应该包含断开按钮', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('断开');
    });

    test('应该包含同步事件按钮', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('同步事件');
    });

    test('应该包含同步配置按钮', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('同步配置');
    });
  });

  test.describe('SyncTestPage 功能测试', () => {
    test('应该使用 useSyncStore', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('useSyncStore()');
    });

    test('应该定义 handleLogin 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleLogin');
    });

    test('应该定义 handleConnect 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleConnect');
    });

    test('应该定义 handleDisconnect 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleDisconnect');
    });

    test('应该定义 handleSyncEvents 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleSyncEvents');
    });

    test('应该定义 handleSyncConfig 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleSyncConfig');
    });

    test('应该定义 handleLogout 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleLogout');
    });

    test('应该定义 handleResolveConflict 函数', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('handleResolveConflict');
    });

    test('应该使用 useState 管理日志状态', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('useState<LogEntry[]>([])');
    });

    test('应该使用 useRef 管理日志引用', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      expect(content).toContain('logsRef');
      expect(content).toContain('useRef<HTMLDivElement>');
    });
  });

  test.describe('SyncTestPage 侧边栏导航测试', () => {
    test('侧边栏不应该包含同步测试导航项（仅保留兼容路由）', async () => {
      const fs = await import('fs');
      const routesContent = fs.readFileSync('./src/routes-new.tsx', 'utf-8');
      expect(routesContent).not.toContain('同步测试');
    });

    test('同步测试不应该出现在底部导航项中', async () => {
      const fs = await import('fs');
      const routesContent = fs.readFileSync('./src/routes-new.tsx', 'utf-8');
      expect(routesContent).not.toContain("title: '同步测试'");
    });

    test('同步测试路径应该为 /sync-test', async () => {
      const fs = await import('fs');
      const routesContent = fs.readFileSync('./src/routes-new.tsx', 'utf-8');
      expect(routesContent).toContain("path: '/sync-test'");
    });
  });

  test.describe('SyncTestPage 集成测试', () => {
    test('应该能导入 SyncTestPage 及其所有依赖', async () => {
      const { SyncTestPage } = await import('@/ui/pages/SyncTestPage');
      const { useSyncStore } = await import('@/ui/stores/sync-store');
      expect(SyncTestPage).toBeDefined();
      expect(useSyncStore).toBeDefined();
    });

    test('组件应该使用正确的导入路径', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('./src/ui/pages/SyncTestPage.tsx', 'utf-8');
      // 验证路径别名使用
      expect(content).toContain("from '@/");
    });
  });
});
