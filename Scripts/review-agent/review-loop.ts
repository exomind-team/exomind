import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  NEEDS_HUMAN_TEST_LABEL,
  buildReviewSummary,
  buildPullRequestActionJsonFields,
  buildCompletedReviewState,
  buildRetryableReviewFailureState,
  parseLinkedIssueNumbers,
  resolveReviewFailureCompletion,
  resolveReviewCommentLanguage,
  type ReviewApprovalGate,
  type ReviewActionMode,
  type ReviewCompletionResult,
  type PullRequestFile,
  type VerificationStatus,
} from './review-loop-lib.ts';
import {
  executeReviewAction,
  paginatePullFiles,
  resolveReviewCommentTarget,
  type PullFileApiItem,
  type ReviewCommentRecord,
} from './review-loop-runtime-lib.ts';
import {
  QUEUE_FILE,
  PR_MONITOR_DIR,
  STATE_FILE,
  ensurePrMonitorDir,
  readJson,
  writeJson,
  type PersistedState,
  type QueueState,
} from './state-lib.ts';

interface CliOptions {
  repo?: string;
  prNumber?: number;
  markResult?: ReviewCompletionResult;
  bodyFile?: string;
  commentId?: string;
  needsHumanTest?: boolean;
  requestChanges?: boolean;
  approve?: boolean;
  merge?: boolean;
  ciStatus?: VerificationStatus;
  localVerificationStatus?: VerificationStatus;
}

interface PullRequestView {
  number: number;
  title: string;
  body?: string;
  url: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

interface PullRequestActionView {
  number: number;
  title: string;
  body?: string;
  url: string;
  viewerCanMerge?: boolean;
  labels?: Array<{ name?: string }>;
  comments?: Array<{ body?: string }>;
}

interface IssueView {
  number: number;
  title: string;
  body?: string;
}

interface GhIssueComment {
  id: number | string;
  body?: string;
  html_url?: string;
  url?: string;
  created_at?: string;
}

interface ReviewCommentContext {
  activeReviewCommentId?: string | null;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repo = resolveRepo(options.repo);
  const prNumber = options.prNumber ?? readSelectedPrNumber();
  const actionMode = resolveActionMode(options);

  if (options.markResult) {
    const persistedState = persistCompletedReviewState(prNumber, options.markResult);
    console.log(JSON.stringify({
      selectedPrNumber: prNumber,
      completion: options.markResult,
      persistedState: persistedState.state,
      nextAction: persistedState.nextAction,
    }, null, 2));
    return;
  }

  if (actionMode) {
    await runReviewAction({
      prNumber,
      repo,
      actionMode,
      bodyFile: options.bodyFile as string,
      explicitCommentId: options.commentId,
      options,
    });
    return;
  }

  try {
    const pullRequest = viewPullRequest(prNumber, repo);
    const files = await fetchPullFiles(prNumber, repo);
    const reviewSummary = buildReviewSummary({
      prNumber: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body ?? '',
      changedFiles: pullRequest.changedFiles,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      files,
    });
    const issues = reviewSummary.linkedIssues.map((issueNumber) => viewIssue(issueNumber, repo));
    const output = {
      repo,
      selectedPr: reviewSummary.selectedPr,
      linkedIssues: reviewSummary.linkedIssues,
      linkedIssueTitles: issues.map((issue) => ({ number: issue.number, title: issue.title })),
      reviewMode: reviewSummary.reviewMode,
      prioritizedFiles: reviewSummary.prioritizedFiles,
      parsedIssueRefs: parseLinkedIssueNumbers(pullRequest.body ?? ''),
      url: pullRequest.url,
    };

    persistActiveReviewState(reviewSummary.selectedPr.number);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    const failureState = persistRetryableReviewFailureState(prNumber, toErrorMessage(error));
    console.log(JSON.stringify({
      selectedPrNumber: prNumber,
      state: failureState.state,
      nextAction: failureState.nextAction,
      error: failureState.error,
    }, null, 2));
    process.exitCode = 1;
  }
}

async function runReviewAction(input: {
  prNumber: number;
  repo: string;
  actionMode: ReviewActionMode;
  bodyFile: string;
  explicitCommentId?: string;
  options: CliOptions;
}): Promise<void> {
  const pullRequest = viewPullRequestActionContextForMode(input.prNumber, input.repo, input.actionMode);
  const previousState = readJson<PersistedState | null>(STATE_FILE, null);
  let commentId: string | undefined;
  try {
    const target = await resolveReviewCommentTarget({
      explicitCommentId: input.explicitCommentId,
      persistedCommentId: previousState?.activeReviewCommentId ?? null,
    }, {
      listComments: () => listIssueComments(input.prNumber, input.repo).map((comment) => ({
        id: String(comment.id),
        body: comment.body,
        createdAt: comment.created_at ?? null,
      })),
    });
    commentId = target.commentId ?? undefined;
  } catch (error) {
    const failureState = persistRetryableReviewFailureState(
      input.prNumber,
      `Failed to resolve review comment target: ${toErrorMessage(error)}`,
    );
    console.log(JSON.stringify({
      selectedPrNumber: input.prNumber,
      action: input.actionMode,
      state: failureState.state,
      nextAction: failureState.nextAction,
      error: failureState.error,
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  const expectedLanguage = resolveReviewCommentLanguage({
    title: pullRequest.title,
    body: pullRequest.body ?? '',
    commentBodies: (pullRequest.comments ?? []).map((comment) => comment.body ?? ''),
  });
  const body = readFileSync(input.bodyFile, 'utf8');
  const hasNeedsHumanTestLabel = (pullRequest.labels ?? []).some((label) => label.name === NEEDS_HUMAN_TEST_LABEL);
  const approvalGate = input.actionMode === 'approve' || input.actionMode === 'merge'
    ? buildApprovalGate(input.options)
    : undefined;

  const result = await executeReviewAction({
    mode: input.actionMode,
    body,
    expectedLanguage,
    hasNeedsHumanTestLabel,
    commentId,
    approvalGate,
    viewerCanMerge: pullRequest.viewerCanMerge ?? null,
  }, {
    createComment: (commentBody) => createIssueComment(
      input.prNumber,
      input.repo,
      writeTempBodyFile(commentBody),
    ),
    editComment: (nextCommentId, commentBody) => editIssueComment(
      nextCommentId,
      input.repo,
      writeTempBodyFile(commentBody),
    ),
    readComment: (nextCommentId) => viewIssueComment(nextCommentId, input.repo),
    addLabel: (label) => addPrLabel(input.prNumber, input.repo, label),
    submitReviewDecision: (decision) => submitReviewDecision(input.prNumber, input.repo, decision),
    mergePullRequest: () => mergePullRequest(input.prNumber, input.repo),
  });

  if (result.status === 'completed') {
    const persistedState = persistCompletedReviewState(
      input.prNumber,
      result.completion,
      toReviewCommentContext(result.comment),
      result.completion === 'merge-blocked'
        ? result.mergeFailure ?? 'merge blocked'
        : undefined,
    );
    console.log(JSON.stringify({
      selectedPrNumber: input.prNumber,
      action: input.actionMode,
      comment: result.comment,
      commentOperation: result.commentOperation,
      labelAdded: result.labelAdded,
      reviewDecision: result.reviewDecision,
      approveFailure: result.approveFailure ?? null,
      mergeFailure: result.mergeFailure ?? null,
      mergeFailureKind: result.mergeFailureKind ?? null,
      completion: result.completion,
      persistedState: persistedState.state,
      nextAction: persistedState.nextAction,
    }, null, 2));
    return;
  }

  if (result.status === 'comment-invalid') {
    const error = `Review comment validation failed: ${result.validationErrors.join(' | ')}`;
    const failureState = persistRetryableReviewFailureState(
      input.prNumber,
      error,
      toReviewCommentContext(result.comment),
    );
    console.log(JSON.stringify({
      selectedPrNumber: input.prNumber,
      action: input.actionMode,
      state: failureState.state,
      nextAction: failureState.nextAction,
      comment: result.comment,
      commentOperation: result.commentOperation,
      labelAdded: result.labelAdded,
      validationErrors: result.validationErrors,
      error: failureState.error,
      approveFailure: result.approveFailure ?? null,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const terminalCompletion = resolveReviewFailureCompletion({
    actionMode: input.actionMode,
    failedStage: result.failedStage,
  });
  if (terminalCompletion) {
    const blockedState = persistCompletedReviewState(
      input.prNumber,
      terminalCompletion,
      result.comment ? toReviewCommentContext(result.comment) : undefined,
      result.error,
    );
    console.log(JSON.stringify({
      selectedPrNumber: input.prNumber,
      action: input.actionMode,
      failedStage: result.failedStage,
      comment: result.comment ?? null,
      commentOperation: result.commentOperation ?? null,
      labelAdded: result.labelAdded,
      error: blockedState.error ?? result.error,
      completion: terminalCompletion,
      persistedState: blockedState.state,
      nextAction: blockedState.nextAction,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const failureState = persistRetryableReviewFailureState(
    input.prNumber,
    result.error,
    result.comment ? toReviewCommentContext(result.comment) : undefined,
  );
  console.log(JSON.stringify({
    selectedPrNumber: input.prNumber,
    action: input.actionMode,
    state: failureState.state,
    nextAction: failureState.nextAction,
    failedStage: result.failedStage,
    comment: result.comment,
    commentOperation: result.commentOperation,
    labelAdded: result.labelAdded,
    error: failureState.error,
  }, null, 2));
  process.exitCode = 1;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo') {
      options.repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--pr') {
      const nextValue = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isFinite(nextValue) || nextValue <= 0) {
        throw new Error(`Invalid --pr value: ${argv[index + 1] ?? ''}`);
      }
      options.prNumber = nextValue;
      index += 1;
      continue;
    }
    if (value === '--mark-result') {
      const nextValue = argv[index + 1] as ReviewCompletionResult | undefined;
      if (!isReviewCompletionResult(nextValue)) {
        throw new Error(`Invalid --mark-result value: ${argv[index + 1] ?? ''}`);
      }
      options.markResult = nextValue;
      index += 1;
      continue;
    }
    if (value === '--body-file') {
      options.bodyFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--comment-id') {
      options.commentId = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--needs-human-test') {
      options.needsHumanTest = true;
      continue;
    }
    if (value === '--request-changes') {
      options.requestChanges = true;
      continue;
    }
    if (value === '--approve') {
      options.approve = true;
      continue;
    }
    if (value === '--merge') {
      options.merge = true;
      continue;
    }
    if (value === '--ci-status') {
      const nextValue = argv[index + 1];
      if (!isVerificationStatus(nextValue)) {
        throw new Error(`Invalid --ci-status value: ${argv[index + 1] ?? ''}`);
      }
      options.ciStatus = nextValue;
      index += 1;
      continue;
    }
    if (value === '--local-verification-status') {
      const nextValue = argv[index + 1];
      if (!isVerificationStatus(nextValue)) {
        throw new Error(`Invalid --local-verification-status value: ${argv[index + 1] ?? ''}`);
      }
      options.localVerificationStatus = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  const actionMode = resolveActionMode(options);
  if (options.markResult && (actionMode || options.commentId)) {
    throw new Error('--mark-result cannot be combined with review-action arguments.');
  }
  if ((actionMode || options.commentId) && !options.bodyFile) {
    throw new Error('Review actions require --body-file.');
  }

  return options;
}

function resolveActionMode(options: CliOptions): ReviewActionMode | null {
  const flaggedModes = [
    options.needsHumanTest ? 'needs-human-test' : null,
    options.requestChanges ? 'request-changes' : null,
    options.approve ? 'approve' : null,
    options.merge ? 'merge' : null,
  ].filter((value): value is ReviewActionMode => value !== null);

  if (flaggedModes.length > 1) {
    throw new Error('Choose only one of --needs-human-test, --request-changes, --approve, or --merge.');
  }

  if (flaggedModes.length === 1) {
    return flaggedModes[0] ?? null;
  }

  return options.bodyFile ? 'comment' : null;
}

function buildApprovalGate(options: CliOptions): ReviewApprovalGate {
  return {
    ciStatus: options.ciStatus ?? 'missing',
    localVerificationStatus: options.localVerificationStatus ?? 'missing',
  };
}

function writeTempBodyFile(body: string): string {
  ensurePrMonitorDir();
  const fileName = `review-comment-${Date.now()}-${Math.random().toString(16).slice(2)}.md`;
  const filePath = path.join(PR_MONITOR_DIR, fileName);
  writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function readSelectedPrNumber(): number {
  const queue = readJson<QueueState | null>(QUEUE_FILE, null);
  const prNumber = queue.selectedPr?.number;
  if (!prNumber) {
    throw new Error('No selected_pr found in temp/pr-monitor/queue.json');
  }

  return prNumber;
}

function viewPullRequest(prNumber: number, repo: string): PullRequestView {
  return runGhJson<PullRequestView>([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    repo,
    '--json',
    'number,title,body,url,changedFiles,additions,deletions',
  ]);
}

function viewPullRequestActionContext(prNumber: number, repo: string): PullRequestActionView {
  return viewPullRequestActionContextForMode(prNumber, repo, 'comment');
}

function viewPullRequestActionContextForMode(
  prNumber: number,
  repo: string,
  mode: ReviewActionMode,
): PullRequestActionView {
  return runGhJson<PullRequestActionView>([
    'pr',
    'view',
    String(prNumber),
    '--repo',
    repo,
    '--json',
    buildPullRequestActionJsonFields(mode).join(','),
  ]);
}

function viewIssue(issueNumber: number, repo: string): IssueView {
  return runGhJson<IssueView>([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    repo,
    '--json',
    'number,title,body',
  ]);
}

async function fetchPullFiles(prNumber: number, repo: string): Promise<PullRequestFile[]> {
  const files = await paginatePullFiles(({ page, perPage }) =>
    runGhJson<PullFileApiItem[]>([
      'api',
      `repos/${repo}/pulls/${prNumber}/files?per_page=${perPage}&page=${page}`,
    ]),
  );

  return files.map((file) => ({
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

function createIssueComment(prNumber: number, repo: string, bodyFile: string): ReviewCommentRecord {
  return normalizeIssueComment(runGhJson<GhIssueComment>([
    'api',
    `repos/${repo}/issues/${prNumber}/comments`,
    '-F',
    `body=@${bodyFile}`,
  ]));
}

function editIssueComment(commentId: string, repo: string, bodyFile: string): ReviewCommentRecord {
  return normalizeIssueComment(runGhJson<GhIssueComment>([
    'api',
    `repos/${repo}/issues/comments/${commentId}`,
    '--method',
    'PATCH',
    '-F',
    `body=@${bodyFile}`,
  ]));
}

function viewIssueComment(commentId: string, repo: string): ReviewCommentRecord {
  return normalizeIssueComment(runGhJson<GhIssueComment>([
    'api',
    `repos/${repo}/issues/comments/${commentId}`,
  ]));
}

function listIssueComments(prNumber: number, repo: string): GhIssueComment[] {
  const comments: GhIssueComment[] = [];
  const perPage = 100;

  for (let page = 1; page <= 50; page += 1) {
    const pageItems = runGhJson<GhIssueComment[]>([
      'api',
      `repos/${repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}&sort=created&direction=desc`,
    ]);
    comments.push(...pageItems);
    if (pageItems.length < perPage) {
      return comments;
    }
  }

  return comments;
}

function addPrLabel(prNumber: number, repo: string, label: string): void {
  runGh([
    'pr',
    'edit',
    String(prNumber),
    '--repo',
    repo,
    '--add-label',
    label,
  ]);
}

function submitReviewDecision(
  prNumber: number,
  repo: string,
  decision: 'request-changes' | 'approve',
): void {
  const decisionFlag = decision === 'approve' ? '--approve' : '--request-changes';
  runGh([
    'pr',
    'review',
    String(prNumber),
    '--repo',
    repo,
    decisionFlag,
    '--body',
    '',
  ]);
}

function mergePullRequest(prNumber: number, repo: string): void {
  runGh([
    'pr',
    'merge',
    String(prNumber),
    '--repo',
    repo,
    '--squash',
  ]);
}

function normalizeIssueComment(comment: GhIssueComment): ReviewCommentRecord {
  return {
    id: String(comment.id),
    url: comment.html_url ?? comment.url ?? '',
    body: comment.body ?? '',
  };
}

function runGhJson<T>(args: string[]): T {
  const stdout = execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(stdout) as T;
}

function runGh(args: string[]): void {
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

function persistActiveReviewState(selectedPrNumber: number): void {
  ensurePrMonitorDir();
  const previousState = readJson<PersistedState | null>(STATE_FILE, null);
  const retryCommentContext = previousState?.state === 'FAILED_RETRYABLE'
    && previousState.lastPhase === 'REVIEW'
    && previousState.selectedPrNumber === selectedPrNumber
    ? {
        activeReviewCommentId: previousState.activeReviewCommentId ?? null,
      }
    : {
        activeReviewCommentId: null,
      };

  writeJson(STATE_FILE, {
    state: 'HAS_TARGET',
    phase: 'REVIEW',
    lastPhase: 'REVIEW',
    nextAction: 'review',
    selectedPrNumber,
    selectedReason: previousState?.selectedReason ?? null,
    ...retryCommentContext,
    inspectedPrCount: previousState?.inspectedPrCount ?? 0,
    skippedPrCount: previousState?.skippedPrCount ?? 0,
    actionableCount: previousState?.actionableCount ?? 1,
    failureStreak: 0,
    nextSleepSeconds: previousState?.nextSleepSeconds ?? 180,
    updatedAt: new Date().toISOString(),
  } satisfies PersistedState);
}

function persistCompletedReviewState(
  selectedPrNumber: number,
  completion: ReviewCompletionResult,
  commentContext?: ReviewCommentContext,
  error?: string,
): PersistedState {
  ensurePrMonitorDir();
  const previousState = readJson<PersistedState | null>(STATE_FILE, null);
  const nextState = buildCompletedReviewState({
    completion,
    selectedPrNumber,
    previousState,
    error,
    ...commentContext,
  });
  writeJson(STATE_FILE, nextState);
  return nextState;
}

function persistRetryableReviewFailureState(
  selectedPrNumber: number,
  error: string,
  commentContext?: ReviewCommentContext,
): PersistedState {
  ensurePrMonitorDir();
  const previousState = readJson<PersistedState | null>(STATE_FILE, null);
  const nextState = buildRetryableReviewFailureState({
    selectedPrNumber,
    previousState,
    error,
    ...commentContext,
  });
  writeJson(STATE_FILE, nextState);
  return nextState;
}

function toReviewCommentContext(comment: ReviewCommentRecord): ReviewCommentContext {
  return {
    activeReviewCommentId: comment.id,
  };
}

function isReviewCompletionResult(value: string | undefined): value is ReviewCompletionResult {
  return value === 'review-posted'
    || value === 'needs-human-test'
    || value === 'approve-ready'
    || value === 'merge-ready'
    || value === 'merge-blocked';
}

function isVerificationStatus(value: string | undefined): value is VerificationStatus {
  return value === 'passed'
    || value === 'failed'
    || value === 'missing'
    || value === 'inherited-failure';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

void main();
