interface SlidingSegmentedOption<T extends string> {
  key: T
  label: string
  title?: string
  testId?: string
}

interface SlidingSegmentedControlProps<T extends string> {
  options: ReadonlyArray<SlidingSegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
  buttonClassName?: string
  minButtonWidthClassName?: string
}

export function SlidingSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  buttonClassName = '',
  minButtonWidthClassName = 'min-w-[56px]',
}: SlidingSegmentedControlProps<T>) {
  const activeIndex = Math.max(options.findIndex((option) => option.key === value), 0)

  return (
    <div
      className={`relative select-none overflow-hidden rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 ${className}`.trim()}
    >
      <div
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      <div
        className="relative z-10 grid gap-0"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const isActive = option.key === value
          return (
            <button
              key={option.key}
              type="button"
              data-testid={option.testId}
              title={option.title}
              onClick={() => onChange(option.key)}
              className={`relative z-10 select-none ${minButtonWidthClassName} rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
              } ${buttonClassName}`.trim()}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
