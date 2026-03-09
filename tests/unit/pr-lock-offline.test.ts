import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PRLockManager } from '../../Scripts/lib/pr-lock';
import { MockGitHubAPI } from '../../Scripts/lib/pr-lock-mock';

function extractLockMetadata(body: string) {
  const match = body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
  if (!match) {
    throw new Error('Missing LOCK_METADATA payload');
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('PRLockManager offline regressions', () => {
  let mockAPI: MockGitHubAPI;
  let agentA: PRLockManager;
  const originalCwd = process.cwd();
  let tempWorktree = '';

  beforeEach(() => {
    tempWorktree = mkdtempSync(path.join(tmpdir(), 'pr-lock-offline-'));
    process.chdir(tempWorktree);
    mockAPI = new MockGitHubAPI();
    agentA = new PRLockManager('test/repo', 'agent-a@test', mockAPI);
    (agentA as any).sleep = async () => {};
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempWorktree, { recursive: true, force: true });
  });

  test('release() removes local state when the remote lock is already gone', async () => {
    const acquireResult = await agentA.acquire(1, 5);
    expect(acquireResult.success).toBe(true);

    const localStateBefore = await (agentA as any).loadLockState();
    expect(localStateBefore?.pr_number).toBe(1);

    await mockAPI.removeLabel(1, '🔒 locked');

    const releaseResult = await agentA.release(1);
    expect(releaseResult.success).toBe(true);

    const localStateAfter = await (agentA as any).loadLockState();
    expect(localStateAfter).toBeNull();
  });

  test('release() only persists base metadata fields', async () => {
    const acquireResult = await agentA.acquire(1, 5);
    expect(acquireResult.success).toBe(true);
    const lockId = acquireResult.lock!.lock_id;

    const releaseResult = await agentA.release(1);
    expect(releaseResult.success).toBe(true);

    const comments = await mockAPI.getComments(1);
    const lockComment = comments.find((comment) => {
      const metadata = extractLockMetadata(comment.body);
      return metadata.lock_id === lockId;
    });

    expect(lockComment).toBeDefined();
    const metadata = extractLockMetadata(lockComment!.body);
    expect(metadata.released).toBe(true);
    expect(metadata.expires_at).toBeUndefined();
    expect(metadata.remaining_minutes).toBeUndefined();
    expect(metadata.is_expired).toBeUndefined();
    expect(metadata.should_renew).toBeUndefined();
    expect(metadata.renew_reason).toBeUndefined();
    expect(metadata.pr_number).toBeUndefined();
    expect(metadata.pr_last_updated_at).toBeUndefined();
  });

  test('renew() only persists base metadata fields while keeping derived fields in the return value', async () => {
    const acquireResult = await agentA.acquire(1, 60);
    expect(acquireResult.success).toBe(true);
    const lockId = acquireResult.lock!.lock_id;

    const renewResult = await agentA.renew(1, 30);
    expect(renewResult.success).toBe(true);
    expect(renewResult.lock!.lock_duration_minutes).toBe(90);

    const comments = await mockAPI.getComments(1);
    const lockComment = comments.find((comment) => {
      const metadata = extractLockMetadata(comment.body);
      return metadata.lock_id === lockId;
    });

    expect(lockComment).toBeDefined();
    const metadata = extractLockMetadata(lockComment!.body);
    expect(metadata.lock_duration_minutes).toBe(90);
    expect(metadata.expires_at).toBeUndefined();
    expect(metadata.remaining_minutes).toBeUndefined();
    expect(metadata.is_expired).toBeUndefined();
    expect(metadata.should_renew).toBeUndefined();
    expect(metadata.renew_reason).toBeUndefined();
    expect(metadata.pr_number).toBeUndefined();
    expect(metadata.pr_last_updated_at).toBeUndefined();

    expect(renewResult.lock!.expires_at).toBeDefined();
    expect(renewResult.lock!.remaining_minutes).toBeGreaterThan(0);
    expect(renewResult.lock!.is_expired).toBe(false);
  });

  test('forceRelease() only persists base metadata fields', async () => {
    const acquireResult = await agentA.acquire(1, 5);
    expect(acquireResult.success).toBe(true);
    const lockId = acquireResult.lock!.lock_id;

    const currentLock = await agentA.checkLock(1);
    expect(currentLock).not.toBeNull();

    await agentA.forceRelease(1, currentLock!);

    const comments = await mockAPI.getComments(1);
    const lockComment = comments.find((comment) => {
      const metadata = extractLockMetadata(comment.body);
      return metadata.lock_id === lockId;
    });

    expect(lockComment).toBeDefined();
    const metadata = extractLockMetadata(lockComment!.body);
    expect(metadata.released).toBe(true);
    expect(metadata.expires_at).toBeUndefined();
    expect(metadata.remaining_minutes).toBeUndefined();
    expect(metadata.is_expired).toBeUndefined();
    expect(metadata.should_renew).toBeUndefined();
    expect(metadata.renew_reason).toBeUndefined();
    expect(metadata.pr_number).toBeUndefined();
    expect(metadata.pr_last_updated_at).toBeUndefined();
  });
});
