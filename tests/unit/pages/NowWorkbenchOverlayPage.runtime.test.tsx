import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setInputSendMode } from '@/config/input-send-mode';

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
const transitionTaskMock = vi.fn();
const addEventMock = vi.fn();
const appendEventDataMock = vi.fn();
const endBlockMock = vi.fn();
const markEndingMock = vi.fn();
const onBlockEndForTasksMock = vi.fn();
const startBlockForTaskMock = vi.fn();
const calculateSpentMinutesMock = vi.fn();
const addTaskToBlockMock = vi.fn();
const loadEventsPageMock = vi.fn();
const getEventStorageByUserMock = vi.fn();
const taskStorageOnChangeMock = vi.fn();
const eventStorageOnChangeMock = vi.fn();
let blockListener: ((block: unknown) => void) | null = null;
let taskStorageListener: (() => void) | null = null;
let eventStorageListener: (() => void) | null = null;
let focusChangedListener: ((event: { payload: boolean }) => void) | null = null;
const overlayHideMock = vi.fn();
const focusMainWindowMock = vi.fn();
const overlaySetSizeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@/services/now-workbench-overlay.service', () => ({
  getNowWorkbenchOverlayService: () => ({
    focusMainWindow: (...args: unknown[]) => focusMainWindowMock(...args),
    hideTemporarily: vi.fn(),
    reopenFromMainWindow: vi.fn(),
    init: vi.fn(),
    destroy: vi.fn(),
    syncVisibility: vi.fn(),
    savePosition: vi.fn(),
  }),
}));

vi.mock('@/ui/app/components/NowInputRow', () => ({
  NowInputRow: ({ onSend }: { onSend: (content: string) => void }) => (
    <div data-testid="new-now-input-row">
      <textarea data-testid="new-now-input-textarea" />
      <button type="button" onClick={() => onSend('补一条当下记录')}>发送模拟输入</button>
    </div>
  ),
}));

vi.mock('@/ui/app/components/FocusTimerWidget', async () => {
  const React = await import('react');

  const FocusTimerWidget = React.forwardRef(({
    surface,
    overlayRunningChrome,
  }: {
    surface?: string;
    overlayRunningChrome?: {
      statusLabel: string;
      onCollapse: () => void;
      onReturnToMain: () => void;
    };
  }, ref) => {
    const [configTaskTitle, setConfigTaskTitle] = React.useState<string | null>(null);
    const activeBlock = runtimeStateByUser[currentUserState.userId].activeBlock as
      | null
      | { mode?: string; name?: string };

    React.useImperativeHandle(ref, () => ({
      openTaskConfig: (taskConfig: string | { title: string }) => {
        setConfigTaskTitle(typeof taskConfig === 'string' ? taskConfig : taskConfig.title);
      },
    }), []);

    if (configTaskTitle) {
      return (
        <div data-testid="new-focus-timer-widget" className={surface === 'overlay' ? 'bg-transparent' : ''}>
          <div data-testid="new-focus-state-config">
            <input data-testid="new-focus-task-input" value={configTaskTitle} readOnly />
          </div>
        </div>
      );
    }

    if (activeBlock) {
      return (
        <div data-testid="new-focus-timer-widget" className={surface === 'overlay' ? 'bg-transparent' : ''}>
          <div data-testid="new-focus-state-running">
            {overlayRunningChrome ? (
              <div data-testid="new-focus-overlay-running-header">
                <p>{overlayRunningChrome.statusLabel}</p>
                <button type="button" onClick={overlayRunningChrome.onCollapse}>收起</button>
                <button type="button" onClick={overlayRunningChrome.onReturnToMain}>显示主程序</button>
              </div>
            ) : null}
            <p>{activeBlock.name ?? '未命名时间块'}</p>
            <p data-testid="new-focus-running-clock">{activeBlock.mode === 'countdown' ? '20:00' : '00:00'}</p>
          </div>
        </div>
      );
    }

    return (
      <div data-testid="new-focus-timer-widget" className={surface === 'overlay' ? 'bg-transparent' : ''}>
        <div data-testid="new-focus-state-idle">idle</div>
      </div>
    );
  });

  return {
    FocusTimerWidget,
  };
});

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
    markEnding: (...args: unknown[]) => markEndingMock(...args),
    endBlock: (...args: unknown[]) => endBlockMock(...args),
  }),
  getTaskService: () => ({
    listTasks: (...args: unknown[]) => listTasksMock(...args),
    transitionTask: (...args: unknown[]) => transitionTaskMock(...args),
  }),
  getTaskTimerService: () => ({
    startBlockForTask: (...args: unknown[]) => startBlockForTaskMock(...args),
    calculateSpentMinutes: (...args: unknown[]) => calculateSpentMinutesMock(...args),
    addTaskToBlock: (...args: unknown[]) => addTaskToBlockMock(...args),
    onBlockEndForTasks: (...args: unknown[]) => onBlockEndForTasksMock(...args),
  }),
  getEventLogService: () => ({
    addEvent: (...args: unknown[]) => addEventMock(...args),
    appendEventData: (...args: unknown[]) => appendEventDataMock(...args),
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
    setSize: (...args: unknown[]) => overlaySetSizeMock(...args),
    onMoved: vi.fn(async () => () => {}),
    startDragging: vi.fn(async () => undefined),
    onFocusChanged: vi.fn(async (listener: (event: { payload: boolean }) => void) => {
      focusChangedListener = listener;
      return () => {
        focusChangedListener = null;
      };
    }),
  }),
}));

describe('NowWorkbenchOverlayPage runtime wiring（当下工作台悬浮窗运行时接线）', () => {
  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    setInputSendMode('ctrl-enter-send');
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
    transitionTaskMock.mockReset();
    transitionTaskMock.mockResolvedValue(undefined);
    addEventMock.mockReset();
    addEventMock.mockResolvedValue(undefined);
    appendEventDataMock.mockReset();
    appendEventDataMock.mockResolvedValue(undefined);
    markEndingMock.mockReset();
    markEndingMock.mockResolvedValue(undefined);
    endBlockMock.mockReset();
    endBlockMock.mockImplementation(async () => {
      runtimeStateByUser[currentUserState.userId].activeBlock = null;
    });
    onBlockEndForTasksMock.mockReset();
    onBlockEndForTasksMock.mockResolvedValue(undefined);
    startBlockForTaskMock.mockReset();
    startBlockForTaskMock.mockImplementation(async (taskId: string, config?: { mode?: string; minutes?: number }) => {
      const task = runtimeStateByUser[currentUserState.userId].tasks.find((candidate) => candidate.id === taskId);
      if (task) {
        task.status = 'in_progress';
      }
      runtimeStateByUser[currentUserState.userId].activeBlock = {
        startId: 'started-from-idle',
        name: task?.title ?? '未命名时间块',
        mode: config?.mode ?? 'countup',
        targetMinutes: config?.mode === 'countdown' ? config.minutes : undefined,
        startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
        elapsed: 0,
        paused: false,
        phase: 'running',
        taskIds: [taskId],
      };
      return runtimeStateByUser[currentUserState.userId].activeBlock;
    });
    calculateSpentMinutesMock.mockReset();
    calculateSpentMinutesMock.mockResolvedValue(0);
    addTaskToBlockMock.mockReset();
    addTaskToBlockMock.mockResolvedValue(undefined);
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
    focusMainWindowMock.mockReset();
    focusMainWindowMock.mockResolvedValue(undefined);
    overlaySetSizeMock.mockReset();
    overlaySetSizeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    blockListener = null;
    taskStorageListener = null;
    eventStorageListener = null;
    focusChangedListener = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders shutdown-ready nudge when runtime model carries it（待收工提醒按当前 model 语义渲染）', { timeout: 20000 }, async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(
      <NowWorkbenchOverlayPage
        model={{
          mode: 'idle_input_only',
          title: '当下工作台',
          statusLabel: '随时记录',
          activeBlock: null,
          visibleTasks: [],
          recentEvents: [],
          nudge: {
            kind: 'shutdown_ready',
            title: '准备收工',
            body: '今天已经可以先收住了，回主程序完成正式收工。',
            ctaLabel: '回主程序收工',
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('now-overlay-ritual-nudge')).toBeInTheDocument();
    });
    expect(screen.getByText('准备收工')).toBeInTheDocument();
  });

  it('loads running state from services when no explicit model is provided（无显式 model 时从服务加载运行态）', { timeout: 20000 }, async () => {
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
    expect(screen.getByTestId('new-focus-overlay-running-header')).toHaveTextContent('进行中');
    expect(screen.getAllByText('推进悬浮窗接线').length).toBeGreaterThanOrEqual(1);
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

    expect(screen.queryByTestId('now-overlay-live-control-bar')).toBeNull();
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

  it('grows overlay window height from measured single-card shell when running card becomes taller（运行态单卡片高度变大时悬浮窗会随内容增长）', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 11, 9, 5, 0));
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRectMock() {
      if ((this as HTMLElement).getAttribute('data-testid') === 'now-overlay-single-card-shell') {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 440,
          bottom: 560,
          width: 440,
          height: 560,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-1',
      name: '长关联任务测试',
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
      expect(screen.getByTestId('now-overlay-single-card-shell')).toBeInTheDocument();
      expect(overlaySetSizeMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        overlaySetSizeMock.mock.calls.some(([size]) => (
          (size as { width?: number; height?: number }).width === 464
          && (size as { width?: number; height?: number }).height === 584
        )),
      ).toBe(true);
    });
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

    fireEvent.click(screen.getByRole('button', { name: '收起' }));

    await waitFor(() => {
      expect(screen.getByTestId('now-overlay-collapsed-pill')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('new-focus-timer-widget')).toBeNull();
    expect(screen.getByTestId('now-overlay-collapsed-clock')).toHaveTextContent(/\d{2}:\d{2}/);
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示主程序' })).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(overlaySetSizeMock).toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByTestId('now-overlay-collapsed-pill'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '结束' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });
  });

  it('returns to main program without hiding overlay（回到主程序会聚焦主窗口但不隐藏浮窗）', async () => {
    runtimeStateByUser['overlay-test-user'].events = [];
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.mouseEnter(await screen.findByTestId('now-overlay-idle-pill'));
    fireEvent.click(await screen.findByRole('button', { name: '显示主程序' }));

    await waitFor(() => {
      expect(focusMainWindowMock).toHaveBeenCalledTimes(1);
    });
    expect(overlayHideMock).not.toHaveBeenCalled();
  });

  it('quick-starts the selected task in idle_with_tasks mode（任务态点击开始后直接按 DAG 语义开启时间块）', async () => {
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-1',
        title: '先补测试',
        status: 'pending',
        priority: 'high',
        estimatedMinutes: 45,
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 10, 0),
      },
    ];
    calculateSpentMinutesMock.mockResolvedValue(12);

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.mouseEnter(await screen.findByTestId('now-overlay-idle-pill'));
    fireEvent.click(await screen.findByRole('button', { name: '先补测试' }));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith('task-1', {
        mode: 'countdown',
        minutes: 33,
      });
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });
    expect(calculateSpentMinutesMock).toHaveBeenCalledWith('task-1');
    expect(screen.getAllByText('先补测试').length).toBeGreaterThanOrEqual(1);
  });

  it('renders idle_with_tasks as collapsed task bubble and expands on hover（任务态默认收起并在悬停时展开）', async () => {
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-1',
        title: '写周报',
        status: 'pending',
        priority: 'high',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 10, 0),
      },
      {
        id: 'task-2',
        title: '修 bug',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 20, 0),
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    expect(await screen.findByTestId('now-overlay-idle-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('now-overlay-task-choice-list')).toBeNull();
    expect(screen.queryByTestId('new-now-input-row')).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId('now-overlay-idle-pill'));

    await waitFor(() => {
      expect(screen.getByTestId('now-overlay-idle-expanded')).toBeInTheDocument();
      expect(screen.getByTestId('now-overlay-task-choice-list')).toBeInTheDocument();
      expect(screen.getByTestId('new-now-input-row')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '写周报' })).toBeInTheDocument();
    });
    expect(overlaySetSizeMock).toHaveBeenCalled();
  });

  it('shows task count and ellipsis in collapsed idle bubble when there are more than three tasks（最小待办窗在任务过多时显示总数与省略提示）', async () => {
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-1',
        title: '写周报',
        status: 'pending',
        priority: 'high',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 10, 0),
      },
      {
        id: 'task-2',
        title: '修 bug',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 5, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 20, 0),
      },
      {
        id: 'task-3',
        title: '整理输入',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 8, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 22, 0),
      },
      {
        id: 'task-4',
        title: '补最后一项',
        status: 'pending',
        priority: 'low',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 12, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 24, 0),
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    expect(await screen.findByTestId('now-overlay-idle-pill')).toBeInTheDocument();
    expect(screen.getByText('待办 (4)')).toBeInTheDocument();
    expect(screen.getByText(/· ……/)).toBeInTheDocument();
  });

  it('keeps idle task panel expanded while input is focused（任务态输入获焦时锁定展开）', async () => {
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-1',
        title: '写周报',
        status: 'pending',
        priority: 'high',
        dependsOn: [],
        tags: [],
        createdAt: Date.UTC(2026, 2, 11, 8, 0, 0),
        updatedAt: Date.UTC(2026, 2, 11, 8, 10, 0),
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.mouseEnter(await screen.findByTestId('now-overlay-idle-pill'));

    const expanded = await screen.findByTestId('now-overlay-idle-expanded');
    const input = screen.getByTestId('new-now-input-textarea');
    fireEvent.focus(input);
    fireEvent.mouseLeave(expanded);

    await waitFor(() => {
      expect(screen.getByTestId('now-overlay-idle-expanded')).toBeInTheDocument();
    });
  });

  it('writes input into event log service（输入区继续写入事件日志）', async () => {
    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    fireEvent.mouseEnter(await screen.findByTestId('now-overlay-idle-pill'));
    fireEvent.click(await screen.findByRole('button', { name: '发送模拟输入' }));

    await waitFor(() => {
      expect(addEventMock).toHaveBeenCalledWith('补一条当下记录');
    });
  });

  it('submits overlay feedback dialog with Enter and shows compact shortcut hint（悬浮窗反馈弹窗支持回车提交且展示紧凑提示）', async () => {
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-feedback',
      name: '结束反馈测试',
      mode: 'countup',
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 0,
      paused: false,
      phase: 'feedback_in_progress',
      actionEndedAt: Date.UTC(2026, 2, 11, 9, 30, 0),
      feedbackStartedAt: Date.UTC(2026, 2, 11, 9, 30, 0),
    };

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    const textarea = await screen.findByTestId('now-overlay-feedback-textarea');
    expect(screen.getByTestId('now-overlay-feedback-surface')).toBeInTheDocument();
    expect(screen.getByTestId('now-overlay-feedback-shortcut-hint')).toHaveTextContent('Ctrl+Enter 提交 · Enter / Shift+Enter 换行');
    expect(screen.getByTestId('now-overlay-feedback-confirm')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '悬浮窗反馈提交' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('悬浮窗反馈提交');
    });
  });

  it('submits multi-task outcomes from overlay feedback dialog（悬浮窗反馈弹窗会提交多任务后续状态）', async () => {
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-feedback-multi',
      name: '结束反馈多任务测试',
      mode: 'countup',
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 0,
      paused: false,
      phase: 'feedback_in_progress',
      actionEndedAt: Date.UTC(2026, 2, 11, 9, 30, 0),
      feedbackStartedAt: Date.UTC(2026, 2, 11, 9, 30, 0),
      taskIds: ['task-a', 'task-b'],
    };
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-a',
        title: '任务 A',
        status: 'in_progress',
      },
      {
        id: 'task-b',
        title: '任务 B',
        status: 'in_progress',
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    const textarea = await screen.findByTestId('now-overlay-feedback-textarea');
    expect(await screen.findByTestId('task-dag-end-dialog-task-task-a')).toBeInTheDocument();
    expect(await screen.findByTestId('task-dag-end-dialog-task-task-b')).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId('feedback-task-status-completed')[0]!);
    fireEvent.click(screen.getAllByTestId('feedback-task-status-cancelled')[1]!);
    fireEvent.change(textarea, { target: { value: '多任务反馈提交' } });
    fireEvent.click(screen.getByTestId('now-overlay-feedback-confirm'));

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('多任务反馈提交', {
        taskStatusOutcomes: {
          'task-a': 'completed',
          'task-b': 'cancelled',
        },
        taskTitles: {
          'task-a': '任务 A',
          'task-b': '任务 B',
        },
      });
    });

    expect(onBlockEndForTasksMock).toHaveBeenCalledWith(['task-a', 'task-b'], 'block-feedback-multi');
    expect(transitionTaskMock).toHaveBeenCalledWith('task-a', 'completed');
    expect(transitionTaskMock).toHaveBeenCalledWith('task-b', 'cancelled');
  });

  it('submits suspended when overlay keeps the displayed default status（issue-735 悬浮窗提交默认值必须与显示默认值一致）', async () => {
    runtimeStateByUser['overlay-test-user'].activeBlock = {
      startId: 'block-feedback-default',
      name: '结束反馈默认终态测试',
      mode: 'countup',
      startTime: Date.UTC(2026, 2, 11, 9, 0, 0),
      elapsed: 0,
      paused: false,
      phase: 'feedback_in_progress',
      actionEndedAt: Date.UTC(2026, 2, 11, 9, 30, 0),
      feedbackStartedAt: Date.UTC(2026, 2, 11, 9, 30, 0),
      taskIds: ['task-default'],
    };
    runtimeStateByUser['overlay-test-user'].tasks = [
      {
        id: 'task-default',
        title: '默认挂起任务',
        status: 'in_progress',
      },
    ];

    const { NowWorkbenchOverlayPage } = await import('@/pages/NowWorkbenchOverlayPage');
    render(<NowWorkbenchOverlayPage />);

    const textarea = await screen.findByTestId('now-overlay-feedback-textarea');
    const suspendedOption = await screen.findByTestId('feedback-task-status-suspended');
    expect(suspendedOption).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(textarea, { target: { value: '悬浮窗保持默认状态提交' } });
    fireEvent.click(screen.getByTestId('now-overlay-feedback-confirm'));

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('悬浮窗保持默认状态提交', {
        taskStatusOutcomes: {
          'task-default': 'suspended',
        },
        taskTitles: {
          'task-default': '默认挂起任务',
        },
      });
    });
  });

  it('refreshes against the latest current user context after prewarm（预热窗口后刷新会重新读取当前用户）', { timeout: 30000 }, async () => {
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

    await waitFor(() => {
      expect(getEventStorageByUserMock).toHaveBeenCalledWith('overlay-test-user');
      expect(focusChangedListener).not.toBeNull();
    });

    currentUserState.userId = 'profile-live';
    await act(async () => {
      focusChangedListener?.({ payload: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getEventStorageByUserMock).toHaveBeenCalledWith('profile-live');
    });
  });
});
