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

/// Service type for mDNS advertisement and browsing.
const SERVICE_TYPE: &str = "_exomind._tcp.local.";

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
                (u128::from(local) & u128::from(mask))
                    == (u128::from(candidate) & u128::from(mask))
            }
            _ => false,
        }
    }
}

fn pick_best_address_for_network(
    addrs: &std::collections::HashSet<IpAddr>,
    preferred_network: Option<&PreferredLocalNetwork>,
) -> Option<IpAddr> {
    addrs.iter()
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
        })
    }

    /// Register this runtime as an `_exomind._tcp.local.` service.
    ///
    /// The TXT record includes `host_id=<host_id>` so browsers can
    /// distinguish different logical runtimes.
    pub fn register(&self) -> Result<(), String> {
        let instance_name = format!("exomind-{}", self.host_id);
        let host_name = format!("{instance_name}.local.");

        let properties = [("host_id", self.host_id.as_str())];

        let service_info = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            "", // empty IP — will be auto-filled
            self.port,
            &properties[..],
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
        better_discovered_peer, local_interface_rank, pick_best_address_for_network,
        DiscoveredPeer, PreferredLocalNetwork,
    };
    use std::collections::HashSet;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

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
        let ethernet_rank = local_interface_rank(
            "以太网 3",
            IpAddr::V4(Ipv4Addr::new(192, 168, 101, 5)),
            24,
        );
        let vmware_rank = local_interface_rank(
            "VMware Network Adapter VMnet1",
            IpAddr::V4(Ipv4Addr::new(192, 168, 237, 1)),
            24,
        );
        let tailscale_rank = local_interface_rank(
            "Tailscale",
            IpAddr::V4(Ipv4Addr::new(100, 81, 46, 70)),
            32,
        );
        let clash_rank = local_interface_rank(
            "FlClash",
            IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)),
            30,
        );

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
