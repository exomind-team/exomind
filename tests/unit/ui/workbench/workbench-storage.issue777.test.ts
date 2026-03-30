import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WORKBENCH_PHASE1_STORAGE_KEY,
  applyWorkbenchLegacyIntent,
  readOrCreateWorkbenchFlatState,
  resolveWorkbenchLegacyIntent,
  type WorkbenchFlatState,
} from '@/ui/app/pages/workbench/workbench-storage';

describe('Issue #777 workbench storage（工作台默认空间与最近 pane 恢复）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a default space with mixed panes when storage is empty（空存储时创建默认空间与混合 pane）', () => {
    const state = readOrCreateWorkbenchFlatState();

    expect(state.space.id).toBe('default-space');
    expect(state.space.name).toBe('Agent Workbench');
    expect(state.surface.id).toBe('surface-main');
    expect(state.panes).toHaveLength(2);
    expect(state.panes.some((pane) => pane.bindingType === 'agent-session')).toBe(true);
    expect(state.panes.some((pane) => pane.bindingType === 'ssh-runtime')).toBe(true);
    expect(window.localStorage.getItem(WORKBENCH_PHASE1_STORAGE_KEY)).not.toBeNull();
  });

  it('reuses the persisted recent workbench state（复用最近一次持久化工作台状态）', () => {
    const stored: WorkbenchFlatState = {
      version: 1,
      space: {
        id: 'space-review',
        name: 'Review Space',
        restoredAt: '2026-03-30T12:00:00.000Z',
      },
      surface: {
        id: 'surface-main',
        layoutPreset: 'flat-2up',
      },
      panes: [
        {
          id: 'pane-agent-review',
          title: 'Planner Agent',
          viewKind: 'session-view',
          bindingType: 'agent-session',
          status: 'running',
          description: 'Primary planner session',
        },
        {
          id: 'pane-ssh-review',
          title: 'SSH Runtime',
          viewKind: 'runtime-view',
          bindingType: 'ssh-runtime',
          status: 'attached',
          description: 'Remote shell attachment',
        },
      ],
    };

    window.localStorage.setItem(WORKBENCH_PHASE1_STORAGE_KEY, JSON.stringify(stored));

    const state = readOrCreateWorkbenchFlatState();

    expect(state).toEqual(stored);
  });

  it('falls back to the default state when storage access throws（存储访问异常时回退到默认工作台状态）', () => {
    const originalLocalStorage = window.localStorage;
    const blockedStorage: Storage = {
      get length() {
        return 0;
      },
      clear() {},
      getItem() {
        throw new Error('storage blocked');
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error('storage blocked');
      },
    };

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: blockedStorage,
    });

    const state = readOrCreateWorkbenchFlatState(() => '2026-03-30T20:00:00.000Z');

    expect(state.space.id).toBe('default-space');
    expect(state.space.restoredAt).toBe('2026-03-30T20:00:00.000Z');
    expect(state.surface.id).toBe('surface-main');
    expect(state.panes).toHaveLength(2);
    expect(state.panes.some((pane) => pane.bindingType === 'agent-session')).toBe(true);
    expect(state.panes.some((pane) => pane.bindingType === 'ssh-runtime')).toBe(true);

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('resolves legacy chat route intent and focuses the agent pane（解析旧聊天路由并聚焦 agent pane）', () => {
    const state = readOrCreateWorkbenchFlatState(() => '2026-03-30T21:00:00.000Z');
    const intent = resolveWorkbenchLegacyIntent('?legacySource=agent-chat&agentId=agent-daily');

    expect(intent).toEqual({
      source: 'agent-chat',
      route: '/agents/chat/agent-daily',
      agentId: 'agent-daily',
    });

    const next = applyWorkbenchLegacyIntent(state, intent);

    expect(next.panes[0]?.title).toBe('Agent Chat / agent-daily');
    expect(next.panes[0]?.description).toContain('/agents/chat/agent-daily');
  });
});
