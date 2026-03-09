import { describe, expect, it } from 'vitest';
import {
  detectWakeEvents,
  summarizeWakeItems,
  type WaitSnapshot,
} from '../../../Scripts/dev/worker-agent/wait.ts';

function makeSnapshot(overrides: Partial<WaitSnapshot> = {}): WaitSnapshot {
  return {
    prNumber: 421,
    headSha: 'head-1',
    labels: [],
    comments: [],
    reviews: [],
    statusChecks: [],
    ...overrides,
  };
}

describe('worker-agent wait logic', () => {
  it('wakes on new reviewer comment after the saved cursor', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot(),
      current: makeSnapshot({
        comments: [
          {
            id: 'comment-1',
            authorLogin: 'ARCJ137442',
            body: '[Codex Reviewer]\nNeed a lock assertion.',
            createdAt: '2026-03-09T10:00:00.000Z',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events[0]?.reason).toBe('reviewer');
    expect(events[0]?.itemId).toBe('comment-1');
  });

  it('wakes on a new human comment and classifies it as a pending item', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot(),
      current: makeSnapshot({
        comments: [
          {
            id: 'comment-2',
            authorLogin: 'Hailaylin',
            body: '这块描述我想再确认下',
            createdAt: '2026-03-09T10:01:00.000Z',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events[0]?.reason).toBe('human-comment');
    expect(events[0]?.summary).toContain('Hailaylin');
  });

  it('does not wake on a plain APPROVED review', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot(),
      current: makeSnapshot({
        reviews: [
          {
            id: 'review-approved',
            authorLogin: 'ARCJ137442',
            body: '',
            state: 'APPROVED',
            submittedAt: '2026-03-09T10:01:00.000Z',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events).toEqual([]);
  });

  it('wakes on a COMMENTED review as human feedback', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot(),
      current: makeSnapshot({
        reviews: [
          {
            id: 'review-commented',
            authorLogin: 'ARCJ137442',
            body: '这里需要补一条说明',
            state: 'COMMENTED',
            submittedAt: '2026-03-09T10:02:00.000Z',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events[0]?.reason).toBe('human-comment');
    expect(events[0]?.itemId).toBe('review-commented');
  });

  it('does not wake on a plain DISMISSED review', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot(),
      current: makeSnapshot({
        reviews: [
          {
            id: 'review-dismissed',
            authorLogin: 'ARCJ137442',
            body: '',
            state: 'DISMISSED',
            submittedAt: '2026-03-09T10:03:00.000Z',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events).toEqual([]);
  });

  it('ignores worker progress comments and automation comments while waiting', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot(),
      current: makeSnapshot({
        comments: [
          {
            id: 'comment-worker',
            authorLogin: 'ARCJ137442',
            body: '[Codex Worker]\n\nChange\nUpdated progress.\n\nVerification\n- pending\n\nResult\n- pending',
            createdAt: '2026-03-09T10:02:00.000Z',
          },
          {
            id: 'comment-bot',
            authorLogin: 'cloudflare-workers-and-pages',
            body: 'Deployment successful',
            createdAt: '2026-03-09T10:03:00.000Z',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events).toEqual([]);
  });

  it('wakes when the needs-human-test label is added', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot({ labels: [] }),
      current: makeSnapshot({ labels: ['🙋needs-human-test'] }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events[0]?.reason).toBe('human-test');
  });

  it('keeps compatibility with the legacy human-test label alias', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot({ labels: [] }),
      current: makeSnapshot({ labels: ['🙋 needs-human-test'] }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events[0]?.reason).toBe('human-test');
  });

  it('wakes when a status check turns failed', () => {
    const events = detectWakeEvents({
      previous: makeSnapshot({
        statusChecks: [
          {
            name: 'build',
            status: 'IN_PROGRESS',
            conclusion: '',
          },
        ],
      }),
      current: makeSnapshot({
        statusChecks: [
          {
            name: 'build',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
          },
        ],
      }),
      cursor: {
        lastCommentIds: [],
        lastReviewIds: [],
      },
    });

    expect(events[0]?.reason).toBe('ci-failure');
    expect(events[0]?.summary).toContain('build');
  });

  it('summarizes wake items for heartbeat and resume output', () => {
    const summary = summarizeWakeItems([
      {
        reason: 'reviewer',
        itemId: 'comment-1',
        itemType: 'comment',
        summary: 'ARCJ137442: Need a lock assertion.',
      },
      {
        reason: 'human-comment',
        itemId: 'comment-2',
        itemType: 'comment',
        summary: 'Hailaylin: 请补一条说明。',
      },
    ]);

    expect(summary).toContain('reviewer');
    expect(summary).toContain('human-comment');
  });
});
