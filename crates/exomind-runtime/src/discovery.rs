//! mDNS service discovery for LAN peer auto-detection.
//!
//! Uses `mdns-sd` to broadcast and browse `_exomind._tcp.local.` services,
//! enabling ExoMind Runtime instances on the same LAN to find each other
//! without manual configuration.

use if_addrs::IfAddr;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, RwLock};
use std::thread;

use crate::ens::ReticulumMdnsBootstrap;

/// Service type for mDNS advertisement and browsing.
const SERVICE_TYPE: &str = "_exomind._tcp.local.";
const TXT_HOST_ID: &str = "host_id";
const TXT_RET_IDENTITY_HEX: &str = "ret_identity_hex";
const TXT_RET_PORT: &str = "ret_port";
const TXT_RET_DESTINATION: &str = "ret_destination";
const TXT_RET_INTERFACE: &str = "ret_interface";
const TXT_RET_CAPABILITIES: &str = "ret_capabilities";
const TXT_LEGACY_IDENTITY_HEX: &str = "identity_hex";
const TXT_LEGACY_RETICULUM_DESTINATION: &str = "reticulum_destination";

pub type MdnsReticulumBootstrapSink = Arc<dyn Fn(ReticulumMdnsBootstrap) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReticulumMdnsAdvertisement {
    pub identity_hex: String,
    pub ret_port: u16,
    pub reticulum_destination: Option<String>,
    pub via_interface: Option<String>,
    pub capabilities: Vec<String>,
}

fn mdns_txt_properties(
    host_id: &str,
    advertisement: Option<&ReticulumMdnsAdvertisement>,
) -> HashMap<String, String> {
    let mut properties = HashMap::from([(TXT_HOST_ID.to_string(), host_id.to_string())]);

    if let Some(advertisement) = advertisement {
        properties.insert(
            TXT_RET_IDENTITY_HEX.to_string(),
            advertisement.identity_hex.clone(),
        );
        properties.insert(TXT_RET_PORT.to_string(), advertisement.ret_port.to_string());
        if let Some(destination) = advertisement.reticulum_destination.as_deref() {
            properties.insert(TXT_RET_DESTINATION.to_string(), destination.to_string());
        }
        if let Some(via_interface) = advertisement.via_interface.as_deref() {
            properties.insert(TXT_RET_INTERFACE.to_string(), via_interface.to_string());
        }
        if !advertisement.capabilities.is_empty() {
            properties.insert(
                TXT_RET_CAPABILITIES.to_string(),
                advertisement.capabilities.join(","),
            );
        }
    }

    properties
}

fn parse_reticulum_capabilities(raw: Option<&str>) -> Vec<String> {
    raw.unwrap_or_default()
        .split([',', ';', ' ', '\t', '\n', '\r'])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn reticulum_bootstrap_from_service_info(
    info: &ServiceInfo,
    host: &str,
    host_id: Option<String>,
) -> Result<Option<ReticulumMdnsBootstrap>, String> {
    let identity_hex = info
        .get_property_val_str(TXT_RET_IDENTITY_HEX)
        .or_else(|| info.get_property_val_str(TXT_LEGACY_IDENTITY_HEX))
        .unwrap_or_default()
        .trim()
        .to_string();
    if identity_hex.is_empty() {
        return Ok(None);
    }
    let host = host.trim();
    if host.is_empty() {
        return Err(format!(
            "invalid mDNS Reticulum host for identity {identity_hex}"
        ));
    }

    let ret_port = info
        .get_property_val_str(TXT_RET_PORT)
        .unwrap_or_default()
        .trim()
        .parse::<u16>()
        .map_err(|_| format!("invalid mDNS Reticulum ret_port for identity {identity_hex}"))?;
    if ret_port == 0 {
        return Err(format!(
            "invalid mDNS Reticulum ret_port=0 for identity {identity_hex}"
        ));
    }

    let reticulum_destination = info
        .get_property_val_str(TXT_RET_DESTINATION)
        .or_else(|| info.get_property_val_str(TXT_LEGACY_RETICULUM_DESTINATION))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let via_interface = info
        .get_property_val_str(TXT_RET_INTERFACE)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let capabilities =
        parse_reticulum_capabilities(info.get_property_val_str(TXT_RET_CAPABILITIES));

    Ok(Some(ReticulumMdnsBootstrap {
        identity_hex,
        host_id,
        host: host.to_string(),
        ret_port,
        reticulum_destination,
        via_interface,
        capabilities,
    }))
}

/// Pick the best address from a set of discovered addresses.
///
/// Priority:
/// 1. Prefer an address on the same subnet as the primary outbound interface.
/// 2. Prefer RFC1918/private IPv4 over global/shared/link-local/special IPv4.
/// 3. Fall back to global/ULA IPv6, then link-local IPv6.
///
/// This avoids unstable selection on multi-homed hosts where mDNS returns
/// multiple addresses (for example Ethernet + VMware + proxy/TUN adapters).
fn pick_best_address(addrs: &std::collections::HashSet<IpAddr>) -> Option<IpAddr> {
    let preferred_network = detect_preferred_local_network();
    pick_best_address_for_network(addrs, preferred_network.as_ref())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PreferredLocalNetwork {
    addr: IpAddr,
    netmask: IpAddr,
}

impl PreferredLocalNetwork {
    #[cfg(test)]
    fn ipv4(addr: Ipv4Addr, netmask: Ipv4Addr) -> Self {
        Self {
            addr: IpAddr::V4(addr),
            netmask: IpAddr::V4(netmask),
        }
    }

    fn contains(&self, candidate: IpAddr) -> bool {
        match (self.addr, self.netmask, candidate) {
            (IpAddr::V4(local), IpAddr::V4(mask), IpAddr::V4(candidate)) => {
                (u32::from(local) & u32::from(mask)) == (u32::from(candidate) & u32::from(mask))
            }
            (IpAddr::V6(local), IpAddr::V6(mask), IpAddr::V6(candidate)) => {
                (u128::from(local) & u128::from(mask)) == (u128::from(candidate) & u128::from(mask))
            }
            _ => false,
        }
    }
}

fn pick_best_address_for_network(
    addrs: &std::collections::HashSet<IpAddr>,
    preferred_network: Option<&PreferredLocalNetwork>,
) -> Option<IpAddr> {
    addrs
        .iter()
        .copied()
        .max_by_key(|addr| address_sort_key(*addr, preferred_network))
}

fn detect_preferred_local_network() -> Option<PreferredLocalNetwork> {
    let interfaces = if_addrs::get_if_addrs().ok()?;

    interfaces
        .into_iter()
        .filter_map(|interface| match interface.addr {
            IfAddr::V4(v4)
                if !v4.ip.is_loopback() && !v4.ip.is_link_local() && !v4.ip.is_unspecified() =>
            {
                Some((
                    local_interface_rank(&interface.name, IpAddr::V4(v4.ip), v4.prefixlen),
                    PreferredLocalNetwork {
                        addr: IpAddr::V4(v4.ip),
                        netmask: IpAddr::V4(v4.netmask),
                    },
                ))
            }
            IfAddr::V6(v6)
                if !v6.ip.is_loopback()
                    && !v6.ip.is_unicast_link_local()
                    && !v6.ip.is_unspecified() =>
            {
                Some((
                    local_interface_rank(&interface.name, IpAddr::V6(v6.ip), v6.prefixlen),
                    PreferredLocalNetwork {
                        addr: IpAddr::V6(v6.ip),
                        netmask: IpAddr::V6(v6.netmask),
                    },
                ))
            }
            _ => None,
        })
        .max_by_key(|(rank, network)| (*rank, network.addr))
        .map(|(_, network)| network)
}

fn address_family_rank(addr: IpAddr) -> u8 {
    match addr {
        IpAddr::V4(_) => 1,
        IpAddr::V6(_) => 0,
    }
}

fn address_scope_rank(addr: IpAddr) -> u8 {
    match addr {
        IpAddr::V4(v4) => ipv4_scope_rank(v4),
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                0
            } else if v6.is_unicast_link_local() {
                1
            } else {
                4
            }
        }
    }
}

fn ipv4_scope_rank(addr: Ipv4Addr) -> u8 {
    if addr.is_loopback() || addr.is_unspecified() || addr.is_multicast() || addr.is_broadcast() {
        return 0;
    }

    if addr.is_private() {
        return 5;
    }

    if is_shared_address_space_v4(addr) {
        return 4;
    }

    if addr.is_link_local() {
        return 2;
    }

    if is_benchmarking_v4(addr) || addr.is_documentation() {
        return 1;
    }

    3
}

fn is_shared_address_space_v4(addr: Ipv4Addr) -> bool {
    let value = u32::from(addr);
    let start = u32::from(Ipv4Addr::new(100, 64, 0, 0));
    let end = u32::from(Ipv4Addr::new(100, 127, 255, 255));
    (start..=end).contains(&value)
}

fn is_benchmarking_v4(addr: Ipv4Addr) -> bool {
    let value = u32::from(addr);
    let start = u32::from(Ipv4Addr::new(198, 18, 0, 0));
    let end = u32::from(Ipv4Addr::new(198, 19, 255, 255));
    (start..=end).contains(&value)
}

fn address_sort_key(
    addr: IpAddr,
    preferred_network: Option<&PreferredLocalNetwork>,
) -> (u8, u8, IpAddr) {
    let subnet_bonus = preferred_network
        .is_some_and(|network| network.contains(addr))
        .then_some(3)
        .unwrap_or(0);

    (
        address_scope_rank(addr) + subnet_bonus,
        address_family_rank(addr),
        addr,
    )
}

fn better_discovered_peer(
    current: &DiscoveredPeer,
    candidate: DiscoveredPeer,
    preferred_network: Option<&PreferredLocalNetwork>,
) -> DiscoveredPeer {
    let current_addr = current.host.parse::<IpAddr>().ok();
    let candidate_addr = candidate.host.parse::<IpAddr>().ok();

    match (current_addr, candidate_addr) {
        (Some(current_addr), Some(candidate_addr)) => {
            if address_sort_key(candidate_addr, preferred_network)
                >= address_sort_key(current_addr, preferred_network)
            {
                candidate
            } else {
                current.clone()
            }
        }
        (None, Some(_)) => candidate,
        _ => current.clone(),
    }
}

fn local_interface_rank(name: &str, addr: IpAddr, prefix_len: u8) -> u32 {
    let mut score = u32::from(address_scope_rank(addr)) * 10;
    score += u32::from(address_family_rank(addr)) * 2;

    if prefix_len <= 30 {
        score += 4;
    }

    if looks_physical_interface(name) {
        score += 4;
    }

    if looks_virtual_interface(name) {
        score = score.saturating_sub(8);
    }

    if let IpAddr::V4(v4) = addr {
        let octets = v4.octets();
        if v4.is_private() && octets[3] != 1 && octets[3] != 255 {
            score += 3;
        }
    }

    score
}

fn looks_physical_interface(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("ethernet")
        || normalized.contains("wi-fi")
        || normalized.contains("wifi")
        || normalized.contains("wlan")
        || normalized.contains("eth")
        || name.contains("以太网")
        || name.contains("无线")
}

fn looks_virtual_interface(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("vmware")
        || normalized.contains("vethernet")
        || normalized.contains("virtual")
        || normalized.contains("hyper-v")
        || normalized.contains("default switch")
        || normalized.contains("tailscale")
        || normalized.contains("clash")
        || normalized.contains("tun")
        || normalized.contains("tap")
        || normalized.contains("docker")
        || normalized.contains("bridge")
        || normalized.contains("loopback")
        || normalized.contains("bluetooth")
        || name.contains("蓝牙")
}

/// A peer discovered via mDNS on the local network.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredPeer {
    /// The logical host_id of the discovered runtime.
    pub host_id: String,
    /// The IP address (v4 or v6) of the peer.
    pub host: String,
    /// The port number of the peer's HTTP server.
    pub port: u16,
    /// The full mDNS service name.
    pub full_name: String,
}

/// Manages mDNS service registration and browsing.
///
/// `MdnsDiscovery` is `Send + Sync` — safe to store in Axum's shared state
/// behind `Arc`. The daemon itself runs on dedicated std threads (not tokio).
pub struct MdnsDiscovery {
    host_id: String,
    port: u16,
    daemon: ServiceDaemon,
    peers: Arc<RwLock<HashMap<String, DiscoveredPeer>>>,
    browse_handle: RwLock<Option<thread::JoinHandle<()>>>,
    reticulum_advertisement: Option<ReticulumMdnsAdvertisement>,
    reticulum_bootstrap_sink: Option<MdnsReticulumBootstrapSink>,
}

// SAFETY: ServiceDaemon internally uses channels that are Send+Sync.
// The only non-Send field (browse_handle) is behind RwLock.
unsafe impl Send for MdnsDiscovery {}
unsafe impl Sync for MdnsDiscovery {}

impl MdnsDiscovery {
    /// Create a new mDNS discovery instance.
    ///
    /// Does NOT register or start browsing yet — call `register()` and
    /// `start_browsing()` separately.
    pub fn new(host_id: String, port: u16) -> Result<Self, String> {
        let daemon =
            ServiceDaemon::new().map_err(|e| format!("failed to create mDNS daemon: {e}"))?;

        Ok(Self {
            host_id,
            port,
            daemon,
            peers: Arc::new(RwLock::new(HashMap::new())),
            browse_handle: RwLock::new(None),
            reticulum_advertisement: None,
            reticulum_bootstrap_sink: None,
        })
    }

    pub fn with_reticulum_advertisement(
        mut self,
        advertisement: Option<ReticulumMdnsAdvertisement>,
    ) -> Self {
        self.reticulum_advertisement = advertisement;
        self
    }

    pub fn with_reticulum_bootstrap_sink(
        mut self,
        sink: Option<MdnsReticulumBootstrapSink>,
    ) -> Self {
        self.reticulum_bootstrap_sink = sink;
        self
    }

    /// Register this runtime as an `_exomind._tcp.local.` service.
    ///
    /// The TXT record includes `host_id=<host_id>` so browsers can
    /// distinguish different logical runtimes.
    pub fn register(&self) -> Result<(), String> {
        let instance_name = format!("exomind-{}", self.host_id);
        let host_name = format!("{instance_name}.local.");

        let properties = mdns_txt_properties(&self.host_id, self.reticulum_advertisement.as_ref());

        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            "", // empty IP — will be auto-filled
            self.port,
            properties,
        )
        .map_err(|e| format!("failed to build ServiceInfo: {e}"))?
        .enable_addr_auto();

        self.daemon
            .register(service_info)
            .map_err(|e| format!("failed to register mDNS service: {e}"))?;

        tracing::info!(
            host_id = %self.host_id,
            port = self.port,
            "mDNS service registered as {instance_name}",
        );

        Ok(())
    }

    /// Start browsing for other `_exomind._tcp.local.` services in a
    /// background thread.
    ///
    /// Discovered peers (excluding self) are stored internally and can
    /// be queried via `discovered_peers()`.
    pub fn start_browsing(&self) -> Result<(), String> {
        let receiver = self
            .daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("failed to start mDNS browse: {e}"))?;

        let peers = Arc::clone(&self.peers);
        let own_host_id = self.host_id.clone();
        let preferred_network = detect_preferred_local_network();
        let reticulum_bootstrap_sink = self.reticulum_bootstrap_sink.clone();

        let handle = thread::Builder::new()
            .name("mdns-browser".to_string())
            .spawn(move || {
                // Block on the receiver channel — it yields discovery events
                // until the daemon is shut down.
                while let Ok(event) = receiver.recv() {
                    match event {
                        ServiceEvent::ServiceResolved(info) => {
                            let remote_host_id = info
                                .get_property_val_str("host_id")
                                .unwrap_or_default()
                                .to_string();

                            // Skip self.
                            if remote_host_id == own_host_id {
                                continue;
                            }

                            // Prefer IPv4 > global IPv6 > link-local IPv6.
                            // Link-local IPv6 (fe80::) requires a zone/scope ID
                            // to be routable, which IpAddr doesn't carry.
                            let host = pick_best_address(info.get_addresses())
                                .map(|addr| addr.to_string())
                                .unwrap_or_default();

                            match reticulum_bootstrap_from_service_info(
                                &info,
                                &host,
                                (!remote_host_id.is_empty()).then(|| remote_host_id.clone()),
                            ) {
                                Ok(Some(bootstrap)) => {
                                    if let Some(sink) = &reticulum_bootstrap_sink {
                                        sink(bootstrap);
                                    }
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    tracing::warn!(error = %error, "ignored invalid mDNS Reticulum bootstrap");
                                }
                            }

                            let peer = DiscoveredPeer {
                                host_id: remote_host_id.clone(),
                                host,
                                port: info.get_port(),
                                full_name: info.get_fullname().to_string(),
                            };

                            tracing::info!(
                                peer_host_id = %peer.host_id,
                                peer_host = %peer.host,
                                peer_port = peer.port,
                                "mDNS peer discovered",
                            );

                            if let Ok(mut map) = peers.write() {
                                if let Some(existing) = map.get(&remote_host_id) {
                                    let better = better_discovered_peer(
                                        existing,
                                        peer,
                                        preferred_network.as_ref(),
                                    );
                                    map.insert(remote_host_id, better);
                                } else {
                                    map.insert(remote_host_id, peer);
                                }
                            }
                        }
                        ServiceEvent::ServiceRemoved(_, full_name) => {
                            if let Ok(mut map) = peers.write() {
                                // Remove by full_name match.
                                map.retain(|_, peer| peer.full_name != full_name);
                            }
                            tracing::info!(
                                full_name = %full_name,
                                "mDNS peer removed",
                            );
                        }
                        // Ignore other events (SearchStarted, SearchStopped, etc.)
                        _ => {}
                    }
                }
            })
            .map_err(|e| format!("failed to spawn mDNS browser thread: {e}"))?;

        if let Ok(mut guard) = self.browse_handle.write() {
            *guard = Some(handle);
        }

        tracing::info!("mDNS browsing started for {SERVICE_TYPE}");

        Ok(())
    }

    /// Return the list of currently discovered peers (excluding self).
    pub fn discovered_peers(&self) -> Vec<DiscoveredPeer> {
        self.peers
            .read()
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Shutdown the mDNS daemon and stop browsing.
    pub fn shutdown(&self) {
        if let Err(e) = self.daemon.shutdown() {
            tracing::warn!("mDNS daemon shutdown error: {e}");
        }
        tracing::info!(host_id = %self.host_id, "mDNS discovery shut down");
    }
}

impl Drop for MdnsDiscovery {
    fn drop(&mut self) {
        // Best-effort shutdown on drop.
        let _ = self.daemon.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DiscoveredPeer, PreferredLocalNetwork, ReticulumMdnsAdvertisement, SERVICE_TYPE,
        TXT_HOST_ID, TXT_RET_CAPABILITIES, TXT_RET_DESTINATION, TXT_RET_IDENTITY_HEX,
        TXT_RET_INTERFACE, TXT_RET_PORT, better_discovered_peer, local_interface_rank,
        mdns_txt_properties, parse_reticulum_capabilities, pick_best_address_for_network,
        reticulum_bootstrap_from_service_info,
    };
    use mdns_sd::ServiceInfo;
    use std::collections::HashSet;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn service_info_with_properties(
        port: u16,
        properties: std::collections::HashMap<String, String>,
    ) -> ServiceInfo {
        ServiceInfo::new(
            SERVICE_TYPE,
            "exomind-rt-peer",
            "exomind-rt-peer.local.",
            "192.168.1.20",
            port,
            properties,
        )
        .expect("test ServiceInfo should build")
    }

    #[test]
    fn mdns_txt_properties_keep_legacy_host_id_and_add_reticulum_bootstrap() {
        let properties = mdns_txt_properties(
            "rt-local",
            Some(&ReticulumMdnsAdvertisement {
                identity_hex: "identity-a".to_string(),
                ret_port: 4242,
                reticulum_destination: Some("destination-a".to_string()),
                via_interface: Some("192.168.1.20:4242".to_string()),
                capabilities: vec!["ens-control".to_string(), "ens-data".to_string()],
            }),
        );

        assert_eq!(
            properties.get(TXT_HOST_ID).map(String::as_str),
            Some("rt-local")
        );
        assert_eq!(
            properties.get(TXT_RET_IDENTITY_HEX).map(String::as_str),
            Some("identity-a")
        );
        assert_eq!(
            properties.get(TXT_RET_PORT).map(String::as_str),
            Some("4242")
        );
        assert_eq!(
            properties.get(TXT_RET_DESTINATION).map(String::as_str),
            Some("destination-a")
        );
        assert_eq!(
            properties.get(TXT_RET_INTERFACE).map(String::as_str),
            Some("192.168.1.20:4242")
        );
        assert_eq!(
            properties.get(TXT_RET_CAPABILITIES).map(String::as_str),
            Some("ens-control,ens-data")
        );
    }

    #[test]
    fn mdns_txt_properties_without_reticulum_advertisement_only_publish_host_id() {
        let properties = mdns_txt_properties("rt-local", None);

        assert_eq!(properties.len(), 1);
        assert_eq!(
            properties.get(TXT_HOST_ID).map(String::as_str),
            Some("rt-local")
        );
    }

    #[test]
    fn reticulum_bootstrap_from_mdns_uses_ret_port_separate_from_http_port() {
        let properties = mdns_txt_properties(
            "rt-b",
            Some(&ReticulumMdnsAdvertisement {
                identity_hex: "identity-b".to_string(),
                ret_port: 4242,
                reticulum_destination: Some("destination-b".to_string()),
                via_interface: Some("lan0".to_string()),
                capabilities: vec!["ens-control".to_string(), "eventlog-sync".to_string()],
            }),
        );
        let info = service_info_with_properties(1949, properties);

        let bootstrap =
            reticulum_bootstrap_from_service_info(&info, "192.168.1.20", Some("rt-b".to_string()))
                .expect("valid bootstrap should parse")
                .expect("identity and ret_port should produce bootstrap");

        assert_eq!(info.get_port(), 1949);
        assert_eq!(bootstrap.ret_port, 4242);
        assert_eq!(bootstrap.host, "192.168.1.20");
        assert_eq!(bootstrap.host_id.as_deref(), Some("rt-b"));
        assert_eq!(bootstrap.identity_hex, "identity-b");
        assert_eq!(
            bootstrap.reticulum_destination.as_deref(),
            Some("destination-b")
        );
        assert_eq!(bootstrap.via_interface.as_deref(), Some("lan0"));
        assert_eq!(
            bootstrap.capabilities,
            vec!["ens-control".to_string(), "eventlog-sync".to_string()]
        );
    }

    #[test]
    fn reticulum_bootstrap_ignores_mdns_services_without_reticulum_identity() {
        let info = service_info_with_properties(
            1949,
            std::collections::HashMap::from([(TXT_HOST_ID.to_string(), "rt-b".to_string())]),
        );

        let bootstrap =
            reticulum_bootstrap_from_service_info(&info, "192.168.1.20", Some("rt-b".to_string()))
                .expect("missing identity is not an invalid legacy mDNS service");

        assert!(bootstrap.is_none());
    }

    #[test]
    fn reticulum_bootstrap_rejects_zero_ret_port() {
        let properties = std::collections::HashMap::from([
            (TXT_HOST_ID.to_string(), "rt-b".to_string()),
            (TXT_RET_IDENTITY_HEX.to_string(), "identity-b".to_string()),
            (TXT_RET_PORT.to_string(), "0".to_string()),
        ]);
        let info = service_info_with_properties(1949, properties);

        let error =
            reticulum_bootstrap_from_service_info(&info, "192.168.1.20", Some("rt-b".to_string()))
                .expect_err("ret_port=0 must not produce a dialable bootstrap");

        assert!(error.contains("ret_port=0"));
    }

    #[test]
    fn reticulum_bootstrap_rejects_empty_host() {
        let properties = std::collections::HashMap::from([
            (TXT_HOST_ID.to_string(), "rt-b".to_string()),
            (TXT_RET_IDENTITY_HEX.to_string(), "identity-b".to_string()),
            (TXT_RET_PORT.to_string(), "4242".to_string()),
        ]);
        let info = service_info_with_properties(1949, properties);

        let error = reticulum_bootstrap_from_service_info(&info, "  ", Some("rt-b".to_string()))
            .expect_err("empty mDNS host must not produce a dialable bootstrap");

        assert!(error.contains("host"));
    }

    #[test]
    fn parse_reticulum_capabilities_supports_common_mdns_separators() {
        let capabilities = parse_reticulum_capabilities(Some(
            "ens-control,eventlog-sync;timeblock-sync task-sync\nproposal-sync",
        ));

        assert_eq!(
            capabilities,
            vec![
                "ens-control".to_string(),
                "eventlog-sync".to_string(),
                "timeblock-sync".to_string(),
                "task-sync".to_string(),
                "proposal-sync".to_string(),
            ]
        );
    }

    #[test]
    fn pick_best_address_prefers_same_subnet_ipv4_on_multi_homed_hosts() {
        let addrs = HashSet::from([
            IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 85, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 101, 5)),
        ]);

        let preferred_network = PreferredLocalNetwork::ipv4(
            Ipv4Addr::new(192, 168, 101, 42),
            Ipv4Addr::new(255, 255, 255, 0),
        );

        let picked = pick_best_address_for_network(&addrs, Some(&preferred_network));

        assert_eq!(picked, Some(IpAddr::V4(Ipv4Addr::new(192, 168, 101, 5))));
    }

    #[test]
    fn pick_best_address_falls_back_to_private_ipv4_before_virtual_or_link_local() {
        let addrs = HashSet::from([
            IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 10, 20)),
            IpAddr::V4(Ipv4Addr::new(192, 168, 85, 1)),
        ]);

        let picked = pick_best_address_for_network(&addrs, None);

        assert_eq!(picked, Some(IpAddr::V4(Ipv4Addr::new(192, 168, 85, 1))));
    }

    #[test]
    fn pick_best_address_prefers_global_ipv6_over_link_local_when_no_ipv4_exists() {
        let addrs = HashSet::from([
            IpAddr::V6(Ipv6Addr::from([0xfe80, 0, 0, 0, 0, 0, 0, 1])),
            IpAddr::V6(Ipv6Addr::from([0xfd12, 0, 0, 0, 0, 0, 0, 1])),
        ]);

        let picked = pick_best_address_for_network(&addrs, None);

        assert_eq!(
            picked,
            Some(IpAddr::V6(Ipv6Addr::from([0xfd12, 0, 0, 0, 0, 0, 0, 1])))
        );
    }

    #[test]
    fn local_interface_rank_prefers_real_private_lan_over_virtual_or_overlay_interfaces() {
        let ethernet_rank =
            local_interface_rank("以太网 3", IpAddr::V4(Ipv4Addr::new(192, 168, 101, 5)), 24);
        let vmware_rank = local_interface_rank(
            "VMware Network Adapter VMnet1",
            IpAddr::V4(Ipv4Addr::new(192, 168, 237, 1)),
            24,
        );
        let tailscale_rank =
            local_interface_rank("Tailscale", IpAddr::V4(Ipv4Addr::new(100, 81, 46, 70)), 32);
        let clash_rank =
            local_interface_rank("FlClash", IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)), 30);

        assert!(ethernet_rank > vmware_rank);
        assert!(ethernet_rank > tailscale_rank);
        assert!(ethernet_rank > clash_rank);
    }

    #[test]
    fn better_discovered_peer_keeps_higher_ranked_address_for_same_host() {
        let preferred_network = PreferredLocalNetwork::ipv4(
            Ipv4Addr::new(192, 168, 101, 42),
            Ipv4Addr::new(255, 255, 255, 0),
        );

        let current = DiscoveredPeer {
            host_id: "rt-peer".to_string(),
            host: "192.168.237.1".to_string(),
            port: 19045,
            full_name: "exomind-rt-peer._exomind._tcp.local.".to_string(),
        };
        let candidate = DiscoveredPeer {
            host_id: "rt-peer".to_string(),
            host: "192.168.101.5".to_string(),
            port: 19045,
            full_name: "exomind-rt-peer._exomind._tcp.local.".to_string(),
        };

        let chosen = better_discovered_peer(&current, candidate, Some(&preferred_network));

        assert_eq!(chosen.host, "192.168.101.5");
    }
}
