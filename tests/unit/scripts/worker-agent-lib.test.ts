import { describe, expect, it } from 'vitest';
import {
  HUMAN_TEST_LABEL,
  HUMAN_TEST_LABEL_ALIASES,
  REVIEWER_PREFIX,
  WORKER_PREFIX,
  buildHandledCursor,
  buildRestoredContext,
  extractLinkedIssueNumber,
  resolveWorkerTargetLanguage,
  renderWorkerDissentComment,
  renderWorkerDissentIssueBody,
  renderWorkerBody,
  renderWorkerComment,
  validateWorkerText,
} from '../../../Scripts/dev/worker-agent/lib.ts';

describe('worker-agent lib', () => {
  it('renders a worker comment with localized sections and prefix', () => {
    const body = renderWorkerComment({
      language: 'zh',
      quote: '原文关键句',
      change: 'Adjusted the locking flow.',
      verification: 'npx vitest run tests/unit/scripts/worker-agent-lib.test.ts',
      result: 'Passed.',
    });

    expect(body).toContain(WORKER_PREFIX);
    expect(body).toContain('> 原文关键句');
    expect(body).toContain('变更');
    expect(body).toContain('验证');
    expect(body).toContain('结果');
  });

  it('renders a worker body with localized top-level sections', () => {
    const body = renderWorkerBody({
      language: 'zh',
      summary: 'Track the worker-agent lifecycle.',
      scope: '- Add prompt docs\n- Add CLI skeleton',
      verification: '- pending',
      linksRefs: '- refs #421',
    });

    expect(body.startsWith(WORKER_PREFIX)).toBe(true);
    expect(body).toContain('## 摘要');
    expect(body).toContain('## 范围');
    expect(body).toContain('## 验证');
    expect(body).toContain('## 关联/引用');
  });

  it('renders dissent issue/comment templates with localized evidence sections', () => {
    const issueBody = renderWorkerDissentIssueBody({
      language: 'zh',
      scriptConclusion: 'next-action returned acquire-lock',
      actualConclusion: 'current PR is already locked by another agent',
      reproducibleEvidence: '1. restore context\n2. inspect current PR lock comment',
      traceProcess: 'Checked lock snapshot, PR comments, and lock owner chain.',
      impact: 'Worker would overwrite lock ownership assumptions.',
      linkedPr: '- pr #466',
    });
    const commentBody = renderWorkerDissentComment({
      language: 'zh',
      scriptConclusion: 'next-action returned acquire-lock',
      actualConclusion: 'current PR is already locked by another agent',
      reproducibleEvidence: '1. restore context\n2. inspect current PR lock comment',
      traceProcess: 'Checked lock snapshot, PR comments, and lock owner chain.',
      impact: 'Worker would overwrite lock ownership assumptions.',
      linkedIssue: 'https://github.com/exomind-team/exomind/issues/999',
    });

    expect(issueBody.startsWith(WORKER_PREFIX)).toBe(true);
    expect(issueBody).toContain('## 脚本结论');
    expect(issueBody).toContain('## 追踪过程');
    expect(commentBody).toContain('结论');
    expect(commentBody).toContain('复现证据');
    expect(commentBody).toContain('关联议题');
  });

  it('only flags missing worker prefix during light validation', () => {
    const issues = validateWorkerText('plain body');

    expect(issues.map((issue) => issue.code)).toEqual(['missing-prefix']);
  });

  it('flags suspicious escaped newlines and question noise', () => {
    const issues = validateWorkerText(`${WORKER_PREFIX}\\n???????`);

    expect(issues.map((issue) => issue.code)).toContain('escaped-newline');
    expect(issues.map((issue) => issue.code)).toContain('question-noise');
  });

  it('detects zh as the worker target language from issue context and ignores worker/reviewer/bot noise', () => {
    const language = resolveWorkerTargetLanguage({
      issueTitle: 'workflow: 单 Worker 锁定 issue/PR 的 Ralph 循环 Agent 流程',
      issueBody: '目标是建立一个常驻 Agent 工作流。',
      issueComments: [
        {
          authorLogin: 'ARCJ137442',
          body: `${WORKER_PREFIX}\n\n## Summary\nThis is automation output.`,
          createdAt: '2026-03-09T09:00:00.000Z',
        },
        {
          authorLogin: 'ARCJ137442',
          body: '请继续保持中文汇报。',
          createdAt: '2026-03-09T09:10:00.000Z',
        },
      ],
      prComments: [
        {
          authorLogin: 'cloudflare-workers-and-pages',
          body: 'Deployment successful',
          createdAt: '2026-03-09T09:20:00.000Z',
        },
        {
          authorLogin: 'ARCJ137442',
          body: `${REVIEWER_PREFIX}\n\nPlease follow the linked issue language.`,
          createdAt: '2026-03-09T09:30:00.000Z',
        },
      ],
    });

    expect(language).toBe('zh');
  });

  it('prefers the most recent human language signal over the issue fallback', () => {
    const language = resolveWorkerTargetLanguage({
      issueTitle: 'workflow: worker agent loop',
      issueBody: 'Keep the worker prompt and reports aligned.',
      issueComments: [
        {
          authorLogin: 'ARCJ137442',
          body: 'Please keep this issue in English.',
          createdAt: '2026-03-09T09:00:00.000Z',
        },
      ],
      prComments: [
        {
          authorLogin: 'ARCJ137442',
          body: '后续这条链路统一改成中文。',
          createdAt: '2026-03-09T10:00:00.000Z',
        },
      ],
    });

    expect(language).toBe('zh');
  });

  it('builds restored context from verified lock and current metadata', () => {
    const context = buildRestoredContext({
      prNumber: 421,
      issueNumber: 421,
      targetLanguage: 'zh',
      branch: 'feature/issue-421-worker-agent',
      baseBranch: 'dev',
      worktree: '/tmp/worktrees/issue-421-worker-agent',
      headSha: 'abc1234',
      cursor: {
        lastCommentIds: ['comment-1'],
        lastReviewIds: ['review-2'],
      },
      waiting: {
        waiting: true,
        waitingOn: 'human-comment',
        since: '2026-03-09T00:00:00.000Z',
      },
      lock: {
        lockId: 'lock-1',
        owner: 'codex-worker@test',
        acquiredAt: '2026-03-09T00:00:00.000Z',
      },
    });

    expect(context.prNumber).toBe(421);
    expect(context.issueNumber).toBe(421);
    expect(context.targetLanguage).toBe('zh');
    expect(context.branch).toBe('feature/issue-421-worker-agent');
    expect(context.baseBranch).toBe('dev');
    expect(context.waiting.waitingOn).toBe('human-comment');
    expect(context.lock.owner).toBe('codex-worker@test');
  });

  it('builds a handled cursor snapshot from the current PR feedback ids', () => {
    const cursor = buildHandledCursor({
      commentIds: ['comment-1', 'comment-2'],
      reviewIds: ['review-1'],
      previous: {
        lastCommentIds: [],
        lastReviewIds: [],
        lastReviewThreadIds: ['thread-1'],
      },
      seenAt: '2026-03-10T09:00:00.000Z',
    });

    expect(cursor).toEqual({
      lastCommentIds: ['comment-1', 'comment-2'],
      lastReviewIds: ['review-1'],
      lastReviewThreadIds: ['thread-1'],
      lastSeenAt: '2026-03-10T09:00:00.000Z',
    });
  });

  it('extracts the first linked issue number from worker or PR body text', () => {
    expect(extractLinkedIssueNumber('[Codex Worker]\n\nrefs #421')).toBe(421);
    expect(extractLinkedIssueNumber('fixes #450\nrefs #451')).toBe(450);
    expect(extractLinkedIssueNumber('plain body without issue refs')).toBeNull();
  });

  it('exports protocol constants used across the worker-agent flow', () => {
    expect(WORKER_PREFIX).toBe('[Codex Worker]');
    expect(REVIEWER_PREFIX).toBe('[Codex Reviewer]');
    expect(HUMAN_TEST_LABEL).toBe('🙋needs-human-test');
    expect(HUMAN_TEST_LABEL_ALIASES).toEqual(['🙋needs-human-test', '🙋 needs-human-test']);
  });
});
