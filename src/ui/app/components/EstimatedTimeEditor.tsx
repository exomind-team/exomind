import { ChevronDown } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { getTaskService } from '@/lib/services';

const PRESET_ESTIMATED_MINUTES = [15, 25, 45, 60] as const;

function expectedOptionClass(active: boolean): string {
  return `relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
    active
      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
      : 'text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]'
  }`;
}

function isPresetEstimatedMinutes(minutes: number): boolean {
  return PRESET_ESTIMATED_MINUTES.includes(minutes as (typeof PRESET_ESTIMATED_MINUTES)[number]);
}

function normalizePositiveMinutes(value: string): number | undefined {
  const digitsOnly = value.replace(/[^\d]/g, '');
  if (digitsOnly.length === 0) return undefined;

  const parsed = Number.parseInt(digitsOnly, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}


export interface EstimatedTimeEditorProps {
  taskId: string;
  currentMinutes?: number;
  disabled?: boolean;
  onUpdate?: (minutes: number | undefined) => void;
}

export function EstimatedTimeEditor({
  taskId,
  currentMinutes,
  disabled = false,
  onUpdate,
}: EstimatedTimeEditorProps) {
  const activeTaskIdRef = useRef(taskId);
  const [minutes, setMinutes] = useState<number | undefined>(currentMinutes);
  const [customDraft, setCustomDraft] = useState(currentMinutes ? String(currentMinutes) : '');
  const [isCustomEditing, setIsCustomEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    activeTaskIdRef.current = taskId;
    setMinutes(currentMinutes);
    setCustomDraft(currentMinutes ? String(currentMinutes) : '');
    setIsCustomEditing(false);
    setErrorMessage(null);
    setIsSaving(false);
  }, [currentMinutes, taskId]);

  useEffect(() => {
    if (!isCustomEditing) return;

    const timer = window.setTimeout(() => {
      customInputRef.current?.focus();
      customInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isCustomEditing]);

  const activeIndex = minutes === undefined
    ? 0
    : isPresetEstimatedMinutes(minutes)
      ? PRESET_ESTIMATED_MINUTES.indexOf(minutes as (typeof PRESET_ESTIMATED_MINUTES)[number]) + 1
      : PRESET_ESTIMATED_MINUTES.length + 1;
  const isCustomSelected = minutes !== undefined && !isPresetEstimatedMinutes(minutes);

  async function persistMinutes(nextMinutes: number | undefined): Promise<void> {
    const requestTaskId = taskId;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const updated = await getTaskService().updateTask(requestTaskId, { estimatedMinutes: nextMinutes });
      if (!updated) {
        throw new Error('当前任务不存在，估时未保存');
      }
      if (activeTaskIdRef.current !== requestTaskId) return;

      setMinutes(nextMinutes);
      setCustomDraft(nextMinutes ? String(nextMinutes) : '');
      setIsCustomEditing(false);
      onUpdate?.(nextMinutes);
    } catch (error) {
      if (activeTaskIdRef.current !== requestTaskId) return;
      setErrorMessage(error instanceof Error ? error.message : '估时保存失败，请稍后重试');
    } finally {
      if (activeTaskIdRef.current !== requestTaskId) return;
      setIsSaving(false);
    }
  }

  function openCustomEditor(): void {
    setErrorMessage(null);
    setCustomDraft(minutes ? String(minutes) : '');
    setIsCustomEditing(true);
  }

  function applyCustomMinutes(value: string): void {
    const nextMinutes = normalizePositiveMinutes(value);

    if (nextMinutes === undefined) {
      if (value.trim().length === 0) {
        setErrorMessage(null);
        setCustomDraft(minutes ? String(minutes) : '');
        setIsCustomEditing(false);
        return;
      }

      setErrorMessage('请输入正整数分钟');
      customInputRef.current?.focus();
      return;
    }

    void persistMinutes(nextMinutes);
  }

  function handleCustomInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyCustomMinutes(customDraft);
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setErrorMessage(null);
      setCustomDraft(minutes ? String(minutes) : '');
      setIsCustomEditing(false);
    }
  }

  return (
    <div className={`flex min-w-0 flex-col gap-2${disabled ? ' opacity-50 cursor-not-allowed' : ''}`} data-testid="estimated-time-editor">
      <div
        className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
        data-testid="estimated-time-selector"
      >
        <div
          data-testid="estimated-time-active-indicator"
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{ width: `${100 / 6}%`, transform: `translateX(${activeIndex * 100}%)` }}
        />

        <div className="relative z-10 grid min-w-0 grid-cols-6 gap-0">
          <button
            type="button"
            data-testid="estimated-time-preset-none"
            aria-pressed={minutes === undefined}
            disabled={disabled || isSaving}
            onClick={() => {
              void persistMinutes(undefined);
            }}
            className={expectedOptionClass(minutes === undefined)}
          >
            无
          </button>
          {PRESET_ESTIMATED_MINUTES.map((preset) => (
            <button
              key={preset}
              type="button"
              data-testid={`estimated-time-preset-${preset}`}
              aria-pressed={minutes === preset}
              disabled={disabled || isSaving}
              onClick={() => {
                void persistMinutes(preset);
              }}
              className={expectedOptionClass(minutes === preset)}
            >
              {preset}m
            </button>
          ))}

          {isCustomEditing ? (
            <Input
              ref={customInputRef}
              data-testid="estimated-time-custom-input"
              value={customDraft}
              disabled={disabled || isSaving}
              onChange={(event) => {
                setCustomDraft(event.target.value.replace(/[^\d]/g, ''));
              }}
              onBlur={() => applyCustomMinutes(customDraft)}
              onKeyDown={handleCustomInputKeyDown}
              aria-label="自定义估时分钟（Custom estimated minutes）"
              placeholder="分钟"
              className="relative z-10 h-8 w-full border-transparent bg-transparent px-[6px] text-center text-[12px] font-semibold leading-none text-[#1C1917] shadow-none outline-none ring-0 focus-visible:ring-0 dark:text-[#FAFAF9]"
            />
          ) : (
            <button
              type="button"
              data-testid="estimated-time-custom-trigger"
              aria-pressed={isCustomSelected}
              disabled={disabled || isSaving}
              onClick={openCustomEditor}
              className={`relative z-10 flex h-8 w-full items-center justify-center gap-1 whitespace-nowrap rounded-[8px] px-[8px] text-[12px] transition-colors duration-200 ${
                isCustomSelected
                  ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                  : 'text-[#C75B3A] hover:text-[#B24D2F]'
              }`}
              aria-label="自定义估时（Custom estimated minutes）"
            >
              <ChevronDown size={12} className="transition-transform" />
              {isCustomSelected ? `${minutes}m` : '自定义'}
            </button>
          )}
        </div>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
          {errorMessage}
        </p>
      ) : null}
      {disabled ? <p className="text-xs text-[#A8A29E]">终态任务不可编辑</p> : null}
    </div>
  );
}
