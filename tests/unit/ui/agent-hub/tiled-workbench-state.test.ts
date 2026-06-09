import { describe, expect, it } from 'vitest';
import {
  bindSessionToTiledSlot,
  commitActiveTiledWorkbenchLayoutSnapshot,
  createTiledWorkbenchLayout,
  clearTiledSlotBinding,
  deleteTiledWorkbenchLayout,
  reconcileTiledUnassignedSessionIds,
  renameTiledWorkbenchLayout,
  switchActiveTiledWorkbenchLayout,
} from '@/ui/app/pages/agents/tiled-workbench-state';
import {
  DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
  type TiledPersistState,
  type TiledWorkbenchPersistState,
} from '@/ui/app/pages/agents/agents-tiled-persistence';
import {
  createTemplatePaneSlotBindings,
  createTemplatePaneTree,
} from '@/ui/app/pages/agents/tiled-pane-tree';

function buildSnapshot(
  overrides: Partial<TiledPersistState> = {},
): TiledPersistState {
  return {
    version: 2,
    layout: '1x1',
    paneOrder: [],
    tree: createTemplatePaneTree('1x1'),
    slots: createTemplatePaneSlotBindings('1x1'),
    unassignedSessionIds: [],
    unassignedPoolCollapsed: false,
    immersive: false,
    ...overrides,
  };
}

function buildWorkbenchState(): TiledWorkbenchPersistState {
  return {
    version: 3,
    activeLayoutId: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
    layoutOrder: [DEFAULT_TILED_WORKBENCH_LAYOUT_ID, 'layout-review'],
    layouts: {
      [DEFAULT_TILED_WORKBENCH_LAYOUT_ID]: {
        id: DEFAULT_TILED_WORKBENCH_LAYOUT_ID,
        name: '默认布局',
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
        lastUsedAt: '2026-04-06T00:00:00.000Z',
        snapshot: buildSnapshot({
          paneOrder: ['session-a'],
          slots: createTemplatePaneSlotBindings('1x1', ['session-a']),
        }),
      },
      'layout-review': {
        id: 'layout-review',
        name: 'Review',
        createdAt: '2026-04-06T01:00:00.000Z',
        updatedAt: '2026-04-06T01:00:00.000Z',
        lastUsedAt: '2026-04-06T01:00:00.000Z',
        snapshot: buildSnapshot({
          layout: '1x2',
          paneOrder: ['session-b'],
          tree: createTemplatePaneTree('1x2'),
          slots: createTemplatePaneSlotBindings('1x2', ['session-b']),
        }),
      },
    },
    fullscreenPtyId: 'pty-fullscreen-seed',
    fullscreenTerminalRecovery: {
      sessionId: 'session-fullscreen-seed',
      sourceHostId: 'runtime-host-523',
      agentType: 'codex',
      innerSessionId: 'codex-thread-fullscreen-seed',
      role: 'Fullscreen Seed',
      workdir: 'D:/project/exomind',
      projectPathKey: 'd:/project/exomind',
    },
  };
}

describe('tiled workbench state helpers（平铺工作台状态辅助函数）', () => {
  it('binds a session to the target slot and clears duplicate bindings elsewhere（绑定会话到目标槽位时移除其他重复绑定）', () => {
    const nextSlots = bindSessionToTiledSlot(
      [
        { slotId: 'slot-1', sessionId: 'session-a' },
        { slotId: 'slot-2' },
      ],
      'slot-2',
      'session-a',
    );

    expect(nextSlots).toEqual([
      { slotId: 'slot-1' },
      { slotId: 'slot-2', sessionId: 'session-a' },
    ]);
  });

  it('clears a slot binding without destroying the slot and returns the released session id（清空窗格时保留槽位并返回释放出的会话）', () => {
    const result = clearTiledSlotBinding(
      [
        { slotId: 'slot-1', sessionId: 'session-a' },
        { slotId: 'slot-2' },
      ],
      'slot-1',
    );

    expect(result).toEqual({
      releasedSessionId: 'session-a',
      slots: [
        { slotId: 'slot-1' },
        { slotId: 'slot-2' },
      ],
    });
  });

  it('keeps unassigned pool ordered, drops invisible ids, and appends newly unbound sessions（未分配会话池保留顺序、移除不可见项并追加新解绑会话）', () => {
    const nextIds = reconcileTiledUnassignedSessionIds(
      ['session-b', 'session-stale'],
      ['session-a', 'session-b', 'session-c'],
      [
        { slotId: 'slot-1', sessionId: 'session-a' },
      ],
    );

    expect(nextIds).toEqual(['session-b', 'session-c']);
  });

  it('commits snapshot changes into the active named layout only（当前活动布局提交快照时不污染其他布局）', () => {
    const nextState = commitActiveTiledWorkbenchLayoutSnapshot(
      buildWorkbenchState(),
      buildSnapshot({
        paneOrder: ['session-a', 'session-c'],
        tree: createTemplatePaneTree('1x2'),
        slots: createTemplatePaneSlotBindings('1x2', ['session-a', 'session-c']),
      }),
      '2026-04-06T02:00:00.000Z',
    );

    expect(nextState.layouts[DEFAULT_TILED_WORKBENCH_LAYOUT_ID]?.snapshot.paneOrder).toEqual([
      'session-a',
      'session-c',
    ]);
    expect(nextState.layouts['layout-review']?.snapshot.paneOrder).toEqual(['session-b']);
    expect(nextState.layouts[DEFAULT_TILED_WORKBENCH_LAYOUT_ID]?.updatedAt).toBe('2026-04-06T02:00:00.000Z');
  });

  it('switches the active layout and updates last-used metadata（切换活动布局时更新 active id 与 lastUsedAt）', () => {
    const nextState = switchActiveTiledWorkbenchLayout(
      buildWorkbenchState(),
      'layout-review',
      '2026-04-06T03:00:00.000Z',
    );

    expect(nextState.activeLayoutId).toBe('layout-review');
    expect(nextState.layouts['layout-review']?.lastUsedAt).toBe('2026-04-06T03:00:00.000Z');
  });

  it('creates, renames, and deletes named layouts while preserving a fallback active layout（命名布局支持新增/重命名/删除并保留回退活动布局）', () => {
    const created = createTiledWorkbenchLayout(buildWorkbenchState(), {
      id: 'layout-focus',
      name: 'Focus',
      snapshot: buildSnapshot({
        immersive: true,
      }),
      now: '2026-04-06T04:00:00.000Z',
      activate: true,
    });
    const renamed = renameTiledWorkbenchLayout(
      created,
      'layout-focus',
      'Focus Deep',
      '2026-04-06T04:05:00.000Z',
    );
    const deleted = deleteTiledWorkbenchLayout(
      renamed,
      'layout-focus',
      '2026-04-06T04:10:00.000Z',
    );

    expect(created.activeLayoutId).toBe('layout-focus');
    expect(created.layoutOrder).toContain('layout-focus');
    expect(renamed.layouts['layout-focus']?.name).toBe('Focus Deep');
    expect(deleted.activeLayoutId).toBe('layout-review');
    expect(deleted.layouts['layout-review']?.lastUsedAt).toBe('2026-04-06T04:10:00.000Z');
  });

  it('preserves fullscreen terminal root state when creating a new named layout（新建布局时不丢失根级 fullscreen 终端状态）', () => {
    const created = createTiledWorkbenchLayout(buildWorkbenchState(), {
      id: 'layout-fullscreen-check',
      name: 'Fullscreen Check',
      snapshot: buildSnapshot(),
      now: '2026-04-06T05:00:00.000Z',
      activate: true,
    });

    expect(created.fullscreenPtyId).toBe('pty-fullscreen-seed');
    expect(created.fullscreenTerminalRecovery).toEqual({
      sessionId: 'session-fullscreen-seed',
      sourceHostId: 'runtime-host-523',
      agentType: 'codex',
      innerSessionId: 'codex-thread-fullscreen-seed',
      role: 'Fullscreen Seed',
      workdir: 'D:/project/exomind',
      projectPathKey: 'd:/project/exomind',
    });
  });
});
