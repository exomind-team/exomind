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
import type { Event as StorageEvent } from '../storage/event-storage';
import type { ActiveBlockData } from '../types/event';

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

/** Payload shape for task.transitioned signals. */
export interface TaskTransitionedPayload {
  task: TaskChangedPayload;
  old_status: string;
  new_status: string;
}

/** Payload shape for eventlog.appended signals. */
export interface EventLogAppendedPayload {
  text: string;
  ts: number;
  inputMode?: string;
  captureSource?: string;
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
}

/** Payload shape for active_block.replication.snapshot signals. */
export interface ActiveBlockReplicationSnapshotPayload {
  schemaVersion: 1;
  block: ActiveBlockData;
  cursor: {
    kind: 'active_block_snapshot';
    startId: string;
    version: number;
    lastTransitionAt: number;
    actorId?: string;
  };
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
  onEventLogAppended?: (payload: EventLogAppendedPayload) => Promise<void>;
  onEventLogReplicationAppended?: (payload: EventLogReplicationAppendedPayload) => Promise<void>;
  onActiveBlockReplicationSnapshot?: (payload: ActiveBlockReplicationSnapshotPayload) => Promise<void>;
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
        if (options.onActiveBlockReplicationSnapshot) {
          await options.onActiveBlockReplicationSnapshot(event.payload as ActiveBlockReplicationSnapshotPayload);
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
