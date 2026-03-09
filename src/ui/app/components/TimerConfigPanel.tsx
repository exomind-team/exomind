import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import type { TimerMode } from '@/lib/services';

const PRESET_COUNTDOWN_MINUTES = [15, 25, 45, 60] as const;

function isPresetCountdownMinutes(minutes: number): boolean {
  return PRESET_COUNTDOWN_MINUTES.includes(minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number]);
}

function expectedOptionClass(active: boolean): string {
  return `relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
    active
      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
      : 'text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]'
  }`;
}

function resolveCountdownOptionIndex(minutes: number): number {
  const presetIndex = PRESET_COUNTDOWN_MINUTES.indexOf(minutes as (typeof PRESET_COUNTDOWN_MINUTES)[number]);
  return presetIndex >= 0 ? presetIndex : PRESET_COUNTDOWN_MINUTES.length;
}

interface TimerConfigPanelProps {
  timerMode: TimerMode;
  countdownMinutes: number;
  setTimerMode: (mode: TimerMode) => void;
  setCountdownMinutes: (minutes: number) => void;
  customDurationDraft: string;
  setCustomDurationDraft: (draft: string) => void;
  commitCustomDuration: () => void;
}

export function TimerConfigPanel({
  timerMode,
  countdownMinutes,
  setTimerMode,
  setCountdownMinutes,
  customDurationDraft,
  setCustomDurationDraft,
  commitCustomDuration,
}: TimerConfigPanelProps) {
  const customDurationInputRef = useRef<HTMLInputElement | null>(null);
  const [isCustomDurationEditing, setIsCustomDurationEditing] = useState(false);

  const isCustomDurationSelected = timerMode === 'countdown' && !isPresetCountdownMinutes(countdownMinutes);
  const customDurationTriggerText = isCustomDurationSelected ? `${countdownMinutes}m` : '自定义';
  const activeCountdownOptionIndex = resolveCountdownOptionIndex(countdownMinutes);

  useEffect(() => {
    if (timerMode !== 'countdown') {
      setIsCustomDurationEditing(false);
    }
  }, [timerMode]);

  useEffect(() => {
    if (!isCustomDurationEditing) {
      return;
    }

    requestAnimationFrame(() => {
      customDurationInputRef.current?.focus();
      customDurationInputRef.current?.select();
    });
  }, [isCustomDurationEditing]);

  const closeCustomDurationEditor = () => {
    setIsCustomDurationEditing(false);
  };

  const handleCustomDurationCommit = () => {
    commitCustomDuration();
    closeCustomDurationEditor();
  };

  const handleCustomDurationKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCustomDurationCommit();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setCustomDurationDraft(String(countdownMinutes));
      closeCustomDurationEditor();
    }
  };

  return (
    <>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="task-mode-countdown"
          aria-pressed={timerMode === 'countdown'}
          onClick={() => setTimerMode('countdown')}
          className={`rounded-xl px-3 py-1.5 text-xs ${timerMode === 'countdown' ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
        >
          倒计时
        </button>
        <button
          type="button"
          data-testid="task-mode-countup"
          aria-pressed={timerMode === 'countup'}
          onClick={() => setTimerMode('countup')}
          className={`rounded-xl px-3 py-1.5 text-xs ${timerMode === 'countup' ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'}`}
        >
          正计时
        </button>
      </div>

      {timerMode === 'countdown' ? (
        <div className="mt-3 flex min-w-0 flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">预期时长</span>
          <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#FFFFFF60] bg-white/35 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]">
            <div
              data-testid="task-countdown-active-indicator"
              className="pointer-events-none absolute inset-y-0 left-0 w-1/5 rounded-[8px] border border-[#FFFFFFCC] bg-white/55 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out dark:border-[#FFFFFF66] dark:bg-[#FFFFFF14]"
              style={{ transform: `translateX(${activeCountdownOptionIndex * 100}%)` }}
            />
            <div className="relative z-10 grid min-w-0 grid-cols-5 gap-0">
              {PRESET_COUNTDOWN_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  data-testid={`task-countdown-preset-${minutes}`}
                  onClick={() => {
                    closeCustomDurationEditor();
                    setCountdownMinutes(minutes);
                  }}
                  className={expectedOptionClass(countdownMinutes === minutes)}
                >
                  {minutes}m
                </button>
              ))}

              {isCustomDurationEditing ? (
                <Input
                  ref={customDurationInputRef}
                  data-testid="task-countdown-custom-input"
                  value={customDurationDraft}
                  onChange={(event) => {
                    setCustomDurationDraft(event.target.value.replace(/[^\d]/g, ''));
                  }}
                  onBlur={handleCustomDurationCommit}
                  onKeyDown={handleCustomDurationKeyDown}
                  aria-label="自定义倒计时分钟（Custom countdown minutes）"
                  placeholder="分钟"
                  className="relative z-10 h-8 w-full border-transparent bg-transparent px-[6px] text-center text-[12px] font-semibold leading-none text-[#1C1917] shadow-none outline-none ring-0 focus-visible:ring-0 dark:text-[#FAFAF9]"
                />
              ) : (
                <button
                  type="button"
                  data-testid="task-countdown-custom-trigger"
                  onClick={() => setIsCustomDurationEditing(true)}
                  className={`relative z-10 flex h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded-[8px] px-[8px] text-[12px] transition-colors duration-200 ${
                    isCustomDurationSelected
                      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                      : 'text-[#C75B3A] hover:text-[#B24D2F]'
                  }`}
                  aria-label="自定义倒计时（Custom countdown）"
                >
                  <ChevronDown size={12} className="transition-transform" />
                  {customDurationTriggerText}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
