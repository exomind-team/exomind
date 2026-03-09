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

// ========== 常量定义 ==========
const LOCK_LABEL = '🔒locked';
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
  constructor(
    private repo: string,      // "exomind-team/exomind"
    private agentId: string    // "fixer@pr-draft-cleanup"
  ) {}

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

  // ========== 动态过期时间计算 ==========

  /**
   * 获取 PR 最后更新时间
   *
   * 包含：
   * - 最后一次 commit 时间
   * - 最后一次 comment 时间
   *
   * 取两者中较晚的时间
   */
  private async getPRLastUpdatedAt(prNumber: number): Promise<string> {
    let lastCommitTime: Date | null = null;
    let lastCommentTime: Date | null = null;

    // 获取最后一次 commit 时间
    try {
      const commits = execSync(`gh api repos/${this.repo}/pulls/${prNumber}/commits --jq '.[].commit.committer.date'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const commitTimes = commits.trim().split('\n').filter(t => t);
      if (commitTimes.length > 0) {
        lastCommitTime = new Date(commitTimes[commitTimes.length - 1]);
      }
    } catch (e) {
      console.warn('[PRLock] Failed to get commit times:', e);
    }

    // 获取最后一次 comment 时间
    try {
      const comments = await this.getComments(prNumber);
      if (comments.length > 0) {
        lastCommentTime = new Date(comments[comments.length - 1].createdAt);
      }
    } catch (e) {
      console.warn('[PRLock] Failed to get comment times:', e);
    }

    // 取两者中较晚的时间
    const times = [lastCommitTime, lastCommentTime].filter(t => t !== null && !isNaN(t.getTime())) as Date[];
    if (times.length === 0) {
      // 如果都获取失败，使用当前时间
      console.warn('[PRLock] No valid timestamps found, using current time');
      return new Date().toISOString();
    }

    const latestTime = new Date(Math.max(...times.map(t => t.getTime())));
    if (isNaN(latestTime.getTime())) {
      console.warn('[PRLock] Invalid latest time, using current time');
      return new Date().toISOString();
    }
    return latestTime.toISOString();
  }

  /**
   * 计算过期时间
   *
   * expires_at = pr_last_updated_at + lock_duration
   */
  private calculateExpiresAt(prLastUpdatedAt: string, lockDurationMinutes: number): string {
    const lastUpdated = new Date(prLastUpdatedAt);
    if (isNaN(lastUpdated.getTime())) {
      console.warn(`[PRLock] Invalid date: ${prLastUpdatedAt}, using current time`);
      const now = new Date();
      return new Date(now.getTime() + lockDurationMinutes * 60 * 1000).toISOString();
    }
    const expiresAt = new Date(lastUpdated.getTime() + lockDurationMinutes * 60 * 1000);
    return expiresAt.toISOString();
  }

  // ========== 本地锁文件管理 ==========

  /**
   * 保存锁状态到本地文件
   */
  private async saveLockState(
    prNumber: number,
    lock: LockMetadata,
    prLastUpdatedAt: string,
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
      pr_last_updated_at: prLastUpdatedAt,
      expires_at: this.calculateExpiresAt(prLastUpdatedAt, lock.lock_duration_minutes)
    };

    try {
      await Bun.write(lockFile, JSON.stringify(lockState, null, 2));
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
      const file = Bun.file(lockFile);
      if (!(await file.exists())) {
        return null;
      }

      const lockState = await file.json() as LockState;
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
    prLastUpdatedAt: string,
    lockDurationMinutes: number
  ): Promise<void> {
    const lockState = await this.loadLockState();
    if (!lockState) {
      return;
    }

    lockState.pr_last_updated_at = prLastUpdatedAt;
    lockState.expires_at = this.calculateExpiresAt(prLastUpdatedAt, lockDurationMinutes);

    const lockFile = '.exomind/lock-state.json';
    try {
      await Bun.write(lockFile, JSON.stringify(lockState, null, 2));
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

    // 2. 生成锁元数据
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
      reason: options?.reason
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
      // 注意：败者不应移除锁标签，标签由赢家持有
      // 败者只需要创建一个说明评论
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

    // 7. 保存本地锁文件
    const prLastUpdatedAt = await this.getPRLastUpdatedAt(prNumber);
    await this.saveLockState(prNumber, lock, prLastUpdatedAt, commentId);

    return { success: true, lock };
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
    if (localLockState?.comment_id) {
      await this.updateLockCommentWithRelease(prNumber, localLockState.comment_id, releasedLock);
    } else {
      // 如果没有本地锁文件，创建新评论
      await this.createComment(prNumber,
        `🔓 **锁已释放**\n\n` +
        `- 持有者：\`${lock.agent_id}\`\n` +
        `- 获取时间：${lock.acquired_at}\n` +
        `- 释放时间：${releasedLock.released_at}\n` +
        (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
        `\nPR 现在可以被其他 Agent 处理。`
      );
    }

    console.log(`[PRLock] Lock released successfully`);

    // 删除本地锁文件
    await this.deleteLockState();

    return { success: true };
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
   * 检查 PR 是否被锁定（返回动态计算的锁状态）
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
    const hasLock = labels.some((l: any) => l.name === LOCK_LABEL);

    if (!hasLock) {
      return null;
    }

    // 2. 查找最新的锁元数据 Comment
    const comments = await this.getComments(prNumber);
    const lockComment = comments
      .reverse()  // 从最新开始
      .find((c: any) => c.body?.includes('<!-- LOCK_METADATA'));

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

    // 4. 获取 PR 最后更新时间
    const prLastUpdatedAt = await this.getPRLastUpdatedAt(prNumber);

    // 5. 动态计算过期时间
    const expiresAt = this.calculateExpiresAt(prLastUpdatedAt, lockMetadata.lock_duration_minutes);

    // 6. 判断是否过期
    const now = new Date();
    const expiresAtDate = new Date(expiresAt);
    const isExpired = now >= expiresAtDate;
    const remainingMinutes = Math.max(0, Math.ceil((expiresAtDate.getTime() - now.getTime()) / 60000));

    // 7. 如果本地有锁文件，更新本地状态
    const localLockState = await this.loadLockState();
    if (localLockState && localLockState.lock_id === lockMetadata.lock_id) {
      await this.updateLockState(prLastUpdatedAt, lockMetadata.lock_duration_minutes);
    }

    return {
      ...lockMetadata,
      pr_number: prNumber,
      pr_last_updated_at: prLastUpdatedAt,
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

    // 有其他锁，按 lock_id 中的时间戳排序（lock_id 格式：lock-{timestamp}-{random}）
    const allLocks = [...lockComments];
    allLocks.sort((a: any, b: any) => {
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
    this.gh(`issue edit ${prNumber} --add-label "${label}"`);
  }

  private async removeLabel(prNumber: number, label: string): Promise<void> {
    this.gh(`issue edit ${prNumber} --remove-label "${label}"`);
  }

  private async getLabels(prNumber: number): Promise<any[]> {
    const result = this.gh(`issue view ${prNumber} --json labels`);
    return JSON.parse(result).labels;
  }

  private async getComments(prNumber: number): Promise<any[]> {
    const result = this.gh(`issue view ${prNumber} --json comments`);
    return JSON.parse(result).comments;
  }

  private async createComment(prNumber: number, body: string): Promise<void> {
    // 使用临时文件避免 shell 转义问题
    const tempDir = '.exomind/temp';
    try {
      execSync(`mkdir -p ${tempDir}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('[PRLock] Failed to create temp directory:', e);
    }
    const tmpFile = `${tempDir}/pr-lock-comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.md`;
    await Bun.write(tmpFile, body);
    try {
      this.gh(`issue comment ${prNumber} --body-file ${tmpFile}`);
    } finally {
      execSync(`rm -f ${tmpFile}`, { stdio: 'ignore' });
    }
  }

  /**
   * 编辑评论
   */
  private async updateComment(prNumber: number, commentId: number, body: string): Promise<void> {
    // 使用临时文件避免 shell 转义问题
    const tempDir = '.exomind/temp';
    try {
      execSync(`mkdir -p ${tempDir}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('[PRLock] Failed to create temp directory:', e);
    }
    const tmpFile = `${tempDir}/pr-lock-comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.md`;
    await Bun.write(tmpFile, body);
    try {
      // 使用 -F body=@file 让 gh CLI 自动处理 JSON 封装
      execSync(`gh api repos/${this.repo}/issues/comments/${commentId} -X PATCH -F body=@${tmpFile}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } finally {
      execSync(`rm -f ${tmpFile}`, { stdio: 'ignore' });
    }
  }

  /**
   * 创建锁评论（总是创建新评论，不复用旧评论）
   *
   * 修复并发覆盖问题：
   * - 并发 A/B 如果复用同一条评论，较晚写入会覆盖较早写入
   * - detectConflict 只能看到最终那一份元数据
   * - 总是创建新评论，确保每个 Agent 都有独立的锁记录
   *
   * 返回评论 ID
   */
  private async updateLockComment(prNumber: number, lock: LockMetadata): Promise<number | undefined> {
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔒 **PR 已被锁定**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      (lock.branch ? `- Git 分支：\`${lock.branch}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '') +
      `\n**过期时间动态计算：**\n` +
      `过期时间 = PR 最后更新时间 + ${lock.lock_duration_minutes} 分钟\n` +
      `每次提交或评论后，锁自动延期。`;

    // 总是创建新评论（不复用旧评论）
    console.log(`[PRLock] Creating new lock comment for ${lock.agent_id}`);
    await this.createComment(prNumber, body);

    // 获取刚创建的评论 ID
    const updatedComments = await this.getComments(prNumber);
    const newComment = updatedComments[updatedComments.length - 1];
    return newComment?.id;
  }

  /**
   * 更新锁评论为已释放状态
   */
  private async updateLockCommentWithRelease(
    prNumber: number,
    commentId: number,
    lock: LockMetadata
  ): Promise<void> {
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔓 **锁已释放**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      (lock.branch ? `- Git 分支：\`${lock.branch}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '') +
      `- 释放时间：${lock.released_at}\n` +
      `\n**过期时间动态计算：**\n` +
      `过期时间 = PR 最后更新时间 + ${lock.lock_duration_minutes} 分钟\n` +
      `每次提交或评论后，锁自动延期。`;

    await this.updateComment(prNumber, commentId, body);
  }

  private async createLockComment(prNumber: number, lock: LockMetadata): Promise<void> {
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔒 **PR 已被锁定**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      (lock.worktree_path ? `- 工作目录：\`${lock.worktree_path}\`\n` : '') +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 锁时长：${lock.lock_duration_minutes} 分钟\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '') +
      `\n**过期时间动态计算：**\n` +
      `过期时间 = PR 最后更新时间 + ${lock.lock_duration_minutes} 分钟\n` +
      `每次提交或评论后，锁自动延期。`;

    await this.createComment(prNumber, body);
  }

  private gh(command: string): string {
    return execSync(`gh ${command} --repo ${this.repo}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========== CLI 工具 ==========

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
Usage:
  bun pr-lock.ts acquire <pr-number> <timeout-minutes> <agent-id> [--worktree-path=<path>] [--task-id=X] [--reason="..."]
  bun pr-lock.ts check <pr-number>
  bun pr-lock.ts release <pr-number> <agent-id>
  bun pr-lock.ts force-release <pr-number>

Examples:
  bun pr-lock.ts acquire 419 60 fixer@team --worktree-path="exomind-worktree-pr-419" --task-id=4 --reason="修复 TypeScript 类型错误"
  bun pr-lock.ts check 419
  bun pr-lock.ts release 419 fixer@team
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
