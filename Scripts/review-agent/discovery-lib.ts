export const REVIEWER_PREFIX = '[Codex Reviewer]';
export const DEFAULT_SLEEP_SECONDS = 180;
export const MAX_SLEEP_SECONDS = 1800;

export interface PullRequestComment {
  id?: string;
  body?: string;
  createdAt?: string;
}

export interface PullRequestReview {
  id?: string;
  body?: string;
  submittedAt?: string | null;
  state?: string;
}

export interface PullRequestThreadReply {
  id?: string;
  body?: string;
  createdAt?: string | null;
}

export interface PullRequestCommit {
  oid?: string;
  committedDate?: string | null;
}

export interface PullRequestSnapshot {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  comments: PullRequestComment[];
  reviews: PullRequestReview[];
  threadReplies: PullRequestThreadReply[];
  commits: PullRequestCommit[];
}

export interface BackoffState {
  nextSleepSeconds: number;
  consecutiveNoChangeRounds: number;
}

export type ActionableReason =
  | 'missing-reviewer-comment'
  | 'new-comment'
  | 'new-review'
  | 'new-thread-reply'
  | 'new-commit'
  | 'up-to-date';

export interface PullRequestClassification extends PullRequestSnapshot {
  actionable: boolean;
  reason: ActionableReason;
  lastReviewerAt: string | null;
  latestActivityAt: string | null;
}

export interface DiscoveryRound {
  state: 'HAS_TARGET' | 'NO_TARGET';
  actionablePrs: PullRequestClassification[];
  selectedPr: PullRequestClassification | null;
  pendingQueue: PullRequestClassification[];
  nextSleepSeconds: number;
  consecutiveNoChangeRounds: number;
}

interface ActivityCandidate {
  at: string;
  reason: Extract<ActionableReason, 'new-comment' | 'new-review' | 'new-thread-reply' | 'new-commit'>;
  priority: number;
}

export function computeNextBackoff(
  previous: BackoffState,
  foundActionableChange: boolean,
): BackoffState {
  if (foundActionableChange) {
    return {
      nextSleepSeconds: DEFAULT_SLEEP_SECONDS,
      consecutiveNoChangeRounds: 0,
    };
  }

  if (previous.consecutiveNoChangeRounds <= 0) {
    return {
      nextSleepSeconds: DEFAULT_SLEEP_SECONDS,
      consecutiveNoChangeRounds: 1,
    };
  }

  return {
    nextSleepSeconds: Math.min(previous.nextSleepSeconds * 2, MAX_SLEEP_SECONDS),
    consecutiveNoChangeRounds: previous.consecutiveNoChangeRounds + 1,
  };
}

export function classifyPullRequest(snapshot: PullRequestSnapshot): PullRequestClassification {
  const lastReviewerAt = findLastReviewerTimestamp(snapshot.comments);
  const latestOverallActivityAt = maxTimestamp([
    snapshot.updatedAt,
    ...snapshot.comments.map((comment) => comment.createdAt),
    ...snapshot.reviews.map((review) => review.submittedAt ?? undefined),
    ...snapshot.threadReplies.map((reply) => reply.createdAt ?? undefined),
    ...snapshot.commits.map((commit) => commit.committedDate ?? undefined),
  ]);

  if (!lastReviewerAt) {
    return {
      ...snapshot,
      actionable: true,
      reason: 'missing-reviewer-comment',
      lastReviewerAt: null,
      latestActivityAt: latestOverallActivityAt,
    };
  }

  const reviewerEpoch = toEpoch(lastReviewerAt);
  const candidates: ActivityCandidate[] = [];

  const newerCommentAt = maxTimestamp(
    snapshot.comments
      .map((comment) => comment.createdAt)
      .filter((createdAt) => toEpoch(createdAt) > reviewerEpoch),
  );
  if (newerCommentAt) {
    candidates.push({ at: newerCommentAt, reason: 'new-comment', priority: 3 });
  }

  const newerReviewAt = maxTimestamp(
    snapshot.reviews
      .map((review) => review.submittedAt ?? undefined)
      .filter((submittedAt) => toEpoch(submittedAt) > reviewerEpoch),
  );
  if (newerReviewAt) {
    candidates.push({ at: newerReviewAt, reason: 'new-review', priority: 2 });
  }

  const newerThreadReplyAt = maxTimestamp(
    snapshot.threadReplies
      .map((reply) => reply.createdAt ?? undefined)
      .filter((createdAt) => toEpoch(createdAt) > reviewerEpoch),
  );
  if (newerThreadReplyAt) {
    candidates.push({ at: newerThreadReplyAt, reason: 'new-thread-reply', priority: 1 });
  }

  const newerCommitAt = maxTimestamp(
    snapshot.commits
      .map((commit) => commit.committedDate ?? undefined)
      .filter((committedDate) => toEpoch(committedDate) > reviewerEpoch),
  );
  if (newerCommitAt) {
    candidates.push({ at: newerCommitAt, reason: 'new-commit', priority: 0 });
  }

  if (candidates.length === 0) {
    return {
      ...snapshot,
      actionable: false,
      reason: 'up-to-date',
      lastReviewerAt,
      latestActivityAt: lastReviewerAt,
    };
  }

  const latestActivity = candidates.sort(compareActivityCandidates)[0];
  return {
    ...snapshot,
    actionable: true,
    reason: latestActivity.reason,
    lastReviewerAt,
    latestActivityAt: latestActivity.at,
  };
}

export function buildDiscoveryRound(
  pullRequests: PullRequestSnapshot[],
  previousBackoff: BackoffState,
): DiscoveryRound {
  const actionablePrs = pullRequests
    .map((snapshot) => classifyPullRequest(snapshot))
    .filter((snapshot) => snapshot.actionable)
    .sort((left, right) => toEpoch(right.updatedAt) - toEpoch(left.updatedAt));

  const backoff = computeNextBackoff(previousBackoff, actionablePrs.length > 0);
  const selectedPr = actionablePrs[0] ?? null;

  return {
    state: actionablePrs.length > 0 ? 'HAS_TARGET' : 'NO_TARGET',
    actionablePrs,
    selectedPr,
    pendingQueue: actionablePrs.slice(1),
    ...backoff,
  };
}

function findLastReviewerTimestamp(comments: PullRequestComment[]): string | null {
  return maxTimestamp(
    comments
      .filter((comment) => isReviewerComment(comment.body))
      .map((comment) => comment.createdAt),
  );
}

function isReviewerComment(body: string | undefined): boolean {
  return (body ?? '').trimStart().startsWith(REVIEWER_PREFIX);
}

function compareActivityCandidates(left: ActivityCandidate, right: ActivityCandidate): number {
  const timeDelta = toEpoch(right.at) - toEpoch(left.at);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return right.priority - left.priority;
}

function maxTimestamp(values: Array<string | undefined | null>): string | null {
  const validValues = values.filter((value): value is string => Number.isFinite(toEpoch(value)));
  if (validValues.length === 0) {
    return null;
  }

  return validValues.sort((left, right) => toEpoch(right) - toEpoch(left))[0] ?? null;
}

function toEpoch(value: string | undefined | null): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? Number.NEGATIVE_INFINITY : epoch;
}
