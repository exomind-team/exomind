import { execFileSync } from 'node:child_process';
import {
  DEFAULT_SLEEP_SECONDS,
  buildDiscoveryRound,
  classifyPullRequest,
  type BackoffState,
  type PullRequestComment,
  type PullRequestCommit,
  type PullRequestReview,
  type PullRequestThreadReply,
  type PullRequestSnapshot,
} from './discovery-lib.ts';
import {
  loadThreadRepliesWithFallback,
  type DiscoveryWarning,
} from './discovery-runtime-lib.ts';
import {
  BACKOFF_FILE,
  CURSOR_FILE,
  QUEUE_FILE,
  STATE_FILE,
  ensurePrMonitorDir,
  readJson,
  writeJson,
  type PersistedState,
} from './state-lib.ts';

interface CliOptions {
  repo?: string;
  limit: number;
}

interface GhListItem {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
}

interface GhComment {
  id?: string;
  body?: string;
  createdAt?: string;
}

interface GhReview {
  id?: string;
  body?: string;
  submittedAt?: string | null;
  state?: string;
}

interface GhCommit {
  oid?: string;
  committedDate?: string | null;
}

interface GhReviewComment {
  id?: number | string;
  body?: string | null;
  created_at?: string | null;
}

interface GhPrView {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  comments?: GhComment[];
  reviews?: GhReview[];
  commits?: GhCommit[];
}

interface PersistedCursor {
  [prNumber: string]: {
    lastReviewerAt: string | null;
    latestCommentId: string | null;
    latestCommentAt: string | null;
    latestReviewId: string | null;
    latestReviewAt: string | null;
    latestThreadReplyId: string | null;
    latestThreadReplyAt: string | null;
    latestCommitOid: string | null;
    latestCommitAt: string | null;
  };
}

interface DiscoveryQueueEntry {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  actionable: boolean;
  reason: string;
  lastReviewerAt: string | null;
  latestActivityAt: string | null;
}

interface RoundResult {
  status: 'SUCCESS' | 'FAILED';
  repo: string | null;
  state: 'HAS_TARGET' | 'NO_TARGET' | 'FAILED_RETRYABLE';
  selectedPr: DiscoveryQueueEntry | null;
  actionablePrs: DiscoveryQueueEntry[];
  pendingQueue: DiscoveryQueueEntry[];
  inspectedPrCount: number;
  skippedPrs: Array<{ number: number; error: string }>;
  failureStreak: number;
  nextSleepSeconds: number;
  consecutiveNoChangeRounds: number;
  checkedAt: string;
  cursor: PersistedCursor;
  warnings: DiscoveryWarning[];
  error?: string;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const previousBackoff = readJson<BackoffState>(BACKOFF_FILE, {
    nextSleepSeconds: DEFAULT_SLEEP_SECONDS,
    consecutiveNoChangeRounds: 0,
  });
  const previousState = readJson<PersistedState | null>(STATE_FILE, null);
  const previousFailureStreak = previousState?.failureStreak ?? 0;

  const result = runDiscoveryRound(options, previousBackoff, previousFailureStreak);
  persistRound(result);

  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'FAILED') {
    process.exitCode = 1;
  }
}

function runDiscoveryRound(
  options: CliOptions,
  previousBackoff: BackoffState,
  previousFailureStreak: number,
): RoundResult {
  const checkedAt = new Date().toISOString();
  let repo: string | null = options.repo ?? null;

  let pullRequests: GhListItem[];
  try {
    pullRequests = listOpenPullRequests(options);
    repo ??= resolveRepo(options.repo);
  } catch (error) {
    const failureStreak = previousFailureStreak + 1;
    return {
      status: 'FAILED',
      repo,
      state: 'FAILED_RETRYABLE',
      selectedPr: null,
      actionablePrs: [],
      pendingQueue: [],
      inspectedPrCount: 0,
      skippedPrs: [],
      failureStreak,
      nextSleepSeconds: failureStreak >= 3 ? 300 : previousBackoff.nextSleepSeconds,
      consecutiveNoChangeRounds: previousBackoff.consecutiveNoChangeRounds,
      checkedAt,
      cursor: {},
      warnings: [],
      error: toErrorMessage(error),
    };
  }

  if (pullRequests.length === 0) {
    const round = buildDiscoveryRound([], previousBackoff);
    return {
      status: 'SUCCESS',
      repo,
      state: round.state,
      selectedPr: null,
      actionablePrs: [],
      pendingQueue: [],
      inspectedPrCount: 0,
      skippedPrs: [],
      failureStreak: 0,
      nextSleepSeconds: round.nextSleepSeconds,
      consecutiveNoChangeRounds: round.consecutiveNoChangeRounds,
      checkedAt,
      cursor: {},
      warnings: [],
    };
  }

  const inspectedSnapshots: PullRequestSnapshot[] = [];
  const skippedPrs: Array<{ number: number; error: string }> = [];
  const warnings: DiscoveryWarning[] = [];

  for (const pullRequest of pullRequests) {
    try {
      const result = viewPullRequest(pullRequest.number, repo ?? resolveRepo(options.repo), options);
      inspectedSnapshots.push(result.snapshot);
      if (result.warning) {
        warnings.push(result.warning);
      }
    } catch (error) {
      skippedPrs.push({
        number: pullRequest.number,
        error: toErrorMessage(error),
      });
    }
  }

  if (inspectedSnapshots.length === 0) {
    const failureStreak = previousFailureStreak + 1;
    return {
      status: 'FAILED',
      repo,
      state: 'FAILED_RETRYABLE',
      selectedPr: null,
      actionablePrs: [],
      pendingQueue: [],
      inspectedPrCount: 0,
      skippedPrs,
      failureStreak,
      nextSleepSeconds: failureStreak >= 3 ? 300 : previousBackoff.nextSleepSeconds,
      consecutiveNoChangeRounds: previousBackoff.consecutiveNoChangeRounds,
      checkedAt,
      cursor: {},
      warnings,
      error: 'All PR inspections failed in this round.',
    };
  }

  const round = buildDiscoveryRound(inspectedSnapshots, previousBackoff);
  const actionablePrs = round.actionablePrs.map(toQueueEntry);

  return {
    status: 'SUCCESS',
    repo,
    state: round.state,
    selectedPr: round.selectedPr ? toQueueEntry(round.selectedPr) : null,
    actionablePrs,
    pendingQueue: actionablePrs.slice(1),
    inspectedPrCount: inspectedSnapshots.length,
    skippedPrs,
    failureStreak: 0,
    nextSleepSeconds: round.nextSleepSeconds,
    consecutiveNoChangeRounds: round.consecutiveNoChangeRounds,
    checkedAt,
    cursor: buildCursor(inspectedSnapshots),
    warnings,
  };
}

function listOpenPullRequests(options: CliOptions): GhListItem[] {
  const args = ['pr', 'list', '--state', 'open', '--json', 'number,title,url,updatedAt', '--limit', String(options.limit)];
  if (options.repo) {
    args.push('--repo', options.repo);
  }

  const result = runGhJson<GhListItem[]>(args);
  return result.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function viewPullRequest(
  number: number,
  repo: string,
  options: CliOptions,
): { snapshot: PullRequestSnapshot; warning?: DiscoveryWarning } {
  const args = ['pr', 'view', String(number), '--json', 'number,title,url,updatedAt,comments,reviews,commits'];
  if (options.repo) {
    args.push('--repo', options.repo);
  }

  const result = runGhJson<GhPrView>(args);
  const threadReplyResult = loadThreadRepliesWithFallback(number, () => fetchReviewThreadReplies(number, repo));
  return {
    snapshot: {
      number: result.number,
      title: result.title,
      url: result.url,
      updatedAt: result.updatedAt,
      comments: normalizeComments(result.comments),
      reviews: normalizeReviews(result.reviews),
      threadReplies: threadReplyResult.threadReplies,
      commits: normalizeCommits(result.commits),
    },
    warning: threadReplyResult.warning,
  };
}

function normalizeComments(comments: GhComment[] | undefined): PullRequestComment[] {
  return (comments ?? []).map((comment) => ({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
  }));
}

function normalizeReviews(reviews: GhReview[] | undefined): PullRequestReview[] {
  return (reviews ?? []).map((review) => ({
    id: review.id,
    body: review.body,
    submittedAt: review.submittedAt ?? null,
    state: review.state,
  }));
}

function fetchReviewThreadReplies(prNumber: number, repo: string): PullRequestThreadReply[] {
  const perPage = 100;
  const replies: PullRequestThreadReply[] = [];
  let page = 1;

  while (true) {
    const pageItems = runGhJson<GhReviewComment[]>([
      'api',
      `repos/${repo}/pulls/${prNumber}/comments`,
      '-F',
      `per_page=${perPage}`,
      '-F',
      `page=${page}`,
    ]);

    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }

    for (const reply of pageItems) {
      replies.push({
        id: reply.id ? String(reply.id) : undefined,
        body: reply.body ?? undefined,
        createdAt: reply.created_at ?? null,
      });
    }

    if (pageItems.length < perPage) {
      break;
    }

    page += 1;
  }

  return replies;
}

function normalizeCommits(commits: GhCommit[] | undefined): PullRequestCommit[] {
  return (commits ?? []).map((commit) => ({
    oid: commit.oid,
    committedDate: commit.committedDate ?? null,
  }));
}

function resolveRepo(explicitRepo: string | undefined): string {
  if (explicitRepo) {
    return explicitRepo;
  }

  const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch?.[1] && httpsMatch?.[2]) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1] && sshMatch?.[2]) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  throw new Error(`Unable to resolve repo from origin remote: ${remoteUrl}`);
}

function persistRound(result: RoundResult): void {
  ensurePrMonitorDir();

  if (result.status === 'FAILED') {
    writeJson(STATE_FILE, {
      state: 'FAILED_RETRYABLE',
      phase: 'DISCOVERY',
      lastPhase: 'DISCOVERY',
      nextAction: 'discovery',
      selectedPrNumber: null,
      selectedReason: null,
      inspectedPrCount: result.inspectedPrCount,
      skippedPrCount: result.skippedPrs.length,
      actionableCount: 0,
      failureStreak: result.failureStreak,
      nextSleepSeconds: result.nextSleepSeconds,
      updatedAt: result.checkedAt,
      error: result.error,
    } satisfies PersistedState);
    return;
  }

  writeJson(BACKOFF_FILE, {
    nextSleepSeconds: result.nextSleepSeconds,
    consecutiveNoChangeRounds: result.consecutiveNoChangeRounds,
  } satisfies BackoffState);

  writeJson(STATE_FILE, {
    state: result.state,
    phase: result.state === 'NO_TARGET' ? 'IDLE_WAIT' : 'DISCOVERY',
    lastPhase: 'DISCOVERY',
    nextAction: result.state === 'HAS_TARGET' ? 'review' : 'idle-wait',
    selectedPrNumber: result.selectedPr?.number ?? null,
    selectedReason: result.selectedPr?.reason ?? null,
    inspectedPrCount: result.inspectedPrCount,
    skippedPrCount: result.skippedPrs.length,
    actionableCount: result.actionablePrs.length,
    failureStreak: 0,
    nextSleepSeconds: result.nextSleepSeconds,
    updatedAt: result.checkedAt,
  } satisfies PersistedState);

  writeJson(QUEUE_FILE, {
    selectedPr: result.selectedPr,
    actionablePrs: result.actionablePrs,
    pendingQueue: result.pendingQueue,
    skippedPrs: result.skippedPrs,
    warnings: result.warnings,
    updatedAt: result.checkedAt,
  });

  writeJson(CURSOR_FILE, result.cursor);
}

function buildCursor(snapshots: PullRequestSnapshot[]): PersistedCursor {
  const cursor: PersistedCursor = {};

  for (const snapshot of snapshots) {
    const classification = classifyPullRequest(snapshot);
    const latestComment = snapshot.comments
      .filter((comment) => comment.createdAt)
      .sort((left, right) => Date.parse(right.createdAt as string) - Date.parse(left.createdAt as string))[0];
    const latestReview = snapshot.reviews
      .filter((review) => review.submittedAt)
      .sort((left, right) => Date.parse((right.submittedAt as string)) - Date.parse((left.submittedAt as string)))[0];
    const latestThreadReply = snapshot.threadReplies
      .filter((reply) => reply.createdAt)
      .sort((left, right) => Date.parse((right.createdAt as string)) - Date.parse((left.createdAt as string)))[0];
    const latestCommit = snapshot.commits
      .filter((commit) => commit.committedDate)
      .sort((left, right) => Date.parse((right.committedDate as string)) - Date.parse((left.committedDate as string)))[0];

    cursor[String(snapshot.number)] = {
      lastReviewerAt: classification.lastReviewerAt,
      latestCommentId: latestComment?.id ?? null,
      latestCommentAt: latestComment?.createdAt ?? null,
      latestReviewId: latestReview?.id ?? null,
      latestReviewAt: latestReview?.submittedAt ?? null,
      latestThreadReplyId: latestThreadReply?.id ?? null,
      latestThreadReplyAt: latestThreadReply?.createdAt ?? null,
      latestCommitOid: latestCommit?.oid ?? null,
      latestCommitAt: latestCommit?.committedDate ?? null,
    };
  }

  return cursor;
}

function toQueueEntry(classification: ReturnType<typeof classifyPullRequest>): DiscoveryQueueEntry {
  return {
    number: classification.number,
    title: classification.title,
    url: classification.url,
    updatedAt: classification.updatedAt,
    actionable: classification.actionable,
    reason: classification.reason,
    lastReviewerAt: classification.lastReviewerAt,
    latestActivityAt: classification.latestActivityAt,
  };
}

function runGhJson<T>(args: string[]): T {
  const stdout = execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(stdout) as T;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo') {
      options.repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--limit') {
      const nextValue = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isFinite(nextValue) || nextValue <= 0) {
        throw new Error(`Invalid --limit value: ${argv[index + 1] ?? ''}`);
      }
      options.limit = nextValue;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

main();
