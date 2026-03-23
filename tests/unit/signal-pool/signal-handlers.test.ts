// signal-handlers.test.ts — SignalPool Phase 2 signal handler dispatch tests
//
// Tests the startSignalHandlers() dispatcher from signal-handlers.ts.
// Verifies that SSE signal events are correctly routed to the appropriate
// callback based on topic, and that unknown topics are silently ignored.
//
// Signal contract tested:
//   task.auto-created   -> onTaskAutoCreated({ title, note?, source_text? })
//   eventlog.appended   -> onEventLogAppended({ text, ts })
//   review.completed    -> onReviewCompleted({ effective, stuck, improve, avoid })
//   <unknown topic>     -> no callback invoked

import { describe, expect, it, vi } from 'vitest';
import {
  startSignalHandlers,
  type ActiveBlockReplicationSnapshotPayload,
  type TaskAutoCreatedPayload,
  type EventLogAppendedPayload,
  type EventLogReplicationAppendedPayload,
  type ReviewCompletedPayload,
  type SignalHandlerOptions,
} from '@/lib/services/signal-handlers';
import type { SignalEvent } from '@/lib/types/signal-pool';

// ── Helper: construct a minimal SignalEvent for testing ──

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
//  1. task.auto-created handler
// ═══════════════════════════════════════════════════════

describe('signal-handlers: task.auto-created', () => {
  it('calls onTaskAutoCreated when topic is task.auto-created', async () => {
    const onTaskAutoCreated = vi.fn<[TaskAutoCreatedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onTaskAutoCreated });

    const payload: TaskAutoCreatedPayload = {
      title: '完成 Phase 2 测试',
      note: '覆盖所有 actor',
      source_text: '我需要完成测试',
    };

    await handler(makeSignalEvent('task.auto-created', payload));

    expect(onTaskAutoCreated).toHaveBeenCalledTimes(1);
    expect(onTaskAutoCreated).toHaveBeenCalledWith(payload);
  });

  it('passes payload with optional note omitted', async () => {
    const onTaskAutoCreated = vi.fn<[TaskAutoCreatedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onTaskAutoCreated });

    const payload: TaskAutoCreatedPayload = {
      title: '无备注任务',
    };

    await handler(makeSignalEvent('task.auto-created', payload));

    expect(onTaskAutoCreated).toHaveBeenCalledTimes(1);
    expect(onTaskAutoCreated).toHaveBeenCalledWith(
      expect.objectContaining({ title: '无备注任务' }),
    );
  });

  it('does not crash when onTaskAutoCreated is not provided', async () => {
    const handler = startSignalHandlers({});

    // Should not throw
    await expect(
      handler(
        makeSignalEvent('task.auto-created', {
          title: '测试',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
//  2. eventlog.appended handler
// ═══════════════════════════════════════════════════════

describe('signal-handlers: eventlog.appended', () => {
  it('calls onEventLogAppended when topic is eventlog.appended', async () => {
    const onEventLogAppended = vi.fn<[EventLogAppendedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onEventLogAppended });

    const payload: EventLogAppendedPayload = {
      text: '今天完成了架构设计',
      ts: 1700000000000,
    };

    await handler(makeSignalEvent('eventlog.appended', payload));

    expect(onEventLogAppended).toHaveBeenCalledTimes(1);
    expect(onEventLogAppended).toHaveBeenCalledWith(payload);
  });

  it('passes payload with correct ts (epoch ms)', async () => {
    const onEventLogAppended = vi.fn<[EventLogAppendedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onEventLogAppended });

    const now = Date.now();
    const payload: EventLogAppendedPayload = {
      text: '事件记录',
      ts: now,
    };

    await handler(makeSignalEvent('eventlog.appended', payload));

    const received = onEventLogAppended.mock.calls[0][0];
    expect(received.ts).toBe(now);
    expect(received.text).toBe('事件记录');
  });

  it('does not crash when onEventLogAppended is not provided', async () => {
    const handler = startSignalHandlers({});

    await expect(
      handler(
        makeSignalEvent('eventlog.appended', {
          text: '测试',
          ts: Date.now(),
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('signal-handlers: eventlog.replication.appended', () => {
  it('calls onEventLogReplicationAppended when topic is eventlog.replication.appended', async () => {
    const onEventLogReplicationAppended = vi
      .fn<[EventLogReplicationAppendedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onEventLogReplicationAppended });
    const payload: EventLogReplicationAppendedPayload = {
      schemaVersion: 1,
      replicationSeq: 9,
      cursor: {
        kind: 'replication_seq',
        value: 9,
      },
      event: {
        id: 'evt-rep-1',
        content: '跨端同步事件',
        createdAt: '2026-03-07T00:00:00.000Z',
        type: 'note',
        replicationSeq: 9,
      },
    };

    await handler(makeSignalEvent('eventlog.replication.appended', payload));

    expect(onEventLogReplicationAppended).toHaveBeenCalledTimes(1);
    expect(onEventLogReplicationAppended).toHaveBeenCalledWith(payload);
  });
});

describe('signal-handlers: active_block.replication.snapshot', () => {
  it('calls onActiveBlockReplicationSnapshot when topic is active_block.replication.snapshot', async () => {
    const onActiveBlockReplicationSnapshot = vi
      .fn<[ActiveBlockReplicationSnapshotPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onActiveBlockReplicationSnapshot });
    const now = Date.now();
    const payload: ActiveBlockReplicationSnapshotPayload = {
      schemaVersion: 1,
      block: {
        startId: 'tb-ecs-1',
        name: '跨端时间块',
        startTime: now - 10_000,
        elapsed: 5_000,
        mode: 'countup',
        paused: false,
        phase: 'running',
        version: 2,
        actorId: 'desktop',
        lastTransitionAt: now - 1_000,
        lastResumedAt: now - 1_000,
        accumulatedRunMs: 5_000,
        updatedAt: now - 1_000,
        pauseAccumulatedMs: 0,
      },
      cursor: {
        kind: 'active_block_snapshot',
        startId: 'tb-ecs-1',
        version: 2,
        lastTransitionAt: now - 1_000,
        actorId: 'desktop',
      },
    };

    await handler(makeSignalEvent('active_block.replication.snapshot', payload));

    expect(onActiveBlockReplicationSnapshot).toHaveBeenCalledTimes(1);
    expect(onActiveBlockReplicationSnapshot).toHaveBeenCalledWith(payload);
  });
});

// ═══════════════════════════════════════════════════════
//  3. review.completed handler
// ═══════════════════════════════════════════════════════

describe('signal-handlers: review.completed', () => {
  it('calls onReviewCompleted when topic is review.completed', async () => {
    const onReviewCompleted = vi.fn<[ReviewCompletedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReviewCompleted });

    const payload: ReviewCompletedPayload = {
      effective: '完成了架构设计和测试骨架',
      stuck: '等待 agent-chain 实现',
      improve: '可以提前写更详细的 SPEC',
      avoid: '不要跳过评审步骤',
    };

    await handler(makeSignalEvent('review.completed', payload));

    expect(onReviewCompleted).toHaveBeenCalledTimes(1);
    expect(onReviewCompleted).toHaveBeenCalledWith(payload);
  });

  it('passes all four review fields correctly', async () => {
    const onReviewCompleted = vi.fn<[ReviewCompletedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReviewCompleted });

    const payload: ReviewCompletedPayload = {
      effective: '做得好的方面',
      stuck: '卡住的地方',
      improve: '可以改进的',
      avoid: '应该避免的',
    };

    await handler(makeSignalEvent('review.completed', payload));

    const received = onReviewCompleted.mock.calls[0][0];
    expect(received.effective).toBe('做得好的方面');
    expect(received.stuck).toBe('卡住的地方');
    expect(received.improve).toBe('可以改进的');
    expect(received.avoid).toBe('应该避免的');
  });

  it('does not crash when onReviewCompleted is not provided', async () => {
    const handler = startSignalHandlers({});

    await expect(
      handler(
        makeSignalEvent('review.completed', {
          effective: 'a',
          stuck: 'b',
          improve: 'c',
          avoid: 'd',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
//  4. Unknown topic handling
// ═══════════════════════════════════════════════════════

describe('signal-handlers: unknown topics', () => {
  it('does not call any handler for unknown topic', async () => {
    const onTaskAutoCreated = vi.fn().mockResolvedValue(undefined);
    const onEventLogAppended = vi.fn().mockResolvedValue(undefined);
    const onReviewCompleted = vi.fn().mockResolvedValue(undefined);

    const handler = startSignalHandlers({
      onTaskAutoCreated,
      onEventLogAppended,
      onReviewCompleted,
    });

    await handler(
      makeSignalEvent('user.input.text', { text: '这不是已知 topic' }),
    );

    expect(onTaskAutoCreated).not.toHaveBeenCalled();
    expect(onEventLogAppended).not.toHaveBeenCalled();
    expect(onReviewCompleted).not.toHaveBeenCalled();
  });

  it('does not call any handler for input.classified topic', async () => {
    const onTaskAutoCreated = vi.fn().mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onTaskAutoCreated });

    await handler(
      makeSignalEvent('input.classified', {
        type: 'task',
        items: [{ title: 'test' }],
      }),
    );

    // input.classified is NOT task.auto-created
    expect(onTaskAutoCreated).not.toHaveBeenCalled();
  });

  it('does not call any handler for session.end topic', async () => {
    const onReviewCompleted = vi.fn().mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReviewCompleted });

    await handler(
      makeSignalEvent('session.end', {
        events: [{ text: 'test', ts: Date.now() }],
      }),
    );

    // session.end is NOT review.completed
    expect(onReviewCompleted).not.toHaveBeenCalled();
  });

  it('does not throw for completely unknown topic with no handlers', async () => {
    const handler = startSignalHandlers({});

    await expect(
      handler(makeSignalEvent('completely.unknown.topic', { foo: 'bar' })),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
//  5. Multiple events in sequence
// ═══════════════════════════════════════════════════════

describe('signal-handlers: sequential dispatch', () => {
  it('correctly dispatches multiple different events in sequence', async () => {
    const onTaskAutoCreated = vi.fn().mockResolvedValue(undefined);
    const onEventLogAppended = vi.fn().mockResolvedValue(undefined);
    const onReviewCompleted = vi.fn().mockResolvedValue(undefined);

    const handler = startSignalHandlers({
      onTaskAutoCreated,
      onEventLogAppended,
      onReviewCompleted,
    });

    // Simulate a sequence of events as they would arrive via SSE
    await handler(
      makeSignalEvent('eventlog.appended', {
        text: '开始工作',
        ts: 1700000000000,
      }),
    );
    await handler(
      makeSignalEvent('task.auto-created', {
        title: '完成测试',
        source_text: '需要完成测试',
      }),
    );
    await handler(
      makeSignalEvent('eventlog.appended', {
        text: '结束工作',
        ts: 1700000001000,
      }),
    );
    await handler(
      makeSignalEvent('review.completed', {
        effective: 'a',
        stuck: 'b',
        improve: 'c',
        avoid: 'd',
      }),
    );

    expect(onEventLogAppended).toHaveBeenCalledTimes(2);
    expect(onTaskAutoCreated).toHaveBeenCalledTimes(1);
    expect(onReviewCompleted).toHaveBeenCalledTimes(1);
  });

  it('handler is reusable across multiple calls', async () => {
    const onTaskAutoCreated = vi.fn().mockResolvedValue(undefined);
    const handler = startSignalHandlers({ onTaskAutoCreated });

    for (let i = 0; i < 5; i++) {
      await handler(
        makeSignalEvent('task.auto-created', {
          title: `Task ${i}`,
        }),
      );
    }

    expect(onTaskAutoCreated).toHaveBeenCalledTimes(5);
  });
});
