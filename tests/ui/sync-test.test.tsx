import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SyncTestPage 文件结构', () => {
  const syncTestPagePath = path.resolve('src/ui/pages/SyncTestPage.tsx');
  const content = fs.readFileSync(syncTestPagePath, 'utf-8');

  it('应该存在 SyncTestPage.tsx 文件', () => {
    expect(fs.existsSync(syncTestPagePath)).toBe(true);
  });

  it('应该导出 SyncTestPage 组件', async () => {
    const { SyncTestPage } = await import('@/ui/pages/SyncTestPage');
    expect(SyncTestPage).toBeDefined();
    expect(typeof SyncTestPage).toBe('function');
  });

  it('应该切换为 RT 同步状态说明页，而不是旧 Pouch 控制台', () => {
    expect(content).toContain('RT 同步状态');
    expect(content).toContain('旧的 Pouch 同步测试入口已下线');
    expect(content).not.toContain('连接服务器');
    expect(content).not.toContain('同步配置');
  });

  it('应该保留档案与远端身份展示', () => {
    expect(content).toContain('activeProfileId');
    expect(content).toContain('remoteIdentityKey');
  });

  it('应该引导用户前往设备页、当下页、任务页验收 RT 同步', () => {
    expect(content).toContain('打开设备页');
    expect(content).toContain('打开当下页');
    expect(content).toContain('打开任务页');
  });
});
