import { describe, expect, it } from 'vitest';
import {
  HUMAN_TEST_LABEL,
  HUMAN_TEST_LABEL_ALIASES,
  REVIEWER_PREFIX,
  WORKER_PREFIX,
  buildRestoredContext,
  renderWorkerBody,
  renderWorkerComment,
  validateWorkerText,
} from '../../../Scripts/dev/worker-agent/lib.ts';

describe('worker-agent lib', () => {
  it('renders a worker comment with fixed sections and prefix', () => {
    const body = renderWorkerComment({
      quote: '原文关键句',
      change: 'Adjusted the locking flow.',
      verification: 'npx vitest run tests/unit/scripts/worker-agent-lib.test.ts',
      result: 'Passed.',
    });

    expect(body).toContain(WORKER_PREFIX);
    expect(body).toContain('> 原文关键句');
    expect(body).toContain('Change');
    expect(body).toContain('Verification');
    expect(body).toContain('Result');
  });

  it('renders a worker body with fixed top-level sections', () => {
    const body = renderWorkerBody({
      summary: 'Track the worker-agent lifecycle.',
      scope: '- Add prompt docs\n- Add CLI skeleton',
      verification: '- pending',
      linksRefs: '- refs #421',
    });

    expect(body.startsWith(WORKER_PREFIX)).toBe(true);
    expect(body).toContain('## Summary');
    expect(body).toContain('## Scope');
    expect(body).toContain('## Verification');
    expect(body).toContain('## Links/Refs');
  });

  it('flags missing worker prefix and required sections', () => {
    const issues = validateWorkerText('plain body', {
      requiredSections: ['Change', 'Verification', 'Result'],
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'missing-prefix',
      'missing-section',
      'missing-section',
      'missing-section',
    ]);
  });

  it('flags suspicious escaped newlines and question noise', () => {
    const issues = validateWorkerText(`${WORKER_PREFIX}\\n???????`, {
      requiredSections: [],
    });

    expect(issues.map((issue) => issue.code)).toContain('escaped-newline');
    expect(issues.map((issue) => issue.code)).toContain('question-noise');
  });

  it('builds restored context from verified lock and current metadata', () => {
    const context = buildRestoredContext({
      prNumber: 421,
      issueNumber: 421,
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
    expect(context.branch).toBe('feature/issue-421-worker-agent');
    expect(context.baseBranch).toBe('dev');
    expect(context.waiting.waitingOn).toBe('human-comment');
    expect(context.lock.owner).toBe('codex-worker@test');
  });

  it('exports protocol constants used across the worker-agent flow', () => {
    expect(WORKER_PREFIX).toBe('[Codex Worker]');
    expect(REVIEWER_PREFIX).toBe('[Codex Reviewer]');
    expect(HUMAN_TEST_LABEL).toBe('🙋needs-human-test');
    expect(HUMAN_TEST_LABEL_ALIASES).toEqual(['🙋needs-human-test', '🙋 needs-human-test']);
  });
});
