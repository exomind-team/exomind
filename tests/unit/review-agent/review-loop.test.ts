import { describe, expect, it } from 'vitest';
import {
  HUMAN_TEST_PREFIX,
  NEEDS_HUMAN_TEST_LABEL,
  buildReviewSummary,
  buildCompletedReviewState,
  buildRetryableReviewFailureState,
  classifyReviewMode,
  mapActionModeToCompletion,
  parseLinkedIssueNumbers,
  prioritizeFiles,
  resolveReviewCommentLanguage,
  type ReviewCompletionResult,
  type PullRequestFile,
  validateReviewComment,
} from '../../../Scripts/review-agent/review-loop-lib.ts';
import {
  executeReviewAction,
  paginatePullFiles,
} from '../../../Scripts/review-agent/review-loop-runtime-lib.ts';

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

  it('builds a review summary with linked issues and no placeholder worktree field', () => {
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
    expect(summary).not.toHaveProperty('needsWorktree');
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
        activeReviewCommentId: '444',
        activeReviewCommentUrl: 'https://example.com/comments/444',
        inspectedPrCount: 8,
        skippedPrCount: 1,
        actionableCount: 2,
        failureStreak: 0,
        nextSleepSeconds: 180,
        updatedAt: '2026-03-10T00:00:00Z',
      },
      activeReviewCommentId: '987',
      activeReviewCommentUrl: 'https://example.com/comments/987',
    });

    expect(state.state).toBe(expectedState);
    expect(state.phase).toBe('REVIEW');
    expect(state.lastPhase).toBe('REVIEW');
    expect(state.nextAction).toBe('discovery');
    expect(state.selectedPrNumber).toBe(450);
    expect(state.selectedReason).toBe('new-comment');
    expect(state.activeReviewCommentId).toBe('987');
    expect(state.activeReviewCommentUrl).toBe('https://example.com/comments/987');
    expect(state.inspectedPrCount).toBe(8);
  });

  it('collects all pull-request files by paginating until the final partial page', async () => {
    const requestedPages: number[] = [];

    const files = await paginatePullFiles(async ({ page, perPage }) => {
      requestedPages.push(page);
      if (page === 1) {
        return Array.from({ length: perPage }, (_, index) => ({
          filename: `src/page-1-file-${index}.ts`,
          status: 'modified',
          additions: 1,
          deletions: 0,
        }));
      }

      return [
        {
          filename: 'src/final-page-file.ts',
          status: 'added',
          additions: 5,
          deletions: 0,
        },
      ];
    });

    expect(requestedPages).toEqual([1, 2]);
    expect(files).toHaveLength(101);
    expect(files.at(-1)).toEqual({
      filename: 'src/final-page-file.ts',
      status: 'added',
      additions: 5,
      deletions: 0,
    });
  });

  it('fails the review when file pagination cannot finish', async () => {
    await expect(
      paginatePullFiles(async ({ page, perPage }) => {
        if (page === 1) {
          return Array.from({ length: perPage }, (_, index) => ({
            filename: `src/page-1-file-${index}.ts`,
            status: 'modified',
            additions: 1,
            deletions: 0,
          }));
        }

        throw new Error('page 2 failed');
      }),
    ).rejects.toThrow('page 2 failed');
  });

  it('maps review fetch failures to a retryable review state', () => {
    const state = buildRetryableReviewFailureState({
      selectedPrNumber: 450,
      previousState: {
        state: 'HAS_TARGET',
        phase: 'REVIEW',
        lastPhase: 'DISCOVERY',
        nextAction: 'review',
        selectedPrNumber: 450,
        selectedReason: 'new-comment',
        activeReviewCommentId: '444',
        activeReviewCommentUrl: 'https://example.com/comments/444',
        inspectedPrCount: 8,
        skippedPrCount: 1,
        actionableCount: 2,
        failureStreak: 0,
        nextSleepSeconds: 180,
        updatedAt: '2026-03-10T00:00:00Z',
      },
      error: 'page 2 failed',
      activeReviewCommentId: '987',
      activeReviewCommentUrl: 'https://example.com/comments/987',
    });

    expect(state.state).toBe('FAILED_RETRYABLE');
    expect(state.phase).toBe('REVIEW');
    expect(state.lastPhase).toBe('REVIEW');
    expect(state.nextAction).toBe('review');
    expect(state.selectedPrNumber).toBe(450);
    expect(state.error).toBe('page 2 failed');
    expect(state.activeReviewCommentId).toBe('987');
    expect(state.activeReviewCommentUrl).toBe('https://example.com/comments/987');
  });

  it('detects the dominant PR language from title/body/comments', () => {
    expect(resolveReviewCommentLanguage({
      title: 'Review agent reliability fixes',
      body: 'This PR updates review actions and router recovery.',
      commentBodies: ['Please verify the retry path.'],
    })).toBe('en');

    expect(resolveReviewCommentLanguage({
      title: '审阅 Agent 动作层',
      body: '补齐评论校验与标签逻辑。',
      commentBodies: ['请继续检查恢复路径。'],
    })).toBe('zh-CN');
  });

  it('validates human-test comments for prefix, label, and label-removal guidance', () => {
    const valid = validateReviewComment({
      body: `${HUMAN_TEST_PREFIX} Manual UI verification is still required.\nAdded the ${NEEDS_HUMAN_TEST_LABEL} label. Please remove the label after finishing manual testing.`,
      expectedLanguage: 'en',
      mode: 'needs-human-test',
    });
    expect(valid.valid).toBe(true);

    const invalid = validateReviewComment({
      body: '[Codex Reviewer] manual test maybe needed',
      expectedLanguage: 'en',
      mode: 'needs-human-test',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('需要人类测试'),
      expect.stringContaining(NEEDS_HUMAN_TEST_LABEL),
      expect.stringContaining('remove the label'),
    ]));
  });

  it('maps review actions to persisted terminal completions', () => {
    expect(mapActionModeToCompletion('comment')).toBe('review-posted');
    expect(mapActionModeToCompletion('request-changes')).toBe('review-posted');
    expect(mapActionModeToCompletion('needs-human-test')).toBe('needs-human-test');
    expect(mapActionModeToCompletion('approve')).toBe('approve-ready');
  });

  it('adds the human-test label before creating the single source-of-truth comment', async () => {
    const steps: string[] = [];

    const result = await executeReviewAction({
      mode: 'needs-human-test',
      body: `${HUMAN_TEST_PREFIX} Manual verification is required.\nAdded the ${NEEDS_HUMAN_TEST_LABEL} label. Please remove the label after finishing manual testing.`,
      expectedLanguage: 'en',
      hasNeedsHumanTestLabel: false,
    }, {
      addLabel: () => {
        steps.push('label');
      },
      createComment: () => {
        steps.push('create-comment');
        return {
          id: '101',
          url: 'https://example.com/comments/101',
          body: 'placeholder',
        };
      },
      editComment: () => {
        throw new Error('should not edit');
      },
      readComment: () => {
        steps.push('read-comment');
        return {
          id: '101',
          url: 'https://example.com/comments/101',
          body: `${HUMAN_TEST_PREFIX} Manual verification is required.\nAdded the ${NEEDS_HUMAN_TEST_LABEL} label. Please remove the label after finishing manual testing.`,
        };
      },
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
    });

    expect(result.status).toBe('completed');
    expect(steps).toEqual(['label', 'create-comment', 'read-comment']);
    if (result.status === 'completed') {
      expect(result.completion).toBe('needs-human-test');
      expect(result.labelAdded).toBe(true);
      expect(result.reviewDecision).toBeNull();
    }
  });

  it('blocks approve while the human-test label is still present', async () => {
    const result = await executeReviewAction({
      mode: 'approve',
      body: '[Codex Reviewer] Reviewed the latest change. No blocking issues remain.',
      expectedLanguage: 'en',
      hasNeedsHumanTestLabel: true,
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: () => {
        throw new Error('should not create comment');
      },
      editComment: () => {
        throw new Error('should not edit comment');
      },
      readComment: () => {
        throw new Error('should not read comment');
      },
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'approve-blocked',
    });
  });

  it('keeps the comment context when request-changes fails after comment publication', async () => {
    const result = await executeReviewAction({
      mode: 'request-changes',
      body: '[Codex Reviewer] Found one blocking issue in the latest patch.',
      expectedLanguage: 'en',
      hasNeedsHumanTestLabel: false,
      commentId: '222',
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: () => {
        throw new Error('should not create comment');
      },
      editComment: (commentId) => ({
        id: commentId,
        url: `https://example.com/comments/${commentId}`,
        body: 'placeholder',
      }),
      readComment: (commentId) => ({
        id: commentId,
        url: `https://example.com/comments/${commentId}`,
        body: '[Codex Reviewer] Found one blocking issue in the latest patch.',
      }),
      submitReviewDecision: () => {
        throw new Error('request changes failed');
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'review-decision',
      commentOperation: 'edited',
      comment: {
        id: '222',
      },
    });
  });
});
