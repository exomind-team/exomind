import { describe, expect, it } from 'vitest';
import {
  bindSessionToTiledPaneSlot,
  clearTiledPaneSlotBinding,
  createNextTiledPaneSlotId,
  createTemplatePaneTree,
  flattenTiledPaneTreeSlotIds,
  removeTiledPaneTreeSlot,
  splitTiledPaneTreeSlot,
  updateTiledPaneTreeSplitRatio,
} from '@/ui/app/pages/agents/tiled-pane-tree';

describe('tiled pane tree workbench helpers（平铺窗格树工作台辅助函数）', () => {
  it('splits a slot into two stable children while preserving the original slot id（分割窗格时保留原槽位并新增新槽位）', () => {
    const initialTree = createTemplatePaneTree('1x1');
    const expectedNextSlotId = createNextTiledPaneSlotId(initialTree);

    const result = splitTiledPaneTreeSlot(initialTree, 'slot-1', 'vertical');

    expect(result).not.toBeNull();
    expect(result?.newSlotId).toBe(expectedNextSlotId);
    expect(flattenTiledPaneTreeSlotIds(result!.tree)).toEqual(['slot-1', 'slot-2']);
    expect(result?.tree).toMatchObject({
      type: 'split',
      axis: 'vertical',
      children: [
        { type: 'slot', slotId: 'slot-1' },
        { type: 'slot', slotId: 'slot-2' },
      ],
    });
  });

  it('collapses the parent split when a slot is removed（关闭窗格后折叠父级 split）', () => {
    const initialTree = createTemplatePaneTree('1x2');

    const nextTree = removeTiledPaneTreeSlot(initialTree, 'slot-2');

    expect(nextTree).toEqual({
      type: 'slot',
      slotId: 'slot-1',
    });
  });

  it('clamps split ratios when resizing（拖拽分隔条时限制比例范围）', () => {
    const initialTree = createTemplatePaneTree('1x2');

    const maxClampedTree = updateTiledPaneTreeSplitRatio(initialTree, [], 0.99);
    const minClampedTree = updateTiledPaneTreeSplitRatio(initialTree, [], 0.01);

    expect(maxClampedTree).toMatchObject({
      type: 'split',
      ratio: 0.85,
    });
    expect(minClampedTree).toMatchObject({
      type: 'split',
      ratio: 0.15,
    });
  });

  it('moves a live session to the new slot without leaving a stale recoverable placeholder（移动会话时旧槽位应回到真正空窗格）', () => {
    const tree = createTemplatePaneTree('1x2');

    const nextSlots = bindSessionToTiledPaneSlot(
      tree,
      [
        {
          slotId: 'slot-1',
          sessionId: 'session-a',
          terminalRecovery: {
            sessionId: 'session-a',
            sourceHostId: 'runtime-host-842',
            agentType: 'codex',
            innerSessionId: 'codex-thread-842',
            role: 'Codex 842',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
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

  it('swaps two occupied slots instead of overwriting the target binding（occupied -> occupied 应换位而不是静默覆盖）', async () => {
    type MoveOrSwapBinding = (
      tree: ReturnType<typeof createTemplatePaneTree>,
      slots: Array<{
        slotId: string;
        sessionId?: string;
        terminalRecovery?: {
          sessionId: string;
          sourceHostId: string;
          agentType: string;
          innerSessionId: string;
          role: string;
          workdir: string;
          projectPathKey: string;
        };
      }>,
      sourceSlotId: string,
      targetSlotId: string,
    ) => unknown;

    const tree = createTemplatePaneTree('1x2');
    const module = await import('@/ui/app/pages/agents/tiled-pane-tree');
    const moveOrSwapTiledPaneSlotBinding = (
      module as Record<string, unknown>
    ).moveOrSwapTiledPaneSlotBinding as MoveOrSwapBinding | undefined;

    expect(moveOrSwapTiledPaneSlotBinding).toBeTypeOf('function');

    const nextSlots = moveOrSwapTiledPaneSlotBinding?.(
      tree,
      [
        {
          slotId: 'slot-1',
          sessionId: 'session-a',
          terminalRecovery: {
            sessionId: 'session-a',
            sourceHostId: 'runtime-host-a',
            agentType: 'codex',
            innerSessionId: 'codex-thread-a',
            role: 'Codex A',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
        {
          slotId: 'slot-2',
          sessionId: 'session-b',
          terminalRecovery: {
            sessionId: 'session-b',
            sourceHostId: 'runtime-host-b',
            agentType: 'claude',
            innerSessionId: 'claude-thread-b',
            role: 'Claude B',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
      ],
      'slot-1',
      'slot-2',
    );

    expect(nextSlots).toEqual([
      {
        slotId: 'slot-1',
        sessionId: 'session-b',
        terminalRecovery: {
          sessionId: 'session-b',
          sourceHostId: 'runtime-host-b',
          agentType: 'claude',
          innerSessionId: 'claude-thread-b',
          role: 'Claude B',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      },
      {
        slotId: 'slot-2',
        sessionId: 'session-a',
        terminalRecovery: {
          sessionId: 'session-a',
          sourceHostId: 'runtime-host-a',
          agentType: 'codex',
          innerSessionId: 'codex-thread-a',
          role: 'Codex A',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      },
    ]);
  });

  it('moves or swaps recoverable-only bindings without requiring a live session id（仅 recoverable 绑定也应可移动/换位）', async () => {
    type MoveOrSwapBinding = (
      tree: ReturnType<typeof createTemplatePaneTree>,
      slots: Array<{
        slotId: string;
        sessionId?: string;
        terminalRecovery?: {
          sessionId: string;
          sourceHostId: string;
          agentType: string;
          innerSessionId: string;
          role: string;
          workdir: string;
          projectPathKey: string;
        };
      }>,
      sourceSlotId: string,
      targetSlotId: string,
    ) => unknown;

    const tree = createTemplatePaneTree('1x2');
    const module = await import('@/ui/app/pages/agents/tiled-pane-tree');
    const moveOrSwapTiledPaneSlotBinding = (
      module as Record<string, unknown>
    ).moveOrSwapTiledPaneSlotBinding as MoveOrSwapBinding | undefined;

    expect(moveOrSwapTiledPaneSlotBinding).toBeTypeOf('function');

    const recovery = {
      sessionId: 'recoverable-session',
      sourceHostId: 'runtime-host-r',
      agentType: 'claude',
      innerSessionId: 'claude-recoverable',
      role: 'Recoverable Slot',
      workdir: 'D:/project/exomind',
      projectPathKey: 'd:/project/exomind',
    };

    const nextSlots = moveOrSwapTiledPaneSlotBinding?.(
      tree,
      [
        {
          slotId: 'slot-1',
          terminalRecovery: recovery,
        },
        {
          slotId: 'slot-2',
          sessionId: 'session-live',
          terminalRecovery: {
            sessionId: 'session-live',
            sourceHostId: 'runtime-host-live',
            agentType: 'codex',
            innerSessionId: 'codex-live',
            role: 'Live Slot',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
      ],
      'slot-1',
      'slot-2',
    );

    expect(nextSlots).toEqual([
      {
        slotId: 'slot-1',
        sessionId: 'session-live',
        terminalRecovery: {
          sessionId: 'session-live',
          sourceHostId: 'runtime-host-live',
          agentType: 'codex',
          innerSessionId: 'codex-live',
          role: 'Live Slot',
          workdir: 'D:/project/exomind',
          projectPathKey: 'd:/project/exomind',
        },
      },
      {
        slotId: 'slot-2',
        terminalRecovery: recovery,
      },
    ]);
  });

  it('clearing a slot removes both the live binding and recoverable snapshot（清空窗格时应同时移除绑定与恢复快照）', () => {
    const tree = createTemplatePaneTree('1x1');

    const nextSlots = clearTiledPaneSlotBinding(
      tree,
      [
        {
          slotId: 'slot-1',
          sessionId: 'session-a',
          terminalRecovery: {
            sessionId: 'session-a',
            sourceHostId: 'runtime-host-842',
            agentType: 'claude',
            innerSessionId: 'claude-thread-842',
            role: 'Claude 842',
            workdir: 'D:/project/exomind',
            projectPathKey: 'd:/project/exomind',
          },
        },
      ],
      'slot-1',
    );

    expect(nextSlots).toEqual([{ slotId: 'slot-1' }]);
  });
});
