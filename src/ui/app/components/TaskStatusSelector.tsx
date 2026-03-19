export type TaskStatusChoice = 'continue' | 'suspended' | 'completed' | 'cancelled';

const STATUS_OPTIONS: readonly { key: TaskStatusChoice; label: string }[] = [
  { key: 'suspended', label: '挂起' },
  { key: 'continue', label: '继续' },
  { key: 'completed', label: '完成' },
  { key: 'cancelled', label: '取消' },
] as const;

interface TaskStatusSelectorProps {
  value: TaskStatusChoice;
  onChange: (choice: TaskStatusChoice) => void;
  helperLabel?: string;
  helperHint?: string;
  optionTestIdPrefix?: string;
  'data-testid'?: string;
}

export function TaskStatusSelector({
  value,
  onChange,
  helperLabel = '关联任务下一步状态',
  helperHint = '请选择',
  optionTestIdPrefix,
  'data-testid': testId = 'feedback-task-status-selector',
}: TaskStatusSelectorProps) {
  const activeIndex = Math.max(0, STATUS_OPTIONS.findIndex((option) => option.key === value));
  const indicatorWidth = `${100 / STATUS_OPTIONS.length}%`;

  return (
    <div data-testid="feedback-task-status-section" className="min-w-0 flex flex-col gap-1.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="shrink-0 text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">{helperLabel}</span>
        <span className="min-w-0 text-[12px] text-[#78716C] dark:text-[#A8A29E]">{helperHint}</span>
      </div>
      <div
        className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
        data-testid={testId}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{ width: indicatorWidth, transform: `translateX(${activeIndex * 100}%)` }}
        />
        <div className="relative z-10 grid min-w-0 grid-cols-4 gap-0">
          {STATUS_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
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
