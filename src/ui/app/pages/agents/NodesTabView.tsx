import { Bot, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { getListItemIcon, ENERGY_PHASE_COLORS } from './agents-utils';
import type {
  AgentHubListItem,
  AgentHubListSection,
  AgentHubNodeStatus,
  AgentHubNodeType,
} from '@/lib/types/agent-hub';
import type { SignalRouteRow } from '../agents-signal-topology';

export type NodeFilterType = 'all' | 'input' | 'agent' | 'actor' | 'output';

export const NODE_FILTER_ITEMS: Array<{ id: NodeFilterType; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'input', label: '信号输入' },
  { id: 'agent', label: 'Agent' },
  { id: 'actor', label: 'Actor' },
  { id: 'output', label: '输出' },
];

export function NodesTabView({
  sections,
  filter,
  onFilterChange,
  onNodeClick,
  isConnecting = false,
}: {
  sections: AgentHubListSection[];
  filter: NodeFilterType;
  onFilterChange: (f: NodeFilterType) => void;
  onNodeClick: (item: AgentHubListItem) => void;
  isConnecting?: boolean;
}) {
  const filteredItems = useMemo(() => {
    const allItems = sections.flatMap((s) => s.items);
    if (filter === 'all') return allItems;
    const typeMap: Record<NodeFilterType, AgentHubNodeType | null> = {
      all: null,
      input: 'input',
      agent: 'agent',
      actor: 'actor',
      output: 'output',
    };
    const targetType = typeMap[filter];
    return targetType ? allItems.filter((item) => item.type === targetType) : allItems;
  }, [sections, filter]);

  return (
    <div className="flex flex-col gap-3">
      {/* Filter 栏 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {NODE_FILTER_ITEMS.map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`agent-list-filter-${f.id}`}
            onClick={() => onFilterChange(f.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.id
                ? 'bg-[#C75B3A] text-white'
                : 'bg-[#F5F0ED] text-[#78716C] hover:bg-[#E7E3E0] dark:bg-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#3C3836]'
            }`}
          >
            {f.label}
            {filter === f.id && f.id !== 'all' && (
              <span className="ml-1 opacity-80">({filteredItems.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* 节点列表 */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          {isConnecting ? (
            <>
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C75B3A] border-t-transparent" />
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">连接建立中…</p>
            </>
          ) : (
            <>
              <Bot size={32} className="text-[#A8A29E]" />
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">
                {filter === 'all' ? '暂无节点' : `暂无${NODE_FILTER_ITEMS.find(f => f.id === filter)?.label}节点`}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#E7E3E0] overflow-hidden rounded-[10px] border border-[#E7E3E0] dark:divide-[#292524] dark:border-[#292524]">
          {filteredItems.map((item) => {
            const Icon = getListItemIcon(item);
            const statusLabel: Record<AgentHubNodeStatus, string> = {
              running: '运行中',
              idle: '空闲',
              warning: '警告',
              offline: '离线',
              dormant: '休眠',
              critical: '危险',
              dying: '濒死',
            };
            const isDormant = item.status === 'dormant';
            const energyPhase = item.energy?.phase ?? 'normal';
            const energyColor = ENERGY_PHASE_COLORS[energyPhase] ?? '#6B7280';
            const energyPercent = item.energy ? Math.round(item.energy.ratio * 100) : null;
            return (
              <div
                key={item.id}
                className={`flex cursor-pointer items-center gap-3 bg-white px-4 py-3 transition-colors hover:bg-[#FAF7F5] dark:bg-[#0C0A09] dark:hover:bg-[#1C1917] ${isDormant ? 'opacity-50 grayscale' : ''}`}
                onClick={() => onNodeClick(item)}
              >
                {/* Icon */}
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
                    item.type === 'agent'
                      ? 'bg-[#CCFBF1] dark:bg-[#0D9488]/20'
                      : item.type === 'actor'
                      ? 'bg-[#FEF3C7] dark:bg-[#F59E0B]/20'
                      : item.type === 'input'
                      ? 'bg-[#FFEDD5] dark:bg-[#F97316]/20'
                      : 'bg-[#DBEAFE] dark:bg-[#3B82F6]/20'
                  }`}
                >
                  <Icon
                    size={16}
                    className={
                      item.type === 'agent'
                        ? 'text-[#0D9488]'
                        : item.type === 'actor'
                        ? 'text-[#B45309] dark:text-[#F59E0B]'
                        : item.type === 'input'
                        ? 'text-[#EA580C]'
                        : 'text-[#1D4ED8] dark:text-[#60A5FA]'
                    }
                  />
                </div>
                {/* 内容 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                        {item.name}
                      </span>
                      {item.badgeText && (
                        <span className="shrink-0 rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                          {item.badgeText}
                        </span>
                      )}
                    </div>
                    {energyPercent != null && (
                      <span className="shrink-0 text-[10px] font-medium" style={{ color: energyColor }}>
                        {energyPercent}%
                      </span>
                    )}
                  </div>
                  {/* Mini energy bar */}
                  {item.energy && (
                    <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-[#E7E3E0] dark:bg-[#292524]">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${energyPercent ?? 0}%`, backgroundColor: energyColor }}
                      />
                    </div>
                  )}
                  {item.description && (
                    <p className="mt-0.5 truncate text-xs text-[#78716C] dark:text-[#A8A29E]">
                      {item.description}
                    </p>
                  )}
                </div>
                {/* 状态 badge */}
                <span
                  className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                    item.status === 'running'
                      ? 'bg-[#22C55E]/15 text-[#22C55E]'
                      : item.status === 'warning'
                        ? 'bg-[#F59E0B]/15 text-[#F59E0B]'
                        : item.status === 'offline' || item.status === 'dying'
                          ? 'bg-[#EF4444]/15 text-[#EF4444]'
                          : item.status === 'critical'
                            ? 'bg-[#F97316]/15 text-[#F97316]'
                            : item.status === 'dormant'
                              ? 'bg-[#6B7280]/15 text-[#6B7280]'
                              : 'bg-[#57534E]/30 text-[#78716C]'
                  }`}
                >
                  {statusLabel[item.status]}
                </span>
                <ChevronRight size={14} className="shrink-0 text-[#A8A29E]" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ListTabView({
  sections,
  filter,
  onFilterChange,
  onNodeClick,
  signalRouteRows,
  onOpenRoute,
  isConnecting = false,
}: {
  sections: AgentHubListSection[];
  filter: NodeFilterType;
  onFilterChange: (f: NodeFilterType) => void;
  onNodeClick: (item: AgentHubListItem) => void;
  signalRouteRows: SignalRouteRow[];
  onOpenRoute: (routeId: string) => void;
  isConnecting?: boolean;
}) {
  const routeHostLabel = signalRouteRows[0]?.hostLabel;

  return (
    <div data-testid="agent-list-view" className="flex flex-col gap-4">
      <NodesTabView
        sections={sections}
        filter={filter}
        onFilterChange={onFilterChange}
        onNodeClick={onNodeClick}
        isConnecting={isConnecting}
      />

      <section
        data-testid="agent-signal-route-section"
        className="rounded-[10px] border border-[#E7E3E0] bg-white dark:border-[#292524] dark:bg-[#0C0A09]"
      >
        <div className="flex items-center justify-between border-b border-[#E7E3E0] px-4 py-2.5 dark:border-[#292524]">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">信号路由</p>
            {routeHostLabel && (
              <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 font-mono text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                {routeHostLabel}
              </span>
            )}
          </div>
          <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">{signalRouteRows.length} 条</span>
        </div>

        {signalRouteRows.length === 0 ? (
          isConnecting ? (
            <div className="flex items-center gap-2 px-4 py-6">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#C75B3A] border-t-transparent" />
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">连接建立中…</p>
            </div>
          ) : (
            <p className="px-4 py-6 text-xs text-[#78716C] dark:text-[#A8A29E]">暂无信号路由</p>
          )
        ) : (
          <div className="divide-y divide-[#E7E3E0] dark:divide-[#292524]">
            {signalRouteRows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid={`agent-signal-route-row-${row.id}`}
                onClick={() => onOpenRoute(row.id)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-[#FAF7F5] dark:hover:bg-[#1C1917]"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    row.status === 'active' ? 'bg-[#22C55E]' : 'bg-[#57534E]'
                  }`}
                />
                <span className="flex-1 truncate font-mono text-xs text-[#44403C] dark:text-[#D6D3D1]">
                  {row.topic} → {row.targetRef}
                </span>
                <span className="shrink-0 rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                  {row.targetType}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
