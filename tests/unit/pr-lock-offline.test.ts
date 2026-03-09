/**
 * PR Lock 离线单元测试
 *
 * 使用 mock GitHub API，测试降级路径：
 * 1. Stale metadata（竞争失败方崩溃）
 * 2. Local state mismatch（本地状态不匹配）
 * 3. Local state missing（本地状态丢失）
 * 4. Force release（强制释放）
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { PRLockManager } from '../../Scripts/lib/pr-lock';
import { MockGitHubAPI } from '../../Scripts/lib/pr-lock-mock';

describe('PR Lock - 降级路径测试', () => {
  let mockAPI: MockGitHubAPI;
  let agentA: PRLockManager;
  let agentB: PRLockManager;

  beforeEach(() => {
    mockAPI = new MockGitHubAPI();
    agentA = new PRLockManager('test/repo', 'agent-a@test', mockAPI);
    agentB = new PRLockManager('test/repo', 'agent-b@test', mockAPI);
  });

  describe('场景 1: Stale metadata（竞争失败方崩溃）', () => {
    test('胜者释放锁时，败者的未释放元数据不应影响后续 checkLock()', async () => {
      // RED: 这个测试应该失败，因为 MockGitHubAPI 还不存在

      // 1. Agent A 和 B 同时获取锁
      const resultA = await agentA.acquire(1, 5);
      const resultB = await agentB.acquire(1, 5);

      // 2. 验证竞争检测
      expect(resultA.success).toBe(true);
      expect(resultB.success).toBe(false);
      expect(resultB.conflict).toBeDefined();

      // 3. 模拟 Agent B 崩溃（未执行 release）
      // Agent B 的元数据仍然存在，但 released: false

      // 4. Agent A 正常释放锁
      const releaseResult = await agentA.release(1);
      expect(releaseResult.success).toBe(true);

      // 5. 验证 checkLock() 不会误判 Agent B 的 stale metadata
      const lock = await agentA.checkLock(1);
      expect(lock).toBeNull(); // 应该没有有效锁
    });
  });

  describe('场景 2: Local state mismatch（本地状态不匹配）', () => {
    test('本地状态 pr_number 不匹配时，应按 lock_id 查找并更新原始评论', async () => {
      // RED: 这个测试应该失败

      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);

      // 2. 模拟本地状态损坏（pr_number 错误）
      // TODO: 需要添加测试辅助方法
      // await agentA.corruptLocalState({ pr_number: 999 });

      // 3. Agent A 释放锁
      const releaseResult = await agentA.release(1);
      expect(releaseResult.success).toBe(true);

      // 4. 验证原始评论被正确更新为 released: true
      const comments = await mockAPI.getComments(1);
      const lockComment = comments.find(c => c.body.includes('LOCK_METADATA'));
      expect(lockComment).toBeDefined();

      const metadata = JSON.parse(
        lockComment!.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/)?.[1] || '{}'
      );
      expect(metadata.released).toBe(true);
    });

    test('本地状态 lock_id 不匹配时，应按 lock_id 查找并更新原始评论', async () => {
      // RED: 这个测试应该失败

      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);
      const originalLockId = result.lock!.lock_id;

      // 2. 模拟本地状态损坏（lock_id 错误）
      // TODO: 需要添加测试辅助方法
      // await agentA.corruptLocalState({ lock_id: 'wrong-lock-id' });

      // 3. Agent A 释放锁
      const releaseResult = await agentA.release(1);
      expect(releaseResult.success).toBe(true);

      // 4. 验证原始评论（使用正确的 lock_id）被更新
      const comments = await mockAPI.getComments(1);
      const lockComment = comments.find(c => {
        const match = c.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
        if (!match) return false;
        const metadata = JSON.parse(match[1]);
        return metadata.lock_id === originalLockId;
      });

      expect(lockComment).toBeDefined();
      const metadata = JSON.parse(
        lockComment!.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/)?.[1] || '{}'
      );
      expect(metadata.released).toBe(true);
    });
  });

  describe('场景 3: Local state missing（本地状态丢失）', () => {
    test('本地状态丢失时，应按 lock_id 查找并更新原始评论', async () => {
      // RED: 这个测试应该失败

      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);
      const lockId = result.lock!.lock_id;

      // 2. 模拟本地状态丢失
      // TODO: 需要添加测试辅助方法
      // await agentA.deleteLocalState();

      // 3. Agent A 释放锁
      const releaseResult = await agentA.release(1);
      expect(releaseResult.success).toBe(true);

      // 4. 验证原始评论被正确更新
      const comments = await mockAPI.getComments(1);
      const lockComment = comments.find(c => {
        const match = c.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
        if (!match) return false;
        const metadata = JSON.parse(match[1]);
        return metadata.lock_id === lockId;
      });

      expect(lockComment).toBeDefined();
      const metadata = JSON.parse(
        lockComment!.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/)?.[1] || '{}'
      );
      expect(metadata.released).toBe(true);
    });
  });

  describe('场景 4: Force release（强制释放）', () => {
    test('强制释放应更新元数据为 released: true', async () => {
      // RED: 这个测试应该失败

      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);

      // 2. 模拟时间流逝（锁过期）
      mockAPI.advanceTime(6 * 60 * 1000); // 6 分钟

      // 3. Agent B 强制释放过期锁
      await agentB.forceRelease(1);

      // 4. 验证元数据被标记为 released: true
      const lock = await agentB.checkLock(1);
      expect(lock).toBeNull(); // 应该没有有效锁

      // 5. 验证评论被更新
      const comments = mockAPI.getComments(1);
      const lockComment = comments.find(c => c.body.includes('LOCK_METADATA'));
      expect(lockComment).toBeDefined();

      const metadata = JSON.parse(
        lockComment!.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/)?.[1] || '{}'
      );
      expect(metadata.released).toBe(true);
    });
  });
});
