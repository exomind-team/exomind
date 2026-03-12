import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserState = {
  userId: 'overlay-test-user',
};

const runtimeStateByUser: Record<string, {
  activeBlock: null | Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}> = {
  'overlay-test-user': {
    activeBlock: null,
    tasks: [],
    events: [],
  },
  'profile-live': {
    activeBlock: null,
    tasks: [],
    events: [],
  },
};

const loadActiveBlockMock = vi.fn();
const onBlockChangeMock = vi.fn();
const listTasksMock = vi.fn();
const addEventMock = vi.fn();
const loadEventsPageMock = vi.fn();
const getEventStorageByUserMock = vi.fn();
const taskStorageOnChangeMock = vi.fn();
const eventStorageOnChangeMock = vi.fn();
let blockListener: ((block: unknown) => void) | null = null;
let taskStorageListener: (() => void) | null = null;
let eventStorageListener: (() => void) | null = null;
let focusChangedListener: ((event: { payload: boolean }) => void) | null = null;
const overlayHideMock = vi.fn();
const overlayShowMock = vi.fn();
const overlayFocusMock = vi.fn();
const getByLabelMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@/ui/app/components/NowInputRow', () => ({
  NowInputRow: ({ onSend }: { onSend: (content: string) => void }) => (
    <div data-testid="new-now-input-row">
      <button type="button" onClick={() => onSend('补一条当下记录')}>发送模拟输入</button>
    </div>
  ),
}));

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: (...args: unknown[]) => loadActiveBlockMock(...args),
    onBlockChange: (listener: (block: unknown) => void) => {
      blockListener = listener;
      return onBlockChangeMock(listener) || (() => {
        blockListener = null;
      });
    },
    pauseBlock: vi.fn(),
    resumeBlock: vi.fn(),
    markEnding: vi.fn(),
    endBlock: vi.fn(),
  }),
  getTaskService: () => ({
    listTasks: (...args: unknown[]) => listTasksMock(...args),
  }),
  getTaskTimerService: () => ({
    startBlockForTask: vi.fn(),
  }),
  getEventLogService: () => ({
    addEvent: (...args: unknown[]) => addEventMock(...args),
  }),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getCurrentUserId: () => currentUserState.userId,
  getEventStorage: (userId?: string) => {
    getEventStorageByUserMock(userId);
    return {
    getEventsPage: (...args: unknown[]) => loadEventsPageMock(...args),
    onRemoteChange: (listener: () => void) => {
      eventStorageListener = listener;
      return eventStorageOnChangeMock(listener) || (() => {
        eventStorageListener = null;
      });
    },
    };
  },
}));

vi.mock('@/lib/storage/task-storage', () => ({
  getTaskStorage: () => ({
    onRemoteChange: (listener: () => void) => {
      taskStorageListener = listener;
      return taskStorageOnChangeMock(listener) || (() => {
        taskStorageListener = null;
      });
    },
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: (...args: unknown[]) => overlayHideMock(...args),
    show: (...args: unknown[]) => overlayShowMock(...args),
    setFocus: (...args: unknown[]) => overlayFocusMock(...args),
    onMoved: vi.fn(async () => () => {}),
    startDragging: vi.fn(async () => undefined),
    onFocusChanged: vi.fn(async (listener: (event: { payload: boolean }) => void) => {
      focusChangedListener = listener;
      return () => {
        focusChangedListener = null;
      };
    }),
  }),
  Window: {
    getByLabel: (...args: unknown[]) => getByLabelMock(...args),
  },
}));

describe('NowWorkbenchOverlayPage runtime wiring（当下工作台悬浮窗运行时接线）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    blockListener = null;
    taskStorageListener = null;
    eventStorageListener = null;
    focusChangedListener = null;
    currentUserState.userId = 'overlay-test-user';
    runtimeStateByUser['overlay-test-user'] = {
      activeBlock: null,
      tasks: [],
      events: [],
    };
    runtimeStateByUser['profile-live'] = {
      activeBlock: null,
      tasks: [],
      events: [],
    };

    loadActiveBlockMock.mockReset();
    loadActiveBlockMock.mockImplementation(async () => runtimeStateByUser[currentUserState.userId].activeBlock);
    onBlockChangeMock.mockReset();
    onBlockChangeMock.mockImplementation(() => () => {
      blockListener = null;
    });
    listTasksMock.mockReset();
    listTasksMock.mockImplementation(async () => runtimeStateByUser[currentUserState.userId].tasks);
    addEventMock.mockReset();
    addEventMock.mockResolvedValue(undefined);
    loadEventsPageMock.mockReset();
    loadEventsPageMock.mockImplementation(async () => ({
      events: runtimeStateByUser[currentUserState.userId].events,
      nextCursor: null,
      hasMore: false,
    }));
    getEventStorageByUserMock.mockReset();
    taskStorageOnChangeMock.mockReset();
    taskStorageOnChangeMock.mockImplementation(() => () => {
      taskStorageListener = null;
    });
    eventStorageOnChangeMock.mockReset();
    eventStorageOnChangeMock.mockImplementation(() => () => {
      eventStorageListener = null;
    });
    overlayHideMock.mockReset();
    overlayHideMock.mockResolvedValue(undefined);
    overlayShowMock.mockReset();
    overlayShowMock.mockResolvedValue(undefined);
    overlayFocusMock.mockReset();
    overlayFocusMock.mockResolvedValue(undefined);
    getByLabelMock.mockReset();
    getByLabelMock.mockResolvedValue({
      show: overlayShowMock,
      setFocus: overlayFocusMock,
    });
  });

  it('loads running state from services when no explicit model is provided（无显式 model 时从服务加载运行态）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 9, 5, 0));
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-1',
      name: '推进悬浮窗接线',
      mode: 'countdown',
      targetMinutes: 25,
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 20 * 60 * 1000,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 5 * 60 * 1000,
      lastResumedAt: Date.UTC(2026, 2, 11, 9, 0, 0),
    };
    runtimeStateByUser['overlay-test-user'].events = [
      {
        id: 'event-1',
        content: '补了一条记录',
        createdAt: '2026-03-11T09:10:00.000Z',
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });
    expect(screen.getAllByText('推进悬浮窗接线').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('new-focus-running-clock')).toHaveTextContent('20:00');
  });

  it('renders live running overlay as a single focus card without extra runtime panels（运行态悬浮窗只保留主卡片，不再叠加额外面板）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 9, 5, 0));
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-1',
      name: '推进悬浮窗接线',
      mode: 'countdown',
      targetMinutes: 25,
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 20 * 60 * 1000,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 5 * 60 * 1000,
      lastResumedAt: Date.UTC(2026, 2, 11, 9, 0, 0),
    };
    runtimeStateByUser['overlay-test-user'].events = [
      {
        id: 'event-1',
        content: '补了一条记录',
        createdAt: '2026-03-11T09:10:00.000Z',
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('new-now-input-row')).toBeNull();
    expect(screen.queryByTestId('now-overlay-debug-panel')).toBeNull();
    expect(screen.queryByTestId('now-overlay-recent-event')).toBeNull();
  });

  it('pins the live running widget inside a fixed-width single-card stage（运行态单卡片舞台需要给 widget 明确宽度）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 9, 5, 0));
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-1',
      name: '继续测试第二轮时间块',
      mode: 'countdown',
      targetMinutes: 25,
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 20 * 60 * 1000,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 5 * 60 * 1000,
      lastResumedAt: Date.UTC(2026, 2, 11, 9, 0, 0),
    };

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    const stage = screen.getByTestId('now-overlay-single-card-stage');
    expect(stage.className).toContain('w-full');
    expect(stage.className).toContain('max-w-[390px]');
    expect(stage).toContainElement(screen.getByTestId('new-focus-timer-widget'));
  });

  it('renders the live running widget on a transparent overlay surface（运行态卡片舞台不再保留额外矩形底色）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 9, 5, 0));
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-1',
      name: '继续测试第二轮时间块',
      mode: 'countdown',
      targetMinutes: 25,
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 20 * 60 * 1000,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 5 * 60 * 1000,
      lastResumedAt: Date.UTC(2026, 2, 11, 9, 0, 0),
    };

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    expect(screen.getByTestId('new-focus-timer-widget').className).toContain('bg-transparent');
  });

  it('collapses live running overlay into a mini pill and can restore it（运行态隐藏浮窗改为折叠小窗并可恢复）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 9, 5, 0));
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-1',
      name: '继续测试第二轮时间块',
      mode: 'countdown',
      targetMinutes: 25,
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 20 * 60 * 1000,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 5 * 60 * 1000,
      lastResumedAt: Date.UTC(2026, 2, 11, 9, 0, 0),
    };

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '隐藏浮窗' }));

    await waitFor(() => {
      expect(screen.getByTestId('now-overlay-collapsed-pill')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('new-focus-timer-widget')).toBeNull();
    expect(screen.getByRole('button', { name: '展开浮窗' })).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开浮窗' }));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });
  });

  it('reopens main program path by focusing main and hiding overlay（回到主程序会聚焦主窗口并隐藏浮窗）', async () => {
    runtimeStateByUser['overlay-test-user'].events = [];
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.click(await screen.findByRole('button', { name: '回到主程序' }));

    await waitFor(() => {
      expect(getByLabelMock).toHaveBeenCalledWith('main');
      expect(overlayShowMock).toHaveBeenCalledTimes(1);
      expect(overlayFocusMock).toHaveBeenCalledTimes(1);
      expect(overlayHideMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('now-overlay-debug-panel')).toHaveTextContent('最近动作：return-to-main:success');
  });

  it('opens focus config with selected task title in idle_with_tasks mode（任务态点击开始后进入当下一致的配置流）', async () => {
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-1',
        title: '先补测试',
        status: 'not_started',
        priority: 'high',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 10, 0),
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.click(await screen.findByRole('button', { name: '先补测试' }));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-config')).toBeInTheDocument();
      expect(screen.getByTestId('new-focus-task-input')).toHaveValue('先补测试');
    });
    expect(screen.getByTestId('now-overlay-debug-panel')).toHaveTextContent('最近动作：task-select:open-config:task-1');
  });

  it('writes input into event log service（输入区继续写入事件日志）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.click(await screen.findByRole('button', { name: '发送模拟输入' }));

    await waitFor(() => {
      expect(addEventMock).toHaveBeenCalledWith('补一条当下记录');
    });
    expect(screen.getByTestId('now-overlay-debug-panel')).toHaveTextContent('最近动作：send:success');
  });

  it('refreshes against the latest current user context after prewarm（预热窗口后刷新会重新读取当前用户）', async () => {
    currentUserState.userId = 'overlay-test-user';
    runtimeStateByUser['overlay-test-user'] = {
      activeBlock: null,
      tasks: [],
      events: [],
    };
    runtimeStateByUser['profile-live'] = {
      activeBlock: {
        startId: 'profile-block',
        name: '真实当前时间块',
        mode: 'countup',
        startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
        elapsed: 0,
        paused: false,
      },
      tasks: [],
      events: [
        {
          id: 'live-event-1',
          content: '真实用户事件',
          createdAt: '2026-03-11T09:10:00.000Z',
        },
      ],
    };

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    expect(await screen.findByTestId('new-focus-state-idle')).toBeInTheDocument();
    expect(getEventStorageByUserMock).toHaveBeenCalledWith('overlay-test-user');

    currentUserState.userId = 'profile-live';
    await act(async () => {
      focusChangedListener?.({ payload: true });
      await Promise.resolve();
    });

    expect(getEventStorageByUserMock).toHaveBeenCalledWith('profile-live');
  });
});
