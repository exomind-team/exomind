import { execFileSync } from 'node:child_process';

import {
  buildReviewSummary,
  parseLinkedIssueNumbers,
  type PullRequestFile,
} from './review-loop-lib.ts';
import {
  QUEUE_FILE,
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

interface IssueView {
  number: number;
  title: string;
  body?: string;
}

interface PullFileApiItem {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const repo = resolveRepo(options.repo);
  const prNumber = options.prNumber ?? readSelectedPrNumber();
  const pullRequest = viewPullRequest(prNumber, repo);
  const files = fetchPullFiles(prNumber, repo);
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
    needsWorktree: reviewSummary.needsWorktree,
    parsedIssueRefs: parseLinkedIssueNumbers(pullRequest.body ?? ''),
    url: pullRequest.url,
  };

  persistReviewState(reviewSummary.selectedPr.number);
  console.log(JSON.stringify(output, null, 2));
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

    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
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

function fetchPullFiles(prNumber: number, repo: string): PullRequestFile[] {
  const files = runGhJson<PullFileApiItem[]>([
    'api',
    `repos/${repo}/pulls/${prNumber}/files?per_page=100`,
  ]);

  return files.map((file) => ({
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

function runGhJson<T>(args: string[]): T {
  const stdout = execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(stdout) as T;
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

function persistReviewState(selectedPrNumber: number): void {
  ensurePrMonitorDir();
  const previousState = readJson<PersistedState | null>(STATE_FILE, null);

  writeJson(STATE_FILE, {
    state: 'HAS_TARGET',
    phase: 'REVIEW',
    lastPhase: 'REVIEW',
    nextPrompt: 'review',
    selectedPrNumber,
    selectedReason: previousState?.selectedReason ?? null,
    inspectedPrCount: previousState?.inspectedPrCount ?? 0,
    skippedPrCount: previousState?.skippedPrCount ?? 0,
    actionableCount: previousState?.actionableCount ?? 1,
    failureStreak: 0,
    nextSleepSeconds: previousState?.nextSleepSeconds ?? 180,
    updatedAt: new Date().toISOString(),
  } satisfies PersistedState);
}

main();
