import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNowWorkbenchOverlayController } from '@/ui/app/overlay/use-now-workbench-overlay-controller';
import type { ActiveBlockData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';

const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();
const onBlockChangeMock = vi.fn(() => () => {});
const endBlockMock = vi.fn();
const listTasksMock = vi.fn<(includeCancelled?: boolean) => Promise<TaskNode[]>>();
const transitionTaskMock = vi.fn<(id: string, to: TaskNode['status']) => Promise<TaskNode | null>>();
const onBlockEndForTasksMock = vi.fn<(taskIds: string[], blockId: string) => Promise<void>>();
const addEventMock = vi.fn();
const getEventsPageMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

vi.mock('@/services/now-workbench-overlay.service', () => ({
  getNowWorkbenchOverlayService: () => ({
    hideTemporarily: vi.fn(),
    focusMainWindow: vi.fn(),
  }),
}));

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: (...args: unknown[]) => loadActiveBlockMock(...args),
    onBlockChange: (...args: unknown[]) => onBlockChangeMock(...args),
    endBlock: (...args: unknown[]) => endBlockMock(...args),
    markEnding: vi.fn(),
    pauseBlock: vi.fn(),
    resumeBlock: vi.fn(),
  }),
  getTaskService: () => ({
    listTasks: (...args: unknown[]) => listTasksMock(...args),
    transitionTask: (...args: unknown[]) => transitionTaskMock(...args),
  }),
  getTaskTimerService: () => ({
    onBlockEndForTasks: (...args: unknown[]) => onBlockEndForTasksMock(...args),
  }),
  getEventLogService: () => ({
    addEvent: (...args: unknown[]) => addEventMock(...args),
  }),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getCurrentUserId: () => 'overlay-user',
  getEventStorage: () => ({
    getEventsPage: (...args: unknown[]) => getEventsPageMock(...args),
  }),
}));

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'task-1',
    title: '修复悬浮窗结束流',
    status: 'in_progress',
    priority: 'high',
    dependsOn: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeActiveBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  return {
    startId: 'block-1',
    name: '悬浮窗专注',
    mode: 'countup',
    elapsed: 5 * 60 * 1000,
    startTime: Date.now() - 5 * 60 * 1000,
    paused: false,
    taskIds: ['task-1', 'task-2'],
    taskAssociationLog: [],
    ...overrides,
  };
}

describe('useNowWorkbenchOverlayController issue #590', () => {
  beforeEach(() => {
    loadActiveBlockMock.mockReset();
    onBlockChangeMock.mockReset();
    onBlockChangeMock.mockImplementation(() => () => {});
    endBlockMock.mockReset();
    endBlockMock.mockResolvedValue(null);
    listTasksMock.mockReset();
    listTasksMock.mockResolvedValue([
      makeTask({ id: 'task-1', title: '任务 A' }),
      makeTask({ id: 'task-2', title: '任务 B' }),
    ]);
    transitionTaskMock.mockReset();
    transitionTaskMock.mockResolvedValue(null);
    onBlockEndForTasksMock.mockReset();
    onBlockEndForTasksMock.mockResolvedValue(undefined);
    addEventMock.mockReset();
    addEventMock.mockResolvedValue(undefined);
    getEventsPageMock.mockReset();
    getEventsPageMock.mockResolvedValue({
      events: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('transitions every resolved task id when ending a block with taskIds only（仅有 taskIds 时会逐个转换关联任务状态）', async () => {
    loadActiveBlockMock.mockResolvedValue(makeActiveBlock());

    const { result } = renderHook(() => useNowWorkbenchOverlayController());

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalled();
      expect(result.current.model.activeBlock?.startId).toBe('block-1');
    });

    act(() => {
      result.current.setTaskStatusChoice('completed');
    });

    await waitFor(() => {
      expect(result.current.taskStatusChoice).toBe('completed');
    });

    await act(async () => {
      await result.current.handleConfirmEnd();
    });

    expect(endBlockMock).toHaveBeenCalledWith('', {
      taskStatusOutcomes: {
        'task-1': 'completed',
        'task-2': 'completed',
      },
    });
    expect(onBlockEndForTasksMock).toHaveBeenCalledWith(['task-1', 'task-2'], 'block-1');
    expect(transitionTaskMock).toHaveBeenCalledTimes(2);
    expect(transitionTaskMock).toHaveBeenNthCalledWith(1, 'task-1', 'completed');
    expect(transitionTaskMock).toHaveBeenNthCalledWith(2, 'task-2', 'completed');
  });
});
