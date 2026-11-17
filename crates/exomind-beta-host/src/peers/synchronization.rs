//! One finite, bidirectional metadata session. Every data operation requalifies
//! its channel/member scope; byte framing and reachability grant no authority.
use super::{
    PeerCancellation, PeerChannel,
    authorization::{PeerOriginState, PeerProfileScope, PeerSyncPermissions},
    framing::{FramedPeerChannel, MAX_MESSAGE_BYTES},
    origin_proof::SignedOriginPage,
    source_history::{ReceivePosition, SourceCatalog},
};
#[path = "multi_sync.rs"]
mod multi_sync;
use crate::{BetaHost, HostError, Session};
use exomind_core::{
    CORE_SCHEMA_VERSION, CoreError, DEFAULT_ORIGIN_PAGE_BYTES, DeviceId, ImportAck, OriginCursor,
    OriginPage, OriginPageQuery, ProfileId,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

const PROTOCOL: &str = "exomind-peer-sync/2";

#[derive(Debug, Clone, Copy)]
pub struct PeerSyncOptions {
    pub session_timeout: Duration,
    pub message_timeout: Duration,
    /// Per direction; an idle pull must not starve a pending push.
    pub max_pages: usize,
}
impl Default for PeerSyncOptions {
    fn default() -> Self {
        Self {
            session_timeout: Duration::from_secs(45),
            message_timeout: Duration::from_secs(10),
            max_pages: 1024,
        }
    }
}
impl PeerSyncOptions {
    fn validate(self) -> Result<(), HostError> {
        if self.session_timeout < Duration::from_millis(50)
            || self.session_timeout > Duration::from_secs(120)
            || self.message_timeout < Duration::from_millis(50)
            || self.message_timeout > Duration::from_secs(30)
            || self.max_pages == 0
            || self.max_pages > 10000
        {
            return Err(HostError::InvalidRequest);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerSyncResult {
    pub local_member_generation: u64,
    pub peer_member_generation: u64,
    pub peer_runtime_id: Option<uuid::Uuid>,
    pub sent_snapshot: Option<PeerSnapshot>,
    pub received_snapshot: Option<PeerSnapshot>,
    pub can_send: bool,
    pub can_receive: bool,
    pub events_complete: bool,
    pub sent_facts: u64,
    pub received_facts: u64,
    pub replayed_facts: u64,
    pub local_missing_originals: bool,
    pub peer_missing_originals: bool,
    pub local_projection_complete: Option<bool>,
    pub peer_projection_complete: Option<bool>,
    #[serde(default)]
    pub sent_sources: Vec<PeerSourceSnapshot>,
    #[serde(default)]
    pub received_sources: Vec<PeerSourceSnapshot>,
    #[serde(default)]
    pub sent_history_fingerprint: Option<String>,
    #[serde(default)]
    pub received_history_fingerprint: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerSourceSnapshot {
    pub origin: exomind_core::OriginIdentity,
    pub materialized_head: OriginCursor,
    pub available_head: Option<OriginCursor>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerSnapshot {
    pub origin: exomind_core::OriginIdentity,
    pub head: OriginCursor,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
enum Message {
    Inventory {
        catalog: SourceCatalog,
    },
    SourceCursor {
        origin: exomind_core::OriginIdentity,
    },
    SourcePosition {
        position: ReceivePosition,
    },
    SourceQuery {
        origin: exomind_core::OriginIdentity,
        query: OriginPageQuery,
        receiver: ReceivePosition,
    },
    SourcePage {
        signed: SignedOriginPage,
    },
    SourceOfferPage {
        signed: SignedOriginPage,
    },
    SourceApplied {
        ack: ImportAck,
        verified: OriginCursor,
    },
    SourceHealth {
        projection_complete: bool,
        missing_originals: bool,
    },
    SourceFinished {
        sent_snapshot: bool,
        received_snapshot: bool,
        projection_complete: bool,
        missing_originals: bool,
    },
    Hello {
        runtime_id: uuid::Uuid,
        protocol: String,
        schema: i64,
        profile_id: ProfileId,
        device_id: DeviceId,
        origin: Option<PeerOriginState>,
        permissions: PeerSyncPermissions,
    },
    Welcome {
        runtime_id: uuid::Uuid,
        origin: Option<PeerOriginState>,
        permissions: PeerSyncPermissions,
    },
    Budget {
        required_bytes: usize,
        origin_seq: u64,
    },
    Finish,
    Rejected {
        code: Rejection,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Rejection {
    Denied,
    Incompatible,
    EpochChanged,
    Conflict,
    ResetRequired,
    Recovery,
    Invalid,
    Unavailable,
}
impl Rejection {
    fn from_error(error: &HostError) -> Self {
        match error {
            HostError::Forbidden | HostError::Unauthorized | HostError::PeerMembershipDenied => {
                Self::Denied
            }
            HostError::PeerProtocolMismatch => Self::Incompatible,
            HostError::Core(CoreError::OriginEpochChanged) => Self::EpochChanged,
            HostError::Core(
                CoreError::ReplicationConflict { .. }
                | CoreError::EventConflict
                | CoreError::OriginalConflict,
            ) => Self::Conflict,
            HostError::PeerSyncResetRequired => Self::ResetRequired,
            HostError::PeerSyncRecoveryRequired
            | HostError::PeerMembershipRecoveryRequired
            | HostError::Core(CoreError::RecoveryRequired) => Self::Recovery,
            HostError::InvalidRequest
            | HostError::PayloadTooLarge
            | HostError::Core(CoreError::InvalidQuery(_) | CoreError::InvalidReplication(_)) => {
                Self::Invalid
            }
            _ => Self::Unavailable,
        }
    }
    fn error(self) -> HostError {
        match self {
            Self::Denied => HostError::PeerMembershipDenied,
            Self::Incompatible => HostError::PeerProtocolMismatch,
            Self::EpochChanged => HostError::Core(CoreError::OriginEpochChanged),
            Self::Conflict => HostError::Core(CoreError::EventConflict),
            Self::ResetRequired => HostError::PeerSyncResetRequired,
            Self::Recovery => HostError::PeerSyncRecoveryRequired,
            Self::Invalid => HostError::InvalidRequest,
            Self::Unavailable => HostError::PeerSyncUnavailable,
        }
    }
}
struct SessionIo {
    framed: FramedPeerChannel,
    cancel: PeerCancellation,
    end: Instant,
    options: PeerSyncOptions,
}
impl SessionIo {
    fn remaining(&self) -> Result<Duration, HostError> {
        if self.cancel.is_cancelled() {
            return Err(HostError::PeerCancelled);
        }
        let remaining = self.end.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(HostError::PeerTimeout);
        }
        Ok(remaining.min(self.options.message_timeout))
    }
    async fn send(&mut self, value: &Message) -> Result<(), HostError> {
        let timeout = self.remaining()?;
        let bytes = serde_json::to_vec(value).map_err(|_| HostError::InvalidRequest)?;
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        self.framed
            .send(&bytes, timeout, self.cancel.cancelled())
            .await
    }
    async fn read(&mut self) -> Result<Message, HostError> {
        let timeout = self.remaining()?;
        let bytes = self
            .framed
            .receive(timeout, self.cancel.cancelled())
            .await?;
        let message: Message =
            serde_json::from_slice(&bytes).map_err(|_| HostError::InvalidRequest)?;
        if let Message::Rejected { code } = message {
            return Err(code.error());
        }
        Ok(message)
    }
    fn domain<T>(
        &self,
        action: impl for<'a> FnOnce(&'a PeerChannel) -> Result<T, HostError>,
    ) -> Result<T, HostError> {
        self.remaining()?;
        self.framed.with_channel(action)?
    }
}
struct CancelOnDrop(PeerCancellation);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

fn check_origin(
    origin: &PeerOriginState,
    profile: ProfileId,
    device: DeviceId,
) -> Result<(), HostError> {
    if origin.protocol != PROTOCOL || origin.schema != CORE_SCHEMA_VERSION {
        return Err(HostError::PeerProtocolMismatch);
    }
    if origin.origin.profile_id != profile
        || origin.origin.device_id != device
        || origin.origin.restoration_epoch.is_nil()
    {
        return Err(HostError::PeerMembershipDenied);
    }
    Ok(())
}
fn reaches(cursor: &OriginCursor, target: &OriginCursor) -> bool {
    cursor.seq > target.seq || (cursor.seq == target.seq && cursor.hash == target.hash)
}
fn check_ack(ack: &ImportAck, page: &OriginPage) -> Result<(), HostError> {
    if ack.origin != page.origin
        || !reaches(&ack.cursor, &page.to)
        || ack.inserted.checked_add(ack.duplicates) != Some(page.entries.len() as u64)
    {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
}
fn page_query(after: OriginCursor, through: OriginCursor, bytes: usize) -> OriginPageQuery {
    OriginPageQuery {
        after: Some(after),
        through: Some(through),
        limit: 100,
        max_bytes: bytes,
    }
}

impl BetaHost {
    /// Explicit trusted management entry. Automatic routing/reconnect is a
    /// separate owner of finite sessions; it cannot convert TLS into a grant.
    pub async fn synchronize_peer_profile_over_transport(
        self: &Arc<Self>,
        owner: &Session,
        profile: ProfileId,
        peer: DeviceId,
        channel: PeerChannel,
        options: PeerSyncOptions,
    ) -> Result<PeerSyncResult, HostError> {
        options.validate()?;
        self.qualify_transport(owner)?;
        channel.binding_pin(self)?;
        let lease = self.peers.register(false)?;
        let cancel = PeerCancellation::new();
        let _cancel = CancelOnDrop(cancel.clone());
        let host = self.clone();
        let runtime = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            let _lease = lease;
            runtime.block_on(async move {
                let mut io = SessionIo {
                    framed: FramedPeerChannel::new(channel),
                    cancel,
                    end: Instant::now() + options.session_timeout,
                    options,
                };
                multi_sync::client(&host, &mut io, profile, peer).await
            })
        })
        .await
        .map_err(|_| HostError::StatePoisoned)?
    }
    pub async fn accept_peer_profile_sync_over_transport(
        self: &Arc<Self>,
        channel: PeerChannel,
        options: PeerSyncOptions,
    ) -> Result<PeerSyncResult, HostError> {
        self.accept_peer_profile_sync_scoped(channel, options, None)
            .await
    }

    pub(super) async fn accept_peer_profile_sync_scoped(
        self: &Arc<Self>,
        channel: PeerChannel,
        options: PeerSyncOptions,
        expected_scope: Option<PeerProfileScope>,
    ) -> Result<PeerSyncResult, HostError> {
        options.validate()?;
        channel.binding_pin(self)?;
        let lease = self.peers.register(false)?;
        let cancel = PeerCancellation::new();
        let _cancel = CancelOnDrop(cancel.clone());
        let host = self.clone();
        let runtime = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            let _lease = lease;
            runtime.block_on(async move {
                let mut io = SessionIo {
                    framed: FramedPeerChannel::new(channel),
                    cancel,
                    end: Instant::now() + options.session_timeout,
                    options,
                };
                let result = multi_sync::server(&host, &mut io, expected_scope).await;
                if let Err(error) = &result {
                    let _ = io
                        .send(&Message::Rejected {
                            code: Rejection::from_error(error),
                        })
                        .await;
                }
                result
            })
        })
        .await
        .map_err(|_| HostError::StatePoisoned)?
    }
}

#[cfg(test)]
#[path = "synchronization_tests.rs"]
mod tests;
