import type { BetaEvent, BetaQuery, BetaReceipt, BetaStatus } from './client';

export type BetaTimer = { mode: 'count_up' } | { mode: 'count_down'; duration_ms: number; end_mode: 'soft' | 'hard' };
export interface BetaBlockSpec { block_id: string; name: string; note: string; timer: BetaTimer }
export type BetaTimeblockAction =
  | ({ kind: 'start' } & BetaBlockSpec)
  | { kind: 'pause' | 'resume' | 'end_action'; block_id: string }
  | { kind: 'rotate'; from_block_id: string; next: BetaBlockSpec }
  | { kind: 'submit_feedback'; block_id: string; feedback: { kind: 'text'; text: string } | { kind: 'skipped' } }
  | { kind: 'append_feedback'; block_id: string; text: string };
export interface BetaTimeblockCommand {
  command_id: string; event_id: string; profile_id: string;
  expected_revision: string; action: BetaTimeblockAction;
}
export interface BetaDeadline {
  deadline_id: string; generation: number; owner_device_id: string; owner_generation: number;
  due_at_ms: number; remaining_ms: number; end_mode: 'soft' | 'hard'; eligible: boolean;
}
export interface BetaActiveBlock extends BetaBlockSpec {
  phase: 'running' | 'paused' | 'feedback_pending' | 'completed';
  work_ms: number; deadline_reached: boolean; deadline: BetaDeadline | null;
}
export interface BetaTimeblockSnapshot {
  profile_id: string; revision: string; heads: string[]; active: BetaActiveBlock | null;
  pending_feedback: string[];
  clock: { server_now_ms: number; epoch_changed: boolean; wall_clock_moved_back: boolean };
}
export interface BetaTimeblockNode {
  event_id: string; profile_id: string; device_id: string;
  source: { kind: 'human' | 'scheduler'; author_id: string; owner_generation: number | null };
  parents: string[]; occurred_at_ms: number; effective_at_ms: number;
  clock: { epoch_id: string; elapsed_ms: number };
  payload: { kind: 'action'; action: BetaTimeblockAction } | {
    kind: 'deadline_reached'; block_id: string; deadline_id: string; generation: number;
    end_mode: 'soft' | 'hard'; due_wall_ms: number; due_elapsed_ms: number; clock_epoch: string;
  };
  digest: string; local_seq: number;
}
export interface BetaTimeblockNodePage { items: BetaTimeblockNode[]; highwater: number; next_before: number | null }
export type BetaTimelineItem = { kind: 'capture'; record: BetaEvent } | { kind: 'timeblock'; record: BetaTimeblockNode };
export interface BetaTimelinePage { items: BetaTimelineItem[]; highwater: number; next_before: number | null }
export interface BetaIntervalQuery { from_ms: number; to_ms: number; through?: string; limit?: number }
export interface BetaInterval {
  from_ms: number; to_ms: number; kind: 'running' | 'paused' | 'feedback' | 'gap'; block_id: string | null; source_event_ids: string[];
}
export interface BetaIntervalPage { items: BetaInterval[]; revision: string; next_from_ms: number | null; complete: boolean }
export interface BetaDeadlineEnvelope {
  runtime_id: string; device_id: string; profile_id: string; projection_revision: string;
  block_id: string | null; deadline: BetaDeadline | null;
}
export interface BetaTimeblockClient {
  snapshot(profileId: string): Promise<BetaTimeblockSnapshot>;
  command(command: BetaTimeblockCommand): Promise<BetaReceipt>;
  nodes(profileId: string, query: BetaQuery): Promise<BetaTimeblockNodePage>;
  intervals(profileId: string, query: BetaIntervalQuery): Promise<BetaIntervalPage>;
  // Native notification handoff only. Web uses the same snapshot/command APIs;
  // there is no anonymous HTTP scheduler or caller-supplied clock endpoint.
  deadlineEnvelope?(profileId: string, snapshot: BetaTimeblockSnapshot): Promise<BetaDeadlineEnvelope>;
}
export interface BetaTimeblockIO {
  identity(): Promise<BetaStatus>;
  json(profileId: string, path: string, method: string, body?: unknown): Promise<unknown>;
}
