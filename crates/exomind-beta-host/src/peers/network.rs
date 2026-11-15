//! Native-owned discovery, routing and finite sync attempts. No UI polling,
//! browser timer or development HTTP server owns this lifecycle.
use super::{
    PeerCancellation, PeerInvitation, PeerJoinState, PeerPin, PeerServiceKind, PeerServiceOutcome,
    PeerSnapshot, PeerSyncOptions, PeerSyncResult, PeerTransportOptions,
    network_store::{PeerNetworkSettings, Route},
};
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    net::UdpSocket,
    task::{JoinHandle, JoinSet},
};
use uuid::Uuid;

const DISCOVERY_PORT: u16 = 43343;
const DISCOVERY_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 77, 68);
#[derive(Debug, Clone, Serialize)]
pub struct PeerConnectionView {
    pub device_id: DeviceId,
    pub fingerprint_sha256: String,
    pub member_generation: u64,
    pub member_state: &'static str,
    pub connection_state: &'static str,
    pub endpoints: Vec<String>,
    pub last_sync_at_ms: Option<i64>,
    pub last_error_code: Option<&'static str>,
    pub event_sync: &'static str,
    pub originals_sync: &'static str,
}
#[derive(Debug, Clone, Serialize)]
pub struct PeerNetworkStatus {
    pub runtime_id: Uuid,
    pub device_id: DeviceId,
    pub profile_id: ProfileId,
    pub network_enabled: bool,
    pub local_addresses: Vec<String>,
    pub peers: Vec<PeerConnectionView>,
}
#[derive(Clone, Default)]
struct Progress {
    busy: bool,
    connection: &'static str,
    last_sync: Option<i64>,
    error: Option<&'static str>,
    memo: Option<PeerSyncResult>,
    member_generation: u64,
    failures: u32,
    retry: Option<Instant>,
    busy_id: Option<Uuid>,
    last_seen: Option<i64>,
    observed_runtime: Option<Uuid>,
    observed_snapshot: Option<PeerSnapshot>,
}
struct Candidate {
    endpoint: SocketAddr,
    pin: String,
    expires: Instant,
}
struct Shared {
    generation: u64,
    addresses: Vec<SocketAddr>,
    progress: HashMap<(ProfileId, DeviceId), Progress>,
    forced: HashSet<(ProfileId, DeviceId)>,
    candidates: HashMap<DeviceId, Vec<Candidate>>,
    route_cursor: usize,
}
struct Running {
    cancel: PeerCancellation,
    task: JoinHandle<()>,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
pub struct PeerNetwork {
    host: Arc<BetaHost>,
    owner: Session,
    lifecycle: tokio::sync::Mutex<Option<Running>>,
    control: tokio::sync::Mutex<()>,
    shared: Arc<Mutex<Shared>>,
}
impl Drop for PeerNetwork {
    fn drop(&mut self) {
        drop(self.lifecycle.get_mut().take());
    }
}
#[derive(Clone)]
struct Worker {
    host: Arc<BetaHost>,
    owner: Session,
    shared: Arc<Mutex<Shared>>,
}
struct Busy {
    shared: Arc<Mutex<Shared>>,
    key: (ProfileId, DeviceId),
    generation: u64,
    id: Uuid,
}
impl Drop for Busy {
    fn drop(&mut self) {
        if let Ok(mut state) = self.shared.lock() {
            if state.generation != self.generation {
                return;
            }
            if let Some(p) = state.progress.get_mut(&self.key) {
                if p.busy_id == Some(self.id) {
                    p.busy = false;
                    p.busy_id = None;
                    if matches!(p.connection, "connecting" | "syncing") {
                        p.connection = "waiting";
                    }
                }
            }
        }
    }
}
const CANDIDATE_TTL: Duration = Duration::from_secs(30);
const MAX_CANDIDATE_DEVICES: usize = 64;
const MAX_DEVICE_CANDIDATES: usize = 4;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Announcement {
    protocol: String,
    device_id: DeviceId,
    fingerprint_sha256: String,
    listen_port: u16,
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn error_code(error: &HostError) -> &'static str {
    match error {
        HostError::PeerPinMismatch | HostError::PeerTls => "identity_mismatch",
        HostError::PeerProtocolMismatch => "protocol_mismatch",
        HostError::PeerMembershipDenied | HostError::Forbidden | HostError::Unauthorized => {
            "membership_denied"
        }
        HostError::PeerSyncResetRequired => "peer_reset_required",
        HostError::Core(exomind_core::CoreError::OriginEpochChanged) => "origin_epoch_changed",
        HostError::PeerSyncRecoveryRequired | HostError::PeerMembershipRecoveryRequired => {
            "network_recovery_required"
        }
        HostError::Core(
            exomind_core::CoreError::EventConflict
            | exomind_core::CoreError::ReplicationConflict { .. },
        ) => "data_conflict",
        HostError::Stopped | HostError::PeerCancelled => "stopped",
        _ => "unreachable",
    }
}
fn endpoints(listener: SocketAddr) -> Vec<SocketAddr> {
    let port = listener.port();
    let mut ips: Vec<IpAddr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.ip())
        .filter(|ip| {
            ip.is_ipv4() == listener.is_ipv4()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_loopback()
                && !matches!(ip,IpAddr::V6(v) if v.is_unicast_link_local())
        })
        .collect();
    ips.sort_by_key(|ip| match ip {
        IpAddr::V4(v) if v.octets()[0] == 192 => (0, ip.to_string()),
        IpAddr::V4(_) => (1, ip.to_string()),
        IpAddr::V6(_) => (2, ip.to_string()),
    });
    ips.dedup();
    let mut output: Vec<_> = ips
        .into_iter()
        .take(7)
        .map(|ip| SocketAddr::new(ip, port))
        .collect();
    output.push(SocketAddr::new(
        if listener.is_ipv4() {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        } else {
            IpAddr::V6(Ipv6Addr::LOCALHOST)
        },
        port,
    ));
    output
}
fn discovery_socket() -> Result<UdpSocket, HostError> {
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .map_err(|_| HostError::PeerTransportUnavailable)?;
    socket
        .set_reuse_address(true)
        .map_err(|_| HostError::PeerTransportUnavailable)?;
    socket
        .set_broadcast(true)
        .map_err(|_| HostError::PeerTransportUnavailable)?;
    socket
        .set_nonblocking(true)
        .map_err(|_| HostError::PeerTransportUnavailable)?;
    socket
        .bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)).into())
        .map_err(|_| HostError::PeerTransportUnavailable)?;
    let std: std::net::UdpSocket = socket.into();
    let _ = std.join_multicast_v4(&DISCOVERY_GROUP, &Ipv4Addr::UNSPECIFIED);
    UdpSocket::from_std(std).map_err(|_| HostError::PeerTransportUnavailable)
}
impl PeerNetwork {
    pub fn new(host: Arc<BetaHost>, owner: Session) -> Result<Arc<Self>, HostError> {
        host.qualify_transport(&owner)?;
        Ok(Arc::new(Self {
            host,
            owner,
            lifecycle: tokio::sync::Mutex::new(None),
            control: tokio::sync::Mutex::new(()),
            shared: Arc::new(Mutex::new(Shared {
                generation: 0,
                addresses: vec![],
                progress: HashMap::new(),
                forced: HashSet::new(),
                candidates: HashMap::new(),
                route_cursor: 0,
            })),
        }))
    }
    fn worker(&self) -> Worker {
        Worker {
            host: self.host.clone(),
            owner: self.owner.clone(),
            shared: self.shared.clone(),
        }
    }
    pub async fn restore(self: &Arc<Self>) -> Result<(), HostError> {
        let _control = self.control.lock().await;
        if self.host.peer_network_settings(&self.owner)?.enabled {
            self.start().await?;
        }
        Ok(())
    }
    pub async fn set_enabled(self: &Arc<Self>, enabled: bool) -> Result<(), HostError> {
        let _control = self.control.lock().await;
        let mut settings = self.host.peer_network_settings(&self.owner)?;
        settings.enabled = enabled;
        self.host
            .save_peer_network_settings(&self.owner, settings)?;
        if enabled {
            self.start().await?;
        } else {
            self.stop_work().await?;
        }
        Ok(())
    }
    pub async fn ensure_started(self: &Arc<Self>) -> Result<(), HostError> {
        let _control = self.control.lock().await;
        self.start().await
    }
    async fn start(self: &Arc<Self>) -> Result<(), HostError> {
        let mut running = self.lifecycle.lock().await;
        if running.as_ref().is_some_and(|r| !r.task.is_finished()) {
            return Ok(());
        }
        if let Some(mut old) = running.take() {
            old.cancel.cancel();
            let _ = (&mut old.task).await;
        }
        let settings = self.host.peer_network_settings(&self.owner)?;
        let options = PeerTransportOptions {
            handshake_timeout: Duration::from_secs(3),
            channel_lifetime: Duration::from_secs(120),
        };
        let mut listener = None;
        // Bind/advertise one actual address family. A successful IPv6-only bind
        // must not produce unusable IPv4 invitations on Android or Windows.
        for address in [
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), settings.preferred_port),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
            SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), settings.preferred_port),
            SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0),
        ] {
            if let Ok(bound) = self
                .host
                .listen_peer_transport(&self.owner, address, options)
                .await
            {
                listener = Some(bound);
                break;
            }
        }
        let listener = listener.ok_or(HostError::PeerTransportUnavailable)?;
        let port = listener.addr().port();
        self.host.save_peer_network_settings(
            &self.owner,
            PeerNetworkSettings {
                enabled: true,
                preferred_port: port,
            },
        )?;
        let generation = {
            let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
            state.generation = state.generation.checked_add(1).ok_or(HostError::PeerBusy)?;
            state.addresses = endpoints(listener.addr());
            state.progress.clear();
            state.candidates.clear();
            state.generation
        };
        let cancel = PeerCancellation::new();
        let worker_cancel = cancel.clone();
        let network = self.worker();
        let lease = self.host.peers.register(false)?;
        let task = tokio::spawn(async move {
            let _lease = lease;
            network.run(listener, worker_cancel, generation).await;
        });
        *running = Some(Running { cancel, task });
        Ok(())
    }
    pub async fn stop(&self) -> Result<(), HostError> {
        let _control = self.control.lock().await;
        self.stop_work().await
    }
    async fn stop_work(&self) -> Result<(), HostError> {
        let mut running = self.lifecycle.lock().await;
        {
            let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
            state.generation = state.generation.saturating_add(1);
            state.addresses.clear();
            state.candidates.clear();
            for value in state.progress.values_mut() {
                value.busy = false;
                value.busy_id = None;
                value.connection = "idle";
            }
        }
        if let Some(mut run) = running.take() {
            run.cancel.cancel();
            match tokio::time::timeout(Duration::from_secs(10), &mut run.task).await {
                Ok(result) => result.map_err(|_| HostError::Shutdown)?,
                Err(_) => {
                    run.task.abort();
                    let _ = (&mut run.task).await;
                    return Err(HostError::Shutdown);
                }
            }
        }
        Ok(())
    }
    pub fn status(&self, profile: ProfileId) -> Result<PeerNetworkStatus, HostError> {
        let settings = self.host.peer_network_settings(&self.owner)?;
        let members = self.host.peer_members(&self.owner, profile)?;
        let routes = self.host.peer_routes(&self.owner)?;
        let own = self.host.local_origin_state(&self.owner, profile)?;
        let local_generation = members
            .iter()
            .find(|m| {
                m.device_id == self.host.device_id && !m.revoked && m.state == PeerJoinState::Ready
            })
            .map(|m| m.generation);
        let state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let mut peers = Vec::new();
        for member in members
            .into_iter()
            .filter(|m| m.device_id != self.host.device_id)
        {
            let progress = state.progress.get(&(profile, member.device_id));
            let complete = progress.is_some_and(|p| {
                p.member_generation == member.generation
                    && p.memo.as_ref().is_some_and(|m| {
                        m.events_complete
                            && Some(m.local_member_generation) == local_generation
                            && (!m.can_send
                                || m.sent_snapshot
                                    .as_ref()
                                    .is_some_and(|s| s.origin == own.0 && s.head == own.1))
                            && (!m.can_receive
                                || (m.peer_runtime_id == p.observed_runtime
                                    && m.received_snapshot == p.observed_snapshot))
                    })
            });
            let revoked = member.revoked;
            peers.push(PeerConnectionView {
                device_id: member.device_id,
                fingerprint_sha256: member.pin,
                member_generation: member.generation,
                member_state: if revoked {
                    "revoked"
                } else if member.state == PeerJoinState::Ready {
                    "ready"
                } else {
                    "pending"
                },
                connection_state: if revoked || !settings.enabled {
                    "idle"
                } else {
                    progress
                        .map(|p| p.connection)
                        .filter(|s| !s.is_empty())
                        .unwrap_or("waiting")
                },
                endpoints: routes
                    .iter()
                    .find(|r| r.profile == profile && r.device == member.device_id)
                    .map(|r| r.endpoints.iter().map(ToString::to_string).collect())
                    .unwrap_or_default(),
                last_sync_at_ms: progress.and_then(|p| p.last_sync),
                last_error_code: progress.and_then(|p| p.error),
                event_sync: if complete && !revoked {
                    "complete"
                } else {
                    "pending"
                },
                originals_sync: if progress
                    .and_then(|p| p.memo.as_ref())
                    .is_some_and(|m| m.local_missing_originals || m.peer_missing_originals)
                {
                    "pending"
                } else {
                    "unknown"
                },
            });
        }
        Ok(PeerNetworkStatus {
            runtime_id: self.host.runtime_id,
            device_id: self.host.device_id,
            profile_id: profile,
            network_enabled: settings.enabled,
            local_addresses: state.addresses.iter().map(ToString::to_string).collect(),
            peers,
        })
    }
    pub fn local_addresses(&self) -> Result<Vec<SocketAddr>, HostError> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .addresses
            .clone())
    }
    pub async fn create_invitation(
        self: &Arc<Self>,
        profile: ProfileId,
    ) -> Result<super::IssuedPeerInvitation, HostError> {
        self.set_enabled(true).await?;
        self.host.create_peer_invitation(
            &self.owner,
            &super::CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: super::PeerCapabilities::FULL,
                candidates: self.local_addresses()?,
                ttl_seconds: 600,
            },
        )
    }
    pub async fn join(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
    ) -> Result<super::PeerJoinStatus, HostError> {
        let offer = invitation.verified_offer()?;
        if offer.schema != super::PEER_CORE_SCHEMA || offer.protocol != super::PEER_PROTOCOL {
            return Err(HostError::PeerProtocolMismatch);
        }
        self.set_enabled(true).await?;
        let port = self
            .local_addresses()?
            .first()
            .ok_or(HostError::PeerTransportUnavailable)?
            .port();
        let pin = PeerPin::from_sha256(&offer.issuer.fingerprint_sha256)?;
        let (cancel, generation) = {
            let running = self.lifecycle.lock().await;
            let cancel = running
                .as_ref()
                .ok_or(HostError::PeerTransportUnavailable)?
                .cancel
                .clone();
            let generation = self
                .shared
                .lock()
                .map_err(|_| HostError::StatePoisoned)?
                .generation;
            (cancel, generation)
        };
        let mut last = HostError::PeerTransportUnavailable;
        for endpoint in &offer.candidates {
            let channel = match self
                .host
                .connect_peer_transport(
                    &self.owner,
                    *endpoint,
                    pin,
                    PeerTransportOptions {
                        handshake_timeout: Duration::from_secs(2),
                        channel_lifetime: Duration::from_secs(120),
                    },
                    cancel.clone(),
                )
                .await
            {
                Ok(channel) => channel,
                Err(error) => {
                    last = error;
                    continue;
                }
            };
            self.host
                .select_peer_service(
                    &self.owner,
                    &channel,
                    PeerServiceKind::Join,
                    None,
                    None,
                    port,
                )
                .await?;
            match self
                .host
                .join_peer_profile_over_transport(&self.owner, invitation, claim, channel)
                .await
            {
                Ok(status) => {
                    if self
                        .shared
                        .lock()
                        .map_err(|_| HostError::StatePoisoned)?
                        .generation
                        != generation
                    {
                        return Err(HostError::PeerCancelled);
                    }
                    let mut routes = vec![*endpoint];
                    for candidate in &offer.candidates {
                        if !routes.contains(candidate) {
                            routes.push(*candidate);
                        }
                    }
                    self.host.save_peer_routes(
                        &self.owner,
                        status.profile_id,
                        offer.issuer.device_id,
                        routes,
                    )?;
                    let mut shared = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
                    if shared.generation != generation {
                        return Err(HostError::PeerCancelled);
                    }
                    shared
                        .forced
                        .insert((status.profile_id, offer.issuer.device_id));
                    return Ok(status);
                }
                Err(error) => return Err(error),
            }
        }
        Err(last)
    }
    pub async fn sync_now(
        self: &Arc<Self>,
        profile: ProfileId,
        peer: DeviceId,
    ) -> Result<PeerSyncResult, HostError> {
        self.ensure_started().await?;
        let worker = self.worker();
        let route = worker
            .routes()?
            .into_iter()
            .find(|r| r.profile == profile && r.device == peer)
            .ok_or(HostError::NotFound)?;
        let (generation, cancel) = {
            let run = self.lifecycle.lock().await;
            let cancel = run
                .as_ref()
                .ok_or(HostError::PeerTransportUnavailable)?
                .cancel
                .clone();
            (
                self.shared
                    .lock()
                    .map_err(|_| HostError::StatePoisoned)?
                    .generation,
                cancel,
            )
        };
        worker
            .attempt(route, cancel, generation, true)
            .await?
            .ok_or(HostError::PeerBusy)
    }
}
impl Worker {
    fn routes(&self) -> Result<Vec<Route>, HostError> {
        let saved = self.host.peer_routes(&self.owner)?;
        let mut ready = vec![];
        for profile in self.host.profiles(&self.owner)? {
            for member in self.host.peer_members(&self.owner, profile.profile_id)? {
                if member.device_id != self.host.device_id
                    && !member.revoked
                    && member.state == PeerJoinState::Ready
                {
                    ready.push((profile.profile_id, member.device_id, member.pin));
                }
            }
        }
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let at = Instant::now();
        state.candidates.retain(|_, values| {
            values.retain(|c| c.expires > at);
            !values.is_empty()
        });
        let mut output = vec![];
        for (profile, device, pin) in ready {
            let mut endpoints = vec![];
            if let Some(values) = state.candidates.get(&device) {
                endpoints.extend(values.iter().filter(|c| c.pin == pin).map(|c| c.endpoint));
            }
            if let Some(route) = saved
                .iter()
                .find(|r| r.profile == profile && r.device == device)
            {
                for address in &route.endpoints {
                    if !endpoints.contains(address) {
                        endpoints.push(*address);
                    }
                }
            }
            endpoints.retain(|a| !state.addresses.contains(a));
            endpoints.truncate(8);
            if !endpoints.is_empty() {
                output.push(Route {
                    profile,
                    device,
                    endpoints,
                });
            }
        }
        Ok(output)
    }
    fn remember_announcement(
        &self,
        value: Announcement,
        source: SocketAddr,
        generation: u64,
    ) -> Result<(), HostError> {
        if value.protocol != "exomind-discovery/1"
            || value.listen_port == 0
            || value.device_id == self.host.device_id
            || source.ip().is_unspecified()
            || source.ip().is_multicast()
            || PeerPin::from_sha256(&value.fingerprint_sha256).is_err()
        {
            return Ok(());
        }
        let mut matching = vec![];
        for profile in self.host.profiles(&self.owner)? {
            if self
                .host
                .peer_members(&self.owner, profile.profile_id)?
                .iter()
                .any(|m| {
                    m.device_id == value.device_id
                        && !m.revoked
                        && m.state == PeerJoinState::Ready
                        && m.pin == value.fingerprint_sha256
                })
            {
                matching.push((profile.profile_id, value.device_id));
            }
        }
        if matching.is_empty() {
            return Ok(());
        }
        let address = SocketAddr::new(source.ip(), value.listen_port);
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        if state.generation != generation || state.addresses.contains(&address) {
            return Ok(());
        }
        let at = Instant::now();
        state.candidates.retain(|_, values| {
            values.retain(|c| c.expires > at);
            !values.is_empty()
        });
        if !state.candidates.contains_key(&value.device_id)
            && state.candidates.len() >= MAX_CANDIDATE_DEVICES
        {
            return Ok(());
        }
        let candidates = state.candidates.entry(value.device_id).or_default();
        if let Some(c) = candidates
            .iter_mut()
            .find(|c| c.endpoint == address && c.pin == value.fingerprint_sha256)
        {
            c.expires = at + CANDIDATE_TTL;
            return Ok(());
        }
        if candidates.len() >= MAX_DEVICE_CANDIDATES {
            return Ok(());
        }
        // This remains an unauthenticated hint. Only promote after a pinned
        // service exchange succeeds; the original durable route is untouched.
        candidates.push(Candidate {
            endpoint: address,
            pin: value.fingerprint_sha256,
            expires: at + CANDIDATE_TTL,
        });
        for key in matching {
            state.forced.insert(key);
        }
        Ok(())
    }
    fn incoming(&self, generation: u64, outcome: PeerServiceOutcome) {
        match outcome {
            PeerServiceOutcome::Synchronized {
                profile_id,
                device_id,
                member_generation,
                result,
            } => {
                let key = (profile_id, device_id);
                if self.valid_result(key, member_generation, &result).is_ok() {
                    self.publish(key, generation, member_generation, None, &Ok(Some(result)));
                }
            }
            PeerServiceOutcome::Probed {
                profile_id,
                device_id,
            } => self.touch((profile_id, device_id), generation),
            PeerServiceOutcome::Joined(status) => {
                let peer = if status.issuer_device_id == self.host.device_id {
                    status.joiner_device_id
                } else {
                    status.issuer_device_id
                };
                self.touch((status.profile_id, peer), generation);
                if let Ok(mut state) = self.shared.lock() {
                    if state.generation == generation {
                        state.forced.insert((status.profile_id, peer));
                    }
                }
            }
        }
    }
    fn local_addresses(&self) -> Result<Vec<SocketAddr>, HostError> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .addresses
            .clone())
    }
    fn publish(
        &self,
        key: (ProfileId, DeviceId),
        generation: u64,
        member: u64,
        attempt: Option<Uuid>,
        result: &Result<Option<PeerSyncResult>, HostError>,
    ) {
        if let Ok(mut shared) = self.shared.lock() {
            if shared.generation != generation {
                return;
            }
            let p = shared.progress.entry(key).or_default();
            if let Some(id) = attempt {
                if p.busy_id != Some(id) {
                    return;
                }
                p.busy = false;
                p.busy_id = None;
            }
            p.member_generation = member;
            match result {
                Ok(Some(value)) => {
                    p.memo = Some(value.clone());
                    p.observed_runtime = value.peer_runtime_id;
                    p.observed_snapshot = value.received_snapshot.clone();
                    p.last_sync = Some(now());
                    p.last_seen = p.last_sync;
                    p.error = None;
                    p.failures = 0;
                    p.retry = None;
                    if !p.busy {
                        p.connection = if value.events_complete {
                            "idle"
                        } else {
                            "waiting"
                        };
                    }
                }
                Ok(None) => {
                    p.last_seen = Some(now());
                    p.error = None;
                    p.failures = 0;
                    p.retry = None;
                    if !p.busy {
                        p.connection = "idle";
                    }
                }
                Err(error) => {
                    p.error = Some(error_code(error));
                    p.connection = "error";
                    p.failures = p.failures.saturating_add(1);
                    p.retry = Some(
                        Instant::now() + Duration::from_secs((1u64 << p.failures.min(5)).min(30)),
                    );
                }
            }
        }
    }
    fn valid_result(
        &self,
        key: (ProfileId, DeviceId),
        member: u64,
        result: &PeerSyncResult,
    ) -> Result<(), HostError> {
        let members = self.host.peer_members(&self.owner, key.0)?;
        let ready = |device| {
            members
                .iter()
                .find(|m| m.device_id == device && !m.revoked && m.state == PeerJoinState::Ready)
        };
        let local = ready(self.host.device_id).ok_or(HostError::PeerMembershipDenied)?;
        let remote = ready(key.1).ok_or(HostError::PeerMembershipDenied)?;
        if member != result.peer_member_generation
            || remote.generation != result.peer_member_generation
            || local.generation != result.local_member_generation
        {
            return Err(HostError::PeerMembershipDenied);
        }
        Ok(())
    }
    fn touch(&self, key: (ProfileId, DeviceId), generation: u64) {
        if let Ok(mut shared) = self.shared.lock() {
            if shared.generation == generation {
                let p = shared.progress.entry(key).or_default();
                p.last_seen = Some(now());
                if !p.busy {
                    p.connection = "idle";
                }
            }
        }
    }
    fn observed_probe(
        &self,
        key: (ProfileId, DeviceId),
        generation: u64,
        probe: &super::PeerProbe,
    ) {
        if let Ok(mut shared) = self.shared.lock() {
            if shared.generation == generation {
                let p = shared.progress.entry(key).or_default();
                p.observed_runtime = Some(probe.runtime_id);
                p.observed_snapshot =
                    probe
                        .origin
                        .as_ref()
                        .zip(probe.head.as_ref())
                        .map(|(origin, head)| PeerSnapshot {
                            origin: origin.clone(),
                            head: head.clone(),
                        });
                p.last_seen = Some(now());
            }
        }
    }
    fn promote(
        &self,
        profile: ProfileId,
        device: DeviceId,
        endpoint: SocketAddr,
    ) -> Result<(), HostError> {
        let mut values = vec![endpoint];
        if let Some(route) = self
            .host
            .peer_routes(&self.owner)?
            .into_iter()
            .find(|r| r.profile == profile && r.device == device)
        {
            for address in route.endpoints {
                if !values.contains(&address) {
                    values.push(address);
                }
            }
        }
        values.truncate(8);
        self.host
            .save_peer_routes(&self.owner, profile, device, values)
    }
    async fn attempt(
        &self,
        route: Route,
        cancel: PeerCancellation,
        generation: u64,
        force: bool,
    ) -> Result<Option<PeerSyncResult>, HostError> {
        let members = self.host.peer_members(&self.owner, route.profile)?;
        let local = members
            .iter()
            .find(|m| {
                m.device_id == self.host.device_id && !m.revoked && m.state == PeerJoinState::Ready
            })
            .ok_or(HostError::PeerMembershipDenied)?;
        let member = members
            .iter()
            .find(|m| m.device_id == route.device)
            .ok_or(HostError::NotFound)?;
        if member.revoked || member.state != PeerJoinState::Ready {
            return Err(HostError::PeerMembershipDenied);
        }
        let key = (route.profile, route.device);
        let own = self.host.local_origin_state(&self.owner, route.profile)?;
        let id = Uuid::new_v4();
        let memo = {
            let mut shared = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
            if shared.generation != generation {
                return Err(HostError::PeerCancelled);
            }
            let p = shared.progress.entry(key).or_default();
            if p.busy {
                return Err(HostError::PeerBusy);
            }
            p.busy = true;
            p.busy_id = Some(id);
            p.connection = "connecting";
            p.memo.clone().filter(|memo| {
                p.member_generation == member.generation
                    && memo.local_member_generation == local.generation
            })
        };
        let _busy = Busy {
            shared: self.shared.clone(),
            key,
            generation,
            id,
        };
        let result = self
            .transfer_attempt(&route, &member.pin, cancel, generation, own, memo, force)
            .await;
        let result = match result {
            Ok(Some(value)) => self
                .valid_result(key, member.generation, &value)
                .map(|_| Some(value)),
            other => other,
        };
        self.publish(key, generation, member.generation, Some(id), &result);
        result
    }
    async fn transfer_attempt(
        &self,
        route: &Route,
        pin: &str,
        cancel: PeerCancellation,
        generation: u64,
        own: (exomind_core::OriginIdentity, exomind_core::OriginCursor),
        memo: Option<PeerSyncResult>,
        force: bool,
    ) -> Result<Option<PeerSyncResult>, HostError> {
        let pin = PeerPin::from_sha256(pin)?;
        let mut last = HostError::PeerTransportUnavailable;
        let port = self
            .local_addresses()?
            .first()
            .ok_or(HostError::PeerTransportUnavailable)?
            .port();
        for endpoint in &route.endpoints {
            let options = PeerTransportOptions {
                handshake_timeout: Duration::from_secs(2),
                channel_lifetime: Duration::from_secs(120),
            };
            if !force {
                if let Some(saved) = &memo {
                    if saved.events_complete
                        && (!saved.can_send
                            || saved.sent_snapshot.as_ref()
                                == Some(&PeerSnapshot {
                                    origin: own.0.clone(),
                                    head: own.1.clone(),
                                }))
                    {
                        if let Ok(channel) = self
                            .host
                            .connect_peer_transport(
                                &self.owner,
                                *endpoint,
                                pin,
                                options,
                                cancel.clone(),
                            )
                            .await
                        {
                            match self
                                .host
                                .probe_peer_over_transport(
                                    &self.owner,
                                    route.profile,
                                    route.device,
                                    channel,
                                    port,
                                )
                                .await
                            {
                                Ok(probe) => {
                                    self.observed_probe(
                                        (route.profile, route.device),
                                        generation,
                                        &probe,
                                    );
                                    self.promote(route.profile, route.device, *endpoint)?;
                                    if saved.peer_runtime_id == Some(probe.runtime_id)
                                        && (!saved.can_receive
                                            || saved.received_snapshot.as_ref()
                                                == probe
                                                    .origin
                                                    .as_ref()
                                                    .zip(probe.head.as_ref())
                                                    .map(|(origin, head)| PeerSnapshot {
                                                        origin: origin.clone(),
                                                        head: head.clone(),
                                                    })
                                                    .as_ref())
                                    {
                                        return Ok(None);
                                    }
                                }
                                Err(error) => {
                                    last = error;
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
            let channel = match self
                .host
                .connect_peer_transport(&self.owner, *endpoint, pin, options, cancel.clone())
                .await
            {
                Ok(channel) => channel,
                Err(error) => {
                    last = error;
                    continue;
                }
            };
            {
                let mut shared = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
                if shared.generation != generation {
                    return Err(HostError::PeerCancelled);
                }
                shared
                    .progress
                    .entry((route.profile, route.device))
                    .or_default()
                    .connection = "syncing";
            }
            self.host
                .select_peer_service(
                    &self.owner,
                    &channel,
                    PeerServiceKind::Sync,
                    Some(route.profile),
                    Some(route.device),
                    port,
                )
                .await?;
            let value = self
                .host
                .synchronize_peer_profile_over_transport(
                    &self.owner,
                    route.profile,
                    route.device,
                    channel,
                    PeerSyncOptions::default(),
                )
                .await?;
            self.promote(route.profile, route.device, *endpoint)?;
            return Ok(Some(value));
        }
        Err(last)
    }
    async fn run(
        self,
        mut listener: super::PeerTransportListener,
        cancel: PeerCancellation,
        generation: u64,
    ) {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let udp = discovery_socket().ok();
        let mut packet = [0u8; 1025];
        let mut jobs = JoinSet::new();
        loop {
            if cancel.is_cancelled() || self.host.peers.cancel.is_cancelled() {
                break;
            }
            // Fair selection keeps a stream of new handshakes from starving
            // discovery/local-head checks; the explicit check fences cancel.
            tokio::select! {
                _=cancel.cancelled()=>break,
                _=self.host.peers.cancel.cancelled()=>break,
                result=listener.accept(cancel.clone())=>{match result {Ok(channel)=>{if jobs.len()>=8{drop(channel);continue;}let network=self.clone();let lease=match self.host.peers.register(false){Ok(l)=>l,Err(_)=>break};jobs.spawn(async move{let _lease=lease;if let Ok(outcome)=network.host.accept_peer_service(&network.owner,channel).await{network.incoming(generation,outcome);}});},Err(HostError::PeerTimeout)=>{},Err(_)=>break}},
                received=async{match &udp {Some(socket)=>socket.recv_from(&mut packet).await,None=>std::future::pending().await}}=>{
                    if let Ok((n,source))=received{if n<=1024{if let Ok(value)=serde_json::from_slice::<Announcement>(&packet[..n]){let _=self.remember_announcement(value,source,generation);}}}
                },
                _=interval.tick()=>{
                    if let Ok(mut state)=self.shared.lock(){if state.generation!=generation{break;}state.addresses=endpoints(listener.addr());}
                    if let Some(socket)=&udp {if let Ok(identity)=self.host.device_identity(&self.owner){if let Ok(bytes)=serde_json::to_vec(&Announcement{protocol:"exomind-discovery/1".into(),device_id:self.host.device_id,fingerprint_sha256:identity.fingerprint_sha256,listen_port:listener.addr().port()}){let _=socket.try_send_to(&bytes,SocketAddr::from((DISCOVERY_GROUP,DISCOVERY_PORT)));let _=socket.try_send_to(&bytes,SocketAddr::from((Ipv4Addr::BROADCAST,DISCOVERY_PORT)));}}}
                    if jobs.len()>=2{continue;}if let Ok(mut routes)=self.routes(){if !routes.is_empty(){let mut state=match self.shared.lock(){Ok(s)=>s,Err(_)=>return};let count=routes.len();routes.rotate_left(state.route_cursor%count);state.route_cursor=state.route_cursor.wrapping_add(1);routes.sort_by_key(|r|!state.forced.contains(&(r.profile,r.device)));}for route in routes {if jobs.len()>=2{break;}let key=(route.profile,route.device);let force;{let mut state=match self.shared.lock(){Ok(s)=>s,Err(_)=>return};force=state.forced.remove(&key);if state.progress.get(&key).is_some_and(|p|p.busy||(!force&&p.retry.is_some_and(|at|at>Instant::now()))){continue;}}
                        let network=self.clone();let cancel=cancel.clone();jobs.spawn(async move{let _=network.attempt(route,cancel,generation,force).await;});
                    }}
                },
                _=jobs.join_next(),if !jobs.is_empty()=>{},
            }
        }
        cancel.cancel();
        drop(listener);
        let drain = async { while jobs.join_next().await.is_some() {} };
        if tokio::time::timeout(Duration::from_secs(6), drain)
            .await
            .is_err()
        {
            jobs.abort_all();
            while jobs.join_next().await.is_some() {}
        }
        if let Ok(mut shared) = self.shared.lock() {
            if shared.generation == generation {
                shared.generation = shared.generation.saturating_add(1);
                shared.addresses.clear();
                shared.candidates.clear();
                for progress in shared.progress.values_mut() {
                    progress.busy = false;
                    progress.busy_id = None;
                    progress.connection = "idle";
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "network_tests.rs"]
mod tests;
