import { execFileSync } from 'node:child_process';
import { parseRepoFromRemoteUrl } from '../github-comment-lib.ts';
import { getWorkerTempPaths, readJsonFileIfExists, writeJsonFile } from './lib.ts';

const LOCK_METADATA_PATTERN = /<!-- LOCK_METADATA\n([\s\S]*?)\n-->/;

export interface RawRemoteLockMetadata {
  lock_id: string;
  agent_id: string;
  acquired_at: string;
  expires_at?: string;
  timeout_minutes?: number;
  lock_duration_minutes?: number;
  task_id?: string;
  reason?: string;
  worktree_path?: string;
  branch?: string;
  pending?: boolean;
  released?: boolean;
  released_at?: string;
}

export interface RemoteLockMetadata {
  lock_id: string;
  agent_id: string;
  acquired_at: string;
  expires_at: string;
  lock_duration_minutes: number;
  task_id?: string;
  reason?: string;
  worktree_path?: string;
  branch?: string;
  pending?: boolean;
  released?: boolean;
  released_at?: string;
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

function calculateExpiresAt(acquiredAt: string, lockDurationMinutes: number): string {
  const acquired = new Date(acquiredAt);
  if (Number.isNaN(acquired.getTime())) {
    throw new Error(`Invalid acquired_at timestamp: ${acquiredAt}`);
  }

  return new Date(acquired.getTime() + lockDurationMinutes * 60 * 1000).toISOString();
}

function inferDurationMinutes(raw: RawRemoteLockMetadata): number {
  if (typeof raw.lock_duration_minutes === 'number') {
    return raw.lock_duration_minutes;
  }

  if (typeof raw.timeout_minutes === 'number') {
    return raw.timeout_minutes;
  }

  if (raw.expires_at) {
    const acquired = new Date(raw.acquired_at);
    const expires = new Date(raw.expires_at);
    if (!Number.isNaN(acquired.getTime()) && !Number.isNaN(expires.getTime())) {
      return Math.max(1, Math.round((expires.getTime() - acquired.getTime()) / 60000));
    }
  }

  throw new Error('Lock metadata is missing both lock_duration_minutes and timeout_minutes.');
}

function isExpiredLock(expiresAt: string, now = Date.now()): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= now;
}

function parseJsonFromCommandOutput<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/(\{[\s\S]*\})\s*$/);
    if (!match?.[1]) {
      throw new Error(`Unable to parse JSON output from pr-lock command:\n${raw}`);
    }

    return JSON.parse(match[1]) as T;
  }
}

export function normalizeRemoteLockMetadata(raw: RawRemoteLockMetadata | null | undefined): RemoteLockMetadata | null {
  if (!raw?.lock_id || !raw.agent_id || !raw.acquired_at) {
    return null;
  }

  if (raw.released) {
    return null;
  }

  if (raw.pending) {
    return null;
  }

  const lockDurationMinutes = inferDurationMinutes(raw);
  const expiresAt = raw.expires_at ?? calculateExpiresAt(raw.acquired_at, lockDurationMinutes);
  if (isExpiredLock(expiresAt)) {
    return null;
  }

  return {
    lock_id: raw.lock_id,
    agent_id: raw.agent_id,
    acquired_at: raw.acquired_at,
    expires_at: expiresAt,
    lock_duration_minutes: lockDurationMinutes,
    task_id: raw.task_id,
    reason: raw.reason,
    worktree_path: raw.worktree_path,
    branch: raw.branch,
    pending: raw.pending,
    released: raw.released,
    released_at: raw.released_at,
  };
}

function updateSnapshotFromLock(params: {
  repo: string;
  prNumber: number;
  agentId: string;
  lock: RemoteLockMetadata;
  tempRoot?: string;
}): WorkerLockSnapshot {
  const snapshot: WorkerLockSnapshot = {
    repo: params.repo,
    prNumber: params.prNumber,
    agentId: params.agentId,
    lockId: params.lock.lock_id,
    acquiredAt: params.lock.acquired_at,
    verifiedAt: new Date().toISOString(),
  };

  saveLockSnapshot(snapshot, params.tempRoot);
  return snapshot;
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

export function extractLatestActiveLockFromComments(
  comments: Array<{ body?: string | null }>,
): RemoteLockMetadata | null {
  for (const comment of [...comments].reverse()) {
    if (!LOCK_METADATA_PATTERN.test(comment.body ?? '')) {
      continue;
    }

    const match = comment.body?.match(LOCK_METADATA_PATTERN);
    if (!match?.[1]) {
      continue;
    }

    try {
      const lock = normalizeRemoteLockMetadata(JSON.parse(match[1]) as RawRemoteLockMetadata);
      if (!lock || lock.pending) {
        continue;
      }
      return lock;
    } catch {
      continue;
    }
  }

  return null;
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

  return extractLatestActiveLockFromComments(parsed.comments);
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

  const parsed = parseJsonFromCommandOutput<{
    success: boolean;
    lock?: RawRemoteLockMetadata;
    error?: string;
  }>(raw);
  const lock = normalizeRemoteLockMetadata(parsed.lock);

  if (!parsed.success || !lock) {
    throw new Error(parsed.error ?? 'Failed to acquire PR lock.');
  }

  return updateSnapshotFromLock({
    repo: params.repo,
    prNumber: params.prNumber,
    agentId: params.agentId,
    lock,
    tempRoot: params.tempRoot,
  });
}

export function renewLockViaPrLock(params: {
  repo: string;
  prNumber: number;
  agentId: string;
  additionalMinutes: number;
  cwd?: string;
  tempRoot?: string;
}): WorkerLockSnapshot {
  const runner = resolvePrLockRunner();
  const raw = execFileSync(
    runner.command,
    [
      ...runner.argsPrefix,
      'Scripts/lib/pr-lock.ts',
      'renew',
      String(params.prNumber),
      String(params.additionalMinutes),
      params.agentId,
    ],
    {
      cwd: params.cwd ?? process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    },
  ).trim();

  const parsed = parseJsonFromCommandOutput<{
    success: boolean;
    lock?: RawRemoteLockMetadata;
    error?: string;
  }>(raw);
  const lock = normalizeRemoteLockMetadata(parsed.lock);

  if (!parsed.success || !lock) {
    throw new Error(parsed.error ?? 'Failed to renew PR lock.');
  }

  return updateSnapshotFromLock({
    repo: params.repo,
    prNumber: params.prNumber,
    agentId: params.agentId,
    lock,
    tempRoot: params.tempRoot,
  });
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
