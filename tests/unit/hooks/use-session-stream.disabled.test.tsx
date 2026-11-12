import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSessionStreamCacheForTests, useSessionStream } from '@/hooks/useSessionStream';
import type { SessionInfo } from '@/lib/types/session';

class TestEventSource {
  static instances: TestEventSource[] = [];
  listeners = new Map<string, (event: MessageEvent) => void>();
  close = vi.fn();

  constructor(readonly url: string) {
    TestEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  emit(session: SessionInfo) {
    this.listeners.get('session.created')?.(new MessageEvent('session.created', {
      data: JSON.stringify({ session }),
    }));
  }
}

function session(id: string): SessionInfo {
  return {
    id,
    agent_kind: 'codex',
    role: 'Synthetic session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'synthetic-missing-pty',
    context: { issue_refs: [], labels: [] },
    created_at: '2026-11-11T00:00:00.000Z',
    last_active_at: '2026-11-11T00:00:00.000Z',
    turn_count: 0,
  };
}

function response(sessions: SessionInfo[]): Response {
  return { ok: true, status: 200, json: async () => sessions } as Response;
}

const target = { id: 'synthetic-host', rtBaseUrl: 'http://127.0.0.1:1949' };

describe('useSessionStream disabled lifecycle', () => {
  beforeEach(() => {
    __resetSessionStreamCacheForTests();
    TestEventSource.instances = [];
    vi.stubGlobal('EventSource', TestEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not fetch or subscribe on mount or manual refresh while disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled: false,
    }));

    await act(() => result.current.refresh());

    expect(result.current).toMatchObject({ sessions: [], loading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(TestEventSource.instances).toHaveLength(0);
  });

  it('does not rehydrate a cached session when remounted disabled', async () => {
    const fetchMock = vi.fn(async () => response([session('cached-session')]));
    vi.stubGlobal('fetch', fetchMock);
    const initial = renderHook(() => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled: true,
    }));
    await waitFor(() => expect(initial.result.current.sessions).toHaveLength(1));
    initial.unmount();
    fetchMock.mockClear();
    TestEventSource.instances = [];

    const disabled = renderHook(() => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled: false,
    }));
    await act(() => disabled.result.current.refresh());

    expect(disabled.result.current.sessions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(TestEventSource.instances).toHaveLength(0);
  });

  it('makes a retained refresh callback inert after unmount', async () => {
    const fetchMock = vi.fn(async () => response([]));
    vi.stubGlobal('fetch', fetchMock);
    const mounted = renderHook(() => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled: true,
    }));
    await waitFor(() => expect(mounted.result.current.loading).toBe(false));
    const retainedRefresh = mounted.result.current.refresh;
    mounted.unmount();
    fetchMock.mockClear();

    await retainedRefresh();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects old HTTP and SSE results after disable and re-enable', async () => {
    let finishOldRequest!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOldRequest = resolve; }))
      .mockResolvedValue(response([session('current-session')]));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ enabled }) => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled,
    }), { initialProps: { enabled: true } });
    const oldStream = TestEventSource.instances[0];

    rerender({ enabled: false });
    expect(oldStream.close).toHaveBeenCalledOnce();
    expect(result.current.sessions).toEqual([]);
    await act(() => result.current.refresh());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.sessions[0]?.id).toBe('current-session'));
    await act(async () => {
      oldStream.emit(session('obsolete-stream-session'));
      finishOldRequest(response([session('obsolete-http-session')]));
    });

    expect(result.current.sessions.map((item) => item.id)).toEqual(['current-session']);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not publish a request that finishes after unmount into the remount cache', async () => {
    let finishOldRequest!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOldRequest = resolve; }))
      .mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    vi.stubGlobal('fetch', fetchMock);
    const initial = renderHook(() => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled: true,
    }));
    initial.unmount();
    await act(async () => finishOldRequest(response([session('unmounted-session')])));

    const remounted = renderHook(() => useSessionStream({
      rtBaseUrl: null, targets: [target], enabled: true,
    }));

    expect(remounted.result.current.sessions).toEqual([]);
  });
});
