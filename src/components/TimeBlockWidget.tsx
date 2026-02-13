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

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  DEFAULT_TIMER_END_SOUND_PRESET_ID,
  getTimerEndSoundPresetById,
  TIMER_END_SOUND_PRESETS,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';

interface TimeBlockWidgetProps {
  /** 是否展开高级选项 */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * 计时器状态
 */
type TimerState = 'idle' | 'running' | 'paused' | 'ended';

export function TimeBlockWidget({ expanded: controlledExpanded, onExpandedChange }: TimeBlockWidgetProps) {
  // Toast
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

  // 倒计时结束动作（纯前端配置，不持久化）
  const [countdownEndSoundEnabled, setCountdownEndSoundEnabled] = useState(true);
  const [countdownEndSoundPresetId, setCountdownEndSoundPresetId] = useState(DEFAULT_TIMER_END_SOUND_PRESET_ID);
  const [continueAfterCountdownEnd, setContinueAfterCountdownEnd] = useState(false);
  const [countdownOvertimeMs, setCountdownOvertimeMs] = useState(0);

  // 外部控制展开状态
  const expanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const setExpanded = onExpandedChange || ((v: boolean) => setInternalExpanded(v));

  // 定时器引用
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);  // 使用 ref 跟踪运行状态，避免闭包问题
  const countdownEndedRef = useRef(false);
  const countdownOverrunRef = useRef(false);

  // Service
  const timeBlockService = getTimeBlockService();

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

  // 加载进行中的时间块
  useEffect(() => {
    const loadActiveBlock = async () => {
      const block = await timeBlockService.loadActiveBlock();
      if (block) {
        setTaskName(block.name);
        setTimerMode(block.mode);
        setElapsed(block.elapsed);
        setTimerState(block.paused ? 'paused' : 'running');
        startTimeRef.current = block.startTime;
      }
    };
    loadActiveBlock();
  }, []);

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

            // 仅在本次运行从 >0 跨到 <=0 时触发提示音，避免刷新/恢复时重复播放
            if (prev > 0) {
              void playCountdownEndSound();
            }
            setFeedbackOpen(true);
          }

          // 软结束：继续计时直到用户确认结束
          if (continueAfterCountdownEnd) {
            countdownOverrunRef.current = true;
            setCountdownOvertimeMs(overshoot);
            // 持久化层仍保持倒计时归零（不扩展存储结构）
            void timeBlockService.updateElapsed(0);
            return 0;
          }

          // 硬结束：停止计时并进入反馈流程
          setTimerState('ended');
          isRunningRef.current = false;
          if (timerRef.current) {
            cancelAnimationFrame(timerRef.current);
          }
          return 0;
        }

        // 同步到 Service
        timeBlockService.updateElapsed(Math.max(0, newElapsed));

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

  // 开始计时
  const handleStart = async () => {
    if (!taskName.trim()) {
      toast({
        title: '请输入任务标题',
        description: '开始时间块前需要输入任务名称',
        variant: 'destructive',
      });
      return;
    }

    const config: TimerConfig = {
      mode: timerMode,
      minutes: timerMode === 'countdown' ? countdownMinutes : undefined,
    };

    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    setCountdownOvertimeMs(0);

    const block = await timeBlockService.startBlock(taskName.trim(), config);
    setElapsed(block.elapsed);
    setTimerState('running');
    startTimeRef.current = block.startTime;
  };

  // 暂停计时
  const handlePause = async () => {
    setTimerState('paused');
    isRunningRef.current = false;
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
    }
    await timeBlockService.pauseBlock();
  };

  // 继续计时
  const handleResume = async () => {
    setTimerState('running');
    await timeBlockService.resumeBlock();
  };

  // 结束计时
  const handleEnd = () => {
    setFeedbackOpen(true);
  };

  // 结束计时（带反馈）
  const handleEndBlock = async (feedbackText?: string) => {
    isRunningRef.current = false;
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
    }

    await timeBlockService.endBlock(feedbackText || undefined);

    // 重置状态
    setTimerState('idle');
    setElapsed(0);
    setTaskName('');
    setFeedback('');
    countdownEndedRef.current = false;
    countdownOverrunRef.current = false;
    setCountdownOvertimeMs(0);
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        cancelAnimationFrame(timerRef.current);
      }
    };
  }, []);

  // 倒计时结束自动弹窗
  useEffect(() => {
    if (timerState === 'ended' && !feedbackOpen) {
      setFeedbackOpen(true);
    }
  }, [timerState, feedbackOpen]);

  // 按钮状态
  const isIdle = timerState === 'idle';
  const isRunning = timerState === 'running';
  const isPaused = timerState === 'paused';

  return (
    <div className="border-b bg-muted/30" data-testid="timeblock-widget">
      {/* 状态栏 */}
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
                className="gap-1"
              >
                <Pause size={16} />
                <span>暂停</span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleEnd}
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
                className="gap-1 bg-green-600 hover:bg-green-700"
              >
                <Play size={16} />
                <span>继续</span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleEnd}
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

      {/* 展开面板 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* 任务标题 */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">任务标题</label>
            <Input
              placeholder="输入任务标题..."
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              disabled={!isIdle}
              className="h-8"
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

              <div className="space-y-1">
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
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="continue-after-countdown-end" className="text-sm">软结束（结束后继续计时）</Label>
                <Switch
                  id="continue-after-countdown-end"
                  checked={continueAfterCountdownEnd}
                  onCheckedChange={setContinueAfterCountdownEnd}
                  disabled={!isIdle}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 身心反馈对话框 */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>时间块结束</DialogTitle>
            <DialogDescription>
              {taskName || '未命名任务'} 完成了，请输入身心状态反馈：
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="身心状态如何？"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFeedbackOpen(false);
                // 跳过反馈，直接结束
                handleEndBlock();
              }}
            >
              跳过
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setFeedbackOpen(false);
                handleEndBlock(feedback);
              }}
            >
              确认结束
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
