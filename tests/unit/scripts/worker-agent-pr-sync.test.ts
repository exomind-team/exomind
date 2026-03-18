import { describe, expect, it } from 'vitest';
import { planPrSync } from '../../../Scripts/dev/worker-agent/pr-sync.ts';

describe('worker-agent pr sync planning', () => {
  it('creates a draft PR when no branch PR exists and title/body are available', () => {
    const plan = planPrSync({
      existingPr: null,
      baseBranch: 'dev',
      title: 'feat(worker-agent): bootstrap draft PR flow',
      explicitBodyFile: 'temp/worker-agent/drafts/pr-body.md',
      defaultBodyFile: 'temp/worker-agent/drafts/pr-body.md',
      defaultBodyExists: true,
    });

    expect(plan).toEqual({
      mode: 'create',
      baseBranch: 'dev',
      title: 'feat(worker-agent): bootstrap draft PR flow',
      bodyMode: 'file',
      bodyValue: 'temp/worker-agent/drafts/pr-body.md',
    });
  });

  it('updates the current branch PR from the default draft body when one exists', () => {
    const plan = planPrSync({
      existingPr: {
        number: 466,
        title: 'feat(worker-agent): add main prompt state machine and lock flow',
      },
      baseBranch: 'dev',
      defaultBodyFile: 'temp/worker-agent/drafts/pr-body.md',
      defaultBodyExists: true,
    });

    expect(plan).toEqual({
      mode: 'update',
      prNumber: 466,
      title: undefined,
      bodyMode: 'file',
      bodyValue: 'temp/worker-agent/drafts/pr-body.md',
    });
  });

  it('returns noop when an existing PR has no title/body update input', () => {
    const plan = planPrSync({
      existingPr: {
        number: 466,
        title: 'feat(worker-agent): add main prompt state machine and lock flow',
      },
      baseBranch: 'dev',
      defaultBodyFile: 'temp/worker-agent/drafts/pr-body.md',
      defaultBodyExists: false,
    });

    expect(plan).toEqual({
      mode: 'noop',
      prNumber: 466,
    });
  });

  it('rejects create mode when no title is available', () => {
    expect(() =>
      planPrSync({
        existingPr: null,
        baseBranch: 'dev',
        defaultBodyFile: 'temp/worker-agent/drafts/pr-body.md',
        defaultBodyExists: true,
      }),
    ).toThrow(/title/i);
  });
});
