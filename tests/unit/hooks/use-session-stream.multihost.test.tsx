import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionStream } from '@/hooks/useSessionStream';
import type { SessionInfo } from '@/lib/types/session';

class MockEventSource {
  static urls: string[] = [];

  url: string;

  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.urls.push(url);
  }

  addEventListener() {}

  removeEventListener() {}

  close() {}
}

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-multihost-1',
    agent_kind: 'codex',
    role: '远端分析会话',
    summary: '来自第二个 runtime host 的会话',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-03-15T00:00:00.000Z',
    last_active_at: '2026-03-15T00:10:00.000Z',
    turn_count: 3,
    last_output_preview: 'host-b output',
    ...overrides,
  };
}

describe('useSessionStream multi-host aggregation（多主机会话流聚合）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.urls = [];
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  it('merges sessions from multiple runtime hosts and annotates source host（合并多主机会话并标注来源）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'http://127.0.0.1:1919/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }

      if (url === 'http://192.168.1.22:2919/sessions') {
        return {
          ok: true,
          status: 200,
          json: async () => [buildSession({ id: 'session-host-b' })],
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const targets = [
      {
        id: 'host-a',
        rtBaseUrl: 'http://127.0.0.1:1919',
        hostName: '127.0.0.1:1919',
        hostAddress: '127.0.0.1:1919',
      },
      {
        id: 'host-b',
        rtBaseUrl: 'http://192.168.1.22:2919',
        hostName: '192.168.1.22:2919',
        hostAddress: '192.168.1.22:2919',
      },
    ];

    const { result } = renderHook(() => useSessionStream({
      rtBaseUrl: null,
      enabled: true,
      targets,
    }));

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    expect(result.current.sessions[0]).toMatchObject({
      id: 'session-host-b',
      role: '远端分析会话',
      source_host_id: 'host-b',
      source_host_name: '192.168.1.22:2919',
      source_host_address: '192.168.1.22:2919',
    });

    expect(MockEventSource.urls).toEqual(expect.arrayContaining([
      'http://127.0.0.1:1919/sessions/stream',
      'http://192.168.1.22:2919/sessions/stream',
    ]));
  });
});
