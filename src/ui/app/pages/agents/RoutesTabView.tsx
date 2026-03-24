import { Plus, Waypoints } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { SignalRoute } from '@/lib/types/signal-pool';

export function RoutesTabView({
  routes,
  hostLabel,
  onToggle,
  onDelete,
  onEdit,
  onAdd,
}: {
  routes: SignalRoute[];
  hostLabel?: string;
  onToggle: (routeId: string, enabled: boolean) => Promise<void>;
  onDelete: (routeId: string) => Promise<void>;
  onEdit: (routeId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
            信号路由
          </span>
          {hostLabel && (
            <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 font-mono text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
              {hostLabel}
            </span>
          )}
          <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">{routes.length} 条</span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-[8px] bg-[#C75B3A] px-3 py-1.5 text-xs text-white"
        >
          <Plus size={12} />
          添加路由
        </button>
      </div>

      {/* Table */}
      {routes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Waypoints size={32} className="text-[#A8A29E]" />
          <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">暂无信号路由</p>
          <p className="text-xs text-[#A8A29E]">点击「添加路由」创建第一条路由</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[#E7E3E0] dark:border-[#292524]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E7E3E0] bg-[#F5F0ED] dark:border-[#292524] dark:bg-[#1C1917]">
                <th className="w-12 px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  启用
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  Topic
                </th>
                <th className="w-6 py-2.5 text-center text-xs text-[#A8A29E]">→</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  类型
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  目标
                </th>
                <th className="w-24 px-4 py-2.5 text-right text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E7E3E0] dark:divide-[#292524]">
              {routes.map((route) => (
                <tr
                  key={route.id}
                  className="cursor-pointer bg-white transition-colors hover:bg-[#FAF7F5] dark:bg-[#0C0A09] dark:hover:bg-[#1C1917]"
                  onClick={() => onEdit(route.id)}
                >
                  {/* 启用开关 */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={route.enabled}
                      onCheckedChange={(checked) => void onToggle(route.id, checked)}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={route.enabled ? '禁用' : '启用'}
                    />
                  </td>
                  {/* Topic */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[#1C1917] dark:text-[#FAFAF9]">
                      {route.topic}
                    </span>
                  </td>
                  {/* 箭头 */}
                  <td className="py-3 text-center text-[#A8A29E]">→</td>
                  {/* target_type */}
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        route.target_type === 'agent'
                          ? 'bg-[#CCFBF1] text-[#0D9488] dark:bg-[#0D9488]/20 dark:text-[#2DD4BF]'
                          : route.target_type === 'actor'
                          ? 'bg-[#FEF3C7] text-[#B45309] dark:bg-[#F59E0B]/20 dark:text-[#FCD34D]'
                          : route.target_type === 'remote'
                          ? 'bg-[#E0E7FF] text-[#4338CA] dark:bg-[#4338CA]/20 dark:text-[#C7D2FE]'
                          : 'bg-[#DBEAFE] text-[#1D4ED8] dark:bg-[#3B82F6]/20 dark:text-[#93C5FD]'
                      }`}
                    >
                      {route.target_type}
                    </span>
                  </td>
                  {/* target_ref */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[#44403C] dark:text-[#D6D3D1]">
                      {route.target_ref}
                    </span>
                  </td>
                  {/* 操作 */}
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(route.id)}
                        className="rounded px-2 py-1 text-[10px] text-[#78716C] hover:bg-[#F5F0ED] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#292524] dark:hover:text-[#FAFAF9]"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(route.id)}
                        className="rounded px-2 py-1 text-[10px] text-[#DC2626] hover:bg-[#FEE2E2] dark:text-[#FCA5A5] dark:hover:bg-[#451A1A]"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
