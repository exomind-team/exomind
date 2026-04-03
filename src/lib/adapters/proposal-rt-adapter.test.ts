import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateProposalInput,
  Proposal,
  ProposalReference,
  UpdateProposalInput,
} from '@/lib/types/proposal';
import {
  ProposalRtAdapter,
} from './proposal-rt-adapter';

const runtimeTarget = {
  mode: 'external' as const,
  host: '127.0.0.1',
  port: 9124,
  authToken: 'secret-token',
};

const sampleReferences: ProposalReference[] = [
  {
    refType: 'task',
    id: 'task-1',
    displayText: '任务 #1',
  },
];

const sampleProposal: Proposal = {
  id: 7,
  title: '整理会议记录',
  body: '根据上午的会话记录生成任务。',
  actionType: 'create_task',
  actionParams: {
    title: '整理会议记录',
    priority: 'medium',
  },
  references: sampleReferences,
  status: 'pending',
  publisher: {
    publisherType: 'agent',
    id: 'codex',
    name: 'Codex',
  },
  comments: [
    {
      author: {
        publisherType: 'human',
        id: 'user-1',
        name: 'Alice',
      },
      content: '先给我看看标题。',
      createdAt: '2026-04-01T12:05:00.000Z',
    },
  ],
  createdAt: '2026-04-01T12:00:00.000Z',
  updatedAt: '2026-04-01T12:10:00.000Z',
  snoozeUntil: undefined,
};

function toRuntimeProposal(proposal: Proposal): Record<string, unknown> {
  return {
    id: proposal.id,
    title: proposal.title,
    body: proposal.body,
    action_type: proposal.actionType,
    action_params: proposal.actionParams,
    references: proposal.references.map((reference) => ({
      ref_type: reference.refType,
      id: reference.id,
      display_text: reference.displayText,
    })),
    status: proposal.status,
    publisher: {
      publisher_type: proposal.publisher.publisherType,
      id: proposal.publisher.id,
      name: proposal.publisher.name,
    },
    comments: proposal.comments.map((comment) => ({
      author: {
        publisher_type: comment.author.publisherType,
        id: comment.author.id,
        name: comment.author.name,
      },
      content: comment.content,
      created_at: comment.createdAt,
    })),
    created_at: proposal.createdAt,
    updated_at: proposal.updatedAt,
    snooze_until: proposal.snoozeUntil ?? null,
  };
}

describe('ProposalRtAdapter', () => {
  const fetchImpl = vi.fn<typeof fetch>();
  let adapter: ProposalRtAdapter;

  beforeEach(() => {
    vi.useRealTimers();
    fetchImpl.mockReset();
    adapter = new ProposalRtAdapter({
      fetchImpl,
      resolveTarget: () => runtimeTarget,
    });
  });

  it('lists proposals via runtime target + auth headers + user scope', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify([
      toRuntimeProposal(sampleProposal),
    ]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await adapter.listProposals({
      status: 'pending',
      actionType: 'create_task',
    });

    expect(result).toEqual([sampleProposal]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(input).toBe('http://127.0.0.1:9124/api/proposals?status=pending&action_type=create_task&user_id=anonymous');
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('sends create payload in runtime snake_case format', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(
      toRuntimeProposal(sampleProposal),
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const payload: CreateProposalInput = {
      title: '整理会议记录',
      body: '根据上午的会话记录生成任务。',
      actionType: 'create_task',
      actionParams: {
        title: '整理会议记录',
      },
      references: sampleReferences,
      publisher: {
        publisherType: 'agent',
        id: 'codex',
        name: 'Codex',
      },
    };

    await adapter.createProposal(payload);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      title: '整理会议记录',
      body: '根据上午的会话记录生成任务。',
      action_type: 'create_task',
      action_params: {
        title: '整理会议记录',
      },
      references: [
        {
          ref_type: 'task',
          id: 'task-1',
          display_text: '任务 #1',
        },
      ],
      publisher: {
        publisher_type: 'agent',
        id: 'codex',
        name: 'Codex',
      },
    });
  });

  it('returns null when getProposal receives 404', async () => {
    fetchImpl.mockResolvedValueOnce(new Response('', { status: 404 }));

    const result = await adapter.getProposal(99);

    expect(result).toBeNull();
  });

  it('throws ProposalRtError on list failure', async () => {
    fetchImpl.mockResolvedValueOnce(new Response('missing', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    }));

    await expect(adapter.listProposals()).rejects.toMatchObject({
      status: 404,
    });
  });

  it('times out runtime proposal requests instead of hanging forever（RT 不可达时请求箱请求会超时返回）', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fetchImpl.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new Error('AbortError'));
        });
      }));

      const errorPromise = adapter.listProposals().catch((reason) => reason);
      await vi.advanceTimersByTimeAsync(3_500);
      const error = await errorPromise;

      expect(error).toMatchObject({
        status: 0,
        message: 'RT proposal request timed out（请求超时）',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        '[proposal-rt][request] runtime request failed',
        expect.objectContaining({
          method: 'GET',
          url: 'http://127.0.0.1:9124/api/proposals?user_id=anonymous',
          timeoutMs: 3_500,
          timeout: true,
          message: 'RT proposal request timed out（请求超时）',
        }),
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('sends update patch in snake_case format', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify(
      toRuntimeProposal({
        ...sampleProposal,
        status: 'approved',
        actionParams: {
          title: '整理会议记录（确认版）',
        },
      }),
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const patch: UpdateProposalInput = {
      status: 'approved',
      actionParams: {
        title: '整理会议记录（确认版）',
      },
      snoozeUntil: null,
    };

    await adapter.updateProposal(7, patch);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({
      status: 'approved',
      action_params: {
        title: '整理会议记录（确认版）',
      },
      snooze_until: null,
    });
  });

});
