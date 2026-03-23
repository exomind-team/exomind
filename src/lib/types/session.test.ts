import { describe, it, expect } from 'vitest';
import {
  sessionNeedsAttention,
  formatRelativeTime,
  SESSION_STATUS_INDICATORS,
  AGENT_KIND_LABELS,
  AGENT_KIND_COLORS,
  type SessionInfo,
  type SessionStatus,
  type AgentKind,
} from './session';

describe('session types', () => {
  describe('sessionNeedsAttention', () => {
    it('returns true for waiting_input', () => {
      expect(sessionNeedsAttention('waiting_input')).toBe(true);
    });

    it('returns true for error', () => {
      expect(sessionNeedsAttention('error')).toBe(true);
    });

    it('returns false for running', () => {
      expect(sessionNeedsAttention('running')).toBe(false);
    });

    it('returns false for completed', () => {
      expect(sessionNeedsAttention('completed')).toBe(false);
    });

    it('returns false for paused', () => {
      expect(sessionNeedsAttention('paused')).toBe(false);
    });

    it('returns false for archived', () => {
      expect(sessionNeedsAttention('archived')).toBe(false);
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "刚刚" for times less than a minute ago', () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe('刚刚');
    });

    it('returns minutes for times less than an hour ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatRelativeTime(fiveMinAgo)).toBe('5m');
    });

    it('returns hours for times less than a day ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(formatRelativeTime(threeHoursAgo)).toBe('3h');
    });

    it('returns days for times more than a day ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
      expect(formatRelativeTime(twoDaysAgo)).toBe('2d');
    });
  });

  describe('SESSION_STATUS_INDICATORS', () => {
    const statuses: SessionStatus[] = ['running', 'waiting_input', 'completed', 'error', 'paused', 'archived'];

    it('has entries for all statuses', () => {
      for (const status of statuses) {
        const indicator = SESSION_STATUS_INDICATORS[status];
        expect(indicator).toBeDefined();
        expect(indicator.color).toBeTruthy();
        expect(indicator.shape).toBeTruthy();
        expect(indicator.label).toBeTruthy();
      }
    });

    it('uses distinct shapes for accessibility', () => {
      const shapes = Object.values(SESSION_STATUS_INDICATORS).map((i) => i.shape);
      const uniqueShapes = new Set(shapes);
      expect(uniqueShapes.size).toBe(shapes.length);
    });
  });

  describe('AGENT_KIND constants', () => {
    const kinds: AgentKind[] = ['claude', 'codex', 'api'];

    it('has labels for all kinds', () => {
      for (const kind of kinds) {
        expect(AGENT_KIND_LABELS[kind]).toBeTruthy();
      }
    });

    it('has colors for all kinds', () => {
      for (const kind of kinds) {
        expect(AGENT_KIND_COLORS[kind]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  describe('SessionInfo type shape', () => {
    it('can construct a valid SessionInfo object', () => {
      const session: SessionInfo = {
        id: 'test-1',
        agent_kind: 'claude',
        role: '任务思考',
        summary: '分析 #511 拆解方案...',
        status: 'running',
        interaction_mode: 'terminal',
        pty_id: 'pty-abc',
        context: {
          git_branch: 'dev',
          issue_refs: ['#511'],
          labels: [],
        },
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        turn_count: 5,
        last_output_preview: '> 建议将 user.input 拆为三层...',
      };

      expect(session.id).toBe('test-1');
      expect(session.agent_kind).toBe('claude');
      expect(session.context.git_branch).toBe('dev');
      expect(session.context.issue_refs).toEqual(['#511']);
    });
  });
});
