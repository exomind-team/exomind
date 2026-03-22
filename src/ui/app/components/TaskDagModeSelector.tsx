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
  immersive?: boolean;
}

export function TaskDagModeSelector({
  mode,
  enabledModes = ['browse'],
  onChange,
  immersive = false,
}: TaskDagModeSelectorProps) {
  const enabledModeSet = new Set(enabledModes);
  const activeIndex = MODE_OPTIONS.findIndex((option) => option.key === mode);
  const enabledOptions = MODE_OPTIONS.filter((option) => enabledModeSet.has(option.key));

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
      <div
        data-testid="task-dag-mode-selector"
        className={[
          'pointer-events-auto relative overflow-hidden rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90',
          immersive ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : '',
        ].join(' ')}
        onWheel={(event) => {
          if (enabledOptions.length <= 1) {
            return;
          }
          event.preventDefault();
          const delta = event.deltaY > 0 ? 1 : -1;
          const currentIndex = enabledOptions.findIndex((option) => option.key === mode);
          const nextIndex = (currentIndex + delta + enabledOptions.length) % enabledOptions.length;
          onChange(enabledOptions[nextIndex].key);
        }}
      >
        <div
          data-testid="task-dag-mode-active-indicator"
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{
            width: `calc((100% - 8px) / ${MODE_OPTIONS.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />

        <div className="relative z-10 grid grid-cols-3 gap-0">
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
                  'relative z-10 min-w-[56px] rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
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
    </div>
  );
}
