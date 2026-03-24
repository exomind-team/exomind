import type { SignalEvent } from "../../src/sse/signal-types.js";

export interface TimeblockReviewGuardPayload {
  block: {
    id: string;
    name: string;
    startTime: number;
    endTime: number;
  };
}

export type TimeblockReviewSkipReason =
  | "fresh"
  | "duplicate"
  | "stale_before_agent_start";

export interface TimeblockReviewDecision {
  key: string;
  skip: boolean;
  reason: TimeblockReviewSkipReason;
}

// Small startup grace window（启动宽限窗口）to avoid clock-skew edge cases.
export const TIMEBLOCK_REVIEW_STARTUP_GRACE_MS = 5_000;

export function buildTimeblockReviewKey(
  event: Pick<SignalEvent, "id" | "trace_id">,
  payload: TimeblockReviewGuardPayload,
): string {
  if (event.trace_id && event.trace_id.trim()) {
    return `trace:${event.trace_id.trim()}`;
  }

  return `timeblock:${payload.block.id}:${payload.block.endTime}`;
}

export function decideTimeblockReview(
  input: {
    event: Pick<SignalEvent, "id" | "trace_id">;
    payload: TimeblockReviewGuardPayload;
    processedKeys: ReadonlySet<string>;
    agentStartedAt: number;
  },
): TimeblockReviewDecision {
  const key = buildTimeblockReviewKey(input.event, input.payload);
  if (input.processedKeys.has(key)) {
    return { key, skip: true, reason: "duplicate" };
  }

  if (input.payload.block.endTime + TIMEBLOCK_REVIEW_STARTUP_GRACE_MS < input.agentStartedAt) {
    return { key, skip: true, reason: "stale_before_agent_start" };
  }

  return { key, skip: false, reason: "fresh" };
}
