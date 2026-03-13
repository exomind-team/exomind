import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { SessionInfo } from '@/lib/types/session';
import { getUseMockDataEnabled, MOCK_SESSIONS, subscribeUseMockDataChanges } from '@/config/mock-data';
import { SessionCard } from './SessionCard';

// ── Types ──────────────────────────────────────────────────────

export interface SessionsViewProps {
  /** Callback when user clicks a session card */
  onSessionClick?: (session: SessionInfo) => void;
  /** Override sessions list (for testing or real API data) */
  sessions?: SessionInfo[];
}

// ── Component ──────────────────────────────────────────────────

export function SessionsView({ onSessionClick, sessions: externalSessions }: SessionsViewProps) {
  const [useMockData, setUseMockData] = useState(getUseMockDataEnabled);

  // Subscribe to mock data toggle changes
  useEffect(() => {
    return subscribeUseMockDataChanges(setUseMockData);
  }, []);

  // Determine which sessions to display
  const sessions: SessionInfo[] = externalSessions ?? (useMockData ? MOCK_SESSIONS : []);

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
      </div>

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
