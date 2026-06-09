/**
 * Signal Handlers
 *
 * Frontend signal event handlers for processing signals received via SSE.
 * Each handler maps a signal topic to a callback that processes the payload.
 *
 * These handlers are the bridge between the SignalPool (L2) and frontend
 * services (L3/L4). They do NOT store data themselves -- they delegate
 * to the appropriate service callbacks provided by the caller.
 */

import type { SignalEvent } from '../types/signal-pool';
import type { RuntimeProposalPayload } from '../adapters/proposal-rt-payload';
import type { Event as StorageEvent } from '../storage/event-storage';
import type { EventData, TimeBlockData } from '../types/event';
import type { ProposalStatus } from '../types/proposal';
import type { Reminder } from '../types/reminder';
import type { TaskNode } from '../types/task';

/** Payload shape for task.auto-created signals. */
export interface TaskAutoCreatedPayload {
  title: string;
  note?: string;
  source_text?: string;
}

/** Payload shape for task.created / task.updated signals. */
export interface TaskChangedPayload {
  id: string;
  title: string;
  status: string;
}

/** Payload shape for task.cancelled signals. */
export interface TaskCancelledPayload extends TaskChangedPayload {}

/** Payload shape for task.transitioned signals. */
export interface TaskTransitionedPayload {
  task: TaskChangedPayload;
  old_status: string;
  new_status: string;
}

/** Payload shape for task.replication.upserted signals. */
export interface TaskReplicationUpsertedPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: {
    kind: 'task_snapshot';
    taskId: string;
    updatedAt: number;
    originHostId?: string;
  };
  task: TaskNode;
}

/** Payload shape for reminder.replication.upserted signals. */
export interface ReminderReplicationUpsertedPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: {
    kind: 'reminder_snapshot';
    reminderId: string;
    updatedAt: number;
    originHostId?: string;
  };
  reminder: Reminder;
}

/** Payload shape for proposal.replication.upserted signals. */
export interface ProposalReplicationUpsertedPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: {
    kind: 'proposal_snapshot';
    proposalId: string;
    updatedAt: string;
    originHostId?: string;
  };
  proposal: RuntimeProposalPayload;
}

type ProposalLifecycleCursorKind =
  | 'proposal_created'
  | 'proposal_status_changed'
  | 'proposal_execution_failed';

interface ProposalLifecycleCursor<K extends ProposalLifecycleCursorKind> {
  kind: K;
  proposalId: string;
  updatedAt: string;
  originHostId?: string;
}

interface ProposalLifecycleBasePayload<K extends ProposalLifecycleCursorKind> {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: ProposalLifecycleCursor<K>;
  proposal: RuntimeProposalPayload;
}

/** Payload shape for proposal.created signals. */
export interface ProposalCreatedPayload
  extends ProposalLifecycleBasePayload<'proposal_created'> {}

/** Payload shape for proposal.status_changed signals. */
export interface ProposalStatusChangedPayload
  extends ProposalLifecycleBasePayload<'proposal_status_changed'> {
  transition: {
    fromStatus: ProposalStatus;
    toStatus: ProposalStatus;
  };
}

/** Payload shape for proposal.execution_failed signals. */
export interface ProposalExecutionFailedPayload
  extends ProposalLifecycleBasePayload<'proposal_execution_failed'> {
  execution: {
    failureMessage: string;
  };
}

/** Payload shape for eventlog.appended signals. */
export interface EventLogAppendedPayload {
  text: string;
  ts: number;
  inputMode?: string;
  captureSource?: string;
  targetScope?: string;
  window?: {
    title?: string;
    processName?: string;
  };
  agentContext?: {
    agentId?: string;
    agentName?: string;
    sessionId?: string;
  };
}

/** Payload shape for eventlog.replication.appended signals. */
export interface EventLogReplicationAppendedPayload {
  schemaVersion: 1;
  replicationSeq: number;
  cursor: {
    kind: 'replication_seq';
    value: number;
  };
  event: StorageEvent;
  record?: EventData;
}

/** Payload shape for active_block.replication.snapshot signals. */
export interface ActiveBlockReplicationSnapshotPayload {
  schemaVersion: 1;
  scopeKey?: string;
  block?: TimeBlockData;
  active?: TimeBlockData;
  cursor: {
    kind: 'active_block_snapshot' | 'timeblock_active';
    startId: string;
    version?: number;
    updatedAt?: number;
    lastTransitionAt?: number;
    actorId?: string;
    originHostId?: string;
  };
}

/** Payload shape for timeblock.replication.completed signals. */
export interface TimeBlockCompletedReplicationPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: {
    kind: 'timeblock_completed';
    blockId: string;
    completedAt: number;
    originHostId?: string;
  };
  block: import('../types/event').TimeBlockData;
}

/** Payload shape for review.completed signals. */
export interface ReviewCompletedPayload {
  effective: string;
  stuck: string;
  improve?: string;
  avoid?: string;
  suggestion?: string;
  review_type?: 'session' | 'timeblock';
  block_name?: string;
}

/** Payload shape for device.keyboard.state signals. */
export interface KeyboardStatePayload {
  hasHardwareKeyboard: boolean;
  keyboardType: string;
}

/** Options for creating a signal handler dispatcher. */
export interface SignalHandlerOptions {
  onTaskAutoCreated?: (payload: TaskAutoCreatedPayload) => Promise<void>;
  onTaskCreated?: (payload: TaskChangedPayload) => Promise<void>;
  onTaskUpdated?: (payload: TaskChangedPayload) => Promise<void>;
  onTaskTransitioned?: (payload: TaskTransitionedPayload) => Promise<void>;
  onTaskCancelled?: (payload: TaskCancelledPayload) => Promise<void>;
  onTaskReplicationUpserted?: (payload: TaskReplicationUpsertedPayload) => Promise<void>;
  onReminderReplicationUpserted?: (payload: ReminderReplicationUpsertedPayload) => Promise<void>;
  onProposalReplicationUpserted?: (payload: ProposalReplicationUpsertedPayload) => Promise<void>;
  onProposalCreated?: (payload: ProposalCreatedPayload) => Promise<void>;
  onProposalStatusChanged?: (payload: ProposalStatusChangedPayload) => Promise<void>;
  onProposalExecutionFailed?: (payload: ProposalExecutionFailedPayload) => Promise<void>;
  onEventLogAppended?: (payload: EventLogAppendedPayload) => Promise<void>;
  onEventLogReplicationAppended?: (payload: EventLogReplicationAppendedPayload) => Promise<void>;
  onActiveBlockReplicationSnapshot?: (payload: ActiveBlockReplicationSnapshotPayload) => Promise<void>;
  onTimeBlockCompletedReplication?: (payload: TimeBlockCompletedReplicationPayload) => Promise<void>;
  onReviewCompleted?: (payload: ReviewCompletedPayload) => Promise<void>;
  onKeyboardStateChanged?: (payload: KeyboardStatePayload) => Promise<void>;
}

/**
 * Create a signal event dispatcher that routes events to the appropriate handler.
 *
 * Usage:
 * ```typescript
 * const handler = startSignalHandlers({
 *   onTaskAutoCreated: async (payload) => {
 *     await taskService.create(payload.title, payload.note);
 *   },
 * });
 *
 * // Feed SSE events into the handler
 * for await (const event of sseStream) {
 *   await handler(event);
 * }
 * ```
 */
export function startSignalHandlers(
  options: SignalHandlerOptions,
): (event: SignalEvent) => Promise<void> {
  return async (event: SignalEvent) => {
    switch (event.topic) {
      case 'task.auto-created':
        if (options.onTaskAutoCreated) {
          await options.onTaskAutoCreated(event.payload as TaskAutoCreatedPayload);
        }
        break;

      case 'task.created':
        if (options.onTaskCreated) {
          await options.onTaskCreated(event.payload as TaskChangedPayload);
        }
        break;

      case 'task.updated':
        if (options.onTaskUpdated) {
          await options.onTaskUpdated(event.payload as TaskChangedPayload);
        }
        break;

      case 'task.transitioned':
        if (options.onTaskTransitioned) {
          await options.onTaskTransitioned(event.payload as TaskTransitionedPayload);
        }
        break;

      case 'task.cancelled':
        if (options.onTaskCancelled) {
          await options.onTaskCancelled(event.payload as TaskCancelledPayload);
        }
        break;

      case 'task.replication.upserted':
        if (options.onTaskReplicationUpserted) {
          await options.onTaskReplicationUpserted(event.payload as TaskReplicationUpsertedPayload);
        }
        break;

      case 'reminder.replication.upserted':
        if (options.onReminderReplicationUpserted) {
          await options.onReminderReplicationUpserted(event.payload as ReminderReplicationUpsertedPayload);
        }
        break;

      case 'proposal.replication.upserted':
        if (options.onProposalReplicationUpserted) {
          await options.onProposalReplicationUpserted(event.payload as ProposalReplicationUpsertedPayload);
        }
        break;

      case 'proposal.created':
        if (options.onProposalCreated) {
          await options.onProposalCreated(event.payload as ProposalCreatedPayload);
        }
        break;

      case 'proposal.status_changed':
        if (options.onProposalStatusChanged) {
          await options.onProposalStatusChanged(event.payload as ProposalStatusChangedPayload);
        }
        break;

      case 'proposal.execution_failed':
        if (options.onProposalExecutionFailed) {
          await options.onProposalExecutionFailed(event.payload as ProposalExecutionFailedPayload);
        }
        break;

      case 'eventlog.appended':
        if (options.onEventLogAppended) {
          await options.onEventLogAppended(event.payload as EventLogAppendedPayload);
        }
        break;

      case 'eventlog.replication.appended':
        if (options.onEventLogReplicationAppended) {
          await options.onEventLogReplicationAppended(event.payload as EventLogReplicationAppendedPayload);
        }
        break;

      case 'active_block.replication.snapshot':
      case 'timeblock.replication.active_upserted':
        if (options.onActiveBlockReplicationSnapshot) {
          await options.onActiveBlockReplicationSnapshot(event.payload as ActiveBlockReplicationSnapshotPayload);
        }
        break;

      case 'timeblock.replication.completed':
        if (options.onTimeBlockCompletedReplication) {
          await options.onTimeBlockCompletedReplication(event.payload as TimeBlockCompletedReplicationPayload);
        }
        break;

      case 'review.completed':
        if (options.onReviewCompleted) {
          await options.onReviewCompleted(event.payload as ReviewCompletedPayload);
        }
        break;

      case 'device.keyboard.state':
        if (options.onKeyboardStateChanged) {
          await options.onKeyboardStateChanged(event.payload as KeyboardStatePayload);
        }
        break;
    }
  };
}
