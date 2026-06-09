import type { SessionInfo } from '@/lib/types/session';
import type { TiledLayout } from './tiled-layout';

import { TILED_LAYOUT_MAX_PANES } from './tiled-layout';

function isTiledActiveSession(session: SessionInfo): boolean {
  return session.status !== 'completed' && session.status !== 'archived';
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function getVisibleDisplayedPaneIds(
  sessions: SessionInfo[],
  paneOrder: string[],
  maxPanes: number,
): string[] {
  const visibleSessions = sessions.filter(isTiledActiveSession);

  if (paneOrder.length === 0) {
    return visibleSessions.slice(0, maxPanes).map((session) => session.id);
  }

  const visibleSessionIds = new Set(visibleSessions.map((session) => session.id));
  const orderedIds = paneOrder.filter((id) => visibleSessionIds.has(id));

  for (const session of visibleSessions) {
    if (!orderedIds.includes(session.id)) {
      orderedIds.push(session.id);
    }
  }

  return orderedIds.slice(0, maxPanes);
}

export function applySpawnedSessionToTiledPaneOrder({
  layout,
  paneOrder,
  sessions,
  newSessionId,
}: {
  layout: TiledLayout;
  paneOrder: string[];
  sessions: SessionInfo[];
  newSessionId: string;
}): string[] {
  const maxPanes = TILED_LAYOUT_MAX_PANES[layout];
  const displayedPaneIds = getVisibleDisplayedPaneIds(sessions, paneOrder, maxPanes);
  const visibleSessionsById = new Map(
    sessions
      .filter(isTiledActiveSession)
      .map((session) => [session.id, session]),
  );

  if (displayedPaneIds.includes(newSessionId)) {
    return uniqueIds(displayedPaneIds);
  }

  const completedPaneIndex = displayedPaneIds.findIndex(
    (id) => visibleSessionsById.get(id)?.status === 'completed',
  );

  if (completedPaneIndex !== -1) {
    const nextPaneOrder = [...displayedPaneIds];
    nextPaneOrder[completedPaneIndex] = newSessionId;
    return uniqueIds(nextPaneOrder);
  }

  if (displayedPaneIds.length < maxPanes) {
    return uniqueIds([...displayedPaneIds, newSessionId]);
  }

  return uniqueIds(displayedPaneIds);
}
