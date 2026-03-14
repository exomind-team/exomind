//! mDNS service discovery for LAN peer auto-detection.
//!
//! Uses `mdns-sd` to broadcast and browse `_exomind._tcp.local.` services,
//! enabling ExoMind Runtime instances on the same LAN to find each other
//! without manual configuration.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, RwLock};
use std::thread;

/// Service type for mDNS advertisement and browsing.
const SERVICE_TYPE: &str = "_exomind._tcp.local.";

/// Pick the best address from a set of discovered addresses.
///
/// Priority: IPv4 > global/ULA IPv6 > link-local IPv6.
/// Link-local IPv6 (`fe80::`) requires a zone/scope ID to be routable,
/// which `IpAddr` does not carry, so we avoid it when possible.
fn pick_best_address(addrs: &std::collections::HashSet<IpAddr>) -> Option<IpAddr> {
    let mut best: Option<IpAddr> = None;
    for addr in addrs {
        match addr {
            IpAddr::V4(_) => return Some(*addr), // IPv4 is always preferred
            IpAddr::V6(v6) => {
                // Skip link-local (fe80::/10) if we already have something better.
                if (v6.segments()[0] & 0xffc0) == 0xfe80 {
                    if best.is_none() {
                        best = Some(*addr);
                    }
                } else {
                    // Global or ULA IPv6 — better than link-local.
                    best = Some(*addr);
                }
            }
        }
    }
    best
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
            "",        // empty IP — will be auto-filled
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
                                map.insert(remote_host_id, peer);
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
