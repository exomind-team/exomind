import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { NowInputRow } from '@/ui/app/components/NowInputRow';
import { FocusTimerWidget, type FocusTimerWidgetHandle } from '@/ui/app/components/FocusTimerWidget';
import { resolveCountdownEndTimeDisplay } from '@/lib/timeblock/expected-end-time';
import { resolveCountdownTiming } from '@/lib/timeblock/countdown-progress';
import { setNowWorkbenchOverlayPosition } from '@/config/now-workbench-overlay-preferences';
import type { TaskNode } from '@/lib/types/task';
import type { NowWorkbenchOverlayModel } from '@/ui/app/overlay/now-workbench-overlay-model';
import type { ActiveBlockData } from '@/lib/types/event';
import { useNowWorkbenchOverlayController } from '@/ui/app/overlay/use-now-workbench-overlay-controller';
import { useRef } from 'react';

interface NowWorkbenchOverlayPageProps {
  model?: NowWorkbenchOverlayModel;
  onHide?: () => void;
  onReturnToMain?: () => void;
  onPauseOrResume?: () => void;
  onEndBlock?: () => void | Promise<void>;
  onStartTask?: (task: TaskNode) => void;
  onSend?: (content: string) => void;
}

interface NowWorkbenchOverlayPageContentProps {
  model: NowWorkbenchOverlayModel;
  debugInfo: {
    userId: string;
    mode: string;
    taskCount: number;
    eventCount: number;
    activeBlockName: string;
    latestEventContent: string;
    lastReloadAt: string;
    lastAction: string;
  };
  onHide: () => void;
  onReturnToMain: () => void;
  onPauseOrResume: () => void;
  onEndBlock: () => void | Promise<void>;
  onStartTask: (task: TaskNode) => void;
  onSend: (content: string) => void;
  feedbackOpen: boolean;
  feedback: string;
  setFeedback(value: string): void;
  onConfirmEnd: () => void | Promise<void>;
}

const NOW_WORKBENCH_OVERLAY_DEFAULT_SIZE = { width: 412, height: 490 };
const NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE = { width: 464, height: 470 };
const NOW_WORKBENCH_OVERLAY_MINI_SIZE = { width: 248, height: 120 };
const NOW_WORKBENCH_OVERLAY_MINI_PEEK_SIZE = { width: 352, height: 200 };
const NOW_WORKBENCH_OVERLAY_IDLE_COLLAPSED_SIZE = { width: 276, height: 156 };
const NOW_WORKBENCH_OVERLAY_IDLE_EXPANDED_SIZE = { width: 428, height: 360 };

function formatEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatClock(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function resolveCountupElapsedMs(block: ActiveBlockData, now: number): number {
  if (typeof block.accumulatedRunMs === 'number') {
    const runningSliceMs = (!block.paused && !block.actionEndedAt)
      ? Math.max(0, now - (block.lastResumedAt ?? now))
      : 0;
    return Math.max(0, block.accumulatedRunMs + runningSliceMs);
  }

  const effectiveNow = block.actionEndedAt ?? now;
  const basePausedMs = Math.max(0, block.pauseAccumulatedMs ?? 0);
  const pausedSliceMs = block.paused && typeof block.pausedAt === 'number'
    ? Math.max(0, effectiveNow - block.pausedAt)
    : 0;
  return Math.max(0, effectiveNow - block.startTime - basePausedMs - pausedSliceMs);
}

function resolveRunningClock(activeBlock: ActiveBlockData | null, now: number): {
  primaryText: string;
  secondaryText: string | null;
} {
  if (!activeBlock) {
    return {
      primaryText: '--:--',
      secondaryText: null,
    };
  }

  if (activeBlock.mode === 'countdown') {
    const timing = resolveCountdownTiming(activeBlock, now);
    return {
      primaryText: timing
        ? (timing.overrunMs > 0 ? `+${formatClock(timing.overrunMs)}` : formatClock(timing.remainingMs))
        : '--:--',
      secondaryText: resolveCountdownEndTimeDisplay({ block: activeBlock, now })?.text ?? null,
    };
  }

  return {
    primaryText: formatClock(resolveCountupElapsedMs(activeBlock, now)),
    secondaryText: activeBlock.paused ? '已暂停，等待继续' : '累计专注时长',
  };
}

function renderRunningCard(props: Pick<NowWorkbenchOverlayPageContentProps, 'model' | 'onPauseOrResume' | 'onEndBlock'> & {
  now: number;
}): JSX.Element {
  const { model, onPauseOrResume, onEndBlock, now } = props;
  const activeBlock = model.activeBlock;
  const clock = resolveRunningClock(activeBlock, now);
  const isPaused = Boolean(activeBlock?.paused || activeBlock?.phase === 'paused');
  const isFeedbackStage = Boolean(
    activeBlock
    && (
      activeBlock.phase === 'feedback_in_progress'
      || activeBlock.phase === 'action_ended'
      || activeBlock.actionEndedAt
      || activeBlock.feedbackStartedAt
    )
  );

  return (
    <section
      data-testid="now-overlay-running-card"
      className="rounded-[24px] border border-white/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.76)_0%,rgba(255,255,255,0.52)_100%)] px-5 py-4 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.45)] backdrop-blur-[24px] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.72)_0%,rgba(28,25,23,0.48)_100%)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[19px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
            {model.title}
          </p>
          <p className="mt-1 text-[12px] text-[#8C7D78] dark:text-[#A8A29E]">
            {model.statusLabel}
          </p>
        </div>
        <div className="rounded-full bg-[#FEF0ED] px-3 py-1 text-[11px] font-medium text-[#C75B3A] dark:bg-[#2A1510] dark:text-[#E8734E]">
          当前时间块
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            data-testid="now-overlay-clock"
            className="font-mono text-[34px] leading-none tracking-[2px] text-[#1C1917] dark:text-[#FAFAF9]"
          >
            {clock.primaryText}
          </p>
          {clock.secondaryText ? (
            <p className="mt-2 text-[12px] text-[#8C7D78] dark:text-[#A8A29E]">
              {clock.secondaryText}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onPauseOrResume}
            disabled={isFeedbackStage}
            className="rounded-[12px] bg-[#F5F0ED] text-[#1C1917] hover:bg-[#EDE6E1] dark:bg-[#292524] dark:text-[#FAFAF9] dark:hover:bg-[#3A3632]"
          >
            {isPaused ? '继续' : '暂停'}
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={onEndBlock}
            className="rounded-[12px] bg-[#C75B3A] text-white hover:bg-[#B24D2F]"
          >
            {isFeedbackStage ? '填写反馈' : '结束'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function renderTaskChoiceList(props: Pick<NowWorkbenchOverlayPageContentProps, 'model' | 'onStartTask'>): JSX.Element {
  const { model, onStartTask } = props;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[#57534E] dark:text-[#D6D3D1]">可开始的任务</h2>
        <span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">从这里进入时间块</span>
      </div>
      <div data-testid="now-overlay-task-choice-list" className="grid gap-2">
        {model.visibleTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            aria-label={task.title}
            onClick={() => onStartTask?.(task)}
            className="flex w-full items-center justify-between rounded-[18px] border border-[#E7E5E4] bg-white/85 px-4 py-3 text-left shadow-sm transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917]/85 dark:hover:bg-[#292524]"
          >
            <span className="truncate text-[14px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</span>
            <span className="ml-3 shrink-0 text-[11px] text-[#A8A29E] dark:text-[#78716C]">开始</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function renderEmptyState(): JSX.Element {
  return (
    <section
      data-testid="now-overlay-empty-state"
      className="rounded-[20px] border border-dashed border-[#E7E5E4] bg-white/60 px-4 py-5 text-center dark:border-[#292524] dark:bg-[#1C1917]/50"
    >
      <p className="text-[14px] font-medium text-[#57534E] dark:text-[#D6D3D1]">当前没有可直接开始的任务</p>
      <p className="mt-1 text-[12px] text-[#A8A29E] dark:text-[#78716C]">你仍然可以直接记录当下输入，稍后再进入时间块。</p>
    </section>
  );
}

export function NowWorkbenchOverlayPage(props: NowWorkbenchOverlayPageProps) {
  if (props.model) {
    return (
      <NowWorkbenchOverlayPageContent
        model={props.model}
        onHide={props.onHide ?? (() => {})}
        onReturnToMain={props.onReturnToMain ?? (() => {})}
        onPauseOrResume={props.onPauseOrResume ?? (() => {})}
        onEndBlock={props.onEndBlock ?? (() => {})}
        onStartTask={props.onStartTask ?? (() => {})}
        onSend={props.onSend ?? (() => {})}
        debugInfo={{
          userId: 'static-preview',
          mode: props.model.mode,
          taskCount: props.model.visibleTasks.length,
          eventCount: props.model.recentEvents.length,
          activeBlockName: props.model.activeBlock?.name ?? '',
          latestEventContent: props.model.recentEvents[0]?.content ?? '',
          lastReloadAt: '',
          lastAction: 'static-preview',
        }}
        feedbackOpen={false}
        feedback=""
        setFeedback={() => {}}
        onConfirmEnd={() => {}}
      />
    );
  }

  const controller = useNowWorkbenchOverlayController();
  const onHide = props.onHide ?? (() => {
    void controller.handleHide();
  });
  const onReturnToMain = props.onReturnToMain ?? (() => {
    void controller.handleReturnToMain();
  });
  const onPauseOrResume = props.onPauseOrResume ?? (() => {
    void controller.handlePauseOrResume();
  });
  const onEndBlock = props.onEndBlock ?? (() => {
    void controller.handleOpenEndDialog();
  });
  const onStartTask = props.onStartTask ?? ((task: TaskNode) => {
    void controller.handleStartTask(task);
  });
  const onSend = props.onSend ?? ((content: string) => {
    void controller.handleSend(content);
  });

  return (
    <NowWorkbenchOverlayPageContent
      model={controller.model}
      onHide={onHide}
      onReturnToMain={onReturnToMain}
      onPauseOrResume={onPauseOrResume}
      onEndBlock={onEndBlock}
      onStartTask={onStartTask}
      onSend={onSend}
      debugInfo={controller.debugInfo}
      feedbackOpen={controller.feedbackOpen}
      feedback={controller.feedback}
      setFeedback={controller.setFeedback}
      onConfirmEnd={() => {
        void controller.handleConfirmEnd();
      }}
    />
  );
}

function NowWorkbenchOverlayPageContent(props: NowWorkbenchOverlayPageContentProps) {
  const {
    model,
    debugInfo,
    onHide,
    onReturnToMain,
    onPauseOrResume,
    onEndBlock,
    onStartTask,
    onSend,
    feedbackOpen,
    feedback,
    setFeedback,
    onConfirmEnd,
  } = props;
  const now = Date.now();
  const focusTimerWidgetRef = useRef<FocusTimerWidgetHandle | null>(null);
  const [isMiniCollapsed, setIsMiniCollapsed] = useState(false);
  const [isMiniHovered, setIsMiniHovered] = useState(false);
  const [isIdleHovered, setIsIdleHovered] = useState(false);
  const [isIdleInputFocused, setIsIdleInputFocused] = useState(false);
  const [isIdleConfigVisible, setIsIdleConfigVisible] = useState(false);
  const [pendingIdleTaskTitle, setPendingIdleTaskTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWindow().onMoved((event) => {
      if (disposed) {
        return;
      }
      const position = event.payload;
      setNowWorkbenchOverlayPosition({
        x: position.x,
        y: position.y,
      });
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (model.mode !== 'running') {
      setIsMiniCollapsed(false);
      setIsMiniHovered(false);
    }
  }, [model.mode]);

  useEffect(() => {
    if (!isMiniCollapsed) {
      setIsMiniHovered(false);
    }
  }, [isMiniCollapsed]);

  useEffect(() => {
    if (model.mode === 'idle_with_tasks' || model.mode === 'idle_input_only') {
      return;
    }
    setIsIdleHovered(false);
    setIsIdleInputFocused(false);
    setIsIdleConfigVisible(false);
    setPendingIdleTaskTitle(null);
  }, [model.mode]);

  useEffect(() => {
    if (!isIdleConfigVisible || !pendingIdleTaskTitle || !focusTimerWidgetRef.current) {
      return;
    }

    focusTimerWidgetRef.current.openTaskConfig(pendingIdleTaskTitle);
    setPendingIdleTaskTitle(null);
  }, [isIdleConfigVisible, pendingIdleTaskTitle]);

  const handleDragBarMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!isTauri() || event.button !== 0) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('button, input, textarea, [role="button"], [data-no-overlay-drag="true"]')) {
      return;
    }

    void getCurrentWindow().startDragging().catch((error) => {
      console.warn('[NowWorkbenchOverlay] startDragging failed', error);
    });
  }, []);

  const isStaticPreview = props.feedbackOpen === false
    && props.feedback === ''
    && props.debugInfo.userId === 'static-preview';
  const isLiveRunningSingleCardMode = !isStaticPreview && model.mode === 'running';
  const isLiveRunningMiniMode = isLiveRunningSingleCardMode && isMiniCollapsed;
  const isLiveRunningMiniPeekMode = isLiveRunningMiniMode && isMiniHovered;
  const isLiveIdleBubbleMode = !isStaticPreview
    && (model.mode === 'idle_with_tasks' || model.mode === 'idle_input_only');
  const isIdleExpanded = isLiveIdleBubbleMode
    && (isIdleHovered || isIdleInputFocused || isIdleConfigVisible);
  const miniClock = resolveRunningClock(model.activeBlock, now);
  const targetOverlaySize = isLiveRunningMiniPeekMode
    ? NOW_WORKBENCH_OVERLAY_MINI_PEEK_SIZE
    : isLiveRunningMiniMode
      ? NOW_WORKBENCH_OVERLAY_MINI_SIZE
      : isIdleExpanded
        ? NOW_WORKBENCH_OVERLAY_IDLE_EXPANDED_SIZE
        : isLiveIdleBubbleMode
          ? NOW_WORKBENCH_OVERLAY_IDLE_COLLAPSED_SIZE
      : isLiveRunningSingleCardMode
        ? NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE
        : NOW_WORKBENCH_OVERLAY_DEFAULT_SIZE;

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    void getCurrentWindow()
      .setSize(new LogicalSize(targetOverlaySize.width, targetOverlaySize.height))
      .catch((error) => {
        console.warn('[NowWorkbenchOverlay] setSize failed', error);
      });
  }, [targetOverlaySize.height, targetOverlaySize.width]);

  const handleOverlayFeedbackKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    if (event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void onConfirmEnd();
  }, [onConfirmEnd]);
  const feedbackDialog = (
    <Dialog open={feedbackOpen} onOpenChange={() => {}}>
      <DialogContent
        data-testid="now-overlay-feedback-surface"
        className="w-[min(320px,calc(100vw-24px))] max-w-[320px] rounded-[20px] border border-white/55 bg-[linear-gradient(180deg,rgba(250,247,245,0.96)_0%,rgba(255,255,255,0.84)_100%)] p-0 shadow-[0_24px_56px_-32px_rgba(0,0,0,0.55)] backdrop-blur-[24px] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.94)_0%,rgba(12,10,9,0.86)_100%)]"
      >
        <div className="space-y-3 px-4 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-[15px]">结束专注并记录反馈</DialogTitle>
            <DialogDescription className="text-[12px] text-[#78716C] dark:text-[#A8A29E]">
              悬浮窗内可直接提交反馈，无需切回主程序。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            data-testid="now-overlay-feedback-textarea"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={handleOverlayFeedbackKeyDown}
            placeholder="记录本次专注的反馈..."
            className="min-h-[88px] rounded-[14px] border-[#E7E5E4] bg-white/80 resize-none text-[13px] dark:border-[#FFFFFF18] dark:bg-[#FFFFFF08] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
          />
          <div
            data-testid="now-overlay-feedback-shortcut-hint"
            className="text-[11px] text-[#78716C] dark:text-[#A8A29E]"
          >
            Enter / Ctrl+Enter 提交 · Shift+Enter 换行
          </div>
          <Button
            type="button"
            data-testid="now-overlay-feedback-confirm"
            className="h-10 w-full rounded-[12px] bg-[#C75B3A] text-white hover:bg-[#B24D2F]"
            onClick={onConfirmEnd}
          >
            提交反馈
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const handleIdleExpandedFocusCapture = useCallback(() => {
    setIsIdleInputFocused(true);
  }, []);

  const handleIdleExpandedBlurCapture = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsIdleInputFocused(false);
  }, []);

  const handleIdleTaskStart = useCallback((task: TaskNode) => {
    setIsIdleConfigVisible(true);
    setPendingIdleTaskTitle(task.title);
    onStartTask(task);
  }, [onStartTask]);

  const handleIdleCollapse = useCallback(() => {
    setIsIdleHovered(false);
    setIsIdleInputFocused(false);
    setIsIdleConfigVisible(false);
    setPendingIdleTaskTitle(null);
  }, []);

  if (isLiveRunningMiniMode) {
    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--mini">
        <div className="now-workbench-overlay-shell now-workbench-overlay-shell--mini">
          <div
            data-testid="now-overlay-collapsed-pill"
            onMouseEnter={() => setIsMiniHovered(true)}
            onMouseLeave={() => setIsMiniHovered(false)}
            className={`rounded-[22px] border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9] shadow-[0_16px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-[20px] ${
              isLiveRunningMiniPeekMode
                ? 'w-[328px] px-4 py-3'
                : 'w-[224px] px-3 py-2'
            }`}
          >
            {isLiveRunningMiniPeekMode ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div
                    data-testid="now-overlay-drag-handle"
                    data-tauri-drag-region
                    onMouseDown={handleDragBarMouseDown}
                    className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                    title="按住这里拖动窗口"
                  >
                    <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6D3D1]" data-tauri-drag-region>
                      {model.statusLabel}
                    </p>
                    <p className="truncate text-[14px] font-semibold text-[#FAFAF9]" data-tauri-drag-region>
                      {model.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsMiniCollapsed(false)}
                      aria-label="展开"
                      title="展开"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                    >
                      <ChevronUp size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onReturnToMain}
                      aria-label="显示主程序"
                      title="显示主程序"
                      className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                    >
                      <ArrowUpRight size={16} />
                    </Button>
                  </div>
                </div>
                <p
                  data-testid="now-overlay-collapsed-clock"
                  className="font-mono text-[34px] leading-none tracking-[0.08em] text-[#FDE4DE]"
                >
                  {miniClock.primaryText}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onPauseOrResume}
                    className="h-9 rounded-[12px] bg-white/10 px-4 text-[#FAFAF9] hover:bg-white/15"
                  >
                    {model.activeBlock?.paused ? '继续' : '暂停'}
                  </Button>
                  <Button
                    type="button"
                    variant="brand"
                    onClick={onEndBlock}
                    className="h-9 rounded-[12px] bg-[#C75B3A] px-4 text-white hover:bg-[#B24D2F]"
                  >
                    结束
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div
                  data-testid="now-overlay-drag-handle"
                  data-tauri-drag-region
                  onMouseDown={handleDragBarMouseDown}
                  className="min-w-0 flex-1 cursor-grab select-none active:cursor-grabbing"
                  title="按住这里拖动窗口"
                >
                  <p className="font-mono text-[28px] leading-none tracking-[0.08em] text-[#FDE4DE]" data-testid="now-overlay-collapsed-clock" data-tauri-drag-region>
                    {miniClock.primaryText}
                  </p>
                  <p className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#D6D3D1]" data-tauri-drag-region>
                    {model.statusLabel}
                  </p>
                  <p className="truncate text-[12px] text-[#FAFAF9]/85" data-tauri-drag-region>
                    {model.title}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 flex-col items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMiniCollapsed(false)}
                    aria-label="展开"
                    title="展开"
                    className="h-7 w-7 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                  >
                    <ChevronUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onReturnToMain}
                    aria-label="显示主程序"
                    title="显示主程序"
                    className="h-7 w-7 rounded-[10px] border border-white/10 bg-white/10 p-0 text-[#FAFAF9] hover:bg-white/15"
                  >
                    <ArrowUpRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {feedbackDialog}
        <style>{overlayStyles}</style>
      </div>
    );
  }

  if (isLiveIdleBubbleMode) {
    const previewTasks = model.visibleTasks.slice(0, 3);

    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--mini">
        <div className="now-workbench-overlay-shell now-workbench-overlay-shell--mini">
          {isIdleExpanded ? (
            <div
              data-testid="now-overlay-idle-expanded"
              onMouseEnter={() => setIsIdleHovered(true)}
              onMouseLeave={() => setIsIdleHovered(false)}
              onFocusCapture={handleIdleExpandedFocusCapture}
              onBlurCapture={handleIdleExpandedBlurCapture}
              className="w-[396px] rounded-[24px] border border-white/55 bg-[rgba(250,247,245,0.94)] px-4 py-4 text-[#1C1917] shadow-[0_20px_48px_-28px_rgba(0,0,0,0.45)] backdrop-blur-[24px] dark:border-white/10 dark:bg-[rgba(28,25,23,0.9)] dark:text-[#FAFAF9]"
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  data-testid="now-overlay-drag-handle"
                  data-tauri-drag-region
                  onMouseDown={handleDragBarMouseDown}
                  className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                  title="按住这里拖动窗口"
                >
                  <div className="flex items-center gap-2" data-tauri-drag-region>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#A8A29E]" data-tauri-drag-region />
                    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#78716C] dark:text-[#A8A29E]" data-tauri-drag-region>
                      待办
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[16px] font-semibold" data-tauri-drag-region>
                    {model.mode === 'idle_with_tasks' ? '接下来做什么？' : '现在先记点什么'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleIdleCollapse}
                    aria-label="收起"
                    title="收起"
                    className="h-8 w-8 rounded-[10px] border border-black/5 bg-white/60 p-0 text-[#57534E] hover:bg-[#F5F0ED] dark:border-white/10 dark:bg-white/10 dark:text-[#D6D3D1] dark:hover:bg-white/15"
                  >
                    <ChevronDown size={15} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onReturnToMain}
                    aria-label="显示主程序"
                    title="显示主程序"
                    className="h-8 w-8 rounded-[10px] border border-black/5 bg-white/60 p-0 text-[#57534E] hover:bg-[#F5F0ED] dark:border-white/10 dark:bg-white/10 dark:text-[#D6D3D1] dark:hover:bg-white/15"
                  >
                    <ArrowUpRight size={15} />
                  </Button>
                </div>
              </div>

              {model.mode === 'idle_with_tasks' && !isIdleConfigVisible ? (
                <div className="mt-4 space-y-3">
                  <div data-testid="now-overlay-task-choice-list" className="grid gap-2">
                    {model.visibleTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        aria-label={task.title}
                        onClick={() => handleIdleTaskStart(task)}
                        className="flex w-full items-center justify-between rounded-[16px] border border-[#E7E5E4] bg-white/78 px-4 py-3 text-left shadow-sm transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917]/78 dark:hover:bg-[#292524]"
                      >
                        <span className="truncate text-[14px] font-medium">{task.title}</span>
                        <span className="ml-3 shrink-0 text-[11px] text-[#A8A29E] dark:text-[#78716C]">开始</span>
                      </button>
                    ))}
                  </div>
                  <section className="overflow-hidden rounded-[18px] border border-[#E7E5E4] bg-white/82 dark:border-[#292524] dark:bg-[#1C1917]/72">
                    <NowInputRow onSend={onSend} placeholder="记录当下的事实..." />
                  </section>
                </div>
              ) : null}

              {model.mode === 'idle_input_only' ? (
                <div className="mt-4 space-y-3">
                  <section
                    data-testid="now-overlay-empty-state"
                    className="rounded-[18px] border border-dashed border-[#E7E5E4] bg-white/65 px-4 py-4 text-center dark:border-[#292524] dark:bg-[#1C1917]/60"
                  >
                    <p className="text-[14px] font-medium text-[#57534E] dark:text-[#D6D3D1]">当前没有可直接开始的任务</p>
                    <p className="mt-1 text-[12px] text-[#A8A29E] dark:text-[#78716C]">先记一条输入，或者稍后再开始时间块。</p>
                  </section>
                  <section className="overflow-hidden rounded-[18px] border border-[#E7E5E4] bg-white/82 dark:border-[#292524] dark:bg-[#1C1917]/72">
                    <NowInputRow onSend={onSend} placeholder="记录当下的事实..." />
                  </section>
                </div>
              ) : null}

              {isIdleConfigVisible ? (
                <div className="mt-4 rounded-[18px] border border-[#E7E5E4] bg-white/72 px-2 py-2 dark:border-[#292524] dark:bg-[#1C1917]/68">
                  <FocusTimerWidget ref={focusTimerWidgetRef} surface="overlay" />
                </div>
              ) : null}
            </div>
          ) : (
            <div
              data-testid="now-overlay-idle-pill"
              onMouseEnter={() => setIsIdleHovered(true)}
              className="w-[252px] rounded-[22px] border border-white/55 bg-[rgba(250,247,245,0.92)] px-4 py-3 text-[#1C1917] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.45)] backdrop-blur-[22px] dark:border-white/10 dark:bg-[rgba(28,25,23,0.86)] dark:text-[#FAFAF9]"
            >
              <div
                data-testid="now-overlay-drag-handle"
                data-tauri-drag-region
                onMouseDown={handleDragBarMouseDown}
                className="cursor-grab select-none active:cursor-grabbing"
                title="按住这里拖动窗口"
              >
                <div className="flex items-center gap-2" data-tauri-drag-region>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#A8A29E]" data-tauri-drag-region />
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#78716C] dark:text-[#A8A29E]" data-tauri-drag-region>
                    待办
                  </span>
                </div>
                {previewTasks.length > 0 ? (
                  <div className="mt-2 space-y-1" data-tauri-drag-region>
                    {previewTasks.map((task) => (
                      <p key={task.id} className="truncate text-[13px] font-medium" data-tauri-drag-region>
                        · {task.title}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[13px] font-medium text-[#78716C] dark:text-[#A8A29E]" data-tauri-drag-region>
                    · 无待办
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {feedbackDialog}
        <style>{overlayStyles}</style>
      </div>
    );
  }

  if (isLiveRunningSingleCardMode) {
    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--single-card">
        <div className="now-workbench-overlay-shell now-workbench-overlay-shell--single-card">
          <header
            data-testid="now-overlay-drag-bar"
            className="absolute left-1/2 top-0 z-10 w-full -translate-x-1/2 px-2"
          >
            <div
              data-testid="now-overlay-live-control-bar"
              className="flex items-center gap-3 rounded-[22px] border border-white/55 bg-white/72 px-3 py-2 text-[#1C1917] shadow-[0_12px_30px_-18px_rgba(0,0,0,0.45)] backdrop-blur-[18px] dark:border-white/10 dark:bg-[rgba(28,25,23,0.72)] dark:text-[#FAFAF9]"
            >
              <div
                data-testid="now-overlay-drag-handle"
                data-tauri-drag-region
                onMouseDown={handleDragBarMouseDown}
                className="min-w-0 cursor-grab select-none active:cursor-grabbing"
                title="按住这里拖动窗口"
              >
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#A8A29E] dark:text-[#78716C]" data-tauri-drag-region>
                  {model.statusLabel}
                </p>
                <p className="truncate text-[14px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]" data-tauri-drag-region>
                  {model.title}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMiniCollapsed(true)}
                  aria-label="收起"
                  title="收起"
                  className="h-8 w-8 rounded-[10px] border border-white/35 bg-white/45 p-0 text-[#57534E] hover:bg-[#F5F0ED] dark:border-white/10 dark:bg-white/10 dark:text-[#D6D3D1] dark:hover:bg-white/15"
                >
                  <ChevronDown size={15} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onReturnToMain}
                  aria-label="显示主程序"
                  title="显示主程序"
                  className="h-8 w-8 rounded-[10px] border border-white/35 bg-white/45 p-0 text-[#57534E] hover:bg-[#F5F0ED] dark:border-white/10 dark:bg-white/10 dark:text-[#D6D3D1] dark:hover:bg-white/15"
                >
                  <ArrowUpRight size={15} />
                </Button>
              </div>
            </div>
          </header>

          <main className="flex min-h-0 flex-1 items-center justify-center">
            <div
              data-testid="now-overlay-single-card-stage"
              className="w-full max-w-[390px]"
            >
              <FocusTimerWidget ref={focusTimerWidgetRef} surface="overlay" />
            </div>
          </main>
        </div>

        {feedbackDialog}
        <style>{overlayStyles}</style>
      </div>
    );
  }

  return (
    <div className="now-workbench-overlay-root">
      <div className="now-workbench-overlay-shell rounded-[28px] border border-white/55 bg-[linear-gradient(180deg,rgba(250,247,245,0.95)_0%,rgba(255,255,255,0.78)_100%)] p-4 text-[#1C1917] shadow-[0_24px_56px_-32px_rgba(0,0,0,0.55)] backdrop-blur-[26px] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.92)_0%,rgba(12,10,9,0.82)_100%)] dark:text-[#FAFAF9]">
        <header
          data-testid="now-overlay-drag-bar"
          className="flex items-center justify-between gap-3 rounded-[18px] bg-white/65 px-3 py-2 dark:bg-white/5"
        >
          <div
            data-testid="now-overlay-drag-handle"
            data-tauri-drag-region
            onMouseDown={handleDragBarMouseDown}
            className="min-w-0 cursor-grab select-none rounded-[14px] px-1.5 py-1 active:cursor-grabbing hover:bg-[#F5F0ED]/80 dark:hover:bg-white/10"
            title="按住这里拖动窗口"
          >
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[#A8A29E] dark:text-[#78716C]" data-tauri-drag-region>
              {model.statusLabel}
            </p>
            <p className="truncate text-[15px] font-semibold" data-tauri-drag-region>{model.title}</p>
            <p className="mt-0.5 text-[11px] text-[#A8A29E] dark:text-[#78716C]" data-tauri-drag-region>
              拖动窗口
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onHide}
              className="rounded-[10px] text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#D6D3D1] dark:hover:bg-white/10"
            >
              隐藏浮窗
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReturnToMain}
              aria-label="显示主程序"
              title="显示主程序"
              className="h-8 w-8 rounded-[10px] p-0 text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#D6D3D1] dark:hover:bg-white/10"
            >
              <ArrowUpRight size={16} />
            </Button>
          </div>
        </header>

        <main
          data-testid="now-overlay-scroll-region"
          className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
        >
          {isStaticPreview
            ? (
              model.mode === 'running'
                ? renderRunningCard({
                  ...props,
                  model,
                  onPauseOrResume,
                  onEndBlock,
                  now,
                })
                : model.mode === 'idle_with_tasks'
                  ? renderTaskChoiceList({
                    ...props,
                    model,
                    onStartTask,
                  })
                  : renderEmptyState()
            )
            : (
              <>
                {model.mode !== 'running' && model.visibleTasks.length > 0 ? (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-[13px] font-semibold text-[#57534E] dark:text-[#D6D3D1]">可开始的任务</h2>
                      <span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">点任务后进入和当下一致的配置流</span>
                    </div>
                    <div data-testid="now-overlay-task-choice-list" className="grid gap-2">
                      {model.visibleTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          aria-label={task.title}
                          onClick={() => {
                            focusTimerWidgetRef.current?.openTaskConfig(task.title);
                            onStartTask(task);
                          }}
                          className="flex w-full items-center justify-between rounded-[18px] border border-[#E7E5E4] bg-white/85 px-4 py-3 text-left shadow-sm transition-colors hover:bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917]/85 dark:hover:bg-[#292524]"
                        >
                          <span className="truncate text-[14px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</span>
                          <span className="ml-3 shrink-0 text-[11px] text-[#A8A29E] dark:text-[#78716C]">开始</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="rounded-[20px] border border-[#E7E5E4] bg-white/70 px-2 py-2 dark:border-[#292524] dark:bg-[#1C1917]/65">
                  <FocusTimerWidget ref={focusTimerWidgetRef} />
                </section>
              </>
            )}

          <section className="rounded-[20px] border border-[#E7E5E4] bg-white/70 px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]/65">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-[#57534E] dark:text-[#D6D3D1]">最近事件</h2>
              <span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">仅显示最新两条</span>
            </div>
            <div className="space-y-2">
              {model.recentEvents.length > 0 ? model.recentEvents.map((event) => (
                <div
                  key={event.id}
                  data-testid="now-overlay-recent-event"
                  className="flex items-start justify-between gap-3 rounded-[14px] bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]"
                >
                  <p className="line-clamp-2 text-[13px] text-[#44403C] dark:text-[#E7E5E4]">{event.content}</p>
                  <span className="shrink-0 text-[11px] text-[#A8A29E] dark:text-[#78716C]">
                    {formatEventTime(event.timestamp)}
                  </span>
                </div>
              )) : (
                <div
                  data-testid="now-overlay-recent-event"
                  className="rounded-[14px] bg-[#FAF7F5] px-3 py-2 text-[12px] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
                >
                  暂无最近事件
                </div>
              )}
            </div>
          </section>

          <section
            data-testid="now-overlay-debug-panel"
            className="rounded-[20px] border border-dashed border-[#E7E5E4] bg-white/55 px-4 py-3 text-[11px] text-[#78716C] dark:border-[#3F3F46] dark:bg-[#1C1917]/55 dark:text-[#A8A29E]"
          >
            <div className="mb-2 font-semibold text-[#57534E] dark:text-[#D6D3D1]">调试信息</div>
            <div>用户：{debugInfo.userId}</div>
            <div>模式：{debugInfo.mode}</div>
            <div>任务数：{debugInfo.taskCount}</div>
            <div>事件数：{debugInfo.eventCount}</div>
            <div>当前块：{debugInfo.activeBlockName || '无'}</div>
            <div>最近事件：{debugInfo.latestEventContent || '无'}</div>
            <div>最近刷新：{debugInfo.lastReloadAt || '未刷新'}</div>
            <div>最近动作：{debugInfo.lastAction}</div>
          </section>

          <section className="overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white/75 dark:border-[#292524] dark:bg-[#1C1917]/70">
            <NowInputRow onSend={onSend} placeholder="记录当下的事实..." />
          </section>
        </main>
      </div>
      {feedbackDialog}
      <style>{overlayStyles}</style>
    </div>
  );
}

const overlayStyles = /* css */ `
  html, body, #root {
    width: 100%;
    height: 100%;
  }

  body {
    margin: 0;
    background: transparent !important;
    overflow: hidden;
  }

  .now-workbench-overlay-root {
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    padding: 10px;
    box-sizing: border-box;
  }

  .now-workbench-overlay-shell {
    width: min(392px, calc(100vw - 20px));
    height: calc(100vh - 20px);
    max-height: calc(100vh - 20px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .now-workbench-overlay-root--single-card {
    padding: 12px;
  }

  .now-workbench-overlay-shell--single-card {
    position: relative;
    width: min(440px, calc(100vw - 24px));
    height: auto;
    max-height: none;
    min-height: 240px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: visible;
    padding-top: 44px;
  }

  .now-workbench-overlay-root--mini {
    padding: 12px;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .now-workbench-overlay-shell--mini {
    width: auto;
    height: auto;
    max-height: none;
    min-height: 0;
    overflow: visible;
  }
`;
