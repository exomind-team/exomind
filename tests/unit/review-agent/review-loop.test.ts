import { describe, expect, it } from 'vitest';
import {
  buildReviewSummary,
  classifyReviewMode,
  parseLinkedIssueNumbers,
  prioritizeFiles,
  type PullRequestFile,
} from '../../../Scripts/review-agent/review-loop-lib.ts';

describe('review-agent review loop', () => {
  it('parses refs/closes/fixes issue ids and removes duplicates', () => {
    const issueNumbers = parseLinkedIssueNumbers(`
      closes #123
      Refs #124
      fixes exomind-team/exomind#123
      unrelated #999
    `);

    expect(issueNumbers).toEqual([123, 124]);
  });

  it('uses full-review when diff is small enough', () => {
    const result = classifyReviewMode({
      changedFiles: 3,
      additions: 40,
      deletions: 30,
    });

    expect(result).toBe('full-review');
  });

  it('uses priority-review when diff is too large', () => {
    const result = classifyReviewMode({
      changedFiles: 8,
      additions: 70,
      deletions: 40,
    });

    expect(result).toBe('priority-review');
  });

  it('prioritizes new files, tests, service/controller/model files, then the rest', () => {
    const files: PullRequestFile[] = [
      { path: 'src/misc/logger.ts', status: 'modified', additions: 5, deletions: 1 },
      { path: 'src/services/user-service.ts', status: 'modified', additions: 10, deletions: 2 },
      { path: 'tests/unit/review-agent/review-loop.test.ts', status: 'modified', additions: 20, deletions: 0 },
      { path: 'src/controllers/pr-controller.ts', status: 'added', additions: 30, deletions: 0 },
    ];

    expect(prioritizeFiles(files).map((file) => file.path)).toEqual([
      'src/controllers/pr-controller.ts',
      'tests/unit/review-agent/review-loop.test.ts',
      'src/services/user-service.ts',
      'src/misc/logger.ts',
    ]);
  });

  it('builds a review summary with linked issues and worktree need', () => {
    const summary = buildReviewSummary({
      prNumber: 450,
      title: 'review agent',
      body: 'closes #450 refs #463',
      changedFiles: 7,
      additions: 90,
      deletions: 20,
      files: [
        { path: 'Scripts/review-agent/review-loop.ts', status: 'added', additions: 50, deletions: 0 },
      ],
    });

    expect(summary.linkedIssues).toEqual([450, 463]);
    expect(summary.reviewMode).toBe('priority-review');
    expect(summary.needsWorktree).toBe(false);
    expect(summary.prioritizedFiles.map((file) => file.path)).toEqual([
      'Scripts/review-agent/review-loop.ts',
    ]);
  });
});
