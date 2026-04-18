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
  type ProposalCreatedPayload,
  type ProposalExecutionFailedPayload,
  type ProposalReplicationUpsertedPayload,
  type ProposalStatusChangedPayload,
  type ReminderReplicationUpsertedPayload,
  type TimeBlockCompletedReplicationPayload,
  type TaskChangedPayload,
  type TaskCancelledPayload,
  type TaskReplicationUpsertedPayload,
  type TaskAutoCreatedPayload,
  type TaskTransitionedPayload,
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

describe('signal-handlers: task lifecycle topics', () => {
  it('calls onTaskCreated when topic is task.created', async () => {
    const onTaskCreated = vi.fn<[TaskChangedPayload], Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = startSignalHandlers({ onTaskCreated });
    const payload: TaskChangedPayload = {
      id: 'task-created-1',
      title: '新任务',
      status: 'pending',
    };

    await handler(makeSignalEvent('task.created', payload));

    expect(onTaskCreated).toHaveBeenCalledTimes(1);
    expect(onTaskCreated).toHaveBeenCalledWith(payload);
  });

  it('calls onTaskUpdated when topic is task.updated', async () => {
    const onTaskUpdated = vi.fn<[TaskChangedPayload], Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = startSignalHandlers({ onTaskUpdated });
    const payload: TaskChangedPayload = {
      id: 'task-updated-1',
      title: '已更新任务',
      status: 'pending',
    };

    await handler(makeSignalEvent('task.updated', payload));

    expect(onTaskUpdated).toHaveBeenCalledTimes(1);
    expect(onTaskUpdated).toHaveBeenCalledWith(payload);
  });

  it('calls onTaskTransitioned when topic is task.transitioned', async () => {
    const onTaskTransitioned = vi.fn<[TaskTransitionedPayload], Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = startSignalHandlers({ onTaskTransitioned });
    const payload: TaskTransitionedPayload = {
      task: {
        id: 'task-transitioned-1',
        title: '迁移中的任务',
        status: 'in_progress',
      },
      old_status: 'pending',
      new_status: 'in_progress',
    };

    await handler(makeSignalEvent('task.transitioned', payload));

    expect(onTaskTransitioned).toHaveBeenCalledTimes(1);
    expect(onTaskTransitioned).toHaveBeenCalledWith(payload);
  });

  it('calls onTaskCancelled when topic is task.cancelled', async () => {
    const onTaskCancelled = vi.fn<[TaskCancelledPayload], Promise<void>>()
      .mockResolvedValue(undefined);
    const handler = startSignalHandlers({ onTaskCancelled });
    const payload: TaskCancelledPayload = {
      id: 'task-cancelled-1',
      title: '已取消任务',
      status: 'cancelled',
    };

    await handler(makeSignalEvent('task.cancelled', payload));

    expect(onTaskCancelled).toHaveBeenCalledTimes(1);
    expect(onTaskCancelled).toHaveBeenCalledWith(payload);
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

  it('calls onActiveBlockReplicationSnapshot when topic is timeblock.replication.active_upserted', async () => {
    const onActiveBlockReplicationSnapshot = vi
      .fn<[ActiveBlockReplicationSnapshotPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onActiveBlockReplicationSnapshot });
    const now = Date.now();
    const payload: ActiveBlockReplicationSnapshotPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      active: {
        startId: 'tb-ecs-2',
        name: '运行时活跃时间块',
        startTime: now - 20_000,
        elapsed: 8_000,
        mode: 'countup',
        paused: false,
        phase: 'running',
        version: 3,
        actorId: 'desktop-host',
        lastTransitionAt: now - 500,
        updatedAt: now - 500,
        pauseAccumulatedMs: 0,
      },
      cursor: {
        kind: 'timeblock_active',
        startId: 'tb-ecs-2',
        updatedAt: now - 500,
        originHostId: 'desktop-host',
      },
    };

    await handler(makeSignalEvent('timeblock.replication.active_upserted', payload));

    expect(onActiveBlockReplicationSnapshot).toHaveBeenCalledTimes(1);
    expect(onActiveBlockReplicationSnapshot).toHaveBeenCalledWith(payload);
  });
});

describe('signal-handlers: task.replication.upserted', () => {
  it('calls onTaskReplicationUpserted when topic is task.replication.upserted', async () => {
    const onTaskReplicationUpserted = vi
      .fn<[TaskReplicationUpsertedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onTaskReplicationUpserted });
    const payload: TaskReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'task_snapshot',
        taskId: 'task-rep-1',
        updatedAt: 1_700_000_001_000,
        originHostId: 'desktop-host',
      },
      task: {
        id: 'task-rep-1',
        title: 'Replicated task',
        status: 'pending',
        priority: 'medium',
        dependsOn: [],
        tags: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        timeBlockIds: [],
      },
    };

    await handler(makeSignalEvent('task.replication.upserted', payload));

    expect(onTaskReplicationUpserted).toHaveBeenCalledTimes(1);
    expect(onTaskReplicationUpserted).toHaveBeenCalledWith(payload);
  });
});

describe('signal-handlers: reminder.replication.upserted', () => {
  it('calls onReminderReplicationUpserted when topic is reminder.replication.upserted', async () => {
    const onReminderReplicationUpserted = vi
      .fn<[ReminderReplicationUpsertedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onReminderReplicationUpserted });
    const payload: ReminderReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'reminder_snapshot',
        reminderId: 'reminder-rep-1',
        updatedAt: 1_700_000_001_000,
        originHostId: 'desktop-host',
      },
      reminder: {
        id: 'reminder-rep-1',
        title: 'Replicated reminder',
        content: 'from peer',
        dueAt: 1_700_000_100_000,
        status: 'pending',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      },
    };

    await handler(makeSignalEvent('reminder.replication.upserted', payload));

    expect(onReminderReplicationUpserted).toHaveBeenCalledTimes(1);
    expect(onReminderReplicationUpserted).toHaveBeenCalledWith(payload);
  });
});

describe('signal-handlers: proposal.replication.upserted', () => {
  it('calls onProposalReplicationUpserted when topic is proposal.replication.upserted', async () => {
    const onProposalReplicationUpserted = vi
      .fn<[ProposalReplicationUpsertedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onProposalReplicationUpserted });
    const payload: ProposalReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_snapshot',
        proposalId: 'proposal-rep-1',
        updatedAt: '2026-04-19T10:00:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-rep-1',
        title: 'Replicated proposal',
        body: 'from peer',
        actionType: 'append_event',
        actionParams: { content: 'from peer' },
        references: [],
        status: 'pending',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        createdAt: '2026-04-19T09:00:00.000Z',
        updatedAt: '2026-04-19T10:00:00.000Z',
      },
    };

    await handler(makeSignalEvent('proposal.replication.upserted', payload));

    expect(onProposalReplicationUpserted).toHaveBeenCalledTimes(1);
    expect(onProposalReplicationUpserted).toHaveBeenCalledWith(payload);
  });
});

describe('signal-handlers: proposal lifecycle topics', () => {
  it('calls onProposalCreated when topic is proposal.created', async () => {
    const onProposalCreated = vi
      .fn<[ProposalCreatedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onProposalCreated });
    const payload: ProposalCreatedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_created',
        proposalId: 'proposal-created-1',
        updatedAt: '2026-04-19T10:00:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-created-1',
        title: 'Created proposal',
        body: 'needs review',
        actionType: 'create_task',
        actionParams: { title: 'Created task' },
        references: [],
        status: 'pending',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        createdAt: '2026-04-19T09:00:00.000Z',
        updatedAt: '2026-04-19T10:00:00.000Z',
      },
    };

    await handler(makeSignalEvent('proposal.created', payload));

    expect(onProposalCreated).toHaveBeenCalledTimes(1);
    expect(onProposalCreated).toHaveBeenCalledWith(payload);
  });

  it('calls onProposalStatusChanged when topic is proposal.status_changed', async () => {
    const onProposalStatusChanged = vi
      .fn<[ProposalStatusChangedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onProposalStatusChanged });
    const payload: ProposalStatusChangedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_status_changed',
        proposalId: 'proposal-status-1',
        updatedAt: '2026-04-19T10:00:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-status-1',
        title: 'Status changed proposal',
        body: 'needs review',
        actionType: 'append_event',
        actionParams: { content: 'append this' },
        references: [],
        status: 'approved',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [],
        createdAt: '2026-04-19T09:00:00.000Z',
        updatedAt: '2026-04-19T10:00:00.000Z',
      },
      transition: {
        fromStatus: 'pending',
        toStatus: 'approved',
      },
    };

    await handler(makeSignalEvent('proposal.status_changed', payload));

    expect(onProposalStatusChanged).toHaveBeenCalledTimes(1);
    expect(onProposalStatusChanged).toHaveBeenCalledWith(payload);
  });

  it('calls onProposalExecutionFailed when topic is proposal.execution_failed', async () => {
    const onProposalExecutionFailed = vi
      .fn<[ProposalExecutionFailedPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onProposalExecutionFailed });
    const payload: ProposalExecutionFailedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'proposal_execution_failed',
        proposalId: 'proposal-failed-1',
        updatedAt: '2026-04-19T10:00:00.000Z',
        originHostId: 'desktop-host',
      },
      proposal: {
        id: 'proposal-failed-1',
        title: 'Failed proposal',
        body: 'needs manual intervention',
        actionType: 'approve_agent_access',
        actionParams: {
          agentId: 'agent-b',
        },
        references: [],
        status: 'approved',
        publisher: {
          publisherType: 'agent',
          id: 'agent-a',
          name: 'Agent A',
        },
        comments: [{
          author: {
            publisherType: 'agent',
            id: 'runtime-executor',
            name: 'Runtime Executor',
          },
          content: '批准后执行失败：not implemented',
          createdAt: '2026-04-19T10:00:00.000Z',
        }],
        createdAt: '2026-04-19T09:00:00.000Z',
        updatedAt: '2026-04-19T10:00:00.000Z',
      },
      execution: {
        failureMessage: 'not implemented',
      },
    };

    await handler(makeSignalEvent('proposal.execution_failed', payload));

    expect(onProposalExecutionFailed).toHaveBeenCalledTimes(1);
    expect(onProposalExecutionFailed).toHaveBeenCalledWith(payload);
  });
});

describe('signal-handlers: timeblock.replication.completed', () => {
  it('calls onTimeBlockCompletedReplication when topic is timeblock.replication.completed', async () => {
    const onTimeBlockCompletedReplication = vi
      .fn<[TimeBlockCompletedReplicationPayload], Promise<void>>()
      .mockResolvedValue(undefined);

    const handler = startSignalHandlers({ onTimeBlockCompletedReplication });
    const payload: TimeBlockCompletedReplicationPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'timeblock_completed',
        blockId: 'tb-rep-1',
        completedAt: 1_700_000_060_000,
        originHostId: 'desktop-host',
      },
      block: {
        id: 'tb-rep-1',
        name: 'Replicated block',
        startId: 'tb-rep-1',
        endId: 'end-rep-1',
        note: 'done',
        tags: ['block_feedback'],
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_060_000,
        blockType: 'active',
        taskIds: [],
        taskAssociationLog: [],
        transitions: [],
      },
    };

    await handler(makeSignalEvent('timeblock.replication.completed', payload));

    expect(onTimeBlockCompletedReplication).toHaveBeenCalledTimes(1);
    expect(onTimeBlockCompletedReplication).toHaveBeenCalledWith(payload);
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
