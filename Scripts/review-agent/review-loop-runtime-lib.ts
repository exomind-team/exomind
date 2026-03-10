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

export interface ExecuteReviewActionInput {
  mode: ReviewActionMode;
  body: string;
  expectedLanguage: ReviewCommentLanguage | null;
  hasNeedsHumanTestLabel: boolean;
  commentId?: string | null;
  approvalGate?: ReviewApprovalGate;
  viewerCanMerge?: boolean | null;
}

interface ExecuteReviewActionDeps {
  createComment: (body: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  editComment: (commentId: string, body: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  readComment: (commentId: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  addLabel: (label: string) => Promise<void> | void;
  submitReviewDecision: (decision: 'request-changes' | 'approve') => Promise<void> | void;
  mergePullRequest: () => Promise<void> | void;
}

export type ExecuteReviewActionResult =
  | {
      status: 'completed';
      comment: ReviewCommentRecord;
      commentOperation: 'created' | 'edited';
      completion: ReviewCompletionResult;
      labelAdded: boolean;
      reviewDecision: 'request-changes' | 'approve' | null;
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
    }
  | {
      status: 'failed';
      failedStage: ReviewActionFailureStage;
      error: string;
      comment?: ReviewCommentRecord;
      commentOperation?: 'created' | 'edited';
      labelAdded: boolean;
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
      };
    }

    try {
      await deps.submitReviewDecision('approve');
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
      };
    }
  }

  const commentOperation = input.commentId ? 'edited' : 'created';
  const bodyToPublish = approveFailure
    ? appendApproveFailureNote(input.body, approveFailure)
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
    };
  }

  if (input.mode === 'request-changes' || input.mode === 'approve') {
    try {
      await deps.submitReviewDecision(input.mode);
    } catch (error) {
      return {
        status: 'failed',
        failedStage: 'review-decision',
        error: toErrorMessage(error),
        comment,
        commentOperation,
        labelAdded,
      };
    }

    return {
      status: 'completed',
      comment,
      commentOperation,
      completion: mapActionModeToCompletion(input.mode),
      labelAdded,
      reviewDecision: input.mode,
    };
  }

  if (input.mode === 'merge') {
    if (input.viewerCanMerge === false) {
      return completeBlockedMerge({
        comment,
        commentOperation,
        labelAdded,
        approveFailure,
        error: 'viewerCanMerge=false：当前账号无权合并或当前分支保护尚未满足。',
        needsSync: false,
        expectedLanguage: input.expectedLanguage,
        approvalGate: input.approvalGate,
        deps,
      });
    }

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
        approveFailure,
      };
    }

    return {
      status: 'completed',
      comment,
      commentOperation,
      completion: 'merge-ready',
      labelAdded,
      reviewDecision: 'approve',
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
    reviewDecision: null,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function appendApproveFailureNote(body: string, error: string): string {
  return `${body}\n\n备注：approve 失败（原因：${error}），不阻塞后续合并尝试。`;
}

function appendMergeFailureNote(body: string, error: string, needsSync: boolean): string {
  const lines = [`合并阻塞：${error}`];
  if (needsSync) {
    lines.push('请同步目标分支后重试。');
  }
  return `${body}\n\n${lines.join('\n')}`;
}

function classifyMergeFailure(error: string): { kind: 'blocked' | 'retryable'; needsSync: boolean } {
  const normalized = error.toLowerCase();
  const isPermission = /forbidden|not authorized|permission|access denied|insufficient/.test(normalized);
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
  deps: Pick<ExecuteReviewActionDeps, 'editComment' | 'readComment'>;
}): Promise<ExecuteReviewActionResult> {
  const updatedBody = appendMergeFailureNote(
    input.comment.body,
    input.error,
    input.needsSync,
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
    };
  }

  return {
    status: 'completed',
    comment,
    commentOperation: input.commentOperation,
    completion: 'merge-blocked',
    labelAdded: input.labelAdded,
    reviewDecision: 'approve',
    approveFailure: input.approveFailure,
    mergeFailure: input.error,
    mergeFailureKind: 'blocked',
  };
}
