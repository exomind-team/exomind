import {
  hasHumanTestLabel,
  HUMAN_TEST_REVIEW_PREFIX,
  isNonBlockingReviewState,
  REVIEWER_PREFIX,
  WORKER_PREFIX,
  shouldIgnoreFeedbackItem,
  type WorkerCursor,
  type WorkerLockSnapshot,
} from './lib.ts';
import type { RemoteLockMetadata } from './lock.ts';
import type { WaitComment, WaitEvent, WaitReview, WaitStatusCheck } from './wait.ts';

export type NextWorkerAction =
  | 'create-draft-pr'
  | 'acquire-lock'
  | 'reply-blocking-comment'
  | 'handle-ci-failure'
  | 'sync-pr-body'
  | 'implement-next-change'
  | 'commit-and-push'
  | 'wait-for-update'
  | 'raise-dissent';

export interface NextActionPrState {
  number: number;
  issueNumber: number | null;
  body: string;
  labels: string[];
  headSha: string;
  comments: WaitComment[];
  reviews: WaitReview[];
  statusChecks: WaitStatusCheck[];
  isDraft: boolean;
  baseBranch: string;
}

export interface NextActionGitState {
  branch: string;
  isDefaultBranch: boolean;
  hasChanges: boolean;
  aheadCount: number;
  hasCommitsBeyondBase: boolean;
}

export interface NextActionInput {
  worker: {
    agentId: string;
  };
  git: NextActionGitState;
  pr: NextActionPrState | null;
  cursor: WorkerCursor;
  lock: {
    local: WorkerLockSnapshot | null;
    remote: RemoteLockMetadata | null;
  };
  dissent: {
    requested: boolean;
    summary?: string;
  };
}

export interface PrBodyStatus {
  hasWorkerPrefix: boolean;
  hasIssueRef: boolean;
  isValid: boolean;
}

export interface NextActionResult {
  action: NextWorkerAction;
  continueAfterAction: boolean;
  reason: string;
  blockers?: WaitEvent[];
  failingChecks?: WaitStatusCheck[];
  prBody?: PrBodyStatus;
  notes: string[];
}

const ISSUE_REF_PATTERN = /(?:refs|closes|fixes)\s+#\d+/i;
const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED',
]);

export function evaluatePrBody(body: string): PrBodyStatus {
  const hasWorkerPrefix = body.startsWith(WORKER_PREFIX);
  const hasIssueRef = ISSUE_REF_PATTERN.test(body);

  return {
    hasWorkerPrefix,
    hasIssueRef,
    isValid: hasWorkerPrefix && hasIssueRef,
  };
}

export function collectPendingFeedback(pr: NextActionPrState, cursor: WorkerCursor): WaitEvent[] {
  const knownCommentIds = new Set(cursor.lastCommentIds ?? []);
  const knownReviewIds = new Set(cursor.lastReviewIds ?? []);
  const items: WaitEvent[] = [];

  for (const comment of pr.comments) {
    if (knownCommentIds.has(comment.id)) {
      continue;
    }

    if (shouldIgnoreFeedbackItem(comment)) {
      continue;
    }

    if (comment.body.startsWith(HUMAN_TEST_REVIEW_PREFIX)) {
      items.push({
        reason: 'human-test',
        itemId: comment.id,
        itemType: 'comment',
        summary: `${comment.authorLogin}: ${firstLine(comment.body)}`,
      });
      continue;
    }

    if (comment.body.startsWith(REVIEWER_PREFIX)) {
      items.push({
        reason: 'reviewer',
        itemId: comment.id,
        itemType: 'comment',
        summary: `${comment.authorLogin}: ${firstLine(comment.body)}`,
      });
      continue;
    }

    items.push({
      reason: 'human-comment',
      itemId: comment.id,
      itemType: 'comment',
      summary: `${comment.authorLogin}: ${firstLine(comment.body)}`,
    });
  }

  for (const review of pr.reviews) {
    if (knownReviewIds.has(review.id)) {
      continue;
    }

    if (shouldIgnoreFeedbackItem(review)) {
      continue;
    }

    if (review.state === 'CHANGES_REQUESTED') {
      items.push({
        reason: 'reviewer',
        itemId: review.id,
        itemType: 'review',
        summary: `${review.authorLogin}: review state=${review.state}`,
      });
      continue;
    }

    if (isNonBlockingReviewState(review.state)) {
      continue;
    }

    if (review.body.startsWith(HUMAN_TEST_REVIEW_PREFIX)) {
      items.push({
        reason: 'human-test',
        itemId: review.id,
        itemType: 'review',
        summary: `${review.authorLogin}: ${firstLine(review.body)}`,
      });
      continue;
    }

    if (review.body.startsWith(REVIEWER_PREFIX)) {
      items.push({
        reason: 'reviewer',
        itemId: review.id,
        itemType: 'review',
        summary: `${review.authorLogin}: ${firstLine(review.body)}`,
      });
      continue;
    }

    items.push({
      reason: 'human-comment',
      itemId: review.id,
      itemType: 'review',
      summary: `${review.authorLogin}: review state=${review.state}`,
    });
  }

  return items;
}

export function getFailingChecks(statusChecks: WaitStatusCheck[]): WaitStatusCheck[] {
  return statusChecks.filter((check) => FAILING_CONCLUSIONS.has(check.conclusion));
}

export function determineNextAction(input: NextActionInput): NextActionResult {
  const notes: string[] = [];

  if (input.dissent.requested) {
    return {
      action: 'raise-dissent',
      continueAfterAction: false,
      reason: input.dissent.summary ?? 'Worker detected a provable mismatch between script state and actual state.',
      notes,
    };
  }

  if (!input.pr) {
    if (!input.git.isDefaultBranch && input.git.hasCommitsBeyondBase) {
      return {
        action: 'create-draft-pr',
        continueAfterAction: true,
        reason: `No open PR matches branch ${input.git.branch}, and the branch has work beyond base.`,
        notes,
      };
    }

    return {
      action: 'implement-next-change',
      continueAfterAction: true,
      reason: 'No matching PR is open yet, and the branch still needs enough work to justify draft PR creation.',
      notes,
    };
  }

  if (input.lock.remote && input.lock.remote.agent_id !== input.worker.agentId) {
    return {
      action: 'raise-dissent',
      continueAfterAction: false,
      reason: `PR #${input.pr.number} is currently locked by ${input.lock.remote.agent_id}, not ${input.worker.agentId}.`,
      notes,
    };
  }

  if (!input.lock.remote) {
    return {
      action: 'acquire-lock',
      continueAfterAction: true,
      reason: `PR #${input.pr.number} is not currently locked for ${input.worker.agentId}.`,
      notes,
    };
  }

  const blockers = collectPendingFeedback(input.pr, input.cursor);
  const feedbackBlockers = blockers.filter((item) => item.reason === 'reviewer' || item.reason === 'human-comment');
  const humanTestBlockers = blockers.filter((item) => item.reason === 'human-test');
  if (feedbackBlockers.length > 0) {
    return {
      action: 'reply-blocking-comment',
      continueAfterAction: true,
      reason: `Found ${feedbackBlockers.length} new blocking review or human feedback items.`,
      blockers: feedbackBlockers,
      notes,
    };
  }

  if (humanTestBlockers.length > 0) {
    return {
      action: 'wait-for-update',
      continueAfterAction: false,
      reason: `PR #${input.pr.number} has pending human-test feedback that requires manual validation.`,
      blockers: humanTestBlockers,
      notes,
    };
  }

  if (hasHumanTestLabel(input.pr.labels)) {
    return {
      action: 'wait-for-update',
      continueAfterAction: false,
      reason: `PR #${input.pr.number} is in human-test state via ${input.pr.labels.find((label) => hasHumanTestLabel([label]))}.`,
      blockers: blockers.filter((item) => item.reason === 'human-test'),
      notes,
    };
  }

  const failingChecks = getFailingChecks(input.pr.statusChecks);
  if (failingChecks.length > 0) {
    return {
      action: 'handle-ci-failure',
      continueAfterAction: true,
      reason: `Found ${failingChecks.length} failing CI checks on PR #${input.pr.number}.`,
      failingChecks,
      notes,
    };
  }

  const prBody = evaluatePrBody(input.pr.body);
  if (!prBody.isValid) {
    return {
      action: 'sync-pr-body',
      continueAfterAction: true,
      reason: `PR #${input.pr.number} body is missing the required worker protocol or issue refs.`,
      prBody,
      notes,
    };
  }

  if (input.git.aheadCount > 0) {
    return {
      action: 'commit-and-push',
      continueAfterAction: true,
      reason: `The current branch is ahead of its upstream by ${input.git.aheadCount} commit(s).`,
      notes,
    };
  }

  if (input.git.hasChanges) {
    return {
      action: 'commit-and-push',
      continueAfterAction: true,
      reason: 'The worktree has local modifications and should move into the verification/commit/push step.',
      notes,
    };
  }

  return {
    action: 'wait-for-update',
    continueAfterAction: false,
    reason: `PR #${input.pr.number} is clean, synced, and free of active blockers.`,
    notes,
  };
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.slice(0, 120);
}
