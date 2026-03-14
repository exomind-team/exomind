import { Inbox, RefreshCw } from 'lucide-react';
import type { SessionInfo } from '@/lib/types/session';
import { SessionCard } from './SessionCard';

// ── Types ──────────────────────────────────────────────────────

export interface SessionsViewProps {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  useMockData: boolean;
  onRefresh?: () => void;
  /** Callback when user clicks a session card */
  onSessionClick?: (session: SessionInfo) => void;
}

// ── Component ──────────────────────────────────────────────────

export function SessionsView({
  sessions,
  loading,
  error,
  useMockData,
  onRefresh,
  onSessionClick,
}: SessionsViewProps) {
  // Sort: attention-needing first, then by last_active_at desc
  const sortedSessions = [...sessions].sort((a, b) => {
    const aNeeds = a.status === 'waiting_input' || a.status === 'error';
    const bNeeds = b.status === 'waiting_input' || b.status === 'error';
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    return new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime();
  });

  // Filter: only show active sessions (not completed/archived per D8)
  const activeSessions = sortedSessions.filter(
    (s) => s.status !== 'completed' && s.status !== 'archived',
  );

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-[#A8A29E]" />
      </div>
    );
  }

  if (activeSessions.length === 0) {
    return (
      <div
        data-testid="sessions-empty-state"
        className="flex flex-col items-center justify-center gap-3 py-20 text-center"
      >
        <Inbox size={48} className="text-[#D6D3D1] dark:text-[#44403C]" />
        <div>
          <p className="text-sm font-medium text-[#78716C] dark:text-[#A8A29E]">
            暂无活跃会话
          </p>
          <p className="mt-1 text-xs text-[#A8A29E] dark:text-[#57534E]">
            {useMockData
              ? '所有 mock 会话已完成或归档'
              : '启动一个 Terminal Agent 或开启测试数据查看效果'}
          </p>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="sessions-view" className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[#78716C] dark:text-[#A8A29E]">
          活跃会话
          <span className="ml-1.5 rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] dark:bg-[#292524]">
            {activeSessions.length}
          </span>
        </h2>
        {!useMockData && (
          <button
            type="button"
            onClick={onRefresh}
            className="flex h-7 w-7 items-center justify-center rounded text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
            title="刷新"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Session cards grid */}
      <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-2">
        {activeSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onClick={onSessionClick}
          />
        ))}
      </div>
    </div>
  );
}
