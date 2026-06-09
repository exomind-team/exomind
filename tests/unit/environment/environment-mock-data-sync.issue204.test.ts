import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('environment mock-data sync issue-204（环境应在运行中同步 mock 开关）', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it('refreshes task/agent adapters after mock flag toggles（切换后刷新 task/agent 适配器）', async () => {
    window.localStorage.setItem('exomind:useMockData', 'false');

    const { ExoMindEnvironment } = await import('@/lib/environment/environment');

    ExoMindEnvironment.resetForTests();
    const environmentBeforeToggle = ExoMindEnvironment.getInstance();
    expect(environmentBeforeToggle.agent.constructor.name).toBe('AgentWebAdapter');
    expect(environmentBeforeToggle.task.constructor.name).toBe('TaskRtAdapter');

    window.localStorage.setItem('exomind:useMockData', 'true');

    const environmentAfterToggle = ExoMindEnvironment.getInstance();
    expect(environmentAfterToggle.agent.constructor.name).toBe('AgentMockAdapter');
    expect(environmentAfterToggle.task.constructor.name).toBe('TaskMockAdapter');
  });
});
