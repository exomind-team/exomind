#!/usr/bin/env bun
/**
 * PR Lock Manager - 分布式锁机制
 *
 * 核心功能：
 * 1. 避免多个 Agent 同时推进一个 PR（竞争检测）
 * 2. Agent 崩溃时自动解锁（超时机制）
 *
 * 设计原理：
 * - 标签 🔒 locked 作为快速视觉标识
 * - Comment 中的 JSON 元数据存储锁信息
 * - 时间戳作为竞争仲裁依据（先到先得）
 * - 超时自动失效（无需主动释放）
 */

import { execSync } from 'child_process';
import { IGitHubAPI, RealGitHubAPI } from './pr-lock-api';

// ========== 常量定义 ==========
const LOCK_LABEL = '🔒 locked';  // 注意：保持空格以兼容历史锁
const LOCK_METADATA_MARKER = '<!-- LOCK_METADATA';

interface LockMetadata {
  lock_id: string;                // 唯一标识：lock-{timestamp}-{random}
  agent_id: string;               // Agent 标识
  worktree_path?: string;         // 工作目录路径
  branch?: string;                // Git 分支名
  acquired_at: string;            // 获取时间 ISO 8601
  lock_duration_minutes: number;  // 锁时长（分钟）
  task_id?: string;               // 关联任务 ID
  reason?: string;                // 锁定原因
  pending?: boolean;              // 是否为待确认状态（竞争检测前）
  released?: boolean;             // 是否已释放
  released_at?: string;           // 释放时间
}

interface LockState {
  lock_id: string;                // 锁 ID
  pr_number: number;              // PR 编号
  comment_id?: number;            // 评论 ID（用于编辑）
  acquired_at: string;            // 获取时间 ISO 8601
  lock_duration_minutes: number;  // 锁时长（分钟）
  pr_last_updated_at: string;     // PR 最后更新时间
  expires_at: string;             // 过期时间（动态计算）
}

interface LockStatus extends LockMetadata {
  pr_number: number;              // PR 编号
  pr_last_updated_at: string;     // PR 最后更新时间
  expires_at: string;             // 过期时间（动态计算）
  is_expired: boolean;            // 是否过期
  remaining_minutes: number;      // 剩余分钟数
}

interface LockResult {
  success: boolean;
  lock?: LockMetadata;
  error?: string;
  conflict?: {
    winner: string;
    loser: string;
  };
}

export class PRLockManager {
  private api: IGitHubAPI;

  constructor(
    private repo: string,      // "exomind-team/exomind"
    private agentId: string,   // "fixer@pr-draft-cleanup"
    api?: IGitHubAPI           // 可选：用于测试注入 mock
  ) {
    this.api = api || new RealGitHubAPI(repo);
  }

  // ========== Git 分支管理 ==========

  /**
   * 获取当前 Git 分支名
   */
  private getCurrentBranch(): string | undefined {
    try {
      return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    } catch {
      return undefined;
    }
  }

  // ========== 固定过期时间计算 ==========

  /**
   * 计算过期时间（固定时长，不受 PR 活动影响）
   *
   * expires_at = acquired_at + lock_duration
   *
   * 设计理由：
   * - 避免拒绝服务风险（非持锁者评论不应延长锁）
   * - 过期时间可预测
   * - 后续可通过显式 renew 命令延期
   */
  private calculateExpiresAt(acquiredAt: string, lockDurationMinutes: number): string {
    const acquired = new Date(acquiredAt);
    if (isNaN(acquired.getTime())) {
      console.warn(`[PRLock] Invalid acquired_at: ${acquiredAt}, using current time`);
      const now = new Date();
      return new Date(now.getTime() + lockDurationMinutes * 60 * 1000).toISOString();
    }
    const expiresAt = new Date(acquired.getTime() + lockDurationMinutes * 60 * 1000);
    return expiresAt.toISOString();
  }

  // ========== 本地锁文件管理 ==========

  /**
   * 保存锁状态到本地文件
   */
  private async saveLockState(
    prNumber: number,
    lock: LockMetadata,
    commentId?: number
  ): Promise<void> {
    const lockFile = '.exomind/lock-state.json';
    const contextDir = '.exomind';

    // 确保目录存在
    try {
      execSync(`mkdir -p ${contextDir}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('[PRLock] Failed to create .exomind directory:', e);
      return;
    }

    const lockState: LockState = {
      lock_id: lock.lock_id,
      pr_number: prNumber,
      comment_id: commentId,
      acquired_at: lock.acquired_at,
      lock_duration_minutes: lock.lock_duration_minutes,
      pr_last_updated_at: lock.acquired_at,  // 使用 acquired_at 作为基准时间
      expires_at: this.calculateExpiresAt(lock.acquired_at, lock.lock_duration_minutes)
    };

    try {
      // Node/Bun 兼容：使用 fs.writeFileSync
      const fs = await import('fs');
      fs.writeFileSync(lockFile, JSON.stringify(lockState, null, 2), 'utf-8');
      console.log(`[PRLock] Lock state saved to ${lockFile}`);
    } catch (e) {
      console.warn('[PRLock] Failed to save lock state:', e);
    }
  }

  /**
   * 读取本地锁状态
   */
  private async loadLockState(): Promise<LockState | null> {
    const lockFile = '.exomind/lock-state.json';

    try {
      // Node/Bun 兼容：使用 fs.existsSync 和 fs.readFileSync
      const fs = await import('fs');
      if (!fs.existsSync(lockFile)) {
        return null;
      }

      const content = fs.readFileSync(lockFile, 'utf-8');
      const lockState = JSON.parse(content) as LockState;
      return lockState;
    } catch (e) {
      console.warn('[PRLock] Failed to load lock state:', e);
      return null;
    }
  }

  /**
   * 删除本地锁文件
   */
  private async deleteLockState(): Promise<void> {
    const lockFile = '.exomind/lock-state.json';

    try {
      execSync(`rm -f ${lockFile}`, { stdio: 'ignore' });
      console.log('[PRLock] Lock state deleted');
    } catch (e) {
      console.warn('[PRLock] Failed to delete lock state:', e);
    }
  }

  /**
   * 更新本地锁状态
   */
  private async updateLockState(
    acquiredAt: string,
    lockDurationMinutes: number
  ): Promise<void> {
    const lockState = await this.loadLockState();
    if (!lockState) {
      return;
    }

    lockState.pr_last_updated_at = acquiredAt;
    lockState.expires_at = this.calculateExpiresAt(acquiredAt, lockDurationMinutes);

    const lockFile = '.exomind/lock-state.json';
    try {
      // Node/Bun 兼容：使用 fs.writeFileSync
      const fs = await import('fs');
      fs.writeFileSync(lockFile, JSON.stringify(lockState, null, 2), 'utf-8');
      console.log('[PRLock] Lock state updated');
    } catch (e) {
      console.warn('[PRLock] Failed to update lock state:', e);
    }
  }

  /**
   * 尝试获取 PR 锁
   *
   * 流程：
   * 1. 检查是否已有锁
   * 2. 如果有锁且未过期，返回失败
   * 3. 如果有锁但已过期，强制释放
   * 4. 添加标签 + 创建/更新 Comment
   * 5. 重新检查 timeline，检测竞争条件
   * 6. 如果有竞争，比较时间戳，较晚的主动放弃
   * 7. 保存本地锁文件
   */
  async acquire(
    prNumber: number,
    timeoutMinutes: number,
    options?: { worktreePath?: string; branch?: string; taskId?: string; reason?: string }
  ): Promise<LockResult> {
    console.log(`[PRLock] Agent ${this.agentId} attempting to acquire lock on PR #${prNumber}`);

    // 1. 检查是否已有锁（动态计算过期状态）
    const existingLock = await this.checkLock(prNumber);

    if (existingLock && !existingLock.is_expired) {
      // 锁未过期，获取失败
      console.log(`[PRLock] PR #${prNumber} is locked by ${existingLock.agent_id}, expires in ${existingLock.remaining_minutes} minutes`);
      return {
        success: false,
        error: `PR #${prNumber} is locked by ${existingLock.agent_id} until ${existingLock.expires_at} (${existingLock.remaining_minutes} minutes remaining)`
      };
    }

    if (existingLock && existingLock.is_expired) {
      // 锁已过期，强制释放
      console.log(`[PRLock] Existing lock on PR #${prNumber} has expired, force releasing`);
      await this.forceRelease(prNumber, existingLock);
    }

    // 2. 生成锁元数据（pending 状态）
    const now = new Date();
    const branch = options?.branch || this.getCurrentBranch();
    const lock: LockMetadata = {
      lock_id: `lock-${now.getTime()}-${Math.random().toString(36).substr(2, 9)}`,
      agent_id: this.agentId,
      worktree_path: options?.worktreePath,
      branch: branch,
      acquired_at: now.toISOString(),
      lock_duration_minutes: timeoutMinutes,
      task_id: options?.taskId,
      reason: options?.reason,
      pending: true  // 标记为待确认，竞争检测通过后才确认
    };

    // 3. 添加锁标签
    console.log(`[PRLock] Adding lock label to PR #${prNumber}`);
    await this.addLabel(prNumber, LOCK_LABEL);

    // 4. 创建/更新锁元数据 Comment
    console.log(`[PRLock] Creating/updating lock comment with metadata`);
    const commentId = await this.updateLockComment(prNumber, lock);

    // 5. 等待 GitHub API 同步（避免 race condition）
    await this.sleep(2000);

    // 6. 重新检查 timeline，检测竞争条件
    console.log(`[PRLock] Checking for race conditions`);
    const conflictCheck = await this.detectConflict(prNumber, lock);

    if (conflictCheck.hasConflict) {
      // 发现竞争，主动放弃
      console.log(`[PRLock] Race condition detected! ${conflictCheck.winner} won, ${conflictCheck.loser} backing off`);

      // 败者需要将自己的锁元数据标记为 released: true
      // 避免污染后续的 checkLock() 判定
      if (commentId) {
        console.log(`[PRLock] Marking loser's lock metadata as released (comment ${commentId})`);
        const releasedLock: LockMetadata = {
          ...lock,
          released: true,
          released_at: new Date().toISOString()
        };
        await this.updateLockCommentWithRelease(prNumber, commentId, releasedLock);
      }

      // 注意：败者不应移除锁标签，标签由赢家持有
      // 败者创建一个说明评论
      await this.createComment(prNumber,
        `🔓 **锁竞争检测**\n\n` +
        `检测到多个 Agent 同时尝试获取锁：\n` +
        `- 胜者：\`${conflictCheck.winner}\`\n` +
        `- 败者：\`${conflictCheck.loser}\`（已主动放弃）\n\n` +
        `根据时间戳仲裁，\`${conflictCheck.winner}\` 获得锁。`
      );

      return {
        success: false,
        error: `Race condition detected, ${conflictCheck.winner} acquired the lock first`,
        conflict: {
          winner: conflictCheck.winner!,
          loser: conflictCheck.loser!
        }
      };
    }

    console.log(`[PRLock] Lock acquired successfully: ${lock.lock_id}`);

    // 7. 确认锁（移除 pending 标记）
    const confirmedLock: LockMetadata = {
      ...lock,
      pending: undefined  // 移除 pending 标记
    };
    await this.updateLockCommentWithConfirm(prNumber, commentId, confirmedLock);

    // 8. 保存本地锁文件
    await this.saveLockState(prNumber, confirmedLock, commentId);

    return { success: true, lock: confirmedLock };
  }

  /**
   * 释放锁（编辑评论标记为已释放）
   */
  async release(prNumber: number): Promise<LockResult> {
    console.log(`[PRLock] Releasing lock on PR #${prNumber}`);

    const lock = await this.checkLock(prNumber);

    if (!lock) {
      console.log(`[PRLock] No lock found, nothing to release`);
      return { success: true };  // 已经没有锁了，视为成功
    }

    if (lock.agent_id !== this.agentId) {
      return {
        success: false,
        error: `Lock is held by ${lock.agent_id}, not ${this.agentId}`
      };
    }

    // 移除锁标签
    await this.removeLabel(prNumber, LOCK_LABEL);

    // 更新锁元数据：标记为已释放
    const releasedLock: LockMetadata = {
      ...lock,
      released: true,
      released_at: new Date().toISOString()
    };

    // 编辑评论标记为已释放
    const localLockState = await this.loadLockState();
    let commentUpdated = false;

    // 优先使用本地状态中的 comment_id
    if (localLockState?.comment_id &&
        localLockState.pr_number === prNumber &&
        localLockState.lock_id === lock.lock_id) {
      await this.updateLockCommentWithRelease(prNumber, localLockState.comment_id, releasedLock);
      commentUpdated = true;
    } else {
      // 本地状态不匹配或缺失，按 lock_id 查找原始评论
      console.warn(`[PRLock] Local state unavailable or mismatch, searching for original comment by lock_id`);
      const originalCommentId = await this.findCommentByLockId(prNumber, lock.lock_id);

      if (originalCommentId) {
        // 找到原始评论，更新为已释放
        await this.updateLockCommentWithRelease(prNumber, originalCommentId, releasedLock);
        commentUpdated = true;
      } else {
        // 极端情况：找不到原始评论（可能已被删除），创建新评论
        console.warn(`[PRLock] Original comment not found for lock_id ${lock.lock_id}, creating new release comment`);
        await this.createComment(prNumber,
          `🔓 **锁已释放**\n\n` +
          `- 持有者：\`${lock.agent_id}\`\n` +
          `- 锁 ID：\`${lock.lock_id}\`\n` +
          `- 获取时间：${lock.acquired_at}\n` +
          `- 释放时间：${releasedLock.released_at}\n` +
          (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
          `\n⚠️ 注意：原始锁评论未找到，可能已被删除。`
        );
      }
    }

    console.log(`[PRLock] Lock released successfully`);

    // 删除本地锁文件
    await this.deleteLockState();

    return { success: true };
  }

  /**
   * 续期锁（延长过期时间）
   *
   * 设计理由：
   * - Agent 长时间工作时需要主动续期，避免锁过期被其他 Agent 误获取
   * - 续期比"过期后重新获取"更安全：
   *   1. 避免竞争窗口：过期瞬间其他 Agent 可能获取锁
   *   2. 保持锁的连续性：lock_id 不变，便于追踪
   *   3. 降低 DDOS 风险：相比频繁重新获取，续期操作更轻量
   *
   * @param prNumber PR 编号
   * @param additionalMinutes 额外延长的分钟数（正数）
   * @returns 续期结果
   */
  async renew(prNumber: number, additionalMinutes: number): Promise<LockResult> {
    console.log(`[PRLock] Renewing lock on PR #${prNumber} for ${additionalMinutes} minutes`);

    // 验证参数
    if (additionalMinutes <= 0) {
      return {
        success: false,
        error: `additionalMinutes must be positive, got: ${additionalMinutes}`
      };
    }

    // 检查当前锁状态
    const lock = await this.checkLock(prNumber);

    if (!lock) {
      return {
        success: false,
        error: 'No lock found to renew'
      };
    }

    // 验证锁的所有权
    if (lock.agent_id !== this.agentId) {
      return {
        success: false,
        error: `Lock is held by ${lock.agent_id}, not ${this.agentId}`
      };
    }

    // 检查锁是否已过期
    if (lock.is_expired) {
      return {
        success: false,
        error: `Lock has expired ${Math.abs(lock.remaining_minutes)} minutes ago, cannot renew. Use acquire() to get a new lock.`
      };
    }

    // 计算新的锁时长
    const newDurationMinutes = lock.lock_duration_minutes + additionalMinutes;

    // 更新锁元数据
    const renewedLock: LockMetadata = {
      ...lock,
      lock_duration_minutes: newDurationMinutes
    };

    // 查找原始评论并更新
    const localLockState = await this.loadLockState();
    let commentUpdated = false;

    // 优先使用本地状态中的 comment_id
    if (localLockState?.comment_id &&
        localLockState.pr_number === prNumber &&
        localLockState.lock_id === lock.lock_id) {
      await this.updateLockCommentWithConfirm(prNumber, localLockState.comment_id, renewedLock);
      commentUpdated = true;
    } else {
      // 本地状态不匹配或缺失，按 lock_id 查找原始评论
      console.warn(`[PRLock] Local state unavailable or mismatch, searching for original comment by lock_id`);
      const originalComment = await this.findCommentByLockId(prNumber, lock.lock_id);

      if (originalComment) {
        await this.updateLockCommentWithConfirm(prNumber, originalComment.id, renewedLock);
        commentUpdated = true;
      } else {
        return {
          success: false,
          error: `Cannot find original comment for lock_id ${lock.lock_id}`
        };
      }
    }

    // 更新本地锁状态
    const newExpiresAt = this.calculateExpiresAt(lock.acquired_at, newDurationMinutes);
    await this.saveLockState({
      lock_id: lock.lock_id,
      pr_number: prNumber,
      comment_id: localLockState?.comment_id,
      acquired_at: lock.acquired_at,
      lock_duration_minutes: newDurationMinutes,
      pr_last_updated_at: lock.pr_last_updated_at,
      expires_at: newExpiresAt
    });

    console.log(`[PRLock] Lock renewed successfully, new duration: ${newDurationMinutes} minutes, expires at: ${newExpiresAt}`);

    return {
      success: true,
      lock: renewedLock
    };
  }

  /**
   * 强制释放过期锁
   */
  async forceRelease(prNumber: number, oldLock?: LockStatus): Promise<void> {
    if (!oldLock) {
      const lock = await this.checkLock(prNumber);
      if (!lock) {
        console.log(`[PRLock] No lock found, nothing to force release`);
        return;
      }
      if (!lock.is_expired) {
        throw new Error(`Cannot force release: lock is not expired (${lock.remaining_minutes} minutes remaining)`);
      }
      oldLock = lock;
    }

    // 查找原始锁评论并标记为 released
    const originalComment = await this.findCommentByLockId(prNumber, oldLock.lock_id);
    if (originalComment) {
      const metadata: LockMetadata = {
        ...oldLock,
        released: true,
        released_at: new Date().toISOString()
      };
      await this.updateLockCommentWithRelease(prNumber, originalComment.id, metadata);
    }

    await this.removeLabel(prNumber, LOCK_LABEL);

    await this.createComment(prNumber,
      `🔓 **锁已超时释放**\n\n` +
      `- 原持有者：\`${oldLock.agent_id}\`\n` +
      `- 获取时间：${oldLock.acquired_at}\n` +
      `- 过期时间：${oldLock.expires_at}\n` +
      `- 超时原因：锁已过期 ${oldLock.lock_duration_minutes} 分钟，自动释放\n\n` +
      `锁现在可以被其他 Agent 获取。`
    );

    console.log(`[PRLock] Lock force released successfully`);
  }

  /**
   * 检查 PR 是否被锁定（返回固定过期时间的锁状态）
   */
  async checkLock(prNumber: number): Promise<LockStatus | null> {
    // 1. 检查是否有 🔒 locked 标签
    let labels;
    try {
      labels = await this.getLabels(prNumber);
    } catch (e) {
      // PR 不存在或无法访问
      console.warn(`[PRLock] Failed to get labels for PR #${prNumber}:`, e);
      return null;
    }
    const hasLock = labels.includes(LOCK_LABEL);

    if (!hasLock) {
      return null;
    }

    // 2. 查找最新的有效锁元数据 Comment（过滤掉已释放和待确认的锁）
    const comments = await this.getComments(prNumber);
    const lockComment = comments
      .reverse()  // 从最新开始
      .find((c: any) => {
        if (!c.body?.includes('<!-- LOCK_METADATA')) {
          return false;
        }
        // 解析元数据，检查是否已释放或待确认
        const match = c.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
        if (!match) {
          return false;
        }
        try {
          const metadata: LockMetadata = JSON.parse(match[1]);
          // 过滤掉已释放的锁和待确认的锁
          return !metadata.released && !metadata.pending;
        } catch (e) {
          return false;
        }
      });

    if (!lockComment) {
      console.warn(`[PRLock] PR #${prNumber} has lock label but no metadata comment (orphaned lock)`);
      return null;
    }

    // 3. 解析元数据
    const match = lockComment.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
    if (!match) {
      return null;
    }

    let lockMetadata: LockMetadata;
    try {
      lockMetadata = JSON.parse(match[1]);
    } catch (e) {
      console.error('[PRLock] Failed to parse lock metadata:', e);
      return null;
    }

    // 4. 计算固定过期时间（acquired_at + lock_duration）
    const expiresAt = this.calculateExpiresAt(lockMetadata.acquired_at, lockMetadata.lock_duration_minutes);

    // 5. 判断是否过期
    const now = new Date();
    const expiresAtDate = new Date(expiresAt);
    const isExpired = now >= expiresAtDate;
    const remainingMinutes = Math.max(0, Math.ceil((expiresAtDate.getTime() - now.getTime()) / 60000));

    // 6. 如果本地有锁文件，更新本地状态
    const localLockState = await this.loadLockState();
    if (localLockState && localLockState.lock_id === lockMetadata.lock_id) {
      await this.updateLockState(lockMetadata.acquired_at, lockMetadata.lock_duration_minutes);
    }

    return {
      ...lockMetadata,
      pr_number: prNumber,
      pr_last_updated_at: lockMetadata.acquired_at,  // 使用 acquired_at 作为基准时间
      expires_at: expiresAt,
      is_expired: isExpired,
      remaining_minutes: remainingMinutes
    };
  }

  /**
   * 检测竞争条件
   *
   * 原理：
   * 1. 查询 PR timeline 中所有的 lock comment
   * 2. 找出时间戳最早的 lock comment
   * 3. 如果不是自己，说明有竞争，自己是败者
   */
  /**
   * 检测竞争条件
   *
   * 原理：
   * 1. 查询 PR timeline 中所有的 lock comment
   * 2. 过滤竞争窗口内的锁评论（最近 10 秒）
   * 3. 过滤掉已释放的锁（released: true）
   * 4. 检查是否有其他不同的 lock_id（不依赖评论数量）
   * 5. 如果有其他锁，按时间戳排序，找出最早的锁
   * 6. 如果不是自己，说明有竞争，自己是败者
   */
  private async detectConflict(
    prNumber: number,
    myLock: LockMetadata
  ): Promise<{ hasConflict: boolean; winner?: string; loser?: string }> {
    const comments = await this.getComments(prNumber);

    // 竞争窗口：最近 10 秒内的锁评论
    const competitionWindowMs = 10 * 1000;
    const myLockTime = parseInt(myLock.lock_id.split('-')[1]);
    const windowStart = myLockTime - competitionWindowMs;
    const windowEnd = myLockTime + competitionWindowMs;

    // 找出所有包含 LOCK_METADATA 的 comment
    const lockComments = comments
      .filter((c: any) => c.body?.includes(LOCK_METADATA_MARKER))
      .map((c: any) => {
        const match = c.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
        if (!match) return null;
        try {
          const metadata = JSON.parse(match[1]);
          return {
            ...metadata,
            comment_created_at: c.createdAt
          };
        } catch {
          return null;
        }
      })
      .filter((m: any) => {
        if (!m) return false;
        // 过滤掉已释放的锁
        if (m.released) return false;
        // 只保留竞争窗口内的锁
        const lockTime = parseInt(m.lock_id.split('-')[1]);
        return lockTime >= windowStart && lockTime <= windowEnd;
      });

    // 检查是否有其他不同的 lock_id（不依赖评论数量）
    const otherLocks = lockComments.filter((lock: any) => lock.lock_id !== myLock.lock_id);

    if (otherLocks.length === 0) {
      // 竞争窗口内没有其他锁，没有竞争
      return { hasConflict: false };
    }

    // 有其他锁，按 GitHub createdAt 排序（真相源）
    // 使用 GitHub timeline 而非本地时钟，避免时钟偏移导致的误判
    const allLocks = [...lockComments];
    allLocks.sort((a: any, b: any) => {
      // 优先使用 GitHub createdAt（ISO 8601 字符串可直接比较）
      const aCreated = a.comment_created_at;
      const bCreated = b.comment_created_at;
      if (aCreated !== bCreated) {
        return aCreated < bCreated ? -1 : 1;
      }
      // 如果 createdAt 相同（极少见），使用 lock_id 作为 tie-breaker
      const aTime = parseInt(a.lock_id.split('-')[1]);
      const bTime = parseInt(b.lock_id.split('-')[1]);
      return aTime - bTime;
    });

    const winner = allLocks[0];

    if (winner.lock_id === myLock.lock_id) {
      // 自己是胜者，没有冲突
      return { hasConflict: false };
    }

    // 自己是败者，有冲突
    return {
      hasConflict: true,
      winner: winner.agent_id,
      loser: this.agentId
    };
  }

  // ========== GitHub API 封装 ==========

  private async addLabel(prNumber: number, label: string): Promise<void> {
    await this.api.addLabel(prNumber, label);
  }

  private async removeLabel(prNumber: number, label: string): Promise<void> {
    await this.api.removeLabel(prNumber, label);
  }

  private async getLabels(prNumber: number): Promise<string[]> {
    return await this.api.getLabels(prNumber);
  }

  private async getComments(prNumber: number): Promise<any[]> {
    return await this.api.getComments(prNumber);
  }

  private async createComment(prNumber: number, body: string): Promise<number | undefined> {
    return await this.api.createComment(prNumber, body);
  }

  /**
   * 编辑评论
   */
  private async updateComment(prNumber: number, commentId: number, body: string): Promise<void> {
    await this.api.updateComment(prNumber, commentId, body);
  }

  /**
   * 创建锁评论（总是创建新评论，不复用旧评论）
   *
   * 修复并发覆盖问题：
   * - 并发 A/B 如果复用同一条评论，较晚写入会覆盖较早写入
   * - detectConflict 只能看到最终那一份元数据
   * - 总是创建新评论，确保每个 Agent 都有独立的锁记录
   *
   * 修复 comment_id 归属竞态：
   * - 通过 createComment 返回值直接获取评论 ID
   * - 避免"取最新评论"导致的 ID 错配
   *
   * 返回评论 ID
   */
  private async updateLockComment(prNumber: number, lock: LockMetadata): Promise<number | undefined> {
    const expiresAt = this.calculateExpiresAt(lock.acquired_at, lock.lock_duration_minutes);
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔒 **PR 已被锁定**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      (lock.branch ? `- Git 分支：\`${lock.branch}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      `- 过期时间：${expiresAt}\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '');

    // 总是创建新评论（不复用旧评论）
    console.log(`[PRLock] Creating new lock comment for ${lock.agent_id}`);
    const commentId = await this.createComment(prNumber, body);
    return commentId;
  }

  /**
   * 更新锁评论为确认状态（移除 pending 标记）
   */
  private async updateLockCommentWithConfirm(
    prNumber: number,
    commentId: number,
    lock: LockMetadata
  ): Promise<void> {
    const expiresAt = this.calculateExpiresAt(lock.acquired_at, lock.lock_duration_minutes);
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔒 **PR 已被锁定**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      (lock.branch ? `- Git 分支：\`${lock.branch}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      `- 过期时间：${expiresAt}\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '');

    await this.updateComment(prNumber, commentId, body);
  }

  /**
   * 更新锁评论为已释放状态
   */
  private async updateLockCommentWithRelease(
    prNumber: number,
    commentId: number,
    lock: LockMetadata
  ): Promise<void> {
    const expiresAt = this.calculateExpiresAt(lock.acquired_at, lock.lock_duration_minutes);
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔓 **锁已释放**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      (lock.branch ? `- Git 分支：\`${lock.branch}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      `- 过期时间：${expiresAt}\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '') +
      `- 释放时间：${lock.released_at}\n`;

    await this.updateComment(prNumber, commentId, body);
  }

  private async createLockComment(prNumber: number, lock: LockMetadata): Promise<void> {
    const expiresAt = this.calculateExpiresAt(lock.acquired_at, lock.lock_duration_minutes);
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔒 **PR 已被锁定**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      `- 过期时间：${expiresAt}\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '');

    await this.createComment(prNumber, body);
  }

  /**
   * 按 lock_id 查找评论 ID
   * 用于降级路径：当本地状态丢失时，仍能找到原始评论并更新
   */
  private async findCommentByLockId(prNumber: number, lockId: string): Promise<number | null> {
    const comments = await this.getComments(prNumber);

    for (const comment of comments) {
      if (!comment.body?.includes('<!-- LOCK_METADATA')) {
        continue;
      }

      const match = comment.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
      if (!match) {
        continue;
      }

      try {
        const metadata: LockMetadata = JSON.parse(match[1]);
        if (metadata.lock_id === lockId) {
          return comment.id;
        }
      } catch (e) {
        // 解析失败，跳过
        continue;
      }
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========== 测试辅助方法 ==========

  /**
   * 测试辅助：篡改本地状态
   * 用于测试降级路径
   */
  async corruptLocalState(corruption: Partial<LockState>): Promise<void> {
    const lockFile = '.exomind/lock-state.json';
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(lockFile, 'utf-8');
      const state: LockState = JSON.parse(content);
      const corruptedState = { ...state, ...corruption };
      fs.writeFileSync(lockFile, JSON.stringify(corruptedState, null, 2), 'utf-8');
      console.log('[PRLock] Local state corrupted for testing');
    } catch (e) {
      console.warn('[PRLock] Failed to corrupt local state:', e);
    }
  }

  /**
   * 测试辅助：删除本地状态
   * 用于测试降级路径
   */
  async deleteLocalState(): Promise<void> {
    const lockFile = '.exomind/lock-state.json';
    try {
      const fs = await import('fs');
      fs.unlinkSync(lockFile);
      console.log('[PRLock] Local state deleted for testing');
    } catch (e) {
      console.warn('[PRLock] Failed to delete local state:', e);
    }
  }
}

// ========== CLI 工具 ==========

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
Usage:
  bun pr-lock.ts <command> [args...]
  # 如果 bun 不可用，可以使用：
  npx tsx pr-lock.ts <command> [args...]
  node --loader ts-node/esm pr-lock.ts <command> [args...]

Commands:
  acquire <pr-number> <timeout-minutes> <agent-id> [--worktree-path=<path>] [--task-id=X] [--reason="..."]
  check <pr-number>
  release <pr-number> <agent-id>
  renew <pr-number> <additional-minutes> <agent-id>
  force-release <pr-number>

Examples:
  bun pr-lock.ts acquire 419 60 fixer@team --worktree-path="exomind-worktree-pr-419" --task-id=4 --reason="修复 TypeScript 类型错误"
  npx tsx pr-lock.ts check 419
  bun pr-lock.ts release 419 fixer@team
  npx tsx pr-lock.ts renew 419 30 fixer@team
  bun pr-lock.ts force-release 419
    `);
    process.exit(1);
  }

  const repo = 'exomind-team/exomind';

  switch (command) {
    case 'acquire': {
      const prNumber = parseInt(args[1]);
      const timeoutMinutes = parseInt(args[2]);
      const agentId = args[3] || 'manual-cli';

      // 验证 timeoutMinutes 必须为正数
      if (isNaN(timeoutMinutes) || timeoutMinutes <= 0) {
        console.error(`Error: timeout-minutes must be a positive number, got: ${args[2]}`);
        process.exit(1);
      }

      const worktreePath = args.find(a => a.startsWith('--worktree-path='))?.split('=')[1];
      const taskId = args.find(a => a.startsWith('--task-id='))?.split('=')[1];
      const reason = args.find(a => a.startsWith('--reason='))?.split('=')[1];

      const lockManager = new PRLockManager(repo, agentId);
      const result = await lockManager.acquire(prNumber, timeoutMinutes, { worktreePath, taskId, reason });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    case 'check': {
      const prNumber = parseInt(args[1]);
      const agentId = 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const lock = await lockManager.checkLock(prNumber);
      if (lock) {
        console.log(JSON.stringify(lock, null, 2));
      } else {
        console.log('No lock found');
      }
      process.exit(0);
    }

    case 'release': {
      const prNumber = parseInt(args[1]);
      const agentId = args[2] || 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const result = await lockManager.release(prNumber);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    case 'renew': {
      const prNumber = parseInt(args[1]);
      const additionalMinutes = parseInt(args[2]);
      const agentId = args[3] || 'manual-cli';

      // 验证 additionalMinutes 必须为正数
      if (isNaN(additionalMinutes) || additionalMinutes <= 0) {
        console.error(`Error: additional-minutes must be a positive number, got: ${args[2]}`);
        process.exit(1);
      }

      const lockManager = new PRLockManager(repo, agentId);
      const result = await lockManager.renew(prNumber, additionalMinutes);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    case 'force-release': {
      const prNumber = parseInt(args[1]);
      const agentId = 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      try {
        await lockManager.forceRelease(prNumber);
        console.log(JSON.stringify({ success: true }, null, 2));
        process.exit(0);
      } catch (e) {
        console.error(JSON.stringify({ success: false, error: (e as Error).message }, null, 2));
        process.exit(1);
      }
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}
