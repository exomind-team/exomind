import { REVIEWER_PREFIX } from './discovery-lib.ts';
import {
  NEEDS_HUMAN_TEST_LABEL,
  findApproveBlockingReason,
  findMergeBlockingReason,
  mapActionModeToCompletion,
  validateReviewComment,
  type ReviewApprovalGate,
  type ReviewActionMode,
  type ReviewActionFailureStage,
  type ReviewCommentLanguage,
  type ReviewCompletionResult,
} from './review-loop-lib.ts';

export interface PullFileApiItem {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface ReviewCommentRecord {
  id: string;
  url: string;
  body: string;
}

export interface ReviewCommentTargetCandidate {
  id: string;
  body?: string;
  createdAt?: string | null;
}

export interface ExecuteReviewActionInput {
  mode: ReviewActionMode;
  body: string;
  expectedLanguage: ReviewCommentLanguage | null;
  hasNeedsHumanTestLabel: boolean;
  commentId?: string | null;
  approvalGate?: ReviewApprovalGate;
}

interface ExecuteReviewActionDeps {
  createComment: (body: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  editComment: (commentId: string, body: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  readComment: (commentId: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  addLabel: (label: string) => Promise<void> | void;
  submitReviewDecision: (decision: 'request-changes' | 'approve') => Promise<void> | void;
  mergePullRequest: () => Promise<void> | void;
}

interface ResolveReviewCommentTargetInput {
  explicitCommentId?: string;
}

interface ResolveReviewCommentTargetDeps {
  listComments: () => Promise<ReviewCommentTargetCandidate[]> | ReviewCommentTargetCandidate[];
}

export async function resolveReviewCommentTarget(
  input: ResolveReviewCommentTargetInput,
  deps: ResolveReviewCommentTargetDeps,
): Promise<{ commentId: string | null; source: 'explicit' | 'remote' | 'create' }> {
  if (input.explicitCommentId) {
    return {
      commentId: input.explicitCommentId,
      source: 'explicit',
    };
  }

  const comments = await deps.listComments();
  const remoteComment = findLatestMainReviewComment(comments);
  if (remoteComment) {
    return {
      commentId: remoteComment.id,
      source: 'remote',
    };
  }

  return {
    commentId: null,
    source: 'create',
  };
}

export type ExecuteReviewActionResult =
  | {
      status: 'completed';
      comment: ReviewCommentRecord;
      commentOperation: 'created' | 'edited';
      completion: ReviewCompletionResult;
      labelAdded: boolean;
      reviewDecision: 'request-changes' | 'approve' | null;
      reviewDecisionAttempted: 'request-changes' | 'approve' | null;
      approveFailure?: string | null;
      mergeFailure?: string | null;
      mergeFailureKind?: 'blocked' | 'retryable' | null;
    }
  | {
      status: 'comment-invalid';
      comment: ReviewCommentRecord;
      commentOperation: 'created' | 'edited';
      validationErrors: string[];
      labelAdded: boolean;
      reviewDecision: 'request-changes' | 'approve' | null;
      reviewDecisionAttempted: 'request-changes' | 'approve' | null;
      approveFailure?: string | null;
    }
  | {
      status: 'failed';
      failedStage: ReviewActionFailureStage;
      error: string;
      comment?: ReviewCommentRecord;
      commentOperation?: 'created' | 'edited';
      labelAdded: boolean;
      reviewDecision: 'request-changes' | 'approve' | null;
      reviewDecisionAttempted: 'request-changes' | 'approve' | null;
      approveFailure?: string | null;
    };

interface PaginatePullFilesArgs {
  page: number;
  perPage: number;
}

export async function paginatePullFiles(
  fetchPage: (args: PaginatePullFilesArgs) => Promise<PullFileApiItem[]> | PullFileApiItem[],
  perPage = 100,
): Promise<PullFileApiItem[]> {
  const allFiles: PullFileApiItem[] = [];

  for (let page = 1; ; page += 1) {
    const pageItems = await fetchPage({ page, perPage });
    allFiles.push(...pageItems);

    if (pageItems.length < perPage) {
      return allFiles;
    }
  }
}

export async function executeReviewAction(
  input: ExecuteReviewActionInput,
  deps: ExecuteReviewActionDeps,
): Promise<ExecuteReviewActionResult> {
  let approveFailure: string | null = null;
  let reviewDecision: 'request-changes' | 'approve' | null = null;
  let reviewDecisionAttempted: 'request-changes' | 'approve' | null = null;

  if (input.mode === 'approve') {
    const approveBlockingReason = findApproveBlockingReason({
      hasNeedsHumanTestLabel: input.hasNeedsHumanTestLabel,
      approvalGate: input.approvalGate,
    });
    if (approveBlockingReason) {
      return {
        status: 'failed',
        failedStage: 'approve-blocked',
        error: approveBlockingReason,
        labelAdded: false,
        reviewDecision: null,
        reviewDecisionAttempted: null,
      };
    }
  }

  if (input.mode === 'merge') {
    const mergeBlockingReason = findMergeBlockingReason({
      hasNeedsHumanTestLabel: input.hasNeedsHumanTestLabel,
      approvalGate: input.approvalGate,
    });
    if (mergeBlockingReason) {
      return {
        status: 'failed',
        failedStage: 'merge-gate-blocked',
        error: mergeBlockingReason,
        labelAdded: false,
        reviewDecision: null,
        reviewDecisionAttempted: null,
      };
    }

    reviewDecisionAttempted = 'approve';
    try {
      await deps.submitReviewDecision('approve');
      reviewDecision = 'approve';
    } catch (error) {
      approveFailure = toErrorMessage(error);
    }
  }

  let labelAdded = false;
  if (input.mode === 'needs-human-test' && !input.hasNeedsHumanTestLabel) {
    try {
      await deps.addLabel(NEEDS_HUMAN_TEST_LABEL);
      labelAdded = true;
    } catch (error) {
      return {
        status: 'failed',
        failedStage: 'label',
        error: toErrorMessage(error),
        labelAdded: false,
        reviewDecision: null,
        reviewDecisionAttempted: null,
      };
    }
  }

  const commentOperation = input.commentId ? 'edited' : 'created';
  const bodyToPublish = approveFailure
    ? appendApproveFailureNote(input.body, approveFailure, input.expectedLanguage)
    : input.body;
  let writtenComment: ReviewCommentRecord;
  try {
    writtenComment = input.commentId
      ? await deps.editComment(input.commentId, bodyToPublish)
      : await deps.createComment(bodyToPublish);
  } catch (error) {
    return {
      status: 'failed',
      failedStage: 'comment-write',
      error: toErrorMessage(error),
      labelAdded,
      reviewDecision,
      reviewDecisionAttempted,
      approveFailure,
    };
  }

  let comment: ReviewCommentRecord;
  try {
    comment = await deps.readComment(writtenComment.id);
  } catch (error) {
    return {
      status: 'failed',
      failedStage: 'comment-read',
      error: toErrorMessage(error),
      comment: writtenComment,
      commentOperation,
      labelAdded,
      reviewDecision,
      reviewDecisionAttempted,
      approveFailure,
    };
  }

  const validation = validateReviewComment({
    body: comment.body,
    expectedLanguage: input.expectedLanguage,
    mode: input.mode,
    approvalGate: input.approvalGate,
  });
  if (!validation.valid) {
    return {
      status: 'comment-invalid',
      comment,
      commentOperation,
      validationErrors: validation.errors,
      labelAdded,
      reviewDecision,
      reviewDecisionAttempted,
      approveFailure,
    };
  }

  if (input.mode === 'request-changes' || input.mode === 'approve') {
    reviewDecisionAttempted = input.mode;
    try {
      await deps.submitReviewDecision(input.mode);
      reviewDecision = input.mode;
    } catch (error) {
      return {
        status: 'failed',
        failedStage: 'review-decision',
        error: toErrorMessage(error),
        comment,
        commentOperation,
        labelAdded,
        reviewDecision,
        reviewDecisionAttempted,
      };
    }

    return {
      status: 'completed',
      comment,
      commentOperation,
      completion: mapActionModeToCompletion(input.mode),
      labelAdded,
      reviewDecision,
      reviewDecisionAttempted,
    };
  }

  if (input.mode === 'merge') {
    try {
      await deps.mergePullRequest();
    } catch (error) {
      const mergeFailure = toErrorMessage(error);
      const classification = classifyMergeFailure(mergeFailure);
      if (classification.kind === 'blocked') {
        return completeBlockedMerge({
          comment,
          commentOperation,
          labelAdded,
          approveFailure,
          error: mergeFailure,
          needsSync: classification.needsSync,
          expectedLanguage: input.expectedLanguage,
          approvalGate: input.approvalGate,
          reviewDecision,
          reviewDecisionAttempted,
          deps,
        });
      }

      return {
        status: 'failed',
        failedStage: 'merge-failed',
        error: mergeFailure,
        comment,
        commentOperation,
        labelAdded,
        reviewDecision,
        reviewDecisionAttempted,
        approveFailure,
      };
    }

    return {
      status: 'completed',
      comment,
      commentOperation,
      completion: 'merge-ready',
      labelAdded,
      reviewDecision,
      reviewDecisionAttempted,
      approveFailure,
      mergeFailure: null,
      mergeFailureKind: null,
    };
  }

  return {
    status: 'completed',
    comment,
    commentOperation,
    completion: mapActionModeToCompletion(input.mode),
    labelAdded,
    reviewDecision,
    reviewDecisionAttempted,
  };
}

function findLatestMainReviewComment(
  comments: ReviewCommentTargetCandidate[],
): ReviewCommentTargetCandidate | null {
  const mainComments = comments.filter((comment) => isMainReviewComment(comment.body));
  if (mainComments.length === 0) {
    return null;
  }

  return [...mainComments].sort((left, right) => {
    const timeDelta = toEpoch(right.createdAt) - toEpoch(left.createdAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return right.id.localeCompare(left.id);
  })[0] ?? null;
}

function isMainReviewComment(body: string | undefined): boolean {
  return (body ?? '').trimStart().startsWith(REVIEWER_PREFIX);
}

function toEpoch(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? Number.NEGATIVE_INFINITY : epoch;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function appendApproveFailureNote(
  body: string,
  error: string,
  language: ReviewCommentLanguage | null,
): string {
  if (language === 'en') {
    return `${body}\n\nNote: formal approve failed (${error}), but merge can still continue because comment-equivalent approval already passed.`;
  }

  return `${body}\n\n备注：formal approve 失败（原因：${error}），但“评论即通过”门禁已满足，不阻塞后续合并尝试。`;
}

function appendMergeFailureNote(
  body: string,
  error: string,
  needsSync: boolean,
  language: ReviewCommentLanguage | null,
): string {
  const lines = language === 'en'
    ? [`Merge blocked: ${error}`]
    : [`合并阻塞：${error}`];
  if (needsSync) {
    lines.push(language === 'en' ? 'Please sync the target branch and retry.' : '请同步目标分支后重试。');
  }
  return `${body}\n\n${lines.join('\n')}`;
}

function classifyMergeFailure(error: string): { kind: 'blocked' | 'retryable'; needsSync: boolean } {
  const normalized = error.toLowerCase();
  const isPermission = /forbidden|not authorized|permission|access denied|insufficient|resource not accessible by integration/.test(normalized);
  const isProtected = /protected branch|branch protection|required status|required review/.test(normalized);
  const isConflict = /merge conflict|conflict|not mergeable|cannot merge|mergeable/.test(normalized);

  if (isPermission || isProtected || isConflict) {
    return {
      kind: 'blocked',
      needsSync: isConflict,
    };
  }

  return {
    kind: 'retryable',
    needsSync: false,
  };
}

async function completeBlockedMerge(input: {
  comment: ReviewCommentRecord;
  commentOperation: 'created' | 'edited';
  labelAdded: boolean;
  approveFailure: string | null;
  error: string;
  needsSync: boolean;
  expectedLanguage: ReviewCommentLanguage | null;
  approvalGate?: ReviewApprovalGate;
  reviewDecision: 'request-changes' | 'approve' | null;
  reviewDecisionAttempted: 'request-changes' | 'approve' | null;
  deps: Pick<ExecuteReviewActionDeps, 'editComment' | 'readComment'>;
}): Promise<ExecuteReviewActionResult> {
  const updatedBody = appendMergeFailureNote(
    input.comment.body,
    input.error,
    input.needsSync,
    input.expectedLanguage,
  );

  let comment = input.comment;
  try {
    const editedComment = await input.deps.editComment(comment.id, updatedBody);
    comment = await input.deps.readComment(editedComment.id);
  } catch (error) {
    return {
      status: 'failed',
      failedStage: 'comment-write',
      error: toErrorMessage(error),
      comment,
      commentOperation: input.commentOperation,
      labelAdded: input.labelAdded,
      reviewDecision: input.reviewDecision,
      reviewDecisionAttempted: input.reviewDecisionAttempted,
      approveFailure: input.approveFailure,
    };
  }

  const updatedValidation = validateReviewComment({
    body: comment.body,
    expectedLanguage: input.expectedLanguage,
    mode: 'merge',
    approvalGate: input.approvalGate,
  });
  if (!updatedValidation.valid) {
    return {
      status: 'comment-invalid',
      comment,
      commentOperation: input.commentOperation,
      validationErrors: updatedValidation.errors,
      labelAdded: input.labelAdded,
      reviewDecision: input.reviewDecision,
      reviewDecisionAttempted: input.reviewDecisionAttempted,
      approveFailure: input.approveFailure,
    };
  }

  return {
    status: 'completed',
    comment,
    commentOperation: input.commentOperation,
    completion: 'merge-blocked',
    labelAdded: input.labelAdded,
    reviewDecision: input.reviewDecision,
    reviewDecisionAttempted: input.reviewDecisionAttempted,
    approveFailure: input.approveFailure,
    mergeFailure: input.error,
    mergeFailureKind: 'blocked',
  };
}
