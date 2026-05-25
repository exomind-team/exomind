use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::RetMeshNode;
use reticulum::transport::Transport;

/// A peer discovered via mDNS and tracked by the bridge.
struct PeerEntry {
    host_id: String,
    host: String,
    ret_port: u16,
    connected_at: Instant,
}

/// Bridges mDNS peer discovery events into Reticulum Interface registration.
///
/// When mDNS resolves a new peer with a `ret_port` TXT field, `on_peer_resolved`
/// calls `RetMeshNode::add_udp_interface` to create a UDP Interface pointing at
/// that peer's Reticulum port. Duplicate host_ids are skipped.
///
/// This struct is **not** a Reticulum `Interface` — it is an outer coordinator
/// that watches mDNS events and manages Reticulum Interfaces from the outside.
pub struct MdnsBridge {
    bind_addr: String,
    known: Arc<RwLock<HashMap<String, PeerEntry>>>,
}

impl MdnsBridge {
    /// Create a new MdnsBridge.
    ///
    /// `bind_addr` is the local UDP address used as the bind endpoint for
    /// outbound UDP interfaces (e.g. `"0.0.0.0:0"` or a specific port).
    pub fn new(bind_addr: String) -> Self {
        Self {
            bind_addr,
            known: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Called when mDNS resolves a new peer with Reticulum port info.
    ///
    /// Creates a UdpInterface forwarding to the peer's `ret_port`
    /// so Reticulum can exchange Announces with it over UDP.
    pub async fn on_peer_resolved(&self, transport: &Transport, host_id: &str, host: &str, ret_port: u16) {
        // Dedup by host_id
        {
            let known = self.known.read().await;
            if known.contains_key(host_id) {
                return;
            }
        }

        let forward_addr = format!("{host}:{ret_port}");
        RetMeshNode::add_udp_interface(transport, &self.bind_addr, &forward_addr).await;

        {
            let mut known = self.known.write().await;
            known.insert(
                host_id.to_string(),
                PeerEntry {
                    host_id: host_id.to_string(),
                    host: host.to_string(),
                    ret_port,
                    connected_at: Instant::now(),
                },
            );
        }

        tracing::info!(
            host_id = %host_id,
            forward = %forward_addr,
            "MdnsBridge: created UDP interface to Reticulum peer"
        );
    }

    /// Remove a peer that has disappeared from mDNS.
    pub async fn on_peer_removed(&self, host_id: &str) {
        let mut known = self.known.write().await;
        known.remove(host_id);
        tracing::debug!(host_id = %host_id, "MdnsBridge: peer removed");
    }

    /// Check whether a peer is already tracked.
    pub async fn is_known(&self, host_id: &str) -> bool {
        self.known.read().await.contains_key(host_id)
    }

    /// Number of tracked peers.
    pub async fn peer_count(&self) -> usize {
        self.known.read().await.len()
    }
}
