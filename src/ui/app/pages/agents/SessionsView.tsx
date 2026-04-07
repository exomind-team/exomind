import { RefreshCw, Inbox } from 'lucide-react';
import { useState } from 'react';
import type { SessionInfo } from '@/lib/types/session';
import { SessionCard } from './SessionCard';

// ── Types ──────────────────────────────────────────────────────

export interface SessionsViewProps {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  useMockData: boolean;
  onRefresh?: () => void | Promise<void>;
  /** Callback when user clicks a session card */
  onSessionClick?: (session: SessionInfo) => void;
  /** Callback when user stops a PTY session（停止 PTY 会话） */
  onStopSession?: (session: SessionInfo) => void;
  /** Callback when user archives a completed session（归档已完成会话） */
  onArchiveSession?: (session: SessionInfo) => void;
  /** Whether a PTY stop action is currently in flight for this session */
  isSessionStopping?: (session: SessionInfo) => boolean;
}

// ── Component ──────────────────────────────────────────────────

export function SessionsView({
  sessions,
  loading,
  error,
  useMockData,
  onRefresh,
  onSessionClick,
  onStopSession,
  onArchiveSession,
  isSessionStopping,
}: SessionsViewProps) {
  const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);
  // Sort: attention-needing first, then by last_active_at desc
  const sortedSessions = [...sessions].sort((a, b) => {
    const aNeeds = a.status === 'waiting_input' || a.status === 'error';
    const bNeeds = b.status === 'waiting_input' || b.status === 'error';
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    return new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime();
  });

  const visibleSessions = sortedSessions.filter((s) => s.status !== 'archived');
  const activeSessions = visibleSessions.filter((s) => s.status !== 'completed');
  const completedSessions = visibleSessions.filter((s) => s.status === 'completed');
  const isRefreshPending = loading || isManualRefreshPending;

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshPending) {
      return;
    }

    console.info('[agent-hub][sessions][refresh] requested', {
      visibleSessionCount: visibleSessions.length,
      activeSessionCount: activeSessions.length,
      completedSessionCount: completedSessions.length,
    });
    setIsManualRefreshPending(true);
    try {
      await Promise.resolve(onRefresh());
      console.info('[agent-hub][sessions][refresh] completed', {
        visibleSessionCount: visibleSessions.length,
      });
    } catch (error) {
      console.warn('[agent-hub][sessions][refresh] failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsManualRefreshPending(false);
    }
  };

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-[#A8A29E]" />
      </div>
    );
  }

  if (visibleSessions.length === 0) {
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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[#78716C] dark:text-[#A8A29E]">
          会话
          <span className="ml-1.5 rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] dark:bg-[#292524]">
            {visibleSessions.length}
          </span>
        </h2>
        {!useMockData && (
          <button
            type="button"
            data-testid="sessions-refresh-button"
            onClick={() => {
              void handleRefresh();
            }}
            disabled={isRefreshPending}
            className="flex h-7 w-7 items-center justify-center rounded text-[#A8A29E] hover:text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-[#FAFAF9]"
            title={isRefreshPending ? '刷新中' : '刷新'}
            aria-label={isRefreshPending ? '刷新中' : '刷新会话'}
          >
            <RefreshCw
              data-testid="sessions-refresh-icon"
              size={14}
              className={isRefreshPending ? 'animate-spin' : undefined}
            />
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div data-testid="sessions-active-section" className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-[#78716C] dark:text-[#A8A29E]">活跃会话</h3>
          <span className="rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] dark:bg-[#292524]">
            {activeSessions.length}
          </span>
        </div>
        {activeSessions.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-2">
            {activeSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={onSessionClick}
                onStop={onStopSession}
                onArchive={onArchiveSession}
                stopDisabled={isSessionStopping?.(session) ?? false}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#A8A29E] dark:text-[#57534E]">暂无活跃会话</p>
        )}
      </div>

      {completedSessions.length > 0 && (
        <div data-testid="sessions-completed-section" className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-[#78716C] dark:text-[#A8A29E]">已完成</h3>
            <span className="rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] dark:bg-[#292524]">
              {completedSessions.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-2">
            {completedSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={onSessionClick}
                onStop={onStopSession}
                onArchive={onArchiveSession}
                stopDisabled={isSessionStopping?.(session) ?? false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
