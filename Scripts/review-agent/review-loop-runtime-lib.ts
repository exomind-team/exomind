import {
  NEEDS_HUMAN_TEST_LABEL,
  mapActionModeToCompletion,
  validateReviewComment,
  type ReviewActionMode,
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
}

interface ExecuteReviewActionDeps {
  createComment: () => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  editComment: (commentId: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  readComment: (commentId: string) => Promise<ReviewCommentRecord> | ReviewCommentRecord;
  addLabel: (label: string) => Promise<void> | void;
  submitReviewDecision: (decision: 'request-changes' | 'approve') => Promise<void> | void;
}

export type ExecuteReviewActionResult =
  | {
      status: 'completed';
      comment: ReviewCommentRecord;
      commentOperation: 'created' | 'edited';
      completion: Exclude<ReviewCompletionResult, 'merge-ready'>;
      labelAdded: boolean;
      reviewDecision: 'request-changes' | 'approve' | null;
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
      failedStage: 'approve-blocked' | 'label' | 'comment-write' | 'comment-read' | 'review-decision';
      error: string;
      comment?: ReviewCommentRecord;
      commentOperation?: 'created' | 'edited';
      labelAdded: boolean;
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
  if (input.mode === 'approve' && input.hasNeedsHumanTestLabel) {
    return {
      status: 'failed',
      failedStage: 'approve-blocked',
      error: `Cannot approve while ${NEEDS_HUMAN_TEST_LABEL} is still present.`,
      labelAdded: false,
    };
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
  let writtenComment: ReviewCommentRecord;
  try {
    writtenComment = input.commentId
      ? await deps.editComment(input.commentId)
      : await deps.createComment();
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
  }

  return {
    status: 'completed',
    comment,
    commentOperation,
    completion: mapActionModeToCompletion(input.mode),
    labelAdded,
    reviewDecision: input.mode === 'request-changes' || input.mode === 'approve'
      ? input.mode
      : null,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
