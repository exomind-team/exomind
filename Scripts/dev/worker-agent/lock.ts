import { execFileSync } from 'node:child_process';
import { parseRepoFromRemoteUrl } from '../github-comment-lib.ts';
import { getWorkerTempPaths, readJsonFileIfExists, writeJsonFile } from './lib.ts';

const LOCK_METADATA_PATTERN = /<!-- LOCK_METADATA\n([\s\S]*?)\n-->/;

export interface RemoteLockMetadata {
  lock_id: string;
  agent_id: string;
  acquired_at: string;
  expires_at: string;
  timeout_minutes: number;
  task_id?: string;
  reason?: string;
}

export interface WorkerLockSnapshot {
  repo: string;
  prNumber: number;
  agentId: string;
  lockId: string;
  acquiredAt: string;
  verifiedAt: string;
}

export interface PrLockRunner {
  command: string;
  argsPrefix: string[];
}

function commandExists(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function resolvePrLockRunner(
  exists: (command: string) => boolean = commandExists,
): PrLockRunner {
  if (exists('bun')) {
    return {
      command: 'bun',
      argsPrefix: [],
    };
  }

  if (exists('npx')) {
    return {
      command: 'npx',
      argsPrefix: ['tsx'],
    };
  }

  throw new Error('Neither bun nor npx is available for PR lock integration.');
}

function runGh(args: string[], cwd = process.cwd()): string {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  }).trim();
}

export function resolveRepo(explicitRepo?: string, cwd = process.cwd()): string {
  if (explicitRepo) {
    return explicitRepo;
  }

  try {
    return runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], cwd);
  } catch {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    return parseRepoFromRemoteUrl(remoteUrl);
  }
}

export function loadLockSnapshot(tempRoot = 'temp/worker-agent'): WorkerLockSnapshot | null {
  return readJsonFileIfExists<WorkerLockSnapshot>(getWorkerTempPaths(tempRoot).currentLockFile);
}

export function saveLockSnapshot(snapshot: WorkerLockSnapshot, tempRoot = 'temp/worker-agent'): void {
  writeJsonFile(getWorkerTempPaths(tempRoot).currentLockFile, snapshot);
}

export function clearLockSnapshot(tempRoot = 'temp/worker-agent'): void {
  writeJsonFile(getWorkerTempPaths(tempRoot).currentLockFile, {});
}

export function readRemoteLock(repo: string, prNumber: number, cwd = process.cwd()): RemoteLockMetadata | null {
  const raw = runGh(['issue', 'view', String(prNumber), '--repo', repo, '--json', 'labels,comments'], cwd);
  const parsed = JSON.parse(raw) as {
    labels: Array<{ name: string }>;
    comments: Array<{ body?: string }>;
  };

  const hasLockedLabel = parsed.labels.some((label) => label.name === '🔒 locked' || label.name === '🔒locked');
  if (!hasLockedLabel) {
    return null;
  }

  const lockComment = [...parsed.comments].reverse().find((comment) => LOCK_METADATA_PATTERN.test(comment.body ?? ''));
  if (!lockComment?.body) {
    return null;
  }

  const match = lockComment.body.match(LOCK_METADATA_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  return JSON.parse(match[1]) as RemoteLockMetadata;
}

export function verifyRemoteLock(params: {
  repo: string;
  prNumber: number;
  expectedAgentId?: string;
  cwd?: string;
}): RemoteLockMetadata | null {
  const lock = readRemoteLock(params.repo, params.prNumber, params.cwd);
  if (!lock) {
    return null;
  }

  if (params.expectedAgentId && lock.agent_id !== params.expectedAgentId) {
    return null;
  }

  return lock;
}

export function acquireLockViaPrLock(params: {
  repo: string;
  prNumber: number;
  agentId: string;
  timeoutMinutes: number;
  taskId?: string;
  reason?: string;
  cwd?: string;
  tempRoot?: string;
}): WorkerLockSnapshot {
  const runner = resolvePrLockRunner();

  const args = [
    ...runner.argsPrefix,
    'Scripts/lib/pr-lock.ts',
    'acquire',
    String(params.prNumber),
    String(params.timeoutMinutes),
    params.agentId,
  ];

  if (params.taskId) {
    args.push(`--task-id=${params.taskId}`);
  }
  if (params.reason) {
    args.push(`--reason=${params.reason}`);
  }

  const raw = execFileSync(runner.command, args, {
    cwd: params.cwd ?? process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  }).trim();

  const parsed = JSON.parse(raw) as {
    success: boolean;
    lock?: RemoteLockMetadata;
    error?: string;
  };

  if (!parsed.success || !parsed.lock) {
    throw new Error(parsed.error ?? 'Failed to acquire PR lock.');
  }

  const snapshot: WorkerLockSnapshot = {
    repo: params.repo,
    prNumber: params.prNumber,
    agentId: params.agentId,
    lockId: parsed.lock.lock_id,
    acquiredAt: parsed.lock.acquired_at,
    verifiedAt: new Date().toISOString(),
  };

  saveLockSnapshot(snapshot, params.tempRoot);
  return snapshot;
}

export function releaseLockViaPrLock(params: {
  repo: string;
  prNumber: number;
  agentId: string;
  cwd?: string;
}): string {
  const runner = resolvePrLockRunner();

  return execFileSync(
    runner.command,
    [...runner.argsPrefix, 'Scripts/lib/pr-lock.ts', 'release', String(params.prNumber), params.agentId],
    {
      cwd: params.cwd ?? process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    },
  ).trim();
}
