import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeRequestError,
  ensureRuntimeResponseOk,
  fetchRuntimeResponseOrThrow,
} from './runtime-request-error';

describe('runtime-request-error', () => {
  it('classifies fetch exceptions as network failures', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      fetchRuntimeResponseOrThrow(fetchImpl, 'http://127.0.0.1:9124/tasks', undefined, 'Task backup request'),
    ).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      kind: 'network',
      url: 'http://127.0.0.1:9124/tasks',
      message: expect.stringContaining('Task backup request failed [network]'),
    } satisfies Partial<RuntimeRequestError>);
  });

  it('includes parsed json error detail for non-ok responses', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'missing task status history: task-1',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    await expect(
      ensureRuntimeResponseOk(
        response,
        'http://127.0.0.1:9124/mesh/peers/peer-1/tasks/snapshot/sqlite',
        'Task backup request',
      ),
    ).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      kind: 'http',
      status: 500,
      message: expect.stringContaining('missing task status history: task-1'),
    } satisfies Partial<RuntimeRequestError>);
  });
});
