import { EyeOff, Grid2X2, LocateFixed, Maximize2, Search, Settings2 } from 'lucide-react';
import type { TaskDagTagFilter } from '@/config/task-dag-preferences';
import type { DagDirection } from '@/ui/app/pages/task-dag-layout';
import { SlidingSegmentedControl } from '@/ui/app/components/SlidingSegmentedControl';
import type { TaskDagSearchOptions } from '@/ui/app/pages/task-title-fuzzy-search';

export type TaskDagTerminalFilterMode = 'show' | 'smart' | 'hide';
export type TaskDagBackgroundMode = 'none' | 'dots' | 'lines';
export type TaskDagLayoutMode = 'auto' | 'manual';

interface TaskDagControlPanelProps {
  isDesktop: boolean;
  direction: DagDirection;
  layoutMode: TaskDagLayoutMode;
  searchValue: string;
  searchMatchCount: number;
  hasActiveUnifiedSearch: boolean;
  searchOptions: TaskDagSearchOptions;
  availableTags: string[];
  tagFilter: TaskDagTagFilter;
  hiddenRunningByTagFilterCount: number;
  terminalFilterMode: TaskDagTerminalFilterMode;
  backgroundMode: TaskDagBackgroundMode;
  hasActiveBlock: boolean;
  immersive: boolean;
  mobileSearchOpen: boolean;
  mobileToolsOpen: boolean;
  onDirectionChange: (direction: DagDirection) => void;
  onLayoutModeChange: (mode: TaskDagLayoutMode) => void;
  onSearchValueChange: (value: string) => void;
  onSearchOptionToggle: (key: keyof TaskDagSearchOptions) => void;
  onTagToggle: (tag: string) => void;
  onTagFilterModeChange: (mode: TaskDagTagFilter['matchMode']) => void;
  onClearTagFilter: () => void;
  onCycleTerminalFilterMode: () => void;
  onBackgroundModeChange: (mode: TaskDagBackgroundMode) => void;
  onFitView: () => void;
  onToggleImmersive: () => void;
  onJumpToCurrentRoot: () => void;
  onMobileSearchOpenChange: (open: boolean) => void;
  onMobileToolsOpenChange: (open: boolean) => void;
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
  isDesktop,
  direction,
  layoutMode,
  searchValue,
  searchMatchCount,
  hasActiveUnifiedSearch,
  searchOptions,
  availableTags,
  tagFilter,
  hiddenRunningByTagFilterCount,
  terminalFilterMode,
  backgroundMode,
  hasActiveBlock,
  immersive,
  mobileSearchOpen,
  mobileToolsOpen,
  onDirectionChange,
  onLayoutModeChange,
  onSearchValueChange,
  onSearchOptionToggle,
  onTagToggle,
  onTagFilterModeChange,
  onClearTagFilter,
  onCycleTerminalFilterMode,
  onBackgroundModeChange,
  onFitView: _onFitView,
  onToggleImmersive,
  onJumpToCurrentRoot,
  onMobileSearchOpenChange,
  onMobileToolsOpenChange,
}: TaskDagControlPanelProps) {
  const immersiveFadeClass = immersive && isDesktop
    ? 'opacity-0 hover:opacity-100 focus-within:opacity-100'
    : '';
  const searchOptionLabels: Array<{ key: keyof TaskDagSearchOptions; label: string; testId: string }> = [
    { key: 'includeDescription', label: '描述', testId: 'task-dag-search-option-description' },
    { key: 'fuzzy', label: '模糊', testId: 'task-dag-search-option-fuzzy' },
    { key: 'filterMode', label: '过滤', testId: 'task-dag-search-option-filter' },
  ];
  const hasTagFilter = tagFilter.selectedTags.length > 0;
  const terminalFilterLabels: Record<TaskDagTerminalFilterMode, string> = {
    show: '显示全部',
    smart: '智能隐藏',
    hide: '严格隐藏',
  };
  const backgroundOptions: Array<{ key: TaskDagBackgroundMode; label: string; testId: string }> = [
    { key: 'none', label: '无', testId: 'task-dag-background-none' },
    { key: 'dots', label: '点阵', testId: 'task-dag-background-dots' },
    { key: 'lines', label: '网格', testId: 'task-dag-background-lines' },
  ];
  const layoutModeOptions: Array<{ key: TaskDagLayoutMode; label: string; testId: string }> = [
    { key: 'auto', label: '自动布局', testId: 'task-dag-layout-mode-auto' },
    { key: 'manual', label: '手动布局', testId: 'task-dag-layout-mode-manual' },
  ];

  const searchPanel = (
    <div
      data-testid="task-dag-search-panel"
      className={[
        'pointer-events-auto flex w-full flex-col gap-2 rounded-2xl border border-[#E7E3E0] bg-white/90 p-2 text-[11px] text-[#57534E] shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]',
        immersiveFadeClass,
      ].join(' ')}
    >
      <div className="flex w-full items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[#E7E3E0] bg-white/80 px-3 py-2 text-[11px] text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E]">
          <Search size={12} />
          <input
            data-testid="task-dag-search-input"
            value={searchValue}
            onChange={(event) => onSearchValueChange(event.target.value)}
            placeholder="搜索节点标题..."
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-[#A8A29E]"
          />
          {hasActiveUnifiedSearch ? (
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

      {availableTags.length > 0 ? (
        <div className="flex w-full flex-col gap-2 rounded-2xl border border-[#E7E3E0]/80 bg-[#FAF7F5]/80 px-3 py-2 dark:border-[#3C3836]/80 dark:bg-[#120F0D]/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A8A29E]">
              标签
            </span>
            {hasTagFilter ? (
              <span
                data-testid="task-dag-tag-filter-summary"
                className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-medium text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]"
              >
                已选标签
              </span>
            ) : null}
            {hiddenRunningByTagFilterCount > 0 ? (
              <span
                data-testid="task-dag-hidden-running-filter-notice"
                className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-medium text-[#B91C1C] dark:bg-[#2F1313] dark:text-[#FCA5A5]"
              >
                {hiddenRunningByTagFilterCount}
                {' '}
                个进行中任务已被隐藏
              </span>
            ) : null}
            {hasTagFilter ? (
              <button
                type="button"
                data-testid="task-dag-tag-filter-clear"
                onClick={onClearTagFilter}
                className="rounded-full px-2 py-1 text-[10px] font-medium text-[#A8A29E] transition-colors hover:text-[#57534E] dark:text-[#78716C] dark:hover:text-[#D6D3D1]"
              >
                清除标签
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {availableTags.map((tag) => {
              const active = tagFilter.selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  data-testid={`task-dag-tag-filter-${tag}`}
                  onClick={() => onTagToggle(tag)}
                  className={`rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${
                    active
                      ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                      : 'border-[#E7E3E0] bg-white/80 text-[#78716C] hover:text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E] dark:hover:text-[#D6D3D1]'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#A8A29E]">
              多标签匹配
            </span>
            <div className="flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/80 p-1 dark:border-[#3C3836] dark:bg-[#120F0D]">
              {(['and', 'or'] as const).map((mode) => {
                const active = tagFilter.matchMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`task-dag-tag-filter-mode-${mode}`}
                    onClick={() => onTagFilterModeChange(mode)}
                    className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                      active
                        ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                        : 'text-[#A8A29E] hover:text-[#57534E] dark:text-[#78716C] dark:hover:text-[#D6D3D1]'
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const toolsPanel = (
    <div
      data-testid="task-dag-tools-panel"
      className={[
        'pointer-events-auto flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-[#E7E3E0] bg-white/90 p-2 shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90',
        immersiveFadeClass,
      ].join(' ')}
    >
      <button
        type="button"
        data-testid="task-dag-hide-terminal-toggle"
        onClick={onCycleTerminalFilterMode}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-[11px] font-medium shadow-sm transition-colors ${
          terminalFilterMode === 'show'
            ? 'border-[#E7E3E0] bg-white/80 text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E]'
            : 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
        }`}
      >
        <EyeOff size={12} />
        {terminalFilterLabels[terminalFilterMode]}
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

      <div className="flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/80 px-1 py-1 dark:border-[#3C3836] dark:bg-[#120F0D]">
        <Grid2X2 size={12} className="ml-2 text-[#A8A29E]" />
        {backgroundOptions.map(({ key, label, testId }) => (
          <button
            key={key}
            type="button"
            data-testid={testId}
            onClick={() => onBackgroundModeChange(key)}
            className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
              backgroundMode === key
                ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                : 'text-[#A8A29E] hover:text-[#57534E] dark:text-[#78716C] dark:hover:text-[#D6D3D1]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <SlidingSegmentedControl
        options={DIRECTION_OPTIONS}
        value={direction}
        onChange={onDirectionChange}
        className="bg-white/80 dark:border-[#3C3836] dark:bg-[#120F0D]"
        buttonClassName="h-7 px-2"
        minButtonWidthClassName="min-w-[32px]"
      />

      <div className="flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/80 px-1 py-1 dark:border-[#3C3836] dark:bg-[#120F0D]">
        {layoutModeOptions.map(({ key, label, testId }) => (
          <button
            key={key}
            type="button"
            data-testid={testId}
            onClick={() => onLayoutModeChange(key)}
            className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
              layoutMode === key
                ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                : 'text-[#A8A29E] hover:text-[#57534E] dark:text-[#78716C] dark:hover:text-[#D6D3D1]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

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
  );

  const legendPanel = (
    <div
      data-testid="task-dag-legend-panel"
      className={[
        'pointer-events-auto flex items-center gap-2 rounded-full border border-[#E7E3E0] bg-white/90 px-2 py-1 text-[11px] text-[#57534E] shadow-sm backdrop-blur transition-opacity duration-300 dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]',
        immersiveFadeClass,
      ].join(' ')}
    >
      {legendChip('H', '硬依赖：前置必须完成后才能开始', 'bg-[#FDE7DC] text-[#C75B3A]', 'task-dag-legend-hard-chip')}
      {legendChip('S', '软依赖：前置任务开始后即可开始', 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#D6D3D1]', 'task-dag-legend-soft-chip')}
    </div>
  );

  if (!isDesktop) {
    return (
      <>
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-start gap-2">
          <button
            type="button"
            data-testid="task-dag-mobile-search-toggle"
            onClick={() => onMobileSearchOpenChange(!mobileSearchOpen)}
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E7E3E0] bg-white/90 text-[#57534E] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]"
            aria-expanded={mobileSearchOpen}
            aria-label="切换搜索面板"
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            data-testid="task-dag-mobile-tools-toggle"
            onClick={() => onMobileToolsOpenChange(!mobileToolsOpen)}
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E7E3E0] bg-white/90 text-[#57534E] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]"
            aria-expanded={mobileToolsOpen}
            aria-label="切换工具面板"
          >
            <Settings2 size={16} />
          </button>
        </div>

        {mobileSearchOpen ? (
          <div className="pointer-events-none absolute right-3 top-14 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] flex-col items-end gap-2">
            {searchPanel}
          </div>
        ) : null}

        {mobileToolsOpen ? (
          <div className="pointer-events-none absolute right-3 top-14 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] flex-col items-end gap-2">
            {toolsPanel}
            {legendPanel}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] flex-col items-end gap-2">
      {searchPanel}
      {toolsPanel}
      {legendPanel}
    </div>
  );
}
