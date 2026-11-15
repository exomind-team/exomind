//! Bounded service selection on the same pinned TLS endpoint. Selection is not
//! authentication: joins still require the signed one-use invitation, and all
//! other services seal their profile scope before reading further input.
use super::{
    OriginalTransferOptions, OriginalTransferResult, PeerChannel, PeerJoinStatus, PeerSyncOptions,
    PeerSyncResult, authorization::PeerOriginState,
};
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use uuid::Uuid;
const PROTOCOL: &str = "exomind-peer-service/1";
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerServiceKind {
    Join,
    Sync,
    Probe,
    Originals,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    protocol: String,
    service: PeerServiceKind,
    profile_id: Option<ProfileId>,
    device_id: DeviceId,
    target_device: Option<DeviceId>,
    listen_port: u16,
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
    fn save_observed_peer_route(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        ip: IpAddr,
        port: u16,
    ) -> Result<(), HostError> {
        if port == 0 {
            return Ok(());
        }
        let settings = self.peer_network_settings(owner)?;
        if port == settings.preferred_port
            && (ip.is_loopback()
                || if_addrs::get_if_addrs()
                    .unwrap_or_default()
                    .iter()
                    .any(|interface| interface.ip() == ip))
        {
            // User-mode emulator/NAT can present this host's own address.
            // Never turn it into a route back to our own listener.
            return Ok(());
        }
        let endpoint = SocketAddr::new(ip, port);
        let old = self
            .peer_routes(owner)?
            .into_iter()
            .find(|route| route.profile == profile && route.device == device)
            .map(|route| route.endpoints)
            .unwrap_or_default();
        if old.first() == Some(&endpoint) {
            return Ok(());
        }
        let mut endpoints = vec![endpoint];
        endpoints.extend(
            old.into_iter()
                .filter(|address| *address != endpoint)
                .take(7),
        );
        self.save_peer_routes(owner, profile, device, endpoints)
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
        let bytes = serde_json::to_vec(&Header {
            protocol: PROTOCOL.into(),
            service,
            profile_id: profile,
            device_id: self.device_id,
            target_device: target,
            listen_port,
        })
        .map_err(|_| HostError::InvalidRequest)?;
        channel.send_frame(bytes).await
    }
    pub async fn accept_peer_service(
        self: &Arc<Self>,
        owner: &Session,
        channel: PeerChannel,
    ) -> Result<PeerServiceOutcome, HostError> {
        self.qualify_transport(owner)?;
        channel.binding_pin(self)?;
        let observed = canonical_ip(channel.remote_address().ip());
        let bytes = channel.read_frame().await?;
        if bytes.len() > 1024 {
            return Err(HostError::PayloadTooLarge);
        }
        let header: Header =
            serde_json::from_slice(&bytes).map_err(|_| HostError::InvalidRequest)?;
        if header.protocol != PROTOCOL {
            return Err(HostError::PeerProtocolMismatch);
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
                if header.listen_port != 0 {
                    self.save_observed_peer_route(
                        owner,
                        status.profile_id,
                        status.joiner_device_id,
                        observed,
                        header.listen_port,
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
                if matches!(header.service, PeerServiceKind::Originals) {
                    let result = self
                        .serve_peer_original_over_transport(
                            channel,
                            scope,
                            OriginalTransferOptions::default(),
                        )
                        .await?;
                    self.save_observed_peer_route(
                        owner,
                        profile,
                        header.device_id,
                        observed,
                        header.listen_port,
                    )?;
                    return Ok(PeerServiceOutcome::OriginalTransferred {
                        profile_id: profile,
                        device_id: header.device_id,
                        result,
                    });
                }
                let permissions = self.peer_sync_permissions(&channel, &scope)?;
                if matches!(header.service, PeerServiceKind::Probe) {
                    let source: Option<PeerOriginState> = if permissions.send {
                        Some(self.peer_origin_state(&channel, &scope)?)
                    } else {
                        None
                    };
                    let response = PeerProbe {
                        schema: exomind_core::CORE_SCHEMA_VERSION,
                        runtime_id: self.runtime_id,
                        profile_id: profile,
                        device_id: self.device_id,
                        origin: source.as_ref().map(|s| s.origin.clone()),
                        head: source.map(|s| s.head),
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
