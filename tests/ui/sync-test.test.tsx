/**
 * SyncTestPage 静态分析测试
 *
 * 测试同步测试页面的静态导入和组件结构
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SyncTestPage 文件结构', () => {
  const syncTestPagePath = path.resolve('src/ui/pages/SyncTestPage.tsx');

  it('应该存在 SyncTestPage.tsx 文件', () => {
    expect(fs.existsSync(syncTestPagePath)).toBe(true);
  });

  it('应该导出 SyncTestPage 组件', async () => {
    const { SyncTestPage } = await import('@/ui/pages/SyncTestPage');
    expect(SyncTestPage).toBeDefined();
    expect(typeof SyncTestPage).toBe('function');
  });
});

describe('SyncTestPage 依赖检查', () => {
  const syncTestPagePath = path.resolve('src/ui/pages/SyncTestPage.tsx');
  const content = fs.readFileSync(syncTestPagePath, 'utf-8');

  it('应该导入 Card 组件', () => {
    expect(content).toContain("from '@/components/ui/card'");
  });

  it('应该导入 Button 组件', () => {
    expect(content).toContain("from '@/components/ui/button'");
  });

  it('应该导入 Input 组件', () => {
    expect(content).toContain("from '@/components/ui/input'");
  });

  it('应该导入 Badge 组件', () => {
    expect(content).toContain("from '@/components/ui/badge'");
  });

  it('应该导入 useSyncStore', () => {
    expect(content).toContain("from '@/ui/stores/sync-store'");
  });
});

describe('SyncTestPage 路由注册', () => {
  const routesPath = path.resolve('src/routes-new.tsx');
  const routesContent = fs.readFileSync(routesPath, 'utf-8');

  it('不应该在侧边栏显示同步测试入口', () => {
    expect(routesContent).not.toContain('同步测试');
  });

  it('应该注册 /sync-test 路由（兼容旧入口）', () => {
    expect(routesContent).toContain("path: '/sync-test'");
  });
});

describe('SyncTestPage 功能完整性', () => {
  const syncTestPagePath = path.resolve('src/ui/pages/SyncTestPage.tsx');
  const content = fs.readFileSync(syncTestPagePath, 'utf-8');

  it('应该包含连接设置 UI', () => {
    expect(content).toContain('连接设置');
  });

  it('应该包含服务器地址持久化控制', () => {
    expect(content).toContain('保存为默认地址');
    expect(content).toContain('恢复自动地址');
  });

  it('应该包含同步控制 UI', () => {
    expect(content).toContain('同步控制');
  });

  it('应该包含冲突列表 UI', () => {
    expect(content).toContain('冲突列表');
  });

  it('应该包含导入导出 UI', () => {
    expect(content).toContain('导入导出');
  });

  it('应该包含测试日志 UI', () => {
    expect(content).toContain('测试日志');
  });

  it('应该使用 useSyncStore hooks', () => {
    expect(content).toContain('useSyncStore()');
  });
});

describe('SyncTestPage 事件处理器', () => {
  const syncTestPagePath = path.resolve('src/ui/pages/SyncTestPage.tsx');
  const content = fs.readFileSync(syncTestPagePath, 'utf-8');

  it('应该定义 handleLogin 函数', () => {
    expect(content).toContain('handleLogin');
  });

  it('应该定义 handleConnect 函数', () => {
    expect(content).toContain('handleConnect');
  });

  it('应该定义 handleDisconnect 函数', () => {
    expect(content).toContain('handleDisconnect');
  });

  it('应该定义 handleSyncEvents 函数', () => {
    expect(content).toContain('handleSyncEvents');
  });

  it('应该定义 handleSyncConfig 函数', () => {
    expect(content).toContain('handleSyncConfig');
  });

  it('应该定义 handleSaveServerUrl 函数', () => {
    expect(content).toContain('handleSaveServerUrl');
  });

  it('应该定义 handleResetServerUrl 函数', () => {
    expect(content).toContain('handleResetServerUrl');
  });
});

describe('SyncTestPage 状态管理', () => {
  const syncTestPagePath = path.resolve('src/ui/pages/SyncTestPage.tsx');
  const content = fs.readFileSync(syncTestPagePath, 'utf-8');

  it('应该使用 useState 管理日志状态', () => {
    expect(content).toContain('useState<LogEntry[]>([])');
  });

  it('应该使用 useRef 管理日志容器引用', () => {
    expect(content).toContain('logsRef');
  });

  it('应该使用 useEffect 实现自动滚动', () => {
    expect(content).toContain('useEffect');
    expect(content).toContain('scrollTop');
  });
});
