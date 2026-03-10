import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryRound,
  classifyPullRequest,
  computeNextBackoff,
  REVIEWER_PREFIX,
  type PullRequestSnapshot,
} from '../../../Scripts/review-agent/discovery-lib.ts';
import * as discoveryRuntime from '../../../Scripts/review-agent/discovery-runtime-lib.ts';
import { loadThreadRepliesWithFallback } from '../../../Scripts/review-agent/discovery-runtime-lib.ts';

function makeSnapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    number: 101,
    title: 'PR 101',
    url: 'https://github.com/exomind-team/exomind/pull/101',
    updatedAt: '2026-03-09T10:00:00Z',
    comments: [],
    reviews: [],
    threadReplies: [],
    commits: [],
    ...overrides,
  };
}

describe('review-agent discovery', () => {
  it('marks PR actionable when no reviewer comment exists', () => {
    const result = classifyPullRequest(makeSnapshot());

    expect(result.actionable).toBe(true);
    expect(result.reason).toBe('missing-reviewer-comment');
    expect(result.lastReviewerAt).toBeNull();
  });

  it('marks PR actionable when a newer top-level comment exists after the reviewer comment', () => {
    const result = classifyPullRequest(
      makeSnapshot({
        comments: [
          { body: `${REVIEWER_PREFIX} reviewed`, createdAt: '2026-03-09T09:00:00Z' },
          { body: 'follow-up comment', createdAt: '2026-03-09T09:30:00Z' },
        ],
      }),
    );

    expect(result.actionable).toBe(true);
    expect(result.reason).toBe('new-comment');
    expect(result.lastReviewerAt).toBe('2026-03-09T09:00:00Z');
    expect(result.latestActivityAt).toBe('2026-03-09T09:30:00Z');
  });

  it('marks PR actionable when a newer commit exists after the reviewer comment', () => {
    const result = classifyPullRequest(
      makeSnapshot({
        comments: [
          { body: `${REVIEWER_PREFIX} reviewed`, createdAt: '2026-03-09T09:00:00Z' },
        ],
        commits: [
          { committedDate: '2026-03-09T09:45:00Z', oid: 'abc123' },
        ],
      }),
    );

    expect(result.actionable).toBe(true);
    expect(result.reason).toBe('new-commit');
    expect(result.latestActivityAt).toBe('2026-03-09T09:45:00Z');
  });

  it('marks PR actionable when a newer review thread reply exists after the reviewer comment', () => {
    const result = classifyPullRequest(
      makeSnapshot({
        comments: [
          { body: `${REVIEWER_PREFIX} reviewed`, createdAt: '2026-03-09T09:00:00Z' },
        ],
        threadReplies: [
          { id: 'thread-1', createdAt: '2026-03-09T09:20:00Z', body: 'reply' },
        ],
      }),
    );

    expect(result.actionable).toBe(true);
    expect(result.reason).toBe('new-thread-reply');
    expect(result.latestActivityAt).toBe('2026-03-09T09:20:00Z');
  });

  it('skips PR when no newer comment, review, or commit exists after the latest reviewer comment', () => {
    const result = classifyPullRequest(
      makeSnapshot({
        comments: [
          { body: `${REVIEWER_PREFIX} old review`, createdAt: '2026-03-09T08:00:00Z' },
          { body: `${REVIEWER_PREFIX} latest review`, createdAt: '2026-03-09T09:00:00Z' },
        ],
        commits: [
          { committedDate: '2026-03-09T08:30:00Z', oid: 'abc123' },
        ],
      }),
    );

    expect(result.actionable).toBe(false);
    expect(result.reason).toBe('up-to-date');
    expect(result.lastReviewerAt).toBe('2026-03-09T09:00:00Z');
  });

  it('builds an actionable queue sorted by updatedAt descending and selects the first PR', () => {
    const round = buildDiscoveryRound(
      [
        makeSnapshot({
          number: 201,
          title: 'older actionable',
          updatedAt: '2026-03-09T08:00:00Z',
        }),
        makeSnapshot({
          number: 202,
          title: 'newer actionable',
          updatedAt: '2026-03-09T10:00:00Z',
        }),
        makeSnapshot({
          number: 203,
          title: 'already reviewed',
          updatedAt: '2026-03-09T09:00:00Z',
          comments: [{ body: `${REVIEWER_PREFIX} latest`, createdAt: '2026-03-09T09:00:00Z' }],
        }),
      ],
      {
        nextSleepSeconds: 180,
        consecutiveNoChangeRounds: 0,
      },
    );

    expect(round.state).toBe('HAS_TARGET');
    expect(round.actionablePrs.map((pr) => pr.number)).toEqual([202, 201]);
    expect(round.selectedPr?.number).toBe(202);
    expect(round.pendingQueue.map((pr) => pr.number)).toEqual([201]);
    expect(round.nextSleepSeconds).toBe(180);
  });

  it('keeps the first no-change backoff at 180 seconds and then doubles it on consecutive no-change rounds', () => {
    const first = computeNextBackoff(
      {
        nextSleepSeconds: 180,
        consecutiveNoChangeRounds: 0,
      },
      false,
    );
    const second = computeNextBackoff(first, false);
    const reset = computeNextBackoff(second, true);

    expect(first).toEqual({
      nextSleepSeconds: 180,
      consecutiveNoChangeRounds: 1,
    });
    expect(second).toEqual({
      nextSleepSeconds: 360,
      consecutiveNoChangeRounds: 2,
    });
    expect(reset).toEqual({
      nextSleepSeconds: 180,
      consecutiveNoChangeRounds: 0,
    });
  });

  it('degrades thread reply fetch failures to an empty list with a visible warning', () => {
    const result = loadThreadRepliesWithFallback(101, () => {
      throw new Error('graphql unavailable');
    });

    expect(result.threadReplies).toEqual([]);
    expect(result.warning).toMatchObject({
      prNumber: 101,
      signal: 'review-thread-replies',
    });
    expect(result.warning?.message).toContain('graphql unavailable');
  });

  it('passes thread replies through without warning when the fetch succeeds', () => {
    const result = loadThreadRepliesWithFallback(101, () => [
      { id: 'thread-1', body: 'reply', createdAt: '2026-03-10T01:00:00Z' },
    ]);

    expect(result.threadReplies).toEqual([
      { id: 'thread-1', body: 'reply', createdAt: '2026-03-10T01:00:00Z' },
    ]);
    expect(result.warning).toBeUndefined();
  });

  it('builds a GET-style thread reply API request so gh api does not downgrade into POST 422s', () => {
    const buildArgs = (
      discoveryRuntime as {
        buildReviewThreadReplyApiArgs?: (
          repo: string,
          prNumber: number,
          page: number,
          perPage: number,
        ) => string[];
      }
    ).buildReviewThreadReplyApiArgs;

    expect(buildArgs).toBeTypeOf('function');
    expect(buildArgs?.('exomind-team/exomind', 101, 2, 100)).toEqual([
      'api',
      '--method',
      'GET',
      'repos/exomind-team/exomind/pulls/101/comments?per_page=100&page=2',
    ]);
  });
});
