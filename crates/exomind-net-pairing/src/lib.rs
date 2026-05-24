pub mod discovery;
pub mod pairing;
pub mod peer_store;

use std::collections::HashMap;
use std::sync::Arc;

pub use discovery::{DeviceMetadata, DiscoveredPeer};
pub use pairing::{PairedPeer, PairingEvent, PairingResult};
pub use peer_store::PeerStore;
use rand::Rng;
use rand_core::OsRng;
use reticulum::destination::DestinationName;
use reticulum::identity::PrivateIdentity;
use reticulum::transport::{Transport, TransportConfig};
use sha2::{Digest, Sha256};
use tokio::sync::{RwLock, broadcast};

/// Events emitted by the RetMeshNode.
#[derive(Debug, Clone)]
pub enum RetMeshEvent {
    Discovery(discovery::DiscoveryEvent),
    Pairing(PairingEvent),
}

/// Configuration for creating a RetMeshNode.
pub struct RetMeshConfig {
    /// Human-readable node name (e.g. "exomind-desktop").
    pub node_name: String,
    /// ExoMind runtime host_id, reused as node identifier.
    pub host_id: String,
    /// Optional hex-encoded PrivateIdentity seed. None = generate fresh.
    pub identity_seed: Option<String>,
    /// Application version string.
    pub app_version: String,
    /// Local port for Reticulum service.
    pub port: u16,
    /// Broadcast channel capacity for Announce events.
    pub broadcast_capacity: usize,
}

impl Default for RetMeshConfig {
    fn default() -> Self {
        Self {
            node_name: String::from("exomind"),
            host_id: String::from("unknown"),
            identity_seed: None,
            app_version: String::from("0.1.0"),
            port: 0,
            broadcast_capacity: 256,
        }
    }
}

/// A Reticulum mesh node for device discovery and pairing.
///
/// Wraps a `reticulum::transport::Transport` and provides:
/// - Announce-based device discovery
/// - Link-based secure pairing
/// - Peer state persistence
pub struct RetMeshNode {
    pub config: RetMeshConfig,
    pub transport: Transport,
    pub identity: PrivateIdentity,
    pub discovered: Arc<RwLock<HashMap<String, DiscoveredPeer>>>,
    pub paired: Arc<RwLock<HashMap<String, PairedPeer>>>,
    pub event_tx: broadcast::Sender<RetMeshEvent>,
}

impl RetMeshNode {
    /// Create a new Reticulum mesh node.
    ///
    /// Initializes identity (from seed or fresh), Transport, and Announced destination.
    pub async fn new(
        config: RetMeshConfig,
        transport: Transport,
        identity: PrivateIdentity,
    ) -> Self {
        let (event_tx, _event_rx) = broadcast::channel(256);

        Self {
            config,
            transport,
            identity,
            discovered: Arc::new(RwLock::new(HashMap::new())),
            paired: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
        }
    }

    /// Create a PrivateIdentity from an optional hex seed.
    pub fn load_or_create_identity(seed: Option<&str>) -> PrivateIdentity {
        match seed {
            Some(hex) => PrivateIdentity::new_from_hex_string(hex)
                .unwrap_or_else(|_| PrivateIdentity::new_from_rand(OsRng)),
            None => PrivateIdentity::new_from_rand(OsRng),
        }
    }

    /// Stable public Reticulum identity hash for authorization and display.
    pub fn public_identity_hex(identity: &PrivateIdentity) -> String {
        identity.as_identity().address_hash.to_hex_string()
    }

    /// Hex-encoded private Reticulum identity seed for local persistence.
    pub fn private_identity_seed_hex(identity: &PrivateIdentity) -> String {
        identity.to_hex_string()
    }

    /// Stable public identity hash for this node.
    pub fn local_identity_hex(&self) -> String {
        Self::public_identity_hex(&self.identity)
    }

    /// Add a TCP server interface to the transport so other nodes can connect.
    pub async fn add_tcp_interface(transport: &Transport, bind_addr: &str) {
        use reticulum::iface::tcp_server::TcpServer;
        let iface_mgr = transport.iface_manager();
        let mut mgr_lock = iface_mgr.lock().await;
        let server = TcpServer::new(bind_addr.to_string(), iface_mgr.clone());
        mgr_lock.spawn(server, |ctx| TcpServer::spawn(ctx));
    }

    /// Add a TCP client interface to connect to a remote TCP server.
    pub async fn add_tcp_client(transport: &Transport, remote_addr: &str) {
        use reticulum::iface::tcp_client::TcpClient;
        let iface_mgr = transport.iface_manager();
        let mut mgr_lock = iface_mgr.lock().await;
        let client = TcpClient::new(remote_addr.to_string());
        mgr_lock.spawn(client, |ctx| TcpClient::spawn(ctx));
    }

    /// Add a UDP broadcast interface for LAN discovery.
    ///
    /// `forward_addr` is the target for outgoing packets:
    /// - `127.0.0.1:PORT` for localhost multi-instance testing
    /// - `255.255.255.255:PORT` for LAN broadcast
    pub async fn add_udp_interface(transport: &Transport, bind_addr: &str, forward_addr: &str) {
        use reticulum::iface::udp::UdpInterface;
        let iface_mgr = transport.iface_manager();
        let mut mgr_lock = iface_mgr.lock().await;
        let iface = UdpInterface::new(bind_addr.to_string(), Some(forward_addr.to_string()));
        mgr_lock.spawn(iface, |ctx| UdpInterface::spawn(ctx));
    }

    /// Create TransportConfig and Transport.
    pub fn create_transport(
        node_name: &str,
        identity: &PrivateIdentity,
        broadcast_capacity: usize,
    ) -> Transport {
        let mut config = TransportConfig::new(node_name, identity, true);
        config.set_broadcast_capacity(broadcast_capacity);
        Transport::new(config)
    }

    /// Subscribe to broadcasts from this node.
    pub fn subscribe(&self) -> broadcast::Receiver<RetMeshEvent> {
        self.event_tx.subscribe()
    }

    /// Announce this node's presence with device metadata.
    pub async fn announce(&mut self) {
        let dest_name = DestinationName::new("exomind", "discovery");
        let dest = self
            .transport
            .add_destination(self.identity.clone(), dest_name)
            .await;
        let meta = DeviceMetadata {
            host_id: self.config.host_id.clone(),
            node_name: self.config.node_name.clone(),
            version: self.config.app_version.clone(),
            port: self.config.port,
        };
        let data = serde_json::to_vec(&meta).unwrap_or_default();
        self.transport.send_announce(&dest, Some(&data)).await;
        // dest is kept alive by the transport
    }

    /// Generate a 6-digit PIN for pairing.
    pub fn generate_pin() -> String {
        let pin: u32 = rand::thread_rng().gen_range(100_000..1_000_000);
        format!("{:06}", pin)
    }

    /// Compute SHA-256 token from host_id and PIN.
    pub fn compute_token(host_id: &str, pin: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(host_id.as_bytes());
        hasher.update(b":");
        hasher.update(pin.as_bytes());
        hex::encode(hasher.finalize())
    }
}
