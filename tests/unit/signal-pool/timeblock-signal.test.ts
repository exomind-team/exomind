// timeblock-signal.test.ts — Unit tests for timeblock.completed signal integration
//
// Tests:
//   1. signal-handlers dispatches review.completed with review_type:"timeblock"
//   2. ReviewCompletedPayload supports both session and timeblock variants
//   3. AGENT_FEEDBACK tag is defined in SYSTEM_TAGS

import { describe, expect, it, vi } from 'vitest';
import {
  startSignalHandlers,
  type ReviewCompletedPayload,
} from '@/lib/services/signal-handlers';
import type { SignalEvent } from '@/lib/types/signal-pool';
import { SYSTEM_TAGS } from '@/lib/types/event';

// ── Helper ──

function makeSignalEvent(
  topic: string,
  payload: unknown,
  overrides?: Partial<SignalEvent>,
): SignalEvent {
  return {
    schema_version: 1,
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    topic,
    ts: Date.now(),
    source: 'test',
    origin_host_id: 'test-host',
    hop: 0,
    payload,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
//  1. SYSTEM_TAGS includes AGENT_FEEDBACK
// ═══════════════════════════════════════════════════════

describe('SYSTEM_TAGS', () => {
  it('includes AGENT_FEEDBACK tag', () => {
    expect(SYSTEM_TAGS.AGENT_FEEDBACK).toBe('agent_feedback');
  });

  it('still includes all original tags', () => {
    expect(SYSTEM_TAGS.BLOCK_START).toBe('block_start');
    expect(SYSTEM_TAGS.BLOCK_END).toBe('block_end');
    expect(SYSTEM_TAGS.BLOCK_PAUSE).toBe('block_pause');
    expect(SYSTEM_TAGS.BLOCK_RESUME).toBe('block_resume');
    expect(SYSTEM_TAGS.BLOCK_FEEDBACK).toBe('block_feedback');
    expect(SYSTEM_TAGS.NOTE).toBe('note');
  });
});

// ═══════════════════════════════════════════════════════
//  2. review.completed with review_type:"timeblock"
// ═══════════════════════════════════════════════════════

describe('signal-handlers: review.completed (timeblock variant)', () => {
  it('dispatches timeblock review payload correctly', async () => {
    const onReviewCompleted = vi.fn<[ReviewCompletedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReviewCompleted });

    const payload: ReviewCompletedPayload = {
      effective: '专注完成了架构设计',
      stuck: '没有卡住',
      suggestion: '下次可以缩短时间块到 25 分钟',
      review_type: 'timeblock',
      block_name: '架构设计',
    };

    await handler(makeSignalEvent('review.completed', payload));

    expect(onReviewCompleted).toHaveBeenCalledTimes(1);
    const received = onReviewCompleted.mock.calls[0][0];
    expect(received.review_type).toBe('timeblock');
    expect(received.block_name).toBe('架构设计');
    expect(received.suggestion).toBe('下次可以缩短时间块到 25 分钟');
  });

  it('dispatches session review payload correctly (backward compat)', async () => {
    const onReviewCompleted = vi.fn<[ReviewCompletedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReviewCompleted });

    const payload: ReviewCompletedPayload = {
      effective: '完成了全部测试',
      stuck: '没有卡点',
      improve: '代码覆盖率可以更高',
      avoid: '不要跳过代码审查',
    };

    await handler(makeSignalEvent('review.completed', payload));

    expect(onReviewCompleted).toHaveBeenCalledTimes(1);
    const received = onReviewCompleted.mock.calls[0][0];
    expect(received.review_type).toBeUndefined();
    expect(received.improve).toBe('代码覆盖率可以更高');
    expect(received.avoid).toBe('不要跳过代码审查');
  });

  it('handles mixed session and timeblock reviews in sequence', async () => {
    const onReviewCompleted = vi.fn().mockResolvedValue(undefined);
    const handler = startSignalHandlers({ onReviewCompleted });

    // Timeblock review
    await handler(makeSignalEvent('review.completed', {
      effective: 'good',
      stuck: 'none',
      suggestion: 'try harder',
      review_type: 'timeblock',
      block_name: '写代码',
    }));

    // Session review
    await handler(makeSignalEvent('review.completed', {
      effective: 'productive day',
      stuck: 'meetings',
      improve: 'fewer meetings',
      avoid: 'multitasking',
    }));

    expect(onReviewCompleted).toHaveBeenCalledTimes(2);
    expect(onReviewCompleted.mock.calls[0][0].review_type).toBe('timeblock');
    expect(onReviewCompleted.mock.calls[1][0].review_type).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
//  3. timeblock.completed signal is NOT handled by signal-handlers
//     (it's sent TO the RT, not received FROM it)
// ═══════════════════════════════════════════════════════

describe('signal-handlers: timeblock.completed', () => {
  it('does not call any handler for timeblock.completed topic', async () => {
    const onReviewCompleted = vi.fn().mockResolvedValue(undefined);
    const onTaskAutoCreated = vi.fn().mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReviewCompleted, onTaskAutoCreated });

    await handler(makeSignalEvent('timeblock.completed', {
      block: { id: '1', name: 'test', startTime: 0, endTime: 1 },
      feedbackReport: 'report',
      recentEvents: [],
    }));

    expect(onReviewCompleted).not.toHaveBeenCalled();
    expect(onTaskAutoCreated).not.toHaveBeenCalled();
  });
});
