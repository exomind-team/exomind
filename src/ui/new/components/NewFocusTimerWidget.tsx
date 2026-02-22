import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronRight, Pause, Play, Square, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  getTimerPreferences,
  subscribeTimerPreferencesChanges,
} from '@/config/timer-preferences';
import { getTimerEndSoundPresetById } from '@/lib/media/timer-end-sounds';
import { getTimeBlockService, type TimerConfig, type TimerMode } from '@/lib/services';

type FocusUiState = 'idle' | 'config' | 'running'; // UI State Machine（界面状态机）
type RunningSubState = 'running' | 'paused'; // Running Sub-state（运行子状态）
export type NewFocusTimerState = 'idle' | 'running' | 'paused';

export interface NewFocusTimerWidgetHandle {
  expandAndFocusTaskName: () => void;
  getTimerState: () => NewFocusTimerState;
  pauseOrResume: () => Promise<void>;
  endDialog: () => void;
}

function formatClock(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function glassCardShadowClass(): string {
  return 'shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-6px_rgba(0,0,0,0.08),0_20px_40px_-8px_rgba(0,0,0,0.05)]';
}

const PRESET_COUNTDOWN_MINUTES = [15, 25, 45] as const;
const MAX_CUSTOM_COUNTDOWN_MINUTES = 720;

function isPresetCountdownMinutes(minutes: number): boolean {
  return PRESET_COUNTDOWN_MINUTES.includes(minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number]);
}

export const NewFocusTimerWidget = forwardRef<NewFocusTimerWidgetHandle>(function NewFocusTimerWidget(_, ref) {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const frameRef = useRef<number | null>(null);
  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const customDurationInputRef = useRef<HTMLInputElement | null>(null);
  const countdownEndedRef = useRef(false);
  const countdownOverrunRef = useRef(false);
  const hardEndTriggeredRef = useRef(false);

  const [uiState, setUiState] = useState<FocusUiState>('idle');
  const [runningSubState, setRunningSubState] = useState<RunningSubState>('running');

  const [taskNameDraft, setTaskNameDraft] = useState('');
  const [taskName, setTaskName] = useState('');
  const [timerMode, setTimerMode] = useState<TimerMode>('countdown');
  const [countdownMinutes, setCountdownMinutes] = useState(25);
  const [customDurationDraft, setCustomDurationDraft] = useState('25');
  const [isCustomDurationEditing, setIsCustomDurationEditing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(25 * 60 * 1000);
  const [countdownOvertimeMs, setCountdownOvertimeMs] = useState(0);
  const [timerPreferences, setTimerPreferences] = useState(() => getTimerPreferences());

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const isRunningUi = uiState === 'running';
  const isPaused = isRunningUi && runningSubState === 'paused';
  const isCustomDurationSelected = !isPresetCountdownMinutes(countdownMinutes);
  const customDurationTriggerText = isCustomDurationSelected ? `${countdownMinutes}m` : '自定义';
  const isCountdownOvertime =
    timerMode === 'countdown' && countdownOverrunRef.current;
  const isCountdownWarning =
    timerMode === 'countdown'
    && (isCountdownOvertime || (elapsedMs <= 60000 && elapsedMs > 0));

  const syncIdleElapsedFromMode = useCallback((mode: TimerMode, minutes: number) => {
    setElapsedMs(mode === 'countdown' ? minutes * 60 * 1000 : 0);
  }, []);

  const focusTaskInput = useCallback(() => {
    requestAnimationFrame(() => {
      taskInputRef.current?.focus();
    });
  }, []);

  const enterConfigState = useCallback(() => {
    if (isRunningUi) return;
    setUiState('config');
    focusTaskInput();
  }, [focusTaskInput, isRunningUi]);

  // Keep draft minutes synced for custom input（自定义输入框与草稿分钟同步）
  useEffect(() => {
    setCustomDurationDraft(String(countdownMinutes));
  }, [countdownMinutes]);

  useEffect(() => {
    const unsubscribe = subscribeTimerPreferencesChanges((preferences) => {
      setTimerPreferences(preferences);
    });
    return unsubscribe;
  }, []);

  const playCountdownEndSound = useCallback(async () => {
    if (!timerPreferences.countdownEndSoundEnabled) return;
    const preset = getTimerEndSoundPresetById(timerPreferences.countdownEndSoundPresetId);
    try {
      const audio = new Audio(preset.url);
      audio.loop = false;
      audio.preload = 'auto';
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // Ignore sound playback failures（忽略浏览器自动播放限制等失败）
    }
  }, [timerPreferences.countdownEndSoundEnabled, timerPreferences.countdownEndSoundPresetId]);

  useEffect(() => {
    let cancelled = false;

    const loadActiveBlock = async () => {
      const block = await timeBlockServiceRef.current.loadActiveBlock();
      if (!block || cancelled) return;

      setTaskName(block.name);
      setTaskNameDraft(block.name);
      setTimerMode(block.mode);
      if (block.mode === 'countdown' && block.targetMinutes) {
        setCountdownMinutes(block.targetMinutes);
      }
      setElapsedMs(Math.max(0, block.elapsed));
      setUiState('running');
      setRunningSubState(block.paused ? 'paused' : 'running');
    };

    void loadActiveBlock();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isRunningUi || isPaused) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const delta = now - last;
      last = now;

      // Soft end（软结束）时进入超时累计：显示 +xx:xx:xx
      if (timerMode === 'countdown' && countdownOverrunRef.current) {
        setCountdownOvertimeMs((prev) => prev + delta);
        frameRef.current = requestAnimationFrame(tick);
        return;
      }

      setElapsedMs((previous) => {
        const next = timerMode === 'countdown' ? previous - delta : previous + delta;

        if (timerMode === 'countdown' && next <= 0) {
          const overshoot = Math.max(0, -next);
          if (!countdownEndedRef.current) {
            countdownEndedRef.current = true;
            if (previous > 0) {
              void playCountdownEndSound();
            }
          }

          if (timerPreferences.countdownEndMode === 'soft') {
            countdownOverrunRef.current = true;
            setCountdownOvertimeMs(overshoot);
            void timeBlockServiceRef.current.updateElapsed(0);
            return 0;
          }

          if (!hardEndTriggeredRef.current) {
            hardEndTriggeredRef.current = true;
            void timeBlockServiceRef.current.markEnding();
            setRunningSubState('paused');
            setFeedbackOpen(true);
          }
          return 0;
        }

        const safeNext = timerMode === 'countdown' ? Math.max(0, next) : next;
        void timeBlockServiceRef.current.updateElapsed(safeNext);
        return safeNext;
      });

      if (!hardEndTriggeredRef.current) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [isPaused, isRunningUi, playCountdownEndSound, timerMode, timerPreferences.countdownEndMode]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (uiState !== 'idle') return;
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [countdownMinutes, syncIdleElapsedFromMode, timerMode, uiState]);

  const handleStart = useCallback(async () => {
    const name = taskNameDraft.trim();
    if (!name) {
      focusTaskInput();
      return;
    }

    const config: TimerConfig = {
      mode: timerMode,
      minutes: timerMode === 'countdown' ? countdownMinutes : undefined,
    };

    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);

    const block = await timeBlockServiceRef.current.startBlock(name, config, undefined);
    setTaskName(name);
    setTaskNameDraft(name);
    setElapsedMs(Math.max(0, block.elapsed));
    setRunningSubState('running');
    setUiState('running');
  }, [countdownMinutes, focusTaskInput, taskNameDraft, timerMode]);

  const handleCollapseToIdle = useCallback(() => {
    if (uiState !== 'config') return;
    setIsCustomDurationEditing(false);
    setUiState('idle');
  }, [uiState]);

  const handleOpenCustomDurationEditor = useCallback(() => {
    setIsCustomDurationEditing(true);
    requestAnimationFrame(() => {
      customDurationInputRef.current?.focus();
      customDurationInputRef.current?.select();
    });
  }, []);

  const applyCustomDuration = useCallback((rawValue: string) => {
    const parsedValue = Number.parseInt(rawValue.trim(), 10);
    if (Number.isFinite(parsedValue)) {
      const safeMinutes = Math.max(1, Math.min(MAX_CUSTOM_COUNTDOWN_MINUTES, parsedValue));
      setCountdownMinutes(safeMinutes);
      setCustomDurationDraft(String(safeMinutes));
    } else {
      setCustomDurationDraft(String(countdownMinutes));
    }
    setIsCustomDurationEditing(false);
  }, [countdownMinutes]);

  const handlePauseOrResume = useCallback(async () => {
    if (!isRunningUi) return;

    if (runningSubState === 'running') {
      await timeBlockServiceRef.current.pauseBlock();
      setRunningSubState('paused');
      return;
    }

    await timeBlockServiceRef.current.resumeBlock();
    setRunningSubState('running');
  }, [isRunningUi, runningSubState]);

  const handleOpenEndDialog = useCallback(() => {
    if (!isRunningUi) return;
    void timeBlockServiceRef.current.markEnding();
    setFeedbackOpen(true);
  }, [isRunningUi]);

  const handleConfirmEnd = useCallback(async () => {
    await timeBlockServiceRef.current.endBlock(feedback.trim() || undefined);
    setFeedback('');
    setFeedbackOpen(false);
    setUiState('idle');
    setRunningSubState('running');
    setTaskName('');
    setTaskNameDraft('');
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    hardEndTriggeredRef.current = false;
    setCountdownOvertimeMs(0);
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [countdownMinutes, feedback, syncIdleElapsedFromMode, timerMode]);

  useImperativeHandle(
    ref,
    () => ({
      expandAndFocusTaskName: () => {
        if (uiState === 'running') return;
        setUiState('config');
        focusTaskInput();
      },
      getTimerState: () => {
        if (uiState !== 'running') return 'idle';
        return runningSubState === 'paused' ? 'paused' : 'running';
      },
      pauseOrResume: async () => {
        await handlePauseOrResume();
      },
      endDialog: () => {
        handleOpenEndDialog();
      },
    }),
    [focusTaskInput, handleOpenEndDialog, handlePauseOrResume, runningSubState, uiState],
  );

  return (
    <div className="bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="new-focus-timer-widget">
      {uiState === 'idle' && (
        <section className="safe-area-pt-plus">
          <div className="relative mx-auto h-[104px] w-full max-w-[390px]" data-testid="new-focus-state-idle">
            <div
              className="absolute left-1/2 top-[18px] h-[74px] w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14] blur-[8px]"
              aria-hidden
            />

            <button
              type="button"
              data-testid="new-focus-idle-card"
              onClick={enterConfigState}
              aria-expanded="false"
              aria-controls="new-focus-config-panel"
              aria-label="展开专注配置（Expand focus configuration）"
              className={`absolute left-4 right-4 top-4 flex h-[68px] items-center justify-between rounded-[24px] border border-[#FFFFFF80] dark:border-[#FFFFFF15] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)] px-5 py-[18px] text-left backdrop-blur-[24px] ${glassCardShadowClass()}`}
            >
              <div className="mr-3 flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                  <Target size={20} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-semibold leading-[1.4] text-[#1C1917] dark:text-[#FAFAF9]">点击设置专注任务</p>
                  <p className="truncate text-[12px] leading-[1.4] text-[#78716C]">配置时间块、开始倒计时</p>
                </div>
              </div>
              <ChevronRight size={20} className="shrink-0 text-[#C75B3A] dark:text-[#E8734E]" />
            </button>
          </div>
        </section>
      )}

      {uiState === 'config' && (
        <section className="safe-area-pt-plus">
          <div className="relative mx-auto w-full max-w-[390px] px-4 pb-3 pt-4" data-testid="new-focus-state-config">
            <div
              className="absolute inset-x-4 bottom-[10px] top-[14px] rounded-[22px] bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14] blur-[8px]"
              aria-hidden
            />

            <div
              id="new-focus-config-panel"
              className={`relative flex w-full flex-col gap-3 rounded-[24px] border border-[#FFFFFF80] dark:border-[#FFFFFF15] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)] px-[18px] py-4 backdrop-blur-[24px] ${glassCardShadowClass()}`}
            >
              <div className="flex items-center gap-[10px]">
                <button
                  type="button"
                  data-testid="new-focus-config-collapse-button"
                  aria-expanded="true"
                  aria-controls="new-focus-config-panel"
                  aria-label="收起专注配置（Collapse focus configuration）"
                  onClick={handleCollapseToIdle}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E] transition-transform active:scale-95"
                >
                  <Target size={20} />
                </button>
                <Input
                  ref={taskInputRef}
                  data-testid="new-focus-task-input"
                  value={taskNameDraft}
                  onChange={(event) => setTaskNameDraft(event.target.value)}
                  placeholder="输入任务名称..."
                  className="h-9 border-[#E7E5E4]/80 dark:border-[#FFFFFF20] bg-white/60 dark:bg-[#FFFFFF10] text-sm dark:text-[#FAFAF9]"
                />
              </div>

              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />

              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">计时模式</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="new-focus-mode-countup"
                    onClick={() => setTimerMode('countup')}
                    className={`rounded-[8px] px-[10px] py-[6px] text-[12px] ${timerMode === 'countup' ? 'bg-white/90 dark:bg-[#FFFFFF20] text-[#1C1917] dark:text-[#FAFAF9]' : 'bg-transparent text-[#A8A29E]'}`}
                  >
                    正计时
                  </button>
                  <button
                    type="button"
                    data-testid="new-focus-mode-countdown"
                    onClick={() => setTimerMode('countdown')}
                    className={`rounded-[8px] px-[10px] py-[6px] text-[12px] ${timerMode === 'countdown' ? 'bg-white/90 dark:bg-[#FFFFFF20] text-[#1C1917] dark:text-[#FAFAF9]' : 'bg-transparent text-[#A8A29E]'}`}
                  >
                    倒计时
                  </button>
                </div>
              </div>

              {timerMode === 'countdown' && (
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">倒计时时长</span>
                  <div className="flex items-center gap-[6px]">
                    <button
                      type="button"
                      data-testid="new-focus-duration-custom-trigger"
                      onClick={handleOpenCustomDurationEditor}
                      className={`flex items-center rounded-[8px] text-[12px] ${
                        isCustomDurationEditing || isCustomDurationSelected
                          ? 'bg-white/90 dark:bg-[#FFFFFF20] font-semibold text-[#C75B3A]'
                          : 'bg-transparent text-[#C75B3A]'
                      } ${
                        isCustomDurationEditing ? 'h-8 w-8 justify-center p-0' : 'gap-1 px-[8px] py-[6px]'
                      }`}
                      aria-label="自定义倒计时（Custom countdown）"
                    >
                      <ChevronDown size={12} className={isCustomDurationEditing ? 'rotate-180 transition-transform' : 'transition-transform'} />
                      {!isCustomDurationEditing && customDurationTriggerText}
                    </button>

                    {isCustomDurationEditing && (
                      <Input
                        ref={customDurationInputRef}
                        data-testid="new-focus-duration-custom-input"
                        value={customDurationDraft}
                        onChange={(event) => {
                          setCustomDurationDraft(event.target.value.replace(/[^\d]/g, ''));
                        }}
                        onBlur={() => applyCustomDuration(customDurationDraft)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            applyCustomDuration(customDurationDraft);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setCustomDurationDraft(String(countdownMinutes));
                            setIsCustomDurationEditing(false);
                          }
                        }}
                        aria-label="自定义倒计时分钟（Custom countdown minutes）"
                        placeholder="分钟"
                        className="h-8 w-[72px] border-[#FFFFFF60] bg-white/90 dark:bg-[#FFFFFF20] px-2 text-[12px] font-medium text-[#1C1917] dark:text-[#FAFAF9]"
                      />
                    )}

                    {PRESET_COUNTDOWN_MINUTES.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        data-testid={`new-focus-duration-${minutes}`}
                        onClick={() => {
                          setIsCustomDurationEditing(false);
                          setCountdownMinutes(minutes);
                        }}
                        className={`rounded-[8px] px-[10px] py-[6px] text-[12px] ${
                          countdownMinutes === minutes ? 'border border-[#FFFFFF60] bg-white/90 dark:bg-[#FFFFFF20] font-semibold text-[#1C1917] dark:text-[#FAFAF9]' : 'bg-transparent text-[#78716C]'
                        }`}
                      >
                        {minutes}m
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button
                type="button"
                data-testid="new-focus-start-button"
                onClick={() => {
                  void handleStart();
                }}
                className="h-10 w-full rounded-[12px] bg-[#C75B3A] text-[14px] font-medium hover:bg-[#B24D2F] dark:bg-[#C75B3A] dark:hover:bg-[#B24D2F]"
              >
                <Play size={16} className="mr-2" />
                开始
              </Button>
            </div>
          </div>
        </section>
      )}

      {uiState === 'running' && (
        <section className="safe-area-pt-plus" data-testid="new-focus-state-running">
          <div className="relative mx-auto h-[200px] w-full max-w-[390px]">
            <div
              className="absolute left-1/2 top-[20px] h-[163px] w-[calc(100%-40px)] max-w-[353px] -translate-x-1/2 rounded-[22px] bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14] blur-[8px]"
              aria-hidden
            />
            <div
              data-testid="new-focus-running-task-card"
              className={`absolute left-4 right-4 top-4 flex h-[169px] flex-col gap-3 rounded-[24px] border border-[#FFFFFF80] dark:border-[#FFFFFF15] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)] px-5 py-4 backdrop-blur-[24px] ${glassCardShadowClass()}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] dark:bg-[#2A1510] text-[#C75B3A] dark:text-[#E8734E]">
                  <Target size={20} />
                </div>
                <p className="truncate text-[20px] font-semibold leading-[1.4] text-[#1C1917] dark:text-[#FAFAF9]">{taskName || '未命名任务'}</p>
              </div>
              <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />
              <div className="flex items-center justify-between px-1 pt-1">
                <Button
                  type="button"
                  data-testid="new-focus-pause-resume-button"
                  aria-label={isPaused ? '继续（Resume）' : '暂停（Pause）'}
                  onClick={() => {
                    void handlePauseOrResume();
                  }}
                  className={
                    isPaused
                      ? 'h-11 w-11 rounded-[12px] bg-[#16A34A] p-0 text-white hover:bg-[#15803D]'
                      : 'h-11 w-11 rounded-[12px] bg-[#EDECE9] dark:bg-[#292524] p-0 text-[#1C1917] dark:text-[#FAFAF9] hover:bg-[#E5E3DF] dark:hover:bg-[#3D3835]'
                  }
                >
                  {isPaused ? <Play size={18} /> : <Pause size={18} />}
                </Button>
                <span
                  className={`font-mono text-[40px] font-normal leading-[1.1] tracking-[2px] ${
                    isCountdownWarning ? 'text-[#C75B3A]' : 'text-[#1C1917] dark:text-[#FAFAF9]'
                  }`}
                  data-testid="new-focus-running-clock"
                >
                  {isCountdownOvertime
                    ? `+${formatClock(countdownOvertimeMs)}`
                    : formatClock(elapsedMs)}
                </span>
                <Button
                  type="button"
                  data-testid="new-focus-end-button"
                  aria-label="结束（End）"
                  onClick={handleOpenEndDialog}
                  className="h-11 w-11 rounded-[12px] bg-[#FDECEB] dark:bg-[#2A1510] p-0 text-[#C75B3A] dark:text-[#E8734E] hover:bg-[#F8DED9] dark:hover:bg-[#3D1F15]"
                >
                  <Square size={18} />
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>结束专注并记录反馈</DialogTitle>
            <DialogDescription>记录本次专注反馈后将结束当前时间块</DialogDescription>
          </DialogHeader>
          <Textarea
            data-testid="new-focus-feedback-textarea"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="记录本次专注的反馈..."
            className="min-h-[96px] resize-none dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
          />
          <DialogFooter>
            <Button
              type="button"
              data-testid="new-focus-feedback-confirm"
              onClick={() => {
                void handleConfirmEnd();
              }}
              className="dark:rounded-[10px] dark:bg-[#C75B3A] dark:text-white dark:hover:bg-[#B24D2F]"
            >
              确认结束
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

