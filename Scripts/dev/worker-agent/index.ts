#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildRestoredContext,
  ensureWorkerTempDirs,
  getWorkerTempPaths,
  readJsonFileIfExists,
  renderWorkerBody,
  renderWorkerComment,
  validateWorkerText,
  writeJsonFile,
  writeTextFile,
  type WorkerCursor,
  type WorkerWaitingState,
} from './lib.ts';
import {
  acquireLockViaPrLock,
  loadLockSnapshot,
  releaseLockViaPrLock,
  resolveRepo,
  saveLockSnapshot,
  verifyRemoteLock,
} from './lock.ts';
import { fetchWaitSnapshot, summarizeWakeItems, waitForUpdateLoop } from './wait.ts';

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string[]>;
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
      'number,baseRefName,headRefName,headRefOid,closingIssuesReferences',
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
    closingIssuesReferences?: Array<{ number: number }>;
  };

  return {
    prNumber: parsed.number,
    baseBranch: parsed.baseRefName,
    headBranch: parsed.headRefName,
    headSha: parsed.headRefOid,
    issueNumber: parsed.closingIssuesReferences?.[0]?.number ?? null,
  };
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
  const cursor = readJsonFileIfExists<WorkerCursor>(paths.handledCursorFile) ?? {
    lastCommentIds: [],
    lastReviewIds: [],
    lastReviewThreadIds: [],
  };
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
  const body = renderWorkerComment({
    quote: requireFlag(parsed, 'quote'),
    change: requireFlag(parsed, 'change'),
    verification: requireFlag(parsed, 'verification'),
    result: requireFlag(parsed, 'result'),
  });
  const output = flagValue(parsed, 'output');
  if (output) {
    writeTextFile(output, body);
  }
  console.log(body);
}

function runRenderBody(parsed: ParsedArgs): void {
  const body = renderWorkerBody({
    summary: requireFlag(parsed, 'summary'),
    scope: requireFlag(parsed, 'scope'),
    verification: requireFlag(parsed, 'verification'),
    linksRefs: requireFlag(parsed, 'links-refs'),
  });
  const output = flagValue(parsed, 'output');
  if (output) {
    writeTextFile(output, body);
  }
  console.log(body);
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

    case 'release': {
      const raw = releaseLockViaPrLock({
        repo,
        prNumber,
        agentId,
        cwd,
      });
      writeJsonFile(getWorkerTempPaths(tempRoot).currentLockFile, {});
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

  const cursor = readJsonFileIfExists<WorkerCursor>(paths.handledCursorFile) ?? {
    lastCommentIds: [],
    lastReviewIds: [],
    lastReviewThreadIds: [],
  };

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
  worker-agent render-comment --quote <text> --change <text> --verification <text> --result <text> [--output <path>]
  worker-agent render-body --summary <text> --scope <text> --verification <text> --links-refs <text> [--output <path>]
  worker-agent validate-message (--file <path> | --body <text>) [--section <name>...]
  worker-agent lock <acquire|release|check> --pr <number> [--repo <owner/repo>] [--agent-id <id>]
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
    case 'render-comment':
      runRenderComment(parsed);
      return;
    case 'render-body':
      runRenderBody(parsed);
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
