import type { BetaOriginal } from './original-types';
import type { BetaReceipt } from './client';

/** Public wire DTOs mirror exomind-core/src/summaries/model.rs. Transport
 * adapters must validate UUIDs, digests, scopes, lengths and safe integers;
 * TypeScript declarations alone do not validate a Native/HTTP response.
 * ExecutorContext, RunTicket and input bundles are deliberately not exposed. */
export const MAX_SUMMARY_SOURCES = 1000;
export const MAX_SUMMARY_PAGE_SIZE = 100;
export const MAX_SUMMARY_ATTEMPTS = 8;
export const MAX_SUMMARY_SAFE_COUNTER = Number.MAX_SAFE_INTEGER;
export const MAX_SUMMARY_CONTROL_HEADS = 512;
// Incomplete graphs can include missing external parents in diagnostics.
// Root/Core's current public projection bound is larger than the job count.
export const MAX_SUMMARY_CONFLICTS = 66560;
// Core's frozen input bundle. Host reserves the remaining request budget for
// system instructions and provider wrapping; those are separate byte limits.
export const MAX_SUMMARY_INPUT_ENCODED_BYTES = 192 * 1024;
export type SummaryState = 'waiting_configuration' | 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'cancelled';
export type SummaryPurpose = 'first_review_v1' | 'manual_compress_v1';
export type SummaryArtifactKind = 'review' | 'compressed_block' | 'compressed_message' | 'external_summary';
export type SummaryMaterialState = 'not_selected' | 'missing' | 'verified_available' | 'metadata_only' | 'read_failed';
export type SummaryRemoteVisibility = 'unknown' | 'known_gap' | 'frozen_known_heads';
export type SummaryFailureKind = 'timeout' | 'rate_limited' | 'provider_unavailable' | 'provider_rejected' | 'invalid_output' | 'external_outcome_unknown' | 'input_too_large' | 'material_unavailable' | 'unsupported_material' | 'configuration_changed';

export interface SummarySelection { block_ids: string[]; from_ms: number; to_ms: number; selected_original_ids: string[] }
export interface SummarySourceRef { event_id: string; kind: string; digest: string }
export interface SummaryOriginHead {
  origin: { profile_id: string; device_id: string; restoration_epoch: string };
  cursor: { seq: number; hash: string };
}
export interface SummaryMaterial { original: BetaOriginal; selected: boolean; read_state: SummaryMaterialState }
export interface SummaryCoverage {
  page_limit: boolean;
  input_byte_limit: boolean;
  omitted_source_ids: string[];
  read_failures: string[];
  missing_parents: string[];
  metadata_only: string[];
  unread_originals: string[];
  remote_visibility: SummaryRemoteVisibility;
}
export interface SummarySourceSnapshot {
  selection: SummarySelection;
  sources: SummarySourceRef[];
  feedback_ids: string[];
  origin_heads: SummaryOriginHead[];
  through: number;
  input_encoded_bytes: number;
  materials: SummaryMaterial[];
  coverage: SummaryCoverage;
  digest: string;
}
export interface SummaryAttemptView { attempt_id: string; number: number; state: SummaryState; reason: string | null; retry_at_ms: number | null }
export interface SummaryRunView {
  run_id: string;
  run_generation: number;
  owner_generation: number;
  snapshot: SummarySourceSnapshot | null;
  attempt: SummaryAttemptView | null;
}
export interface SummaryTaskView {
  task_id: string;
  profile_id: string;
  purpose: SummaryPurpose;
  artifact_kind: SummaryArtifactKind;
  selection: SummarySelection;
  created_at_ms: number;
  trigger_key: string;
  creator_event_id: string;
  owner_device_id: string;
  owner_generation: number;
  owner_control_event_id: string;
  current_run: SummaryRunView | null;
  state: SummaryState;
  reason: string | null;
  control_heads: string[];
  conflicts: string[];
  latest_artifact_id: string | null;
  coverage_changed: boolean;
}
export interface SummaryTaskPage { items: SummaryTaskView[]; next_after: string | null }
export interface SummaryModelMetadata { provider: string; model: string; role_config_digest: string; request_input_digest: string; prompt_template: string; include_suggestions: boolean; max_output_tokens: number; requested_model: string }
export interface SummaryUsage { input_tokens: number | null; output_tokens: number | null; provider_request_id: string | null }
export interface SummaryOutput { narrative: string; evidence: string[]; read_original_ids: string[]; model: SummaryModelMetadata; usage: SummaryUsage }
export interface SummaryArtifactView {
  event_id: string;
  profile_id: string;
  occurred_at_ms: number;
  device_id: string;
  author_id: string;
  task_id: string;
  run_id: string;
  attempt_id: string;
  artifact_kind: SummaryArtifactKind;
  snapshot: SummarySourceSnapshot;
  output: SummaryOutput;
  supersedes_artifact_id: string | null;
  current: boolean;
  reason: string | null;
}
export interface SummaryArtifactPage { items: SummaryArtifactView[]; next_before: number | null; highwater: number }
/** Immutable timeline fact. Current qualification must be read from the task
 * and ArtifactView; a replicated record alone is not a succeeded task. */
export interface SummaryArtifactRecord {
  event_id: string;
  profile_id: string;
  device_id: string;
  author_id: string;
  task_id: string;
  run_id: string;
  attempt_id: string;
  owner_generation: number;
  owner_control_event_id: string;
  artifact_kind: SummaryArtifactKind;
  snapshot: SummarySourceSnapshot;
  output: SummaryOutput;
  supersedes_artifact_id: string | null;
  occurred_at_ms: number;
  digest: string;
  local_seq: number;
}
export interface SummaryRequestCommand { command_id: string; event_id: string; profile_id: string; purpose: SummaryPurpose; artifact_kind: SummaryArtifactKind; selection: SummarySelection }
/** Local Host execution permission. Never part of a Core command or replicated fact. */
export interface SummaryMaterialConsent { provider_config_revision:string; max_original_bytes:number }
export interface SummaryMaterialRequest { command:SummaryRequestCommand; consent:SummaryMaterialConsent }
export interface SummaryMaterialControl { command:SummaryControlCommand; consent:SummaryMaterialConsent }
export type SummaryControlAction =
  | { kind: 'cancel' }
  | { kind: 'take_over_for_self'; run_id: string; resume_cancelled: boolean }
  | { kind: 'resolve_owner'; run_id: string; owner_device_id: string; resume_cancelled: boolean }
  | { kind: 'queue_update'; run_id: string; selection: SummarySelection; supersedes_artifact_id: string | null };
export interface SummaryControlCommand {
  command_id: string;
  event_id: string;
  profile_id: string;
  task_id: string;
  expected_owner_generation: number;
  expected_owner_control_event_id: string;
  expected_control_heads: string[];
  action: SummaryControlAction;
}
export interface SummaryServiceStatus { running:boolean; active_profile_id:string|null; active_task_id:string|null; last_error_code:string|null }
export interface SummaryClient {
  tasks(profileId:string,after?:string|null,limit?:number):Promise<SummaryTaskPage>;
  task(profileId:string,taskId:string):Promise<SummaryTaskView>;
  artifacts(profileId:string,taskId:string,before?:number|null,limit?:number):Promise<SummaryArtifactPage>;
  blockSelection(profileId:string,blockId:string):Promise<SummarySelection>;
  request(command:SummaryRequestCommand):Promise<BetaReceipt>;
  control(command:SummaryControlCommand):Promise<BetaReceipt>;
  requestWithMaterialConsent?(input:SummaryMaterialRequest):Promise<BetaReceipt>;
  controlWithMaterialConsent?(input:SummaryMaterialControl):Promise<BetaReceipt>;
  /** This read requires owner authority. It is absent for scoped-only HTTP IO. */
  serviceStatus?():Promise<SummaryServiceStatus>;
}
