//! One finite, bidirectional metadata session. Every data operation requalifies
//! its channel/member scope; byte framing and reachability grant no authority.
use super::{
    PeerCancellation, PeerChannel,
    authorization::{PeerOriginState, PeerProfileScope, PeerSyncPermissions},
    framing::{FramedPeerChannel, MAX_MESSAGE_BYTES},
    sync_store::AckBaseline,
};
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

const PROTOCOL: &str = "exomind-peer-sync/1";
const ENVELOPE_BUDGET: usize = 4096;
const MAX_PAGE_BYTES: usize = MAX_MESSAGE_BYTES - ENVELOPE_BUDGET;

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
    QueryPage {
        query: OriginPageQuery,
        receiver: OriginCursor,
    },
    Page {
        page: OriginPage,
    },
    Budget {
        required_bytes: usize,
        origin_seq: u64,
    },
    QueryCursor,
    Cursor {
        cursor: OriginCursor,
    },
    OfferPage {
        page: OriginPage,
    },
    Applied {
        ack: ImportAck,
    },
    Finish,
    Finished {
        sent_snapshot: bool,
        received_snapshot: bool,
    },
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
fn check_page(page: &OriginPage, source: &PeerOriginState) -> Result<(), HostError> {
    if page.origin != source.origin || page.through != source.head {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
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
                client(&host, &mut io, profile, peer).await
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
                let result = server(&host, &mut io, expected_scope).await;
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

async fn client(
    host: &BetaHost,
    io: &mut SessionIo,
    profile: ProfileId,
    peer: DeviceId,
) -> Result<PeerSyncResult, HostError> {
    let scope = io.domain(|channel| host.peer_profile_scope(channel, profile, peer))?;
    let permissions = io.domain(|channel| host.peer_sync_permissions(channel, &scope))?;
    let own = if permissions.send {
        Some(io.domain(|channel| host.peer_origin_state(channel, &scope))?)
    } else {
        None
    };
    io.send(&Message::Hello {
        runtime_id: host.runtime_id,
        protocol: PROTOCOL.into(),
        schema: CORE_SCHEMA_VERSION,
        profile_id: profile,
        device_id: host.device_id,
        origin: own.clone(),
        permissions,
    })
    .await?;
    let (remote, allowed, peer_runtime) = match io.read().await? {
        Message::Welcome {
            runtime_id,
            origin,
            permissions,
        } if !runtime_id.is_nil() => (origin, permissions, runtime_id),
        _ => return Err(HostError::InvalidRequest),
    };
    if allowed.send && (!permissions.receive || remote.is_none())
        || allowed.receive && (!permissions.send || own.is_none())
    {
        return Err(HostError::PeerMembershipDenied);
    }
    if let Some(remote) = &remote {
        check_origin(remote, profile, peer)?;
    }
    let mut result = PeerSyncResult {
        local_member_generation:scope.local_generation(),
        peer_member_generation:scope.member_generation(),
        peer_runtime_id: Some(peer_runtime),
        sent_snapshot: own.as_ref().map(|state| PeerSnapshot {
            origin: state.origin.clone(),
            head: state.head.clone(),
        }),
        received_snapshot: remote.as_ref().map(|state| PeerSnapshot {
            origin: state.origin.clone(),
            head: state.head.clone(),
        }),
        can_send: allowed.receive,
        can_receive: allowed.send,
        ..PeerSyncResult::default()
    };
    let mut pages = 0;
    let mut pulled = !allowed.send;
    let mut pushed = !allowed.receive;
    if allowed.send {
        let remote = remote.as_ref().ok_or(HostError::InvalidRequest)?;
        loop {
            if pages >= io.options.max_pages {
                break;
            }
            let current =
                io.domain(|channel| host.peer_receive_cursor(channel, &scope, &remote.origin))?;
            let mut budget = DEFAULT_ORIGIN_PAGE_BYTES.min(MAX_PAGE_BYTES);
            let mut enlarged = false;
            let page = loop {
                io.send(&Message::QueryPage {
                    query: page_query(current.clone(), remote.head.clone(), budget),
                    receiver: current.clone(),
                })
                .await?;
                match io.read().await? {
                    Message::Page { page } => break page,
                    Message::Budget {
                        required_bytes,
                        origin_seq,
                    } if !enlarged
                        && required_bytes > budget
                        && required_bytes <= MAX_PAGE_BYTES
                        && origin_seq == current.seq + 1 =>
                    {
                        budget = required_bytes;
                        enlarged = true;
                    }
                    _ => return Err(HostError::InvalidRequest),
                }
            };
            check_page(&page, remote)?;
            if page.from != current {
                return Err(HostError::InvalidRequest);
            }
            let ack = io.domain(|channel| host.peer_import_origin_page(channel, &scope, &page))?;
            check_ack(&ack, &page)?;
            result.received_facts += ack.inserted;
            result.replayed_facts += ack.duplicates;
            result.local_missing_originals |= !ack.missing_originals.is_empty();
            result.local_projection_complete = Some(ack.projection_complete);
            pulled = reaches(&ack.cursor, &remote.head);
            io.send(&Message::Applied { ack }).await?;
            pages += 1;
            if pulled || !page.has_more {
                break;
            }
        }
    }
    pages = 0;
    if allowed.receive {
        let own = own.as_ref().ok_or(HostError::InvalidRequest)?;
        let mut baseline =
            io.domain(|channel| host.peer_ack_baseline(channel, &scope, &own.origin))?;
        io.send(&Message::QueryCursor).await?;
        let mut current = match io.read().await? {
            Message::Cursor { cursor } => cursor,
            _ => return Err(HostError::InvalidRequest),
        };
        io.domain(|channel| host.peer_confirm_ack(channel, &scope, &baseline, &current))?;
        loop {
            if pages >= io.options.max_pages {
                break;
            }
            baseline = io.domain(|channel| host.peer_ack_baseline(channel, &scope, &own.origin))?;
            let mut budget = DEFAULT_ORIGIN_PAGE_BYTES.min(MAX_PAGE_BYTES);
            let mut enlarged = false;
            let page = loop {
                match io.domain(|channel| {
                    host.peer_export_origin_page(
                        channel,
                        &scope,
                        &page_query(current.clone(), own.head.clone(), budget),
                    )
                }) {
                    Ok(page) => break page,
                    Err(HostError::Core(CoreError::OriginPageOversize {
                        required_bytes,
                        origin_seq,
                    })) if !enlarged
                        && required_bytes > budget
                        && required_bytes <= MAX_PAGE_BYTES
                        && origin_seq == current.seq + 1 =>
                    {
                        budget = required_bytes;
                        enlarged = true;
                    }
                    Err(error) => return Err(error),
                }
            };
            check_page(&page, own)?;
            io.send(&Message::OfferPage { page: page.clone() }).await?;
            let ack = match io.read().await? {
                Message::Applied { ack } => ack,
                _ => return Err(HostError::InvalidRequest),
            };
            check_ack(&ack, &page)?;
            io.domain(|channel| host.peer_confirm_ack(channel, &scope, &baseline, &ack.cursor))?;
            result.sent_facts += ack.inserted;
            result.replayed_facts += ack.duplicates;
            result.peer_missing_originals |= !ack.missing_originals.is_empty();
            result.peer_projection_complete = Some(ack.projection_complete);
            current = ack.cursor;
            pages += 1;
            pushed = reaches(&current, &own.head);
            if pushed || !page.has_more {
                break;
            }
        }
    }
    io.send(&Message::Finish).await?;
    match io.read().await? {
        Message::Finished {
            sent_snapshot,
            received_snapshot,
        } => {
            result.events_complete = pulled && pushed && sent_snapshot && received_snapshot;
            Ok(result)
        }
        _ => Err(HostError::InvalidRequest),
    }
}

async fn server(
    host: &BetaHost,
    io: &mut SessionIo,
    expected_scope: Option<PeerProfileScope>,
) -> Result<PeerSyncResult, HostError> {
    let (profile, peer, remote, offered, peer_runtime) = match io.read().await? {
        Message::Hello {
            runtime_id,
            protocol,
            schema,
            profile_id,
            device_id,
            origin,
            permissions,
        } => {
            if protocol != PROTOCOL || schema != CORE_SCHEMA_VERSION || runtime_id.is_nil() {
                return Err(HostError::PeerProtocolMismatch);
            }
            (profile_id, device_id, origin, permissions, runtime_id)
        }
        _ => return Err(HostError::InvalidRequest),
    };
    let scope = match expected_scope {
        Some(scope) if scope.identifies(profile, peer) => scope,
        Some(_) => return Err(HostError::PeerMembershipDenied),
        None => io.domain(|channel| host.peer_profile_scope(channel, profile, peer))?,
    };
    let local = io.domain(|channel| host.peer_sync_permissions(channel, &scope))?;
    let allowed = PeerSyncPermissions {
        send: local.send && offered.receive,
        receive: local.receive && offered.send,
    };
    if !allowed.send && !allowed.receive {
        return Err(HostError::PeerMembershipDenied);
    }
    if let Some(remote) = &remote {
        check_origin(remote, profile, peer)?;
    }
    if allowed.receive && remote.is_none() {
        return Err(HostError::InvalidRequest);
    }
    let own = if allowed.send {
        Some(io.domain(|channel| host.peer_origin_state(channel, &scope))?)
    } else {
        None
    };
    io.send(&Message::Welcome {
        runtime_id: host.runtime_id,
        origin: own.clone(),
        permissions: allowed,
    })
    .await?;
    let mut result = PeerSyncResult {
        local_member_generation:scope.local_generation(),
        peer_member_generation:scope.member_generation(),
        peer_runtime_id: Some(peer_runtime),
        sent_snapshot: own.as_ref().map(|state| PeerSnapshot {
            origin: state.origin.clone(),
            head: state.head.clone(),
        }),
        received_snapshot: remote.as_ref().map(|state| PeerSnapshot {
            origin: state.origin.clone(),
            head: state.head.clone(),
        }),
        can_send: allowed.send,
        can_receive: allowed.receive,
        ..PeerSyncResult::default()
    };
    let mut sent_pages = 0;
    let mut received_pages = 0;
    let mut sent_snapshot = !allowed.send;
    let mut received_snapshot = !allowed.receive;
    loop {
        let baseline: Option<AckBaseline> = own
            .as_ref()
            .map(|own| io.domain(|channel| host.peer_ack_baseline(channel, &scope, &own.origin)))
            .transpose()?;
        match io.read().await? {
            Message::QueryPage { query, receiver }
                if allowed.send && sent_pages < io.options.max_pages =>
            {
                let own = own.as_ref().ok_or(HostError::InvalidRequest)?;
                if query.through.as_ref() != Some(&own.head) || query.max_bytes > MAX_PAGE_BYTES {
                    return Err(HostError::InvalidRequest);
                }
                io.domain(|channel| {
                    host.peer_confirm_ack(
                        channel,
                        &scope,
                        baseline.as_ref().ok_or(HostError::InvalidRequest)?,
                        &receiver,
                    )
                })?;
                let page = match io
                    .domain(|channel| host.peer_export_origin_page(channel, &scope, &query))
                {
                    Ok(page) => page,
                    Err(HostError::Core(CoreError::OriginPageOversize {
                        required_bytes,
                        origin_seq,
                    })) => {
                        io.send(&Message::Budget {
                            required_bytes,
                            origin_seq,
                        })
                        .await?;
                        continue;
                    }
                    Err(error) => return Err(error),
                };
                io.send(&Message::Page { page: page.clone() }).await?;
                let ack = match io.read().await? {
                    Message::Applied { ack } => ack,
                    _ => return Err(HostError::InvalidRequest),
                };
                check_ack(&ack, &page)?;
                io.domain(|channel| {
                    host.peer_confirm_ack(
                        channel,
                        &scope,
                        baseline.as_ref().ok_or(HostError::InvalidRequest)?,
                        &ack.cursor,
                    )
                })?;
                result.sent_facts += ack.inserted;
                result.replayed_facts += ack.duplicates;
                result.peer_missing_originals |= !ack.missing_originals.is_empty();
                result.peer_projection_complete = Some(ack.projection_complete);
                sent_snapshot = reaches(&ack.cursor, &own.head);
                sent_pages += 1;
            }
            Message::QueryCursor if allowed.receive => {
                let origin = &remote.as_ref().ok_or(HostError::InvalidRequest)?.origin;
                let cursor =
                    io.domain(|channel| host.peer_receive_cursor(channel, &scope, origin))?;
                io.send(&Message::Cursor { cursor }).await?;
            }
            Message::OfferPage { page }
                if allowed.receive && received_pages < io.options.max_pages =>
            {
                let remote = remote.as_ref().ok_or(HostError::InvalidRequest)?;
                check_page(&page, remote)?;
                let ack =
                    io.domain(|channel| host.peer_import_origin_page(channel, &scope, &page))?;
                check_ack(&ack, &page)?;
                result.received_facts += ack.inserted;
                result.replayed_facts += ack.duplicates;
                result.local_missing_originals |= !ack.missing_originals.is_empty();
                result.local_projection_complete = Some(ack.projection_complete);
                received_snapshot = reaches(&ack.cursor, &remote.head);
                io.send(&Message::Applied { ack }).await?;
                received_pages += 1;
            }
            Message::Finish => {
                io.send(&Message::Finished {
                    sent_snapshot,
                    received_snapshot,
                })
                .await?;
                result.events_complete = sent_snapshot && received_snapshot;
                return Ok(result);
            }
            _ => return Err(HostError::InvalidRequest),
        }
    }
}

#[cfg(test)]
#[path = "synchronization_tests.rs"]
mod tests;
