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
    test.skip('胜者释放锁时，败者的未释放元数据不应影响后续 checkLock()', async () => {
      // TODO: 需要更复杂的模拟来触发竞争检测
      // 当前实现中，acquire() 会先检查是否已有锁，所以很难模拟真实竞争
      // 这个场景在集成测试中更容易验证
    });
  });

  describe('场景 2: Local state mismatch（本地状态不匹配）', () => {
    test('本地状态 pr_number 不匹配时，应按 lock_id 查找并更新原始评论', async () => {
      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);

      // 2. 篡改本地状态（pr_number 错误）
      await agentA.corruptLocalState({ pr_number: 999 });

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
    }, 15000);

    test('本地状态 lock_id 不匹配时，应按 lock_id 查找并更新原始评论', async () => {
      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);
      const originalLockId = result.lock!.lock_id;

      // 2. 篡改本地状态（lock_id 错误）
      await agentA.corruptLocalState({ lock_id: 'wrong-lock-id' });

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
    }, 15000);
  });

  describe('场景 3: Local state missing（本地状态丢失）', () => {
    test('本地状态丢失时，应按 lock_id 查找并更新原始评论', async () => {
      // 1. Agent A 获取锁
      const result = await agentA.acquire(1, 5);
      expect(result.success).toBe(true);
      const lockId = result.lock!.lock_id;

      // 2. 删除本地状态
      await agentA.deleteLocalState();

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
    }, 15000);
  });

  describe('场景 3.5: Renew metadata cleanliness（续期元数据清洁性）', () => {
    test('renew() 应只写入基础字段，不包含派生字段', async () => {
      // 1. Agent A 获取锁
      const acquireResult = await agentA.acquire(1, 60);
      expect(acquireResult.success).toBe(true);
      const lockId = acquireResult.lock!.lock_id;

      // 2. Agent A 续期锁
      const renewResult = await agentA.renew(1, 30);
      expect(renewResult.success).toBe(true);
      expect(renewResult.lock!.lock_duration_minutes).toBe(90); // 60 + 30

      // 3. 验证评论中的元数据只包含基础字段
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

      // 4. 验证基础字段存在
      expect(metadata.lock_id).toBe(lockId);
      expect(metadata.agent_id).toBe('agent-a@test');
      expect(metadata.acquired_at).toBeDefined();
      expect(metadata.lock_duration_minutes).toBe(90);

      // 5. 验证派生字段不存在
      expect(metadata.expires_at).toBeUndefined();
      expect(metadata.remaining_minutes).toBeUndefined();
      expect(metadata.is_expired).toBeUndefined();
      expect(metadata.should_renew).toBeUndefined();
      expect(metadata.renew_reason).toBeUndefined();
      expect(metadata.pr_number).toBeUndefined();
      expect(metadata.pr_last_updated_at).toBeUndefined();

      // 6. 验证返回值包含正确的派生字段
      expect(renewResult.lock!.expires_at).toBeDefined();
      expect(renewResult.lock!.remaining_minutes).toBeGreaterThan(0);
      expect(renewResult.lock!.is_expired).toBe(false);
    }, 15000);
  });

  describe('场景 3.6: Release with no remote lock（远程锁不存在时释放）', () => {
    test('release() 在远程锁不存在时应清理本地状态', async () => {
      // 1. Agent A 获取锁
      const acquireResult = await agentA.acquire(1, 5);
      expect(acquireResult.success).toBe(true);

      // 2. 验证本地状态存在
      const localStateBefore = await agentA.loadLockState();
      expect(localStateBefore).toBeDefined();
      expect(localStateBefore!.pr_number).toBe(1);

      // 3. 手动移除远程锁标签（模拟远程锁被其他方式移除）
      await mockAPI.removeLabel(1, '🔒 locked');

      // 4. Agent A 尝试释放锁
      const releaseResult = await agentA.release(1);
      expect(releaseResult.success).toBe(true);

      // 5. 验证本地状态已被清理
      const localStateAfter = await agentA.loadLockState();
      expect(localStateAfter).toBeNull();
    }, 15000);
  });

  describe('场景 4: Force release（强制释放）', () => {
    test.skip('强制释放应更新元数据为 released: true', async () => {
      // TODO: 需要实现时间模拟
      // forceRelease() 依赖 checkLock() 判断锁是否过期
      // checkLock() 使用 Date.now() 而不是 mockAPI 的时间
      // 需要重构以支持时间注入
    });
  });
});
