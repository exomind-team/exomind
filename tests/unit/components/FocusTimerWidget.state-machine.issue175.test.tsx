import React, { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setInputSendMode } from '@/config/input-send-mode';
import { BlockTaskAssociationList } from '@/ui/app/components/BlockTaskAssociationList';
import { FocusTimerWidget, type FocusTimerWidgetHandle } from '@/ui/app/components/FocusTimerWidget';

function formatMinuteLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const loadActiveBlockMock = vi.fn();
const startBlockMock = vi.fn();
const pauseBlockMock = vi.fn();
const resumeBlockMock = vi.fn();
const endBlockMock = vi.fn();
const markEndingMock = vi.fn();
const updateElapsedMock = vi.fn();
const onBlockChangeMock = vi.fn(() => () => {});
const startSyncMock = vi.fn().mockResolvedValue(undefined);
const stopSyncMock = vi.fn().mockResolvedValue(undefined);
const getTaskMock = vi.fn();
const listTasksMock = vi.fn();
const onTaskChangeMock = vi.fn(() => () => {});
const transitionTaskMock = vi.fn();
const addTaskToBlockMock = vi.fn();
const removeTaskToBlockMock = vi.fn();
const onBlockEndForTasksMock = vi.fn();
const appendEventDataMock = vi.fn();
let onBlockChangeHandler: ((block: unknown) => void) | null = null;
let originalRequestAnimationFrame: typeof globalThis.requestAnimationFrame | undefined;
let originalCancelAnimationFrame: typeof globalThis.cancelAnimationFrame | undefined;

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    startBlock: startBlockMock,
    pauseBlock: pauseBlockMock,
    resumeBlock: resumeBlockMock,
    endBlock: endBlockMock,
    markEnding: markEndingMock,
    updateElapsed: updateElapsedMock,
    onBlockChange: onBlockChangeMock,
    startSync: startSyncMock,
    stopSync: stopSyncMock,
  }),
  getTaskService: () => ({
    getTask: getTaskMock,
    listTasks: listTasksMock,
    onTaskChange: onTaskChangeMock,
    transitionTask: transitionTaskMock,
  }),
  getTaskTimerService: () => ({
    addTaskToBlock: addTaskToBlockMock,
    removeTaskFromBlock: removeTaskToBlockMock,
    onBlockEndForTasks: onBlockEndForTasksMock,
  }),
  getEventLogService: () => ({
    appendEventData: appendEventDataMock,
  }),
}));

describe('FocusTimerWidget state machine（新专注计时组件状态机）', () => {
  beforeEach(() => {
    setInputSendMode('ctrl-enter-send');
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn(() => 1) as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn() as unknown as typeof globalThis.cancelAnimationFrame;

    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '设计系统重构',
      startTime: Date.now(),
      elapsed: 25 * 60 * 1000,
      mode: 'countdown',
      paused: false,
      targetMinutes: 25,
    });
    pauseBlockMock.mockResolvedValue(undefined);
    resumeBlockMock.mockResolvedValue(undefined);
    endBlockMock.mockResolvedValue(null);
    markEndingMock.mockResolvedValue(undefined);
    updateElapsedMock.mockResolvedValue(undefined);
    getTaskMock.mockReset();
    listTasksMock.mockReset();
    onTaskChangeMock.mockReset();
    transitionTaskMock.mockReset();
    addTaskToBlockMock.mockReset();
    removeTaskToBlockMock.mockReset();
    onBlockEndForTasksMock.mockReset();
    appendEventDataMock.mockReset();
    getTaskMock.mockResolvedValue(null);
    listTasksMock.mockResolvedValue([]);
    onTaskChangeMock.mockImplementation(() => () => {});
    transitionTaskMock.mockResolvedValue(null);
    addTaskToBlockMock.mockResolvedValue(undefined);
    removeTaskToBlockMock.mockResolvedValue(undefined);
    onBlockEndForTasksMock.mockResolvedValue(undefined);
    appendEventDataMock.mockResolvedValue(undefined);
    onBlockChangeHandler = null;
    onBlockChangeMock.mockReset();
    onBlockChangeMock.mockImplementation((handler: (block: unknown) => void) => {
      onBlockChangeHandler = handler;
      return () => {
        if (onBlockChangeHandler === handler) {
          onBlockChangeHandler = null;
        }
      };
    });
    startSyncMock.mockReset();
    stopSyncMock.mockReset();
    startSyncMock.mockResolvedValue(undefined);
    stopSyncMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('transitions idle -> config -> running（状态切换）', async () => {
    render(<FocusTimerWidget />);

    expect(screen.getByTestId('new-focus-state-idle')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    expect(screen.getByTestId('new-focus-state-config')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '设计系统重构' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalledWith(
        '设计系统重构',
        expect.objectContaining({ mode: 'countdown', minutes: 25 }),
        undefined,
      );
    });

    expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
  });

  it('starts block via Ctrl+Enter on task input（任务输入框 Ctrl+Enter 快速开始）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    const taskInput = screen.getByTestId('new-focus-task-input');
    fireEvent.change(taskInput, {
      target: { value: '快捷键开始任务' },
    });

    fireEvent.keyDown(taskInput, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalledWith(
        '快捷键开始任务',
        expect.objectContaining({ mode: 'countdown', minutes: 25 }),
        undefined,
      );
    });

    expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
  });

  it('splits multiline task input into title + description on start（多行任务名拆分标题与描述）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    const taskInput = screen.getByTestId('new-focus-task-input');
    fireEvent.change(taskInput, {
      target: { value: '专注主任务\n补充描述第一行\n补充描述第二行' },
    });
    fireEvent.keyDown(taskInput, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalledWith(
        '专注主任务',
        expect.objectContaining({ mode: 'countdown', minutes: 25 }),
        '补充描述第一行\n补充描述第二行',
      );
    });
  });

  it('does not start block on plain Enter in task input（普通回车不触发开始）', () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    const taskInput = screen.getByTestId('new-focus-task-input');
    fireEvent.change(taskInput, {
      target: { value: '仅回车不开始' },
    });
    fireEvent.keyDown(taskInput, { key: 'Enter', code: 'Enter' });

    expect(startBlockMock).not.toHaveBeenCalled();
  });

  it('supports config -> idle collapse and keeps draft values（配置收起并保留草稿）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    expect(screen.getByTestId('new-focus-state-config')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '保留草稿任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-expected-45'));

    fireEvent.click(screen.getByTestId('new-focus-config-collapse-button'));
    expect(screen.getByTestId('new-focus-state-idle')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    expect(screen.getByDisplayValue('保留草稿任务')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalledWith(
        '保留草稿任务',
        expect.objectContaining({ mode: 'countdown', minutes: 45 }),
        undefined,
      );
    });
  });

  it('uses adaptive config layout for countup switch（正计时切换时配置布局自适应）', () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));

    const configContainer = screen.getByTestId('new-focus-state-config');
    const glowNode = configContainer.querySelector("div[aria-hidden='true']");
    expect(configContainer.className).not.toContain('h-[253px]');
    expect(glowNode?.className).not.toContain('h-[227px]');

    expect(screen.getByText('预期时长')).toBeInTheDocument();
    expect(screen.queryByText('计时模式')).toBeNull();
    expect(screen.queryByText('倒计时时长')).toBeNull();
    fireEvent.click(screen.getByTestId('new-focus-expected-countup'));

    expect(configContainer.className).toContain('pb-3');
    expect(glowNode?.className).toContain('bottom-[10px]');
  });

  it('adds a11y attrs and forbids collapse from running（可访问性与运行态禁收起）', async () => {
    render(<FocusTimerWidget />);

    const idleCard = screen.getByTestId('new-focus-idle-card');
    expect(idleCard).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(idleCard);
    expect(screen.getByTestId('new-focus-config-collapse-button')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '运行态检查' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('new-focus-config-collapse-button')).toBeNull();
  });

  it('supports custom countdown input（支持自定义倒计时输入）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '自定义时长任务' },
    });

    fireEvent.click(screen.getByTestId('new-focus-expected-custom-trigger'));
    const customInput = screen.getByTestId('new-focus-expected-custom-input');
    fireEvent.change(customInput, { target: { value: '37' } });
    fireEvent.blur(customInput);
    expect(screen.getByTestId('new-focus-expected-custom-trigger')).toHaveTextContent('37m');

    fireEvent.click(screen.getByTestId('new-focus-start-button'));
    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalledWith(
        '自定义时长任务',
        expect.objectContaining({ mode: 'countdown', minutes: 37 }),
        undefined,
      );
    });
  });

  it('switches custom trigger to input while editing（自定义编辑态切换为输入框）', () => {
    render(<FocusTimerWidget />);
    fireEvent.click(screen.getByTestId('new-focus-idle-card'));

    const trigger = screen.getByTestId('new-focus-expected-custom-trigger');
    fireEvent.click(trigger);

    expect(screen.getByTestId('new-focus-expected-custom-input')).toBeInTheDocument();
    expect(screen.queryByTestId('new-focus-expected-custom-trigger')).toBeNull();
  });

  it('shows red glow and removes right chevron in running countup mode（正计时运行态显示红色背景并移除右箭头）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.click(screen.getByTestId('new-focus-expected-countup'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '正计时任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalledWith(
        '正计时任务',
        expect.objectContaining({ mode: 'countup', minutes: undefined }),
        undefined,
      );
    });

    const runningSection = screen.getByTestId('new-focus-state-running');
    const glowNode = runningSection.querySelector("div[aria-hidden='true'][class*='from-[#EDADA0]']");
    const chevronNode = runningSection.querySelector("[data-lucide='chevron-down']");
    expect(glowNode).not.toBeNull();
    expect(chevronNode).toBeNull();
  });

  it('renders unified expected-time options row（统一预期时间选择器）', () => {
    render(<FocusTimerWidget />);
    fireEvent.click(screen.getByTestId('new-focus-idle-card'));

    expect(screen.getByTestId('new-focus-expected-countup')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-expected-15')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-expected-25')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-expected-45')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-expected-custom-trigger')).toBeInTheDocument();
  });

  it('slides active indicator across expected-time options（预期时间滑块随选项横向滑动）', () => {
    render(<FocusTimerWidget />);
    fireEvent.click(screen.getByTestId('new-focus-idle-card'));

    const indicator = screen.getByTestId('new-focus-expected-active-indicator');
    expect(indicator).toHaveStyle({ transform: 'translateX(200%)' }); // 默认 countdown 25m

    fireEvent.click(screen.getByTestId('new-focus-expected-countup'));
    expect(indicator).toHaveStyle({ transform: 'translateX(0%)' });

    fireEvent.click(screen.getByTestId('new-focus-expected-45'));
    expect(indicator).toHaveStyle({ transform: 'translateX(300%)' });

    fireEvent.click(screen.getByTestId('new-focus-expected-custom-trigger'));
    const customInput = screen.getByTestId('new-focus-expected-custom-input');
    fireEvent.change(customInput, { target: { value: '37' } });
    fireEvent.blur(customInput);
    expect(indicator).toHaveStyle({ transform: 'translateX(400%)' });
  });

  it('keeps timer and controls inside one running task card（运行态计时与控制整合在同一卡片）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '运行态整合结构' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    const runningCard = screen.getByTestId('new-focus-running-task-card');
    expect(runningCard).toContainElement(screen.getByTestId('new-focus-running-clock'));
    expect(runningCard).toContainElement(screen.getByTestId('new-focus-pause-resume-button'));
    expect(runningCard).toContainElement(screen.getByTestId('new-focus-end-button'));
  });

  it('supports prefilling a task from external launcher and opening config（支持外部任务入口预填并打开配置）', async () => {
    const ref = createRef<FocusTimerWidgetHandle>();
    render(<FocusTimerWidget ref={ref} />);

    await act(async () => {
      ref.current?.openTaskConfig('来自悬浮窗的任务');
    });

    expect(screen.getByTestId('new-focus-state-config')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-task-input')).toHaveValue('来自悬浮窗的任务');
  });

  it('preselects pending or in-progress linked tasks before start', async () => {
    const ref = createRef<FocusTimerWidgetHandle>();
    listTasksMock.mockResolvedValue([
      { id: 'task-1', title: '待办任务', status: 'pending' },
      { id: 'task-2', title: '进行中任务', status: 'in_progress' },
      { id: 'task-3', title: '已完成任务', status: 'completed' },
    ]);

    render(<FocusTimerWidget ref={ref} />);

    await act(async () => {
      ref.current?.openTaskConfig({
        title: '来自悬浮窗的任务',
        preselectedTaskIds: ['task-2'],
      });
    });

    expect(screen.getByTestId('new-focus-task-input')).toHaveValue('来自悬浮窗的任务');
    expect(screen.getByTestId('new-focus-prestart-task-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('new-focus-prestart-task-task-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('new-focus-prestart-task-task-3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith('task-2');
    });
  });

  it('restores countdown overtime after remount（倒计时超时在重载后可恢复）', async () => {
    const now = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    loadActiveBlockMock.mockResolvedValueOnce({
      startId: 'block-overrun',
      name: '超时任务',
      startTime: now - 90_000,
      elapsed: 0,
      mode: 'countdown',
      targetMinutes: 1,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 90_000,
      lastResumedAt: now,
      pauseAccumulatedMs: 0,
    });

    render(<FocusTimerWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    expect(screen.getByTestId('new-focus-running-clock').textContent).toMatch(/^\+00:3\d$/);
    expect(screen.getByTestId('new-focus-end-time')).toHaveTextContent(`已于 ${formatMinuteLabel(now - 30_000)} 到点`);
    dateNowSpy.mockRestore();
  });

  it('shows expected end time while countdown is active（倒计时运行中展示预计结束时间）', async () => {
    const now = Date.UTC(2026, 1, 11, 8, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    loadActiveBlockMock.mockResolvedValueOnce({
      startId: 'block-expected-end',
      name: '预计结束任务',
      startTime: now - 5 * 60 * 1000,
      elapsed: 20 * 60 * 1000,
      mode: 'countdown',
      targetMinutes: 25,
      paused: false,
      phase: 'running',
      accumulatedRunMs: 5 * 60 * 1000,
      lastResumedAt: now,
      pauseAccumulatedMs: 0,
    });

    render(<FocusTimerWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    const endTime = screen.getByTestId('new-focus-end-time');
    expect(endTime).toHaveTextContent(`预计 ${formatMinuteLabel(now + 20 * 60 * 1000)} 结束`);
    dateNowSpy.mockRestore();
  });

  it('confirms feedback end with Ctrl+Enter（反馈弹窗 Ctrl+Enter 确认结束）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '反馈快捷键任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    const feedback = await screen.findByTestId('new-focus-feedback-textarea');
    fireEvent.change(feedback, { target: { value: '记录反馈' } });
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('记录反馈');
    });
    await waitFor(() => expect(screen.queryByTestId('new-focus-feedback-textarea')).toBeNull());
  });

  it('still requires Ctrl+Enter to confirm feedback in enter-send mode（反馈弹窗在 Enter 模式下仍需 Ctrl+Enter 确认结束）', async () => {
    setInputSendMode('enter-send');
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '反馈 Enter 模式任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    const feedback = await screen.findByTestId('new-focus-feedback-textarea');
    fireEvent.change(feedback, { target: { value: 'Enter 提交反馈' } });
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter' });

    expect(endBlockMock).not.toHaveBeenCalled();

    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('Enter 提交反馈');
    });
  });

  it('keeps task status transition when endBlock clears active block immediately（issue-374 结束瞬间清空活跃块仍更新任务状态）', async () => {
    const now = Date.now();
    loadActiveBlockMock.mockResolvedValueOnce({
      startId: 'block-task-1',
      name: '关联任务时间块',
      startTime: now - 10_000,
      elapsed: 10_000,
      mode: 'countup',
      paused: false,
      phase: 'running',
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [],
    });
    getTaskMock.mockImplementation(async (taskId: string) => ({
      id: taskId,
      title: taskId === 'task-1' ? '关联任务一' : '关联任务二',
      status: 'in_progress',
      priority: 'medium',
      dependsOn: [],
      tags: [],
      createdAt: now - 20_000,
      updatedAt: now - 5_000,
    }));
    endBlockMock.mockImplementation(async () => {
      onBlockChangeHandler?.(null);
      return null;
    });

    render(<FocusTimerWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
      expect(getTaskMock).toHaveBeenCalledWith('task-1');
      expect(getTaskMock).toHaveBeenCalledWith('task-2');
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    await screen.findByTestId('new-focus-feedback-textarea');
    await waitFor(() => {
      expect(screen.getAllByTestId('feedback-task-status-section')).toHaveLength(2);
      expect(screen.getByTestId('feedback-task-status-row-task-1')).toBeInTheDocument();
      expect(screen.getByTestId('feedback-task-status-row-task-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feedback-task-status-task-1-completed'));
    fireEvent.click(screen.getByTestId('feedback-task-status-task-2-cancelled'));
    fireEvent.change(screen.getByTestId('new-focus-feedback-textarea'), {
      target: { value: '结束并完成任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-feedback-confirm'));

    await waitFor(() => {
      expect(onBlockEndForTasksMock).toHaveBeenCalledWith(['task-1', 'task-2'], 'block-task-1');
      expect(transitionTaskMock).toHaveBeenCalledWith('task-1', 'completed');
      expect(transitionTaskMock).toHaveBeenCalledWith('task-2', 'cancelled');
    });
  });

  it('preserves selected task status when markEnding callback arrives late（issue-374 异步回调不应覆盖已选状态）', async () => {
    const now = Date.now();
    const runningBlock = {
      startId: 'block-task-async',
      name: '关联任务异步回调',
      startTime: now - 10_000,
      elapsed: 10_000,
      mode: 'countup' as const,
      paused: false,
      phase: 'running' as const,
      taskIds: ['task-async'],
      taskAssociationLog: [],
    };

    loadActiveBlockMock.mockResolvedValueOnce(runningBlock);
    getTaskMock.mockResolvedValue({
      id: 'task-async',
      title: '关联任务',
      status: 'in_progress',
      priority: 'medium',
      dependsOn: [],
      tags: [],
      createdAt: now - 20_000,
      updatedAt: now - 5_000,
    });

    let resolveMarkEnding: (() => void) | null = null;
    markEndingMock.mockImplementation(() => new Promise<void>((resolve) => {
      resolveMarkEnding = () => {
        onBlockChangeHandler?.({
          ...runningBlock,
          phase: 'feedback_in_progress',
          actionEndedAt: now,
          feedbackStartedAt: now,
        });
        resolve();
      };
    }));

    render(<FocusTimerWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
      expect(getTaskMock).toHaveBeenCalledWith('task-async');
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    await screen.findByTestId('new-focus-feedback-textarea');
    await waitFor(() => {
      expect(screen.getByTestId('feedback-task-status-section')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feedback-task-status-task-async-completed'));

    await act(async () => {
      resolveMarkEnding?.();
      await Promise.resolve();
    });

    fireEvent.change(screen.getByTestId('new-focus-feedback-textarea'), {
      target: { value: '异步回调后仍完成任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-feedback-confirm'));

    await waitFor(() => {
      expect(onBlockEndForTasksMock).toHaveBeenCalledWith(['task-async'], 'block-task-async');
      expect(transitionTaskMock).toHaveBeenCalledWith('task-async', 'completed');
    });
  });

  it('allows closing feedback dialog on Escape and reopening via end button（反馈弹窗可关闭且可再次拉起）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '反馈不可关闭任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    await screen.findByTestId('new-focus-feedback-textarea');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('new-focus-feedback-textarea')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    await screen.findByTestId('new-focus-feedback-textarea');
    expect(markEndingMock).toHaveBeenCalledTimes(1);
  });

  it('requires 5s calm-down confirmation before skipping empty feedback（空反馈需5秒冷静确认）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '跳过反馈任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    await screen.findByTestId('new-focus-feedback-textarea');
    const confirmButton = screen.getByTestId('new-focus-feedback-confirm');

    vi.useFakeTimers();
    fireEvent.click(confirmButton);

    expect(endBlockMock).not.toHaveBeenCalled();
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveTextContent('确认跳过反馈(5s)');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(confirmButton).toHaveTextContent('确认跳过反馈(4s)');

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(confirmButton).not.toBeDisabled();
    expect(confirmButton).toHaveTextContent('确认跳过反馈');

    fireEvent.click(confirmButton);

    vi.useRealTimers();
    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith(undefined);
    });
  });

  it('resets skip-confirm state when feedback content changes（反馈内容变化后重置确认状态）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '反馈变化重置任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    const feedback = await screen.findByTestId('new-focus-feedback-textarea');
    const confirmButton = screen.getByTestId('new-focus-feedback-confirm');

    vi.useFakeTimers();
    fireEvent.click(confirmButton);
    expect(confirmButton).toHaveTextContent('确认跳过反馈(5s)');
    expect(confirmButton).toBeDisabled();

    fireEvent.change(feedback, { target: { value: '补充内容' } });
    expect(confirmButton).toHaveTextContent('确认结束');
    expect(confirmButton).not.toBeDisabled();
    vi.useRealTimers();
  });

  it('keeps end button square icon during normal running state（普通运行态结束按钮保持停止图标）', async () => {
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '普通运行态图标校验任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    const endButton = screen.getByTestId('new-focus-end-button');
    expect(endButton.querySelector('.lucide-square')).not.toBeNull();
    expect(endButton.querySelector('.lucide-notepad-text')).toBeNull();
    expect(endButton).toHaveAttribute('aria-label', '结束（End）');
    expect(endButton).toHaveAttribute('title', '结束');
    expect(endButton.className).not.toContain('bg-brand');

    const pauseButton = screen.getByTestId('new-focus-pause-resume-button');
    expect(pauseButton.className).toContain('bg-warning');
    expect(pauseButton.className).toContain('text-white');
  });

  it('reopens feedback dialog when block is already in feedback stage（反馈中可重新拉起弹窗）', async () => {
    loadActiveBlockMock.mockResolvedValueOnce({
      startId: 'block-feedback',
      name: '反馈阶段任务',
      startTime: Date.now() - 5000,
      elapsed: 1000,
      mode: 'countup',
      paused: true,
      phase: 'feedback_in_progress',
      actionEndedAt: Date.now() - 1200,
      feedbackStartedAt: Date.now() - 1000,
    });

    render(<FocusTimerWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    const endButton = screen.getByTestId('new-focus-end-button');
    expect(endButton).not.toBeDisabled();
    const feedbackIcon = endButton.querySelector('.lucide-notepad-text');
    expect(feedbackIcon).not.toBeNull();
    expect(endButton.querySelector('.lucide-square')).toBeNull();
    expect(endButton).toHaveAttribute('aria-label', '反馈中（Feedback in progress）');
    expect(endButton).toHaveAttribute('title', '反馈中');
    expect(endButton.className).toContain('bg-brand');
    expect(feedbackIcon).toHaveClass('text-white');

    fireEvent.click(endButton);

    await screen.findByTestId('new-focus-feedback-textarea');
    expect(markEndingMock).not.toHaveBeenCalled();
  });

  it('prevents duplicate feedback submit while pending（反馈提交中防重复提交）', async () => {
    endBlockMock.mockImplementation(() => new Promise(() => {}));
    render(<FocusTimerWidget />);

    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), {
      target: { value: '提交防重任务' },
    });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => {
      expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('new-focus-end-button'));
    await screen.findByTestId('new-focus-feedback-textarea');
    fireEvent.change(screen.getByTestId('new-focus-feedback-textarea'), {
      target: { value: '提交中测试' },
    });
    fireEvent.click(screen.getByTestId('new-focus-feedback-confirm'));
    fireEvent.click(screen.getByTestId('new-focus-feedback-confirm'));

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledTimes(1);
    });
  });
});
