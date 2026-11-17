//! Whole-profile frozen inventory sessions. Source proofs are paged separately
//! from the durable data ACK, so legacy imports can backfill provenance without
//! a reset or duplicate fact. Every Core/ACK step requalifies the live carrier.
use super::*;
use crate::peers::source_history::{MAX_SOURCES, SourceOffer};
use exomind_core::OriginIdentity;
use std::collections::{HashMap, HashSet};
const MAX_SIGNED_PAGE_BYTES: usize = MAX_MESSAGE_BYTES - 40 * 1024;

fn snapshots(catalog: &SourceCatalog) -> Vec<PeerSourceSnapshot> {
    let mut result = catalog
        .sources
        .iter()
        .map(|s| PeerSourceSnapshot {
            origin: s.origin.clone(),
            materialized_head: s.materialized_head.clone(),
            available_head: Some(s.available_head.clone()),
        })
        .chain(catalog.unavailable.iter().map(|s| PeerSourceSnapshot {
            origin: s.origin.clone(),
            materialized_head: s.head.clone(),
            available_head: None,
        }))
        .collect::<Vec<_>>();
    result.sort_by_key(|s| s.origin.device_id.to_string());
    result
}
fn own_snapshot(catalog: &SourceCatalog, device: DeviceId) -> Option<PeerSnapshot> {
    catalog
        .sources
        .iter()
        .find(|s| s.origin.device_id == device)
        .map(|s| PeerSnapshot {
            origin: s.origin.clone(),
            head: s.materialized_head.clone(),
        })
}
fn validate_catalog(
    catalog: &SourceCatalog,
    profile: ProfileId,
    sender: DeviceId,
    receiver: DeviceId,
    allowed: bool,
) -> Result<(), HostError> {
    if allowed
        && catalog.fingerprint.as_ref().is_none_or(|v| {
            v.len() != 64
                || !v
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(HostError::InvalidRequest);
    }
    if catalog.sources.len() + catalog.unavailable.len() > MAX_SOURCES
        || !allowed && (!catalog.sources.is_empty() || !catalog.unavailable.is_empty())
    {
        return Err(HostError::InvalidRequest);
    }
    let mut devices = HashSet::new();
    for id in catalog
        .sources
        .iter()
        .map(|s| &s.origin)
        .chain(catalog.unavailable.iter().map(|s| &s.origin))
    {
        if id.profile_id != profile
            || id.device_id == receiver
            || id.restoration_epoch.is_nil()
            || !devices.insert(id.device_id)
        {
            return Err(HostError::PeerMembershipDenied);
        }
    }
    if catalog
        .sources
        .iter()
        .any(|s| s.carrier.device_id != sender)
    {
        return Err(HostError::PeerMembershipDenied);
    }
    if allowed && !devices.contains(&sender) {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
}
fn offer<'a>(
    catalog: &'a SourceCatalog,
    origin: &OriginIdentity,
) -> Result<&'a SourceOffer, HostError> {
    catalog
        .sources
        .iter()
        .find(|s| &s.origin == origin)
        .ok_or(HostError::PeerMembershipDenied)
}
fn complete(position: &ReceivePosition, source: &SourceOffer) -> bool {
    position.proofs_present
        && reaches(&position.data, &source.materialized_head)
        && reaches(&position.verified, &source.materialized_head)
}
fn check_source_page(signed: &SignedOriginPage, source: &SourceOffer) -> Result<(), HostError> {
    if signed.page.origin != source.origin
        || signed.page.through != source.available_head
        || signed.signer != source.source
    {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
}
fn position_from_ack(
    ack: &ImportAck,
    verified: OriginCursor,
) -> Result<ReceivePosition, HostError> {
    if verified.seq > ack.cursor.seq {
        return Err(HostError::InvalidRequest);
    }
    Ok(ReceivePosition {
        data: ack.cursor.clone(),
        verified,
        proofs_present: true,
    })
}
fn count_received(result: &mut PeerSyncResult, ack: &ImportAck) {
    result.received_facts += ack.inserted;
    result.replayed_facts += ack.duplicates;
}
fn count_sent(result: &mut PeerSyncResult, ack: &ImportAck) {
    result.sent_facts += ack.inserted;
    result.replayed_facts += ack.duplicates;
}

pub(super) async fn client(
    host: &BetaHost,
    io: &mut SessionIo,
    profile: ProfileId,
    peer: DeviceId,
) -> Result<PeerSyncResult, HostError> {
    let scope = io.domain(|c| host.peer_profile_scope(c, profile, peer))?;
    let permissions = io.domain(|c| host.peer_sync_permissions(c, &scope))?;
    let own = if permissions.send {
        Some(io.domain(|c| host.peer_origin_state(c, &scope))?)
    } else {
        None
    };
    io.send(&Message::Hello {
        runtime_id: host.runtime_id,
        protocol: PROTOCOL.into(),
        schema: CORE_SCHEMA_VERSION,
        profile_id: profile,
        device_id: host.device_id,
        origin: own,
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
        || allowed.receive && !permissions.send
    {
        return Err(HostError::PeerMembershipDenied);
    }
    if let Some(remote) = &remote {
        check_origin(remote, profile, peer)?;
    }
    let own = if allowed.receive {
        io.domain(|c| host.peer_source_catalog(c, &scope))?
    } else {
        SourceCatalog::default()
    };
    io.send(&Message::Inventory {
        catalog: own.clone(),
    })
    .await?;
    let remote = match io.read().await? {
        Message::Inventory { catalog } => catalog,
        _ => return Err(HostError::InvalidRequest),
    };
    validate_catalog(&remote, profile, peer, host.device_id, allowed.send)?;
    let mut result = PeerSyncResult {
        local_member_generation: scope.local_generation(),
        peer_member_generation: scope.member_generation(),
        peer_runtime_id: Some(peer_runtime),
        sent_snapshot: own_snapshot(&own, host.device_id),
        received_snapshot: own_snapshot(&remote, peer),
        sent_sources: snapshots(&own),
        received_sources: snapshots(&remote),
        sent_history_fingerprint: own.fingerprint.clone(),
        received_history_fingerprint: remote.fingerprint.clone(),
        can_send: allowed.receive,
        can_receive: allowed.send,
        ..Default::default()
    };
    let mut pulled = remote.unavailable.is_empty();
    let mut pages = 0;
    let mut incoming = Vec::new();
    for source in &remote.sources {
        let current = io.domain(|c| host.peer_source_cursor(c, &scope, source))?;
        incoming.push((source, current));
    }
    // Advance the least progressed prefixes first. A continuously growing
    // first UUID must not consume every finite session's shared page budget.
    incoming.sort_by_key(|(source, current)| {
        (current.verified.seq, source.origin.device_id.to_string())
    });
    for (source, mut current) in incoming {
        while (!current.proofs_present || !reaches(&current.verified, &source.available_head))
            && pages < io.options.max_pages
        {
            let mut bytes = DEFAULT_ORIGIN_PAGE_BYTES.min(MAX_SIGNED_PAGE_BYTES);
            let mut enlarged = false;
            let signed = loop {
                io.send(&Message::SourceQuery {
                    origin: source.origin.clone(),
                    query: page_query(
                        current.verified.clone(),
                        source.available_head.clone(),
                        bytes,
                    ),
                    receiver: current.clone(),
                })
                .await?;
                match io.read().await? {
                    Message::SourcePage { signed } => break signed,
                    Message::Budget {
                        required_bytes,
                        origin_seq,
                    } if !enlarged
                        && required_bytes > bytes
                        && required_bytes <= MAX_SIGNED_PAGE_BYTES
                        && origin_seq == current.verified.seq + 1 =>
                    {
                        bytes = required_bytes;
                        enlarged = true;
                    }
                    _ => return Err(HostError::InvalidRequest),
                }
            };
            check_source_page(&signed, source)?;
            if signed.page.from != current.verified {
                return Err(HostError::InvalidRequest);
            }
            let (ack, verified) =
                io.domain(|c| host.peer_import_source_page(c, &scope, source, &signed))?;
            check_ack(&ack, &signed.page)?;
            if !reaches(&verified, &signed.page.to) {
                return Err(HostError::InvalidRequest);
            }
            current = position_from_ack(&ack, verified.clone())?;
            count_received(&mut result, &ack);
            io.send(&Message::SourceApplied { ack, verified }).await?;
            pages += 1;
        }
        // Cursor confirmation also closes an unchanged source without reading
        // its bodies or replaying an empty page. The sender verifies the ACK.
        io.send(&Message::SourceQuery {
            origin: source.origin.clone(),
            query: page_query(
                source.available_head.clone(),
                source.available_head.clone(),
                1,
            ),
            receiver: current.clone(),
        })
        .await?;
        if !matches!(io.read().await?, Message::SourcePosition { .. }) {
            return Err(HostError::InvalidRequest);
        }
        pulled &= complete(&current, source);
    }
    let mut pushed = own.unavailable.is_empty();
    pages = 0;
    let mut outgoing = Vec::new();
    for source in &own.sources {
        let baseline = io.domain(|c| host.peer_source_ack_baseline(c, &scope, source))?;
        io.send(&Message::SourceCursor {
            origin: source.origin.clone(),
        })
        .await?;
        let current = match io.read().await? {
            Message::SourcePosition { position } => position,
            _ => return Err(HostError::InvalidRequest),
        };
        io.domain(|c| host.peer_confirm_source_ack(c, &scope, source, &baseline, &current))?;
        outgoing.push((source, current));
    }
    outgoing.sort_by_key(|(source, current)| {
        (current.verified.seq, source.origin.device_id.to_string())
    });
    for (source, mut current) in outgoing {
        while (!current.proofs_present || !reaches(&current.verified, &source.available_head))
            && pages < io.options.max_pages
        {
            let baseline = io.domain(|c| host.peer_source_ack_baseline(c, &scope, source))?;
            let mut bytes = DEFAULT_ORIGIN_PAGE_BYTES.min(MAX_SIGNED_PAGE_BYTES);
            let mut enlarged = false;
            let signed = loop {
                match io.domain(|c| {
                    host.peer_export_source_page(
                        c,
                        &scope,
                        source,
                        &page_query(
                            current.verified.clone(),
                            source.available_head.clone(),
                            bytes,
                        ),
                    )
                }) {
                    Ok(signed) => break signed,
                    Err(HostError::Core(CoreError::OriginPageOversize {
                        required_bytes,
                        origin_seq,
                    })) if !enlarged
                        && required_bytes > bytes
                        && required_bytes <= MAX_SIGNED_PAGE_BYTES
                        && origin_seq == current.verified.seq + 1 =>
                    {
                        bytes = required_bytes;
                        enlarged = true;
                    }
                    Err(error) => return Err(error),
                }
            };
            check_source_page(&signed, source)?;
            io.send(&Message::SourceOfferPage {
                signed: signed.clone(),
            })
            .await?;
            let (ack, verified) = match io.read().await? {
                Message::SourceApplied { ack, verified } => (ack, verified),
                _ => return Err(HostError::InvalidRequest),
            };
            check_ack(&ack, &signed.page)?;
            if !reaches(&verified, &signed.page.to) {
                return Err(HostError::InvalidRequest);
            }
            current = position_from_ack(&ack, verified)?;
            io.domain(|c| host.peer_confirm_source_ack(c, &scope, source, &baseline, &current))?;
            count_sent(&mut result, &ack);
            pages += 1;
        }
        pushed &= complete(&current, source);
    }
    let (local_projection, local_missing) = io.domain(|c| host.peer_history_health(c, &scope))?;
    io.send(&Message::SourceHealth {
        projection_complete: local_projection,
        missing_originals: local_missing,
    })
    .await?;
    io.send(&Message::Finish).await?;
    match io.read().await? {
        Message::SourceFinished {
            sent_snapshot,
            received_snapshot,
            projection_complete,
            missing_originals,
        } => {
            result.local_projection_complete = Some(local_projection);
            result.local_missing_originals = local_missing;
            result.peer_projection_complete = Some(projection_complete);
            result.peer_missing_originals = missing_originals;
            result.events_complete = pulled && pushed && sent_snapshot && received_snapshot;
            Ok(result)
        }
        _ => Err(HostError::InvalidRequest),
    }
}

pub(super) async fn server(
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
        Some(s) if s.identifies(profile, peer) => s,
        Some(_) => return Err(HostError::PeerMembershipDenied),
        None => io.domain(|c| host.peer_profile_scope(c, profile, peer))?,
    };
    let local = io.domain(|c| host.peer_sync_permissions(c, &scope))?;
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
    let own_origin = if allowed.send {
        Some(io.domain(|c| host.peer_origin_state(c, &scope))?)
    } else {
        None
    };
    io.send(&Message::Welcome {
        runtime_id: host.runtime_id,
        origin: own_origin,
        permissions: allowed,
    })
    .await?;
    let remote = match io.read().await? {
        Message::Inventory { catalog } => catalog,
        _ => return Err(HostError::InvalidRequest),
    };
    validate_catalog(&remote, profile, peer, host.device_id, allowed.receive)?;
    let own = if allowed.send {
        io.domain(|c| host.peer_source_catalog(c, &scope))?
    } else {
        SourceCatalog::default()
    };
    // This baseline precedes the peer receiving our inventory and capturing
    // its request cursor. A newer ACK from a concurrent session must not
    // reinterpret that in-flight snapshot as a reset. New sessions still
    // start from the durable highwater and reject actual rollback.
    let mut receiver_baselines = HashMap::new();
    for source in &own.sources {
        receiver_baselines.insert(
            source.origin.device_id,
            io.domain(|c| host.peer_source_ack_baseline(c, &scope, source))?,
        );
    }
    io.send(&Message::Inventory {
        catalog: own.clone(),
    })
    .await?;
    let mut result = PeerSyncResult {
        local_member_generation: scope.local_generation(),
        peer_member_generation: scope.member_generation(),
        peer_runtime_id: Some(peer_runtime),
        sent_snapshot: own_snapshot(&own, host.device_id),
        received_snapshot: own_snapshot(&remote, peer),
        sent_sources: snapshots(&own),
        received_sources: snapshots(&remote),
        sent_history_fingerprint: own.fingerprint.clone(),
        received_history_fingerprint: remote.fingerprint.clone(),
        can_send: allowed.send,
        can_receive: allowed.receive,
        ..Default::default()
    };
    let mut sent = HashSet::new();
    let mut received = HashSet::new();
    let mut sent_pages = 0;
    let mut received_pages = 0;
    loop {
        match io.read().await? {
            Message::SourceQuery {
                origin,
                query,
                receiver,
            } if allowed.send => {
                let source = offer(&own, &origin)?;
                let baseline = receiver_baselines
                    .get(&origin.device_id)
                    .ok_or(HostError::InvalidRequest)?;
                io.domain(|c| {
                    host.peer_confirm_source_ack(c, &scope, source, baseline, &receiver)
                })?;
                if query.after.as_ref() == Some(&source.available_head)
                    && query.through.as_ref() == Some(&source.available_head)
                    && query.max_bytes == 1
                {
                    if complete(&receiver, source) {
                        sent.insert(origin.device_id);
                    }
                    io.send(&Message::SourcePosition { position: receiver })
                        .await?;
                    continue;
                }
                if sent_pages >= io.options.max_pages
                    || query.after.as_ref() != Some(&receiver.verified)
                    || query.max_bytes > MAX_SIGNED_PAGE_BYTES
                {
                    return Err(HostError::InvalidRequest);
                }
                let signed =
                    match io.domain(|c| host.peer_export_source_page(c, &scope, source, &query)) {
                        Ok(signed) => signed,
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
                let baseline = io.domain(|c| host.peer_source_ack_baseline(c, &scope, source))?;
                io.send(&Message::SourcePage {
                    signed: signed.clone(),
                })
                .await?;
                let (ack, verified) = match io.read().await? {
                    Message::SourceApplied { ack, verified } => (ack, verified),
                    _ => return Err(HostError::InvalidRequest),
                };
                check_ack(&ack, &signed.page)?;
                if !reaches(&verified, &signed.page.to) {
                    return Err(HostError::InvalidRequest);
                }
                let position = position_from_ack(&ack, verified)?;
                io.domain(|c| {
                    host.peer_confirm_source_ack(c, &scope, source, &baseline, &position)
                })?;
                if complete(&position, source) {
                    sent.insert(origin.device_id);
                }
                count_sent(&mut result, &ack);
                sent_pages += 1;
            }
            Message::SourceCursor { origin } if allowed.receive => {
                let source = offer(&remote, &origin)?;
                let position = io.domain(|c| host.peer_source_cursor(c, &scope, source))?;
                if complete(&position, source) {
                    received.insert(origin.device_id);
                }
                io.send(&Message::SourcePosition { position }).await?;
            }
            Message::SourceOfferPage { signed }
                if allowed.receive && received_pages < io.options.max_pages =>
            {
                let source = offer(&remote, &signed.page.origin)?;
                check_source_page(&signed, source)?;
                let (ack, verified) =
                    io.domain(|c| host.peer_import_source_page(c, &scope, source, &signed))?;
                let position = position_from_ack(&ack, verified.clone())?;
                if complete(&position, source) {
                    received.insert(source.origin.device_id);
                }
                count_received(&mut result, &ack);
                received_pages += 1;
                io.send(&Message::SourceApplied { ack, verified }).await?;
            }
            Message::SourceHealth {
                projection_complete: peer_projection,
                missing_originals: peer_missing,
            } => {
                if !matches!(io.read().await?, Message::Finish) {
                    return Err(HostError::InvalidRequest);
                }
                let sent_snapshot = sent.len() == own.sources.len() && own.unavailable.is_empty();
                let received_snapshot =
                    received.len() == remote.sources.len() && remote.unavailable.is_empty();
                let (projection_complete, missing_originals) =
                    io.domain(|c| host.peer_history_health(c, &scope))?;
                io.send(&Message::SourceFinished {
                    sent_snapshot,
                    received_snapshot,
                    projection_complete,
                    missing_originals,
                })
                .await?;
                result.local_projection_complete = Some(projection_complete);
                result.local_missing_originals = missing_originals;
                result.peer_projection_complete = Some(peer_projection);
                result.peer_missing_originals = peer_missing;
                result.events_complete = sent_snapshot && received_snapshot;
                return Ok(result);
            }
            _ => return Err(HostError::InvalidRequest),
        }
    }
}
