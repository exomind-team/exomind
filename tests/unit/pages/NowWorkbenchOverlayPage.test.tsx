import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NowWorkbenchOverlayModel } from '@/ui/app/overlay/now-workbench-overlay-model';

const startDraggingMock = vi.fn();
const onMovedMock = vi.fn();
let movedListener: ((event: { payload: { x: number; y: number } }) => void) | null = null;
const setNowWorkbenchOverlayPositionMock = vi.fn((value: { x: number; y: number }) => value);

vi.mock('@/ui/app/components/NowInputRow', () => ({
  NowInputRow: () => <div data-testid="new-now-input-row">mock-now-input-row</div>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: (...args: unknown[]) => startDraggingMock(...args),
    onMoved: (...args: unknown[]) => {
      const [listener] = args as [(event: { payload: { x: number; y: number } }) => void];
      movedListener = listener;
      onMovedMock(...args);
      return Promise.resolve(() => {
        movedListener = null;
      });
    },
  }),
}));

vi.mock('@/config/now-workbench-overlay-preferences', () => ({
  setNowWorkbenchOverlayPosition: (...args: unknown[]) => setNowWorkbenchOverlayPositionMock(...args),
}));

function createModel(overrides: Partial<NowWorkbenchOverlayModel> = {}): NowWorkbenchOverlayModel {
  return {
    mode: 'idle_input_only',
    title: '当下工作台',
    statusLabel: '随时记录',
    activeBlock: null,
    visibleTasks: [],
    recentEvents: [
      { id: 'event-2', content: '最新记录', timestamp: Date.UTC(2026, 2, 11, 9, 30, 0) },
      { id: 'event-1', content: '上一条记录', timestamp: Date.UTC(2026, 2, 11, 9, 0, 0) },
    ],
    ...overrides,
  };
}

describe('NowWorkbenchOverlayPage', () => {
  it('starts native dragging from the title drag handle（按住标题拖拽柄可触发原生拖动）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    startDraggingMock.mockResolvedValue(undefined);

    render(
      <NowWorkbenchOverlayPage
        model={createModel({
          mode: 'running',
          title: '推进当下工作台',
          statusLabel: '进行中',
        })}
      />,
    );

    expect(screen.getByTestId('now-overlay-drag-handle')).toBeInTheDocument();
    expect(screen.getByText('拖动窗口')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('now-overlay-drag-handle'), { button: 0 });

    expect(startDraggingMock).toHaveBeenCalledTimes(1);
  });

  it('does not start dragging when clicking action buttons（点击窗口动作按钮时不应触发拖动）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    startDraggingMock.mockClear();

    render(
      <NowWorkbenchOverlayPage
        model={createModel({
          mode: 'running',
          title: '推进当下工作台',
          statusLabel: '进行中',
        })}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: '隐藏浮窗' }), { button: 0 });

    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  it('persists moved position from native window event（原生移动事件会持久化窗口位置）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    setNowWorkbenchOverlayPositionMock.mockClear();

    render(<NowWorkbenchOverlayPage model={createModel()} />);

    movedListener?.({ payload: { x: 300, y: 420 } });

    expect(setNowWorkbenchOverlayPositionMock).toHaveBeenCalledWith({ x: 300, y: 420 });
  });

  it('renders drag header plus hide / return actions in running mode（运行态渲染拖拽头部与窗口动作）', async () => {
    const onHide = vi.fn();
    const onReturnToMain = vi.fn();
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');

    render(
      <NowWorkbenchOverlayPage
        model={createModel({
          mode: 'running',
          title: '推进当下工作台',
          statusLabel: '进行中',
        })}
        onHide={onHide}
        onReturnToMain={onReturnToMain}
      />,
    );

    expect(screen.getByTestId('now-overlay-drag-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '隐藏浮窗' }));
    fireEvent.click(screen.getByRole('button', { name: '回到主程序' }));

    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onReturnToMain).toHaveBeenCalledTimes(1);
  });

  it('shows running card, latest two events, and input row when active block exists（运行态显示卡片、最近事件和输入区）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');

    render(
      <NowWorkbenchOverlayPage
        model={createModel({
          mode: 'running',
          title: '推进悬浮工作台',
          statusLabel: '进行中',
        })}
      />,
    );

    expect(screen.getByTestId('now-overlay-running-card')).toBeInTheDocument();
    expect(screen.getByTestId('now-overlay-scroll-region')).toBeInTheDocument();
    expect(screen.getAllByTestId('now-overlay-recent-event')).toHaveLength(2);
    expect(screen.getByTestId('new-now-input-row')).toBeInTheDocument();
  });

  it('shows task choices when idle_with_tasks（有任务但未开始时显示任务入口）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');

    render(
      <NowWorkbenchOverlayPage
        model={createModel({
          mode: 'idle_with_tasks',
          title: '先补测试',
          statusLabel: '未开始',
          visibleTasks: [
            {
              id: 'task-1',
              title: '先补测试',
              status: 'in_progress',
              priority: 'high',
              dependsOn: [],
              tags: [],
              createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
              updatedAt: Date.UTC(2026, 2, 11, 9, 0, 0),
            },
            {
              id: 'task-2',
              title: '整理输入区',
              status: 'not_started',
              priority: 'medium',
              dependsOn: [],
              tags: [],
              createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
              updatedAt: Date.UTC(2026, 2, 11, 8, 30, 0),
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId('now-overlay-task-choice-list')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '先补测试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整理输入区' })).toBeInTheDocument();
  });

  it('falls back to input-only mode when there are no visible tasks（无任务时退化为纯输入态）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');

    render(<NowWorkbenchOverlayPage model={createModel()} />);

    expect(screen.getByTestId('now-overlay-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('now-overlay-task-choice-list')).toBeNull();
    expect(screen.getByTestId('new-now-input-row')).toBeInTheDocument();
  });
});
