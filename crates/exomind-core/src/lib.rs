//! Beta local commit boundary, independent of transports and legacy storage.
//!
//! A successful receipt confirms one SQLite transaction, not delivery to peers.
//! Trusted embedding code opens local profile sessions; network authentication
//! must be completed by an adapter before calling this API.

mod capture_fact;
mod external_summaries;
mod fact_encoding;
mod identity;
mod manifests;
mod migrations;
mod original_query;
pub(crate) mod original_lifecycle;
mod originals;
mod record_organization;
mod replication;
mod store;
mod summaries;
mod timeblocks;

pub use external_summaries::*;
pub use identity::{
    AgentId, CommandId, DeviceId, EventId, InvalidIdentifier, OriginalId, ProfileId, StageId,
    TimeblockId,
};
pub use manifests::OriginalAvailability;
pub use original_query::MissingOriginalsPage;
pub use original_lifecycle::{
    OriginalBytesState, OriginalLifecycleAction, OriginalLifecycleCommand,
    OriginalLifecycleFollowup, OriginalLifecycleFollowupPage,
    OriginalLifecycleFollowupResolution, OriginalLifecycleClock, OriginalLifecycleRecord, OriginalLifecycleStatus,
    OriginalReadPermit, DEFAULT_ORIGINAL_RECLAIM_WINDOW_MS, ORIGINAL_LIFECYCLE_FACT_TYPE,
};
pub use originals::{
    BeginStageCommand, MAX_CAPTURE_ORIGINALS, MAX_ORIGINAL_CHUNK_BYTES, OriginalChunk, OriginalRef,
    OriginalRestoreRetry, StageState, StageStatus, VerificationProof, VerificationTicket,
};
pub use record_organization::{
    CorrectionEntry, CorrectionPage, CorrectionRecord, CorrectionTargetState, MAX_EVENT_TAG_BYTES,
    RecordCorrectionCommand,
};
pub use replication::{
    DEFAULT_ORIGIN_PAGE_BYTES, ImportAck, MAX_ORIGIN_PAGE_BYTES, OriginCursor, OriginEntry,
    OriginIdentity, OriginPage, OriginPageProof, OriginPageQuery, OriginProvenanceKey,
    OriginReceiveState, OriginSnapshot, ReplicaContext, ReplicatedFact, VerifiedOriginContext,
    VerifiedOriginState,
};
use serde::{Deserialize, Serialize};
pub use store::Core;
pub const CORE_SCHEMA_VERSION: i64 = 10;
/// Durable UTF-8 JSON fact encoding, independent of the smaller wire-page
/// budget. Includes worst-case escaping of all existing capture input limits.
pub const MAX_FACT_BYTES: usize = 2 * 1024 * 1024;
pub use summaries::*;
pub use timeblocks::*;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid external summary: {0}")]
    InvalidExternalSummary(&'static str),
    #[error("invalid summary: {0}")]
    InvalidSummary(&'static str),
    #[error("summary task does not exist")]
    UnknownSummaryTask,
    #[error("summary owner/run/control heads changed")]
    SummaryConflict,
    #[error("summary control requires human authority")]
    SummaryControlDenied,
    #[error("summary execution belongs to another device")]
    SummaryNotOwner,
    #[error("summary task is blocked: {0}")]
    SummaryBlocked(&'static str),
    #[error("summary executor is stopped")]
    SummaryExecutorStopped,
    #[error("summary execution ticket is stale")]
    StaleSummaryTicket,
    #[error("an absolute, independent data root is required")]
    InvalidRoot,
    #[error("data root contains foreign files")]
    ForeignRoot,
    #[error("existing core storage requires explicit recovery or completion of initialization")]
    RecoveryRequired,
    #[error("unsupported core schema version {0}")]
    UnsupportedSchema(i64),
    #[error("the database belongs to another application")]
    ForeignDatabase,
    #[error("the core database is read-only")]
    ReadOnlyDatabase,
    #[error("profile does not exist")]
    UnknownProfile,
    #[error("profile ID is already bound to another display name")]
    ProfileConflict,
    #[error("invalid event query: {0}")]
    InvalidQuery(&'static str),
    #[error("invalid replication operation: {0}")]
    InvalidReplication(&'static str),
    #[error("encoded fact exceeds {max_bytes} bytes")]
    FactTooLarge { max_bytes: usize },
    #[error("origin page entry {origin_seq} requires {required_bytes} encoded page bytes")]
    OriginPageOversize {
        required_bytes: usize,
        origin_seq: u64,
    },
    #[error("origin restoration epoch changed; explicit recovery admission is required")]
    OriginEpochChanged,
    #[error("origin fact conflicts at sequence {origin_seq}, event {event_id}")]
    ReplicationConflict { event_id: EventId, origin_seq: u64 },
    #[error("requested profile differs from the authenticated scope")]
    ScopeMismatch,
    #[error("context belongs to another core lifecycle")]
    ForeignContext,
    #[error("command ID is already bound to a different request or caller")]
    CommandConflict,
    #[error("event ID is already bound to a different fact")]
    EventConflict,
    #[error("invalid capture: {0}")]
    InvalidCapture(&'static str),
    #[error("invalid correction: {0}")]
    InvalidCorrection(&'static str),
    #[error("correction can only be authored by a human profile writer")]
    CorrectionRequiresHuman,
    #[error("correction target does not match the stated profile, capture ID and digest")]
    CorrectionTargetConflict,
    #[error("core connection lock was poisoned")]
    ConnectionPoisoned,
    #[error("filesystem operation failed: {0}")]
    Filesystem(#[from] std::io::Error),
    #[error("SQLite operation failed: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("stored or requested data is invalid: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("stored identity is invalid: {0}")]
    Identity(#[from] InvalidIdentifier),
    #[error("stored author identity is invalid: {0}")]
    AuthorIdentity(#[from] uuid::Error),
    #[error("stored author identity is nil")]
    NilAuthorIdentity,
    #[error("invalid original: {0}")]
    InvalidOriginal(&'static str),
    #[error("invalid original lifecycle command")]
    InvalidOriginalLifecycleCommand,
    #[error("invalid replicated original lifecycle fact")]
    InvalidOriginalLifecycleFact,
    #[error("original lifecycle command conflicts with current local state")]
    OriginalLifecycleConflict,
    #[error("permanent local cleanup requires an explicit confirmation")]
    OriginalLifecycleCleanupConfirmationRequired,
    #[error("released bytes require an explicit restore request before writing")]
    OriginalLifecycleRestoreRequired,
    #[error("original lifecycle actions require a local human writer")]
    OriginalLifecycleHumanOnly,
    #[error("original read or export permit became stale")]
    StaleOriginalRead,
    #[error("original stage does not exist")]
    UnknownStage,
    #[error("original does not exist")]
    UnknownOriginal,
    #[error("stage ID is already bound to another request")]
    StageConflict,
    #[error("original ID is already bound to another stage")]
    OriginalConflict,
    #[error("stage is frozen and cannot accept new chunks")]
    StageNotUploading,
    #[error("original bytes are incomplete")]
    StageIncomplete,
    #[error("replayed chunk differs from durable bytes")]
    ChunkConflict,
    #[error("original offset or range is invalid")]
    InvalidOriginalOffset,
    #[error("the entire original group must be verified before capture")]
    OriginalNotReady,
    #[error("original access requires its creator or an existing profile fact reference")]
    OriginalAccessDenied,
    #[error("original hash does not match; staged bytes have been retained")]
    OriginalHashMismatch,
    #[error("stored original chunk integrity check failed; bytes and facts have been retained")]
    OriginalIntegrityMismatch,
    #[error("original verification was cancelled")]
    VerificationCancelled,
    #[error("original verification belongs to a different lifecycle or stage generation")]
    StaleVerification,
    #[error("schema backup could not be verified")]
    BackupVerification,
    #[error("timeblock revision or state changed")]
    TimeblockConflict,
    #[error("timeblock control requires human authority")]
    TimeblockControlDenied,
    #[error("invalid timeblock request: {0}")]
    InvalidTimeblock(&'static str),
    #[error("timeblock causal history is incomplete or invalid")]
    InvalidTimeblockHistory,
}

/// Claimed authors and unknown fields fail decoding rather than vanish.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub occurred_at_ms: i64,
    pub text: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub originals: Vec<OriginalRef>,
}

/// Profile inventory is a trusted-host management capability, not a public
/// discovery surface or authority to access these profiles' contents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileInfo {
    pub profile_id: ProfileId,
    pub display_name: String,
}

pub const MAX_EVENT_PAGE_SIZE: usize = 100;

/// Cursors are local commit positions, never event timestamps. Pass the first
/// response's highwater as through to keep subsequent pages in one snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EventQuery {
    pub before: Option<u64>,
    pub through: Option<u64>,
    pub limit: usize,
    pub search: Option<String>,
}

impl Default for EventQuery {
    fn default() -> Self {
        Self {
            before: None,
            through: None,
            limit: MAX_EVENT_PAGE_SIZE,
            search: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventPage {
    pub items: Vec<EventRecord>,
    pub next_before: Option<u64>,
    pub highwater: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorKind {
    Human,
    AgentNote,
}

/// This is an in-process capability, never a request-body DTO. Its private
/// lifecycle binding prevents callers reusing it with a different Core.
#[derive(Debug, Clone)]
pub struct WriterContext {
    owner: uuid::Uuid,
    profile_id: ProfileId,
    device_id: DeviceId,
    author_id: uuid::Uuid,
    author_kind: AuthorKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Durability {
    LocalCommitted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub local_seq: u64,
    pub event_digest: String,
    pub durability: Durability,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub author_id: uuid::Uuid,
    pub author_kind: AuthorKind,
    pub occurred_at_ms: i64,
    pub text: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub originals: Vec<OriginalRef>,
    pub digest: String,
    pub local_seq: u64,
}
