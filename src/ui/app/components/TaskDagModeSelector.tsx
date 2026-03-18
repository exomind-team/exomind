export type TaskDagMode = 'browse' | 'connect' | 'execute';

const MODE_OPTIONS: ReadonlyArray<{
  key: TaskDagMode;
  label: string;
}> = [
  { key: 'browse', label: '浏览' },
  { key: 'connect', label: '连接' },
  { key: 'execute', label: '执行' },
];

interface TaskDagModeSelectorProps {
  mode: TaskDagMode;
  enabledModes?: ReadonlyArray<TaskDagMode>;
  onChange: (mode: TaskDagMode) => void;
}

export function TaskDagModeSelector({
  mode,
  enabledModes = ['browse'],
  onChange,
}: TaskDagModeSelectorProps) {
  const enabledModeSet = new Set(enabledModes);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
        {MODE_OPTIONS.map((option) => {
          const isActive = option.key === mode;
          const isEnabled = enabledModeSet.has(option.key);
          return (
            <button
              key={option.key}
              type="button"
              data-testid={`task-dag-mode-${option.key}`}
              title={isEnabled ? `${option.label}模式` : `${option.label}模式将在后续 Wave 激活`}
              disabled={!isEnabled}
              onClick={() => onChange(option.key)}
              className={[
                'rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                isActive
                  ? 'bg-[#C75B3A] text-white'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]',
                !isEnabled ? 'cursor-not-allowed opacity-50 hover:text-inherit' : '',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
