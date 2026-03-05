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

/** Payload shape for task.auto-created signals. */
export interface TaskAutoCreatedPayload {
  title: string;
  note?: string;
  source_text?: string;
}

/** Payload shape for eventlog.appended signals. */
export interface EventLogAppendedPayload {
  text: string;
  ts: number;
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

/** Options for creating a signal handler dispatcher. */
export interface SignalHandlerOptions {
  onTaskAutoCreated?: (payload: TaskAutoCreatedPayload) => Promise<void>;
  onEventLogAppended?: (payload: EventLogAppendedPayload) => Promise<void>;
  onReviewCompleted?: (payload: ReviewCompletedPayload) => Promise<void>;
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

      case 'eventlog.appended':
        if (options.onEventLogAppended) {
          await options.onEventLogAppended(event.payload as EventLogAppendedPayload);
        }
        break;

      case 'review.completed':
        if (options.onReviewCompleted) {
          await options.onReviewCompleted(event.payload as ReviewCompletedPayload);
        }
        break;
    }
  };
}
