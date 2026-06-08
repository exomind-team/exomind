use std::collections::{HashMap, VecDeque};
use std::fs;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::atomic::{AtomicU16, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use ed25519_dalek::Signature;
use reticulum::destination::{DestinationName, SingleInputDestination};
use reticulum::error::RnsError;
use reticulum::hash::AddressHash;
use reticulum::identity::{Identity, PrivateIdentity};
use reticulum::interface::queue::QueueInterface;
use reticulum::interface::tcp_client::TcpClient;
use reticulum::interface::tcp_server::TcpServer;
use reticulum::interface::udp::UdpInterface;
use reticulum::interface::{
    Interface, InterfaceCommon, InterfaceRxSender, InterfaceStatus,
    InterfaceTopology as ReticulumInterfaceTopology, InterfaceTxReceiver, TxMessage,
};
use reticulum::packet::{DestinationType, Packet, PacketType};
use reticulum::transport::{Transport, TransportConfig};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::data_protocol::{EnsDataFrame, EnsReceivedDataFrame};
use super::dto::{
    EnsEndpointAdvertisement, EnsGatewayKind, EnsInterfaceMedium, EnsInterfaceSnapshot,
    EnsInterfaceTopology, EnsPeerSnapshot, EnsTransportHealth, EnsTransportHealthStatus,
};
use super::pairing_protocol::EnsPairingFrame;
use super::provider::{EnsProvider, EnsProviderError, EnsProviderSnapshot};

const RETICULUM_APP_NAME: &str = "exomind";
const RETICULUM_APP_ASPECT: &str = "ens";
const LOCAL_REGISTRY_VERSION: u32 = 1;
const RETICULUM_ENS_DATA_SIGNATURE_CONTEXT: &[u8] = b"exomind.reticulum.ens.data.v1";
const RETICULUM_IDENTITY_HEX_LEN: usize = 128;
const RETICULUM_DATA_SIGNATURE_LEN: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReticulumLocalRegistryEntry {
    pub endpoint: EnsEndpointAdvertisement,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ReticulumLocalRegistryFile {
    version: u32,
    entries: Vec<ReticulumLocalRegistryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
enum ReticulumEnsWireFrame {
    Pairing(EnsPairingFrame),
    Data(ReticulumSignedEnsDataFrame),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReticulumSignedEnsDataFrame {
    frame: EnsDataFrame,
    to_peer_identity_hex: String,
    signature: Vec<u8>,
}

#[derive(Debug)]
struct ReticulumOutboundFrame {
    destination: AddressHash,
    frame: ReticulumEnsWireFrame,
}

struct NamedInterface {
    common: InterfaceCommon,
    inner: Box<dyn Interface>,
}

impl NamedInterface {
    fn new(name: String, inner: Box<dyn Interface>) -> Self {
        let interface_type = inner.common().interface_type.clone();
        Self {
            common: InterfaceCommon::new(&name, &interface_type),
            inner,
        }
    }
}

impl Interface for NamedInterface {
    fn common(&self) -> &InterfaceCommon {
        &self.common
    }

    fn status(&self) -> &InterfaceStatus {
        self.inner.status()
    }

    fn mtu(&self) -> usize {
        self.inner.mtu()
    }

    fn process_outgoing(&self, msg: TxMessage) -> Result<(), RnsError> {
        self.inner.process_outgoing(msg)
    }

    fn set_rx_sender(&mut self, sender: InterfaceRxSender) {
        self.inner.set_rx_sender(sender);
    }

    fn start(
        &mut self,
        tx_recv: InterfaceTxReceiver,
        stop: CancellationToken,
        address: AddressHash,
    ) -> Result<(), RnsError> {
        self.inner.start(tx_recv, stop, address)
    }

    fn stop(&mut self) {
        self.inner.stop();
    }
}

#[derive(Debug, Clone)]
struct ReticulumUdpDynamicBinding {
    manager_name: String,
    pending_public_name: String,
    host: String,
    bound_port: Arc<AtomicU16>,
}

impl ReticulumUdpDynamicBinding {
    fn bound_port(&self) -> Option<u16> {
        let port = self.bound_port.load(Ordering::Relaxed);
        if port == 0 { None } else { Some(port) }
    }

    fn public_interface_name(&self) -> Option<String> {
        udp_interface_name_from_host_port(&self.host, self.bound_port()?)
    }

    fn public_endpoint_address(&self) -> Option<String> {
        udp_endpoint_address_from_host_port(&self.host, self.bound_port()?)
    }
}

pub struct ReticulumEnsProvider {
    provider_id: String,
    identity: PrivateIdentity,
    transport: Arc<Transport>,
    local_destination: Arc<tokio::sync::Mutex<SingleInputDestination>>,
    local_endpoint: RwLock<EnsEndpointAdvertisement>,
    health: RwLock<EnsTransportHealth>,
    peers: RwLock<HashMap<String, EnsPeerSnapshot>>,
    interfaces: RwLock<Vec<EnsInterfaceSnapshot>>,
    received_data_frames: Mutex<VecDeque<EnsReceivedDataFrame>>,
    received_pairing_frames: Mutex<VecDeque<EnsPairingFrame>>,
    udp_dynamic_bindings: Mutex<Vec<ReticulumUdpDynamicBinding>>,
    udp_dynamic_counter: AtomicUsize,
    outbound_tx: mpsc::UnboundedSender<ReticulumOutboundFrame>,
}

impl ReticulumEnsProvider {
    pub async fn new_with_identity(
        provider_id: impl Into<String>,
        host_id: Option<String>,
        identity: PrivateIdentity,
    ) -> Result<Arc<Self>, EnsProviderError> {
        let provider_id = provider_id.into();
        let identity_hex = identity.as_identity().to_hex_string();
        let mut config = TransportConfig::new(provider_id.clone(), &identity, true);
        config.set_broadcast_capacity(256);
        config.set_interface_tx_cap(64);

        let mut transport = Transport::new(config);
        let local_destination = transport
            .add_destination(
                identity.clone(),
                DestinationName::new(RETICULUM_APP_NAME, RETICULUM_APP_ASPECT),
            )
            .await;
        let reticulum_destination = local_destination
            .lock()
            .await
            .desc
            .address_hash
            .to_hex_string();
        let endpoint = EnsEndpointAdvertisement {
            identity_hex,
            host_id,
            gateway: EnsGatewayKind::Reticulum,
            via_interface: None,
            via_medium: None,
            runtime_base_url: None,
            reticulum_destination: Some(reticulum_destination),
            interface_address: None,
            discovery_source: "reticulum-provider-local".to_string(),
            capabilities: vec!["ens-control".to_string(), "ens-data".to_string()],
        };
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
        let transport = Arc::new(transport);

        let provider = Arc::new(Self {
            provider_id,
            identity,
            transport,
            local_destination,
            local_endpoint: RwLock::new(endpoint),
            health: RwLock::new(EnsTransportHealth::healthy()),
            peers: RwLock::new(HashMap::new()),
            interfaces: RwLock::new(Vec::new()),
            received_data_frames: Mutex::new(VecDeque::new()),
            received_pairing_frames: Mutex::new(VecDeque::new()),
            udp_dynamic_bindings: Mutex::new(Vec::new()),
            udp_dynamic_counter: AtomicUsize::new(0),
            outbound_tx,
        });
        provider.refresh_interfaces();
        provider.spawn_outbound_loop(outbound_rx);
        provider.spawn_received_data_loop();
        provider.spawn_announce_receiver().await;

        Ok(provider)
    }

    pub fn local_endpoint(&self) -> EnsEndpointAdvertisement {
        self.refresh_dynamic_udp_endpoint();
        match self.local_endpoint.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub async fn add_queue_interface(
        &self,
        name: &str,
        rx_from_peer: mpsc::Receiver<Vec<u8>>,
        tx_to_peer: mpsc::Sender<Vec<u8>>,
        topology: EnsInterfaceTopology,
    ) -> Result<(), EnsProviderError> {
        self.add_interface(
            Box::new(QueueInterface::with_channels(
                name,
                rx_from_peer,
                tx_to_peer,
            )),
            topology,
        )
        .await;
        self.set_local_interface_source(
            name,
            EnsInterfaceMedium::Queue,
            Some(format!("queue://{name}")),
        );
        Ok(())
    }

    pub async fn add_udp_interface(
        &self,
        bind_addr: impl Into<String>,
        forward_addr: Option<String>,
        topology: EnsInterfaceTopology,
    ) -> Result<Arc<AtomicU16>, EnsProviderError> {
        let bind_addr = bind_addr.into();
        let interface = UdpInterface::new(bind_addr.clone(), forward_addr);
        let bound_port = Arc::clone(&interface.bound_port);
        if let Some(binding) = self.create_dynamic_udp_binding(&bind_addr, &bound_port) {
            let manager_name = binding.manager_name.clone();
            let pending_public_name = binding.pending_public_name.clone();
            self.track_dynamic_udp_binding(binding);
            self.add_interface(
                Box::new(NamedInterface::new(manager_name, Box::new(interface))),
                topology,
            )
            .await;
            self.set_local_interface_source(&pending_public_name, EnsInterfaceMedium::Udp, None);
            self.refresh_dynamic_udp_endpoint();
        } else {
            self.add_interface(Box::new(interface), topology).await;
            let endpoint_address =
                udp_endpoint_address(&bind_addr, bound_port.load(Ordering::Relaxed));
            self.set_local_interface_source(&bind_addr, EnsInterfaceMedium::Udp, endpoint_address);
        }
        Ok(bound_port)
    }

    pub async fn add_tcp_server_interface(
        &self,
        bind_addr: impl Into<String>,
        topology: EnsInterfaceTopology,
    ) -> Result<(), EnsProviderError> {
        let bind_addr = bind_addr.into();
        let interface = TcpServer::new(bind_addr.clone(), self.transport.interface_manager());
        self.add_interface(Box::new(interface), topology).await;
        self.set_local_interface_source(
            &bind_addr,
            EnsInterfaceMedium::Tcp,
            Some(format!("tcp-listen://{bind_addr}")),
        );
        Ok(())
    }

    pub async fn add_tcp_client_interface(
        &self,
        remote_addr: impl Into<String>,
        topology: EnsInterfaceTopology,
    ) -> Result<(), EnsProviderError> {
        let remote_addr = remote_addr.into();
        self.add_interface(Box::new(TcpClient::new(remote_addr.clone())), topology)
            .await;
        self.set_local_interface_source(
            &remote_addr,
            EnsInterfaceMedium::Tcp,
            Some(format!("tcp://{remote_addr}")),
        );
        Ok(())
    }

    async fn add_interface(&self, interface: Box<dyn Interface>, topology: EnsInterfaceTopology) {
        self.transport
            .interface_manager()
            .lock()
            .await
            .add_interface(interface, to_reticulum_topology(topology));
        self.refresh_interfaces();
    }

    pub fn upsert_discovered_endpoint(&self, endpoint: EnsEndpointAdvertisement) {
        if endpoint.identity_hex == self.local_endpoint().identity_hex {
            return;
        }
        let peer = EnsPeerSnapshot {
            identity: endpoint.identity(),
            endpoint: Some(endpoint),
            authorized: false,
            pairing_pending: false,
            last_error: None,
        };
        let mut peers = match self.peers.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        peers.insert(peer.identity.identity_hex.clone(), peer);
    }

    pub fn publish_local_registry(&self, path: &Path) -> Result<(), EnsProviderError> {
        let mut registry = read_local_registry(path)?;
        let local = self.local_endpoint();
        registry
            .entries
            .retain(|entry| entry.endpoint.identity_hex != local.identity_hex);
        registry.entries.push(ReticulumLocalRegistryEntry {
            endpoint: local,
            updated_at: chrono::Utc::now().to_rfc3339(),
        });
        write_local_registry(path, &registry)
    }

    pub fn load_local_registry(&self, path: &Path) -> Result<usize, EnsProviderError> {
        let registry = read_local_registry(path)?;
        let mut count = 0;
        for entry in registry.entries {
            if entry.endpoint.identity_hex != self.local_endpoint().identity_hex {
                self.upsert_discovered_endpoint(entry.endpoint);
                count += 1;
            }
        }
        Ok(count)
    }

    pub fn announce_local(&self) -> Result<(), EnsProviderError> {
        let frame = serde_json::to_vec(&self.local_endpoint())
            .map_err(|error| EnsProviderError::Unavailable(error.to_string()))?;
        let transport = Arc::clone(&self.transport);
        let destination = Arc::clone(&self.local_destination);
        tokio::spawn(async move {
            transport
                .send_announce(&destination, Some(frame.as_slice()))
                .await;
        });
        Ok(())
    }

    pub fn drain_received_pairing_frames(&self) -> Vec<EnsPairingFrame> {
        let mut frames = match self.received_pairing_frames.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        frames.drain(..).collect()
    }

    fn spawn_outbound_loop(
        self: &Arc<Self>,
        mut outbound_rx: mpsc::UnboundedReceiver<ReticulumOutboundFrame>,
    ) {
        let provider = Arc::downgrade(self);
        let transport = Arc::clone(&self.transport);
        tokio::spawn(async move {
            while let Some(outbound) = outbound_rx.recv().await {
                let Some(provider) = provider.upgrade() else {
                    break;
                };
                match provider.build_packet(outbound.destination, outbound.frame) {
                    Ok(packet) => transport.send_packet(packet).await,
                    Err(error) => provider.set_health(EnsTransportHealth {
                        status: EnsTransportHealthStatus::Error,
                        message: Some(error.to_string()),
                    }),
                }
            }
        });
    }

    fn spawn_received_data_loop(self: &Arc<Self>) {
        let provider = Arc::downgrade(self);
        let mut rx = self.transport.received_data_events();
        tokio::spawn(async move {
            while let Ok(received) = rx.recv().await {
                let Some(provider) = provider.upgrade() else {
                    break;
                };
                match serde_json::from_slice::<ReticulumEnsWireFrame>(received.data.as_slice()) {
                    Ok(ReticulumEnsWireFrame::Data(signed)) => {
                        provider.ingest_signed_data_frame(signed);
                    }
                    Ok(ReticulumEnsWireFrame::Pairing(frame)) => {
                        let mut frames = match provider.received_pairing_frames.lock() {
                            Ok(guard) => guard,
                            Err(poisoned) => poisoned.into_inner(),
                        };
                        frames.push_back(frame);
                    }
                    Err(error) => provider.set_health(EnsTransportHealth {
                        status: EnsTransportHealthStatus::Degraded,
                        message: Some(format!("failed to decode Reticulum ENS frame: {error}")),
                    }),
                }
            }
        });
    }

    async fn spawn_announce_receiver(self: &Arc<Self>) {
        let provider = Arc::downgrade(self);
        let mut rx = self.transport.recv_announces().await;
        tokio::spawn(async move {
            while let Ok(announce) = rx.recv().await {
                let Some(provider) = provider.upgrade() else {
                    break;
                };
                if announce.app_data.as_slice().is_empty() {
                    continue;
                }
                let Ok(mut endpoint) = serde_json::from_slice::<EnsEndpointAdvertisement>(
                    announce.app_data.as_slice(),
                ) else {
                    continue;
                };
                let destination_hex = announce
                    .destination
                    .lock()
                    .await
                    .desc
                    .address_hash
                    .to_hex_string();
                endpoint.gateway = EnsGatewayKind::Reticulum;
                endpoint.reticulum_destination = Some(destination_hex);
                endpoint.discovery_source = "reticulum-announce".to_string();
                provider.upsert_discovered_endpoint(endpoint);
            }
        });
    }

    fn build_packet(
        &self,
        destination: AddressHash,
        frame: ReticulumEnsWireFrame,
    ) -> Result<Packet, EnsProviderError> {
        let bytes = serde_json::to_vec(&frame)
            .map_err(|error| EnsProviderError::SendDataFrame(error.to_string()))?;
        let mut packet = Packet::default();
        packet.header.destination_type = DestinationType::Single;
        packet.header.packet_type = PacketType::Data;
        packet.destination = destination;
        packet
            .data
            .write(bytes.as_slice())
            .map_err(|error| EnsProviderError::SendDataFrame(error.to_string()))?;
        Ok(packet)
    }

    fn sign_data_frame(
        &self,
        peer: &super::dto::EnsPeerIdentity,
        frame: EnsDataFrame,
    ) -> Result<ReticulumSignedEnsDataFrame, EnsProviderError> {
        let canonical = canonical_data_frame_bytes(&frame, &peer.identity_hex)?;
        let signature = self.identity.sign(&canonical).to_bytes().to_vec();
        Ok(ReticulumSignedEnsDataFrame {
            frame,
            to_peer_identity_hex: peer.identity_hex.clone(),
            signature,
        })
    }

    fn ingest_signed_data_frame(&self, signed: ReticulumSignedEnsDataFrame) {
        let local_identity_hex = self.local_endpoint().identity_hex;
        let result = verify_signed_data_frame(signed, local_identity_hex.as_str());
        match result {
            Ok(received) => {
                let mut frames = match self.received_data_frames.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                frames.push_back(received);
            }
            Err(error) => self.set_health(EnsTransportHealth {
                status: EnsTransportHealthStatus::Degraded,
                message: Some(error),
            }),
        }
    }

    fn set_health(&self, health: EnsTransportHealth) {
        let mut guard = match self.health.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = health;
    }

    fn set_local_interface_source(
        &self,
        interface_name: &str,
        medium: EnsInterfaceMedium,
        address: Option<String>,
    ) {
        let mut endpoint = match self.local_endpoint.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if endpoint.via_interface.is_none() {
            endpoint.via_interface = Some(interface_name.to_string());
            endpoint.via_medium = Some(medium);
            endpoint.interface_address = address;
            endpoint.discovery_source = "reticulum-provider-interface".to_string();
        }
    }

    fn create_dynamic_udp_binding(
        &self,
        bind_addr: &str,
        bound_port: &Arc<AtomicU16>,
    ) -> Option<ReticulumUdpDynamicBinding> {
        let socket_addr = bind_addr.parse::<SocketAddr>().ok()?;
        if socket_addr.port() != 0 {
            return None;
        }
        let sequence = self.udp_dynamic_counter.fetch_add(1, Ordering::Relaxed) + 1;
        let host = socket_addr.ip().to_string();
        Some(ReticulumUdpDynamicBinding {
            manager_name: format!("udp-dynamic://{host}/{sequence}"),
            pending_public_name: format!("{host}:pending-{sequence}"),
            host,
            bound_port: Arc::clone(bound_port),
        })
    }

    fn track_dynamic_udp_binding(&self, binding: ReticulumUdpDynamicBinding) {
        let mut guard = match self.udp_dynamic_bindings.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.push(binding);
    }

    fn refresh_dynamic_udp_endpoint(&self) {
        let bindings = self.dynamic_udp_bindings();
        if bindings.is_empty() {
            return;
        }

        let mut endpoint = match self.local_endpoint.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        for binding in bindings {
            let Some(public_name) = binding.public_interface_name() else {
                continue;
            };
            let Some(endpoint_address) = binding.public_endpoint_address() else {
                continue;
            };
            let via_interface = endpoint.via_interface.as_deref();
            if !matches!(
                via_interface,
                Some(name) if name == binding.pending_public_name || name == public_name
            ) || endpoint.via_medium != Some(EnsInterfaceMedium::Udp)
            {
                continue;
            }
            endpoint.via_interface = Some(public_name);
            endpoint.interface_address = Some(endpoint_address);
            endpoint.discovery_source = "reticulum-provider-interface".to_string();
        }
    }

    fn dynamic_udp_bindings(&self) -> Vec<ReticulumUdpDynamicBinding> {
        match self.udp_dynamic_bindings.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn project_dynamic_udp_interface_name(
        &self,
        name: &str,
        bindings: &[ReticulumUdpDynamicBinding],
    ) -> Option<String> {
        bindings.iter().find_map(|binding| {
            if binding.manager_name == name {
                binding
                    .public_interface_name()
                    .or_else(|| Some(binding.pending_public_name.clone()))
            } else {
                None
            }
        })
    }

    fn resolve_interface_manager_name(&self, name: &str) -> String {
        self.dynamic_udp_bindings()
            .into_iter()
            .find_map(|binding| {
                if binding.manager_name == name || binding.pending_public_name == name {
                    return Some(binding.manager_name);
                }
                if binding.public_interface_name().as_deref() == Some(name) {
                    Some(binding.manager_name)
                } else {
                    None
                }
            })
            .unwrap_or_else(|| name.to_string())
    }

    fn public_interface_snapshot_name(&self, manager_name: &str) -> String {
        let bindings = self.dynamic_udp_bindings();
        self.project_dynamic_udp_interface_name(manager_name, &bindings)
            .unwrap_or_else(|| manager_name.to_string())
    }

    fn refresh_interfaces(&self) {
        let manager = self.transport.interface_manager();
        let Ok(guard) = manager.try_lock() else {
            return;
        };
        let bindings = self.dynamic_udp_bindings();
        let interfaces = guard
            .list_interfaces()
            .into_iter()
            .map(|info| {
                let name = self
                    .project_dynamic_udp_interface_name(&info.name, &bindings)
                    .unwrap_or(info.name);
                EnsInterfaceSnapshot {
                    name,
                    interface_type: info.interface_type,
                    online: info.online,
                    outgoing: info.outgoing,
                    topology: from_reticulum_topology(info.topology),
                    effective_topology: from_reticulum_topology(info.topology),
                }
            })
            .collect::<Vec<_>>();
        drop(guard);

        let mut guard = match self.interfaces.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = interfaces;
    }

    fn peer_destinations(&self) -> Vec<AddressHash> {
        let peers = match self.peers.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        peers
            .values()
            .filter_map(|peer| {
                peer.endpoint
                    .as_ref()
                    .and_then(|endpoint| endpoint.reticulum_destination.as_deref())
                    .and_then(|destination| AddressHash::new_from_hex_string(destination).ok())
            })
            .collect()
    }

    fn peer_destination(&self, identity_hex: &str) -> Result<AddressHash, EnsProviderError> {
        let peers = match self.peers.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let destination = peers
            .get(identity_hex)
            .and_then(|peer| peer.endpoint.as_ref())
            .and_then(|endpoint| endpoint.reticulum_destination.as_deref())
            .ok_or_else(|| {
                EnsProviderError::SendDataFrame(format!(
                    "Reticulum destination was not discovered for peer {identity_hex}"
                ))
            })?;
        AddressHash::new_from_hex_string(destination).map_err(|error| {
            EnsProviderError::SendDataFrame(format!(
                "invalid Reticulum destination for peer {identity_hex}: {error}"
            ))
        })
    }
}

impl EnsProvider for ReticulumEnsProvider {
    fn provider_id(&self) -> &str {
        &self.provider_id
    }

    fn local_endpoint(&self) -> Option<EnsEndpointAdvertisement> {
        Some(ReticulumEnsProvider::local_endpoint(self))
    }

    fn snapshot(&self) -> EnsProviderSnapshot {
        self.refresh_dynamic_udp_endpoint();
        self.refresh_interfaces();
        let health = match self.health.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        let peers = match self.peers.read() {
            Ok(guard) => guard.values().cloned().collect(),
            Err(poisoned) => poisoned.into_inner().values().cloned().collect(),
        };
        let interfaces = match self.interfaces.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };

        EnsProviderSnapshot {
            provider_id: self.provider_id.clone(),
            health,
            peers,
            interfaces,
        }
    }

    fn send_pairing_frame(&self, frame: EnsPairingFrame) -> Result<(), EnsProviderError> {
        let destinations = self.peer_destinations();
        if destinations.is_empty() {
            return Err(EnsProviderError::SendPairingFrame(
                "no discovered Reticulum destinations".to_string(),
            ));
        }
        for destination in destinations {
            self.outbound_tx
                .send(ReticulumOutboundFrame {
                    destination,
                    frame: ReticulumEnsWireFrame::Pairing(frame.clone()),
                })
                .map_err(|error| EnsProviderError::SendPairingFrame(error.to_string()))?;
        }
        Ok(())
    }

    fn send_data_frame(
        &self,
        peer: &super::dto::EnsPeerIdentity,
        frame: EnsDataFrame,
    ) -> Result<(), EnsProviderError> {
        let local_identity_hex = self.local_endpoint().identity_hex;
        let frame_identity_hex = frame.from_peer().identity_hex.as_str();
        if frame_identity_hex != local_identity_hex {
            return Err(EnsProviderError::SendDataFrame(format!(
                "Reticulum ENS provider refused to sign data frame from non-local peer {frame_identity_hex}"
            )));
        }
        let destination = self.peer_destination(&peer.identity_hex)?;
        let signed = self.sign_data_frame(peer, frame)?;
        self.outbound_tx
            .send(ReticulumOutboundFrame {
                destination,
                frame: ReticulumEnsWireFrame::Data(signed),
            })
            .map_err(|error| EnsProviderError::SendDataFrame(error.to_string()))
    }

    fn set_interface_topology(
        &self,
        name: &str,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsInterfaceSnapshot, EnsProviderError> {
        let manager = self.transport.interface_manager();
        let mut guard = manager.try_lock().map_err(|error| {
            EnsProviderError::SetInterfaceTopology(format!(
                "Reticulum interface manager is busy: {error}"
            ))
        })?;
        let manager_name = self.resolve_interface_manager_name(name);
        if !guard.set_topology(&manager_name, to_reticulum_topology(topology)) {
            return Err(EnsProviderError::InterfaceNotFound(name.to_string()));
        }
        drop(guard);
        self.refresh_interfaces();
        let public_name = self.public_interface_snapshot_name(&manager_name);
        self.snapshot()
            .interfaces
            .into_iter()
            .find(|interface| interface.name == public_name)
            .ok_or_else(|| EnsProviderError::InterfaceNotFound(name.to_string()))
    }

    fn drain_received_data_frames(&self) -> Vec<EnsReceivedDataFrame> {
        let mut frames = match self.received_data_frames.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        frames.drain(..).collect()
    }
}

fn to_reticulum_topology(topology: EnsInterfaceTopology) -> ReticulumInterfaceTopology {
    match topology {
        EnsInterfaceTopology::Off => ReticulumInterfaceTopology::Off,
        EnsInterfaceTopology::Passive => ReticulumInterfaceTopology::Passive,
        EnsInterfaceTopology::Active => ReticulumInterfaceTopology::Active,
    }
}

fn from_reticulum_topology(topology: ReticulumInterfaceTopology) -> EnsInterfaceTopology {
    match topology {
        ReticulumInterfaceTopology::Off => EnsInterfaceTopology::Off,
        ReticulumInterfaceTopology::Passive => EnsInterfaceTopology::Passive,
        ReticulumInterfaceTopology::Active => EnsInterfaceTopology::Active,
    }
}

fn udp_endpoint_address(bind_addr: &str, bound_port: u16) -> Option<String> {
    let socket_addr = bind_addr.parse::<SocketAddr>().ok()?;
    let port = if bound_port == 0 {
        socket_addr.port()
    } else {
        bound_port
    };
    if port == 0 {
        return None;
    }
    Some(format!("udp://{}:{port}", socket_addr.ip()))
}

fn udp_interface_name_from_host_port(host: &str, port: u16) -> Option<String> {
    if port == 0 {
        return None;
    }
    Some(format!("{host}:{port}"))
}

fn udp_endpoint_address_from_host_port(host: &str, port: u16) -> Option<String> {
    if port == 0 {
        return None;
    }
    Some(format!("udp://{host}:{port}"))
}

fn canonical_data_frame_bytes(
    frame: &EnsDataFrame,
    to_peer_identity_hex: &str,
) -> Result<Vec<u8>, EnsProviderError> {
    let mut canonical = Vec::new();
    canonical.extend_from_slice(RETICULUM_ENS_DATA_SIGNATURE_CONTEXT);
    canonical.push(0);
    canonical.extend_from_slice(to_peer_identity_hex.as_bytes());
    canonical.push(0);
    canonical.extend(
        serde_json::to_vec(frame)
            .map_err(|error| EnsProviderError::SendDataFrame(error.to_string()))?,
    );
    Ok(canonical)
}

fn verify_signed_data_frame(
    signed: ReticulumSignedEnsDataFrame,
    local_identity_hex: &str,
) -> Result<EnsReceivedDataFrame, String> {
    let claimed_peer = signed.frame.from_peer().clone();
    let identity_hex = claimed_peer.identity_hex.as_str();
    if !valid_reticulum_identity_hex(identity_hex) {
        return Err(format!(
            "invalid Reticulum ENS data frame identity: {identity_hex}"
        ));
    }
    if signed.to_peer_identity_hex != local_identity_hex {
        return Err(format!(
            "Reticulum ENS data frame was addressed to {}, not local peer {local_identity_hex}",
            signed.to_peer_identity_hex
        ));
    }
    if signed.signature.len() != RETICULUM_DATA_SIGNATURE_LEN {
        return Err(format!(
            "invalid Reticulum ENS data frame signature length: {}",
            signed.signature.len()
        ));
    }

    let identity = Identity::new_from_hex_string(identity_hex)
        .map_err(|error| format!("invalid Reticulum ENS data frame identity: {error}"))?;
    let signature_bytes: [u8; RETICULUM_DATA_SIGNATURE_LEN] = signed
        .signature
        .as_slice()
        .try_into()
        .map_err(|_| "invalid Reticulum ENS data frame signature bytes".to_string())?;
    let signature = Signature::from_bytes(&signature_bytes);
    let canonical = canonical_data_frame_bytes(&signed.frame, &signed.to_peer_identity_hex)
        .map_err(|error| error.to_string())?;
    identity
        .verify(canonical.as_slice(), &signature)
        .map_err(|error| {
            format!("Reticulum ENS data frame signature verification failed: {error}")
        })?;

    // Reticulum currently exposes the verified frame signer here rather than an
    // independent link-layer sender. A future Reticulum source-binding API can
    // add another observed peer check before this frame reaches the service.
    Ok(EnsReceivedDataFrame {
        transport_peer: Some(claimed_peer),
        frame: signed.frame,
    })
}

fn valid_reticulum_identity_hex(identity_hex: &str) -> bool {
    identity_hex.len() == RETICULUM_IDENTITY_HEX_LEN
        && identity_hex.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_local_registry(path: &Path) -> Result<ReticulumLocalRegistryFile, EnsProviderError> {
    if !path.exists() {
        return Ok(ReticulumLocalRegistryFile {
            version: LOCAL_REGISTRY_VERSION,
            entries: Vec::new(),
        });
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| EnsProviderError::Unavailable(error.to_string()))?;
    if raw.trim().is_empty() {
        return Ok(ReticulumLocalRegistryFile {
            version: LOCAL_REGISTRY_VERSION,
            entries: Vec::new(),
        });
    }
    serde_json::from_str::<ReticulumLocalRegistryFile>(&raw)
        .map_err(|error| EnsProviderError::Unavailable(error.to_string()))
}

fn write_local_registry(
    path: &Path,
    registry: &ReticulumLocalRegistryFile,
) -> Result<(), EnsProviderError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| EnsProviderError::Unavailable(error.to_string()))?;
    }
    let mut next = registry.clone();
    next.version = LOCAL_REGISTRY_VERSION;
    let json = serde_json::to_string_pretty(&next)
        .map_err(|error| EnsProviderError::Unavailable(error.to_string()))?;
    fs::write(path, json).map_err(|error| EnsProviderError::Unavailable(error.to_string()))
}
