import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowUpRight, Expand, Shrink } from 'lucide-react';
import { useSignalStream } from '@/ui/hooks/useSignalStream';
import { Button } from '@/components/ui/button';
import { NowInputRow } from '@/ui/app/components/NowInputRow';
import { FocusTimerWidget, type FocusTimerWidgetHandle } from '@/ui/app/components/FocusTimerWidget';
import { TimeBlockFeedbackDialog } from '@/ui/app/components/TimeBlockFeedbackDialog';
import {
  resolveFeedbackSubmitLabel,
  useFeedbackSubmitControls,
} from '@/ui/app/components/useFeedbackSubmitControls';
import { resolveCountdownEndTimeDisplay } from '@/lib/timeblock/expected-end-time';
import { resolveCountdownTiming } from '@/lib/timeblock/countdown-progress';
import { setNowWorkbenchOverlayPosition } from '@/config/now-workbench-overlay-preferences';
import type { TaskNode } from '@/lib/types/task';
import type { NowWorkbenchOverlayModel } from '@/ui/app/overlay/now-workbench-overlay-model';
import type { ActiveBlockData } from '@/lib/types/event';
import { useNowWorkbenchOverlayController } from '@/ui/app/overlay/use-now-workbench-overlay-controller';
import type { TaskStatusChoice } from '@/ui/app/components/TaskStatusSelector';
import { PerfTrace } from '@/lib/utils/perf-trace';

interface NowWorkbenchOverlayPageProps {
  model?: NowWorkbenchOverlayModel;
  onHide?: () => void;
  onReturnToMain?: () => void;
  onPauseOrResume?: () => void;
  onEndBlock?: () => void | Promise<void>;
  onStartTask?: (task: TaskNode) => void;
  onSend?: (content: string, tags?: string[]) => void;
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
  onStartTask: (task: TaskNode) => void | Promise<void>;
  onSend: (content: string, tags?: string[]) => void;
  feedbackOpen: boolean;
  feedback: string;
  activeBlockTasks: TaskNode[];
  taskStatusChoices: Record<string, TaskStatusChoice>;
  setFeedback(value: string): void;
  setTaskStatusChoice(taskId: string, value: TaskStatusChoice): void;
  onConfirmEnd: () => void | Promise<void>;
}

const NOW_WORKBENCH_OVERLAY_DEFAULT_SIZE = { width: 412, height: 490 };
const NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE = { width: 390, height: 192 };
const NOW_WORKBENCH_OVERLAY_MINI_SIZE = { width: 248, height: 120 };
const NOW_WORKBENCH_OVERLAY_MINI_PEEK_SIZE = { width: 352, height: 200 };
const NOW_WORKBENCH_OVERLAY_IDLE_COLLAPSED_SIZE = { width: 276, height: 156 };
const NOW_WORKBENCH_OVERLAY_IDLE_EXPANDED_SIZE = { width: 428, height: 360 };
const ACTIVE_VISIBLE_SURFACE_CLASS = 'ring-1 ring-inset ring-[#FDE4DE]/60';
const VISIBLE_SURFACE_DRAG_GLOW_IDLE_MS = 180;

interface VisibleSurfaceMeasurement {
  key: string;
  width: number;
  height: number;
}

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
      className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(45,33,28,0.88)_0%,rgba(25,18,15,0.78)_100%)] px-5 py-4 text-[#F5EDE7] shadow-[0_16px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-[24px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[19px] font-semibold text-[#F5EDE7]">
            {model.title}
          </p>
          <p className="mt-1 text-[12px] text-[#D6C2B8]">
            {model.statusLabel}
          </p>
        </div>
        <div className="rounded-full bg-[#5B3B31] px-3 py-1 text-[11px] font-medium text-[#F6B08E]">
          当前时间块
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            data-testid="now-overlay-clock"
            className="font-mono text-[34px] leading-none tracking-[2px] text-[#F5EDE7]"
          >
            {clock.primaryText}
          </p>
          {clock.secondaryText ? (
            <p className="mt-2 text-[12px] text-[#D6C2B8]">
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
            className="rounded-[12px] bg-[#3F302A] text-[#F5EDE7] hover:bg-[#4B3932]"
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
        <span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">点任务后直接开始</span>
      </div>
      <div data-testid="now-overlay-task-choice-list" className="grid max-h-[220px] gap-2 overflow-y-auto pr-1">
        {model.visibleTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            aria-label={task.title}
            onClick={() => {
              void onStartTask?.(task);
            }}
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
        activeBlockTasks={[]}
        taskStatusChoices={{}}
        setFeedback={() => {}}
        setTaskStatusChoice={() => {}}
        onConfirmEnd={() => {}}
      />
    );
  }

  const controller = useNowWorkbenchOverlayController();
  // 订阅 RT SSE 信号流，接收时间块暂停等实时更新
  useSignalStream();
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
  const onSend = props.onSend ?? ((content: string, tags?: string[]) => {
    return controller.handleSend(content, tags);
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
      activeBlockTasks={controller.activeBlockTasks}
      taskStatusChoices={controller.taskStatusChoices}
      setFeedback={controller.setFeedback}
      setTaskStatusChoice={controller.setTaskStatusChoice}
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
    activeBlockTasks,
    taskStatusChoices,
    setFeedback,
    setTaskStatusChoice,
    onConfirmEnd,
  } = props;
  const now = Date.now();
  const focusTimerWidgetRef = useRef<FocusTimerWidgetHandle | null>(null);
  const recentEventsRef = useRef<HTMLElement | null>(null);
  const [isMiniCollapsed, setIsMiniCollapsed] = useState(false);
  const [isMiniHovered, setIsMiniHovered] = useState(false);
  const [isIdleHovered, setIsIdleHovered] = useState(false);
  const [isIdleInputFocused, setIsIdleInputFocused] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [visibleSurfaceElement, setVisibleSurfaceElement] = useState<HTMLElement | null>(null);
  const [visibleSurfaceMeasurement, setVisibleSurfaceMeasurement] = useState<VisibleSurfaceMeasurement | null>(null);
  const [isVisibleSurfacePressed, setIsVisibleSurfacePressed] = useState(false);
  const [isVisibleSurfaceDragging, setIsVisibleSurfaceDragging] = useState(false);
  const visibleSurfaceDragPendingRef = useRef(false);
  const visibleSurfaceDragGlowTimeoutRef = useRef<number | null>(null);
  const {
    canSubmitFeedback,
    handleFeedbackKeyDown,
    shortcutHint,
    isSkipFeedbackCoolingDown,
    resetSkipFeedbackConfirm,
    skipFeedbackConfirmState,
    skipFeedbackCountdownSec,
  } = useFeedbackSubmitControls({ submitMode: 'ctrl-enter-only' });

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
  }, [model.mode]);

  useEffect(() => {
    if (feedbackOpen) {
      resetSkipFeedbackConfirm();
      setFeedbackSubmitting(false);
      return;
    }

    resetSkipFeedbackConfirm();
    setFeedbackSubmitting(false);
  }, [feedbackOpen, resetSkipFeedbackConfirm]);

  // 新事件加入后自动滚到"最近事件"区域
  useEffect(() => {
    if (model.recentEvents.length > 0) {
      recentEventsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [model.recentEvents]);

  // Drag is handled natively by data-tauri-drag-region attributes.
  // Using startDragging() API simultaneously causes race conditions
  // (first click fails, second click sticks without mouse button held).

  const isStaticPreview = props.feedbackOpen === false
    && props.feedback === ''
    && props.debugInfo.userId === 'static-preview';
  const isLiveRunningSingleCardMode = !isStaticPreview && model.mode === 'running';
  const isLiveRunningMiniMode = isLiveRunningSingleCardMode && isMiniCollapsed;
  const isLiveRunningMiniPeekMode = isLiveRunningMiniMode && isMiniHovered;
  const isLiveIdleBubbleMode = !isStaticPreview
    && (model.mode === 'idle_with_tasks' || model.mode === 'idle_input_only');
  const isIdleExpanded = isLiveIdleBubbleMode
    && (isIdleHovered || isIdleInputFocused);
  const shouldMeasureIdleBubbleShell = isLiveIdleBubbleMode && Boolean(model.nudge);
  const visibleSurfaceMeasurementKey = isLiveRunningMiniPeekMode
    ? 'running-mini-peek'
    : isLiveRunningMiniMode
      ? 'running-mini'
      : isIdleExpanded
        ? shouldMeasureIdleBubbleShell
          ? 'idle-shell-expanded'
          : 'idle-expanded'
        : isLiveIdleBubbleMode
          ? shouldMeasureIdleBubbleShell
            ? 'idle-shell-collapsed'
            : 'idle-collapsed'
          : isLiveRunningSingleCardMode
            ? 'running-single-card'
            : 'default';
  const miniClock = resolveRunningClock(model.activeBlock, now);

  const clearVisibleSurfaceDragGlowTimeout = useCallback(() => {
    if (visibleSurfaceDragGlowTimeoutRef.current !== null) {
      window.clearTimeout(visibleSurfaceDragGlowTimeoutRef.current);
      visibleSurfaceDragGlowTimeoutRef.current = null;
    }
  }, []);

  const clearVisibleSurfaceInteraction = useCallback(() => {
    visibleSurfaceDragPendingRef.current = false;
    clearVisibleSurfaceDragGlowTimeout();
    setIsVisibleSurfacePressed(false);
    setIsVisibleSurfaceDragging(false);
  }, [clearVisibleSurfaceDragGlowTimeout]);

  const scheduleVisibleSurfaceDragGlowClear = useCallback(() => {
    clearVisibleSurfaceDragGlowTimeout();
    visibleSurfaceDragGlowTimeoutRef.current = window.setTimeout(() => {
      visibleSurfaceDragGlowTimeoutRef.current = null;
      visibleSurfaceDragPendingRef.current = false;
      setIsVisibleSurfacePressed(false);
      setIsVisibleSurfaceDragging(false);
    }, VISIBLE_SURFACE_DRAG_GLOW_IDLE_MS);
  }, [clearVisibleSurfaceDragGlowTimeout]);

  const handleVisibleSurfaceMount = useCallback((node: HTMLElement | null) => {
    setVisibleSurfaceElement(node);
  }, []);

  const handleVisibleSurfaceMouseDownCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    visibleSurfaceDragPendingRef.current = target instanceof Element
      && Boolean(target.closest('[data-tauri-drag-region]'));
    clearVisibleSurfaceDragGlowTimeout();
    setIsVisibleSurfaceDragging(false);
    setIsVisibleSurfacePressed(true);
  }, [clearVisibleSurfaceDragGlowTimeout]);

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
      if (visibleSurfaceDragPendingRef.current) {
        setIsVisibleSurfaceDragging(true);
        scheduleVisibleSurfaceDragGlowClear();
      }
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
      clearVisibleSurfaceDragGlowTimeout();
      unlisten?.();
    };
  }, [clearVisibleSurfaceDragGlowTimeout, scheduleVisibleSurfaceDragGlowClear]);

  useEffect(() => {
    if (!visibleSurfaceElement) {
      setVisibleSurfaceMeasurement(null);
      return;
    }

    let frameId: number | null = null;
    let observer: ResizeObserver | undefined;

    const measure = () => {
      const rect = visibleSurfaceElement.getBoundingClientRect();
      const nextWidth = Math.ceil(rect.width);
      const nextHeight = Math.ceil(rect.height);
      if (nextWidth > 0 && nextHeight > 0) {
        setVisibleSurfaceMeasurement((current) => (
          current
            && current.key === visibleSurfaceMeasurementKey
            && current.width === nextWidth
            && current.height === nextHeight
            ? current
            : { key: visibleSurfaceMeasurementKey, width: nextWidth, height: nextHeight }
        ));
      }
    };

    const scheduleMeasure = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        scheduleMeasure();
      });
      observer.observe(visibleSurfaceElement);
    }

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
    };
  }, [visibleSurfaceElement, visibleSurfaceMeasurementKey]);

  useEffect(() => {
    clearVisibleSurfaceInteraction();
  }, [clearVisibleSurfaceInteraction, visibleSurfaceElement]);

  useEffect(() => {
    if (!isVisibleSurfacePressed && !isVisibleSurfaceDragging) {
      return;
    }

    const clearInteraction = () => {
      clearVisibleSurfaceInteraction();
    };

    const handleWindowBlur = () => {
      if (visibleSurfaceDragPendingRef.current || isVisibleSurfaceDragging) {
        setIsVisibleSurfacePressed(false);
        setIsVisibleSurfaceDragging(true);
        scheduleVisibleSurfaceDragGlowClear();
        return;
      }

      clearVisibleSurfaceInteraction();
    };

    window.addEventListener('mouseup', clearInteraction);
    window.addEventListener('dragend', clearInteraction);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('mouseup', clearInteraction);
      window.removeEventListener('dragend', clearInteraction);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    clearVisibleSurfaceInteraction,
    isVisibleSurfaceDragging,
    isVisibleSurfacePressed,
    scheduleVisibleSurfaceDragGlowClear,
  ]);

  useEffect(() => clearVisibleSurfaceDragGlowTimeout, [clearVisibleSurfaceDragGlowTimeout]);

  const isVisibleSurfaceActive = isVisibleSurfacePressed || isVisibleSurfaceDragging;

  const fallbackOverlaySize = isLiveRunningMiniPeekMode
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
  const targetOverlaySize = !isStaticPreview
    && visibleSurfaceMeasurement?.key === visibleSurfaceMeasurementKey
    ? { width: visibleSurfaceMeasurement.width, height: visibleSurfaceMeasurement.height }
    : fallbackOverlaySize;

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const usingMeasuredSize = !isStaticPreview
      && visibleSurfaceMeasurement?.key === visibleSurfaceMeasurementKey;
    const trace = new PerfTrace('NowWorkbenchOverlay resizeSync', {
      mode: model.mode,
      visibleSurfaceMeasurementKey,
      isStaticPreview,
      targetWidth: targetOverlaySize.width,
      targetHeight: targetOverlaySize.height,
    });
    trace.step('measure-visible-surface', {
      measurementKey: visibleSurfaceMeasurement?.key ?? null,
      measuredWidth: visibleSurfaceMeasurement?.width ?? null,
      measuredHeight: visibleSurfaceMeasurement?.height ?? null,
    });
    trace.step('resolve-target-size', {
      usingMeasuredSize,
    });

    void getCurrentWindow()
      .setSize(new LogicalSize(targetOverlaySize.width, targetOverlaySize.height))
      .then(() => {
        trace.step('set-window-size');
        trace.finish();
      })
      .catch((error) => {
        trace.fail(error);
      });
  }, [
    isStaticPreview,
    model.mode,
    targetOverlaySize.height,
    targetOverlaySize.width,
    visibleSurfaceMeasurement?.height,
    visibleSurfaceMeasurement?.key,
    visibleSurfaceMeasurement?.width,
    visibleSurfaceMeasurementKey,
  ]);

  const handleOverlayConfirmEnd = useCallback(async () => {
    const trace = new PerfTrace('NowWorkbenchOverlay confirmEnd', {
      feedbackLength: feedback.trim().length,
      activeBlockTaskCount: activeBlockTasks.length,
      skipFeedbackConfirmState,
      submitDisabled: feedbackSubmitting || isSkipFeedbackCoolingDown,
    });
    if (feedbackSubmitting) {
      trace.finish({ result: 'skipped', reason: 'already-submitting' });
      return;
    }
    const canSubmit = canSubmitFeedback(feedback);
    trace.step('validate-feedback', { canSubmit });
    if (!canSubmit) {
      trace.finish({ result: 'skipped', reason: 'invalid-feedback' });
      return;
    }

    setFeedbackSubmitting(true);
    let submitted = false;
    try {
      await onConfirmEnd();
      submitted = true;
      trace.step('invoke-on-confirm-end');
    } catch (error) {
      trace.fail(error);
      throw error;
    } finally {
      setFeedbackSubmitting(false);
      trace.step('reset-submitting', { submitted });
      if (submitted) {
        trace.finish({ result: 'submitted' });
      }
    }
  }, [
    activeBlockTasks.length,
    canSubmitFeedback,
    feedback,
    feedbackSubmitting,
    isSkipFeedbackCoolingDown,
    onConfirmEnd,
    skipFeedbackConfirmState,
  ]);

  const feedbackDialog = (
    <TimeBlockFeedbackDialog
      open={feedbackOpen}
      onOpenChange={() => {}}
      title="结束专注并记录反馈"
      description="悬浮窗内可直接提交反馈，无需切回主程序。"
      feedback={feedback}
      onFeedbackChange={(value) => {
        resetSkipFeedbackConfirm();
        setFeedback(value);
      }}
      onFeedbackKeyDown={(event) => {
        handleFeedbackKeyDown(event, handleOverlayConfirmEnd, (nextValue) => {
          resetSkipFeedbackConfirm();
          setFeedback(nextValue);
        });
      }}
      feedbackPlaceholder="记录本次专注的反馈..."
      onSubmit={handleOverlayConfirmEnd}
      submitLabel={resolveFeedbackSubmitLabel({
        feedback,
        isSubmitting: feedbackSubmitting,
        skipConfirmState: skipFeedbackConfirmState,
        skipConfirmCountdownSec: skipFeedbackCountdownSec,
        defaultLabel: '提交反馈',
      })}
      dialogTestId="now-overlay-feedback-surface"
      feedbackTestId="now-overlay-feedback-textarea"
      submitTestId="now-overlay-feedback-confirm"
      textareaClassName="min-h-[88px] resize-none text-[13px] dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
      submitButtonClassName="h-10 w-full rounded-[12px] bg-[#C75B3A] text-white hover:bg-[#B24D2F] disabled:cursor-not-allowed disabled:opacity-60"
      submitDisabled={feedbackSubmitting || isSkipFeedbackCoolingDown}
      autoFocusFeedback
      tasks={activeBlockTasks}
      outcomes={taskStatusChoices}
      onOutcomeChange={setTaskStatusChoice}
      extraContent={(
        <div className="space-y-3">
          <div
            data-testid="now-overlay-feedback-shortcut-hint"
            className="text-[11px] text-[#78716C] dark:text-[#A8A29E]"
          >
            {shortcutHint}
          </div>
        </div>
      )}
    />
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
    void onStartTask(task);
  }, [onStartTask]);

  const handleIdleCollapse = useCallback(() => {
    setIsIdleHovered(false);
    setIsIdleInputFocused(false);
  }, []);

  if (isLiveRunningMiniMode) {
    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--mini">
        <div className="now-workbench-overlay-shell now-workbench-overlay-shell--mini">
          <div
            data-testid="now-overlay-collapsed-pill"
            onMouseEnter={() => setIsMiniHovered(true)}
            onMouseLeave={() => setIsMiniHovered(false)}
            ref={handleVisibleSurfaceMount}
            data-overlay-visible-surface="true"
            onMouseDownCapture={handleVisibleSurfaceMouseDownCapture}
            className={`rounded-[22px] border border-white/55 bg-[rgba(28,25,23,0.78)] text-[#FAFAF9] shadow-[0_16px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-[20px] ${
              isLiveRunningMiniPeekMode
                ? 'w-[328px] px-4 py-3'
                : 'w-[224px] px-3 py-2'
            } ${isVisibleSurfaceActive ? ACTIVE_VISIBLE_SURFACE_CLASS : ''}`}
          >
            {isLiveRunningMiniPeekMode ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div
                    data-testid="now-overlay-drag-handle"
                    data-tauri-drag-region

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
                      <Expand size={16} />
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
                    <Expand size={14} />
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
    const hasOverflowTasks = model.visibleTasks.length > previewTasks.length;

    return (
      <div className="now-workbench-overlay-root now-workbench-overlay-root--mini">
        <div
          ref={shouldMeasureIdleBubbleShell ? handleVisibleSurfaceMount : undefined}
          data-overlay-visible-surface={shouldMeasureIdleBubbleShell ? 'true' : undefined}
          className="now-workbench-overlay-shell now-workbench-overlay-shell--mini space-y-3"
        >
          {model.nudge ? (
            <section
              data-testid="now-overlay-ritual-nudge"
              className="w-[320px] rounded-[18px] border border-[#F0D8D0] bg-[#FFF6F3] px-4 py-3 text-[#7C2D12] shadow-[0_18px_36px_-28px_rgba(0,0,0,0.4)] backdrop-blur-[18px] dark:border-[#4A2C24] dark:bg-[#2A1712] dark:text-[#FED7AA]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{model.nudge.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#9A3412] dark:text-[#FCD9B6]">{model.nudge.body}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onReturnToMain}
                  className="shrink-0 rounded-[10px] border-[#E9B8A7] bg-white/75 text-[#9A3412] hover:bg-[#FFF1EB] dark:border-[#6B3F32] dark:bg-[#3A211A] dark:text-[#FED7AA] dark:hover:bg-[#4A2C24]"
                >
                  {model.nudge.ctaLabel}
                </Button>
              </div>
            </section>
          ) : null}

          {isIdleExpanded ? (
            <div
              data-testid="now-overlay-idle-expanded"
              onMouseEnter={() => setIsIdleHovered(true)}
              onMouseLeave={() => setIsIdleHovered(false)}
              onFocusCapture={handleIdleExpandedFocusCapture}
              onBlurCapture={handleIdleExpandedBlurCapture}
              ref={shouldMeasureIdleBubbleShell ? undefined : handleVisibleSurfaceMount}
              data-overlay-visible-surface={shouldMeasureIdleBubbleShell ? undefined : 'true'}
              onMouseDownCapture={handleVisibleSurfaceMouseDownCapture}
              className={`w-[396px] rounded-[24px] border border-white/10 bg-[rgba(33,24,20,0.92)] px-4 py-4 text-[#F5EDE7] shadow-[0_20px_48px_-28px_rgba(0,0,0,0.55)] backdrop-blur-[24px] ${
                isVisibleSurfaceActive ? ACTIVE_VISIBLE_SURFACE_CLASS : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  data-testid="now-overlay-drag-handle"
                  data-tauri-drag-region

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
                    className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                  >
                    <Shrink size={15} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onReturnToMain}
                    aria-label="显示主程序"
                    title="显示主程序"
                    className="h-8 w-8 rounded-[10px] border border-white/10 bg-white/8 p-0 text-[#E7D7CF] hover:bg-white/15"
                  >
                    <ArrowUpRight size={15} />
                  </Button>
                </div>
              </div>

              {model.mode === 'idle_with_tasks' ? (
                <div className="mt-4 space-y-3">
                  <div data-testid="now-overlay-task-choice-list" className="grid max-h-[188px] gap-2 overflow-y-auto pr-1">
                    {model.visibleTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        aria-label={task.title}
                        onClick={() => handleIdleTaskStart(task)}
                        className="flex w-full items-center justify-between rounded-[16px] border border-white/10 bg-white/8 px-4 py-3 text-left shadow-sm transition-colors hover:bg-white/12"
                      >
                        <span className="truncate text-[14px] font-medium">{task.title}</span>
                        <span className="ml-3 shrink-0 text-[11px] text-[#A8A29E] dark:text-[#78716C]">开始</span>
                      </button>
                    ))}
                  </div>
                  <section className="overflow-hidden rounded-[18px] border border-white/10 bg-white/8">
                    <NowInputRow onSend={onSend} placeholder="记录当下的事实..." />
                  </section>
                </div>
              ) : null}

              {model.mode === 'idle_input_only' ? (
                <div className="mt-4 space-y-3">
                  <section
                    data-testid="now-overlay-empty-state"
                    className="rounded-[18px] border border-dashed border-white/10 bg-white/6 px-4 py-4 text-center"
                  >
                    <p className="text-[14px] font-medium text-[#57534E] dark:text-[#D6D3D1]">当前没有可直接开始的任务</p>
                    <p className="mt-1 text-[12px] text-[#A8A29E] dark:text-[#78716C]">先记一条输入，或者稍后再开始时间块。</p>
                  </section>
                  <section className="overflow-hidden rounded-[18px] border border-white/10 bg-white/8">
                    <NowInputRow onSend={onSend} placeholder="记录当下的事实..." />
                  </section>
                </div>
              ) : null}
            </div>
          ) : (
            <div
              data-testid="now-overlay-idle-pill"
              onMouseEnter={() => setIsIdleHovered(true)}
              ref={shouldMeasureIdleBubbleShell ? undefined : handleVisibleSurfaceMount}
              data-overlay-visible-surface={shouldMeasureIdleBubbleShell ? undefined : 'true'}
              onMouseDownCapture={handleVisibleSurfaceMouseDownCapture}
              className={`w-[252px] rounded-[22px] border border-white/10 bg-[rgba(33,24,20,0.88)] px-4 py-3 text-[#F5EDE7] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.55)] backdrop-blur-[22px] ${
                isVisibleSurfaceActive ? ACTIVE_VISIBLE_SURFACE_CLASS : ''
              }`}
            >
              <div
                data-testid="now-overlay-drag-handle"
                data-tauri-drag-region

                className="cursor-grab select-none active:cursor-grabbing"
                title="按住这里拖动窗口"
              >
                <div className="flex items-center gap-2" data-tauri-drag-region>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#A8A29E]" data-tauri-drag-region />
                  <span className="text-[15px] font-semibold text-[#D6D3D1] dark:text-[#E7E5E4]" data-tauri-drag-region>
                    {hasOverflowTasks ? `待办 (${model.visibleTasks.length})` : '待办'}
                  </span>
                </div>
                {previewTasks.length > 0 ? (
                  <div className="mt-2 space-y-1" data-tauri-drag-region>
                    {previewTasks.map((task) => (
                      <p key={task.id} className="truncate text-[13px] font-medium" data-tauri-drag-region>
                        · {task.title}
                      </p>
                    ))}
                    {hasOverflowTasks ? (
                      <p className="truncate text-[13px] font-medium text-[#D6D3D1]/75" data-tauri-drag-region>
                        · ……
                      </p>
                    ) : null}
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
        <div
          data-testid="now-overlay-single-card-shell"
          className="now-workbench-overlay-shell now-workbench-overlay-shell--single-card"
        >
          <main className="flex min-h-0 flex-1 items-center justify-center">
            <div
              data-testid="now-overlay-single-card-stage"
              className="shrink-0"
              style={{
                width: NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE.width,
                maxWidth: NOW_WORKBENCH_OVERLAY_RUNNING_FULL_SIZE.width,
              }}
            >
              <FocusTimerWidget
                ref={focusTimerWidgetRef}
                surface="overlay"
                overlayRunningChrome={{
                  statusLabel: model.statusLabel,
                  onCollapse: () => setIsMiniCollapsed(true),
                  onReturnToMain,
                  onSurfaceMount: handleVisibleSurfaceMount,
                  onSurfaceMouseDownCapture: handleVisibleSurfaceMouseDownCapture,
                  surfacePressed: isVisibleSurfaceActive,
                }}
              />
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
      <div className="now-workbench-overlay-shell rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(45,33,28,0.94)_0%,rgba(25,18,15,0.88)_100%)] p-4 text-[#F5EDE7] shadow-[0_24px_56px_-32px_rgba(0,0,0,0.62)] backdrop-blur-[26px]">
        <header
          data-testid="now-overlay-drag-bar"
          className="flex items-center justify-between gap-3 rounded-[18px] bg-white/65 px-3 py-2 dark:bg-white/5"
        >
          <div
            data-testid="now-overlay-drag-handle"
            data-tauri-drag-region

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
          {model.nudge ? (
            <section
              data-testid="now-overlay-ritual-nudge"
              className="rounded-[20px] border border-[#F0D8D0] bg-[#FFF6F3] px-4 py-4 dark:border-[#4A2C24] dark:bg-[#2A1712]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[13px] font-semibold text-[#7C2D12] dark:text-[#FDBA74]">
                    {model.nudge.title}
                  </h2>
                  <p className="mt-1 text-[12px] leading-5 text-[#9A3412] dark:text-[#FED7AA]">
                    {model.nudge.body}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onReturnToMain}
                  className="shrink-0 rounded-[12px] border-[#E9B8A7] bg-white/75 text-[#9A3412] hover:bg-[#FFF1EB] dark:border-[#6B3F32] dark:bg-[#3A211A] dark:text-[#FED7AA] dark:hover:bg-[#4A2C24]"
                >
                  {model.nudge.ctaLabel}
                </Button>
              </div>
            </section>
          ) : null}

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
                      <span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">点任务后直接开始</span>
                    </div>
                    <div data-testid="now-overlay-task-choice-list" className="grid max-h-[220px] gap-2 overflow-y-auto pr-1">
                      {model.visibleTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          aria-label={task.title}
                          onClick={() => {
                            void onStartTask(task);
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

          <section ref={recentEventsRef} className="rounded-[20px] border border-[#E7E5E4] bg-white/70 px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]/65">
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
    padding: 0;
    align-items: flex-start;
    justify-content: flex-start;
  }

  .now-workbench-overlay-shell--single-card {
    width: auto;
    height: auto;
    max-height: none;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    overflow: visible;
    padding-top: 0;
  }

  .now-workbench-overlay-root--mini {
    padding: 0;
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
