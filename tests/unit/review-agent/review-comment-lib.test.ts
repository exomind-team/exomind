import { describe, expect, it } from 'vitest';
import { toThreadReplies } from '../../../agents/review-agent/scripts/review-comment-lib.ts';

describe('review comment helpers', () => {
  it('keeps only reply comments as thread replies', () => {
    const result = toThreadReplies([
      {
        id: 101,
        body: 'top-level comment',
        created_at: '2026-03-10T01:00:00Z',
        in_reply_to_id: null,
      },
      {
        id: 102,
        body: 'reply',
        created_at: '2026-03-10T01:01:00Z',
        in_reply_to_id: 101,
      },
      {
        id: 103,
        body: 'another top-level',
        created_at: '2026-03-10T01:02:00Z',
      },
    ]);

    expect(result).toEqual([
      {
        id: '102',
        body: 'reply',
        createdAt: '2026-03-10T01:01:00Z',
      },
    ]);
  });
});
