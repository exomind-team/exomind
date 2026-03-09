#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  buildHandledCursor,
  buildRestoredContext,
  ensureWorkerTempDirs,
  extractLinkedIssueNumber,
  getWorkerTempPaths,
  readJsonFileIfExists,
  renderWorkerBody,
  renderWorkerComment,
  renderWorkerDissentComment,
  renderWorkerDissentIssueBody,
  validateWorkerText,
  writeJsonFile,
  writeTextFile,
  type WorkerCursor,
  type WorkerWaitingState,
} from './lib.ts';
import {
  acquireLockViaPrLock,
  clearLockSnapshot,
  loadLockSnapshot,
  readRemoteLock,
  releaseLockViaPrLock,
  renewLockViaPrLock,
  resolveRepo,
  saveLockSnapshot,
  verifyRemoteLock,
} from './lock.ts';
import {
  determineNextAction,
  type NextActionPrState,
  type NextActionResult,
} from './next-action.ts';
import { planPrSync } from './pr-sync.ts';
import { fetchWaitSnapshot, summarizeWakeItems, waitForUpdateLoop } from './wait.ts';

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string[]>;
};

type PrListEntry = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : 'true';
    if (value !== 'true') {
      index += 1;
    }

    const existing = flags.get(key) ?? [];
    existing.push(value);
    flags.set(key, existing);
  }

  return { positionals, flags };
}

function flagValue(parsed: ParsedArgs, key: string, fallback?: string): string | undefined {
  const value = parsed.flags.get(key)?.[0];
  return value ?? fallback;
}

function repeatedFlagValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function requireFlag(parsed: ParsedArgs, key: string): string {
  const value = flagValue(parsed, key);
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function currentBranch(cwd = process.cwd()): string {
  return execFileSync('git', ['branch', '--show-current'], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function currentWorktree(cwd = process.cwd()): string {
  return cwd;
}

function gitHasChanges(cwd = process.cwd()): boolean {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  }).trim().length > 0;
}

function gitAheadCount(cwd = process.cwd()): number {
  try {
    const raw = execFileSync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    const parts = raw.split(/\s+/);
    return Number.parseInt(parts[1] ?? '0', 10);
  } catch {
    return 0;
  }
}

function hasCommitsBeyondBase(baseBranch: string, cwd = process.cwd()): boolean {
  for (const candidate of [baseBranch, `origin/${baseBranch}`]) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        cwd,
        stdio: 'ignore',
      });

      const raw = execFileSync('git', ['rev-list', '--count', `${candidate}..HEAD`], {
        cwd,
        encoding: 'utf8',
      }).trim();
      return Number.parseInt(raw || '0', 10) > 0;
    } catch {
      continue;
    }
  }

  return false;
}

function fetchPrMetadata(repo: string, prNumber: number, cwd = process.cwd()): {
  prNumber: number;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  issueNumber: number | null;
} {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'number,baseRefName,headRefName,headRefOid,body,closingIssuesReferences',
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    },
  ).trim();

  const parsed = JSON.parse(raw) as {
    number: number;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
    body?: string;
    closingIssuesReferences?: Array<{ number: number }>;
  };

  return {
    prNumber: parsed.number,
    baseBranch: parsed.baseRefName,
    headBranch: parsed.headRefName,
    headSha: parsed.headRefOid,
    issueNumber: parsed.closingIssuesReferences?.[0]?.number ?? extractLinkedIssueNumber(parsed.body ?? ''),
  };
}

function fetchCurrentPrForBranch(repo: string, branch: string, cwd = process.cwd()): PrListEntry | null {
  const raw = execFileSync(
    'gh',
    ['pr', 'list', '--repo', repo, '--state', 'open', '--head', branch, '--json', 'number,title,url,isDraft,headRefName,baseRefName'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    },
  ).trim();

  const parsed = JSON.parse(raw) as PrListEntry[];
  return parsed.find((entry) => entry.headRefName === branch) ?? parsed[0] ?? null;
}

function fetchPrRuntimeState(repo: string, prNumber: number, cwd = process.cwd()): NextActionPrState {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'number,isDraft,body,headRefOid,baseRefName,closingIssuesReferences,comments,reviews,labels,statusCheckRollup',
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    },
  ).trim();

  const parsed = JSON.parse(raw) as {
    number: number;
    isDraft: boolean;
    body: string;
    headRefOid: string;
    baseRefName: string;
    closingIssuesReferences?: Array<{ number: number }>;
    comments: Array<{ id: string; author?: { login?: string }; body: string; createdAt: string }>;
    reviews: Array<{ id: string; author?: { login?: string }; body: string; state: string; submittedAt: string }>;
    labels: Array<{ name: string }>;
    statusCheckRollup?: Array<{ name: string; status: string; conclusion?: string | null }>;
  };

  return {
    number: parsed.number,
    issueNumber: parsed.closingIssuesReferences?.[0]?.number ?? extractLinkedIssueNumber(parsed.body ?? ''),
    body: parsed.body ?? '',
    labels: parsed.labels.map((label) => label.name),
    headSha: parsed.headRefOid,
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
    isDraft: parsed.isDraft,
    baseBranch: parsed.baseRefName,
  };
}

function defaultCursor(): WorkerCursor {
  return {
    lastCommentIds: [],
    lastReviewIds: [],
    lastReviewThreadIds: [],
  };
}

function renderAndMaybeWrite(body: string, output?: string): void {
  if (output) {
    writeTextFile(output, body);
  }
  console.log(body);
}

async function runRestore(parsed: ParsedArgs): Promise<void> {
  const tempRoot = flagValue(parsed, 'temp-root', 'temp/worker-agent')!;
  const cwd = flagValue(parsed, 'cwd', process.cwd())!;
  const repo = resolveRepo(flagValue(parsed, 'repo'), cwd);
  const agentId = flagValue(parsed, 'agent-id');
  const paths = getWorkerTempPaths(tempRoot);
  ensureWorkerTempDirs(paths);

  const snapshot = loadLockSnapshot(tempRoot);
  if (!snapshot?.prNumber) {
    throw new Error('No current lock snapshot found. Acquire or snapshot a PR lock first.');
  }

  const remoteLock = verifyRemoteLock({
    repo,
    prNumber: snapshot.prNumber,
    expectedAgentId: agentId ?? snapshot.agentId,
    cwd,
  });
  if (!remoteLock) {
    throw new Error(`Unable to verify remote PR lock for PR #${snapshot.prNumber}.`);
  }

  const currentState = readJsonFileIfExists<Record<string, unknown>>(paths.currentStateFile) ?? {};
  const cursor = readJsonFileIfExists<WorkerCursor>(paths.handledCursorFile) ?? defaultCursor();
  const waiting = readJsonFileIfExists<WorkerWaitingState>(paths.waitingStateFile);
  const metadata = fetchPrMetadata(repo, snapshot.prNumber, cwd);

  const context = buildRestoredContext({
    prNumber: snapshot.prNumber,
    issueNumber: metadata.issueNumber,
    branch: metadata.headBranch || currentBranch(cwd),
    baseBranch: metadata.baseBranch,
    worktree: currentWorktree(cwd),
    headSha: metadata.headSha,
    cursor,
    waiting: waiting?.waiting ? waiting : null,
    lock: {
      lockId: remoteLock.lock_id,
      owner: remoteLock.agent_id,
      acquiredAt: remoteLock.acquired_at,
    },
  });

  writeJsonFile(paths.currentStateFile, {
    ...currentState,
    prNumber: context.prNumber,
    issueNumber: context.issueNumber,
    branch: context.branch,
    baseBranch: context.baseBranch,
    worktree: context.worktree,
    headSha: context.headSha,
    lockSource: 'pr-lock-system',
    lastSyncedAt: new Date().toISOString(),
  });

  saveLockSnapshot(
    {
      repo,
      prNumber: context.prNumber,
      agentId: context.lock.owner,
      lockId: context.lock.lockId,
      acquiredAt: context.lock.acquiredAt,
      verifiedAt: new Date().toISOString(),
    },
    tempRoot,
  );

  console.log(JSON.stringify(context, null, 2));
}

function runRenderComment(parsed: ParsedArgs): void {
  renderAndMaybeWrite(
    renderWorkerComment({
      quote: requireFlag(parsed, 'quote'),
      change: requireFlag(parsed, 'change'),
      verification: requireFlag(parsed, 'verification'),
      result: requireFlag(parsed, 'result'),
    }),
    flagValue(parsed, 'output'),
  );
}

function runRenderDissentComment(parsed: ParsedArgs): void {
  renderAndMaybeWrite(
    renderWorkerDissentComment({
      scriptConclusion: requireFlag(parsed, 'script-conclusion'),
      actualConclusion: requireFlag(parsed, 'actual-conclusion'),
      reproducibleEvidence: requireFlag(parsed, 'repro-evidence'),
      traceProcess: requireFlag(parsed, 'trace-process'),
      impact: requireFlag(parsed, 'impact'),
      linkedIssue: requireFlag(parsed, 'linked-issue'),
    }),
    flagValue(parsed, 'output'),
  );
}

function runRenderBody(parsed: ParsedArgs): void {
  renderAndMaybeWrite(
    renderWorkerBody({
      summary: requireFlag(parsed, 'summary'),
      scope: requireFlag(parsed, 'scope'),
      verification: requireFlag(parsed, 'verification'),
      linksRefs: requireFlag(parsed, 'links-refs'),
    }),
    flagValue(parsed, 'output'),
  );
}

function runRenderDissentIssue(parsed: ParsedArgs): void {
  renderAndMaybeWrite(
    renderWorkerDissentIssueBody({
      scriptConclusion: requireFlag(parsed, 'script-conclusion'),
      actualConclusion: requireFlag(parsed, 'actual-conclusion'),
      reproducibleEvidence: requireFlag(parsed, 'repro-evidence'),
      traceProcess: requireFlag(parsed, 'trace-process'),
      impact: requireFlag(parsed, 'impact'),
      linkedPr: requireFlag(parsed, 'linked-pr'),
      extraNotes: flagValue(parsed, 'extra-notes'),
    }),
    flagValue(parsed, 'output'),
  );
}

function runValidateMessage(parsed: ParsedArgs): void {
  const filePath = flagValue(parsed, 'file');
  const body = filePath
    ? readFileSync(filePath, 'utf8')
    : requireFlag(parsed, 'body');
  const issues = validateWorkerText(body, {
    requiredSections: repeatedFlagValues(parsed, 'section'),
  });
  console.log(JSON.stringify({ ok: issues.length === 0, issues }, null, 2));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

async function runCursor(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1];
  const tempRoot = flagValue(parsed, 'temp-root', 'temp/worker-agent')!;
  const cwd = flagValue(parsed, 'cwd', process.cwd())!;
  const repo = resolveRepo(flagValue(parsed, 'repo'), cwd);
  const paths = getWorkerTempPaths(tempRoot);
  ensureWorkerTempDirs(paths);

  switch (action) {
    case 'sync': {
      const explicitPr = flagValue(parsed, 'pr');
      const snapshot = loadLockSnapshot(tempRoot);
      const branch = currentBranch(cwd);
      const branchPr = fetchCurrentPrForBranch(repo, branch, cwd);
      const prNumber = Number.parseInt(
        explicitPr ?? String(snapshot?.prNumber ?? branchPr?.number ?? ''),
        10,
      );

      if (!Number.isFinite(prNumber)) {
        throw new Error('Unable to resolve PR number for cursor sync. Pass --pr or restore/acquire a lock first.');
      }

      const prState = fetchPrRuntimeState(repo, prNumber, cwd);
      const previous = readJsonFileIfExists<WorkerCursor>(paths.handledCursorFile) ?? defaultCursor();
      const cursor = buildHandledCursor({
        commentIds: prState.comments.map((comment) => comment.id),
        reviewIds: prState.reviews.map((review) => review.id),
        previous,
      });
      writeJsonFile(paths.handledCursorFile, cursor);
      console.log(JSON.stringify(cursor, null, 2));
      return;
    }

    default:
      throw new Error(`Unknown cursor action: ${action}`);
  }
}

function appendBodyArgs(args: string[], plan: { bodyMode: 'none' | 'text' | 'file'; bodyValue?: string }): void {
  if (plan.bodyMode === 'text' && plan.bodyValue) {
    args.push('--body', plan.bodyValue);
  }

  if (plan.bodyMode === 'file' && plan.bodyValue) {
    args.push('--body-file', plan.bodyValue);
  }
}

async function runPr(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1];
  const tempRoot = flagValue(parsed, 'temp-root', 'temp/worker-agent')!;
  const cwd = flagValue(parsed, 'cwd', process.cwd())!;
  const repo = resolveRepo(flagValue(parsed, 'repo'), cwd);
  const branch = currentBranch(cwd);
  const baseBranch = flagValue(parsed, 'base-branch', 'dev')!;
  const paths = getWorkerTempPaths(tempRoot);
  ensureWorkerTempDirs(paths);

  switch (action) {
    case 'sync': {
      const existingPr = fetchCurrentPrForBranch(repo, branch, cwd);
      const plan = planPrSync({
        existingPr: existingPr
          ? {
              number: existingPr.number,
              title: existingPr.title,
            }
          : null,
        baseBranch,
        title: flagValue(parsed, 'title'),
        explicitBody: flagValue(parsed, 'body'),
        explicitBodyFile: flagValue(parsed, 'body-file'),
        defaultBodyFile: paths.prBodyDraftFile,
        defaultBodyExists: existsSync(paths.prBodyDraftFile),
      });

      if (plan.mode === 'noop') {
        console.log(JSON.stringify({ ok: true, mode: 'noop', prNumber: plan.prNumber }, null, 2));
        return;
      }

      if (plan.mode === 'create') {
        const args = [
          'pr',
          'create',
          '--repo',
          repo,
          '--base',
          plan.baseBranch,
          '--head',
          branch,
          '--draft',
          '--title',
          plan.title,
        ];
        appendBodyArgs(args, plan);
        const output = execFileSync('gh', args, {
          cwd,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 16,
        }).trim();
        const created = fetchCurrentPrForBranch(repo, branch, cwd);
        console.log(JSON.stringify({ ok: true, mode: 'create', output, pr: created }, null, 2));
        return;
      }

      const args = ['pr', 'edit', String(plan.prNumber), '--repo', repo];
      if (plan.title) {
        args.push('--title', plan.title);
      }
      appendBodyArgs(args, plan);
      execFileSync('gh', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 16,
      }).trim();
      const updated = fetchCurrentPrForBranch(repo, branch, cwd);
      console.log(JSON.stringify({ ok: true, mode: 'update', pr: updated }, null, 2));
      return;
    }

    default:
      throw new Error(`Unknown pr action: ${action}`);
  }
}

async function runLock(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[1];
  const cwd = flagValue(parsed, 'cwd', process.cwd())!;
  const tempRoot = flagValue(parsed, 'temp-root', 'temp/worker-agent')!;
  const repo = resolveRepo(flagValue(parsed, 'repo'), cwd);
  const prNumber = Number.parseInt(requireFlag(parsed, 'pr'), 10);
  const agentId = flagValue(parsed, 'agent-id', 'codex-worker')!;

  switch (action) {
    case 'acquire': {
      const timeoutMinutes = Number.parseInt(flagValue(parsed, 'timeout-minutes', '60')!, 10);
      const snapshot = acquireLockViaPrLock({
        repo,
        prNumber,
        agentId,
        timeoutMinutes,
        taskId: flagValue(parsed, 'task-id'),
        reason: flagValue(parsed, 'reason'),
        cwd,
        tempRoot,
      });
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    case 'renew': {
      const additionalMinutes = Number.parseInt(requireFlag(parsed, 'additional-minutes'), 10);
      const snapshot = renewLockViaPrLock({
        repo,
        prNumber,
        agentId,
        additionalMinutes,
        cwd,
        tempRoot,
      });
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    case 'release': {
      const raw = releaseLockViaPrLock({
        repo,
        prNumber,
        agentId,
        cwd,
      });
      clearLockSnapshot(tempRoot);
      console.log(raw);
      return;
    }

    case 'check': {
      const lock = verifyRemoteLock({
        repo,
        prNumber,
        expectedAgentId: flagValue(parsed, 'strict-owner') === 'true' ? agentId : undefined,
        cwd,
      });
      console.log(JSON.stringify({ ok: Boolean(lock), lock }, null, 2));
      if (!lock) {
        process.exitCode = 1;
      }
      return;
    }

    default:
      throw new Error(`Unknown lock action: ${action}`);
  }
}

async function runNextAction(parsed: ParsedArgs): Promise<void> {
  const tempRoot = flagValue(parsed, 'temp-root', 'temp/worker-agent')!;
  const cwd = flagValue(parsed, 'cwd', process.cwd())!;
  const repo = resolveRepo(flagValue(parsed, 'repo'), cwd);
  const paths = getWorkerTempPaths(tempRoot);
  ensureWorkerTempDirs(paths);

  const branch = currentBranch(cwd);
  const currentState = readJsonFileIfExists<Record<string, unknown>>(paths.currentStateFile) ?? {};
  const prSummary = fetchCurrentPrForBranch(repo, branch, cwd);
  const prState = prSummary ? fetchPrRuntimeState(repo, prSummary.number, cwd) : null;
  const baseBranch = prState?.baseBranch ?? flagValue(parsed, 'base-branch', 'dev')!;
  const git = {
    branch,
    isDefaultBranch: branch === baseBranch || branch === 'main',
    hasChanges: gitHasChanges(cwd),
    aheadCount: gitAheadCount(cwd),
    hasCommitsBeyondBase: hasCommitsBeyondBase(baseBranch, cwd),
  };
  const localLock = loadLockSnapshot(tempRoot);
  const agentId = flagValue(parsed, 'agent-id', localLock?.agentId ?? 'codex-worker')!;
  const remoteLock = prState ? readRemoteLock(repo, prState.number, cwd) : null;
  const cursor = readJsonFileIfExists<WorkerCursor>(paths.handledCursorFile) ?? defaultCursor();
  const result: NextActionResult = determineNextAction({
    worker: {
      agentId,
    },
    git,
    pr: prState,
    cursor,
    lock: {
      local: localLock,
      remote: remoteLock,
    },
    dissent: {
      requested: flagValue(parsed, 'dissent', 'false') === 'true',
      summary: flagValue(parsed, 'dissent-summary'),
    },
  });

  writeJsonFile(paths.currentStateFile, {
    ...currentState,
    prNumber: prState?.number ?? null,
    issueNumber: prState?.issueNumber ?? null,
    branch,
    baseBranch,
    worktree: currentWorktree(cwd),
    headSha: prState?.headSha ?? null,
    nextAction: result.action,
    nextActionReason: result.reason,
    lastSyncedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      {
        context: {
          repo,
          branch,
          worktree: currentWorktree(cwd),
          prNumber: prState?.number ?? null,
          issueNumber: prState?.issueNumber ?? null,
          baseBranch,
          headSha: prState?.headSha ?? null,
          localLock,
          remoteLock,
          git,
        },
        result,
      },
      null,
      2,
    ),
  );
}

async function runWaitForUpdate(parsed: ParsedArgs): Promise<void> {
  const tempRoot = flagValue(parsed, 'temp-root', 'temp/worker-agent')!;
  const cwd = flagValue(parsed, 'cwd', process.cwd())!;
  const repo = resolveRepo(flagValue(parsed, 'repo'), cwd);
  const agentId = flagValue(parsed, 'agent-id');
  const paths = getWorkerTempPaths(tempRoot);
  ensureWorkerTempDirs(paths);

  const snapshot = loadLockSnapshot(tempRoot);
  if (!snapshot?.prNumber) {
    throw new Error('No current lock snapshot found. Restore or acquire a lock first.');
  }

  const remoteLock = verifyRemoteLock({
    repo,
    prNumber: snapshot.prNumber,
    expectedAgentId: agentId ?? snapshot.agentId,
    cwd,
  });
  if (!remoteLock) {
    throw new Error(`Unable to verify remote PR lock for PR #${snapshot.prNumber}.`);
  }

  const cursor = readJsonFileIfExists<WorkerCursor>(paths.handledCursorFile) ?? defaultCursor();

  writeJsonFile(paths.waitingStateFile, {
    waiting: true,
    waitingOn: 'reviewer',
    since: new Date().toISOString(),
  });

  const result = await waitForUpdateLoop({
    repo,
    prNumber: snapshot.prNumber,
    cursor,
    cwd,
    pollIntervalMs: Number.parseInt(flagValue(parsed, 'poll-seconds', '15')!, 10) * 1000,
    heartbeatMs: Number.parseInt(flagValue(parsed, 'heartbeat-seconds', '60')!, 10) * 1000,
    onHeartbeat: (payload) => {
      writeJsonFile(paths.waitingStateFile, {
        waiting: true,
        waitingOn: payload.waitingOn,
        since: payload.since,
        lastHeartbeatAt: new Date().toISOString(),
      });
      process.stdout.write(`${JSON.stringify({ heartbeat: true, ...payload })}\n`);
    },
  });

  writeJsonFile(paths.lastWakeFile, {
    reason: result.reason,
    newItems: result.newItems,
    wokeAt: new Date().toISOString(),
    prNumber: result.pr,
    headSha: result.headSha,
    summary: summarizeWakeItems(result.newItems),
  });
  writeJsonFile(paths.waitingStateFile, {
    waiting: false,
    waitingOn: result.waitingOn,
    since: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
  });

  console.log(JSON.stringify(result, null, 2));
}

function printHelp(): void {
  console.log(`Usage:
  worker-agent restore [--repo <owner/repo>] [--agent-id <id>] [--temp-root <path>]
  worker-agent next-action [--repo <owner/repo>] [--agent-id <id>] [--temp-root <path>] [--base-branch <name>]
  worker-agent cursor sync [--repo <owner/repo>] [--pr <number>] [--temp-root <path>]
  worker-agent pr sync [--repo <owner/repo>] [--base-branch <name>] [--title <text>] [--body <text> | --body-file <path>] [--temp-root <path>]
  worker-agent render-comment --quote <text> --change <text> --verification <text> --result <text> [--output <path>]
  worker-agent render-dissent-comment --script-conclusion <text> --actual-conclusion <text> --repro-evidence <text> --trace-process <text> --impact <text> --linked-issue <text> [--output <path>]
  worker-agent render-body --summary <text> --scope <text> --verification <text> --links-refs <text> [--output <path>]
  worker-agent render-dissent-issue --script-conclusion <text> --actual-conclusion <text> --repro-evidence <text> --trace-process <text> --impact <text> --linked-pr <text> [--extra-notes <text>] [--output <path>]
  worker-agent validate-message (--file <path> | --body <text>) [--section <name>...]
  worker-agent lock <acquire|renew|release|check> --pr <number> [--repo <owner/repo>] [--agent-id <id>]
  worker-agent wait-for-update [--repo <owner/repo>] [--agent-id <id>] [--temp-root <path>]
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'restore':
      await runRestore(parsed);
      return;
    case 'next-action':
      await runNextAction(parsed);
      return;
    case 'cursor':
      await runCursor(parsed);
      return;
    case 'pr':
      await runPr(parsed);
      return;
    case 'render-comment':
      runRenderComment(parsed);
      return;
    case 'render-dissent-comment':
      runRenderDissentComment(parsed);
      return;
    case 'render-body':
      runRenderBody(parsed);
      return;
    case 'render-dissent-issue':
      runRenderDissentIssue(parsed);
      return;
    case 'validate-message':
      runValidateMessage(parsed);
      return;
    case 'lock':
      await runLock(parsed);
      return;
    case 'wait-for-update':
      await runWaitForUpdate(parsed);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(2, `${message}\n`);
  process.exit(1);
});
