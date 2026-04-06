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
