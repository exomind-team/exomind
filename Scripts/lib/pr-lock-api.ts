/**
 * GitHub API 接口定义
 * 用于依赖注入和测试 mock
 */

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
    const result = this.gh(`pr comment ${prNumber} --body "${this.escapeBody(body)}"`);
    const match = result.match(/\/(\d+)$/);
    if (!match) {
      throw new Error('Failed to extract comment ID from gh output');
    }
    return parseInt(match[1]);
  }

  async updateComment(prNumber: number, commentId: number, body: string): Promise<void> {
    this.gh(`api -X PATCH "/repos/${this.repo}/issues/comments/${commentId}" -f body="${this.escapeBody(body)}"`);
  }

  async getComments(prNumber: number): Promise<Array<{ id: number; body: string; createdAt: string }>> {
    const result = this.gh(`pr view ${prNumber} --json comments`);
    const data = JSON.parse(result);
    return data.comments.map((c: any) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt
    }));
  }

  private gh(command: string): string {
    const { execSync } = require('child_process');
    return execSync(`gh ${command} --repo ${this.repo}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }

  private escapeBody(body: string): string {
    return body.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
