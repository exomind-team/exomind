//! Beta local commit boundary, independent of transports and legacy storage.
//!
//! A successful receipt confirms one SQLite transaction, not delivery to peers.
//! Trusted embedding code opens local profile sessions; network authentication
//! must be completed by an adapter before calling this API.

mod identity;
mod store;

pub use identity::{AgentId, CommandId, DeviceId, EventId, InvalidIdentifier, ProfileId};
use serde::{Deserialize, Serialize};
pub use store::Core;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("an absolute, independent data root is required")]
    InvalidRoot,
    #[error("data root contains foreign files")]
    ForeignRoot,
    #[error("unsupported core schema version {0}")]
    UnsupportedSchema(i64),
    #[error("the database belongs to another application")]
    ForeignDatabase,
    #[error("the core database is read-only")]
    ReadOnlyDatabase,
    #[error("profile does not exist")]
    UnknownProfile,
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
}

/// Only capture is implemented in the initial local unit. Unknown fields,
/// including attachments or claimed authors, fail decoding rather than vanish.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub occurred_at_ms: i64,
    pub text: String,
    pub tags: Vec<String>,
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
pub struct EventRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub author_id: uuid::Uuid,
    pub author_kind: AuthorKind,
    pub occurred_at_ms: i64,
    pub text: String,
    pub tags: Vec<String>,
    pub digest: String,
    pub local_seq: u64,
}
