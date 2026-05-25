use serde::{Deserialize, Serialize};

use crate::pairing::RetPairingResultAnnounce;

/// Metadata carried in Reticulum Announce app_data for peer discovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceMetadata {
    pub host_id: String,
    pub node_name: String,
    pub version: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pairing_result: Option<RetPairingResultAnnounce>,
}

/// Trust state for a discovered peer.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TrustState {
    /// Announce received, visible in network.
    Discovered,
    /// Pairing authorization completed and local peer token persisted.
    Paired,
    /// Reticulum identity/link proof verified and identity cached.
    Trusted,
    /// Manual block.
    Blocked,
}

/// A peer discovered via Reticulum Announce.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiscoveredPeer {
    pub host_id: String,
    pub node_name: String,
    pub app_version: String,
    pub port: u16,
    /// Stable public Reticulum identity address hash extracted from the signed Announce.
    pub identity_hex: String,
    /// Announced Reticulum destination address used to establish encrypted Links.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_hex: Option<String>,
    /// Timestamp of last received Announce (ms since epoch).
    pub last_seen_ms: u64,
    /// Whether the peer is currently considered online.
    pub online: bool,
    /// Trust state in the three-layer pairing model.
    pub trust_state: TrustState,
    /// Round-trip time in milliseconds (from Link measurement, None if not linked).
    pub rtt_ms: Option<u64>,
}

/// Discovery-related events emitted by the RetMeshNode.
#[derive(Debug, Clone)]
pub enum DiscoveryEvent {
    PeerDiscovered(DiscoveredPeer),
    PeerLost(String),    // host_id
    PeerOnline(String),  // host_id
    PeerOffline(String), // host_id
}

/// Build device metadata JSON bytes for Announce app_data.
pub fn build_announce_data(host_id: &str, node_name: &str, version: &str, port: u16) -> Vec<u8> {
    let meta = DeviceMetadata {
        host_id: host_id.to_string(),
        node_name: node_name.to_string(),
        version: version.to_string(),
        port,
        pairing_result: None,
    };
    serde_json::to_vec(&meta).unwrap_or_default()
}

/// Try to parse DeviceMetadata from Announce app_data bytes.
pub fn parse_announce_data(data: &[u8]) -> Option<DeviceMetadata> {
    serde_json::from_slice::<DeviceMetadata>(data).ok()
}
