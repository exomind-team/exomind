import { describe, expect, it } from 'vitest';
import { betaTimeblockLabel } from '@/beta/timeblock-label';
import type { BetaTimeblockNode } from '@/beta/timeblocks-types';
import { B, C, D, P, R } from './timeblock-fixtures';

describe('Beta timeblock event labels', () => {
  it('identifies the target block for appended feedback', () => {
    const node: BetaTimeblockNode = {
      event_id: C,
      profile_id: P,
      device_id: D,
      source: { kind: 'human', author_id: R, owner_generation: null },
      parents: [],
      occurred_at_ms: 1_700_000_000_000,
      effective_at_ms: 1_700_000_000_000,
      clock: { epoch_id: R, elapsed_ms: 0 },
      payload: { kind: 'action', action: { kind: 'append_feedback', block_id: B, text: '补充观察' } },
      digest: 'b'.repeat(64),
      local_seq: 1,
    };

    const label = betaTimeblockLabel(node);

    expect(label).toContain(`时间块 ${B.slice(0, 8)}`);
    expect(label).toContain('补充观察');
  });
});
