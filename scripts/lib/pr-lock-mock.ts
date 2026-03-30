/**
 * Mock GitHub API 实现
 * 用于离线单元测试
 */

import { IGitHubAPI } from './pr-lock-api';

interface MockComment {
  id: number;
  body: string;
  createdAt: string;
}

interface MockPR {
  labels: Set<string>;
  comments: MockComment[];
}

export class MockGitHubAPI implements IGitHubAPI {
  private prs: Map<number, MockPR> = new Map();
  private nextCommentId = 1;
  private currentTime = Date.now();

  constructor() {}

  /**
   * 模拟时间流逝（用于测试超时）
   */
  advanceTime(ms: number): void {
    this.currentTime += ms;
  }

  /**
   * 获取当前模拟时间（ISO 字符串）
   */
  getCurrentTimeISO(): string {
    return new Date(this.currentTime).toISOString();
  }

  /**
   * 重置所有状态
   */
  reset(): void {
    this.prs.clear();
    this.nextCommentId = 1;
    this.currentTime = Date.now();
  }

  private ensurePR(prNumber: number): MockPR {
    if (!this.prs.has(prNumber)) {
      this.prs.set(prNumber, {
        labels: new Set(),
        comments: []
      });
    }
    return this.prs.get(prNumber)!;
  }

  async addLabel(prNumber: number, label: string): Promise<void> {
    const pr = this.ensurePR(prNumber);
    pr.labels.add(label);
  }

  async removeLabel(prNumber: number, label: string): Promise<void> {
    const pr = this.ensurePR(prNumber);
    pr.labels.delete(label);
  }

  async getLabels(prNumber: number): Promise<string[]> {
    const pr = this.ensurePR(prNumber);
    return Array.from(pr.labels);
  }

  async createComment(prNumber: number, body: string): Promise<number> {
    const pr = this.ensurePR(prNumber);
    const commentId = this.nextCommentId++;
    pr.comments.push({
      id: commentId,
      body,
      createdAt: new Date(this.currentTime).toISOString()
    });
    return commentId;
  }

  async updateComment(prNumber: number, commentId: number, body: string): Promise<void> {
    const pr = this.ensurePR(prNumber);
    const comment = pr.comments.find(c => c.id === commentId);
    if (!comment) {
      throw new Error(`Comment ${commentId} not found`);
    }
    comment.body = body;
  }

  async getComments(prNumber: number): Promise<Array<{ id: number; body: string; createdAt: string }>> {
    const pr = this.ensurePR(prNumber);
    return pr.comments.map(c => ({ ...c }));
  }

  /**
   * 测试辅助方法：获取所有评论（包括内部状态）
   */
  getAllComments(prNumber: number): MockComment[] {
    const pr = this.prs.get(prNumber);
    return pr ? [...pr.comments] : [];
  }

  /**
   * 测试辅助方法：检查标签是否存在
   */
  hasLabel(prNumber: number, label: string): boolean {
    const pr = this.prs.get(prNumber);
    return pr ? pr.labels.has(label) : false;
  }
}
