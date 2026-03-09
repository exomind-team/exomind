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
