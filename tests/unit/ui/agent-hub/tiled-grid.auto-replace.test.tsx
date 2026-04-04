import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@/lib/types/session';
import { applySpawnedSessionToTiledPaneOrder } from '@/ui/app/pages/agents/tiled-pane-order';

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-default',
    agent_kind: 'claude',
    role: 'Terminal Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-default',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-04-02T00:00:00.000Z',
    last_active_at: '2026-04-02T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

describe('tiled pane auto replace on spawn（新建会话时自动替换平铺 pane）', () => {
  it('drops completed panes from pane order before placing the new session（completed pane 不应继续占用平铺位）', () => {
    const nextPaneOrder = applySpawnedSessionToTiledPaneOrder({
      layout: '2x2',
      paneOrder: ['session-completed', 'session-active'],
      sessions: [
        buildSession({
          id: 'session-completed',
          status: 'completed',
        }),
        buildSession({
          id: 'session-active',
          status: 'running',
        }),
      ],
      newSessionId: 'session-new',
    });

    expect(nextPaneOrder).toEqual(['session-active', 'session-new']);
  });

  it('does not insert the new session when all visible panes are active and full（所有可见 pane 都活跃且已满时不自动插入新会话）', () => {
    const nextPaneOrder = applySpawnedSessionToTiledPaneOrder({
      layout: '1x2',
      paneOrder: ['session-a', 'session-b'],
      sessions: [
        buildSession({ id: 'session-a', status: 'running' }),
        buildSession({ id: 'session-b', status: 'waiting_input' }),
      ],
      newSessionId: 'session-new',
    });

    expect(nextPaneOrder).toEqual(['session-a', 'session-b']);
  });

  it('appends the new session when there is still an empty pane（有空位时追加新会话）', () => {
    const nextPaneOrder = applySpawnedSessionToTiledPaneOrder({
      layout: '2x2',
      paneOrder: ['session-a'],
      sessions: [
        buildSession({ id: 'session-a', status: 'running' }),
      ],
      newSessionId: 'session-new',
    });

    expect(nextPaneOrder).toEqual(['session-a', 'session-new']);
  });

  it('ignores archived and completed sessions when reconstructing displayed panes（重建平铺 pane 时忽略 completed / archived）', () => {
    const nextPaneOrder = applySpawnedSessionToTiledPaneOrder({
      layout: '2x2',
      paneOrder: ['session-archived', 'session-completed', 'session-active'],
      sessions: [
        buildSession({ id: 'session-archived', status: 'archived' }),
        buildSession({ id: 'session-completed', status: 'completed' }),
        buildSession({ id: 'session-active', status: 'running' }),
      ],
      newSessionId: 'session-new',
    });

    expect(nextPaneOrder).toEqual(['session-active', 'session-new']);
  });
});
