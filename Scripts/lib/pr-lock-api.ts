/**
 * GitHub API 接口定义
 * 用于依赖注入和测试 mock
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';

export interface IGitHubAPI {
  /**
   * 添加标签到 PR
   */
  addLabel(prNumber: number, label: string): Promise<void>;

  /**
   * 从 PR 移除标签
   */
  removeLabel(prNumber: number, label: string): Promise<void>;

  /**
   * 获取 PR 的所有标签
   */
  getLabels(prNumber: number): Promise<string[]>;

  /**
   * 创建评论
   */
  createComment(prNumber: number, body: string): Promise<number>;

  /**
   * 更新评论
   */
  updateComment(prNumber: number, commentId: number, body: string): Promise<void>;

  /**
   * 获取所有评论
   */
  getComments(prNumber: number): Promise<Array<{ id: number; body: string; createdAt: string }>>;
}

/**
 * 真实 GitHub API 实现（使用 gh CLI）
 */
export class RealGitHubAPI implements IGitHubAPI {
  constructor(private repo: string) {}

  async addLabel(prNumber: number, label: string): Promise<void> {
    this.gh(`issue edit ${prNumber} --add-label "${label}"`);
  }

  async removeLabel(prNumber: number, label: string): Promise<void> {
    this.gh(`issue edit ${prNumber} --remove-label "${label}"`);
  }

  async getLabels(prNumber: number): Promise<string[]> {
    const result = this.gh(`issue view ${prNumber} --json labels`);
    const data = JSON.parse(result);
    return data.labels.map((l: any) => l.name);
  }

  async createComment(prNumber: number, body: string): Promise<number> {
    // 使用临时文件避免 shell 转义破坏换行符
    // 确保临时目录存在
    const tempDir = '.exomind/temp';
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = `${tempDir}/comment-${Date.now()}.txt`;
    writeFileSync(tempFile, body, 'utf-8');

    try {
      const createdAfter = new Date(Date.now() - 5000).toISOString();
      const result = this.gh(`pr comment ${prNumber} --body-file "${tempFile}"`);
      const match = result.match(/\/(\d+)$/);
      if (!match) {
        const fallbackId = this.findCreatedCommentId(prNumber, body, createdAfter);
        if (fallbackId === null) {
          throw new Error('Failed to extract comment ID from gh output');
        }
        return fallbackId;
      }
      return parseInt(match[1]);
    } finally {
      // 清理临时文件
      try {
        unlinkSync(tempFile);
      } catch (e) {
        // 忽略删除失败
      }
    }
  }

  async updateComment(prNumber: number, commentId: number, body: string): Promise<void> {
    // 使用临时文件避免 shell 转义破坏换行符
    // 确保临时目录存在
    const tempDir = '.exomind/temp';
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = `${tempDir}/comment-${Date.now()}.txt`;
    writeFileSync(tempFile, body, 'utf-8');

    try {
      this.gh(`api -X PATCH "/repos/${this.repo}/issues/comments/${commentId}" -F body=@"${tempFile}"`);
    } finally {
      // 清理临时文件
      try {
        unlinkSync(tempFile);
      } catch (e) {
        // 忽略删除失败
      }
    }
  }

  async getComments(prNumber: number): Promise<Array<{ id: number; body: string; createdAt: string }>> {
    const comments: Array<{ id: number; body: string; createdAt: string }> = [];
    const perPage = 100;

    for (let page = 1; page <= 50; page += 1) {
      const url = `repos/${this.repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}&sort=created&direction=asc`;
      const result = this.gh(`api '${url}'`);
      const trimmed = result.trim();
      if (!trimmed) {
        break;
      }

      const data = JSON.parse(trimmed);
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      comments.push(
        ...data.map((c: any) => ({
          id: Number(c.id),
          body: c.body,
          createdAt: c.created_at ?? c.createdAt,
        })),
      );

    }

    return comments;
  }

  private gh(command: string): string {
    // gh api 命令不接受 --repo 参数，需要在 URL 中指定 repo
    const isApiCommand = command.trim().startsWith('api ');
    const fullCommand = isApiCommand
      ? `gh ${command}`
      : `gh ${command} --repo ${this.repo}`;
    return execSync(fullCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  private fetchViewerLogin(): string | null {
    const result = this.gh('api user');
    const trimmed = result.trim();
    if (!trimmed) {
      return null;
    }

    const data = JSON.parse(trimmed);
    return typeof data?.login === 'string' && data.login.trim() ? data.login : null;
  }

  private findCreatedCommentId(prNumber: number, body: string, createdAfter: string): number | null {
    const viewerLogin = this.fetchViewerLogin();
    const createdAfterTs = Date.parse(createdAfter);
    const perPage = 100;

    for (let page = 1; page <= 5; page += 1) {
      const url = `repos/${this.repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}&sort=created&direction=desc`;
      const result = this.gh(`api '${url}'`);
      const trimmed = result.trim();
      if (!trimmed) {
        break;
      }

      const data = JSON.parse(trimmed);
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const comment of data) {
        const createdAt = comment?.created_at ?? comment?.createdAt;
        const createdAtTs = Date.parse(createdAt);
        if (Number.isFinite(createdAfterTs) && Number.isFinite(createdAtTs) && createdAtTs < createdAfterTs) {
          return null;
        }

        const id = Number(comment?.id);
        if (!Number.isFinite(id)) {
          continue;
        }

        const authorLogin = comment?.user?.login;
        if (viewerLogin && authorLogin !== viewerLogin) {
          continue;
        }

        if (comment?.body === body) {
          return id;
        }
      }

      if (data.length < perPage) {
        break;
      }
    }

    return null;
  }
}
