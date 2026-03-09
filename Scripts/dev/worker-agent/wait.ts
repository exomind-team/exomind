import { execFileSync } from 'node:child_process';
import {
  hasHumanTestLabel,
  HUMAN_TEST_LABEL,
  HUMAN_TEST_REVIEW_PREFIX,
  isNonBlockingReviewerComment,
  isNonBlockingReviewState,
  REVIEWER_PREFIX,
  shouldIgnoreFeedbackItem,
  type WaitingReason,
  type WorkerCursor,
} from './lib.ts';

export interface WaitComment {
  id: string;
  authorLogin: string;
  body: string;
  createdAt: string;
}

export interface WaitReview {
  id: string;
  authorLogin: string;
  body: string;
  state: string;
  submittedAt: string;
}

export interface WaitStatusCheck {
  name: string;
  status: string;
  conclusion: string;
}

export interface WaitSnapshot {
  prNumber: number;
  headSha: string;
  labels: string[];
  comments: WaitComment[];
  reviews: WaitReview[];
  statusChecks: WaitStatusCheck[];
}

export interface WaitEvent {
  reason: WaitingReason;
  itemId: string;
  itemType: 'comment' | 'review' | 'label' | 'status';
  summary: string;
}

export interface WaitLoopResult {
  reason: WaitingReason;
  newItems: WaitEvent[];
  pr: number;
  headSha: string;
  waitingOn: WaitingReason;
}

export function detectWakeEvents(input: {
  previous?: WaitSnapshot | null;
  current: WaitSnapshot;
  cursor: WorkerCursor;
}): WaitEvent[] {
  const previous = input.previous ?? null;
  const knownCommentIds = new Set(input.cursor.lastCommentIds ?? []);
  const knownReviewIds = new Set(input.cursor.lastReviewIds ?? []);
  const previousLabels = new Set(previous?.labels ?? []);
  const currentLabels = new Set(input.current.labels);
  const events: WaitEvent[] = [];

  const previousHasHumanTest = hasHumanTestLabel(previousLabels);
  const currentHasHumanTest = hasHumanTestLabel(currentLabels);
  const labelAdded = currentHasHumanTest && !previousHasHumanTest;
  const labelRemoved = !currentHasHumanTest && previousHasHumanTest;
  if (labelAdded || labelRemoved) {
    events.push({
      reason: 'human-test',
      itemId: HUMAN_TEST_LABEL,
      itemType: 'label',
      summary: labelAdded
        ? `label added: ${HUMAN_TEST_LABEL}`
        : `label removed: ${HUMAN_TEST_LABEL}`,
    });
  }

  for (const comment of input.current.comments) {
    if (knownCommentIds.has(comment.id)) {
      continue;
    }

    if (shouldIgnoreFeedbackItem(comment)) {
      continue;
    }

    if (comment.body.startsWith(HUMAN_TEST_REVIEW_PREFIX)) {
      events.push({
        reason: 'human-test',
        itemId: comment.id,
        itemType: 'comment',
        summary: `${comment.authorLogin}: ${firstLine(comment.body)}`,
      });
      continue;
    }

    if (comment.body.startsWith(REVIEWER_PREFIX)) {
      if (isNonBlockingReviewerComment(comment.body)) {
        continue;
      }

      events.push({
        reason: 'reviewer',
        itemId: comment.id,
        itemType: 'comment',
        summary: `${comment.authorLogin}: ${firstLine(comment.body)}`,
      });
      continue;
    }

    events.push({
      reason: 'human-comment',
      itemId: comment.id,
      itemType: 'comment',
      summary: `${comment.authorLogin}: ${firstLine(comment.body)}`,
    });
  }

  for (const review of input.current.reviews) {
    if (knownReviewIds.has(review.id)) {
      continue;
    }

    if (shouldIgnoreFeedbackItem(review)) {
      continue;
    }

    if (review.state === 'CHANGES_REQUESTED') {
      events.push({
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
      events.push({
        reason: 'human-test',
        itemId: review.id,
        itemType: 'review',
        summary: `${review.authorLogin}: ${firstLine(review.body)}`,
      });
      continue;
    }

    if (review.body.startsWith(REVIEWER_PREFIX)) {
      events.push({
        reason: 'reviewer',
        itemId: review.id,
        itemType: 'review',
        summary: `${review.authorLogin}: ${firstLine(review.body)}`,
      });
      continue;
    }

    events.push({
      reason: 'human-comment',
      itemId: review.id,
      itemType: 'review',
      summary: `${review.authorLogin}: review state=${review.state}`,
    });
  }

  const previousStatusByName = new Map((previous?.statusChecks ?? []).map((check) => [check.name, check]));
  for (const check of input.current.statusChecks) {
    const previouslyFailing = isFailingStatus(previousStatusByName.get(check.name));
    if (isFailingStatus(check) && !previouslyFailing) {
      events.push({
        reason: 'ci-failure',
        itemId: check.name,
        itemType: 'status',
        summary: `${check.name}: ${check.conclusion || check.status}`,
      });
    }
  }

  return events;
}

export function summarizeWakeItems(events: WaitEvent[]): string {
  if (events.length === 0) {
    return 'no wake events';
  }

  return events.map((event) => `${event.reason}:${event.summary}`).join(' | ');
}

export async function fetchWaitSnapshot(repo: string, prNumber: number, cwd = process.cwd()): Promise<WaitSnapshot> {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'number,headRefOid,comments,reviews,labels,statusCheckRollup',
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    },
  ).trim();

  const parsed = JSON.parse(raw) as {
    number: number;
    headRefOid: string;
    comments: Array<{ id: string; author?: { login?: string }; body: string; createdAt: string }>;
    reviews: Array<{ id: string; author?: { login?: string }; body: string; state: string; submittedAt: string }>;
    labels: Array<{ name: string }>;
    statusCheckRollup?: Array<{ name: string; status: string; conclusion?: string | null }>;
  };

  return {
    prNumber: parsed.number,
    headSha: parsed.headRefOid,
    labels: parsed.labels.map((label) => label.name),
    comments: parsed.comments.map((comment) => ({
      id: comment.id,
      authorLogin: comment.author?.login ?? 'unknown',
      body: comment.body ?? '',
      createdAt: comment.createdAt,
    })),
    reviews: parsed.reviews.map((review) => ({
      id: review.id,
      authorLogin: review.author?.login ?? 'unknown',
      body: review.body ?? '',
      state: review.state ?? '',
      submittedAt: review.submittedAt,
    })),
    statusChecks: (parsed.statusCheckRollup ?? []).map((check) => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion ?? '',
    })),
  };
}

export async function waitForUpdateLoop(input: {
  repo: string;
  prNumber: number;
  cursor: WorkerCursor;
  cwd?: string;
  pollIntervalMs?: number;
  heartbeatMs?: number;
  onHeartbeat?: (payload: { waitingOn: WaitingReason; pr: number; since: string }) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<WaitLoopResult> {
  const cwd = input.cwd ?? process.cwd();
  const pollIntervalMs = input.pollIntervalMs ?? 15000;
  const heartbeatMs = input.heartbeatMs ?? 60000;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const waitStartedAt = new Date().toISOString();

  let previous = await fetchWaitSnapshot(input.repo, input.prNumber, cwd);
  const initialEvents = detectWakeEvents({
    previous: null,
    current: previous,
    cursor: input.cursor,
  });
  if (initialEvents.length > 0) {
    return {
      reason: initialEvents[0].reason,
      newItems: initialEvents,
      pr: previous.prNumber,
      headSha: previous.headSha,
      waitingOn: initialEvents[0].reason,
    };
  }

  let lastHeartbeatAt = Date.now();
  while (true) {
    if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
      input.onHeartbeat?.({
        waitingOn: 'reviewer',
        pr: input.prNumber,
        since: waitStartedAt,
      });
      lastHeartbeatAt = Date.now();
    }

    await sleep(pollIntervalMs);

    const current = await fetchWaitSnapshot(input.repo, input.prNumber, cwd);
    const events = detectWakeEvents({
      previous,
      current,
      cursor: input.cursor,
    });

    if (events.length > 0) {
      return {
        reason: events[0].reason,
        newItems: events,
        pr: current.prNumber,
        headSha: current.headSha,
        waitingOn: events[0].reason,
      };
    }

    previous = current;
  }
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.slice(0, 120);
}

function isFailingStatus(check: WaitStatusCheck | undefined): boolean {
  if (!check) {
    return false;
  }

  return new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']).has(
    check.conclusion,
  );
}
