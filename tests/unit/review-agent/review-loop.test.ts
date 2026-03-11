import { describe, expect, it } from 'vitest';
import * as reviewLoopLib from '../../../Scripts/review-agent/review-loop-lib.ts';
import {
  HUMAN_TEST_PREFIX,
  NEEDS_HUMAN_TEST_LABEL,
  buildReviewSummary,
  buildCompletedReviewState,
  buildRetryableReviewFailureState,
  classifyReviewMode,
  buildPullRequestActionJsonFields,
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
  resolveReviewCommentTarget,
} from '../../../Scripts/review-agent/review-loop-runtime-lib.ts';

const PASS_COMMENT_BODY = [
  '[Codex Reviewer] 已审阅最新变更，未发现问题。',
  '结论: 通过',
  '门禁: CI=passed 本地验证=passed',
  '证据: npx vitest run tests/unit/review-agent/review-loop.test.ts',
].join('\n');
const PASS_COMMENT_BODY_INHERITED = [
  '[Codex Reviewer] 已审阅最新变更，未发现问题。已忽略（inherited failure）。',
  '结论: 通过',
  '门禁: CI=inherited-failure 本地验证=passed',
  '证据: npx vitest run tests/unit/review-agent/review-loop.test.ts',
].join('\n');
const MERGE_DISABLED = () => {
  throw new Error('should not merge');
};

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
    ['merge-blocked', 'MERGE_BLOCKED'],
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
    expect(state).not.toHaveProperty('activeReviewCommentId');
    expect(state).not.toHaveProperty('activeReviewCommentUrl');
    expect(state.inspectedPrCount).toBe(8);
  });

  it('preserves the blocking reason on MERGE_BLOCKED terminal states', () => {
    const state = buildCompletedReviewState({
      completion: 'merge-blocked',
      selectedPrNumber: 465,
      previousState: null,
      error: 'viewer cannot merge',
    });

    expect(state.state).toBe('MERGE_BLOCKED');
    expect(state.error).toBe('viewer cannot merge');
  });

  it('treats merge gate failures as terminal merge-blocked outcomes', () => {
    const outcome = (reviewLoopLib as any).resolveReviewFailureCompletion({
      actionMode: 'merge',
      failedStage: 'merge-gate-blocked',
    });

    expect(outcome).toBe('merge-blocked');
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
        inspectedPrCount: 8,
        skippedPrCount: 1,
        actionableCount: 2,
        failureStreak: 0,
        nextSleepSeconds: 180,
        updatedAt: '2026-03-10T00:00:00Z',
      },
      error: 'page 2 failed',
    });

    expect(state.state).toBe('FAILED_RETRYABLE');
    expect(state.phase).toBe('REVIEW');
    expect(state.lastPhase).toBe('REVIEW');
    expect(state.nextAction).toBe('review');
    expect(state.selectedPrNumber).toBe(450);
    expect(state.error).toBe('page 2 failed');
    expect(state).not.toHaveProperty('activeReviewCommentId');
    expect(state).not.toHaveProperty('activeReviewCommentUrl');
  });

  it('prefers an explicit --comment-id over remote comment discovery', async () => {
    const result = await resolveReviewCommentTarget({
      explicitCommentId: '999',
    }, {
      listComments: () => {
        throw new Error('should not query remote comments');
      },
    });

    expect(result).toEqual({
      commentId: '999',
      source: 'explicit',
    });
  });

  it('uses the latest remote [Codex Reviewer] top-level comment as the main comment target', async () => {
    const result = await resolveReviewCommentTarget({}, {
      listComments: () => [
        {
          id: '101',
          body: '[Codex Reviewer] older main comment',
          createdAt: '2026-03-10T10:00:00Z',
        },
        {
          id: '102',
          body: '[Codex Worker] progress update',
          createdAt: '2026-03-10T11:00:00Z',
        },
        {
          id: '103',
          body: '[Codex Reviewer] newer main comment',
          createdAt: '2026-03-10T12:00:00Z',
        },
      ],
    });

    expect(result).toEqual({
      commentId: '103',
      source: 'remote',
    });
  });

  it('creates a new main comment when the PR has no remote [Codex Reviewer] top-level comment', async () => {
    const result = await resolveReviewCommentTarget({}, {
      listComments: () => [
        {
          id: '201',
          body: '[Codex Worker] progress update',
          createdAt: '2026-03-10T10:00:00Z',
        },
      ],
    });

    expect(result).toEqual({
      commentId: null,
      source: 'create',
    });
  });

  it('fails instead of falling back to a persisted comment id when remote main comment lookup fails', async () => {
    await expect(
      resolveReviewCommentTarget({}, {
        listComments: () => {
          throw new Error('remote comment lookup failed');
        },
      }),
    ).rejects.toThrow('remote comment lookup failed');
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

  it('requires a blocking reason or progress update when declaring no issues in a standard comment', () => {
    const missingReason = validateReviewComment({
      body: '[Codex Reviewer] 已审阅最新变更，未发现问题。',
      expectedLanguage: 'zh-CN',
      mode: 'comment',
    });

    expect(missingReason.valid).toBe(false);
    expect(missingReason.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('blocking reason or progress update'),
    ]));

    const missingBlockingDetails = validateReviewComment({
      body: '[Codex Reviewer] 已审阅最新变更，未发现问题。CI 仍为 red。',
      expectedLanguage: 'zh-CN',
      mode: 'comment',
    });

    expect(missingBlockingDetails.valid).toBe(false);
    expect(missingBlockingDetails.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('verification steps'),
      expect.stringContaining('responsibility'),
    ]));

    const withBlockingDetails = validateReviewComment({
      body: '[Codex Reviewer] 已审阅最新变更，未发现问题。阻塞原因：CI 仍为 red。核查方法：对比基分支与当前 PR 的同名检查结果。责任/下一步：请工作 Agent 在 CI 绿或确认继承失败后推进。',
      expectedLanguage: 'zh-CN',
      mode: 'comment',
    });

    expect(withBlockingDetails.valid).toBe(true);

    const withEnglishBlockingDetails = validateReviewComment({
      body: '[Codex Reviewer] No issues found. Blocking reason: CI still red. Verification: compare base vs PR check-runs. Responsibility: waiting on CI owner or Worker follow-up.',
      expectedLanguage: 'en',
      mode: 'comment',
    });

    expect(withEnglishBlockingDetails.valid).toBe(true);

    const missingProgressAction = validateReviewComment({
      body: '[Codex Reviewer] 已审阅最新变更，未发现问题。最新进展：暂无。',
      expectedLanguage: 'zh-CN',
      mode: 'comment',
    });

    expect(missingProgressAction.valid).toBe(false);
    expect(missingProgressAction.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('PR state change'),
    ]));

    const withProgressUpdate = validateReviewComment({
      body: '[Codex Reviewer] 已审阅最新变更，未发现问题。最新进展：已同步 dev 并更新 PR 描述，准备进入 approve gate。',
      expectedLanguage: 'zh-CN',
      mode: 'comment',
    });

    expect(withProgressUpdate.valid).toBe(true);
  });

  it('validates merge-ready pass comments for required fields and inherited failure markers', () => {
    const valid = validateReviewComment({
      body: PASS_COMMENT_BODY,
      expectedLanguage: 'zh-CN',
      mode: 'merge',
      approvalGate: {
        ciStatus: 'passed',
        localVerificationStatus: 'passed',
      },
    });

    expect(valid.valid).toBe(true);

    const missingFields = validateReviewComment({
      body: [
        '[Codex Reviewer] 已审阅最新变更，未发现问题。',
        '结论: 通过',
        '门禁: CI=passed 本地验证=passed',
      ].join('\n'),
      expectedLanguage: 'zh-CN',
      mode: 'merge',
      approvalGate: {
        ciStatus: 'passed',
        localVerificationStatus: 'passed',
      },
    });

    expect(missingFields.valid).toBe(false);
    expect(missingFields.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('证据'),
    ]));

    const missingMarker = validateReviewComment({
      body: PASS_COMMENT_BODY_INHERITED.replace('已忽略（inherited failure）。', ''),
      expectedLanguage: 'zh-CN',
      mode: 'merge',
      approvalGate: {
        ciStatus: 'inherited-failure',
        localVerificationStatus: 'passed',
      },
    });

    expect(missingMarker.valid).toBe(false);
    expect(missingMarker.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('inherited failure'),
    ]));

    const withMarker = validateReviewComment({
      body: PASS_COMMENT_BODY_INHERITED,
      expectedLanguage: 'zh-CN',
      mode: 'merge',
      approvalGate: {
        ciStatus: 'inherited-failure',
        localVerificationStatus: 'passed',
      },
    });

    expect(withMarker.valid).toBe(true);
  });

  it('rejects suspicious full-width question-mark runs in zh-CN comments', () => {
    const result = validateReviewComment({
      body: '[Codex Reviewer] 已审阅最新变更，是否已完成验证？？？？？',
      expectedLanguage: 'zh-CN',
      mode: 'comment',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('question marks'),
    ]));
  });

  it('maps review actions to persisted terminal completions', () => {
    expect(mapActionModeToCompletion('comment')).toBe('review-posted');
    expect(mapActionModeToCompletion('request-changes')).toBe('review-posted');
    expect(mapActionModeToCompletion('needs-human-test')).toBe('needs-human-test');
    expect(mapActionModeToCompletion('approve')).toBe('approve-ready');
  });

  it('does not request viewerCanMerge for non-merge review actions', () => {
    expect(buildPullRequestActionJsonFields('comment')).toEqual([
      'number',
      'title',
      'body',
      'url',
      'labels',
      'comments',
    ]);
    expect(buildPullRequestActionJsonFields('approve')).toEqual([
      'number',
      'title',
      'body',
      'url',
      'labels',
      'comments',
    ]);
  });

  it('requests viewerCanMerge only for merge actions', () => {
    expect(buildPullRequestActionJsonFields('merge')).toEqual([
      'number',
      'title',
      'body',
      'url',
      'labels',
      'comments',
      'viewerCanMerge',
    ]);
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
      createComment: (_body) => {
        steps.push('create-comment');
        return {
          id: '101',
          url: 'https://example.com/comments/101',
          body: 'placeholder',
        };
      },
      editComment: (_commentId, _body) => {
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
      mergePullRequest: MERGE_DISABLED,
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
      createComment: (_body) => {
        throw new Error('should not create comment');
      },
      editComment: (_commentId, _body) => {
        throw new Error('should not edit comment');
      },
      readComment: () => {
        throw new Error('should not read comment');
      },
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
      mergePullRequest: MERGE_DISABLED,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'approve-blocked',
    });
  });

  it('blocks approve when CI and local verification gates are missing', async () => {
    const result = await executeReviewAction({
      mode: 'approve',
      body: '[Codex Reviewer] Reviewed the latest change. No blocking issues remain.',
      expectedLanguage: 'en',
      hasNeedsHumanTestLabel: false,
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (_body) => ({
        id: '301',
        url: 'https://example.com/comments/301',
        body: 'placeholder',
      }),
      editComment: (_commentId, _body) => {
        throw new Error('should not edit comment');
      },
      readComment: () => ({
        id: '301',
        url: 'https://example.com/comments/301',
        body: '[Codex Reviewer] Reviewed the latest change. No blocking issues remain.',
      }),
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
      mergePullRequest: MERGE_DISABLED,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'approve-blocked',
    });
  });

  it('blocks approve when CI or local verification gates are red', async () => {
    const input = {
      mode: 'approve' as const,
      body: '[Codex Reviewer] Reviewed the latest change. No blocking issues remain.',
      expectedLanguage: 'en' as const,
      hasNeedsHumanTestLabel: false,
      approvalGate: {
        ciStatus: 'failed' as const,
        localVerificationStatus: 'passed' as const,
      },
    };

    const result = await executeReviewAction(input, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (_body) => ({
        id: '302',
        url: 'https://example.com/comments/302',
        body: 'placeholder',
      }),
      editComment: (_commentId, _body) => {
        throw new Error('should not edit comment');
      },
      readComment: () => ({
        id: '302',
        url: 'https://example.com/comments/302',
        body: '[Codex Reviewer] Reviewed the latest change. No blocking issues remain.',
      }),
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
      mergePullRequest: MERGE_DISABLED,
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
      createComment: (_body) => {
        throw new Error('should not create comment');
      },
      editComment: (commentId, _body) => ({
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
      mergePullRequest: MERGE_DISABLED,
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

  it('blocks merge when CI or local verification gates are missing', async () => {
    const result = await executeReviewAction({
      mode: 'merge',
      body: PASS_COMMENT_BODY,
      expectedLanguage: 'zh-CN',
      hasNeedsHumanTestLabel: false,
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (_body) => {
        throw new Error('should not create comment');
      },
      editComment: (_commentId, _body) => {
        throw new Error('should not edit comment');
      },
      readComment: () => {
        throw new Error('should not read comment');
      },
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
      mergePullRequest: MERGE_DISABLED,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'merge-gate-blocked',
    });
  });

  it('blocks merge when CI is failed even if local verification passed', async () => {
    const result = await executeReviewAction({
      mode: 'merge',
      body: PASS_COMMENT_BODY,
      expectedLanguage: 'zh-CN',
      hasNeedsHumanTestLabel: false,
      approvalGate: {
        ciStatus: 'failed',
        localVerificationStatus: 'passed',
      },
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (_body) => {
        throw new Error('should not create comment');
      },
      editComment: (_commentId, _body) => {
        throw new Error('should not edit comment');
      },
      readComment: () => {
        throw new Error('should not read comment');
      },
      submitReviewDecision: () => {
        throw new Error('should not submit review decision');
      },
      mergePullRequest: MERGE_DISABLED,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failedStage: 'merge-gate-blocked',
    });
  });

  it('records approve failures but still merges when gates pass', async () => {
    const steps: string[] = [];
    let writtenBody = '';

    const result = await executeReviewAction({
      mode: 'merge',
      body: PASS_COMMENT_BODY,
      expectedLanguage: 'zh-CN',
      hasNeedsHumanTestLabel: false,
      approvalGate: {
        ciStatus: 'passed',
        localVerificationStatus: 'passed',
      },
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (body) => {
        steps.push('create-comment');
        writtenBody = body;
        return {
          id: '501',
          url: 'https://example.com/comments/501',
          body,
        };
      },
      editComment: (_commentId, _body) => {
        throw new Error('should not edit comment');
      },
      readComment: () => {
        steps.push('read-comment');
        return {
          id: '501',
          url: 'https://example.com/comments/501',
          body: writtenBody,
        };
      },
      submitReviewDecision: () => {
        steps.push('approve');
        throw new Error('approve denied');
      },
      mergePullRequest: () => {
        steps.push('merge');
      },
    });

    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.completion).toBe('merge-ready');
      expect(result.reviewDecision).toBe('approve');
      expect(result.approveFailure).toContain('approve denied');
    }
    expect(writtenBody).toContain('approve 失败');
    expect(steps).toEqual(['approve', 'create-comment', 'read-comment', 'merge']);
  });

  it('marks merge-blocked and updates the comment when merge hits a conflict', async () => {
    let createdBody = '';
    let editedBody = '';

    const result = await executeReviewAction({
      mode: 'merge',
      body: PASS_COMMENT_BODY,
      expectedLanguage: 'zh-CN',
      hasNeedsHumanTestLabel: false,
      approvalGate: {
        ciStatus: 'passed',
        localVerificationStatus: 'passed',
      },
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (body) => {
        createdBody = body;
        return {
          id: '601',
          url: 'https://example.com/comments/601',
          body,
        };
      },
      editComment: (commentId, body) => {
        editedBody = body;
        return {
          id: commentId,
          url: `https://example.com/comments/${commentId}`,
          body,
        };
      },
      readComment: () => ({
        id: '601',
        url: 'https://example.com/comments/601',
        body: createdBody,
      }),
      submitReviewDecision: () => {},
      mergePullRequest: () => {
        throw new Error('merge conflict detected');
      },
    });

    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.completion).toBe('merge-blocked');
      expect(result.mergeFailureKind).toBe('blocked');
      expect(result.mergeFailure).toContain('merge conflict');
    }
    expect(editedBody).toContain('合并阻塞');
    expect(editedBody).toContain('请同步目标分支后重试');
  });

  it('marks merge-blocked without calling merge when viewerCanMerge is false', async () => {
    let createdBody = '';
    let editedBody = '';
    const steps: string[] = [];

    const result = await executeReviewAction({
      mode: 'merge',
      body: PASS_COMMENT_BODY,
      expectedLanguage: 'zh-CN',
      hasNeedsHumanTestLabel: false,
      viewerCanMerge: false,
      approvalGate: {
        ciStatus: 'passed',
        localVerificationStatus: 'passed',
      },
    }, {
      addLabel: () => {
        throw new Error('should not add label');
      },
      createComment: (body) => {
        steps.push('create-comment');
        createdBody = body;
        return {
          id: '701',
          url: 'https://example.com/comments/701',
          body,
        };
      },
      editComment: (commentId, body) => {
        steps.push('edit-comment');
        editedBody = body;
        return {
          id: commentId,
          url: `https://example.com/comments/${commentId}`,
          body,
        };
      },
      readComment: () => {
        steps.push('read-comment');
        return {
          id: '701',
          url: 'https://example.com/comments/701',
          body: editedBody || createdBody,
        };
      },
      submitReviewDecision: () => {
        steps.push('approve');
      },
      mergePullRequest: () => {
        steps.push('merge');
        throw new Error('should not merge when viewerCanMerge is false');
      },
    });

    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.completion).toBe('merge-blocked');
      expect(result.mergeFailureKind).toBe('blocked');
      expect(result.mergeFailure).toContain('viewerCanMerge=false');
    }
    expect(steps).toEqual(['approve', 'create-comment', 'read-comment', 'edit-comment', 'read-comment']);
    expect(editedBody).toContain('合并阻塞');
    expect(editedBody).toContain('viewerCanMerge=false');
  });
});
