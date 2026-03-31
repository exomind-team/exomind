import { beforeEach, describe, expect, it } from 'vitest';

import type { SessionInfo } from '@/lib/types/session';
import {
  WORKBENCH_PHASE1_STORAGE_KEY,
  buildWorkbenchPanesFromSessions,
  type WorkbenchPaneState,
} from '@/ui/app/pages/workbench/workbench-storage';

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-777',
    agent_kind: 'claude',
    agent_id: 'agent-777',
    role: 'Planner Agent',
    summary: 'Plan the next workbench slice',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: ['#777'],
      labels: ['workbench'],
    },
    created_at: '2026-03-31T02:00:00.000Z',
    last_active_at: '2026-03-31T02:30:00.000Z',
    turn_count: 3,
    last_output_preview: 'Ready for review',
    ...overrides,
  };
}

describe('Issue #777 runtime-fed workbench panes（真实 session 驱动工作台 pane）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('maps runtime sessions into mixed pane cards（把真实会话映射成混合 pane 卡片）', () => {
    const panes = buildWorkbenchPanesFromSessions([
      buildSession({
        id: 'session-structured',
        agent_id: 'agent-review',
        interaction_mode: 'structured',
        role: 'Review Agent',
        summary: 'Structured review conversation',
      }),
      buildSession({
        id: 'session-terminal',
        agent_id: undefined,
        interaction_mode: 'terminal',
        pty_id: 'pty-777',
        role: 'Terminal Runner',
        summary: 'PTY runtime attachment',
      }),
    ]);

    expect(panes).toHaveLength(2);

    expect(panes[0]).toMatchObject({
      id: 'pane-session-structured',
      bindingType: 'agent-session',
      viewKind: 'session-view',
      title: 'Review Agent',
      status: 'running',
      sessionId: 'session-structured',
      openPath: '/agents/chat/agent-review?workbenchBypass=true',
    });

    expect(panes[1]).toMatchObject({
      id: 'pane-session-terminal',
      bindingType: 'pty-runtime',
      viewKind: 'runtime-view',
      title: 'Terminal Runner',
      status: 'attached',
      sessionId: 'session-terminal',
      openPath: '/agents?workbenchBypass=true&focusSession=session-terminal',
    });
  });

  it('falls back to provided panes when runtime sessions are empty（真实会话为空时回退到提供的 pane）', () => {
    const fallbackPanes: WorkbenchPaneState[] = [
      {
        id: 'pane-fallback-1',
        title: 'Fallback Agent',
        viewKind: 'session-view',
        bindingType: 'agent-session',
        status: 'running',
        description: 'Persisted fallback pane',
        openPath: '/agents/chat/agent-fallback?workbenchBypass=true',
      },
    ];

    expect(buildWorkbenchPanesFromSessions([], fallbackPanes)).toEqual(fallbackPanes);
  });

  it('falls back to persisted panes when runtime sessions are empty（真实会话为空时回退到持久化 pane）', () => {
    const stored = {
      version: 1,
      space: { id: 'default-space', name: 'Agent Workbench', restoredAt: '2026-03-31T10:00:00.000Z' },
      surface: { id: 'surface-main', layoutPreset: 'flat-2up' as const },
      panes: [
        {
          id: 'fallback',
          title: 'Fallback Pane',
          viewKind: 'session-view',
          bindingType: 'agent-session',
          status: 'running',
          description: '备份 / fallback',
          openPath: '/agents/chat/agent-fallback?workbenchBypass=true',
        },
      ],
    };
    window.localStorage.setItem(WORKBENCH_PHASE1_STORAGE_KEY, JSON.stringify(stored));

    const panes = buildWorkbenchPanesFromSessions([]);

    expect(panes).toHaveLength(1);
    expect(panes[0]?.id).toBe('fallback');
  });

  it('maps waiting_input session to waiting pane（等待输入会话映射为 waiting 状态 pane）', () => {
    const panes = buildWorkbenchPanesFromSessions([
      buildSession({
        id: 'session-waiting',
        status: 'waiting_input',
        interaction_mode: 'structured',
      }),
    ]);

    expect(panes[0]?.status).toBe('waiting');
  });
});
