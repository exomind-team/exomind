import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureNodeVisible, findNearestNodeInDirection } from '@/ui/app/hooks/useTaskDagKeyboard';
import type { TaskDagFlowNode } from '@/ui/app/pages/task-dag-flow';

function makeNode(id: string, x: number, y: number, width = 256, height = 140): TaskDagFlowNode {
  return {
    id,
    type: 'taskDag',
    position: { x, y },
    data: {
      title: id,
      statusLabel: '待办',
      priorityLabel: '中优先级',
      executionLabel: '待处理',
      isSelected: false,
      isSearchMatch: false,
      isSearchDimmed: false,
      isCurrentRoot: false,
      isCollapsedTarget: false,
      isCollapsedUpstreamTarget: false,
      isCollapsedDownstreamTarget: false,
      isBlocked: false,
      isExecutable: true,
      hiddenUpstreamCount: 0,
      hiddenDownstreamCount: 0,
    },
    measured: { width, height },
  } as TaskDagFlowNode;
}

describe('useTaskDagKeyboard helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the nearest node on the right within the ±45° cone（向右找到最近候选）', () => {
    const nodes = [
      makeNode('current', 0, 0),
      makeNode('right-near', 320, 20),
      makeNode('right-far', 640, 0),
      makeNode('down', 40, 400),
    ];

    expect(findNearestNodeInDirection('current', 'right', nodes)).toBe('right-near');
  });

  it('ignores nodes outside the direction cone（忽略扇形外节点）', () => {
    const nodes = [
      makeNode('current', 0, 0),
      makeNode('diagonal-too-steep', 80, 420),
      makeNode('up', 0, -320),
    ];

    expect(findNearestNodeInDirection('current', 'right', nodes)).toBeNull();
  });

  it('returns null when there is no candidate in the requested direction（无候选时返回 null）', () => {
    const nodes = [
      makeNode('current', 0, 0),
      makeNode('left', -320, 0),
    ];

    expect(findNearestNodeInDirection('current', 'right', nodes)).toBeNull();
  });

  it('only pans when the focused node is about to leave the viewport（仅在即将出视口时平移）', () => {
    const shell = document.createElement('div');
    shell.dataset.testid = 'task-dag-canvas-shell';
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 600 });
    document.body.appendChild(shell);

    const setViewport = vi.fn();
    const flowInstance = {
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport,
    } as unknown as {
      getViewport: () => { x: number; y: number; zoom: number };
      setViewport: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => void;
    };

    ensureNodeVisible('inside', flowInstance as never, [makeNode('inside', 120, 120)]);
    expect(setViewport).not.toHaveBeenCalled();

    ensureNodeVisible('outside', flowInstance as never, [makeNode('outside', 700, 520)]);
    expect(setViewport).toHaveBeenCalledWith(
      { x: -196, y: -100, zoom: 1 },
      { duration: 150 },
    );
  });
});
