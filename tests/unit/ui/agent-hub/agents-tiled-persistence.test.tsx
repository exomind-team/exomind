import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SessionInfo } from '@/lib/types/session';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import {
  AGENTS_TILED_PERSISTENCE_STORAGE_KEY,
  DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
  DEFAULT_TILED_WORKBENCH_LAYOUT_NAME,
  readAgentsTiledPersistState,
  readAgentsTiledWorkbenchPersistState,
  writeAgentsTiledPersistState,
  writeAgentsTiledWorkbenchPersistState,
} from '@/ui/app/pages/agents/agents-tiled-persistence';
import {
  createTemplatePaneSlotBindings,
  createTemplatePaneTree,
} from '@/ui/app/pages/agents/tiled-pane-tree';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({ ptyId }: { ptyId: string }) => <div data-testid={`mock-pty-terminal-${ptyId}`}>PTY:{ptyId}</div>,
}));

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-persist-default',
    agent_kind: 'claude',
    role: 'Persistent Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-persist-default',
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

describe('agents tiled persistence（终端平铺持久化）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips tiled layout, pane order, and fullscreen PTY id（布局、pane 顺序、全屏 PTY 可往返持久化）', () => {
    const tree = createTemplatePaneTree('2x4');
    const slots = createTemplatePaneSlotBindings('2x4', ['session-a', 'session-b']);

    writeAgentsTiledPersistState({
      version: 2,
      layout: '2x4',
      paneOrder: ['session-a', 'session-b'],
      tree,
      slots,
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
      fullscreenPtyId: 'pty-recover-1',
      fullscreenTerminalRecovery: {
        sessionId: 'session-a',
        sourceHostId: 'runtime-host-523',
        agentType: 'codex',
        innerSessionId: 'codex-thread-818',
        role: 'Codex Recovery',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    });

    expect(localStorage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY)).toContain('pty-recover-1');
    expect(readAgentsTiledPersistState()).toEqual({
      version: 2,
      layout: '2x4',
      paneOrder: ['session-a', 'session-b'],
      tree,
      slots,
      unassignedSessionIds: [],
      unassignedPoolCollapsed: false,
      immersive: false,
      fullscreenPtyId: 'pty-recover-1',
      fullscreenTerminalRecovery: {
        sessionId: 'session-a',
        sourceHostId: 'runtime-host-523',
        agentType: 'codex',
        innerSessionId: 'codex-thread-818',
        role: 'Codex Recovery',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    });
  });

  it('migrates legacy single-layout storage into the named layout collection（旧单快照会自动迁移为命名布局集合）', () => {
    const legacyTree = createTemplatePaneTree('1x2');
    const legacySlots = createTemplatePaneSlotBindings('1x2', ['session-legacy']);
    localStorage.setItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY, JSON.stringify({
      version: 2,
      layout: '1x2',
      paneOrder: ['session-legacy'],
      tree: legacyTree,
      slots: legacySlots,
      focusedSlotId: 'slot-1',
      unassignedSessionIds: ['session-idle'],
      unassignedPoolCollapsed: true,
      immersive: true,
    }));

    expect(readAgentsTiledWorkbenchPersistState()).toEqual({
      version: 3,
      activeLayoutId: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
      layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID],
      layouts: {
        [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
          id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
          name: DEFAULT_TILED_WORKBENCH_LAYOUT_NAME,
          createdAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '1970-01-01T00:00:00.000Z',
          lastUsedAt: '1970-01-01T00:00:00.000Z',
          snapshot: {
            version: 2,
            layout: '1x2',
            paneOrder: ['session-legacy'],
            tree: legacyTree,
            slots: legacySlots,
            focusedSlotId: 'slot-1',
            unassignedSessionIds: ['session-idle'],
            unassignedPoolCollapsed: true,
            immersive: true,
          },
        },
      },
    });
    expect(readAgentsTiledPersistState()).toEqual({
      version: 2,
      layout: '1x2',
      paneOrder: ['session-legacy'],
      tree: legacyTree,
      slots: legacySlots,
      focusedSlotId: 'slot-1',
      unassignedSessionIds: ['session-idle'],
      unassignedPoolCollapsed: true,
      immersive: true,
    });
  });

  it('round-trips a named layout collection and keeps the selected active snapshot（命名布局集合可往返持久化并保留活动布局）', () => {
    const defaultTree = createTemplatePaneTree('1x1');
    const reviewTree = createTemplatePaneTree('2x2');
    const state = {
      version: 3 as const,
      activeLayoutId: 'layout-review',
      layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'layout-review'],
      layouts: {
        [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
          id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
          name: DEFAULT_TILED_WORKBENCH_LAYOUT_NAME,
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
          lastUsedAt: '2026-04-06T00:00:00.000Z',
          snapshot: {
            version: 2 as const,
            layout: '1x1' as const,
            paneOrder: [],
            tree: defaultTree,
            slots: createTemplatePaneSlotBindings('1x1'),
            unassignedSessionIds: [],
            unassignedPoolCollapsed: false,
            immersive: false,
          },
        },
        'layout-review': {
          id: 'layout-review',
          name: 'Review',
          createdAt: '2026-04-06T01:00:00.000Z',
          updatedAt: '2026-04-06T01:00:00.000Z',
          lastUsedAt: '2026-04-06T02:00:00.000Z',
          snapshot: {
            version: 2 as const,
            layout: '2x2' as const,
            paneOrder: ['session-a'],
            tree: reviewTree,
            slots: createTemplatePaneSlotBindings('2x2', ['session-a']),
            focusedSlotId: 'slot-1',
            unassignedSessionIds: ['session-b'],
            unassignedPoolCollapsed: false,
            immersive: true,
          },
        },
      },
    };

    writeAgentsTiledWorkbenchPersistState(state);

    expect(readAgentsTiledWorkbenchPersistState()).toEqual(state);
    expect(readAgentsTiledPersistState()).toEqual(state.layouts['layout-review']?.snapshot);
  });

  it('renders a disconnected placeholder for stale pane ids and removes it on close（过期 pane 显示断开占位并可移除）', () => {
    const onReorder = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-live',
            pty_id: 'pty-live',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneOrder={['session-stale', 'session-live']}
        onReorder={onReorder}
      />,
    );

    expect(screen.getByTestId('tiled-grid-disconnected-session-stale')).toBeInTheDocument();
    expect(screen.getByText('会话已断开')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tiled-grid-disconnected-close-session-stale'));

    expect(onReorder).toHaveBeenCalledWith(['session-live']);
  });
});
