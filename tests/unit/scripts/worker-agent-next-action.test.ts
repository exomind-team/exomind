import { describe, expect, it } from 'vitest';
import {
  determineNextAction,
  evaluatePrBody,
  type NextActionInput,
} from '../../../Scripts/dev/worker-agent/next-action.ts';

function makeInput(overrides: Partial<NextActionInput> = {}): NextActionInput {
  return {
    worker: {
      agentId: 'worker-1',
    },
    git: {
      branch: 'feature/issue-421-worker-agent',
      isDefaultBranch: false,
      hasChanges: false,
      aheadCount: 0,
      hasCommitsBeyondBase: true,
    },
    pr: {
      number: 466,
      issueNumber: 421,
      body: '[Codex Worker]\n\n## Summary\n...\n\nrefs #421',
      labels: [],
      headSha: 'head-1',
      comments: [],
      reviews: [],
      statusChecks: [],
      isDraft: true,
      baseBranch: 'dev',
    },
    cursor: {
      lastCommentIds: [],
      lastReviewIds: [],
      lastReviewThreadIds: [],
    },
    lock: {
      local: {
        repo: 'exomind-team/exomind',
        prNumber: 466,
        agentId: 'worker-1',
        lockId: 'lock-1',
        acquiredAt: '2026-03-10T00:00:00.000Z',
        verifiedAt: '2026-03-10T00:01:00.000Z',
      },
      remote: {
        lock_id: 'lock-1',
        agent_id: 'worker-1',
        acquired_at: '2026-03-10T00:00:00.000Z',
        lock_duration_minutes: 30,
        expires_at: '2026-03-10T00:30:00.000Z',
      },
    },
    dissent: {
      requested: false,
    },
    ...overrides,
  };
}

describe('worker-agent next-action', () => {
  it('recommends creating a draft PR when the branch has work but no PR yet', () => {
    const result = determineNextAction(
      makeInput({
        pr: null,
        lock: { local: null, remote: null },
      }),
    );

    expect(result.action).toBe('create-draft-pr');
    expect(result.continueAfterAction).toBe(true);
  });

  it('recommends acquiring the lock when a PR exists but the worker does not own a live lock', () => {
    const result = determineNextAction(
      makeInput({
        lock: { local: null, remote: null },
      }),
    );

    expect(result.action).toBe('acquire-lock');
  });

  it('recommends replying to new blocking reviewer feedback before coding', () => {
    const result = determineNextAction(
      makeInput({
        pr: {
          ...makeInput().pr,
          comments: [
            {
              id: 'comment-1',
              authorLogin: 'ARCJ137442',
              body: '[Codex Reviewer]\nNeed a lock renew command.',
              createdAt: '2026-03-10T08:00:00.000Z',
            },
          ],
        },
      }),
    );

    expect(result.action).toBe('reply-blocking-comment');
    expect(result.blockers?.[0]?.reason).toBe('reviewer');
  });

  it('waits when human-test is active and no newer feedback outranks it', () => {
    const result = determineNextAction(
      makeInput({
        pr: {
          ...makeInput().pr,
          labels: ['🙋needs-human-test'],
        },
      }),
    );

    expect(result.action).toBe('wait-for-update');
    expect(result.reason).toMatch(/human-test/i);
  });

  it('handles failing CI before resuming normal progress', () => {
    const result = determineNextAction(
      makeInput({
        pr: {
          ...makeInput().pr,
          statusChecks: [
            {
              name: 'build',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
            },
          ],
        },
      }),
    );

    expect(result.action).toBe('handle-ci-failure');
  });

  it('syncs the PR body before other clean-state work when the body is off-protocol', () => {
    const result = determineNextAction(
      makeInput({
        pr: {
          ...makeInput().pr,
          body: 'plain body without worker protocol',
        },
      }),
    );

    expect(result.action).toBe('sync-pr-body');
  });

  it('pushes committed work when the branch is ahead and no blockers remain', () => {
    const result = determineNextAction(
      makeInput({
        git: {
          ...makeInput().git,
          aheadCount: 2,
        },
      }),
    );

    expect(result.action).toBe('commit-and-push');
  });

  it('keeps implementing local changes when the worktree is dirty and no blockers remain', () => {
    const result = determineNextAction(
      makeInput({
        git: {
          ...makeInput().git,
          hasChanges: true,
        },
      }),
    );

    expect(result.action).toBe('implement-next-change');
  });

  it('raises dissent when the worker has flagged a state-machine mismatch', () => {
    const result = determineNextAction(
      makeInput({
        dissent: {
          requested: true,
          summary: 'remote lock owner does not match the restored worker context',
        },
      }),
    );

    expect(result.action).toBe('raise-dissent');
    expect(result.continueAfterAction).toBe(false);
  });

  it('waits when the PR is clean, synced, and free of blockers', () => {
    const result = determineNextAction(makeInput());

    expect(result.action).toBe('wait-for-update');
    expect(result.continueAfterAction).toBe(false);
  });
});

describe('worker-agent PR body evaluation', () => {
  it('requires the worker prefix and an issue reference', () => {
    expect(evaluatePrBody('[Codex Worker]\n\nrefs #421')).toEqual({
      hasWorkerPrefix: true,
      hasIssueRef: true,
      isValid: true,
    });

    expect(evaluatePrBody('plain body')).toEqual({
      hasWorkerPrefix: false,
      hasIssueRef: false,
      isValid: false,
    });
  });
});
