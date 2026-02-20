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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getTimeBlockService, type TimerConfig, type TimerMode } from '@/lib/services';

type FocusUiState = 'idle' | 'config' | 'running'; // UI 状态机（State Machine / 状态机）
type RunningSubState = 'running' | 'paused'; // 运行子状态（Sub-state / 子状态）
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

export const NewFocusTimerWidget = forwardRef<NewFocusTimerWidgetHandle>(function NewFocusTimerWidget(_, ref) {
  const timeBlockServiceRef = useRef(getTimeBlockService());
  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const [uiState, setUiState] = useState<FocusUiState>('idle');
  const [runningSubState, setRunningSubState] = useState<RunningSubState>('running');
  const [taskNameDraft, setTaskNameDraft] = useState('');
  const [taskName, setTaskName] = useState('');
  const [timerMode, setTimerMode] = useState<TimerMode>('countdown');
  const [countdownMinutes, setCountdownMinutes] = useState(25);
  const [elapsedMs, setElapsedMs] = useState(25 * 60 * 1000);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const isRunningUi = uiState === 'running';
  const isPaused = isRunningUi && runningSubState === 'paused';

  const syncIdleElapsedFromMode = useCallback((mode: TimerMode, minutes: number) => {
    setElapsedMs(mode === 'countdown' ? minutes * 60 * 1000 : 0);
  }, []);

  const focusTaskInput = useCallback(() => {
    requestAnimationFrame(() => {
      taskInputRef.current?.focus();
    });
  }, []);

  const enterConfigState = useCallback(() => {
    setUiState('config');
    focusTaskInput();
  }, [focusTaskInput]);

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

      setElapsedMs((previous) => {
        const next = timerMode === 'countdown' ? Math.max(0, previous - delta) : previous + delta;
        void timeBlockServiceRef.current.updateElapsed(next);
        return next;
      });

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [isPaused, isRunningUi, timerMode]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

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

    const block = await timeBlockServiceRef.current.startBlock(name, config, undefined);
    setTaskName(name);
    setTaskNameDraft(name);
    setElapsedMs(Math.max(0, block.elapsed));
    setRunningSubState('running');
    setUiState('running');
  }, [countdownMinutes, focusTaskInput, taskNameDraft, timerMode]);

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
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [countdownMinutes, feedback, syncIdleElapsedFromMode, timerMode]);

  useImperativeHandle(
    ref,
    () => ({
      expandAndFocusTaskName: () => {
        enterConfigState();
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
    [enterConfigState, handleOpenEndDialog, handlePauseOrResume, runningSubState, uiState],
  );

  useEffect(() => {
    if (uiState !== 'idle') return;
    syncIdleElapsedFromMode(timerMode, countdownMinutes);
  }, [countdownMinutes, syncIdleElapsedFromMode, timerMode, uiState]);

  const renderIdle = () => (
    <div data-testid="new-focus-state-idle" className="px-4 py-3">
      <button
        type="button"
        data-testid="new-focus-idle-card"
        onClick={enterConfigState}
        className="flex w-full items-center justify-between rounded-3xl border border-[#FFFFFF80] bg-[#FFFFFFA0] px-5 py-4 text-left shadow-[0_10px_30px_-22px_rgba(0,0,0,0.5)]"
      >
        <div className="mr-3 flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FEF0ED] text-[#C75B3A]">
            <Target size={18} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-[#1C1917]">点击设置专注任务</p>
            <p className="truncate text-[12px] text-[#78716C]">配置时间块、开始倒计时</p>
          </div>
        </div>
        <ChevronRight size={18} className="shrink-0 text-[#C75B3A]" />
      </button>
    </div>
  );

  const renderConfig = () => (
    <div data-testid="new-focus-state-config" className="px-4 py-3">
      <div className="space-y-3 rounded-3xl border border-[#FFFFFF80] bg-[#FFFFFFA0] px-4 py-4 shadow-[0_12px_32px_-24px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FEF0ED] text-[#C75B3A]">
            <Target size={18} />
          </div>
          <Input
            ref={taskInputRef}
            data-testid="new-focus-task-input"
            value={taskNameDraft}
            onChange={(event) => setTaskNameDraft(event.target.value)}
            placeholder="输入任务名称..."
            className="h-9 border-[#E7E5E4] bg-white/80 text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-[#57534E]">计时模式</span>
          <div className="flex items-center gap-1 rounded-lg bg-[#FFFFFF70] p-1">
            <button
              type="button"
              data-testid="new-focus-mode-countup"
              onClick={() => setTimerMode('countup')}
              className={`rounded-md px-3 py-1 text-xs ${timerMode === 'countup' ? 'bg-white text-[#1C1917]' : 'text-[#78716C]'}`}
            >
              正计时
            </button>
            <button
              type="button"
              data-testid="new-focus-mode-countdown"
              onClick={() => setTimerMode('countdown')}
              className={`rounded-md px-3 py-1 text-xs ${timerMode === 'countdown' ? 'bg-white text-[#1C1917]' : 'text-[#78716C]'}`}
            >
              倒计时
            </button>
          </div>
        </div>

        {timerMode === 'countdown' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-[#57534E]">倒计时时长</span>
            <div className="flex items-center gap-1">
              {[15, 25, 45].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  data-testid={`new-focus-duration-${minutes}`}
                  onClick={() => setCountdownMinutes(minutes)}
                  className={`rounded-md px-2.5 py-1 text-xs ${countdownMinutes === minutes ? 'bg-white text-[#1C1917]' : 'text-[#78716C]'}`}
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
          className="h-10 w-full rounded-xl bg-[#C75B3A] text-sm hover:bg-[#B24D2F]"
        >
          <Play size={16} className="mr-1" />
          开始
        </Button>
      </div>
    </div>
  );

  const renderRunning = () => (
    <div data-testid="new-focus-state-running" className="px-4 py-2">
      <div className="space-y-2 rounded-3xl border border-[#FFFFFF80] bg-[#FFFFFFA0] px-5 py-4 shadow-[0_12px_32px_-24px_rgba(0,0,0,0.45)]">
        <button type="button" onClick={enterConfigState} className="flex w-full items-center gap-3 text-left">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FEF0ED] text-[#C75B3A]">
            <Target size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-semibold text-[#1C1917]">{taskName || '未命名任务'}</p>
          </div>
          <ChevronDown size={16} className="text-[#C75B3A]" />
        </button>

        <div className="flex justify-center py-2">
          <span className="font-mono text-[52px] font-light tracking-[0.05em] text-[#1C1917]" data-testid="new-focus-running-clock">
            {formatClock(elapsedMs)}
          </span>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            data-testid="new-focus-pause-resume-button"
            onClick={() => {
              void handlePauseOrResume();
            }}
            className={isPaused ? 'h-10 rounded-[24px] bg-[#16A34A] px-6 hover:bg-[#15803D]' : 'h-10 rounded-[24px] bg-[#EDECE9] px-6 text-[#1C1917] hover:bg-[#E5E3DF]'}
          >
            {isPaused ? <Play size={16} className="mr-1" /> : <Pause size={16} className="mr-1" />}
            {isPaused ? '继续' : '暂停'}
          </Button>

          <Button
            type="button"
            data-testid="new-focus-end-button"
            onClick={handleOpenEndDialog}
            className="h-10 rounded-[24px] bg-[#FDECEB] px-6 text-[#C75B3A] hover:bg-[#F8DED9]"
          >
            <Square size={16} className="mr-1" />
            结束
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="border-y border-[#E8E3DE] bg-white/80" data-testid="new-focus-timer-widget">
      {uiState === 'idle' && renderIdle()}
      {uiState === 'config' && renderConfig()}
      {uiState === 'running' && renderRunning()}

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>结束专注并记录反馈</DialogTitle>
          </DialogHeader>
          <Textarea
            data-testid="new-focus-feedback-textarea"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="记录本次专注的反馈..."
            className="min-h-[96px] resize-none"
          />
          <DialogFooter>
            <Button
              type="button"
              data-testid="new-focus-feedback-confirm"
              onClick={() => {
                void handleConfirmEnd();
              }}
            >
              确认结束
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

