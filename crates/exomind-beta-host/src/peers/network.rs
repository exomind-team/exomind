//! Native-owned discovery, routing and finite sync attempts. No UI polling,
//! browser timer or development HTTP server owns this lifecycle.
use super::{
    EnvironmentAliasSource, PeerCancellation, PeerInvitation, PeerJoinState, PeerPin,
    PeerServiceKind, PeerServiceOutcome, PeerSnapshot, PeerSyncOptions, PeerSyncResult,
    PeerTransportOptions,
    network_store::{PeerAliasClaim, PeerNetworkSettings, Route},
};
use crate::{BetaHost, HostError, Session};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use exomind_core::{DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    net::{TcpStream, UdpSocket},
    sync::Semaphore,
    task::{JoinHandle, JoinSet},
};
use uuid::Uuid;
#[path = "original_network.rs"]
mod original_network;
use original_network::auto_queue::{AutoCompletion, AutoQueue};
pub use original_network::{OriginalAutoQueueStatus, PeerOriginalStatus};

fn discovery_port() -> u16 {
    #[cfg(not(test))]
    {
        43343
    }
    #[cfg(test)]
    {
        // Tests must not share discovery traffic with the user's running app.
        static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
        *PORT.get_or_init(|| {
            std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
                .expect("reserve an isolated test discovery port")
                .local_addr()
                .expect("read test discovery port")
                .port()
        })
    }
}
const DISCOVERY_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 77, 68);
#[derive(Debug, Clone, Serialize)]
pub struct PeerConnectionView {
    pub device_id: DeviceId,
    pub fingerprint_sha256: String,
    pub effective_alias: String,
    pub alias_source: EnvironmentAliasSource,
    pub alias_verification: &'static str,
    pub alias_confirmed_at_ms: Option<i64>,
    pub member_generation: u64,
    pub member_state: &'static str,
    pub connection_state: &'static str,
    pub endpoints: Vec<String>,
    pub last_sync_at_ms: Option<i64>,
    pub last_error_code: Option<&'static str>,
    pub event_sync: &'static str,
    pub originals_sync: &'static str,
    pub history_gaps: Vec<PeerHistoryGap>,
}
#[derive(Debug, Clone, Serialize)]
pub struct PeerHistoryGap {
    pub direction: &'static str,
    pub origin_device_id: DeviceId,
    pub materialized_seq: u64,
    pub available_seq: Option<u64>,
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

/// An expiring presence/address hint; it is not verified identity or profile access.
#[derive(Debug, Clone, Serialize)]
pub struct NearbyPeerCandidate {
    pub device_id: DeviceId,
    pub fingerprint_sha256: String,
    pub effective_alias: String,
    pub alias_source: EnvironmentAliasSource,
    pub alias_verification: &'static str,
    pub alias_confirmed_at_ms: Option<i64>,
    pub addresses: Vec<String>,
    pub expires_at_ms: i64,
    pub verification_state: &'static str,
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
    observed_history_fingerprint: Option<String>,
}
struct Candidate {
    endpoint: SocketAddr,
    pin: String,
    expires: Instant,
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct NearbyKey {
    device_id: DeviceId,
    pin: String,
}
/// Kept separate from trusted route candidates and never consumed by sync work.
struct NearbyCandidate {
    addresses: Vec<SocketAddr>,
    expires: Instant,
}
#[derive(Clone)]
struct ObservedAlias {
    alias: String,
    source: EnvironmentAliasSource,
    revision: u64,
    expires: Instant,
}
fn alias_projection(
    device: DeviceId,
    observed: Option<&ObservedAlias>,
    claim: Option<&PeerAliasClaim>,
) -> (String, EnvironmentAliasSource, &'static str, Option<i64>) {
    if let (Some(observed), Some(claim)) = (observed, claim)
        && observed.revision == claim.revision
        && observed.alias == claim.effective_alias
        && observed.source == claim.source
        && claim.confirmed_at_ms.is_some()
    {
        return (
            observed.alias.clone(),
            observed.source,
            "confirmed",
            claim.confirmed_at_ms,
        );
    }
    if let Some(observed) = observed
        && claim.is_none_or(|claim| observed.revision >= claim.revision)
    {
        return (observed.alias.clone(), observed.source, "signed", None);
    }
    if let Some(claim) = claim {
        if let Some(confirmed_at_ms) = claim.confirmed_at_ms {
            return (
                claim.effective_alias.clone(),
                claim.source,
                "confirmed",
                Some(confirmed_at_ms),
            );
        }
        let age_ms = now().saturating_sub(claim.observed_at_ms);
        if age_ms <= CANDIDATE_TTL.as_millis() as i64 {
            return (
                claim.effective_alias.clone(),
                claim.source,
                "signed",
                None,
            );
        }
    }
    (
        super::network_management::stable_environment_alias(device),
        EnvironmentAliasSource::StableId,
        "none",
        None,
    )
}
fn alias_confirmation_eligible(result: &PeerSyncResult) -> bool {
    result.events_complete
        && !result.local_missing_originals
        && !result.peer_missing_originals
        && result.local_projection_complete != Some(false)
        && result.peer_projection_complete != Some(false)
}
struct Shared {
    generation: u64,
    addresses: Vec<SocketAddr>,
    progress: HashMap<(ProfileId, DeviceId), Progress>,
    forced: HashSet<(ProfileId, DeviceId)>,
    candidates: HashMap<DeviceId, Vec<Candidate>>,
    // Unverified advertisements stay outside route selection and auto-sync.
    nearby: HashMap<NearbyKey, NearbyCandidate>,
    observed_aliases: HashMap<(DeviceId, String), ObservedAlias>,
    route_cursor: usize,
    auto_deferred: bool,
    auto_error: Option<&'static str>,
    #[cfg(test)]
    auto_yields: usize,
    #[cfg(test)]
    auto_tick_paused: bool,
}
struct Running {
    cancel: PeerCancellation,
    task: JoinHandle<()>,
    incoming: Arc<super::original_transfer::TransferCompletion>,
    joined: bool,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.incoming.close();
    }
}
impl Running {
    async fn drain(&mut self) -> Result<(), HostError> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        self.cancel.cancel();
        let mut failed = false;
        if !self.joined {
            match tokio::time::timeout_at(deadline, &mut self.task).await {
                Ok(result) => failed = result.is_err(),
                Err(_) => {
                    self.task.abort();
                    let _ = (&mut self.task).await;
                    failed = true;
                }
            }
            self.joined = true;
        }
        self.incoming.close();
        self.incoming
            .wait_closed(deadline.saturating_duration_since(tokio::time::Instant::now()))
            .await?;
        if failed {
            Err(HostError::Shutdown)
        } else {
            Ok(())
        }
    }
}
pub struct PeerNetwork {
    host: Arc<BetaHost>,
    owner: Session,
    lifecycle: tokio::sync::Mutex<Option<Running>>,
    control: tokio::sync::Mutex<()>,
    shared: Arc<Mutex<Shared>>,
    scan: Arc<Mutex<ScanState>>,
    originals: Arc<original_network::OriginalJobs>,
    restore_wake: Arc<tokio::sync::Notify>,
}
impl Drop for PeerNetwork {
    fn drop(&mut self) {
        self.originals.cancel_all();
        if let Ok(mut scan) = self.scan.lock() {
            scan.generation = scan.generation.wrapping_add(1);
            if let Some(cancel) = scan.cancel.take() {
                cancel.cancel();
            }
            if let Some(mut result) = scan.result.take() {
                if result.finished_at_ms == 0 {
                    result.cancelled = true;
                    result.stage = "cancelled";
                    result.finished_at_ms = now();
                }
                scan.result = Some(result);
            }
            scan.active_id = None;
        }
        drop(self.lifecycle.get_mut().take());
    }
}
#[derive(Clone)]
struct Worker {
    host: Arc<BetaHost>,
    owner: Session,
    shared: Arc<Mutex<Shared>>,
    originals: Arc<original_network::OriginalJobs>,
    restore_wake: Arc<tokio::sync::Notify>,
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

// Bounded, user-triggered nearby scanning. Passive discovery stays cheap and
// automatic; only an explicit user scan is allowed to issue TCP 43344 probes.
const MAX_SCAN_INTERFACES: usize = 8;
const MAX_SCAN_HOSTS: usize = 1024;
const MAX_SCAN_IN_FLIGHT: usize = 32;
const MAX_SCAN_DISCOVERED_ADDRESSES: usize = 64;
const SCAN_REQUEST_TIMEOUT: Duration = Duration::from_millis(800);
const SCAN_TOTAL_BUDGET: Duration = Duration::from_secs(15);
const MIN_MANUAL_SCAN_PREFIX: u8 = 8;
const SCAN_SERVICE_PORT: u16 = 43344;

/// A discovered local interface scope. Only eligible IPv4 scopes are scanned;
/// excluded scopes keep their reason so the UI can explain why.
#[derive(Debug, Clone, Serialize)]
pub struct ScanScope {
    pub scope_id: String,
    pub interface_name: String,
    pub kind: &'static str,
    pub prefix: u8,
    pub eligible: bool,
    pub network: String,
    pub reason: Option<&'static str>,
}

/// One finite scan. `finished_at_ms` is `0` while the scan is still running.
#[derive(Debug, Clone, Serialize)]
pub struct NetworkScanResult {
    pub scan_id: Uuid,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
    pub stage: &'static str,
    pub scopes: Vec<ScanScope>,
    pub attempted: usize,
    pub discovered: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub discovered_addresses: Vec<String>,
}

#[derive(Debug, Clone)]
struct ScanRequest {
    scope_id: String,
    interface_name: String,
    kind: &'static str,
    network: Ipv4Addr,
    prefix: u8,
}

#[derive(Clone, Default)]
struct ScanState {
    generation: u64,
    active_id: Option<Uuid>,
    cancel: Option<PeerCancellation>,
    result: Option<NetworkScanResult>,
}

impl ScanState {
    fn snapshot(&self, scan_id: Uuid) -> Option<NetworkScanResult> {
        let result = self.result.as_ref()?;
        if result.scan_id != scan_id {
            return None;
        }
        Some(result.clone())
    }
}

fn mask_ipv4(ip: Ipv4Addr, prefix: u8) -> Ipv4Addr {
    let mask = if prefix == 0 {
        0u32
    } else {
        u32::MAX << (32 - prefix)
    };
    Ipv4Addr::from(u32::from(ip) & mask)
}

fn scan_cidr_string(network: Ipv4Addr, prefix: u8) -> String {
    let network = mask_ipv4(network, prefix);
    format!("{network}/{prefix}")
}

fn sanitize_scope_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if out.len() >= 24 {
            break;
        }
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push_str("iface");
    }
    out
}

fn stable_scope_hash(value: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Stable, bounded, collision-resistant key: canonical network/IP first, then
/// a short display name and a 64-bit FNV hash of the full raw identity.
fn derive_scope_id(interface_name: &str, key: &str) -> String {
    let hash = stable_scope_hash(&format!("{key}\u{0}{interface_name}"));
    format!("{key}:{}:{hash}", sanitize_scope_name(interface_name))
}

fn is_easytier_interface(name: &str) -> bool {
    name.to_ascii_lowercase().contains("easytier")
}

fn is_overlay_interface(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("et_")
        || lower.contains("tailscale")
        || lower.contains("zerotier")
        || lower.contains("wireguard")
        || lower.contains("nordlynx")
        || lower.contains("mullvad")
        || lower.starts_with("tun")
        || lower.starts_with("tap")
        || lower.starts_with("utun")
        || lower.starts_with("wg")
        || lower.starts_with("zt")
}

fn is_virtual_or_wsl_interface(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("wsl")
        || lower.contains("vethernet")
        || lower.contains("docker")
        || lower.contains("vmnet")
        || lower.contains("vbox")
        || lower.contains("vmware")
        || lower.contains("hyper-v")
        || lower.contains("hyperv")
        || lower.contains("virtual")
}

fn classify_scan_interface(
    name: &str,
    ip: IpAddr,
) -> (&'static str, bool, Option<&'static str>) {
    if ip.is_loopback() {
        return ("other", false, Some("loopback"));
    }
    if ip.is_unspecified() {
        return ("other", false, Some("unspecified_address"));
    }
    if ip.is_multicast() {
        return ("other", false, Some("multicast_address"));
    }
    match ip {
        IpAddr::V4(v4) if v4.is_broadcast() => return ("other", false, Some("broadcast_address")),
        IpAddr::V4(v4) if v4.is_link_local() => return ("other", false, Some("link_local_address")),
        IpAddr::V6(v6) if v6.is_unicast_link_local() => {
            return ("other", false, Some("link_local_address"))
        }
        IpAddr::V6(_) => return ("other", false, Some("ipv6_not_scanned")),
        IpAddr::V4(_) => {}
    }
    if is_virtual_or_wsl_interface(name) {
        return ("other", false, Some("virtual_interface"));
    }
    if is_easytier_interface(name) {
        return ("easytier", true, None);
    }
    if is_overlay_interface(name) {
        return ("overlay", true, None);
    }
    ("physical_lan", true, None)
}

fn build_scan_scopes_from(
    interfaces: impl Iterator<Item = (String, IpAddr)>,
) -> Vec<ScanScope> {
    let mut output = Vec::new();
    let mut seen_scope_ids = HashSet::new();
    for (name, ip) in interfaces {
        let (kind, eligible, reason) = classify_scan_interface(&name, ip);
        let (scope_id, prefix, network) = match ip {
            IpAddr::V4(v4) => {
                let prefix = 24u8;
                let network = scan_cidr_string(v4, prefix);
                (derive_scope_id(&name, &network), prefix, network)
            }
            IpAddr::V6(_) => (derive_scope_id(&name, &ip.to_string()), 0u8, String::new()),
        };
        if !seen_scope_ids.insert(scope_id.clone()) {
            continue;
        }
        output.push(ScanScope {
            scope_id,
            interface_name: name,
            kind,
            prefix,
            eligible,
            network,
            reason,
        });
    }
    // The scan hard-cap limits selectable scopes; extra eligible interfaces
    // stay visible as explanatory ineligible rows instead of disappearing.
    let mut eligible_seen = 0usize;
    for scope in &mut output {
        if scope.eligible {
            if eligible_seen >= MAX_SCAN_INTERFACES {
                scope.eligible = false;
                scope.reason = Some("scope_limit");
            } else {
                eligible_seen += 1;
            }
        }
    }
    output.sort_by_key(|scope| {
        (
            !scope.eligible,
            scope.kind != "physical_lan",
            scope.interface_name.clone(),
        )
    });
    output
}

fn discover_scan_scopes() -> Vec<ScanScope> {
    build_scan_scopes_from(
        if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .map(|interface| {
                let name = interface.name.clone();
                let ip = interface.ip();
                (name, ip)
            }),
    )
}

fn parse_ipv4_cidr(value: &str) -> Result<(Ipv4Addr, u8), HostError> {
    let value = value.trim();
    let Some((ip, prefix)) = value.split_once('/') else {
        return Err(HostError::InvalidRequest);
    };
    let ip = ip.parse::<Ipv4Addr>().map_err(|_| HostError::InvalidRequest)?;
    let prefix = prefix.parse::<u8>().map_err(|_| HostError::InvalidRequest)?;
    if prefix > 32 {
        return Err(HostError::InvalidRequest);
    }
    Ok((mask_ipv4(ip, prefix), prefix))
}

fn reject_unsafe_scan_network(network: Ipv4Addr) -> Result<(), HostError> {
    if network.is_unspecified()
        || network.is_loopback()
        || network.is_link_local()
        || network.is_broadcast()
        || network.is_multicast()
    {
        return Err(HostError::InvalidScanScope);
    }
    Ok(())
}

fn build_scan_requests(
    scope_ids: Vec<String>,
    manual_cidrs: Vec<String>,
    discovered: &[ScanScope],
) -> Result<Vec<ScanRequest>, HostError> {
    let mut requests: Vec<ScanRequest> = Vec::new();
    let mut seen_scope_ids = HashSet::new();
    for id in scope_ids {
        let id = id.trim();
        if id.is_empty() {
            return Err(HostError::InvalidRequest);
        }
        if !seen_scope_ids.insert(id.to_string()) {
            continue;
        }
        let scope = discovered
            .iter()
            .find(|scope| scope.scope_id == id)
            .ok_or(HostError::InvalidRequest)?;
        if !scope.eligible {
            return Err(HostError::InvalidRequest);
        }
        let (network, prefix) = parse_ipv4_cidr(&scope.network)?;
        requests.push(ScanRequest {
            scope_id: scope.scope_id.clone(),
            interface_name: scope.interface_name.clone(),
            kind: scope.kind,
            network,
            prefix,
        });
    }
    let mut seen_manual = HashSet::new();
    for cidr in manual_cidrs {
        let cidr = cidr.trim();
        if cidr.is_empty() {
            continue;
        }
        let (network, prefix) = parse_ipv4_cidr(cidr)?;
        if prefix < MIN_MANUAL_SCAN_PREFIX {
            return Err(HostError::InvalidRequest);
        }
        reject_unsafe_scan_network(network)?;
        if !seen_manual.insert((network, prefix)) {
            continue;
        }
        requests.push(ScanRequest {
            scope_id: format!("manual:{}", scan_cidr_string(network, prefix)),
            interface_name: cidr.to_string(),
            kind: "manual",
            network,
            prefix,
        });
    }
    if requests.is_empty() {
        return Err(HostError::InvalidRequest);
    }
    if requests.len() > MAX_SCAN_INTERFACES {
        return Err(HostError::InvalidRequest);
    }
    Ok(requests)
}

/// Per-host safety gate. Broad manual CIDRs (for example `169.0.0.0/8`) can
/// still contain loopback/link-local/special ranges after masking, so the scan
/// loop must reject those hosts one by one instead of trusting the base only.
fn unsafe_scan_host(addr: Ipv4Addr) -> bool {
    addr.is_unspecified()
        || addr.is_loopback()
        || addr.is_link_local()
        || addr.is_broadcast()
        || addr.is_multicast()
}

struct EnumeratedHosts {
    hosts: Vec<Ipv4Addr>,
    skipped: usize,
}

fn enumerate_scan_hosts(
    network: Ipv4Addr,
    prefix: u8,
    self_ips: &HashSet<Ipv4Addr>,
    scheduled: &mut HashSet<Ipv4Addr>,
    remaining_budget: usize,
) -> EnumeratedHosts {
    let base = u32::from(network) as u64;
    let total = if prefix == 0 {
        1u64 << 32
    } else {
        1u64 << (32 - prefix)
    };
    let first = if prefix >= 31 { 0u64 } else { 1u64 };
    let last = if prefix >= 31 {
        total.saturating_sub(1)
    } else {
        total.saturating_sub(2)
    };
    let mut hosts = Vec::new();
    let mut skipped = 0usize;
    if prefix < 31 {
        skipped += 1; // network address
    }
    if prefix < 31 && total >= 2 {
        skipped += 1; // broadcast address
    }
    let mut offset = first;
    while offset <= last {
        if hosts.len() >= remaining_budget {
            skipped = skipped.saturating_add(
                (last - offset + 1).min(usize::MAX as u64) as usize,
            );
            break;
        }
        let addr = Ipv4Addr::from((base + offset) as u32);
        if unsafe_scan_host(addr) {
            skipped += 1;
        } else if self_ips.contains(&addr) {
            skipped += 1;
        } else if !scheduled.insert(addr) {
            skipped += 1;
        } else {
            hosts.push(addr);
        }
        offset += 1;
    }
    EnumeratedHosts { hosts, skipped }
}

fn scan_scope_from_request(request: &ScanRequest) -> ScanScope {
    ScanScope {
        scope_id: request.scope_id.clone(),
        interface_name: request.interface_name.clone(),
        kind: request.kind,
        prefix: request.prefix,
        eligible: true,
        network: scan_cidr_string(request.network, request.prefix),
        reason: None,
    }
}

fn local_scan_self_ips() -> HashSet<Ipv4Addr> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip)
                if !ip.is_loopback()
                    && !ip.is_unspecified()
                    && !ip.is_multicast()
                    && !ip.is_broadcast()
                    && !ip.is_link_local() =>
            {
                Some(ip)
            }
            _ => None,
        })
        .collect()
}

async fn tcp_probe_open(
    address: SocketAddr,
    timeout: Duration,
    cancel: &PeerCancellation,
) -> bool {
    tokio::select! {
        _ = cancel.cancelled() => false,
        result = tokio::time::timeout(timeout, TcpStream::connect(address)) => {
            matches!(result, Ok(Ok(_stream)))
        }
    }
}

/// One finite TCP probe pass. It only ever produces unverified open-port
/// address candidates; it never writes routes, memberships, grants or facts.
/// Passive UDP announcements and known endpoints remain the responsibility of
/// the already-running discovery worker (`Worker::run`); this pass opens no
/// additional UDP socket, so it cannot race the listener's discovery lease.
async fn run_scan_probe(
    scan_id: Uuid,
    started_at_ms: i64,
    service_port: u16,
    scopes: &[ScanRequest],
    self_ips: &HashSet<Ipv4Addr>,
    cancel: &PeerCancellation,
    progress: &Mutex<NetworkScanResult>,
) -> NetworkScanResult {
    let mut scheduled: HashSet<Ipv4Addr> = HashSet::new();
    let mut hosts: Vec<Ipv4Addr> = Vec::new();
    let mut skipped = 0usize;
    for scope in scopes {
        let remaining = MAX_SCAN_HOSTS.saturating_sub(hosts.len());
        let enumerated =
            enumerate_scan_hosts(scope.network, scope.prefix, self_ips, &mut scheduled, remaining);
        skipped = skipped.saturating_add(enumerated.skipped);
        hosts.extend(enumerated.hosts);
        if hosts.len() >= MAX_SCAN_HOSTS {
            break;
        }
    }

    let mut attempted = 0usize;
    let mut discovered = 0usize;
    let mut discovered_addresses = Vec::new();
    let semaphore = Arc::new(Semaphore::new(MAX_SCAN_IN_FLIGHT));
    let budget_start = Instant::now();
    let mut join_set = JoinSet::new();
    let mut host_index = 0usize;

    while host_index < hosts.len() {
        if cancel.is_cancelled() || budget_start.elapsed() >= SCAN_TOTAL_BUDGET {
            skipped = skipped.saturating_add(hosts.len() - host_index);
            break;
        }
        let host = hosts[host_index];
        host_index += 1;
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            skipped = skipped.saturating_add(hosts.len() - host_index + 1);
            break;
        };
        if cancel.is_cancelled() {
            skipped = skipped.saturating_add(hosts.len() - host_index + 1);
            break;
        }
        attempted += 1;
        let probe_cancel = cancel.clone();
        join_set.spawn(async move {
            let _permit = permit;
            let address = SocketAddr::new(IpAddr::V4(host), service_port);
            let opened = tcp_probe_open(address, SCAN_REQUEST_TIMEOUT, &probe_cancel).await;
            (host, address, opened)
        });
        let snapshot = NetworkScanResult {
            scan_id,
            started_at_ms,
            finished_at_ms: 0,
            stage: "tcp_probe",
            scopes: scopes.iter().map(scan_scope_from_request).collect(),
            attempted,
            discovered,
            skipped,
            cancelled: false,
            discovered_addresses: discovered_addresses.iter().map(ToString::to_string).collect(),
        };
        if let Ok(mut slot) = progress.lock() {
            *slot = snapshot;
        }
    }

    while let Some(result) = join_set.join_next().await {
        if let Ok((_host, address, opened)) = result {
            if opened {
                discovered += 1;
                if discovered_addresses.len() < MAX_SCAN_DISCOVERED_ADDRESSES {
                    discovered_addresses.push(address);
                }
            }
        }
    }

    let cancelled = cancel.is_cancelled();
    NetworkScanResult {
        scan_id,
        started_at_ms,
        finished_at_ms: now(),
        stage: if cancelled { "cancelled" } else { "complete" },
        scopes: scopes.iter().map(scan_scope_from_request).collect(),
        attempted,
        discovered,
        skipped,
        cancelled,
        discovered_addresses: discovered_addresses.iter().map(ToString::to_string).collect(),
    }
}

const DISCOVERY_PROTOCOL_V1: &str = "exomind-discovery/1";
const DISCOVERY_PROTOCOL_V2: &str = "exomind-discovery/2";
const DISCOVERY_ALIAS_DOMAIN: &[u8] = b"exomind-discovery-alias/2\0";

#[derive(Debug, Clone, PartialEq, Eq)]
struct AnnouncementAlias {
    effective_alias: String,
    source: EnvironmentAliasSource,
    revision: u64,
}

#[derive(Debug, Clone)]
struct Announcement {
    device_id: DeviceId,
    fingerprint_sha256: String,
    listen_port: u16,
    alias: Option<AnnouncementAlias>,
}

#[derive(Serialize)]
struct LegacyAnnouncement<'a> {
    protocol: &'static str,
    device_id: DeviceId,
    fingerprint_sha256: &'a str,
    listen_port: u16,
}

#[derive(Serialize)]
struct EnrichedAnnouncement<'a> {
    protocol: &'static str,
    device_id: DeviceId,
    fingerprint_sha256: &'a str,
    listen_port: u16,
    effective_alias: &'a str,
    alias_source: EnvironmentAliasSource,
    alias_revision: u64,
    signer_spki_der_base64: &'a str,
    signature_base64: &'a str,
}

#[derive(Serialize)]
struct EnrichedAnnouncementPayload<'a> {
    protocol: &'static str,
    device_id: DeviceId,
    fingerprint_sha256: &'a str,
    listen_port: u16,
    effective_alias: &'a str,
    alias_source: EnvironmentAliasSource,
    alias_revision: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyAnnouncementWire {
    protocol: String,
    device_id: DeviceId,
    fingerprint_sha256: String,
    listen_port: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnrichedAnnouncementWire {
    protocol: String,
    device_id: DeviceId,
    fingerprint_sha256: String,
    listen_port: u16,
    effective_alias: String,
    alias_source: EnvironmentAliasSource,
    alias_revision: u64,
    signer_spki_der_base64: String,
    signature_base64: String,
}

impl Announcement {
    fn legacy_bytes(&self) -> Option<Vec<u8>> {
        serde_json::to_vec(&LegacyAnnouncement {
            protocol: DISCOVERY_PROTOCOL_V1,
            device_id: self.device_id,
            fingerprint_sha256: &self.fingerprint_sha256,
            listen_port: self.listen_port,
        })
        .ok()
    }

    fn enriched_bytes(&self, identity: &super::Identity) -> Option<Vec<u8>> {
        let alias = self.alias.as_ref()?;
        let payload = EnrichedAnnouncementPayload {
            protocol: DISCOVERY_PROTOCOL_V2,
            device_id: self.device_id,
            fingerprint_sha256: &self.fingerprint_sha256,
            listen_port: self.listen_port,
            effective_alias: &alias.effective_alias,
            alias_source: alias.source,
            alias_revision: alias.revision,
        };
        let mut message = DISCOVERY_ALIAS_DOMAIN.to_vec();
        message.extend(serde_json::to_vec(&payload).ok()?);
        let signature = identity.sign_message(&message).ok()?;
        serde_json::to_vec(&EnrichedAnnouncement {
            protocol: DISCOVERY_PROTOCOL_V2,
            device_id: self.device_id,
            fingerprint_sha256: &self.fingerprint_sha256,
            listen_port: self.listen_port,
            effective_alias: &alias.effective_alias,
            alias_source: alias.source,
            alias_revision: alias.revision,
            signer_spki_der_base64: &BASE64.encode(&identity.info.spki_der),
            signature_base64: &BASE64.encode(signature),
        })
        .ok()
    }
}

fn parse_announcement(bytes: &[u8]) -> Option<Announcement> {
    if let Ok(value) = serde_json::from_slice::<EnrichedAnnouncementWire>(bytes) {
        if value.protocol == DISCOVERY_PROTOCOL_V2 {
            let spki = BASE64.decode(value.signer_spki_der_base64).ok()?;
            let signature = BASE64.decode(value.signature_base64).ok()?;
            if spki.len() > 64 || signature.len() != 64 {
                return None;
            }
            let signer = super::DeviceIdentityInfo {
                device_id: value.device_id,
                spki_der: spki,
                fingerprint_sha256: value.fingerprint_sha256.clone(),
            };
            let normalized =
                super::network_management::normalize_environment_alias(&value.effective_alias)
                    .ok()?;
            if normalized != value.effective_alias {
                return None;
            }
            let payload = EnrichedAnnouncementPayload {
                protocol: DISCOVERY_PROTOCOL_V2,
                device_id: value.device_id,
                fingerprint_sha256: &value.fingerprint_sha256,
                listen_port: value.listen_port,
                effective_alias: &value.effective_alias,
                alias_source: value.alias_source,
                alias_revision: value.alias_revision,
            };
            let mut message = DISCOVERY_ALIAS_DOMAIN.to_vec();
            message.extend(serde_json::to_vec(&payload).ok()?);
            super::identity::verify_message(&signer, &message, &signature).ok()?;
            return Some(Announcement {
                device_id: value.device_id,
                fingerprint_sha256: value.fingerprint_sha256,
                listen_port: value.listen_port,
                alias: Some(AnnouncementAlias {
                    effective_alias: normalized,
                    source: value.alias_source,
                    revision: value.alias_revision,
                }),
            });
        }
    }
    let value = serde_json::from_slice::<LegacyAnnouncementWire>(bytes).ok()?;
    if value.protocol != DISCOVERY_PROTOCOL_V1 {
        return None;
    }
    Some(Announcement {
        device_id: value.device_id,
        fingerprint_sha256: value.fingerprint_sha256,
        listen_port: value.listen_port,
        alias: None,
    })
}

fn discovery_frames(
    identity: &super::Identity,
    listen_port: u16,
    alias: Option<AnnouncementAlias>,
) -> (Option<Vec<u8>>, Option<Vec<u8>>) {
    let identity_info = &identity.info;
    let base = Announcement {
        device_id: identity_info.device_id,
        fingerprint_sha256: identity_info.fingerprint_sha256.clone(),
        listen_port,
        alias: None,
    };
    // Legacy discovery is independent of alias/wire-signing availability.
    let legacy = base.legacy_bytes();
    let enriched = alias.and_then(|alias| {
        Announcement {
            device_id: identity_info.device_id,
            fingerprint_sha256: identity_info.fingerprint_sha256.clone(),
            listen_port,
            alias: Some(alias),
        }
        .enriched_bytes(identity)
    });
    (legacy, enriched)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn error_code(error: &HostError) -> &'static str {
    if let Some(kind) = error.peer_transport_failure() {
        return kind.code();
    }
    match error {
        HostError::PeerProtocolMismatch => "protocol_mismatch",
        HostError::PeerTimeout => "peer_timeout",
        HostError::PeerBusy => "peer_busy",
        HostError::PeerNetworkDisabled => "peer_network_disabled",
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
fn join_route_error_priority(error: &HostError) -> u8 {
    match error {
        HostError::Stopped | HostError::PeerCancelled => 3,
        HostError::PeerPinMismatch => 2,
        HostError::PeerTls => 1,
        _ => 0,
    }
}
const MAX_SHAREABLE_ENDPOINTS: usize = 7;
const MAX_INVITATION_ENDPOINT_REPORTS: usize = 8;
const JOIN_ROUTE_TIMEOUT: Duration = Duration::from_secs(10);

fn interface_ips(listener: SocketAddr) -> Vec<IpAddr> {
    let mut ips: Vec<IpAddr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.ip())
        .filter(|ip| {
            ip.is_ipv4() == listener.is_ipv4()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_loopback()
                && !matches!(ip, IpAddr::V6(v) if v.is_unicast_link_local())
        })
        .collect();
    ips.sort_by_key(|ip| match ip {
        IpAddr::V4(v) if v.octets()[0] == 192 => (0, ip.to_string()),
        IpAddr::V4(_) => (1, ip.to_string()),
        IpAddr::V6(_) => (2, ip.to_string()),
    });
    ips.dedup();
    ips
}

fn canonical_ip(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(ip)),
        v4 => v4,
    }
}

pub(super) fn is_shareable_endpoint(address: SocketAddr) -> bool {
    match canonical_ip(address.ip()) {
        IpAddr::V4(ip) => {
            address.port() != 0
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_loopback()
                && !ip.is_link_local()
        }
        IpAddr::V6(ip) => {
            address.port() != 0
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_loopback()
                && !ip.is_unicast_link_local()
        }
    }
}

fn non_shareable_code(address: SocketAddr) -> &'static str {
    let ip = canonical_ip(address.ip());
    if address.port() == 0 {
        "invalid_port"
    } else if ip.is_unspecified() {
        "unspecified_address"
    } else if ip.is_multicast() {
        "multicast_address"
    } else if matches!(ip, IpAddr::V4(ip) if ip.is_broadcast()) {
        "broadcast_address"
    } else if ip.is_loopback() {
        "loopback_not_shareable"
    } else if matches!(ip, IpAddr::V4(ip) if ip.is_link_local())
        || matches!(ip, IpAddr::V6(ip) if ip.is_unicast_link_local())
    {
        "link_local_address"
    } else {
        "not_shareable"
    }
}

/// Local diagnostic endpoints retain loopback for same-host verification.
fn endpoints(listener: SocketAddr) -> Vec<SocketAddr> {
    let port = listener.port();
    let mut output: Vec<_> = interface_ips(listener)
        .into_iter()
        .take(MAX_SHAREABLE_ENDPOINTS)
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

fn shareable_endpoints(listener: SocketAddr, ips: Vec<IpAddr>) -> Vec<SocketAddr> {
    let port = listener.port();
    let mut seen = HashSet::new();
    ips
        .into_iter()
        .map(|ip| SocketAddr::new(ip, port))
        .filter(|address| is_shareable_endpoint(*address) && seen.insert(*address))
        .take(MAX_SHAREABLE_ENDPOINTS)
        .collect()
}

#[cfg(test)]
fn shareable_endpoints_for_test(listener: SocketAddr, ips: Vec<IpAddr>) -> Vec<SocketAddr> {
    shareable_endpoints(listener, ips)
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JoinCandidateClassification {
    pub skipped_loopback: usize,
    pub attempted: usize,
}

#[cfg(test)]
fn classify_join_candidates(candidates: Vec<SocketAddr>) -> JoinCandidateClassification {
    let skipped_loopback = candidates
        .iter()
        .filter(|address| address.ip().is_loopback())
        .count();
    JoinCandidateClassification {
        skipped_loopback,
        attempted: candidates.len() - skipped_loopback,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InvitationEndpointDisposition {
    Attempted,
    Skipped,
    Reachable,
    IdentityMismatch,
    Unreachable,
    ProtocolMismatch,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvitationEndpointReport {
    pub endpoint: String,
    pub disposition: InvitationEndpointDisposition,
    pub elapsed_ms: u64,
    pub error_code: Option<&'static str>,
}

fn classify_probe_error(error: &HostError) -> (InvitationEndpointDisposition, Option<&'static str>) {
    match error {
        HostError::PeerPinMismatch => (
            InvitationEndpointDisposition::IdentityMismatch,
            Some("pin_mismatch"),
        ),
        HostError::PeerProtocolMismatch => (
            InvitationEndpointDisposition::ProtocolMismatch,
            Some("protocol_mismatch"),
        ),
        HostError::PeerTls => (
            InvitationEndpointDisposition::ProtocolMismatch,
            Some("tls_handshake_failed"),
        ),
        HostError::PeerTimeout => (
            InvitationEndpointDisposition::Unreachable,
            Some("timeout"),
        ),
        HostError::PeerTransportUnavailable => (
            InvitationEndpointDisposition::Unreachable,
            Some("unreachable"),
        ),
        HostError::PeerBusy | HostError::PeerNetworkDisabled => {
            (InvitationEndpointDisposition::Skipped, Some(error_code(error)))
        }
        HostError::Stopped | HostError::PeerCancelled => {
            (InvitationEndpointDisposition::Skipped, Some("cancelled"))
        }
        _ => (InvitationEndpointDisposition::Attempted, Some(error_code(error))),
    }
}

fn classify_service_error(
    error: &HostError,
) -> (InvitationEndpointDisposition, Option<&'static str>) {
    match error {
        HostError::PeerProtocolMismatch | HostError::PayloadTooLarge => (
            InvitationEndpointDisposition::ProtocolMismatch,
            Some(error_code(error)),
        ),
        HostError::PeerPinMismatch => (
            InvitationEndpointDisposition::IdentityMismatch,
            Some("pin_mismatch"),
        ),
        HostError::PeerTls => classify_probe_error(error),
        HostError::PeerTimeout | HostError::PeerTransportUnavailable => {
            (InvitationEndpointDisposition::Attempted, Some(error_code(error)))
        }
        HostError::Stopped | HostError::PeerCancelled | HostError::PeerBusy => {
            classify_probe_error(error)
        }
        _ => (InvitationEndpointDisposition::Attempted, Some(error_code(error))),
    }
}

fn push_endpoint_report(reports: &mut Vec<InvitationEndpointReport>, report: InvitationEndpointReport) {
    if reports.len() >= MAX_INVITATION_ENDPOINT_REPORTS
        || reports.iter().any(|existing| existing.endpoint == report.endpoint)
    {
        return;
    }
    reports.push(report);
}

fn serialize_endpoint_reports(reports: Vec<InvitationEndpointReport>) -> Vec<serde_json::Value> {
    reports
        .into_iter()
        .map(|report| serde_json::to_value(report).unwrap_or(serde_json::Value::Null))
        .collect()
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
        .bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, discovery_port())).into())
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
                nearby: HashMap::new(),
                observed_aliases: HashMap::new(),
                route_cursor: 0,
                auto_deferred: false,
                auto_error: None,
                #[cfg(test)]
                auto_yields: 0,
                #[cfg(test)]
                auto_tick_paused: false,
            })),
            scan: Arc::new(Mutex::new(ScanState::default())),
            originals: Arc::new(original_network::OriginalJobs::default()),
            restore_wake: Arc::new(tokio::sync::Notify::new()),
        }))
    }
    pub fn wake_original_restore_scan(&self) {
        self.restore_wake.notify_one();
    }
    #[cfg(test)]
    fn pause_auto_ticks_for_test(&self) -> Result<(), HostError> {
        self.shared
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .auto_tick_paused = true;
        Ok(())
    }
    fn worker(&self) -> Worker {
        Worker {
            host: self.host.clone(),
            owner: self.owner.clone(),
            shared: self.shared.clone(),
            originals: self.originals.clone(),
            restore_wake: self.restore_wake.clone(),
        }
    }
    pub async fn restore(self: &Arc<Self>) -> Result<(), HostError> {
        let _control = self.control.lock().await;
        if self.host.peer_network_settings(&self.owner)?.enabled {
            self.start().await?;
            self.wake_original_restore_scan();
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
            self.wake_original_restore_scan();
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
        if running
            .as_ref()
            .is_some_and(|r| !r.joined && !r.task.is_finished() && !r.cancel.is_cancelled())
        {
            return Ok(());
        }
        if let Some(old) = running.as_mut() {
            old.drain().await?;
        }
        *running = None;
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
            state.nearby.clear();
            state.observed_aliases.clear();
            state.auto_deferred = false;
            state.auto_error = None;
            #[cfg(test)]
            {
                state.auto_yields = 0;
            }
            state.generation
        };
        let cancel = PeerCancellation::new();
        let worker_cancel = cancel.clone();
        let network = self.worker();
        let incoming = super::original_transfer::TransferCompletion::new(|| {});
        let worker_incoming = incoming.clone();
        let lease = self.host.peers.register(false)?;
        let task = tokio::spawn(async move {
            let _lease = lease;
            network
                .run(listener, worker_cancel, generation, worker_incoming)
                .await;
        });
        *running = Some(Running {
            cancel,
            task,
            incoming,
            joined: false,
        });
        self.restore_wake.notify_one();
        Ok(())
    }
    pub async fn stop(&self) -> Result<(), HostError> {
        let _control = self.control.lock().await;
        self.stop_work().await
    }
    async fn stop_work(&self) -> Result<(), HostError> {
        let mut running = self.lifecycle.lock().await;
        {
            // Local generation invalidation serializes with the final
            // materialization gate, just like durable intent cancellation.
            let _gate = self.host.state()?;
            self.originals.cancel_all();
            {
                // An active scan is a finite probe pass, not durable sync work:
                // fence it out and publish one terminal cancelled snapshot so
                // scan_status always terminates instead of hanging in progress.
                let mut scan = self.scan.lock().map_err(|_| HostError::StatePoisoned)?;
                scan.generation = scan.generation.wrapping_add(1);
                let active_id = scan.active_id.take();
                if let Some(cancel) = scan.cancel.take() {
                    cancel.cancel();
                }
                if let Some(active_id) = active_id {
                    if let Some(mut result) = scan.result.clone() {
                        if result.scan_id == active_id {
                            result.cancelled = true;
                            result.stage = "cancelled";
                            result.finished_at_ms = now();
                            scan.result = Some(result);
                        }
                    }
                }
            }
            let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
            state.generation = state.generation.saturating_add(1);
            state.addresses.clear();
            state.candidates.clear();
            state.nearby.clear();
            state.observed_aliases.clear();
            for value in state.progress.values_mut() {
                value.busy = false;
                value.busy_id = None;
                value.connection = "idle";
            }
            if let Some(run) = running.as_ref() {
                run.cancel.cancel();
            }
        }
        // Retain the old scope in lifecycle while awaiting it: cancellation of
        // this caller or a timeout must not forget live blocking source work.
        if let Some(run) = running.as_mut() {
            run.drain().await?;
        }
        *running = None;
        self.originals.wait_empty().await
    }
    pub fn status(&self, profile: ProfileId) -> Result<PeerNetworkStatus, HostError> {
        let settings = self.host.peer_network_settings(&self.owner)?;
        let members = self.host.peer_members(&self.owner, profile)?;
        let routes = self.host.peer_routes(&self.owner)?;
        let own = self.host.local_history_fingerprint(&self.owner, profile)?;
        let local_generation = members
            .iter()
            .find(|m| {
                m.device_id == self.host.device_id && !m.revoked && m.state == PeerJoinState::Ready
            })
            .map(|m| m.generation);
        let alias_claims = self.host.peer_alias_claims(&self.owner)?;
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let at = Instant::now();
        state
            .observed_aliases
            .retain(|_, alias| alias.expires > at);
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
                                || m.sent_history_fingerprint
                                    .as_ref()
                                    .is_some_and(|s| s == &own))
                            && (!m.can_receive
                                || (m.peer_runtime_id == p.observed_runtime
                                    && m.received_history_fingerprint.as_ref().is_some_and(|s| {
                                        Some(s) == p.observed_history_fingerprint.as_ref()
                                    })))
                    })
            });
            let revoked = member.revoked;
            let key = (member.device_id, member.pin.clone());
            let observed = state.observed_aliases.get(&key);
            let (effective_alias, alias_source, alias_verification, alias_confirmed_at_ms) =
                alias_projection(member.device_id, observed, alias_claims.get(&key));
            peers.push(PeerConnectionView {
                device_id: member.device_id,
                fingerprint_sha256: member.pin,
                effective_alias,
                alias_source,
                alias_verification,
                alias_confirmed_at_ms,
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
                history_gaps: if revoked {
                    vec![]
                } else {
                    progress
                        .filter(|p| p.member_generation == member.generation)
                        .and_then(|p| p.memo.as_ref())
                        .map(|memo| {
                            memo.received_sources
                                .iter()
                                .map(|source| ("from_peer", source))
                                .chain(memo.sent_sources.iter().map(|source| ("to_peer", source)))
                                .filter(|(_, source)| {
                                    source.available_head.as_ref().is_none_or(|available| {
                                        available.seq < source.materialized_head.seq
                                    })
                                })
                                .map(|(direction, source)| PeerHistoryGap {
                                    direction,
                                    origin_device_id: source.origin.device_id,
                                    materialized_seq: source.materialized_head.seq,
                                    available_seq: source
                                        .available_head
                                        .as_ref()
                                        .map(|head| head.seq),
                                })
                                .collect()
                        })
                        .unwrap_or_default()
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
    /// Returns only bounded, unverified discovery hints; no profile is inspected.
    pub fn nearby_candidates(&self) -> Result<Vec<NearbyPeerCandidate>, HostError> {
        self.host.qualify_transport(&self.owner)?;
        let alias_claims = self.host.peer_alias_claims(&self.owner)?;
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let at = Instant::now();
        state.nearby.retain(|_, candidate| candidate.expires > at);
        state
            .observed_aliases
            .retain(|_, alias| alias.expires > at);

        let wall_now = now();
        let mut output = state
            .nearby
            .iter()
            .map(|(key, candidate)| {
                let remaining_ms = candidate
                    .expires
                    .saturating_duration_since(at)
                    .as_millis()
                    .min(i64::MAX as u128) as i64;
                let mut addresses = candidate
                    .addresses
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>();
                addresses.sort();
                let observed = state
                    .observed_aliases
                    .get(&(key.device_id, key.pin.clone()));
                let (
                    effective_alias,
                    alias_source,
                    alias_verification,
                    alias_confirmed_at_ms,
                ) = alias_projection(
                    key.device_id,
                    observed,
                    alias_claims.get(&(key.device_id, key.pin.clone())),
                );
                NearbyPeerCandidate {
                    device_id: key.device_id,
                    fingerprint_sha256: key.pin.clone(),
                    effective_alias,
                    alias_source,
                    alias_verification,
                    alias_confirmed_at_ms,
                    addresses,
                    expires_at_ms: wall_now.saturating_add(remaining_ms),
                    verification_state: "unverified",
                }
            })
            .collect::<Vec<_>>();
        output.sort_by_key(|candidate| {
            (
                candidate.device_id.to_string(),
                candidate.fingerprint_sha256.clone(),
            )
        });
        Ok(output)
    }

    pub fn local_addresses(&self) -> Result<Vec<SocketAddr>, HostError> {
        Ok(self
            .shared
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .addresses
            .clone())
    }
    /// Shareable invitation candidates only: no loopback, link-local,
    /// unspecified, multicast, zero-port or duplicate addresses.
    pub fn shareable_addresses(&self) -> Result<Vec<SocketAddr>, HostError> {
        // Re-read the interfaces and filter before truncating: local_addresses
        // also carries loopback and may already have spent its budget on
        // link-local diagnostics that can never be shared.
        let Some(listener) = self.local_addresses()?.first().copied() else {
            return Ok(Vec::new());
        };
        Ok(shareable_endpoints(listener, interface_ips(listener)))
    }

    /// Discovers candidate scan scopes from real local interfaces. IPv6 stays
    /// visible as an explanatory, non-scanned row instead of becoming an
    /// unbounded enumeration.
    pub fn scan_scopes(&self) -> Result<Vec<ScanScope>, HostError> {
        self.host.qualify_transport(&self.owner)?;
        Ok(discover_scan_scopes())
    }

    /// The durable network switch state, readable without a profile so the
    /// no-profile flow can truthfully gate scanning instead of silently
    /// enabling the global peer network.
    pub fn network_enabled(&self) -> Result<bool, HostError> {
        self.host.qualify_transport(&self.owner)?;
        Ok(self.host.peer_network_settings(&self.owner)?.enabled)
    }

    /// Starts one bounded scan. Scanning never enables the peer network; the
    /// caller must have already enabled it explicitly.
    pub async fn scan_start(
        self: &Arc<Self>,
        scope_ids: Vec<String>,
        manual_cidrs: Vec<String>,
    ) -> Result<NetworkScanResult, HostError> {
        self.host.qualify_transport(&self.owner)?;
        if !self.host.peer_network_settings(&self.owner)?.enabled {
            return Err(HostError::PeerNetworkDisabled);
        }
        let discovered = discover_scan_scopes();
        let requests = build_scan_requests(scope_ids, manual_cidrs, &discovered)?;

        let scan_id = Uuid::new_v4();
        let started_at_ms = now();
        let initial = NetworkScanResult {
            scan_id,
            started_at_ms,
            finished_at_ms: 0,
            stage: "tcp_probe",
            scopes: requests.iter().map(scan_scope_from_request).collect(),
            attempted: 0,
            discovered: 0,
            skipped: 0,
            cancelled: false,
            discovered_addresses: Vec::new(),
        };
        let progress = Arc::new(Mutex::new(initial.clone()));
        let mut state = self.scan.lock().map_err(|_| HostError::StatePoisoned)?;
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        if let Some(previous) = state.cancel.take() {
            previous.cancel();
        }
        let cancel = PeerCancellation::new();
        state.cancel = Some(cancel.clone());
        state.active_id = Some(scan_id);
        state.result = Some(initial.clone());
        let host = self.host.clone();
        let self_ips = local_scan_self_ips();
        let progress_for_task = progress.clone();
        let scan_state = self.scan.clone();
        let task_cancel = cancel.clone();
        tokio::spawn(async move {
            let _lease = host.peers.register(false);
            let final_result = run_scan_probe(
                scan_id,
                started_at_ms,
                SCAN_SERVICE_PORT,
                &requests,
                &self_ips,
                &task_cancel,
                &progress_for_task,
            )
            .await;
            let mut state = match scan_state.lock() {
                Ok(state) => state,
                Err(_) => return,
            };
            if state.generation == generation && state.active_id == Some(scan_id) {
                state.result = Some(final_result);
                state.active_id = None;
                state.cancel = None;
            }
        });
        Ok(initial)
    }

    /// Returns the latest snapshot for a scan. `finished_at_ms == 0` means the
    /// scan is still running.
    pub fn scan_status(&self, scan_id: Uuid) -> Result<NetworkScanResult, HostError> {
        self.host.qualify_transport(&self.owner)?;
        self.scan
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .snapshot(scan_id)
            .ok_or(HostError::NotFound)
    }

    /// Cancels an active scan. The final `cancelled` result is published by the
    /// probe task as soon as it notices the cancellation.
    pub fn scan_cancel(&self, scan_id: Uuid) -> Result<NetworkScanResult, HostError> {
        self.host.qualify_transport(&self.owner)?;
        let mut state = self.scan.lock().map_err(|_| HostError::StatePoisoned)?;
        if state.active_id != Some(scan_id) {
            return state.snapshot(scan_id).ok_or(HostError::NotFound);
        }
        if let Some(cancel) = &state.cancel {
            cancel.cancel();
        }
        if let Some(mut result) = state.result.clone() {
            if result.scan_id == scan_id && result.finished_at_ms == 0 {
                result.stage = "cancelling";
                state.result = Some(result);
            }
        }
        state.snapshot(scan_id).ok_or(HostError::NotFound)
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
                candidates: self.shareable_addresses()?,
                ttl_seconds: 600,
            },
        )
    }
    pub async fn join(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
    ) -> Result<super::PeerJoinStatus, HostError> {
        self.join_with_route(invitation, claim, None).await
    }

    /// A route hint changes where we dial, never the signed issuer or its pin.
    /// User-space overlays need not expose their addresses through OS interfaces.
    pub async fn join_with_route(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
        dial_address: Option<SocketAddr>,
    ) -> Result<super::PeerJoinStatus, HostError> {
        self.join_inner(invitation, claim, dial_address, false)
            .await
            .map_err(|(error, _)| error)
    }

    /// Same production dial semantics, but the returned failure carries the
    /// bounded per-endpoint outcome reports for the Native join command.
    pub async fn join_with_route_diagnosed(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
        dial_address: Option<SocketAddr>,
    ) -> Result<super::PeerJoinStatus, (HostError, Vec<serde_json::Value>)> {
        match self.join_inner(invitation, claim, dial_address, false).await {
            Ok(status) => Ok(status),
            Err((error, reports)) => Err((error, serialize_endpoint_reports(reports))),
        }
    }

    #[cfg(test)]
    pub async fn join_for_test(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
    ) -> Result<super::PeerJoinStatus, HostError> {
        self.join_inner(invitation, claim, None, true)
            .await
            .map_err(|(error, _)| error)
    }

    #[cfg(test)]
    pub async fn join_with_route_for_test(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
        dial_address: Option<SocketAddr>,
    ) -> Result<super::PeerJoinStatus, HostError> {
        self.join_inner(invitation, claim, dial_address, true)
            .await
            .map_err(|(error, _)| error)
    }

    async fn join_inner(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
        claim: Uuid,
        dial_address: Option<SocketAddr>,
        allow_loopback: bool,
    ) -> Result<super::PeerJoinStatus, (HostError, Vec<InvitationEndpointReport>)> {
        let offer = invitation
            .verified_offer()
            .map_err(|error| (error, Vec::new()))?;
        if offer.schema != super::PEER_CORE_SCHEMA || offer.protocol != super::PEER_PROTOCOL {
            return Err((HostError::PeerProtocolMismatch, Vec::new()));
        }
        if let Some(address) = dial_address {
            super::network_store::validate_endpoints(&[address])
                .map_err(|error| (error, Vec::new()))?;
        }
        let mut candidates = Vec::with_capacity(offer.candidates.len() + 1);
        let mut reports: Vec<InvitationEndpointReport> =
            Vec::with_capacity(offer.candidates.len() + 1);
        {
            let mut push = |address: SocketAddr| {
                let loopback_allowed = allow_loopback && address.ip().is_loopback();
                let skipped = if address.ip().is_loopback() && !allow_loopback {
                    Some(non_shareable_code(address))
                } else if !is_shareable_endpoint(address) && !loopback_allowed {
                    Some(non_shareable_code(address))
                } else {
                    None
                };
                if let Some(error_code) = skipped {
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: address.to_string(),
                            disposition: InvitationEndpointDisposition::Skipped,
                            elapsed_ms: 0,
                            error_code: Some(error_code),
                        },
                    );
                } else if !candidates.contains(&address) {
                    candidates.push(address);
                }
            };
            if let Some(address) = dial_address {
                push(address);
            }
            for address in &offer.candidates {
                push(*address);
            }
        }
        self.set_enabled(true)
            .await
            .map_err(|error| (error, reports.clone()))?;
        let local_addresses = self
            .local_addresses()
            .map_err(|error| (error, reports.clone()))?;
        let port = local_addresses
            .first()
            .ok_or(HostError::PeerTransportUnavailable)
            .map_err(|error| (error, reports.clone()))?
            .port();
        let service_candidates = super::transport::local_service_candidates(&local_addresses);
        let pin = PeerPin::from_sha256(&offer.issuer.fingerprint_sha256)
            .map_err(|error| (error, reports.clone()))?;
        let (cancel, generation) = {
            let running = self.lifecycle.lock().await;
            let cancel = running
                .as_ref()
                .ok_or(HostError::PeerTransportUnavailable)
                .map_err(|error| (error, reports.clone()))?
                .cancel
                .clone();
            let generation = self
                .shared
                .lock()
                .map_err(|_| HostError::StatePoisoned)
                .map_err(|error| (error, reports.clone()))?
                .generation;
            (cancel, generation)
        };
        let mut last = HostError::PeerTransportUnavailable;
        for endpoint in &candidates {
            let started = Instant::now();
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
                    let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
                    let (disposition, code) = classify_probe_error(&error);
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: endpoint.to_string(),
                            disposition,
                            elapsed_ms,
                            error_code: code,
                        },
                    );
                    // A later unreachable candidate must not erase earlier TLS evidence.
                    if join_route_error_priority(&error) >= join_route_error_priority(&last) {
                        last = error;
                    }
                    continue;
                }
            };
            match self
                .host
                .select_peer_service_with_candidates(
                    &self.owner,
                    &channel,
                    PeerServiceKind::Join,
                    None,
                    None,
                    port,
                    &service_candidates,
                )
                .await
            {
                Ok(()) => {}
                Err(error) => {
                    let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
                    let (disposition, code) = classify_service_error(&error);
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: endpoint.to_string(),
                            disposition,
                            elapsed_ms,
                            error_code: code,
                        },
                    );
                    if join_route_error_priority(&error) >= join_route_error_priority(&last) {
                        last = error;
                    }
                    continue;
                }
            }
            let joined = tokio::time::timeout(
                JOIN_ROUTE_TIMEOUT,
                self.host.join_peer_profile_over_transport_with_candidates(
                    &self.owner,
                    invitation,
                    claim,
                    channel,
                ),
            )
            .await;
            let joined = match joined {
                Ok(result) => result,
                Err(_) => Err(HostError::PeerTimeout),
            };
            match joined {
                Ok((status, negotiation)) => {
                    if self
                        .shared
                        .lock()
                        .map_err(|_| HostError::StatePoisoned)
                        .map_err(|error| (error, reports.clone()))?
                        .generation
                        != generation
                    {
                        return Err((HostError::PeerCancelled, reports));
                    }
                    if status.profile_id != offer.profile_id
                        || status.issuer_device_id != offer.issuer.device_id
                    {
                        return Err((HostError::PeerMembershipDenied, reports));
                    }
                    let member = self
                        .host
                        .peer_members(&self.owner, status.profile_id)
                        .map_err(|error| (error, reports.clone()))?
                        .into_iter()
                        .find(|member| {
                            member.device_id == offer.issuer.device_id
                                && !member.revoked
                                && member.state == PeerJoinState::Ready
                                && member.pin == offer.issuer.fingerprint_sha256
                        })
                        .ok_or(HostError::PeerMembershipDenied)
                        .map_err(|error| (error, reports.clone()))?;
                    let route_candidate_allowed = |candidate: SocketAddr| {
                        is_shareable_endpoint(candidate)
                            && !local_addresses
                                .iter()
                                .any(|local| local.ip() == candidate.ip())
                    };
                    let mut route_candidates = match negotiation {
                        Some(negotiation) => {
                            if negotiation.peer_device_id != offer.issuer.device_id {
                                return Err((HostError::PeerMembershipDenied, reports));
                            }
                            negotiation.candidates
                        }
                        None => vec![],
                    };
                    route_candidates.retain(|candidate| route_candidate_allowed(*candidate));
                    for candidate in &offer.candidates {
                        if route_candidates.len() >= super::network_store::MAX_ROUTE_ENDPOINTS {
                            break;
                        }
                        if route_candidate_allowed(*candidate) && !route_candidates.contains(candidate) {
                            route_candidates.push(*candidate);
                        }
                    }
                    let saved = self
                        .host
                        .save_authenticated_peer_routes(
                            &self.owner,
                            status.profile_id,
                            offer.issuer.device_id,
                            pin,
                            member.generation,
                            &route_candidates,
                            Some(*endpoint),
                            Some(&cancel),
                        )
                        .map_err(|error| (error, reports.clone()))?;
                    if !saved && cancel.is_cancelled() {
                        return Err((HostError::PeerCancelled, reports));
                    }
                    let mut shared = self
                        .shared
                        .lock()
                        .map_err(|_| HostError::StatePoisoned)
                        .map_err(|error| (error, reports.clone()))?;
                    if shared.generation != generation {
                        return Err((HostError::PeerCancelled, reports));
                    }
                    shared
                        .nearby
                        .retain(|key, _| key.device_id != offer.issuer.device_id);
                    shared
                        .forced
                        .insert((status.profile_id, offer.issuer.device_id));
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: endpoint.to_string(),
                            disposition: InvitationEndpointDisposition::Reachable,
                            elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                            error_code: None,
                        },
                    );
                    return Ok(status);
                }
                Err(error) => {
                    let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
                    let (disposition, code) = classify_service_error(&error);
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: endpoint.to_string(),
                            disposition,
                            elapsed_ms,
                            error_code: code,
                        },
                    );
                    let keep_trying = matches!(
                        &error,
                        HostError::PeerTransportUnavailable
                            | HostError::PeerTimeout
                            | HostError::PeerTls
                            | HostError::PeerPinMismatch
                            | HostError::PeerProtocolMismatch
                    );
                    if keep_trying {
                        if join_route_error_priority(&error) >= join_route_error_priority(&last) {
                            last = error;
                        }
                        continue;
                    }
                    return Err((error, reports));
                }
            }
        }
        Err((last, reports))
    }
    /// Bounded, read-only connectivity report for the invitation's candidates.
    /// This dials only after the user calls inspect; it never starts a listener
    /// or writes membership, routes, grants or profile facts.
    pub async fn inspect_invitation_endpoint_reports(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
    ) -> Result<Vec<serde_json::Value>, HostError> {
        let offer = invitation.verified_offer()?;
        let pin = PeerPin::from_sha256(&offer.issuer.fingerprint_sha256)?;
        let reports = self
            .probe_invitation_endpoints(&offer.candidates, pin, false)
            .await?;
        Ok(serialize_endpoint_reports(reports))
    }

    #[cfg(test)]
    async fn inspect_invitation_endpoint_reports_for_test(
        self: &Arc<Self>,
        invitation: &PeerInvitation,
    ) -> Result<Vec<serde_json::Value>, HostError> {
        let offer = invitation.verified_offer()?;
        let pin = PeerPin::from_sha256(&offer.issuer.fingerprint_sha256)?;
        let reports = self
            .probe_invitation_endpoints(&offer.candidates, pin, true)
            .await?;
        Ok(serialize_endpoint_reports(reports))
    }

    async fn probe_invitation_endpoints(
        self: &Arc<Self>,
        candidates: &[SocketAddr],
        pin: PeerPin,
        allow_loopback: bool,
    ) -> Result<Vec<InvitationEndpointReport>, HostError> {
        let budget = Duration::from_secs(5);
        let budget_start = Instant::now();
        let mut reports = Vec::with_capacity(candidates.len().min(MAX_INVITATION_ENDPOINT_REPORTS));
        for endpoint in candidates.iter().take(MAX_INVITATION_ENDPOINT_REPORTS) {
            if !is_shareable_endpoint(*endpoint)
                && !(allow_loopback && endpoint.ip().is_loopback())
            {
                push_endpoint_report(
                    &mut reports,
                    InvitationEndpointReport {
                        endpoint: endpoint.to_string(),
                        disposition: InvitationEndpointDisposition::Skipped,
                        elapsed_ms: 0,
                        error_code: Some(non_shareable_code(*endpoint)),
                    },
                );
                continue;
            }
            let remaining = budget.saturating_sub(budget_start.elapsed());
            if remaining < Duration::from_millis(50) {
                push_endpoint_report(
                    &mut reports,
                    InvitationEndpointReport {
                        endpoint: endpoint.to_string(),
                        disposition: InvitationEndpointDisposition::Skipped,
                        elapsed_ms: 0,
                        error_code: Some("probe_budget_exhausted"),
                    },
                );
                continue;
            }
            let options = PeerTransportOptions {
                handshake_timeout: remaining.min(Duration::from_secs(2)),
                channel_lifetime: Duration::from_secs(30),
            };
            let started = Instant::now();
            let result = self
                .host
                .connect_peer_transport(
                    &self.owner,
                    *endpoint,
                    pin,
                    options,
                    PeerCancellation::new(),
                )
                .await;
            let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
            match result {
                Ok(channel) => {
                    let _ = channel.close().await;
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: endpoint.to_string(),
                            disposition: InvitationEndpointDisposition::Reachable,
                            elapsed_ms,
                            error_code: None,
                        },
                    );
                }
                Err(error) => {
                    let (disposition, code) = classify_probe_error(&error);
                    push_endpoint_report(
                        &mut reports,
                        InvitationEndpointReport {
                            endpoint: endpoint.to_string(),
                            disposition,
                            elapsed_ms,
                            error_code: code,
                        },
                    );
                }
            }
        }
        Ok(reports)
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
    fn memberships(&self) -> Result<Vec<super::PeerMember>, HostError> {
        let state = self.host.active_state()?;
        self.host.owner(&self.owner)?;
        let resources = crate::resources(&state)?;
        super::membership_store::all_members(&resources.persistence.auth)
    }
    fn local_membership_profiles_after(
        &self,
        after: Option<ProfileId>,
    ) -> Result<Vec<super::PeerMember>, HostError> {
        let state = self.host.active_state()?;
        self.host.owner(&self.owner)?;
        let resources = crate::resources(&state)?;
        super::membership_store::member_profiles_page(
            &resources.persistence.auth,
            self.host.device_id,
            after,
        )
    }
    #[cfg(test)]
    fn auto_ticks_paused_for_test(&self) -> bool {
        self.shared
            .lock()
            .map(|state| state.auto_tick_paused)
            .unwrap_or(false)
    }
    fn routes(&self) -> Result<Vec<Route>, HostError> {
        let saved = self.host.peer_routes(&self.owner)?;
        let ready = self
            .memberships()?
            .into_iter()
            .filter(|member| {
                member.device_id != self.host.device_id
                    && !member.revoked
                    && member.state == PeerJoinState::Ready
            })
            .collect::<Vec<_>>();
        let ready_by_pair = ready
            .iter()
            .map(|member| ((member.profile_id, member.device_id), member))
            .collect::<HashMap<_, _>>();
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let at = Instant::now();
        state.candidates.retain(|_, values| {
            values.retain(|c| c.expires > at);
            !values.is_empty()
        });
        let mut output = Vec::with_capacity(saved.len());
        let mut routed = HashSet::new();
        for route in &saved {
            let key = (route.profile, route.device);
            let Some(member) = ready_by_pair.get(&key) else {
                continue;
            };
            routed.insert(key);
            let mut endpoints = vec![];
            if let Some(values) = state.candidates.get(&route.device) {
                endpoints.extend(
                    values
                        .iter()
                        .filter(|candidate| candidate.pin == member.pin)
                        .map(|candidate| candidate.endpoint),
                );
            }
            for address in &route.endpoints {
                if !endpoints.contains(address) {
                    endpoints.push(*address);
                }
            }
            endpoints.retain(|a| !state.addresses.contains(a));
            endpoints.truncate(8);
            if !endpoints.is_empty() {
                output.push(Route {
                    profile: route.profile,
                    device: route.device,
                    endpoints,
                });
            }
        }
        for member in &ready {
            let key = (member.profile_id, member.device_id);
            if routed.contains(&key) {
                continue;
            }
            let Some(values) = state.candidates.get(&member.device_id) else {
                continue;
            };
            let mut endpoints = values
                .iter()
                .filter(|candidate| candidate.pin == member.pin)
                .map(|candidate| candidate.endpoint)
                .collect::<Vec<_>>();
            endpoints.retain(|address| !state.addresses.contains(address));
            endpoints.truncate(8);
            if !endpoints.is_empty() {
                output.push(Route {
                    profile: member.profile_id,
                    device: member.device_id,
                    endpoints,
                });
            }
        }
        output.sort_by_key(|route| (route.profile.to_string(), route.device.to_string()));
        Ok(output)
    }
    fn remember_announcement(
        &self,
        value: Announcement,
        source: SocketAddr,
        generation: u64,
    ) -> Result<(), HostError> {
        if value.listen_port == 0
            || value.device_id == self.host.device_id
            || source.ip().is_unspecified()
            || source.ip().is_multicast()
            || PeerPin::from_sha256(&value.fingerprint_sha256).is_err()
        {
            return Ok(());
        }
        let matching = self
            .memberships()?
            .into_iter()
            .filter(|member| {
                member.device_id == value.device_id
                    && !member.revoked
                    && member.state == PeerJoinState::Ready
                    && member.pin == value.fingerprint_sha256
            })
            .map(|member| (member.profile_id, member.device_id))
            .collect::<Vec<_>>();
        let address = SocketAddr::new(source.ip(), value.listen_port);
        let key = NearbyKey {
            device_id: value.device_id,
            pin: value.fingerprint_sha256.clone(),
        };
        let alias_claim = if value.alias.is_some() {
            self.host.peer_alias_claim(
                &self.owner,
                value.device_id,
                &value.fingerprint_sha256,
            )?
        } else {
            None
        };
        let stale_alias = {
            let state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
            if state.generation != generation {
                return Ok(());
            } else {
                value.alias.as_ref().is_some_and(|alias| {
                    let previous = state
                        .observed_aliases
                        .get(&(value.device_id, value.fingerprint_sha256.clone()));
                    let previous_stale = previous.is_some_and(|previous| {
                        previous.revision > alias.revision
                            || (previous.revision == alias.revision
                                && (previous.alias != alias.effective_alias
                                    || previous.source != alias.source))
                    });
                    let claim_stale = alias_claim.as_ref().is_some_and(|claim| {
                        claim.revision > alias.revision
                            || (claim.revision == alias.revision
                                && (claim.effective_alias != alias.effective_alias
                                    || claim.source != alias.source))
                    });
                    previous_stale || claim_stale
                })
            }
        };
        if stale_alias {
            return Ok(());
        }
        if !matching.is_empty()
            && let Some(alias) = value.alias.as_ref()
            && !self.host.record_observed_peer_alias(
                &self.owner,
                value.device_id,
                &value.fingerprint_sha256,
                &alias.effective_alias,
                alias.source,
                alias.revision,
                now(),
            )?
        {
            return Ok(());
        }
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        if state.generation != generation || state.addresses.contains(&address) {
            return Ok(());
        }
        let at = Instant::now();
        state.nearby.retain(|_, candidate| candidate.expires > at);
        state
            .observed_aliases
            .retain(|_, alias| alias.expires > at);
        if let Some(alias) = value.alias {
            if !state.observed_aliases.contains_key(&(
                value.device_id,
                value.fingerprint_sha256.clone(),
            )) && state.observed_aliases.len() >= MAX_CANDIDATE_DEVICES
            {
                return Ok(());
            }
            state.observed_aliases.insert(
                (value.device_id, value.fingerprint_sha256.clone()),
                ObservedAlias {
                    alias: alias.effective_alias,
                    source: alias.source,
                    revision: alias.revision,
                    expires: at + CANDIDATE_TTL,
                },
            );
        }
        if matching.is_empty() {
            // Presence never becomes a route, forced sync, membership, or grant.
            if let Some(candidate) = state.nearby.get_mut(&key) {
                if !candidate.addresses.contains(&address) {
                    if candidate.addresses.len() >= MAX_DEVICE_CANDIDATES {
                        return Ok(());
                    }
                    candidate.addresses.push(address);
                    candidate.addresses.sort();
                }
                candidate.expires = at + CANDIDATE_TTL;
                return Ok(());
            }
            if state.nearby.len() >= MAX_CANDIDATE_DEVICES {
                return Ok(());
            }
            state.nearby.insert(
                key,
                NearbyCandidate {
                    addresses: vec![address],
                    expires: at + CANDIDATE_TTL,
                },
            );
            return Ok(());
        }
        state.nearby.remove(&key);
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
                    if alias_confirmation_eligible(&result) {
                        self.confirm_aliases(device_id, generation);
                    }
                    self.publish(key, generation, member_generation, None, &Ok(Some(result)));
                }
            }
            PeerServiceOutcome::OriginalTransferred {
                profile_id,
                device_id,
                ..
            } => {
                self.touch((profile_id, device_id), generation);
            }
            PeerServiceOutcome::Probed {
                profile_id,
                device_id,
            } => {
                self.touch((profile_id, device_id), generation);
            }
            PeerServiceOutcome::Joined(status) => {
                let peer = if status.issuer_device_id == self.host.device_id {
                    status.joiner_device_id
                } else {
                    status.issuer_device_id
                };
                self.touch((status.profile_id, peer), generation);
                if let Ok(mut state) = self.shared.lock() {
                    if state.generation == generation {
                        state.nearby.retain(|key, _| key.device_id != peer);
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
                    p.observed_history_fingerprint = value.received_history_fingerprint.clone();
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
    fn confirm_aliases(&self, device: DeviceId, generation: u64) {
        let Ok(members) = self.memberships() else {
            return;
        };
        let pins = members
            .into_iter()
            .filter(|member| {
                member.device_id == device
                    && !member.revoked
                    && member.state == PeerJoinState::Ready
            })
            .map(|member| member.pin)
            .collect::<Vec<_>>();
        let observations = {
            let Ok(shared) = self.shared.lock() else {
                return;
            };
            if shared.generation != generation {
                return;
            }
            pins.into_iter()
                .filter_map(|pin| {
                    shared
                        .observed_aliases
                        .get(&(device, pin.clone()))
                        .map(|alias| {
                            (
                                pin,
                                alias.alias.clone(),
                                alias.source,
                                alias.revision,
                            )
                        })
                })
                .collect::<Vec<_>>()
        };
        let confirmed_at_ms = now();
        for (pin, effective_alias, source, revision) in observations {
            let _ = self.host.record_confirmed_peer_alias(
                &self.owner,
                device,
                &pin,
                &effective_alias,
                source,
                revision,
                confirmed_at_ms,
            );
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
                p.observed_history_fingerprint = probe.history_fingerprint.clone();
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
        pin: PeerPin,
        member_generation: u64,
        cancel: &PeerCancellation,
    ) -> Result<(), HostError> {
        let _ = self.host.save_authenticated_peer_routes(
            &self.owner,
            profile,
            device,
            pin,
            member_generation,
            &[],
            Some(endpoint),
            Some(cancel),
        )?;
        Ok(())
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
        let own = self
            .host
            .local_history_fingerprint(&self.owner, route.profile)?;
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
            .transfer_attempt(
                &route,
                &member.pin,
                member.generation,
                cancel,
                generation,
                own,
                memo,
                force,
            )
            .await;
        let result = match result {
            Ok(Some(value)) => self
                .valid_result(key, member.generation, &value)
                .map(|_| Some(value)),
            other => other,
        };
        if matches!(&result, Ok(Some(value)) if alias_confirmation_eligible(value)) {
            self.confirm_aliases(route.device, generation);
        }
        self.publish(key, generation, member.generation, Some(id), &result);
        result
    }
    async fn transfer_attempt(
        &self,
        route: &Route,
        pin: &str,
        member_generation: u64,
        cancel: PeerCancellation,
        generation: u64,
        own: String,
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
                            || saved
                                .sent_history_fingerprint
                                .as_ref()
                                .is_some_and(|s| s == &own))
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
                                    self.promote(
                                        route.profile,
                                        route.device,
                                        *endpoint,
                                        pin,
                                        member_generation,
                                        &cancel,
                                    )?;
                                    if saved.peer_runtime_id == Some(probe.runtime_id)
                                        && (!saved.can_receive
                                            || saved
                                                .received_history_fingerprint
                                                .as_ref()
                                                .is_some_and(|s| {
                                                    Some(s) == probe.history_fingerprint.as_ref()
                                                }))
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
            self.promote(
                route.profile,
                route.device,
                *endpoint,
                pin,
                member_generation,
                &cancel,
            )?;
            return Ok(Some(value));
        }
        Err(last)
    }
    async fn run(
        self,
        mut listener: super::PeerTransportListener,
        cancel: PeerCancellation,
        generation: u64,
        incoming: Arc<super::original_transfer::TransferCompletion>,
    ) {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let udp = discovery_socket().ok();
        let mut packet = [0u8; 1025];
        let mut jobs = JoinSet::new();
        let mut incoming_jobs = JoinSet::new();
        let mut auto_jobs = JoinSet::<AutoCompletion>::new();
        let mut auto = AutoQueue::new();
        loop {
            if cancel.is_cancelled() || self.host.peers.cancel.is_cancelled() {
                break;
            }
            // Fair selection keeps a stream of new handshakes from starving
            // discovery/local-head checks; the explicit check fences cancel.
            tokio::select! {
                _=cancel.cancelled()=>break,
                _=self.host.peers.cancel.cancelled()=>break,
                _=self.restore_wake.notified()=>{
                    #[cfg(test)]
                    if !self.auto_ticks_paused_for_test() {
                        if let Err(error)=auto.tick(&self,&cancel,generation,&mut auto_jobs,true){if let Ok(mut state)=self.shared.lock(){state.auto_deferred=true;state.auto_error=Some(error_code(&error));}}
                    }
                    #[cfg(not(test))]
                    if let Err(error)=auto.tick(&self,&cancel,generation,&mut auto_jobs,true){if let Ok(mut state)=self.shared.lock(){state.auto_deferred=true;state.auto_error=Some(error_code(&error));}}
                },
                result=listener.accept(cancel.clone())=>{match result {Ok(channel)=>{if incoming.track_channel(&channel).is_err(){drop(channel);break;}if incoming_jobs.len()>=8{drop(channel);continue;}let network=self.clone();let completion=incoming.clone();let route_cancel=cancel.clone();let lease=match self.host.peers.register(false){Ok(l)=>l,Err(_)=>break};incoming_jobs.spawn(async move{let _lease=lease;if let Ok(outcome)=network.host.accept_peer_service_owned_scoped(&network.owner,channel,Some(completion),Some(route_cancel)).await{network.incoming(generation,outcome);}});},Err(HostError::PeerTimeout|HostError::PeerTls)=>{},Err(_)=>break}},
                received=async{match &udp {Some(socket)=>socket.recv_from(&mut packet).await,None=>std::future::pending().await}}=>{
                    if let Ok((n,source))=received{if n<=1024{if let Some(value)=parse_announcement(&packet[..n]){let _=self.remember_announcement(value,source,generation);}}}
                },
                _=interval.tick()=>{
                    if let Ok(mut state)=self.shared.lock(){if state.generation!=generation{break;}state.addresses=endpoints(listener.addr());}
                    if let Some(socket)=&udp {if let Ok(identity)=self.host.transport_identity(&self.owner){let alias=self.host.environment_alias_announcement(&self.owner).ok().map(|(effective_alias,source,revision)|AnnouncementAlias{effective_alias,source,revision});let (legacy,enriched)=discovery_frames(&identity,listener.addr().port(),alias);for bytes in [legacy,enriched].into_iter().flatten(){let _=socket.try_send_to(&bytes,SocketAddr::from((DISCOVERY_GROUP,discovery_port())));let _=socket.try_send_to(&bytes,SocketAddr::from((Ipv4Addr::BROADCAST,discovery_port())));}}}
                    if jobs.len()>=2{continue;}if let Ok(mut routes)=self.routes(){if !routes.is_empty(){let mut state=match self.shared.lock(){Ok(s)=>s,Err(_)=>return};let count=routes.len();routes.rotate_left(state.route_cursor%count);state.route_cursor=state.route_cursor.wrapping_add(1);routes.sort_by_key(|r|!state.forced.contains(&(r.profile,r.device)));}for route in routes {if jobs.len()>=2{break;}let key=(route.profile,route.device);let force;{let mut state=match self.shared.lock(){Ok(s)=>s,Err(_)=>return};force=state.forced.remove(&key);if state.progress.get(&key).is_some_and(|p|p.busy||(!force&&p.retry.is_some_and(|at|at>Instant::now()))){continue;}}
                        let network=self.clone();let cancel=cancel.clone();jobs.spawn(async move{let _=network.attempt(route,cancel,generation,force).await;});
                    }}
                    #[cfg(test)]
                    if !self.auto_ticks_paused_for_test() {
                        if let Err(error)=auto.tick(&self,&cancel,generation,&mut auto_jobs,false){if let Ok(mut state)=self.shared.lock(){state.auto_deferred=true;state.auto_error=Some(error_code(&error));}}
                    }
                    #[cfg(not(test))]
                    if let Err(error)=auto.tick(&self,&cancel,generation,&mut auto_jobs,false){if let Ok(mut state)=self.shared.lock(){state.auto_deferred=true;state.auto_error=Some(error_code(&error));}}
                },
                result=auto_jobs.join_next(),if !auto_jobs.is_empty()=>{if let Some(result)=result{auto.completed(result,&self);}},
                _=incoming_jobs.join_next(),if !incoming_jobs.is_empty()=>{},
                _=jobs.join_next(),if !jobs.is_empty()=>{},
            }
        }
        cancel.cancel();
        drop(listener);
        #[cfg(test)]
        incoming.before_worker_exit().await;
        let drain = async {
            while !jobs.is_empty() || !auto_jobs.is_empty() || !incoming_jobs.is_empty() {
                tokio::select! {_=incoming_jobs.join_next(),if !incoming_jobs.is_empty()=>{},_=jobs.join_next(),if !jobs.is_empty()=>{},result=auto_jobs.join_next(),if !auto_jobs.is_empty()=>{if let Some(result)=result{auto.completed(result,&self);}}}
            }
        };
        if tokio::time::timeout(Duration::from_secs(6), drain)
            .await
            .is_err()
        {
            jobs.abort_all();
            auto_jobs.abort_all();
            incoming_jobs.abort_all();
            while jobs.join_next().await.is_some() {}
            while auto_jobs.join_next().await.is_some() {}
            while incoming_jobs.join_next().await.is_some() {}
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
