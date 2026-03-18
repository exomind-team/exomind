export type TaskStatusChoice = 'continue' | 'suspended' | 'completed' | 'cancelled';

const LINKED_TASK_TITLE_MAX_CHARS = 100;

const STATUS_OPTIONS: readonly { key: TaskStatusChoice; label: string }[] = [
  { key: 'suspended', label: '挂起' },
  { key: 'continue', label: '继续' },
  { key: 'completed', label: '完成' },
  { key: 'cancelled', label: '取消' },
] as const;

function formatLinkedTaskTitle(title: string): string {
  const chars = Array.from(title);
  if (chars.length <= LINKED_TASK_TITLE_MAX_CHARS) {
    return title;
  }
  return `${chars.slice(0, LINKED_TASK_TITLE_MAX_CHARS).join('')}...`;
}

interface TaskStatusSelectorProps {
  value: TaskStatusChoice;
  onChange: (choice: TaskStatusChoice) => void;
  linkedTaskTitle?: string;
  'data-testid'?: string;
}

export function TaskStatusSelector({
  value,
  onChange,
  linkedTaskTitle,
  'data-testid': testId = 'feedback-task-status-selector',
}: TaskStatusSelectorProps) {
  const displayLinkedTaskTitle = linkedTaskTitle ? formatLinkedTaskTitle(linkedTaskTitle) : null;
  const activeIndex = Math.max(0, STATUS_OPTIONS.findIndex((option) => option.key === value));
  const indicatorWidth = `${100 / STATUS_OPTIONS.length}%`;

  return (
    <div data-testid="feedback-task-status-section" className="flex flex-col gap-1.5">
      {linkedTaskTitle && displayLinkedTaskTitle && (
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">关联任务</span>
          <span
            data-testid="feedback-task-linked-title"
            title={linkedTaskTitle}
            className="min-w-0 flex-1 whitespace-normal break-all text-[12px] leading-5 text-[#1C1917] dark:text-[#FAFAF9]"
          >
            {displayLinkedTaskTitle}
          </span>
        </div>
      )}
      <div
        className="relative overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
        data-testid={testId}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 rounded-[8px] border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{ width: indicatorWidth, transform: `translateX(${activeIndex * 100}%)` }}
        />
        <div className="relative z-10 grid grid-cols-4 gap-0">
          {STATUS_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              data-testid={`feedback-task-status-${key}`}
              onClick={() => onChange(key)}
              className={`relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
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
