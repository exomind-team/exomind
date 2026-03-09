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

interface LockMetadata {
  lock_id: string;           // 唯一标识：lock-{timestamp}-{random}
  agent_id: string;          // Agent 标识
  acquired_at: string;       // 获取时间 ISO 8601
  expires_at: string;        // 过期时间 ISO 8601
  timeout_minutes: number;   // 超时分钟数
  task_id?: string;          // 关联任务 ID
  reason?: string;           // 锁定原因
}

interface LocalContext {
  pr_number: number;         // PR 编号
  lock_id: string;           // 锁 ID
  agent_id: string;          // Agent 标识
  acquired_at: string;       // 获取时间
  expires_at: string;        // 过期时间
  timeout_minutes: number;   // 超时分钟数
  working_directory: string; // 工作目录
  branch: string;            // Git 分支
  task_id?: string;          // 关联任务 ID
  reason?: string;           // 锁定原因
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

  /**
   * 尝试获取 PR 锁
   *
   * 流程：
   * 1. 检查是否已有锁
   * 2. 如果有锁且未过期，返回失败
   * 3. 如果有锁但已过期，强制释放
   * 4. 添加标签 + 创建 Comment
   * 5. 重新检查 timeline，检测竞争条件
   * 6. 如果有竞争，比较时间戳，较晚的主动放弃
   */
  async acquire(
    prNumber: number,
    timeoutMinutes: number,
    options?: { taskId?: string; reason?: string }
  ): Promise<LockResult> {
    console.log(`[PRLock] Agent ${this.agentId} attempting to acquire lock on PR #${prNumber}`);

    // 1. 检查是否已有锁
    const existingLock = await this.checkLock(prNumber);

    if (existingLock) {
      // 2. 检查锁是否过期
      const now = new Date();
      const expiresAt = new Date(existingLock.expires_at);

      if (now < expiresAt) {
        // 锁未过期，获取失败
        const remainingMinutes = Math.ceil((expiresAt.getTime() - now.getTime()) / 60000);
        console.log(`[PRLock] PR #${prNumber} is locked by ${existingLock.agent_id}, expires in ${remainingMinutes} minutes`);
        return {
          success: false,
          error: `PR #${prNumber} is locked by ${existingLock.agent_id} until ${existingLock.expires_at} (${remainingMinutes} minutes remaining)`
        };
      }

      // 锁已过期，强制释放
      console.log(`[PRLock] Existing lock on PR #${prNumber} has expired, force releasing`);
      await this.forceRelease(prNumber, existingLock);
    }

    // 3. 生成锁元数据
    const now = new Date();
    const lock: LockMetadata = {
      lock_id: `lock-${now.getTime()}-${Math.random().toString(36).substr(2, 9)}`,
      agent_id: this.agentId,
      acquired_at: now.toISOString(),
      expires_at: new Date(now.getTime() + timeoutMinutes * 60 * 1000).toISOString(),
      timeout_minutes: timeoutMinutes,
      task_id: options?.taskId,
      reason: options?.reason
    };

    // 4. 添加锁标签
    console.log(`[PRLock] Adding lock label to PR #${prNumber}`);
    await this.addLabel(prNumber, '🔒 locked');

    // 5. 创建锁元数据 Comment
    console.log(`[PRLock] Creating lock comment with metadata`);
    await this.createLockComment(prNumber, lock);

    // 6. 等待 GitHub API 同步（避免 race condition）
    await this.sleep(2000);

    // 7. 重新检查 timeline，检测竞争条件
    console.log(`[PRLock] Checking for race conditions`);
    const conflictCheck = await this.detectConflict(prNumber, lock);

    if (conflictCheck.hasConflict) {
      // 发现竞争，主动放弃
      console.log(`[PRLock] Race condition detected! ${conflictCheck.winner} won, ${conflictCheck.loser} backing off`);
      await this.removeLabel(prNumber, '🔒 locked');
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

    // 8. 保存本地上下文
    await this.saveLocalContext(lock, prNumber);

    return { success: true, lock };
  }

  /**
   * 续期锁（延长超时时间）
   */
  async renew(
    prNumber: number,
    additionalMinutes: number
  ): Promise<LockResult> {
    console.log(`[PRLock] Renewing lock on PR #${prNumber} for ${additionalMinutes} more minutes`);

    const lock = await this.checkLock(prNumber);

    if (!lock) {
      return { success: false, error: 'No lock found' };
    }

    if (lock.agent_id !== this.agentId) {
      return {
        success: false,
        error: `Lock is held by ${lock.agent_id}, not ${this.agentId}`
      };
    }

    // 更新过期时间
    const newExpiresAt = new Date(Date.now() + additionalMinutes * 60 * 1000);
    lock.expires_at = newExpiresAt.toISOString();
    lock.timeout_minutes = additionalMinutes;

    // 创建新的锁 Comment（更新时间戳）
    await this.createLockComment(prNumber, lock);

    console.log(`[PRLock] Lock renewed, new expiry: ${lock.expires_at}`);
    return { success: true, lock };
  }

  /**
   * 释放锁
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
    await this.removeLabel(prNumber, '🔒 locked');

    // 添加释放评论
    await this.createComment(prNumber,
      `🔓 **锁已释放**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 释放时间：${new Date().toISOString()}\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      `\nPR 现在可以被其他 Agent 处理。`
    );

    console.log(`[PRLock] Lock released successfully`);

    // 清理本地上下文
    await this.clearLocalContext();

    return { success: true };
  }

  /**
   * 检查 PR 是否被锁定
   */
  async checkLock(prNumber: number): Promise<LockMetadata | null> {
    // 1. 检查是否有 🔒 locked 标签
    const labels = await this.getLabels(prNumber);
    const hasLock = labels.some((l: any) => l.name === '🔒 locked');

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

    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.error('[PRLock] Failed to parse lock metadata:', e);
      return null;
    }
  }

  /**
   * 检测竞争条件
   *
   * 原理：
   * 1. 查询 PR timeline 中所有的 lock comment
   * 2. 找出时间戳最早的 lock comment
   * 3. 如果不是自己，说明有竞争，自己是败者
   */
  private async detectConflict(
    prNumber: number,
    myLock: LockMetadata
  ): Promise<{ hasConflict: boolean; winner?: string; loser?: string }> {
    const comments = await this.getComments(prNumber);

    // 找出所有包含 LOCK_METADATA 的 comment
    const lockComments = comments
      .filter((c: any) => c.body?.includes('<!-- LOCK_METADATA'))
      .map((c: any) => {
        const match = c.body.match(/<!-- LOCK_METADATA\n([\s\S]*?)\n-->/);
        if (!match) return null;
        try {
          const metadata = JSON.parse(match[1]);
          return {
            ...metadata,
            comment_created_at: c.created_at
          };
        } catch {
          return null;
        }
      })
      .filter((m: any) => m !== null);

    if (lockComments.length <= 1) {
      // 只有自己的锁，没有竞争
      return { hasConflict: false };
    }

    // 按 lock_id 中的时间戳排序（lock_id 格式：lock-{timestamp}-{random}）
    lockComments.sort((a: any, b: any) => {
      const aTime = parseInt(a.lock_id.split('-')[1]);
      const bTime = parseInt(b.lock_id.split('-')[1]);
      return aTime - bTime;
    });

    const winner = lockComments[0];

    if (winner.agent_id === this.agentId) {
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

  /**
   * 强制释放过期的锁
   */
  private async forceRelease(
    prNumber: number,
    oldLock: LockMetadata
  ): Promise<void> {
    await this.removeLabel(prNumber, '🔒 locked');

    await this.createComment(prNumber,
      `🔓 **锁已超时释放**\n\n` +
      `- 原持有者：\`${oldLock.agent_id}\`\n` +
      `- 获取时间：${oldLock.acquired_at}\n` +
      `- 过期时间：${oldLock.expires_at}\n` +
      `- 超时原因：锁已过期 ${oldLock.timeout_minutes} 分钟，自动释放\n\n` +
      `锁现在可以被其他 Agent 获取。`
    );
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
    const tmpFile = `/tmp/pr-lock-comment-${Date.now()}.md`;
    Bun.write(tmpFile, body);
    this.gh(`issue comment ${prNumber} --body-file ${tmpFile}`);
    execSync(`rm ${tmpFile}`);
  }

  private async createLockComment(prNumber: number, lock: LockMetadata): Promise<void> {
    const body =
      `<!-- LOCK_METADATA\n${JSON.stringify(lock, null, 2)}\n-->\n\n` +
      `🔒 **PR 已被锁定**\n\n` +
      `- 持有者：\`${lock.agent_id}\`\n` +
      `- 锁 ID：\`${lock.lock_id}\`\n` +
      `- 获取时间：${lock.acquired_at}\n` +
      `- 过期时间：${lock.expires_at}（${lock.timeout_minutes} 分钟后）\n` +
      (lock.task_id ? `- 任务：#${lock.task_id}\n` : '') +
      (lock.reason ? `- 原因：${lock.reason}\n` : '') +
      `\n其他 Agent 请等待锁释放或超时后再处理此 PR。`;

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

  // ========== 本地上下文管理 ==========

  /**
   * 保存本地上下文
   *
   * 在获取锁成功后调用，记录当前工作目录与 PR 的关联关系
   */
  private async saveLocalContext(
    lock: LockMetadata,
    prNumber: number
  ): Promise<void> {
    const contextDir = '.exomind';
    const contextFile = `${contextDir}/pr-context.json`;

    // 确保目录存在
    try {
      execSync(`mkdir -p ${contextDir}`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('[PRLock] Failed to create .exomind directory:', e);
      return;
    }

    // 获取当前分支
    let branch = 'unknown';
    try {
      branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    } catch (e) {
      console.warn('[PRLock] Failed to get current branch:', e);
    }

    const context: LocalContext = {
      pr_number: prNumber,
      lock_id: lock.lock_id,
      agent_id: lock.agent_id,
      acquired_at: lock.acquired_at,
      expires_at: lock.expires_at,
      timeout_minutes: lock.timeout_minutes,
      working_directory: process.cwd(),
      branch,
      task_id: lock.task_id,
      reason: lock.reason
    };

    try {
      await Bun.write(contextFile, JSON.stringify(context, null, 2));
      console.log(`[PRLock] Local context saved to ${contextFile}`);
    } catch (e) {
      console.warn('[PRLock] Failed to save local context:', e);
    }
  }

  /**
   * 读取本地上下文
   *
   * Agent 重启后可以通过此方法恢复工作上下文
   */
  async loadLocalContext(): Promise<LocalContext | null> {
    const contextFile = '.exomind/pr-context.json';

    try {
      const file = Bun.file(contextFile);
      if (!(await file.exists())) {
        return null;
      }

      const context = await file.json() as LocalContext;
      console.log(`[PRLock] Local context loaded: PR #${context.pr_number}`);
      return context;
    } catch (e) {
      console.warn('[PRLock] Failed to load local context:', e);
      return null;
    }
  }

  /**
   * 清理本地上下文
   *
   * 在释放锁后调用，清除工作目录与 PR 的关联关系
   */
  private async clearLocalContext(): Promise<void> {
    const contextFile = '.exomind/pr-context.json';

    try {
      execSync(`rm -f ${contextFile}`, { stdio: 'ignore' });
      console.log('[PRLock] Local context cleared');
    } catch (e) {
      console.warn('[PRLock] Failed to clear local context:', e);
    }
  }

  /**
   * 检查本地上下文是否与远程锁一致
   *
   * 用于验证本地上下文的有效性
   */
  async validateLocalContext(): Promise<{
    valid: boolean;
    reason?: string;
    localContext?: LocalContext;
    remoteLock?: LockMetadata;
  }> {
    const localContext = await this.loadLocalContext();

    if (!localContext) {
      return { valid: false, reason: 'No local context found' };
    }

    const remoteLock = await this.checkLock(localContext.pr_number);

    if (!remoteLock) {
      return {
        valid: false,
        reason: 'Remote lock not found (may have been released or expired)',
        localContext
      };
    }

    if (remoteLock.lock_id !== localContext.lock_id) {
      return {
        valid: false,
        reason: 'Lock ID mismatch (another agent may have acquired the lock)',
        localContext,
        remoteLock
      };
    }

    if (remoteLock.agent_id !== localContext.agent_id) {
      return {
        valid: false,
        reason: 'Agent ID mismatch',
        localContext,
        remoteLock
      };
    }

    // 检查是否过期
    const now = new Date();
    const expiresAt = new Date(remoteLock.expires_at);
    if (now >= expiresAt) {
      return {
        valid: false,
        reason: 'Lock has expired',
        localContext,
        remoteLock
      };
    }

    return { valid: true, localContext, remoteLock };
  }
}

// ========== CLI 工具 ==========

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
Usage:
  bun pr-lock.ts acquire <pr-number> <timeout-minutes> [agent-id] [--task-id=X] [--reason="..."]
  bun pr-lock.ts release <pr-number> [agent-id]
  bun pr-lock.ts check <pr-number>
  bun pr-lock.ts renew <pr-number> <additional-minutes> [agent-id]
  bun pr-lock.ts context                    # 查看本地上下文
  bun pr-lock.ts validate                   # 验证本地上下文

Examples:
  bun pr-lock.ts acquire 379 5 fixer@team --task-id=4 --reason="修复逻辑问题"
  bun pr-lock.ts release 379 fixer@team
  bun pr-lock.ts check 379
  bun pr-lock.ts renew 379 5 fixer@team
  bun pr-lock.ts context                    # 查看当前工作目录的 PR 上下文
  bun pr-lock.ts validate                   # 验证本地上下文是否有效
    `);
    process.exit(1);
  }

  const repo = 'exomind-team/exomind';

  switch (command) {
    case 'acquire': {
      const prNumber = parseInt(args[1]);
      const timeoutMinutes = parseInt(args[2]);
      const agentId = args[3] || 'manual-cli';
      const taskId = args.find(a => a.startsWith('--task-id='))?.split('=')[1];
      const reason = args.find(a => a.startsWith('--reason='))?.split('=')[1];

      const lockManager = new PRLockManager(repo, agentId);
      const result = await lockManager.acquire(prNumber, timeoutMinutes, { taskId, reason });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    case 'release': {
      const prNumber = parseInt(args[1]);
      const agentId = args[2] || 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const result = await lockManager.release(prNumber);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    case 'check': {
      const prNumber = parseInt(args[1]);
      const agentId = 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const lock = await lockManager.checkLock(prNumber);
      if (lock) {
        const now = new Date();
        const expiresAt = new Date(lock.expires_at);
        const isExpired = now >= expiresAt;
        console.log(JSON.stringify({ ...lock, is_expired: isExpired }, null, 2));
      } else {
        console.log('No lock found');
      }
      process.exit(0);
    }

    case 'renew': {
      const prNumber = parseInt(args[1]);
      const additionalMinutes = parseInt(args[2]);
      const agentId = args[3] || 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const result = await lockManager.renew(prNumber, additionalMinutes);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    case 'context': {
      const agentId = 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const context = await lockManager.loadLocalContext();
      if (context) {
        console.log(JSON.stringify(context, null, 2));
      } else {
        console.log('No local context found');
      }
      process.exit(0);
    }

    case 'validate': {
      const agentId = 'manual-cli';
      const lockManager = new PRLockManager(repo, agentId);
      const validation = await lockManager.validateLocalContext();
      console.log(JSON.stringify(validation, null, 2));
      process.exit(validation.valid ? 0 : 1);
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}
