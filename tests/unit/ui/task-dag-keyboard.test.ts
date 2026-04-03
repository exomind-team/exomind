import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import {
  ensureNodeVisible,
  findNearestNodeInDirection,
  findNearestNodeToViewportCenter,
  useTaskDagKeyboard,
} from '@/ui/app/hooks/useTaskDagKeyboard';
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

  it('finds the node closest to the viewport center（定位屏幕中心最近节点）', () => {
    const shell = document.createElement('div');
    shell.dataset.testid = 'task-dag-canvas-shell';
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 600 });
    document.body.appendChild(shell);

    const flowInstance = {
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    } as unknown as {
      getViewport: () => { x: number; y: number; zoom: number };
    };

    const nodes = [
      makeNode('far-left', 0, 0),
      makeNode('center-near', 280, 220),
      makeNode('far-right', 900, 400),
    ];

    expect(findNearestNodeToViewportCenter(flowInstance as never, nodes)).toBe('center-near');
  });

  it('switches zoom direction with Shift while holding Z and stops after releasing Z（按住 Z 时 Shift 实时切方向，松开 Z 后停止）', () => {
    const shell = document.createElement('div');
    shell.dataset.testid = 'task-dag-canvas-shell';
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 600 });
    document.body.appendChild(shell);

    const viewport = { x: 0, y: 0, zoom: 1 };
    const setViewport = vi.fn((next: { x: number; y: number; zoom: number }) => {
      viewport.x = next.x;
      viewport.y = next.y;
      viewport.zoom = next.zoom;
    });
    const flowInstance = {
      getViewport: () => ({ ...viewport }),
      setViewport,
    } as unknown as {
      getViewport: () => { x: number; y: number; zoom: number };
      setViewport: (next: { x: number; y: number; zoom: number }) => void;
    };

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let rafId = 1;
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = rafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafCallbacks.delete(id);
    });

    const latestRaf = () => {
      const callback = Array.from(rafCallbacks.values()).at(-1);
      expect(callback).toBeTypeOf('function');
      return callback as FrameRequestCallback;
    };

    renderHook(() => useTaskDagKeyboard({
      mode: 'browse',
      immersive: false,
      selectedTaskId: null,
      connectState: null,
      flowNodes: [makeNode('current', 0, 0)],
      flowInstance: flowInstance as never,
      panSpeed: 480,
      zoomSpeed: 30,
      onModeChange: vi.fn(),
      onImmersiveChange: vi.fn(),
      onSelectedTaskIdChange: vi.fn(),
      onConnectStateChange: vi.fn(),
      onConnectExecute: vi.fn(),
      onQuickCreateUpstream: vi.fn(),
      onQuickCreateDownstream: vi.fn(),
      onToggleCollapse: vi.fn(),
      canToggleCollapse: vi.fn(() => false),
    }));

    fireEvent.keyDown(document, { key: 'z' });
    expect(viewport.zoom).toBeGreaterThan(1);

    latestRaf()(16);
    const zoomBeforeShift = viewport.zoom;

    fireEvent.keyDown(document, { key: 'Shift' });
    latestRaf()(32);
    expect(viewport.zoom).toBeLessThan(zoomBeforeShift);

    const callCountBeforeRelease = setViewport.mock.calls.length;
    fireEvent.keyUp(document, { key: 'Z' });
    latestRaf()(48);
    expect(setViewport).toHaveBeenCalledTimes(callCountBeforeRelease);

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it('clears selected node before clearing the focused series with Esc and J（先清节点再清系列）', () => {
    let selectedTaskId: string | null = 'task-a';
    let focusedSeriesAnchorTaskId: string | null = 'task-a';
    const onSelectedTaskIdChange = vi.fn();
    const onClearFocusedSeries = vi.fn();

    const { rerender } = renderHook(() => useTaskDagKeyboard({
      mode: 'browse',
      immersive: false,
      selectedTaskId,
      focusedSeriesAnchorTaskId,
      connectState: null,
      flowNodes: [makeNode('task-a', 0, 0)],
      flowInstance: null,
      panSpeed: 480,
      zoomSpeed: 30,
      onModeChange: vi.fn(),
      onImmersiveChange: vi.fn(),
      onSelectedTaskIdChange,
      onClearFocusedSeries,
      onConnectStateChange: vi.fn(),
      onConnectExecute: vi.fn(),
      onQuickCreateUpstream: vi.fn(),
      onQuickCreateDownstream: vi.fn(),
      onToggleCollapse: vi.fn(),
      canToggleCollapse: vi.fn(() => false),
    }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSelectedTaskIdChange).toHaveBeenCalledWith(null);
    expect(onClearFocusedSeries).not.toHaveBeenCalled();

    onSelectedTaskIdChange.mockReset();
    selectedTaskId = null;
    rerender();

    focusedSeriesAnchorTaskId = 'task-a';
    rerender();

    fireEvent.keyDown(document, { key: 'j' });
    expect(onSelectedTaskIdChange).not.toHaveBeenCalled();
    expect(onClearFocusedSeries).toHaveBeenCalledTimes(1);
  });
});
