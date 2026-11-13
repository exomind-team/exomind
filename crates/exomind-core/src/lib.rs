//! Beta local commit boundary, independent of transports and legacy storage.
//!
//! A successful receipt confirms one SQLite transaction, not delivery to peers.
//! Trusted embedding code opens local profile sessions; network authentication
//! must be completed by an adapter before calling this API.

mod identity;
mod migrations;
mod originals;
mod store;

pub use identity::{
    AgentId, CommandId, DeviceId, EventId, InvalidIdentifier, OriginalId, ProfileId, StageId,
};
pub use originals::{
    BeginStageCommand, MAX_CAPTURE_ORIGINALS, MAX_ORIGINAL_CHUNK_BYTES, OriginalChunk, OriginalRef,
    StageState, StageStatus, VerificationProof, VerificationTicket,
};
use serde::{Deserialize, Serialize};
pub use store::Core;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
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
