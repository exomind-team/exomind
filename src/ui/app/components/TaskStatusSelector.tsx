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
  linkedTaskTitle?: string;
  'data-testid'?: string;
}

export function TaskStatusSelector({
  value,
  onChange,
  linkedTaskTitle,
  'data-testid': testId = 'feedback-task-status-selector',
}: TaskStatusSelectorProps) {
  return (
    <div data-testid="feedback-task-status-section" className="flex flex-col gap-1.5">
      {linkedTaskTitle && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-[#57534E] dark:text-[#A8A29E]">关联任务</span>
          <span className="truncate text-[12px] text-[#1C1917] dark:text-[#FAFAF9]">{linkedTaskTitle}</span>
        </div>
      )}
      <div
        className="relative overflow-hidden rounded-[10px] border border-[#E7E5E4] bg-[#F5F0ED]/50 dark:border-[#FFFFFF20] dark:bg-[#FFFFFF08]"
        data-testid={testId}
      >
        <div className="relative z-10 grid grid-cols-4 gap-0">
          {STATUS_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              data-testid={`feedback-task-status-${key}`}
              onClick={() => onChange(key)}
              className={`relative z-10 h-8 w-full whitespace-nowrap rounded-[8px] px-[8px] text-center text-[12px] transition-colors duration-200 ${
                value === key
                  ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9] bg-white/55 dark:bg-[#FFFFFF14] border border-[#FFFFFFCC] dark:border-[#FFFFFF66] shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
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
