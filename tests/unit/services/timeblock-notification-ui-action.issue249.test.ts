import { describe, expect, it, vi } from 'vitest';
import { applyTimeBlockNotificationActionToWidget } from '@/lib/services/timeblock-notification-ui-action';

function createWidget(state: 'idle' | 'running' | 'paused' | 'ended') {
  return {
    expandAndFocusTaskName: vi.fn(),
    getTimerState: vi.fn(() => state),
    pauseOrResume: vi.fn().mockResolvedValue(undefined),
    endDialog: vi.fn(),
  };
}

describe('timeblock notification ui action issue-249（通知动作到控件行为映射）', () => {
  it('expands task input on start action（start -> 展开并聚焦输入）', async () => {
    const widget = createWidget('idle');
    await applyTimeBlockNotificationActionToWidget('start', widget);
    expect(widget.expandAndFocusTaskName).toHaveBeenCalledTimes(1);
  });

  it('pauses only when current timer is running（pause 只在运行态触发）', async () => {
    const runningWidget = createWidget('running');
    await applyTimeBlockNotificationActionToWidget('pause', runningWidget);
    expect(runningWidget.pauseOrResume).toHaveBeenCalledTimes(1);

    const pausedWidget = createWidget('paused');
    await applyTimeBlockNotificationActionToWidget('pause', pausedWidget);
    expect(pausedWidget.pauseOrResume).not.toHaveBeenCalled();
  });

  it('resumes only when current timer is paused（resume 只在暂停态触发）', async () => {
    const pausedWidget = createWidget('paused');
    await applyTimeBlockNotificationActionToWidget('resume', pausedWidget);
    expect(pausedWidget.pauseOrResume).toHaveBeenCalledTimes(1);

    const runningWidget = createWidget('running');
    await applyTimeBlockNotificationActionToWidget('resume', runningWidget);
    expect(runningWidget.pauseOrResume).not.toHaveBeenCalled();
  });

  it('opens end dialog only in active states（end 仅在运行/暂停态触发反馈流程）', async () => {
    const runningWidget = createWidget('running');
    await applyTimeBlockNotificationActionToWidget('end', runningWidget);
    expect(runningWidget.endDialog).toHaveBeenCalledTimes(1);

    const pausedWidget = createWidget('paused');
    await applyTimeBlockNotificationActionToWidget('end', pausedWidget);
    expect(pausedWidget.endDialog).toHaveBeenCalledTimes(1);

    const idleWidget = createWidget('idle');
    await applyTimeBlockNotificationActionToWidget('end', idleWidget);
    expect(idleWidget.endDialog).not.toHaveBeenCalled();

    const endedWidget = createWidget('ended');
    await applyTimeBlockNotificationActionToWidget('end', endedWidget);
    expect(endedWidget.endDialog).not.toHaveBeenCalled();
  });
});
