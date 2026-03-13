import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('dev instance diagnostics（开发态实例诊断）', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as typeof globalThis & {
      __EXOMIND_DEV_INSTANCE_META__?: unknown;
    }).__EXOMIND_DEV_INSTANCE_META__ = {
      branch: 'feature/issue-514-instance-diagnostics',
      worktreeName: 'issue-514-instance-diagnostics',
      webPort: 5173,
      hmrPort: 5174,
      rtPort: 6984,
      mcpPort: 9223,
      syncServerUrl: 'http://localhost:6984',
      asrServerUrl: 'http://localhost:1949',
      envStatus: {
        VITE_MOSS_API_KEY: { sensitive: true, configured: false },
        VITE_VOLCANO_APP_KEY: { sensitive: true, configured: true },
        EXOMIND_RT_SECRET: { sensitive: true, configured: true },
        VITE_SYNC_SERVER_URL: { sensitive: false, configured: true, value: 'http://localhost:6984' },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & {
      __EXOMIND_DEV_INSTANCE_META__?: unknown;
    }).__EXOMIND_DEV_INSTANCE_META__;
  });

  it('formats a concise dev window title（生成简短开发态窗口标题）', async () => {
    const module = await import('@/config/dev-instance-diagnostics');

    expect(module.formatDevInstanceWindowTitle()).toBe(
      'ExoMind [feature/issue-514-instance-diagnostics] [Web:5173 RT:6984]',
    );
  });

  it('builds a diagnostics snapshot with env status（生成包含环境变量状态的诊断快照）', async () => {
    const module = await import('@/config/dev-instance-diagnostics');

    expect(module.getDevInstanceDiagnosticsSnapshot()).toEqual(expect.objectContaining({
      branch: 'feature/issue-514-instance-diagnostics',
      worktreeName: 'issue-514-instance-diagnostics',
      webPort: 5173,
      rtPort: 6984,
      mcpPort: 9223,
      envStatus: expect.objectContaining({
        VITE_VOLCANO_APP_KEY: expect.objectContaining({ configured: true, sensitive: true }),
        EXOMIND_RT_SECRET: expect.objectContaining({ configured: true, sensitive: true }),
      }),
    }));
  });
});
