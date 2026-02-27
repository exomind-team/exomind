import { Pause, Play, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TaskItem, TaskTimerMode } from '@/lib/types/task';

function formatClock(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export interface TaskTimerCardProps {
  task: TaskItem;
  onModeChange?: (mode: TaskTimerMode) => void;
  onPauseToggle?: (paused: boolean) => void;
}

export function TaskTimerCard({ task, onModeChange, onPauseToggle }: TaskTimerCardProps) {
  const [mode, setMode] = useState<TaskTimerMode>(task.timer.mode);
  const [paused, setPaused] = useState<boolean>(task.timer.paused);
  const [factInput, setFactInput] = useState('');

  const timerText = useMemo(() => {
    if (mode === 'countdown') {
      return formatClock(task.timer.remainingMs ?? task.timer.elapsedMs);
    }
    return formatClock(task.timer.elapsedMs);
  }, [mode, task.timer.elapsedMs, task.timer.remainingMs]);

  const handleModeChange = (nextMode: TaskTimerMode) => {
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  const handlePauseToggle = () => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    onPauseToggle?.(nextPaused);
  };

  return (
    <section className="relative mx-auto w-full max-w-[390px] px-4 py-4" data-testid="task-timer-card">
      <div
        data-testid="task-timer-glow"
        className="absolute inset-x-4 bottom-3 top-4 rounded-[22px] bg-gradient-to-br from-[#EDADA0] via-[#E08E7A] to-[#D4785F] blur-[8px] dark:from-[#8B3A25] dark:via-[#6B2E1E] dark:to-[#4A1F14]"
        aria-hidden
      />

      <div
        data-testid="task-timer-main-card"
        className="relative flex flex-col gap-3 rounded-[24px] border border-[#FFFFFF80] bg-[linear-gradient(180deg,rgba(255,255,255,0.64)_0%,rgba(255,255,255,0.36)_100%)] px-[18px] py-4 backdrop-blur-[24px] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-6px_rgba(0,0,0,0.08),0_20px_40px_-8px_rgba(0,0,0,0.05)] dark:border-[#FFFFFF15] dark:[background-color:rgba(28,25,23,0.5)] dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]"
      >
        <div className="flex items-center gap-[10px]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FEF0ED] text-[#C75B3A] dark:bg-[#2A1510] dark:text-[#E8734E]">
            <Target size={20} />
          </div>
          <p className="truncate text-[16px] font-semibold leading-[1.4] text-[#1C1917] dark:text-[#FAFAF9]">{task.title}</p>
        </div>

        <div className="h-px w-full bg-[#D4785F30] dark:bg-[#D4785F20]" />

        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">计时模式</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="task-mode-countup"
              aria-pressed={mode === 'countup'}
              onClick={() => handleModeChange('countup')}
              className={`rounded-[8px] px-[10px] py-[6px] text-[12px] ${mode === 'countup' ? 'bg-white/90 text-[#1C1917] dark:bg-[#FFFFFF20] dark:text-[#FAFAF9]' : 'text-[#A8A29E]'}`}
            >
              正计时
            </button>
            <button
              type="button"
              data-testid="task-mode-countdown"
              aria-pressed={mode === 'countdown'}
              onClick={() => handleModeChange('countdown')}
              className={`rounded-[8px] px-[10px] py-[6px] text-[12px] ${mode === 'countdown' ? 'bg-white/90 text-[#1C1917] dark:bg-[#FFFFFF20] dark:text-[#FAFAF9]' : 'text-[#A8A29E]'}`}
            >
              倒计时
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-1 pt-1">
          <button
            type="button"
            data-testid="task-pause-button"
            className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#EDECE9] text-[#1C1917] hover:bg-[#E5E3DF] dark:bg-[#292524] dark:text-[#FAFAF9]"
            onClick={handlePauseToggle}
          >
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <span className="font-mono text-[40px] leading-[1.1] tracking-[2px] text-[#1C1917] dark:text-[#FAFAF9]">{timerText}</span>
          <div className="h-11 w-11" />
        </div>

        <div className="rounded-[12px] border border-[#E7E5E4] bg-white/70 px-3 py-2 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF10]">
          <input
            value={factInput}
            onChange={(event) => setFactInput(event.target.value)}
            placeholder="记录当下的事实..."
            className="w-full bg-transparent text-sm text-[#44403C] outline-none placeholder:text-[#A8A29E] dark:text-[#E7E5E4] dark:placeholder:text-[#78716C]"
          />
        </div>
      </div>
    </section>
  );
}

