//! B3 portable DTO contract. Executors/tickets below are deliberately not wire DTOs.
use crate::{
    CommandId, CorrectionRecord, DeviceId, EventId, OriginCursor, OriginIdentity, OriginalId,
    OriginalRef, ProfileId, Receipt, TimeblockId,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type SummaryTaskId = Uuid;
pub type SummaryRunId = Uuid;
pub type SummaryAttemptId = Uuid;
pub const MAX_SUMMARY_SOURCES: usize = 1000;
pub const MAX_SUMMARY_INPUT_BYTES: usize = 192 * 1024;
pub const MAX_SUMMARY_PAGE_SIZE: usize = 100;
pub const MAX_SUMMARY_ATTEMPTS: u32 = 8;
pub const MAX_SUMMARY_SAFE_COUNTER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryState {
    WaitingConfiguration,
    Queued,
    Running,
    RetryWait,
    Succeeded,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryPurpose {
    FirstReviewV1,
    ManualCompressV1,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryArtifactKind {
    Review,
    CompressedBlock,
    CompressedMessage,
    ExternalSummary,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummarySelection {
    pub block_ids: Vec<TimeblockId>,
    pub from_ms: i64,
    pub to_ms: i64,
    #[serde(default)]
    pub selected_original_ids: Vec<OriginalId>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummarySourceRef {
    pub event_id: EventId,
    pub kind: String,
    pub digest: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryOriginHead {
    pub origin: OriginIdentity,
    pub cursor: OriginCursor,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryMaterialState {
    NotSelected,
    Missing,
    VerifiedAvailable,
    MetadataOnly,
    ReadFailed,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryMaterial {
    pub original: OriginalRef,
    pub selected: bool,
    pub read_state: SummaryMaterialState,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryRemoteVisibility {
    Unknown,
    KnownGap,
    FrozenKnownHeads,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryCoverage {
    pub page_limit: bool,
    pub input_byte_limit: bool,
    pub omitted_source_ids: Vec<EventId>,
    pub read_failures: Vec<EventId>,
    pub missing_parents: Vec<EventId>,
    pub metadata_only: Vec<OriginalId>,
    pub unread_originals: Vec<OriginalId>,
    pub remote_visibility: SummaryRemoteVisibility,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummarySourceSnapshot {
    pub selection: SummarySelection,
    pub sources: Vec<SummarySourceRef>,
    pub feedback_ids: Vec<EventId>,
    pub origin_heads: Vec<SummaryOriginHead>,
    pub through: u64,
    pub input_encoded_bytes: u64,
    pub materials: Vec<SummaryMaterial>,
    pub coverage: SummaryCoverage,
    pub digest: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryAttemptView {
    pub attempt_id: SummaryAttemptId,
    pub number: u32,
    pub state: SummaryState,
    pub reason: Option<String>,
    pub retry_at_ms: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryRunView {
    pub run_id: SummaryRunId,
    pub run_generation: u64,
    pub owner_generation: u64,
    pub snapshot: Option<SummarySourceSnapshot>,
    pub attempt: Option<SummaryAttemptView>,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryTaskView {
    pub task_id: SummaryTaskId,
    pub profile_id: ProfileId,
    pub purpose: SummaryPurpose,
    pub artifact_kind: SummaryArtifactKind,
    pub selection: SummarySelection,
    pub created_at_ms: i64,
    pub trigger_key: String,
    pub creator_event_id: EventId,
    pub owner_device_id: DeviceId,
    pub owner_generation: u64,
    pub owner_control_event_id: EventId,
    pub current_run: Option<SummaryRunView>,
    pub state: SummaryState,
    pub reason: Option<String>,
    pub control_heads: Vec<EventId>,
    pub conflicts: Vec<EventId>,
    pub latest_artifact_id: Option<EventId>,
    pub coverage_changed: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryTaskPage {
    pub items: Vec<SummaryTaskView>,
    pub next_after: Option<SummaryTaskId>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryRequestCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub purpose: SummaryPurpose,
    pub artifact_kind: SummaryArtifactKind,
    pub selection: SummarySelection,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SummaryControlAction {
    Cancel,
    TakeOverForSelf {
        run_id: SummaryRunId,
        resume_cancelled: bool,
    },
    ResolveOwner {
        run_id: SummaryRunId,
        owner_device_id: DeviceId,
        resume_cancelled: bool,
    },
    QueueUpdate {
        run_id: SummaryRunId,
        selection: SummarySelection,
        supersedes_artifact_id: Option<EventId>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryControlCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub task_id: SummaryTaskId,
    pub expected_owner_generation: u64,
    pub expected_owner_control_event_id: EventId,
    pub expected_control_heads: Vec<EventId>,
    pub action: SummaryControlAction,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryBeginCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub task_id: SummaryTaskId,
    pub expected_owner_generation: u64,
    pub expected_owner_control_event_id: EventId,
    pub expected_run_id: SummaryRunId,
    pub attempt_id: SummaryAttemptId,
    pub role_config_digest: String,
    pub max_attempts: u32,
    pub now_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryModelMetadata {
    pub provider: String,
    pub model: String,
    pub role_config_digest: String,
    pub request_input_digest: String,
    pub prompt_template: String,
    pub include_suggestions: bool,
    pub max_output_tokens: u32,
    pub requested_model: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub provider_request_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryOutput {
    pub narrative: String,
    pub evidence: Vec<EventId>,
    pub read_original_ids: Vec<OriginalId>,
    pub model: SummaryModelMetadata,
    pub usage: SummaryUsage,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryArtifactView {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub occurred_at_ms: i64,
    pub device_id: DeviceId,
    pub author_id: Uuid,
    pub task_id: SummaryTaskId,
    pub run_id: SummaryRunId,
    pub attempt_id: SummaryAttemptId,
    pub artifact_kind: SummaryArtifactKind,
    pub snapshot: SummarySourceSnapshot,
    pub output: SummaryOutput,
    pub supersedes_artifact_id: Option<EventId>,
    pub current: bool,
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryArtifactPage {
    pub items: Vec<SummaryArtifactView>,
    pub next_before: Option<u64>,
    pub highwater: u64,
}
#[derive(Debug)]
pub struct SummaryExecutorContext {
    pub(super) lifecycle: Uuid,
    pub(super) device_id: DeviceId,
}
/// Not serializable, constructible from DTOs or portable between Core openings.
#[derive(Debug)]
pub struct SummaryRunTicket {
    pub(super) lifecycle: Uuid,
    pub(super) profile_id: ProfileId,
    pub(super) task_id: SummaryTaskId,
    pub(super) run_id: SummaryRunId,
    pub(super) attempt_id: SummaryAttemptId,
    pub(super) owner_generation: u64,
    pub(super) owner_control_event_id: EventId,
    pub(super) snapshot_digest: String,
}
#[derive(Debug)]
pub struct SummaryWork {
    pub ticket: SummaryRunTicket,
    pub snapshot: SummarySourceSnapshot,
    pub receipt: Receipt,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum SummaryCommitOutcome {
    Applied {
        receipt: Receipt,
        artifact_event_id: EventId,
    },
    Stale,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum SummaryAttemptOutcome {
    Applied { receipt: Receipt },
    Stale,
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryReconcileResult {
    pub created: Vec<SummaryTaskId>,
    pub existing: Vec<SummaryTaskId>,
    pub blocked: Vec<TimeblockId>,
    pub has_more: bool,
}

/// Internal-only correction material with per-origin ordering. This is not an
/// ExternalSummary source DTO; snapshot refs continue to carry only id/kind/digest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryCorrectionInput {
    pub fact: CorrectionRecord,
    pub origin: OriginIdentity,
    pub cursor: OriginCursor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "record", deny_unknown_fields)]
pub enum SummaryInputRecord {
    #[serde(rename = "capture")]
    Capture(crate::EventRecord),
    #[serde(rename = "timeblock/1")]
    Timeblock(crate::TimeblockNodeRecord),
    #[serde(rename = "correction/1")]
    Correction(SummaryCorrectionInput),
}
#[derive(Debug, Clone, Serialize)]
pub struct SummaryInputRecords {
    pub snapshot_digest: String,
    pub records: Vec<SummaryInputRecord>,
    pub encoded_bytes: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryFailureKind {
    Timeout,
    RateLimited,
    ProviderUnavailable,
    ProviderRejected,
    InvalidOutput,
    ExternalOutcomeUnknown,
    InputTooLarge,
    MaterialUnavailable,
    UnsupportedMaterial,
    ConfigurationChanged,
}

/// Portable job control/execution facts. No ticket or provider credential is
/// accepted from these records; raw import cannot acquire local execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryActorKind {
    Human,
    Executor,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SummaryJobPayload {
    Requested {
        trigger_key: String,
        creator_event_id: EventId,
        default_owner_device_id: DeviceId,
        purpose: SummaryPurpose,
        artifact_kind: SummaryArtifactKind,
        selection: SummarySelection,
        initial_run_id: SummaryRunId,
    },
    Controlled {
        expected_owner_generation: u64,
        expected_owner_control_event_id: EventId,
        action: SummaryControlAction,
    },
    Execution {
        run_id: SummaryRunId,
        owner_generation: u64,
        owner_control_event_id: EventId,
        state: SummaryState,
        reason: Option<String>,
        attempt_id: Option<SummaryAttemptId>,
        attempt_number: u32,
        retry_at_ms: Option<i64>,
        snapshot: Option<SummarySourceSnapshot>,
        role_config_digest: Option<String>,
        max_attempts: u32,
    },
    Published {
        run_id: SummaryRunId,
        attempt_id: SummaryAttemptId,
        owner_generation: u64,
        owner_control_event_id: EventId,
        artifact_event_id: EventId,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryJobRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub author_id: Uuid,
    pub actor_kind: SummaryActorKind,
    pub task_id: SummaryTaskId,
    pub parents: Vec<EventId>,
    pub occurred_at_ms: i64,
    pub payload: SummaryJobPayload,
    pub digest: String,
    pub local_seq: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryArtifactRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub author_id: Uuid,
    pub task_id: SummaryTaskId,
    pub run_id: SummaryRunId,
    pub attempt_id: SummaryAttemptId,
    pub owner_generation: u64,
    pub owner_control_event_id: EventId,
    pub artifact_kind: SummaryArtifactKind,
    pub snapshot: SummarySourceSnapshot,
    pub output: SummaryOutput,
    pub supersedes_artifact_id: Option<EventId>,
    pub occurred_at_ms: i64,
    pub digest: String,
    pub local_seq: u64,
}
