export type TaskStatusChoice = 'continue' | 'suspended' | 'completed' | 'cancelled';

export const TASK_STATUS_SELECTOR_OPTIONS: readonly { key: TaskStatusChoice; label: string }[] = [
  { key: 'suspended', label: '挂起' },
  { key: 'continue', label: '继续' },
  { key: 'completed', label: '完成' },
  { key: 'cancelled', label: '取消' },
] as const;

export const TASK_STATUS_SELECTOR_END_OPTIONS: readonly TaskStatusChoice[] = [
  'suspended',
  'completed',
  'cancelled',
] as const;

interface TaskStatusSelectorProps {
  value: TaskStatusChoice;
  onChange: (choice: TaskStatusChoice) => void;
  helperLabel?: string;
  helperHint?: string;
  allowedChoices?: readonly TaskStatusChoice[];
  optionTestIdPrefix?: string;
  'data-testid'?: string;
}

export function TaskStatusSelector({
  value,
  onChange,
  helperLabel = '关联任务下一步状态',
  helperHint = '请选择',
  allowedChoices,
  optionTestIdPrefix,
  'data-testid': testId = 'feedback-task-status-selector',
}: TaskStatusSelectorProps) {
  const statusOptions = TASK_STATUS_SELECTOR_OPTIONS.filter((option) => (
    !allowedChoices || allowedChoices.includes(option.key)
  ));
  const activeIndex = Math.max(0, statusOptions.findIndex((option) => option.key === value));
  const indicatorWidth = `${100 / Math.max(1, statusOptions.length)}%`;
  const helperId = `${testId}-helper`;

  return (
    <div data-testid="feedback-task-status-section" className="min-w-0 flex flex-col gap-1.5">
      <div id={helperId} className="flex min-w-0 items-start gap-2">
        <span className="shrink-0 text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">{helperLabel}</span>
        <span className="min-w-0 text-[12px] text-[#78716C] dark:text-[#A8A29E]">{helperHint}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={helperLabel}
        aria-describedby={helperId}
        className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
        data-testid={testId}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{ width: indicatorWidth, transform: `translateX(${activeIndex * 100}%)` }}
        />
        <div
          className="relative z-10 grid min-w-0 gap-0"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, statusOptions.length)}, minmax(0, 1fr))` }}
        >
          {statusOptions.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={value === key}
              data-testid={optionTestIdPrefix ? `${optionTestIdPrefix}-${key}` : `feedback-task-status-${key}`}
              onClick={() => onChange(key)}
              className={`relative z-10 min-w-0 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
                value === key
                  ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                  : 'text-[#78716C] hover:text-[#57534E] dark:hover:text-[#D6D3D1]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
