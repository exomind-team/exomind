import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(async () => false),
}));

import '../components/settings/setup-settings-mocks.tsx';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
  getRuntimeConfigValueSync,
} from '@/config/runtime-config-cache';
import { SETTINGS_REGISTRY } from '@/ui/app/config/settings/settings-registry';

function getActionItem(id: 'clear-local-cache' | 'reset-all-settings') {
  const item = SETTINGS_REGISTRY.find((entry) => entry.id === id);
  expect(item?.type).toBe('action');
  expect(item?.onAction).toBeTypeOf('function');
  return item as Extract<(typeof SETTINGS_REGISTRY)[number], { id: typeof id; type: 'action' }>;
}

describe('settings reset actions（设置重置动作）', () => {
  beforeEach(() => {
    __resetRuntimeConfigCacheForTests();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(window, 'setTimeout').mockImplementation(() => 0 as ReturnType<typeof setTimeout>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clear-local-cache only clears UI cache, and preserves business data + secrets', () => {
    __primeRuntimeConfigForTests({
      'exomind:dag-mode': 'connect',
      moss_api_key: 'sk-cache-secret',
    });
    window.localStorage.setItem(
      'exomind:goal-graph',
      JSON.stringify({ me: { id: 'me', name: 'Me' }, goals: [{ id: 'goal-1' }], edges: [] }),
    );
    window.sessionStorage.setItem('exomind:last-tasks-path', '/tasks/dag');

    const action = getActionItem('clear-local-cache');
    const message = action.onAction?.();

    expect(message).toContain('已清空本地缓存');
    expect(getRuntimeConfigValueSync('exomind:dag-mode')).toBeNull();
    expect(window.sessionStorage.getItem('exomind:last-tasks-path')).toBeNull();
    expect(window.localStorage.getItem('exomind:goal-graph')).not.toBeNull();
    expect(getRuntimeConfigValueSync('moss_api_key')).toBe('sk-cache-secret');
  });

  it('reset-all-settings clears settings, but preserves business data', () => {
    __primeRuntimeConfigForTests({
      'exomind:themePreference': 'dark',
      moss_api_key: 'sk-reset-secret',
      'exomind-update-settings': JSON.stringify({
        state: {
          channel: 'preview',
          checkInterval: 'hourly',
          autoDownloadPreview: true,
          lastCheckTime: 123,
        },
        version: 0,
      }),
    });
    window.localStorage.setItem(
      'exomind:goal-graph',
      JSON.stringify({ me: { id: 'me', name: 'Me' }, goals: [{ id: 'goal-1' }], edges: [] }),
    );
    window.localStorage.setItem('exomind:agent-provider-profiles:index', JSON.stringify(['openai-main']));
    window.localStorage.setItem('exomind:llmApiKey', 'sk-legacy-llm');
    window.sessionStorage.setItem('exomind:last-eventlog-tab', 'today');

    const action = getActionItem('reset-all-settings');
    const message = action.onAction?.();

    expect(message).toContain('已重置所有设置');
    expect(getRuntimeConfigValueSync('exomind:themePreference')).toBeNull();
    expect(getRuntimeConfigValueSync('moss_api_key')).toBeNull();
    expect(getRuntimeConfigValueSync('exomind-update-settings')).toBeNull();
    expect(window.localStorage.getItem('exomind:agent-provider-profiles:index')).toBeNull();
    expect(window.localStorage.getItem('exomind:llmApiKey')).toBeNull();
    expect(window.sessionStorage.getItem('exomind:last-eventlog-tab')).toBeNull();
    expect(window.localStorage.getItem('exomind:goal-graph')).not.toBeNull();
  });

  it('reset-all-settings also removes prefix runtime secrets that only exist in SQLite snapshot（重置设置也会清掉仅存在于 Runtime 快照中的前缀 secret）', () => {
    __primeRuntimeConfigForTests({
      'exomind:themePreference': 'dark',
      'exomind:ai-registry:energy-secret:openai-main': 'sk-runtime-only',
    });
    expect(window.localStorage.getItem('exomind:ai-registry:energy-secret:openai-main')).toBeNull();

    const action = getActionItem('reset-all-settings');
    action.onAction?.();

    expect(getRuntimeConfigValueSync('exomind:ai-registry:energy-secret:openai-main')).toBeNull();
  });
});
