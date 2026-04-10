import { describe, expect, it } from 'vitest';
import type { Proposal } from '@/lib/types/proposal';
import {
  normalizeProposalActionParams,
  resolveProposalStatusMeta,
  sortProposals,
} from './proposal-inbox-utils';

const baseProposal: Proposal = {
  id: 'proposal-1',
  title: '提案 1',
  body: 'body',
  actionType: 'create_task',
  actionParams: { title: 'T1' },
  references: [],
  status: 'pending',
  publisher: {
    publisherType: 'agent',
    id: 'codex',
    name: 'Codex',
  },
  comments: [],
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
};

describe('proposal inbox utils', () => {
  it('sorts proposals by inbox priority and recency', () => {
    const proposals: Proposal[] = [
      { ...baseProposal, id: 'proposal-1', status: 'approved', updatedAt: '2026-04-01T10:00:00.000Z' },
      { ...baseProposal, id: 'proposal-2', status: 'pending', updatedAt: '2026-04-01T09:00:00.000Z' },
      { ...baseProposal, id: 'proposal-3', status: 'in_review', updatedAt: '2026-04-01T11:00:00.000Z' },
      { ...baseProposal, id: 'proposal-4', status: 'pending', updatedAt: '2026-04-01T12:00:00.000Z' },
      { ...baseProposal, id: 'proposal-5', status: 'rejected', updatedAt: '2026-03-30T12:00:00.000Z' },
    ];

    expect(sortProposals(proposals).map((proposal) => proposal.id)).toEqual([
      'proposal-4',
      'proposal-2',
      'proposal-3',
      'proposal-1',
      'proposal-5',
    ]);
  });

  it('normalizes action params with stable key ordering', () => {
    expect(normalizeProposalActionParams({
      priority: 'medium',
      task: {
        estimate: 25,
        title: '整理纪要',
      },
      tags: ['meeting', 'follow-up'],
    })).toBe(
      '{\n'
      + '  "priority": "medium",\n'
      + '  "tags": [\n'
      + '    "meeting",\n'
      + '    "follow-up"\n'
      + '  ],\n'
      + '  "task": {\n'
      + '    "estimate": 25,\n'
      + '    "title": "整理纪要"\n'
      + '  }\n'
      + '}',
    );
  });

  it('returns readable status metadata', () => {
    expect(resolveProposalStatusMeta('pending')).toMatchObject({
      label: '待处理',
      tone: 'warning',
    });
    expect(resolveProposalStatusMeta('approved')).toMatchObject({
      label: '已批准',
      tone: 'success',
    });
  });
});
