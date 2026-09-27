/**
 * Handoff policy — decides whether consuming a timeblock-end-alert handoff
 * should actually call markEnding() on the active block.
 *
 * Extracted from `TimeblockEndAlertCoordinator.consumePendingHandoff` so the
 * decision can be unit-tested without rendering React.
 *
 * Background: handoff is produced when an Android AlarmManager notification
 * fires and the user taps it (or autoOpenFocus brings the app forward).
 * Originally the coordinator unconditionally called markEnding() in that
 * path, ignoring the user's `countdownEndMode: 'soft' | 'hard'` preference.
 * Soft mode means "remind but keep running"; the handoff path was treating
 * any handoff as a hard stop, which silently stopped running timeblocks.
 */
import type { ActiveBlockData } from '@/lib/types/event';
import type { CountdownEndMode } from '@/config/timer-preferences';
import { resolveTimeBlockPhase } from '@/lib/types/event';

export type HandoffActionKind = 'markEnding' | 'navigateOnly';

export type HandoffDecisionReason =
  | 'no_pending_start_id'
  | 'block_mismatch'
  | 'phase_not_active'
  | 'soft_mode_skip'
  | 'hard_mode_mark_ending';

export interface ResolveHandoffActionInput {
  pendingStartId: string | null | undefined;
  currentBlock: ActiveBlockData | null;
  countdownEndMode: CountdownEndMode;
}

export interface HandoffDecision {
  kind: HandoffActionKind;
  reason: HandoffDecisionReason;
}

/**
 * Decide what to do when a timeblock-end-alert handoff is consumed.
 *
 * Always returns `navigateOnly` unless ALL of:
 *   1. `pendingStartId` is non-empty
 *   2. `currentBlock.startId` matches `pendingStartId`
 *   3. current phase is `running` or `paused`
 *   4. `countdownEndMode === 'hard'`
 *
 * In `soft` mode the timeblock keeps running and the caller should only
 * navigate to the focus page; no markEnding side effect.
 */
export function resolveHandoffAction(
  input: ResolveHandoffActionInput,
): HandoffDecision {
  const { pendingStartId, currentBlock, countdownEndMode } = input;

  if (!pendingStartId) {
    return { kind: 'navigateOnly', reason: 'no_pending_start_id' };
  }

  if (!currentBlock || currentBlock.startId !== pendingStartId) {
    return { kind: 'navigateOnly', reason: 'block_mismatch' };
  }

  const phase = resolveTimeBlockPhase(currentBlock);
  if (phase !== 'running' && phase !== 'paused') {
    return { kind: 'navigateOnly', reason: 'phase_not_active' };
  }

  if (countdownEndMode !== 'hard') {
    return { kind: 'navigateOnly', reason: 'soft_mode_skip' };
  }

  return { kind: 'markEnding', reason: 'hard_mode_mark_ending' };
}
