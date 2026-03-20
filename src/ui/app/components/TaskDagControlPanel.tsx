import { EyeOff, LocateFixed, Maximize2, Search } from 'lucide-react';
import type { DagDirection } from '@/ui/app/pages/task-dag-layout';
import { SlidingSegmentedControl } from '@/ui/app/components/SlidingSegmentedControl';
import type { TaskDagSearchOptions } from '@/ui/app/pages/task-title-fuzzy-search';

interface TaskDagControlPanelProps {
  direction: DagDirection;
  searchValue: string;
  searchMatchCount: number;
  searchOptions: TaskDagSearchOptions;
  hideTerminal: boolean;
  hasActiveBlock: boolean;
  immersive: boolean;
  onDirectionChange: (direction: DagDirection) => void;
  onSearchValueChange: (value: string) => void;
  onSearchOptionToggle: (key: keyof TaskDagSearchOptions) => void;
  onToggleHideTerminal: () => void;
  onFitView: () => void;
  onToggleImmersive: () => void;
  onJumpToCurrentRoot: () => void;
}

function legendChip(label: string, title: string, className: string, testId: string) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[10px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

const DIRECTION_OPTIONS: ReadonlyArray<{
  key: DagDirection;
  label: string;
  title: string;
  testId: string;
}> = [
  { key: 'TB', label: '↕', title: '纵向布局', testId: 'task-dag-direction-tb' },
  { key: 'auto', label: 'A', title: '自动布局方向', testId: 'task-dag-direction-auto' },
  { key: 'LR', label: '⟷', title: '横向布局', testId: 'task-dag-direction-lr' },
];

export function TaskDagControlPanel({
  direction,
  searchValue,
  searchMatchCount,
  searchOptions,
  hideTerminal,
  hasActiveBlock,
  immersive,
  onDirectionChange,
  onSearchValueChange,
  onSearchOptionToggle,
  onToggleHideTerminal,
  onFitView: _onFitView,
  onToggleImmersive,
  onJumpToCurrentRoot,
}: TaskDagControlPanelProps) {
  const hasSearch = searchValue.trim().length > 0;
  const searchOptionLabels: Array<{ key: keyof TaskDagSearchOptions; label: string; testId: string }> = [
    { key: 'includeDescription', label: '描述', testId: 'task-dag-search-option-description' },
    { key: 'fuzzy', label: '模糊', testId: 'task-dag-search-option-fuzzy' },
    { key: 'filterMode', label: '过滤', testId: 'task-dag-search-option-filter' },
  ];

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] flex-col items-end gap-2">
      <div
        className={[
          'pointer-events-auto flex w-full items-center gap-2 rounded-2xl border border-[#E7E3E0] bg-white/90 p-2 text-[11px] text-[#57534E] shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]',
          immersive ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : '',
        ].join(' ')}
      >
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[#E7E3E0] bg-white/80 px-3 py-2 text-[11px] text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E]">
          <Search size={12} />
          <input
            data-testid="task-dag-search-input"
            value={searchValue}
            onChange={(event) => onSearchValueChange(event.target.value)}
            placeholder="搜索节点标题..."
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-[#A8A29E]"
          />
          {hasSearch ? (
            <span
              data-testid="task-dag-search-match-count"
              className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-medium text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]"
            >
              {searchMatchCount}
            </span>
          ) : null}
        </label>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {searchOptionLabels.map(({ key, label, testId }) => {
            const active = searchOptions[key];
            return (
              <button
                key={key}
                type="button"
                data-testid={testId}
                onClick={() => onSearchOptionToggle(key)}
                className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                  active
                    ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                    : 'text-[#A8A29E] hover:text-[#57534E] dark:text-[#78716C] dark:hover:text-[#D6D3D1]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={[
          'pointer-events-auto flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-[#E7E3E0] bg-white/90 p-2 shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90',
          immersive ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : '',
        ].join(' ')}
      >
        <button
          type="button"
          data-testid="task-dag-hide-terminal-toggle"
          onClick={onToggleHideTerminal}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-[11px] font-medium shadow-sm transition-colors ${
            hideTerminal
              ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
              : 'border-[#E7E3E0] bg-white/80 text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E]'
          }`}
        >
          <EyeOff size={12} />
          隐藏已结束
        </button>

        <button
          type="button"
          data-testid="task-dag-immersive-toggle"
          onClick={onToggleImmersive}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-[11px] font-medium shadow-sm transition-colors ${
            immersive
              ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
              : 'border-[#E7E3E0] bg-white/80 text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E]'
          }`}
        >
          <Maximize2 size={12} />
          {immersive ? '退出沉浸' : '沉浸模式'}
        </button>

        <SlidingSegmentedControl
          options={DIRECTION_OPTIONS}
          value={direction}
          onChange={onDirectionChange}
          className="bg-white/80 dark:border-[#3C3836] dark:bg-[#120F0D]"
          buttonClassName="h-7 px-2"
          minButtonWidthClassName="min-w-[32px]"
        />

        <button
          type="button"
          data-testid="task-dag-jump-to-root"
          onClick={onJumpToCurrentRoot}
          className="inline-flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/80 px-3 py-2 text-[11px] font-medium text-[#57534E] shadow-sm transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
        >
          <LocateFixed size={12} />
          {hasActiveBlock ? '聚焦执行中' : '聚焦可执行'}
        </button>

      </div>

      <div
        className={[
          'pointer-events-auto flex items-center gap-2 rounded-full border border-[#E7E3E0] bg-white/90 px-2 py-1 text-[11px] text-[#57534E] shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]',
          immersive ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : '',
        ].join(' ')}
      >
        {legendChip('H', '硬依赖：前置必须完成后才能开始', 'bg-[#FDE7DC] text-[#C75B3A]', 'task-dag-legend-hard-chip')}
        {legendChip('S', '软依赖：前置任务开始后即可开始', 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]', 'task-dag-legend-soft-chip')}
      </div>

    </div>
  );
}
