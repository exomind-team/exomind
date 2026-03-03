/**
 * TimeBlockWidget - 时间块控件组件
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  - 时间块开始/暂停/继续/结束             │
 * │  - 任务标题输入                         │
 * │  - 计时模式选择                         │
 * │  - 计时显示                             │
 * └─────────────────────────────────────────┘
 */

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Play, Pause, Square, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast-hook';
import { getTimeBlockService, TimerMode, TimerConfig } from '@/lib/services';
import type { ActiveBlockData } from '@/lib/types/event';
import { buildSyncErrorLog } from '@/lib/storage/sync-error';
import {
  DEFAULT_TIMER_END_SOUND_PRESET_ID,
  getTimerEndSoundPresetById,
  TIMER_END_SOUND_PRESETS,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';
import { useSyncStore } from '@/ui/stores/sync-store';
import { buildRemoteDbUrl } from '@/lib/sync/remote-db-url';
import { resolveSyncServerUrl, SYNC_SERVER_URL_CHANGED_EVENT } from '@/config/port-env';

interface TimeBlockWidgetProps {
  /** 是否展开高级选项 */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** UI 变体（UI Variant） */
  variant?: 'default' | 'new-mobile';
}

/**
 * 计时器状态
 */
export type TimerState = 'idle' | 'running' | 'paused' | 'ended';

export interface TimeBlockWidgetHandle {
  expandAndFocusTaskName: () => void;
  /** 当前计时器状态 */
  getTimerState: () => TimerState;
  /** 暂停/继续时间块 */
  pauseOrResume: () => Promise<void>;
  /** 弹出反馈对话框 */
  endDialog: () => void;
}

const SKIP_FEEDBACK_CONFIRM_SECONDS = 5;

type SkipFeedbackConfirmState = 'idle' | 'cooldown' | 'armed';

function isFeedbackStage(block: ActiveBlockData): boolean {
  if (block.feedbackSubmittedAt) {
    return false;
  }
  return block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || Boolean(block.actionEndedAt || block.feedbackStartedAt);
}

export const TimeBlockWidget = forwardRef<TimeBlockWidgetHandle, TimeBlockWidgetProps>(function TimeBlockWidget({
  expanded: controlledExpanded,
  onExpandedChange,
  variant = 'default',
}, ref) {
  const { toast } = useToast();

  // 内部状态
  const [taskName, setTaskName] = useState('');
  const [timerMode, setTimerMode] = useState<TimerMode>('countdown');
  const [countdownMinutes, setCountdownMinutes] = useState(25);
  const [elapsed, setElapsed] = useState(0);
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackInProgress, setFeedbackInProgress] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [skipFeedbackConfirmState, setSkipFeedbackConfirmState] = useState<SkipFeedbackConfirmState>('idle');
  const [skipFeedbackCountdownSec, setSkipFeedbackCountdownSec] = useState(SKIP_FEEDBACK_CONFIRM_SECONDS);

  // 倒计时结束动作（纯前端配置，不持久化）
  const [countdownEndSoundEnabled, setCountdownEndSoundEnabled] = useState(true);
  const [countdownEndSoundPresetId, setCountdownEndSoundPresetId] = useState(DEFAULT_TIMER_END_SOUND_PRESET_ID);
  const [continueAfterCountdownEnd, setContinueAfterCountdownEnd] = useState(true); // * 📌【2026-02-14 01:49:27】【人写】默认为开，软提醒，需要用户自己结束
  const [countdownOvertimeMs, setCountdownOvertimeMs] = useState(0);

  // 外部控制展开状态
  const expanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const setExpanded = onExpandedChange || ((v: boolean) => setInternalExpanded(v));

  // 定时器引用
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isRunningRef = useRef(false);  // 使用 ref 跟踪运行状态，避免闭包问题
  const taskNameRef = useRef<HTMLTextAreaElement | null>(null);
  const countdownEndedRef = useRef(false);
  const countdownOverrunRef = useRef(false);
  const skipFeedbackConfirmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Service
  const timeBlockService = getTimeBlockService();
  const isLoggedIn = useSyncStore((state) => state.isLoggedIn);
  const currentUser = useSyncStore((state) => state.currentUser);
  const [syncServerUrl, setSyncServerUrl] = useState(() =>
    resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>)
  );

  const clearSkipFeedbackConfirmInterval = useCallback(() => {
    if (!skipFeedbackConfirmIntervalRef.current) {
      return;
    }
    clearInterval(skipFeedbackConfirmIntervalRef.current);
    skipFeedbackConfirmIntervalRef.current = null;
  }, []);

  const resetSkipFeedbackConfirm = useCallback(() => {
    clearSkipFeedbackConfirmInterval();
    setSkipFeedbackConfirmState('idle');
    setSkipFeedbackCountdownSec(SKIP_FEEDBACK_CONFIRM_SECONDS);
  }, [clearSkipFeedbackConfirmInterval]);

  const startSkipFeedbackConfirmCooldown = useCallback(() => {
    clearSkipFeedbackConfirmInterval();
    setSkipFeedbackConfirmState('cooldown');
    setSkipFeedbackCountdownSec(SKIP_FEEDBACK_CONFIRM_SECONDS);

    skipFeedbackConfirmIntervalRef.current = setInterval(() => {
      setSkipFeedbackCountdownSec((previousSeconds) => {
        if (previousSeconds <= 1) {
          clearSkipFeedbackConfirmInterval();
          setSkipFeedbackConfirmState('armed');
          return 0;
        }
        return previousSeconds - 1;
      });
    }, 1000);
  }, [clearSkipFeedbackConfirmInterval]);

  const playCountdownEndSound = useCallback(async () => {
    if (!countdownEndSoundEnabled) return;

    const preset = getTimerEndSoundPresetById(countdownEndSoundPresetId);
    try {
      const audio = new Audio(preset.url);
      audio.loop = false;
      audio.preload = 'auto';
      audio.currentTime = 0;
      await audio.play();
    } catch (e) {
      toast({
        title: '提示音播放失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }, [countdownEndSoundEnabled, countdownEndSoundPresetId, toast]);

  // 格式化时间
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // 倒计时格式化
  const formatCountdown = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const applyActiveBlock = useCallback((block: ActiveBlockData | null) => {
    if (!block) {
      if (timerState === 'idle') {
        return;
      }
      setTimerState('idle');
      setFeedbackInProgress(false);
      setFeedbackSubmitting(false);
      resetSkipFeedbackConfirm();
      setFeedbackOpen(false);
      setElapsed(timerMode === 'countdown' ? countdownMinutes * 60 * 1000 : 0);
      setTaskName('');
      startTimeRef.current = null;
      countdownEndedRef.current = false;
      countdownOverrunRef.current = false;
      setCountdownOvertimeMs(0);
      return;
    }

    setTaskName(block.name);
    setTimerMode(block.mode);
    if (block.mode === 'countdown' && block.targetMinutes) {
      setCountdownMinutes(block.targetMinutes);
    }
    setElapsed(Math.max(0, block.elapsed));
    const nextFeedbackInProgress = isFeedbackStage(block);
    setFeedbackInProgress(nextFeedbackInProgress);
    setFeedbackSubmitting(false);
    resetSkipFeedbackConfirm();
    setTimerState(nextFeedbackInProgress || block.paused ? 'paused' : 'running');
    startTimeRef.current = block.startTime;
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    setCountdownOvertimeMs(0);
  }, [countdownMinutes, resetSkipFeedbackConfirm, timerMode, timerState]);

  const enqueueServiceMutation = useCallback((
    label: string,
    execute: () => Promise<void>,
  ): void => {
    mutationQueueRef.current = mutationQueueRef.current.then(async () => {
      try {
        await execute();
      } catch (error) {
        console.error(`[TB-UI] ${label} failed`, error);
        try {
          const block = await timeBlockService.loadActiveBlock();
          applyActiveBlock(block);
        } catch (reloadError) {
          console.error(`[TB-UI] ${label} recover failed`, reloadError);
        }
      }
    });
  }, [applyActiveBlock, timeBlockService]);

  // 加载进行中的时间块并订阅变化
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = timeBlockService.onBlockChange((block) => {
      if (cancelled) return;
      applyActiveBlock(block);
    });

    const loadActiveBlock = async () => {
      const block = await timeBlockService.loadActiveBlock();
      if (cancelled) return;
      if (block) {
        applyActiveBlock(block);
      }
    };

    void loadActiveBlock();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyActiveBlock, timeBlockService]);

  useEffect(() => {
    const refreshSyncServerUrl = () => {
      setSyncServerUrl(resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>));
    };

    refreshSyncServerUrl();
    window.addEventListener(SYNC_SERVER_URL_CHANGED_EVENT, refreshSyncServerUrl);
    return () => {
      window.removeEventListener(SYNC_SERVER_URL_CHANGED_EVENT, refreshSyncServerUrl);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !currentUser) {
      void timeBlockService.stopSync();
      return;
    }

    let cancelled = false;
    const remoteUrl = buildRemoteDbUrl(syncServerUrl, currentUser);

    void timeBlockService.startSync(remoteUrl).catch((error) => {
      if (cancelled) return;
      const [logMessage, payload] = buildSyncErrorLog('TimeBlockWidget', remoteUrl, error);
      console.error(logMessage, payload);
      toast({
        title: '时间块同步启动失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    });

    return () => {
      cancelled = true;
      void timeBlockService.stopSync();
    };
  }, [currentUser, isLoggedIn, syncServerUrl, timeBlockService, toast]);

  // 启动定时器
  const startTimer = useCallback(() => {
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }

    let lastFrameTime = Date.now();
    isRunningRef.current = true;

    const tick = () => {
      if (!isRunningRef.current) return;

      const now = Date.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      // 倒计时已结束且处于「软结束」超时阶段：继续正计时（仅 UI 展示）
      if (timerMode === 'countdown' && countdownOverrunRef.current) {
        setCountdownOvertimeMs((prev) => prev + delta);
        if (isRunningRef.current) {
          timerRef.current = requestAnimationFrame(tick);
        }
        return;
      }

      setElapsed(prev => {
        const newElapsed = timerMode === 'countdown'
          ? prev - delta
          : prev + delta;

        // 倒计时结束
        if (timerMode === 'countdown' && newElapsed <= 0) {
          const overshoot = Math.max(0, -newElapsed);
          if (!countdownEndedRef.current) {
            countdownEndedRef.current = true;

            // * 📌【2026-02-14 01:34:25】【人写】只有在「软计时结束」后才触发
            // 仅在本次运行从 >0 跨到 <=0 时触发提示音，避免刷新/恢复时重复播放
            if (prev > 0) {
              void playCountdownEndSound();
            }
          }

          // 软结束：继续计时直到用户以其他方式确认结束
          if (continueAfterCountdownEnd) {
            countdownOverrunRef.current = true;
            setCountdownOvertimeMs(overshoot);
            return 0;
          } else {
            // 硬结束：停止计时并进入反馈流程
            setTimerState('ended');
            isRunningRef.current = false;
            if (timerRef.current) {
              cancelAnimationFrame(timerRef.current);
            }
            // 立即弹出对话框
            setFeedbackOpen(true);
            return 0;
          }
        }

        return Math.max(0, newElapsed);
      });

      if (isRunningRef.current) {
        timerRef.current = requestAnimationFrame(tick);
      }
    };

    timerRef.current = requestAnimationFrame(tick);
  }, [continueAfterCountdownEnd, playCountdownEndSound, timeBlockService, timerMode]);

  // 统一由 timerState 驱动计时器生命周期，确保恢复运行态也能自动继续计时
  useEffect(() => {
    if (timerState !== 'running') {

      // 📌【2026-02-14 01:11:53】人改：硬结束时调用 markEnding，标记时间块的结束状态
      if (timerState === 'ended') {
        void timeBlockService.markEnding();
      }

      isRunningRef.current = false;
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    startTimer();

    return () => {
      isRunningRef.current = false;
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timerState, startTimer]);

  const expandAndFocusTaskName = useCallback(() => {
    setExpanded(true);
    requestAnimationFrame(() => {
      taskNameRef.current?.focus();
    });
  }, [setExpanded]);

  // 暂停计时
  const handlePause = async () => {
    if (feedbackInProgress) return;
    setTimerState('paused');
    isRunningRef.current = false;
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
    }
    enqueueServiceMutation('pauseBlock', async () => {
      await timeBlockService.pauseBlock();
    });
  };

  // 继续计时
  const handleResume = async () => {
    if (feedbackInProgress) return;
    setTimerState('running');
    enqueueServiceMutation('resumeBlock', async () => {
      await timeBlockService.resumeBlock();
    });
  };

  // 点击按钮结束计时（显示反馈对话框）
  const handleEndDialog = async () => {
    if (feedbackInProgress) {
      setFeedbackOpen(true);
      return;
    }
    // 📌【2026-02-14 00:53:03】【人写】需要标记反馈
    setTimerState('ended'); // * 📌【2026-02-14 01:43:50】【人写】其中就包含了「时间块结束」的动作，会添加「时间块结束」事件
    setFeedbackInProgress(true);
    setFeedbackOpen(true);
  };

  // 对话框后，带反馈结束时间块
  const handleEndBlock = async (feedbackText?: string) => {
    if (feedbackSubmitting) return;

    const trimmedFeedback = feedbackText?.trim() ?? '';
    if (trimmedFeedback.length === 0) {
      if (skipFeedbackConfirmState === 'idle') {
        startSkipFeedbackConfirmCooldown();
        return;
      }
      if (skipFeedbackConfirmState === 'cooldown') {
        return;
      }
    }

    resetSkipFeedbackConfirm();
    setFeedbackSubmitting(true);

    const normalizedFeedback = trimmedFeedback || undefined;
    try {
      await timeBlockService.endBlock(normalizedFeedback);
    } catch (error) {
      console.error('[TB-UI] endBlock failed', error);
      try {
        const block = await timeBlockService.loadActiveBlock();
        applyActiveBlock(block);
      } catch (reloadError) {
        console.error('[TB-UI] endBlock recover failed', reloadError);
      }
      setFeedbackSubmitting(false);
      return;
    }

    isRunningRef.current = false;
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
    }

    // 重置状态
    setFeedbackOpen(false);
    setFeedbackInProgress(false);
    setFeedbackSubmitting(false);
    setTimerState('idle');
    setElapsed(0);
    setTaskName('');
    setFeedback('');
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    setCountdownOvertimeMs(0);
  };

  const handleFeedbackDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && feedbackInProgress) {
      return;
    }
    setFeedbackOpen(nextOpen);
  }, [feedbackInProgress]);

  // 暂停/继续切换
  const pauseOrResume = async () => {
    if (feedbackInProgress) return;
    if (timerState === 'running') {
      await handlePause();
    } else if (timerState === 'paused') {
      await handleResume();
    }
  };

  useImperativeHandle(ref, () => ({
    expandAndFocusTaskName,
    getTimerState: () => timerState,
    pauseOrResume,
    endDialog: handleEndDialog,
  }), [expandAndFocusTaskName, timerState, pauseOrResume, handleEndDialog]);

  // 开始计时
  const handleStart = async () => {
    const raw = taskName;
    const lines = raw.split(/\r?\n/);
    const name = (lines[0] ?? '').trim();
    const description = lines.slice(1).join('\n').trim();

    if (!name) {
      expandAndFocusTaskName();
      return;
    }

    const config: TimerConfig = {
      mode: timerMode,
      minutes: timerMode === 'countdown' ? countdownMinutes : undefined,
    };

    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    setCountdownOvertimeMs(0);

    const block = await timeBlockService.startBlock(name, config, description || undefined);
    setTaskName(name);
    setElapsed(block.elapsed);
    setFeedbackInProgress(false);
    setTimerState('running');
    startTimeRef.current = block.startTime;
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      clearSkipFeedbackConfirmInterval();
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
      }
    };
  }, [clearSkipFeedbackConfirmInterval]);

  // 按钮状态
  const isIdle = timerState === 'idle';
  const isRunning = timerState === 'running';
  const isPaused = timerState === 'paused';

  const timerDisplayValue = timerMode === 'countdown'
    ? (countdownOverrunRef.current ? `+${formatTime(countdownOvertimeMs)}` : formatCountdown(elapsed))
    : formatTime(elapsed);
  const isCountdownWarning =
    timerMode === 'countdown'
    && (countdownOverrunRef.current || (elapsed <= 60000 && elapsed > 0));
  const isEmptyFeedback = feedback.trim().length === 0;
  const isSkipFeedbackCoolingDown = isEmptyFeedback && skipFeedbackConfirmState === 'cooldown';
  const isEndActionDisabled = feedbackInProgress && feedbackOpen;
  const feedbackConfirmLabel = feedbackSubmitting
    ? '提交中...'
    : (isEmptyFeedback && skipFeedbackConfirmState === 'cooldown')
      ? `确认跳过反馈(${skipFeedbackCountdownSec}s)`
      : (isEmptyFeedback && skipFeedbackConfirmState === 'armed')
        ? '确认跳过反馈'
        : '确认结束';
  const rootClassName = variant === 'new-mobile' ? 'border-y border-[#E8E3DE] bg-white/80' : 'border-b bg-muted/30';

  return (
    <div className={rootClassName} data-testid="timeblock-widget">
      {/* 状态栏 */}
      {variant === 'new-mobile' ? (
        <div className="px-4 py-1">
          {isIdle ? (
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2" data-testid="timeblock-main-row">
              <div className="flex items-center">
                <Button
                  size="sm"
                  onClick={handleStart}
                  className="h-9 gap-1 rounded-lg bg-[#16A34A] px-4 text-sm hover:bg-[#15803D]"
                >
                  <Play size={15} />
                  <span>开始</span>
                </Button>
              </div>

              <div className="text-center font-mono">
                <span
                  className={`text-[32px] font-light leading-[1.05] tracking-[0.04em] ${
                    isCountdownWarning ? 'text-red-500' : 'text-stone-900'
                  }`}
                >
                  {timerDisplayValue}
                </span>
              </div>

              <div className="h-9 w-9" aria-hidden />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center px-6 pb-1 pt-2" data-testid="timeblock-main-row">
                <span
                  className={`font-mono text-[56px] font-light leading-[0.95] tracking-[0.05em] ${
                    isCountdownWarning ? 'text-red-500' : 'text-stone-900'
                  }`}
                >
                  {timerDisplayValue}
                </span>
              </div>
              <div className="flex items-center justify-center gap-3 px-6 pb-1" data-testid="timeblock-action-row">
                {isRunning && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePause}
                    disabled={feedbackInProgress}
                    className="h-10 gap-2 rounded-[24px] border-0 bg-[#EDECE9] px-6 text-sm font-medium text-[#1C1917]"
                  >
                    <Pause size={16} />
                    <span>暂停</span>
                  </Button>
                )}
                {isPaused && (
                  <Button
                    size="sm"
                    onClick={handleResume}
                    disabled={feedbackInProgress}
                    className="h-10 gap-2 rounded-[24px] bg-[#16A34A] px-6 text-sm font-medium text-white hover:bg-[#15803D]"
                  >
                    <Play size={16} />
                    <span>继续</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEndDialog}
                  disabled={isEndActionDisabled}
                  className="h-10 gap-2 rounded-[24px] border-0 bg-[#FDECEB] px-6 text-sm font-medium text-[#C75B3A]"
                >
                  <Square size={16} />
                  <span>结束</span>
                </Button>
              </div>
            </>
          )}

          <div className="-mt-0.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-8 rounded-full px-2 text-stone-500"
              data-testid="timeblock-collapse-toggle"
            >
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 py-3">
          {/* 左侧：控制按钮 */}
          <div className="flex items-center gap-2">
            {isIdle && (
              <Button
                size="sm"
                onClick={handleStart}
                className="gap-1 bg-green-600 hover:bg-green-700"
              >
                <Play size={16} />
                <span>开始</span>
              </Button>
            )}

            {isRunning && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePause}
                  disabled={feedbackInProgress}
                  className="gap-1"
                >
                  <Pause size={16} />
                  <span>暂停</span>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleEndDialog}
                  disabled={isEndActionDisabled}
                  className="gap-1"
                >
                  <Square size={16} />
                  <span>结束</span>
                </Button>
              </>
            )}

            {isPaused && (
              <>
                <Button
                  size="sm"
                  onClick={handleResume}
                  disabled={feedbackInProgress}
                  className="gap-1 bg-green-600 hover:bg-green-700"
                >
                  <Play size={16} />
                  <span>继续</span>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleEndDialog}
                  disabled={isEndActionDisabled}
                  className="gap-1"
                >
                  <Square size={16} />
                  <span>结束</span>
                </Button>
              </>
            )}
          </div>

          {/* 中间：计时显示 */}
          <div className="flex items-center gap-2 font-mono text-lg">
            <span
              className={
                timerMode === 'countdown'
                  && (countdownOverrunRef.current || (elapsed <= 60000 && elapsed > 0))
                  ? 'text-red-500'
                  : ''
              }
            >
              {timerMode === 'countdown'
                ? (countdownOverrunRef.current ? `+${formatTime(countdownOvertimeMs)}` : formatCountdown(elapsed))
                : formatTime(elapsed)}
            </span>
          </div>

          {/* 右侧：展开按钮 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </Button>
        </div>
      )}

      {/* 展开面板 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* 任务标题 */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">任务标题</label>
            <Textarea
              ref={taskNameRef}
              placeholder="输入任务标题..."
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  (e.currentTarget as HTMLTextAreaElement).blur();
                  setExpanded(false); // 自动折叠
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleStart();
                }
              }}
              disabled={!isIdle}
              className="min-h-[32px] resize-none"
              rows={2}
              data-testid="timeblock-task-textarea"
            />
          </div>

          {/* 计时模式 */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">计时模式</label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="timerMode"
                  checked={timerMode === 'countup'}
                  onChange={() => setTimerMode('countup')}
                  disabled={!isIdle}
                />
                <span className="text-sm">正计时</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="timerMode"
                  checked={timerMode === 'countdown'}
                  onChange={() => setTimerMode('countdown')}
                  disabled={!isIdle}
                />
                <span className="text-sm">倒计时</span>
              </label>
            </div>
          </div>

          {/* 倒计时时长选择 */}
          {timerMode === 'countdown' && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">倒计时时长</label>
              <div className="flex items-center gap-2">
                {[15, 25, 45].map(min => (
                  <Button
                    key={min}
                    size="sm"
                    variant={countdownMinutes === min ? 'default' : 'outline'}
                    onClick={() => setCountdownMinutes(min)}
                    disabled={!isIdle}
                    className="w-12"
                  >
                    {min}m
                  </Button>
                ))}
                <Input
                  type="number"
                  placeholder="自定义"
                  value={countdownMinutes}
                  onChange={(e) => setCountdownMinutes(Number(e.target.value) || 25)}
                  disabled={!isIdle}
                  className="w-20 h-8"
                  min={1}
                />
              </div>
            </div>
          )}

          {/* 倒计时结束动作 */}
          {timerMode === 'countdown' && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">倒计时结束动作</label>

              <div className="flex items-center justify-between">
                <Label htmlFor="countdown-end-sound" className="text-sm">提示音</Label>
                <Switch
                  id="countdown-end-sound"
                  checked={countdownEndSoundEnabled}
                  onCheckedChange={setCountdownEndSoundEnabled}
                  disabled={!isIdle}
                />
              </div>

              {countdownEndSoundEnabled && (<div className="space-y-1">
                <Label htmlFor="countdown-end-sound-preset" className="text-sm">提示音预设</Label>
                <select
                  id="countdown-end-sound-preset"
                  value={countdownEndSoundPresetId}
                  onChange={(e) => setCountdownEndSoundPresetId(e.target.value as TimerEndSoundPresetId)}
                  disabled={!isIdle || !countdownEndSoundEnabled}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {TIMER_END_SOUND_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>)}

              <div className="flex items-center justify-between">
                <Label htmlFor="continue-after-countdown-end" className="text-sm">硬结束：倒计时结束后强制结束计时</Label>
                <Switch
                  id="continue-after-countdown-end"
                  checked={!continueAfterCountdownEnd}
                  onCheckedChange={(bool: boolean) => setContinueAfterCountdownEnd(!bool)}
                  disabled={!isIdle}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 身心反馈对话框 */}
      <Dialog open={feedbackOpen} onOpenChange={handleFeedbackDialogOpenChange}>
        <DialogContent
          hideCloseButton
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>时间块结束</DialogTitle>
            <DialogDescription>
              {taskName || '未命名任务'} 完成了，请输入身心状态反馈：
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="身心状态如何？"
            value={feedback}
            onChange={(e) => {
              resetSkipFeedbackConfirm();
              setFeedback(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (e.shiftKey || e.ctrlKey) return;
              e.preventDefault();
              void handleEndBlock(feedback);
            }}
            autoFocus
            className="min-h-[88px] resize-none"
            rows={4}
            data-testid="timeblock-feedback-textarea"
          />
          <DialogFooter>
            <Button
              size="sm"
              data-testid="timeblock-feedback-confirm"
              disabled={feedbackSubmitting || isSkipFeedbackCoolingDown}
              onClick={() => {
                void handleEndBlock(feedback);
              }}
            >
              {feedbackConfirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
