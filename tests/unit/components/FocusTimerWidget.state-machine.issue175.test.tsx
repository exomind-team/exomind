import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';

const loadActiveBlockMock = vi.fn();
const startBlockMock = vi.fn();
const pauseBlockMock = vi.fn();
const resumeBlockMock = vi.fn();
const endBlockMock = vi.fn();
const markEndingMock = vi.fn();
const updateElapsedMock = vi.fn();
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
  }),
}));

describe('FocusTimerWidget state machine（新专注计时组件状态机）', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    cleanup();
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
});
