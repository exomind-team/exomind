import { describe, expect, it } from 'vitest';
import {
  buildReviewSummary,
  buildCompletedReviewState,
  classifyReviewMode,
  parseLinkedIssueNumbers,
  prioritizeFiles,
  type ReviewCompletionResult,
  type PullRequestFile,
} from '../../../Scripts/review-agent/review-loop-lib.ts';

describe('review-agent review loop', () => {
  it('parses refs/closes/fixes issue ids and removes duplicates', () => {
    const issueNumbers = parseLinkedIssueNumbers(`
      closes #123
      Refs #124
      fixes exomind-team/exomind#123
      unrelated #999
    `);

    expect(issueNumbers).toEqual([123, 124]);
  });

  it('uses full-review when diff is small enough', () => {
    const result = classifyReviewMode({
      changedFiles: 3,
      additions: 40,
      deletions: 30,
    });

    expect(result).toBe('full-review');
  });

  it('uses priority-review when diff is too large', () => {
    const result = classifyReviewMode({
      changedFiles: 8,
      additions: 70,
      deletions: 40,
    });

    expect(result).toBe('priority-review');
  });

  it('prioritizes new files, tests, service/controller/model files, then the rest', () => {
    const files: PullRequestFile[] = [
      { path: 'src/misc/logger.ts', status: 'modified', additions: 5, deletions: 1 },
      { path: 'src/services/user-service.ts', status: 'modified', additions: 10, deletions: 2 },
      { path: 'tests/unit/review-agent/review-loop.test.ts', status: 'modified', additions: 20, deletions: 0 },
      { path: 'src/controllers/pr-controller.ts', status: 'added', additions: 30, deletions: 0 },
    ];

    expect(prioritizeFiles(files).map((file) => file.path)).toEqual([
      'src/controllers/pr-controller.ts',
      'tests/unit/review-agent/review-loop.test.ts',
      'src/services/user-service.ts',
      'src/misc/logger.ts',
    ]);
  });

  it('builds a review summary with linked issues and worktree need', () => {
    const summary = buildReviewSummary({
      prNumber: 450,
      title: 'review agent',
      body: 'closes #450 refs #463',
      changedFiles: 7,
      additions: 90,
      deletions: 20,
      files: [
        { path: 'Scripts/review-agent/review-loop.ts', status: 'added', additions: 50, deletions: 0 },
      ],
    });

    expect(summary.linkedIssues).toEqual([450, 463]);
    expect(summary.reviewMode).toBe('priority-review');
    expect(summary.needsWorktree).toBe(false);
    expect(summary.prioritizedFiles.map((file) => file.path)).toEqual([
      'Scripts/review-agent/review-loop.ts',
    ]);
  });

  it.each([
    ['review-posted', 'REVIEW_POSTED'],
    ['needs-human-test', 'NEEDS_HUMAN_TEST'],
    ['approve-ready', 'APPROVE_READY'],
    ['merge-ready', 'MERGE_READY'],
  ] as const)('maps %s to persisted terminal state %s', (completion, expectedState) => {
    const state = buildCompletedReviewState({
      completion: completion as ReviewCompletionResult,
      selectedPrNumber: 450,
      previousState: {
        state: 'HAS_TARGET',
        phase: 'REVIEW',
        lastPhase: 'DISCOVERY',
        nextAction: 'review',
        selectedPrNumber: 450,
        selectedReason: 'new-comment',
        inspectedPrCount: 8,
        skippedPrCount: 1,
        actionableCount: 2,
        failureStreak: 0,
        nextSleepSeconds: 180,
        updatedAt: '2026-03-10T00:00:00Z',
      },
    });

    expect(state.state).toBe(expectedState);
    expect(state.phase).toBe('REVIEW');
    expect(state.lastPhase).toBe('REVIEW');
    expect(state.nextAction).toBe('discovery');
    expect(state.selectedPrNumber).toBe(450);
    expect(state.selectedReason).toBe('new-comment');
    expect(state.inspectedPrCount).toBe(8);
  });
});
