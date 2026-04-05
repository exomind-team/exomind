import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@/lib/types/session';
import { findSessionForPty } from '@/ui/app/pages/agents/pty-graph-nodes';

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-default',
    agent_kind: 'codex',
    role: 'Codex',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-live-1',
    inner_session_id: 'thread-default',
    source_host_id: 'runtime-host-default',
    context: {
      issue_refs: [],
      labels: [],
      work_dir: 'D:/project/exomind',
    },
    created_at: '2026-04-02T00:00:00.000Z',
    updated_at: '2026-04-02T00:00:00.000Z',
    last_active_at: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('pty graph nodes host preference', () => {
  it('prefers the session that matches the live PTY host id when duplicate pty ids exist', () => {
    const staleSession = buildSession({
      id: 'session-stale',
      source_host_id: 'stale-runtime-host',
    });
    const liveSession = buildSession({
      id: 'session-live',
      source_host_id: 'runtime-host-live',
    });

    const result = findSessionForPty('pty-live-1', [staleSession, liveSession], {
      preferredSourceHostId: 'runtime-host-live',
    });

    expect(result?.id).toBe('session-live');
  });
});
