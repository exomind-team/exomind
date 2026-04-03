import { describe, expect, it } from 'vitest';
import {
  compareSessionSummaries,
  parseSessionCardSessionId,
  resolveManagedInstanceBridgePort,
  summarizeRtSessions,
  type UiSessionSummary,
} from '../../../scripts/dev/tauri-mcp-issue806-charter-lib';

describe('tauri-mcp-issue806-charter-lib', () => {
  it('summarizes RT sessions using the same visible/active rules as SessionsView（RT 汇总应与会话页分组规则一致）', () => {
    const summary = summarizeRtSessions([
      { id: 'running-1', status: 'running' },
      { id: 'waiting-1', status: 'waiting_input' },
      { id: 'completed-1', status: 'completed' },
      { id: 'archived-1', status: 'archived' },
    ]);

    expect(summary).toEqual({
      active: 2,
      completed: 1,
      total: 3,
      activeSessionIds: ['running-1', 'waiting-1'],
      completedSessionIds: ['completed-1'],
      visibleSessionIds: ['completed-1', 'running-1', 'waiting-1'],
    });
  });

  it('reports no mismatch when UI and RT counts and ids already match（UI 与 RT 一致时不应误报）', () => {
    const ui: UiSessionSummary = {
      active: 1,
      completed: 1,
      total: 2,
      activeSessionIds: ['running-1'],
      completedSessionIds: ['completed-1'],
      visibleSessionIds: ['completed-1', 'running-1'],
    };

    const rt = summarizeRtSessions([
      { id: 'running-1', status: 'running' },
      { id: 'completed-1', status: 'completed' },
      { id: 'archived-1', status: 'archived' },
    ]);

    expect(compareSessionSummaries(ui, rt)).toEqual([]);
  });

  it('reports both count and id mismatches when UI diverges from RT（UI 偏离 RT 时应指出具体差异）', () => {
    const ui: UiSessionSummary = {
      active: 2,
      completed: 0,
      total: 2,
      activeSessionIds: ['running-1', 'stale-running-2'],
      completedSessionIds: [],
      visibleSessionIds: ['running-1', 'stale-running-2'],
    };

    const rt = summarizeRtSessions([
      { id: 'running-1', status: 'running' },
      { id: 'completed-1', status: 'completed' },
    ]);

    expect(compareSessionSummaries(ui, rt)).toEqual([
      { field: 'active', ui: 2, rt: 1 },
      { field: 'completed', ui: 0, rt: 1 },
      { field: 'activeSessionIds', ui: ['running-1', 'stale-running-2'], rt: ['running-1'] },
      { field: 'completedSessionIds', ui: [], rt: ['completed-1'] },
      { field: 'visibleSessionIds', ui: ['running-1', 'stale-running-2'], rt: ['completed-1', 'running-1'] },
    ]);
  });

  it('derives the raw bridge port from the managed web port（bridge 端口应随受管 web 端口偏移）', () => {
    expect(resolveManagedInstanceBridgePort(1420)).toBe(9223);
    expect(resolveManagedInstanceBridgePort(1435)).toBe(9238);
  });

  it('ignores archive buttons when parsing session card test ids（解析 session card id 时应忽略归档按钮）', () => {
    expect(parseSessionCardSessionId('session-card-abc')).toBe('abc');
    expect(parseSessionCardSessionId('session-card-archive-abc')).toBeNull();
  });
});
