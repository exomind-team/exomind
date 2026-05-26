pub mod discovery;
pub mod mdns_bridge;
pub mod pairing;
pub mod peer_store;

use std::collections::HashMap;
use std::sync::Arc;

pub use discovery::{DeviceMetadata, DiscoveredPeer};
pub use pairing::{
    PairedPeer, PairingEvent, PairingResult, RetPairingLinkFrame, RetPairingResultAnnounce,
};
pub use reticulum::destination::link::{LinkEvent, LinkEventData};
pub use reticulum::iface::InterfaceInfo;
pub use peer_store::PeerStore;
use rand::Rng;
use rand_core::OsRng;
use reticulum::destination::DestinationName;
use reticulum::destination::link::LinkStatus;
use reticulum::hash::AddressHash;
use reticulum::identity::PrivateIdentity;
use reticulum::transport::{Transport, TransportConfig};
use sha2::{Digest, Sha256};
use tokio::sync::{RwLock, broadcast};
use tokio::time::{Duration, sleep};

/// Three-state exposure mode for Reticulum announce and connectivity.
///
/// Each physical connectivity method (UDP, TCP, etc.) independently applies
/// this mode, and the global mesh also has a master mode.  The effective mode
/// at runtime is `min(global, per_method)`.
///
/// | State   | Value | Interface behaviour              |
/// |---------|-------|----------------------------------|
/// | Off     | 0     | No interface, no announce        |
/// | Passive | 1     | Interface RX-only, no announce   |
/// | Active  | 2     | Interface TX+RX, full announce   |
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetMeshMode {
    Off = 0,
    Passive = 1,
    Active = 2,
}

impl RetMeshMode {
    /// Returns true when the mode allows creating interfaces at all.
    pub fn is_enabled(self) -> bool {
        matches!(self, Self::Passive | Self::Active)
    }

    /// Returns true when the mode allows sending announces.
    pub fn can_announce(self) -> bool {
        matches!(self, Self::Active)
    }
}

impl Default for RetMeshMode {
    fn default() -> Self {
        Self::Active
    }
}

impl From<u8> for RetMeshMode {
    fn from(v: u8) -> Self {
        match v {
            0 => Self::Off,
            1 => Self::Passive,
            _ => Self::Active,
        }
    }
}

impl From<RetMeshMode> for u8 {
    fn from(m: RetMeshMode) -> u8 {
        m as u8
    }
}

/// Events emitted by the RetMeshNode.
#[derive(Debug, Clone)]
pub enum RetMeshEvent {
    Discovery(discovery::DiscoveryEvent),
    Pairing(PairingEvent),
}


#[derive(Debug, thiserror::Error)]
pub enum RetMeshPairingTransportError {
    #[error("peer has no Reticulum destination hash")]
    MissingDestination,
    #[error("invalid Reticulum destination hash")]
    InvalidDestination,
    #[error("Reticulum destination is not known locally")]
    UnknownDestination,
    #[error("Reticulum link did not become active before timeout")]
    LinkTimeout,
    #[error("failed to serialize Reticulum pairing frame")]
    Serialize,
    #[error("failed to create Reticulum link data packet")]
    Packet,
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
        mgr_lock.spawn(
            server,
            &format!("TCP Server {}", bind_addr),
            "tcp_server",
            |ctx| TcpServer::spawn(ctx),
        );
    }

    /// Add a TCP client interface to connect to a remote TCP server.
    pub async fn add_tcp_client(transport: &Transport, remote_addr: &str) {
        use reticulum::iface::tcp_client::TcpClient;
        let iface_mgr = transport.iface_manager();
        let mut mgr_lock = iface_mgr.lock().await;
        let client = TcpClient::new(remote_addr.to_string());
        mgr_lock.spawn(
            client,
            &format!("TCP Client → {}", remote_addr),
            "tcp_client",
            |ctx| TcpClient::spawn(ctx),
        );
    }

    /// Add a UDP broadcast interface for LAN discovery.
    ///
    /// `forward_addr` is the target for outgoing packets:
    /// - `127.0.0.1:PORT` for localhost multi-instance testing
    /// - `255.255.255.255:PORT` for LAN broadcast
    /// - `None` for RX-only (no outgoing)
    ///
    /// Returns the interface's `bound_port` so the caller can read the actual
    /// OS-assigned port after binding (useful when bind_addr is `0.0.0.0:0`).
    pub async fn add_udp_interface(
        transport: &Transport,
        bind_addr: &str,
        forward_addr: Option<&str>,
    ) -> Arc<std::sync::atomic::AtomicU16> {
        use reticulum::iface::udp::UdpInterface;
        let iface = UdpInterface::new(bind_addr.to_string(), forward_addr.map(String::from));
        let bound_port = iface.bound_port.clone();
        let iface_mgr = transport.iface_manager();
        let mut mgr_lock = iface_mgr.lock().await;
        mgr_lock.spawn(
            iface,
            &format!("UDP {} → {}", bind_addr, forward_addr.unwrap_or("(rx-only)")),
            "udp",
            |ctx| UdpInterface::spawn(ctx),
        );
        bound_port
    }

    /// Create TransportConfig and Transport.
    pub fn create_transport(
        node_name: &str,
        identity: &PrivateIdentity,
        broadcast_capacity: usize,
    ) -> Transport {
        let mut config = TransportConfig::new(node_name, identity, true);
        config.set_broadcast_capacity(broadcast_capacity);
        config.set_retransmit(true);
        config.set_reroute_eager(true);
        Transport::new(config)
    }

    /// Propagate the global RetMeshMode to the transport InterfaceManager.
    /// The InterfaceManager applies it as an upper bound on per-interface modes:
    /// effective = min(global, iface.mode).
    pub async fn set_global_mode(&self, mode: u8) {
        let mgr = self.transport.iface_manager();
        let mut mgr_lock = mgr.lock().await;
        mgr_lock.set_global_mode(mode);
    }

    /// Subscribe to broadcasts from this node.
    pub fn subscribe(&self) -> broadcast::Receiver<RetMeshEvent> {
        self.event_tx.subscribe()
    }

    /// Announce this node's presence with device metadata.
    pub async fn announce(&mut self) {
        self.announce_with_pairing_result(None).await;
    }

    /// Announce this node's presence and optionally include a public pairing result.
    pub async fn announce_with_pairing_result(
        &mut self,
        pairing_result: Option<pairing::RetPairingResultAnnounce>,
    ) {
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
            pairing_result,
        };
        let data = serde_json::to_vec(&meta).unwrap_or_default();
        self.transport.send_announce(&dest, Some(&data)).await;
        // dest is kept alive by the transport
    }

    /// Send a pairing frame to a discovered peer over an encrypted Reticulum Link.
    pub async fn send_pairing_frame(
        &self,
        peer: &DiscoveredPeer,
        frame: &pairing::RetPairingLinkFrame,
    ) -> Result<(), RetMeshPairingTransportError> {
        let destination_hex = peer
            .destination_hex
            .as_deref()
            .ok_or(RetMeshPairingTransportError::MissingDestination)?;
        let destination_hash = AddressHash::new_from_hex_string(destination_hex)
            .map_err(|_| RetMeshPairingTransportError::InvalidDestination)?;
        let destination = self
            .transport
            .get_out_destination(&destination_hash)
            .await
            .ok_or(RetMeshPairingTransportError::UnknownDestination)?;
        let destination_desc = destination.lock().await.desc;
        let link = self.transport.link(destination_desc).await;

        for _ in 0..50 {
            if link.lock().await.status() == LinkStatus::Active {
                let payload = serde_json::to_vec(frame)
                    .map_err(|_| RetMeshPairingTransportError::Serialize)?;
                let packet = link
                    .lock()
                    .await
                    .data_packet(&payload)
                    .map_err(|_| RetMeshPairingTransportError::Packet)?;
                self.transport.send_packet(packet).await;
                return Ok(());
            }
            sleep(Duration::from_millis(100)).await;
        }

        Err(RetMeshPairingTransportError::LinkTimeout)
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
