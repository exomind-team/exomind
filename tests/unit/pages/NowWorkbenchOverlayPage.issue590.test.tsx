import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NowWorkbenchOverlayPage } from '@/pages/NowWorkbenchOverlayPage';
import type { ActiveBlockData } from '@/lib/types/event';

const controllerState = {
  model: {
    mode: 'running' as const,
    title: '悬浮窗专注',
    statusLabel: '待反馈',
    activeBlock: null as ActiveBlockData | null,
    visibleTasks: [],
    recentEvents: [],
  },
  feedbackOpen: true,
  feedback: '',
  taskStatusChoice: 'continue' as const,
  debugInfo: {
    userId: 'overlay-user',
    mode: 'running',
    taskCount: 0,
    eventCount: 0,
    activeBlockName: '悬浮窗专注',
    latestEventContent: '',
    lastReloadAt: '',
    lastAction: 'test',
  },
  setFeedback: vi.fn(),
  setTaskStatusChoice: vi.fn(),
  handleHide: vi.fn(),
  handleReturnToMain: vi.fn(),
  handlePauseOrResume: vi.fn(),
  handleOpenEndDialog: vi.fn(),
  handleConfirmEnd: vi.fn(),
  handleStartTask: vi.fn(),
  handleSend: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setSize: vi.fn(),
    onMoved: vi.fn(async () => () => {}),
  }),
}));

vi.mock('@/ui/app/components/NowInputRow', () => ({
  NowInputRow: () => <div data-testid="overlay-now-input-row" />,
}));

vi.mock('@/ui/app/components/FocusTimerWidget', () => ({
  FocusTimerWidget: React.forwardRef(() => <div data-testid="overlay-focus-widget" />),
}));

vi.mock('@/ui/app/overlay/use-now-workbench-overlay-controller', () => ({
  useNowWorkbenchOverlayController: () => controllerState,
}));

function makeActiveBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  return {
    startId: 'block-1',
    name: '悬浮窗专注',
    mode: 'countup',
    elapsed: 3 * 60 * 1000,
    startTime: Date.now() - 3 * 60 * 1000,
    paused: false,
    taskIds: ['task-1'],
    taskAssociationLog: [],
    ...overrides,
  };
}

describe('NowWorkbenchOverlayPage issue #590', () => {
  beforeEach(() => {
    controllerState.feedbackOpen = true;
    controllerState.feedback = '';
    controllerState.taskStatusChoice = 'continue';
    controllerState.model = {
      mode: 'running',
      title: '悬浮窗专注',
      statusLabel: '待反馈',
      activeBlock: makeActiveBlock(),
      visibleTasks: [],
      recentEvents: [],
    };
    controllerState.setFeedback.mockReset();
    controllerState.setTaskStatusChoice.mockReset();
    controllerState.handleConfirmEnd.mockReset();
  });

  it('shows the task status selector when the active block only stores taskIds（仅有 taskIds 时仍展示任务状态选择器）', async () => {
    render(<NowWorkbenchOverlayPage />);

    expect(await screen.findByTestId('feedback-task-status-section')).toBeInTheDocument();
  });
});
