//! Bounded service selection on the same pinned TLS endpoint. Selection is not
//! authentication: joins still require the signed one-use invitation, and all
//! other services seal their profile scope before reading further input.
use super::transport::PeerServiceVersion;
use super::{
    OriginalTransferOptions, OriginalTransferResult, PeerCancellation, PeerChannel, PeerJoinState,
    PeerJoinStatus, PeerPin, PeerSyncOptions, PeerSyncResult, membership_store, network_store,
};
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use uuid::Uuid;
const PROTOCOL_V1: &str = "exomind-peer-service/1";
const PROTOCOL_V2: &str = "exomind-peer-service/2";
const MAX_SERVICE_FRAME_BYTES: usize = 1024;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerServiceKind {
    Join,
    Sync,
    Probe,
    Originals,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HeaderV1 {
    protocol: String,
    service: PeerServiceKind,
    profile_id: Option<ProfileId>,
    device_id: DeviceId,
    target_device: Option<DeviceId>,
    listen_port: u16,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HeaderV2 {
    protocol: String,
    service: PeerServiceKind,
    profile_id: Option<ProfileId>,
    device_id: DeviceId,
    target_device: Option<DeviceId>,
    listen_port: u16,
    candidates: Vec<SocketAddr>,
}
struct DecodedHeader {
    service: PeerServiceKind,
    profile_id: Option<ProfileId>,
    device_id: DeviceId,
    target_device: Option<DeviceId>,
    listen_port: u16,
    version: PeerServiceVersion,
    candidates: Vec<SocketAddr>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JoinAckV2 {
    protocol: String,
    service: PeerServiceKind,
    device_id: DeviceId,
    candidates: Vec<SocketAddr>,
}
pub(super) struct PeerServiceNegotiation {
    pub(super) peer_device_id: DeviceId,
    pub(super) candidates: Vec<SocketAddr>,
}
fn merge_route_endpoints(
    old: &[SocketAddr],
    candidates: &[SocketAddr],
    successful_endpoint: Option<SocketAddr>,
) -> Result<Vec<SocketAddr>, HostError> {
    let local_ips = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|interface| interface.ip())
        .collect::<Vec<_>>();
    merge_route_endpoints_with_local_ips(old, candidates, successful_endpoint, &local_ips)
}
fn merge_route_endpoints_with_local_ips(
    old: &[SocketAddr],
    candidates: &[SocketAddr],
    successful_endpoint: Option<SocketAddr>,
    local_ips: &[IpAddr],
) -> Result<Vec<SocketAddr>, HostError> {
    let canonical = |address: SocketAddr| {
        super::transport::validate_service_candidates(&[address])
            .ok()
            .and_then(|values| values.first().copied())
    };
    let allowed = |address: SocketAddr| {
        super::network::is_shareable_endpoint(address) && !local_ips.contains(&address.ip())
    };
    // Previously authenticated routes stay available as fallbacks, but only
    // when the cached address itself is still valid to persist. Loopback,
    // link-local, unspecified, multicast/broadcast, zero-port and local-self
    // routes must never survive a merge, even when they arrived via the legacy
    // cache rather than a fresh candidate list.
    let mut seen_old = std::collections::HashSet::new();
    let old = old
        .iter()
        .filter_map(|address| canonical(*address))
        .filter(|address| allowed(*address))
        .filter(|address| seen_old.insert(*address))
        .collect::<Vec<_>>();
    let candidates = candidates
        .iter()
        .filter_map(|address| canonical(*address))
        .filter(|address| allowed(*address))
        .collect::<Vec<_>>();
    let mut endpoints = Vec::with_capacity(network_store::MAX_ROUTE_ENDPOINTS);
    // A successful endpoint earns placement only when it is itself shareable
    // and not local-self; an observed inbound source can otherwise smuggle a
    // loopback/link-local/broadcast address past the candidate hygiene.
    let successful_endpoint = successful_endpoint
        .and_then(canonical)
        .filter(|endpoint| allowed(*endpoint));
    if let Some(endpoint) = successful_endpoint {
        network_store::validate_endpoints(&[endpoint])?;
        endpoints.push(endpoint);
    } else if let Some(preferred) = old.first() {
        // Retain the previous preferred route, while leaving space for newly
        // authenticated addresses when the old cache is already full.
        endpoints.push(*preferred);
    }
    for candidate in &candidates {
        if endpoints.len() == network_store::MAX_ROUTE_ENDPOINTS {
            break;
        }
        if !old.contains(candidate) && !endpoints.contains(candidate) {
            endpoints.push(*candidate);
        }
    }
    for previous in old {
        if endpoints.len() == network_store::MAX_ROUTE_ENDPOINTS {
            break;
        }
        if !endpoints.contains(&previous) {
            endpoints.push(previous);
        }
    }
    Ok(endpoints)
}
fn decode_header(bytes: &[u8], negotiated: PeerServiceVersion) -> Result<DecodedHeader, HostError> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| HostError::InvalidRequest)?;
    match value.get("protocol").and_then(serde_json::Value::as_str) {
        Some(PROTOCOL_V1) => {
            let header: HeaderV1 =
                serde_json::from_slice(bytes).map_err(|_| HostError::InvalidRequest)?;
            Ok(DecodedHeader {
                service: header.service,
                profile_id: header.profile_id,
                device_id: header.device_id,
                target_device: header.target_device,
                listen_port: header.listen_port,
                version: PeerServiceVersion::V1,
                candidates: vec![],
            })
        }
        Some(PROTOCOL_V2) if negotiated == PeerServiceVersion::V2 => {
            let header: HeaderV2 =
                serde_json::from_slice(bytes).map_err(|_| HostError::InvalidRequest)?;
            if !matches!(header.service, PeerServiceKind::Join) {
                return Err(HostError::PeerProtocolMismatch);
            }
            let candidates = super::transport::validate_service_candidates(&header.candidates)?;
            Ok(DecodedHeader {
                service: header.service,
                profile_id: header.profile_id,
                device_id: header.device_id,
                target_device: header.target_device,
                listen_port: header.listen_port,
                version: PeerServiceVersion::V2,
                candidates,
            })
        }
        Some(PROTOCOL_V2) => Err(HostError::PeerProtocolMismatch),
        _ => Err(HostError::PeerProtocolMismatch),
    }
}
pub(super) async fn send_join_service_ack(
    channel: &PeerChannel,
    device_id: DeviceId,
) -> Result<(), HostError> {
    if !channel.service_v2_join() {
        return Ok(());
    }
    let candidates = super::transport::local_service_candidates(&channel.listener_candidates());
    let bytes = serde_json::to_vec(&JoinAckV2 {
        protocol: PROTOCOL_V2.into(),
        service: PeerServiceKind::Join,
        device_id,
        candidates,
    })
    .map_err(|_| HostError::InvalidRequest)?;
    if bytes.len() > MAX_SERVICE_FRAME_BYTES {
        return Err(HostError::PayloadTooLarge);
    }
    channel.send_frame(bytes).await
}
pub(super) async fn read_join_service_ack(
    channel: &PeerChannel,
    expected_peer: DeviceId,
) -> Result<Option<PeerServiceNegotiation>, HostError> {
    if !channel.service_v2_join() {
        return Ok(None);
    }
    let bytes = channel.read_frame().await?;
    if bytes.len() > MAX_SERVICE_FRAME_BYTES {
        return Err(HostError::PayloadTooLarge);
    }
    let ack: JoinAckV2 = serde_json::from_slice(&bytes).map_err(|_| HostError::InvalidRequest)?;
    if ack.protocol != PROTOCOL_V2
        || ack.service != PeerServiceKind::Join
        || ack.device_id != expected_peer
    {
        return Err(HostError::PeerMembershipDenied);
    }
    let candidates = super::transport::validate_service_candidates(&ack.candidates)?;
    Ok(Some(PeerServiceNegotiation {
        peer_device_id: ack.device_id,
        candidates,
    }))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerProbe {
    pub schema: i64,
    pub runtime_id: Uuid,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub origin: Option<exomind_core::OriginIdentity>,
    pub head: Option<exomind_core::OriginCursor>,
    #[serde(default)]
    pub history_fingerprint: Option<String>,
}
pub enum PeerServiceOutcome {
    Joined(PeerJoinStatus),
    Synchronized {
        profile_id: ProfileId,
        device_id: DeviceId,
        member_generation: u64,
        result: PeerSyncResult,
    },
    Probed {
        profile_id: ProfileId,
        device_id: DeviceId,
    },
    OriginalTransferred {
        profile_id: ProfileId,
        device_id: DeviceId,
        result: OriginalTransferResult,
    },
}
fn canonical_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(ip)),
        other => other,
    }
}
impl BetaHost {
    pub(super) fn save_authenticated_peer_routes(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        pin: PeerPin,
        member_generation: u64,
        candidates: &[SocketAddr],
        successful_endpoint: Option<SocketAddr>,
        network_cancel: Option<&PeerCancellation>,
    ) -> Result<bool, HostError> {
        self.commit_peer_route_update(
            owner,
            profile,
            device,
            pin,
            Some(member_generation),
            candidates,
            successful_endpoint,
            network_cancel,
            None,
        )
    }
    fn commit_peer_route_update(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        pin: PeerPin,
        member_generation: Option<u64>,
        candidates: &[SocketAddr],
        successful_endpoint: Option<SocketAddr>,
        network_cancel: Option<&PeerCancellation>,
        observed_source: Option<(IpAddr, u16)>,
    ) -> Result<bool, HostError> {
        if device == self.device_id {
            return Ok(false);
        }
        let candidates = super::transport::validate_service_candidates(candidates)?;
        let mut state = self.active_state()?;
        self.owner(owner)?;
        if network_cancel.is_some_and(PeerCancellation::is_cancelled) {
            return Ok(false);
        }
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let connection = &mut resources.persistence.auth;
        let tx = connection
            .transaction()
            .map_err(|_| HostError::PeerSyncUnavailable)?;
        if let Some((ip, port)) = observed_source {
            if port == 0 {
                return Ok(false);
            }
            let settings = network_store::settings(&tx)?;
            if port == settings.preferred_port
                && (ip.is_loopback()
                    || if_addrs::get_if_addrs()
                        .unwrap_or_default()
                        .iter()
                        .any(|interface| interface.ip() == ip))
            {
                // A proxy can report this host's own address. Do not route back
                // to the local listener based only on the authenticated port.
                return Ok(false);
            }
        }
        let member = membership_store::members(&tx, profile)?
            .into_iter()
            .find(|member| member.device_id == device);
        let Some(_member) = member.filter(|member| {
            !member.revoked
                && member.state == PeerJoinState::Ready
                && member.pin == pin.as_sha256()
                && member_generation.is_none_or(|generation| member.generation == generation)
        }) else {
            return Ok(false);
        };
        let old = network_store::routes(&tx)?
            .into_iter()
            .find(|route| route.profile == profile && route.device == device)
            .map(|route| route.endpoints)
            .unwrap_or_default();
        let endpoints = merge_route_endpoints(&old, &candidates, successful_endpoint)?;
        if endpoints.is_empty() {
            return Ok(false);
        }
        let route = network_store::Route {
            profile,
            device,
            endpoints,
        };
        match network_store::save_route(&tx, &route) {
            Ok(()) => {}
            Err(HostError::PeerBusy) => return Ok(false),
            Err(error) => return Err(error),
        }
        super::connection_store::reconcile_current_topology_in_tx(
            &tx,
            self.device_id,
            self.clock.sample()?.wall_ms,
        )?;
        tx.commit().map_err(|_| HostError::PeerSyncUnavailable)?;
        Ok(true)
    }
    fn learn_join_candidates(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        pin: PeerPin,
        member_generation: u64,
        candidates: &[SocketAddr],
        network_cancel: Option<&PeerCancellation>,
    ) -> Result<(), HostError> {
        if candidates.is_empty() {
            return Ok(());
        }
        let _ = self.save_authenticated_peer_routes(
            owner,
            profile,
            device,
            pin,
            member_generation,
            candidates,
            None,
            network_cancel,
        )?;
        Ok(())
    }
    fn save_observed_peer_route(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        ip: IpAddr,
        port: u16,
        member_generation: u64,
        pin: PeerPin,
        network_cancel: Option<&PeerCancellation>,
    ) -> Result<(), HostError> {
        if port == 0 {
            return Ok(());
        }
        let _ = self.commit_peer_route_update(
            owner,
            profile,
            device,
            pin,
            Some(member_generation),
            &[],
            Some(SocketAddr::new(ip, port)),
            network_cancel,
            Some((ip, port)),
        )?;
        Ok(())
    }
    pub async fn select_peer_service(
        &self,
        owner: &Session,
        channel: &PeerChannel,
        service: PeerServiceKind,
        profile: Option<ProfileId>,
        target: Option<DeviceId>,
        listen_port: u16,
    ) -> Result<(), HostError> {
        self.select_peer_service_with_candidates(
            owner,
            channel,
            service,
            profile,
            target,
            listen_port,
            &[],
        )
        .await
    }
    pub(super) async fn select_peer_service_with_candidates(
        &self,
        owner: &Session,
        channel: &PeerChannel,
        service: PeerServiceKind,
        profile: Option<ProfileId>,
        target: Option<DeviceId>,
        listen_port: u16,
        candidates: &[SocketAddr],
    ) -> Result<(), HostError> {
        self.qualify_transport(owner)?;
        channel.binding_pin(self)?;
        match service {
            PeerServiceKind::Join => {
                if profile.is_some() || target.is_some() {
                    return Err(HostError::InvalidRequest);
                }
            }
            _ => {
                self.peer_profile_scope(
                    channel,
                    profile.ok_or(HostError::InvalidRequest)?,
                    target.ok_or(HostError::InvalidRequest)?,
                )?;
            }
        }
        let use_v2_join =
            service == PeerServiceKind::Join && channel.service_version() == PeerServiceVersion::V2;
        let bytes = if use_v2_join {
            let candidates = if candidates.is_empty() {
                self.active_peer_listener_candidates()
            } else {
                super::transport::local_service_candidates(candidates)
            };
            let candidates = super::transport::validate_service_candidates(&candidates)?;
            serde_json::to_vec(&HeaderV2 {
                protocol: PROTOCOL_V2.into(),
                service,
                profile_id: profile,
                device_id: self.device_id,
                target_device: target,
                listen_port,
                candidates,
            })
            .map_err(|_| HostError::InvalidRequest)?
        } else {
            serde_json::to_vec(&HeaderV1 {
                protocol: PROTOCOL_V1.into(),
                service,
                profile_id: profile,
                device_id: self.device_id,
                target_device: target,
                listen_port,
            })
            .map_err(|_| HostError::InvalidRequest)?
        };
        if bytes.len() > MAX_SERVICE_FRAME_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        channel.send_frame(bytes).await?;
        if use_v2_join {
            channel.mark_service_v2_join();
        }
        Ok(())
    }
    pub async fn accept_peer_service(
        self: &Arc<Self>,
        owner: &Session,
        channel: PeerChannel,
    ) -> Result<PeerServiceOutcome, HostError> {
        self.accept_peer_service_owned(owner, channel, None).await
    }
    /// The network controller supplies only its own generation's completion
    /// scope. Public/manual serving retains the original untracked behavior.
    pub(super) async fn accept_peer_service_owned(
        self: &Arc<Self>,
        owner: &Session,
        channel: PeerChannel,
        completion: Option<Arc<super::original_transfer::TransferCompletion>>,
    ) -> Result<PeerServiceOutcome, HostError> {
        self.accept_peer_service_owned_scoped(owner, channel, completion, None)
            .await
    }
    pub(super) async fn accept_peer_service_owned_scoped(
        self: &Arc<Self>,
        owner: &Session,
        channel: PeerChannel,
        completion: Option<Arc<super::original_transfer::TransferCompletion>>,
        network_cancel: Option<PeerCancellation>,
    ) -> Result<PeerServiceOutcome, HostError> {
        self.qualify_transport(owner)?;
        let authenticated_pin = channel.binding_pin(self)?;
        let observed = canonical_ip(channel.remote_address().ip());
        let bytes = channel.read_frame().await?;
        if bytes.len() > MAX_SERVICE_FRAME_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        let header = decode_header(&bytes, channel.service_version())?;
        if header.version == PeerServiceVersion::V2 {
            channel.mark_service_v2_join();
        }
        match header.service {
            PeerServiceKind::Join => {
                if header.profile_id.is_some() || header.target_device.is_some() {
                    return Err(HostError::InvalidRequest);
                }
                let status = self.accept_peer_join_over_transport(channel).await?;
                if status.joiner_device_id != header.device_id {
                    return Err(HostError::PeerMembershipDenied);
                }
                let member_generation = self
                    .peer_members(owner, status.profile_id)?
                    .into_iter()
                    .find(|member| {
                        member.device_id == status.joiner_device_id
                            && !member.revoked
                            && member.state == PeerJoinState::Ready
                            && member.pin == authenticated_pin.as_sha256()
                    })
                    .ok_or(HostError::PeerMembershipDenied)?
                    .generation;
                if header.listen_port != 0 {
                    self.save_observed_peer_route(
                        owner,
                        status.profile_id,
                        status.joiner_device_id,
                        observed,
                        header.listen_port,
                        member_generation,
                        authenticated_pin,
                        network_cancel.as_ref(),
                    )?;
                }
                if header.version == PeerServiceVersion::V2 {
                    self.learn_join_candidates(
                        owner,
                        status.profile_id,
                        status.joiner_device_id,
                        authenticated_pin,
                        member_generation,
                        &header.candidates,
                        network_cancel.as_ref(),
                    )?;
                }
                Ok(PeerServiceOutcome::Joined(status))
            }
            PeerServiceKind::Sync | PeerServiceKind::Probe | PeerServiceKind::Originals => {
                if header.target_device != Some(self.device_id) {
                    return Err(HostError::PeerMembershipDenied);
                }
                let profile = header.profile_id.ok_or(HostError::InvalidRequest)?;
                let scope = self.peer_profile_scope(&channel, profile, header.device_id)?;
                let member_generation = scope.member_generation();
                if matches!(header.service, PeerServiceKind::Originals) {
                    let result = match completion {
                        Some(completion) => {
                            self.serve_peer_original_owned(
                                channel,
                                scope,
                                OriginalTransferOptions::default(),
                                Some(completion),
                            )
                            .await?
                        }
                        None => {
                            self.serve_peer_original_over_transport(
                                channel,
                                scope,
                                OriginalTransferOptions::default(),
                            )
                            .await?
                        }
                    };
                    self.save_observed_peer_route(
                        owner,
                        profile,
                        header.device_id,
                        observed,
                        header.listen_port,
                        member_generation,
                        authenticated_pin,
                        network_cancel.as_ref(),
                    )?;
                    return Ok(PeerServiceOutcome::OriginalTransferred {
                        profile_id: profile,
                        device_id: header.device_id,
                        result,
                    });
                }
                let permissions = self.peer_sync_permissions(&channel, &scope)?;
                if matches!(header.service, PeerServiceKind::Probe) {
                    let source = if permissions.send {
                        Some(self.peer_history_probe(&channel, &scope)?)
                    } else {
                        None
                    };
                    let response = PeerProbe {
                        schema: exomind_core::CORE_SCHEMA_VERSION,
                        runtime_id: self.runtime_id,
                        profile_id: profile,
                        device_id: self.device_id,
                        origin: source.as_ref().map(|s| s.0.clone()),
                        head: source.as_ref().map(|s| s.1.clone()),
                        history_fingerprint: source.map(|s| s.2),
                    };
                    channel
                        .send_frame(
                            serde_json::to_vec(&response).map_err(|_| HostError::InvalidRequest)?,
                        )
                        .await?;
                    self.peer_sync_permissions(&channel, &scope)?;
                    self.save_observed_peer_route(
                        owner,
                        profile,
                        header.device_id,
                        observed,
                        header.listen_port,
                        member_generation,
                        authenticated_pin,
                        network_cancel.as_ref(),
                    )?;
                    Ok(PeerServiceOutcome::Probed {
                        profile_id: profile,
                        device_id: header.device_id,
                    })
                } else {
                    let result = self
                        .accept_peer_profile_sync_scoped(
                            channel,
                            PeerSyncOptions::default(),
                            Some(scope),
                        )
                        .await?;
                    if header.listen_port != 0 {
                        self.save_observed_peer_route(
                            owner,
                            profile,
                            header.device_id,
                            observed,
                            header.listen_port,
                            member_generation,
                            authenticated_pin,
                            network_cancel.as_ref(),
                        )?;
                    }
                    Ok(PeerServiceOutcome::Synchronized {
                        profile_id: profile,
                        device_id: header.device_id,
                        member_generation: result.peer_member_generation,
                        result,
                    })
                }
            }
        }
    }
    pub async fn probe_peer_over_transport(
        &self,
        owner: &Session,
        profile: ProfileId,
        peer: DeviceId,
        channel: PeerChannel,
        listen_port: u16,
    ) -> Result<PeerProbe, HostError> {
        let scope = self.peer_profile_scope(&channel, profile, peer)?;
        self.select_peer_service(
            owner,
            &channel,
            PeerServiceKind::Probe,
            Some(profile),
            Some(peer),
            listen_port,
        )
        .await?;
        let bytes = channel.read_frame().await?;
        if bytes.len() > 4096 {
            return Err(HostError::PayloadTooLarge);
        }
        self.peer_sync_permissions(&channel, &scope)?;
        let response: PeerProbe =
            serde_json::from_slice(&bytes).map_err(|_| HostError::InvalidRequest)?;
        if response.schema != exomind_core::CORE_SCHEMA_VERSION {
            return Err(HostError::PeerProtocolMismatch);
        }
        if response.profile_id != profile
            || response.device_id != peer
            || response.origin.is_some() != response.head.is_some()
        {
            return Err(HostError::PeerMembershipDenied);
        }
        if response.history_fingerprint.as_ref().is_some_and(|v| {
            v.len() != 64
                || !v
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) {
            return Err(HostError::InvalidRequest);
        }
        if let Some(origin) = &response.origin {
            if origin.profile_id != profile
                || origin.device_id != peer
                || origin.restoration_epoch.is_nil()
            {
                return Err(HostError::PeerMembershipDenied);
            }
        }
        Ok(response)
    }
}
#[cfg(test)]
#[path = "service_route_tests.rs"]
mod route_tests;
