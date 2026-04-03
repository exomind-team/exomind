import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '@/lib/types/session';
import {
  detectAndPersistHistoricalSessionId,
  hasMatchingHistoricalSessionRecord,
} from '@/ui/app/pages/agents/pty-session-recovery';

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-recovery',
    agent_kind: 'codex',
    role: 'Codex Recovery',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    context: {
      issue_refs: [],
      labels: [],
      work_dir: 'D:/project/exomind',
    },
    created_at: '2026-04-02T00:00:00.000Z',
    last_active_at: '2026-04-02T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

describe('pty-session-recovery（PTY 历史会话恢复辅助）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the unique exact workdir match for Codex（仅补写唯一且工作目录精确匹配的 Codex session）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-match',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
            {
              agent_type: 'codex',
              session_id: 'codex-thread-other',
              project_path: 'D:/project/other',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/pty-codex-1') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ id: 'pty-codex-1', inner_session_id: 'codex-thread-match' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-codex-1',
      agentType: 'codex',
      baselineSessionIds: [],
      expectedWorkdir: 'D:/project/exomind',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBe('codex-thread-match');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/sessions/pty-codex-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ inner_session_id: 'codex-thread-match' }),
      }),
    );
  });

  it('persists the unique encoded project match for Claude（Claude 会用编码后的 project_path 精确补写 session）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=claude')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'claude',
              session_id: 'claude-thread-match',
              project_path: 'H--A137442-Develop-AGI-exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/pty-claude-1') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ id: 'pty-claude-1', inner_session_id: 'claude-thread-match' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-claude-1',
      agentType: 'claude',
      baselineSessionIds: [],
      expectedWorkdir: 'H:/A137442/Develop/AGI/exomind',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBe('claude-thread-match');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/sessions/pty-claude-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ inner_session_id: 'claude-thread-match' }),
      }),
    );
  });

  it('skips detection when the workdir is not absolute（工作目录非绝对路径时不自动补写 inner_session_id）', async () => {
    const fetchMock = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-codex-2',
      agentType: 'codex',
      baselineSessionIds: [],
      expectedWorkdir: '.',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hub][pty] skip inner session detection because workdir is not absolute',
      expect.objectContaining({
        sessionRecordId: 'pty-codex-2',
        expectedWorkdir: '.',
      }),
    );
  });

  it('refuses ambiguous exact workdir matches（精确工作目录命中多条历史 session 时拒绝自动绑定）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-a',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
            {
              agent_type: 'codex',
              session_id: 'codex-thread-b',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-codex-3',
      agentType: 'codex',
      baselineSessionIds: [],
      expectedWorkdir: 'D:/project/exomind',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hub][pty] unable to safely detect historical session id',
      expect.objectContaining({
        sessionRecordId: 'pty-codex-3',
        candidateWindowMs: 15 * 60_000,
        exactMatchCount: 2,
        exactMatchIds: ['codex-thread-a', 'codex-thread-b'],
      }),
    );
  });

  it('reuses a single baseline exact match after fresh detection exhausts（未发现新 session 时允许复用唯一的 baseline 精确命中）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-existing',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-01T23:59:00.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/pty-codex-baseline') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ id: 'pty-codex-baseline', inner_session_id: 'codex-thread-existing' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-codex-baseline',
      agentType: 'codex',
      baselineSessionIds: ['codex-thread-existing'],
      expectedWorkdir: 'D:/project/exomind',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBe('codex-thread-existing');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/sessions/pty-codex-baseline',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ inner_session_id: 'codex-thread-existing' }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hub][pty] reusing existing historical session id for terminal binding',
      expect.objectContaining({
        sessionRecordId: 'pty-codex-baseline',
        matchedSessionId: 'codex-thread-existing',
      }),
    );
  });

  it('prefers a fresh exact match over a baseline reuse（存在新 session 时优先绑定新的精确命中）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-existing',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-01T23:59:00.000Z',
            },
            {
              agent_type: 'codex',
              session_id: 'codex-thread-fresh',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      if (url.endsWith('/sessions/pty-codex-fresh') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ id: 'pty-codex-fresh', inner_session_id: 'codex-thread-fresh' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-codex-fresh',
      agentType: 'codex',
      baselineSessionIds: ['codex-thread-existing'],
      expectedWorkdir: 'D:/project/exomind',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBe('codex-thread-fresh');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/sessions/pty-codex-fresh',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ inner_session_id: 'codex-thread-fresh' }),
      }),
    );
  });

  it('ignores exact workdir matches outside the allowed post-spawn window（超出启动后时间窗的精确目录命中不会误绑定）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-too-late',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:20:30.000Z',
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    const detected = await detectAndPersistHistoricalSessionId({
      rtBaseUrl: 'http://127.0.0.1:1949',
      sessionRecordId: 'pty-codex-4',
      agentType: 'codex',
      baselineSessionIds: [],
      expectedWorkdir: 'D:/project/exomind',
      startedAtMs: Date.parse('2026-04-02T00:00:00.000Z'),
      candidateWindowMs: 10 * 60_000,
      maxAttempts: 1,
      intervalMs: 0,
    });

    expect(detected).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hub][pty] unable to safely detect historical session id',
      expect.objectContaining({
        sessionRecordId: 'pty-codex-4',
        candidateWindowMs: 10 * 60_000,
        exactMatchCount: 0,
        exactMatchIds: [],
      }),
    );
  });

  it('validates that stored inner_session_id still belongs to the same workdir（恢复前会校验 inner_session_id 仍归属同一工作目录）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'codex',
              session_id: 'codex-thread-match',
              project_path: 'D:/project/exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
            {
              agent_type: 'codex',
              session_id: 'codex-thread-other',
              project_path: 'D:/project/other',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const safeSession = buildSession({
      inner_session_id: 'codex-thread-match',
    });
    const mismatchedSession = buildSession({
      id: 'session-recovery-mismatch',
      inner_session_id: 'codex-thread-other',
    });

    await expect(
      hasMatchingHistoricalSessionRecord('http://127.0.0.1:1949', safeSession),
    ).resolves.toBe(true);
    await expect(
      hasMatchingHistoricalSessionRecord('http://127.0.0.1:1949', mismatchedSession),
    ).resolves.toBe(false);
  });

  it('validates Claude inner_session_id against encoded project paths（Claude 恢复前也会校验编码后的 project_path）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pty/sessions?agent_type=claude')) {
        return {
          ok: true,
          json: async () => [
            {
              agent_type: 'claude',
              session_id: 'claude-thread-match',
              project_path: 'H--A137442-Develop-AGI-exomind',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
            {
              agent_type: 'claude',
              session_id: 'claude-thread-other',
              project_path: 'H--A137442-Develop-AGI-other',
              last_modified: '2026-04-02T00:00:05.000Z',
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const safeSession = buildSession({
      agent_kind: 'claude',
      inner_session_id: 'claude-thread-match',
      context: {
        issue_refs: [],
        labels: [],
        work_dir: 'H:/A137442/Develop/AGI/exomind',
      },
    });
    const mismatchedSession = buildSession({
      id: 'session-recovery-claude-mismatch',
      agent_kind: 'claude',
      inner_session_id: 'claude-thread-other',
      context: {
        issue_refs: [],
        labels: [],
        work_dir: 'H:/A137442/Develop/AGI/exomind',
      },
    });

    await expect(
      hasMatchingHistoricalSessionRecord('http://127.0.0.1:1949', safeSession),
    ).resolves.toBe(true);
    await expect(
      hasMatchingHistoricalSessionRecord('http://127.0.0.1:1949', mismatchedSession),
    ).resolves.toBe(false);
  });
});
