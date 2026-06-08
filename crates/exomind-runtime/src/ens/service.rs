use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use thiserror::Error;
use uuid::Uuid;

use crate::mesh::{MeshState, PeerInfo, PeerStatus};
use crate::pairing::{PairingError, PairingManager};
use crate::signal::SignalEvent;

use super::data_protocol::{EnsDataFrame, EnsReceivedDataFrame, EnsSignalEventFrame};
use super::dto::{
    EnsCommandAck, EnsEndpointAdvertisement, EnsInterfaceSnapshot, EnsInterfaceTopology,
    EnsOperationKind, EnsOperationSnapshot, EnsOperationStatus, EnsPairingOfferTicket,
    EnsPeerIdentity, EnsPeerSnapshot, EnsTransportHealth, EnsTransportSnapshot,
};
use super::fake_provider::FakeEnsProvider;
use super::pairing_protocol::{
    EnsPairingCancel, EnsPairingComplete, EnsPairingFrame, EnsPairingOffer, EnsPairingResponse,
};
use super::provider::{EnsProvider, EnsProviderError};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EnsTransportError {
    #[error("ENS transport is not configured")]
    NotConfigured,
    #[error("ENS transport is shut down")]
    ShutDown,
    #[error("ENS pairing session was not found or expired")]
    PairingSessionNotFound,
    #[error("ENS pairing operation was cancelled")]
    PairingOperationCancelled,
    #[error("ENS pairing operation was not found")]
    PairingOperationNotFound,
    #[error("ENS pairing PIN was incorrect")]
    IncorrectPin,
    #[error("ENS local endpoint is not configured")]
    MissingLocalEndpoint,
    #[error("ENS endpoint is missing runtime_base_url")]
    MissingRuntimeEndpoint,
    #[error("ENS discovered peer was not found: {0}")]
    DiscoveredPeerNotFound(String),
    #[error("ENS discovered peer is missing endpoint: {0}")]
    DiscoveredPeerMissingEndpoint(String),
    #[error("ENS data frame peer is not authorized: {0}")]
    UnauthorizedDataFramePeer(String),
    #[error("ENS data frame is missing transport peer for claimed peer: {0}")]
    MissingDataFrameTransportPeer(String),
    #[error("ENS data frame transport peer mismatch: claimed {claimed}, observed {observed}")]
    DataFrameTransportPeerMismatch { claimed: String, observed: String },
    #[error("{0}")]
    Provider(#[from] EnsProviderError),
}

#[derive(Debug)]
struct EnsTransportState {
    enabled: bool,
    shutdown: bool,
    global_topology: EnsInterfaceTopology,
    health: EnsTransportHealth,
    peers: HashMap<String, EnsPeerSnapshot>,
    operations: HashMap<String, EnsOperationSnapshot>,
    pending_offers: HashMap<String, EnsPairingOffer>,
    pending_responder_inbound_secrets: HashMap<String, String>,
}

impl EnsTransportState {
    fn disabled() -> Self {
        Self {
            enabled: false,
            shutdown: false,
            global_topology: EnsInterfaceTopology::Off,
            health: EnsTransportHealth::disabled("ENS transport provider is not configured"),
            peers: HashMap::new(),
            operations: HashMap::new(),
            pending_offers: HashMap::new(),
            pending_responder_inbound_secrets: HashMap::new(),
        }
    }

    fn enabled() -> Self {
        Self {
            enabled: true,
            shutdown: false,
            global_topology: EnsInterfaceTopology::Active,
            health: EnsTransportHealth::healthy(),
            peers: HashMap::new(),
            operations: HashMap::new(),
            pending_offers: HashMap::new(),
            pending_responder_inbound_secrets: HashMap::new(),
        }
    }
}

pub struct EnsTransportService {
    host_id: String,
    local_endpoint: Option<EnsEndpointAdvertisement>,
    mesh: Option<Arc<MeshState>>,
    pairing: Option<Arc<PairingManager>>,
    provider: Arc<dyn EnsProvider>,
    state: RwLock<EnsTransportState>,
}

impl EnsTransportService {
    pub fn disabled() -> Self {
        Self {
            host_id: String::new(),
            local_endpoint: None,
            mesh: None,
            pairing: None,
            provider: Arc::new(FakeEnsProvider::new()),
            state: RwLock::new(EnsTransportState::disabled()),
        }
    }

    pub fn new_fake(
        host_id: String,
        mesh: Arc<MeshState>,
        pairing: Arc<PairingManager>,
    ) -> (Self, Arc<FakeEnsProvider>) {
        let provider = Arc::new(FakeEnsProvider::new());
        (
            Self::new(host_id, mesh, pairing, provider.clone()),
            provider,
        )
    }

    pub fn new_fake_with_endpoint(
        host_id: String,
        mesh: Arc<MeshState>,
        pairing: Arc<PairingManager>,
        local_endpoint: EnsEndpointAdvertisement,
    ) -> (Self, Arc<FakeEnsProvider>) {
        let provider = Arc::new(FakeEnsProvider::new());
        (
            Self::new_with_endpoint(
                host_id,
                mesh,
                pairing,
                provider.clone(),
                Some(local_endpoint),
            ),
            provider,
        )
    }

    pub fn new(
        host_id: String,
        mesh: Arc<MeshState>,
        pairing: Arc<PairingManager>,
        provider: Arc<dyn EnsProvider>,
    ) -> Self {
        Self::new_with_endpoint(host_id, mesh, pairing, provider, None)
    }

    pub fn new_with_endpoint(
        host_id: String,
        mesh: Arc<MeshState>,
        pairing: Arc<PairingManager>,
        provider: Arc<dyn EnsProvider>,
        local_endpoint: Option<EnsEndpointAdvertisement>,
    ) -> Self {
        Self {
            host_id,
            local_endpoint,
            mesh: Some(mesh),
            pairing: Some(pairing),
            provider,
            state: RwLock::new(EnsTransportState::enabled()),
        }
    }

    pub fn snapshot(&self) -> EnsTransportSnapshot {
        let provider_snapshot = self.provider.snapshot();
        let state = match self.state.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut peers = provider_snapshot
            .peers
            .into_iter()
            .map(|peer| (peer.identity.identity_hex.clone(), peer))
            .collect::<HashMap<_, _>>();
        for peer in state.peers.values() {
            peers.insert(peer.identity.identity_hex.clone(), peer.clone());
        }

        let mut peers = peers.into_values().collect::<Vec<_>>();
        peers.sort_by(|left, right| left.identity.identity_hex.cmp(&right.identity.identity_hex));

        let mut operations = state.operations.values().cloned().collect::<Vec<_>>();
        operations.sort_by(|left, right| left.id.cmp(&right.id));

        let global_topology = state.global_topology;
        let interfaces = provider_snapshot
            .interfaces
            .into_iter()
            .map(|mut interface| {
                interface.effective_topology = std::cmp::min(global_topology, interface.topology);
                interface
            })
            .collect();
        let local_endpoint = self.current_local_endpoint();

        EnsTransportSnapshot {
            enabled: state.enabled && !state.shutdown,
            provider_id: provider_snapshot.provider_id,
            local_endpoint,
            global_topology,
            health: if state.enabled {
                provider_snapshot.health
            } else {
                state.health.clone()
            },
            peers,
            interfaces,
            operations,
            updated_at: now_rfc3339(),
        }
    }

    pub fn set_interface_topology(
        &self,
        name: &str,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsInterfaceSnapshot, EnsTransportError> {
        self.ensure_ready()?;
        let updated = self.provider.set_interface_topology(name, topology)?;
        let public_name = updated.name.clone();
        self.snapshot()
            .interfaces
            .into_iter()
            .find(|interface| interface.name == public_name)
            .or(Some(updated))
            .ok_or_else(|| {
                EnsTransportError::Provider(EnsProviderError::InterfaceNotFound(name.to_string()))
            })
    }

    pub fn set_global_topology(
        &self,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsTransportSnapshot, EnsTransportError> {
        self.ensure_ready()?;
        {
            let mut state = self.write_state();
            state.global_topology = topology;
        }
        Ok(self.snapshot())
    }

    pub fn set_global_interface_topology(
        &self,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsTransportSnapshot, EnsTransportError> {
        self.set_global_topology(topology)
    }

    pub fn initiate_pairing_offer(
        &self,
        remote: EnsEndpointAdvertisement,
    ) -> Result<EnsPairingOfferTicket, EnsTransportError> {
        self.ensure_ready()?;
        let pairing = self
            .pairing
            .as_ref()
            .ok_or(EnsTransportError::NotConfigured)?;
        let session = pairing.initiate(self.host_id.clone());
        let operation_id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let remote_identity = remote.identity();

        {
            let mut state = self.write_state();
            state.peers.insert(
                remote.identity_hex.clone(),
                EnsPeerSnapshot {
                    identity: remote_identity.clone(),
                    endpoint: Some(remote.clone()),
                    authorized: false,
                    pairing_pending: true,
                    last_error: None,
                },
            );
            state.operations.insert(
                operation_id.clone(),
                EnsOperationSnapshot {
                    id: operation_id.clone(),
                    kind: EnsOperationKind::PairingOffer,
                    status: EnsOperationStatus::Pending,
                    peer_identity: Some(remote_identity.clone()),
                    session_id: Some(session.session_id.clone()),
                    error: None,
                    updated_at: now.clone(),
                },
            );
        }

        let frame = EnsPairingFrame::PairingOffer(EnsPairingOffer {
            operation_id: operation_id.clone(),
            session_id: session.session_id.clone(),
            initiator: self.local_identity(),
            initiator_endpoint: self.current_local_endpoint(),
        });

        if let Err(error) = self.provider.send_pairing_frame(frame) {
            self.mark_operation_failed(
                &operation_id,
                error.to_string(),
                Some(&remote.identity_hex),
            );
            return Err(error.into());
        }

        Ok(EnsPairingOfferTicket {
            operation_id,
            session_id: session.session_id,
            pin: session.pin,
            status: EnsOperationStatus::Pending,
        })
    }

    pub fn initiate_pairing_with_discovered_peer(
        &self,
        identity_hex: &str,
    ) -> Result<EnsPairingOfferTicket, EnsTransportError> {
        self.ensure_ready()?;
        let provider_snapshot = self.provider.snapshot();
        let peer = provider_snapshot
            .peers
            .iter()
            .find(|peer| peer.identity.identity_hex == identity_hex)
            .ok_or_else(|| EnsTransportError::DiscoveredPeerNotFound(identity_hex.to_string()))?;
        let endpoint = peer.endpoint.clone().ok_or_else(|| {
            EnsTransportError::DiscoveredPeerMissingEndpoint(identity_hex.to_string())
        })?;

        self.initiate_pairing_offer(endpoint)
    }

    pub fn send_signal_event_to_peer(
        &self,
        peer_identity_hex: &str,
        event: SignalEvent,
    ) -> Result<bool, EnsTransportError> {
        self.ensure_ready()?;
        let mesh = self.mesh.as_ref().ok_or(EnsTransportError::NotConfigured)?;
        let peer = self.authorized_mesh_peer(peer_identity_hex)?;
        if !mesh.should_stream_event_to_peer(&peer.id, &event) {
            return Ok(false);
        }

        let from_peer = self
            .current_local_endpoint()
            .ok_or(EnsTransportError::MissingLocalEndpoint)?
            .identity();
        let target = mesh_peer_identity(&peer);
        let frame = EnsDataFrame::SignalEvent(EnsSignalEventFrame {
            frame_id: Uuid::new_v4().to_string(),
            from_peer,
            scope_hint: signal_scope_hint(&event),
            event,
        });
        self.provider.send_data_frame(&target, frame)?;
        Ok(true)
    }

    pub async fn handle_data_frame(&self, frame: EnsDataFrame) -> Result<bool, EnsTransportError> {
        self.handle_received_data_frame(EnsReceivedDataFrame {
            transport_peer: None,
            frame,
        })
        .await
    }

    pub async fn handle_received_data_frame(
        &self,
        received: EnsReceivedDataFrame,
    ) -> Result<bool, EnsTransportError> {
        self.ensure_ready()?;
        match received.frame {
            EnsDataFrame::SignalEvent(frame) => {
                self.handle_signal_event_frame(received.transport_peer, frame)
                    .await
            }
        }
    }

    pub async fn handle_pending_data_frames(&self) -> Result<Vec<bool>, EnsTransportError> {
        self.ensure_ready()?;
        let frames = self.provider.drain_received_data_frames();
        let mut results = Vec::with_capacity(frames.len());
        let mut first_error = None;
        for frame in frames {
            match self.handle_received_data_frame(frame).await {
                Ok(result) => results.push(result),
                Err(error) => {
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            }
        }

        if let Some(error) = first_error {
            return Err(error);
        }

        Ok(results)
    }

    async fn handle_signal_event_frame(
        &self,
        transport_peer: Option<EnsPeerIdentity>,
        frame: EnsSignalEventFrame,
    ) -> Result<bool, EnsTransportError> {
        let mesh = self.mesh.as_ref().ok_or(EnsTransportError::NotConfigured)?;
        let transport_peer =
            self.ensure_data_frame_transport_peer(transport_peer, &frame.from_peer)?;
        self.authorized_mesh_peer(&transport_peer.identity_hex)?;

        match mesh
            .ingest_remote_event(&transport_peer.identity_hex, frame.event)
            .await
        {
            Ok(accepted) => Ok(accepted),
            Err(never) => match never {},
        }
    }

    pub fn handle_pairing_response(
        &self,
        response: EnsPairingResponse,
    ) -> Result<EnsCommandAck, EnsTransportError> {
        self.ensure_ready()?;
        let mesh = self.mesh.as_ref().ok_or(EnsTransportError::NotConfigured)?;
        let pairing = self
            .pairing
            .as_ref()
            .ok_or(EnsTransportError::NotConfigured)?;
        let responder_peer_id = response.responder.identity_hex.clone();
        if self.operation_is_cancelled(&response.operation_id) {
            return Err(EnsTransportError::PairingOperationCancelled);
        }
        let responder_host_id = response
            .responder
            .host_id
            .clone()
            .unwrap_or_else(|| responder_peer_id.clone());

        pairing
            .respond(&response.session_id, &response.pin, &responder_host_id)
            .map_err(|error| {
                let mapped = match error {
                    PairingError::SessionNotFound => EnsTransportError::PairingSessionNotFound,
                    PairingError::IncorrectPin => EnsTransportError::IncorrectPin,
                };
                self.mark_operation_failed(
                    &response.operation_id,
                    mapped.to_string(),
                    Some(&responder_peer_id),
                );
                mapped
            })?;

        let base_url = response
            .responder_endpoint
            .runtime_base_url
            .clone()
            .ok_or_else(|| {
                self.mark_operation_failed(
                    &response.operation_id,
                    EnsTransportError::MissingRuntimeEndpoint.to_string(),
                    Some(&responder_peer_id),
                );
                EnsTransportError::MissingRuntimeEndpoint
            })?;

        let now = now_rfc3339();
        let initiator_inbound_secret = Uuid::new_v4().to_string();
        let mut capabilities = response.responder_endpoint.capabilities.clone();
        if !capabilities
            .iter()
            .any(|capability| capability == "ens-control")
        {
            capabilities.push("ens-control".to_string());
        }
        if let Some(host_id) = &response.responder.host_id {
            capabilities.push(format!("host_id:{host_id}"));
        }

        let frame = EnsPairingFrame::PairingComplete(EnsPairingComplete {
            operation_id: response.operation_id.clone(),
            session_id: response.session_id.clone(),
            initiator: self.local_identity(),
            initiator_endpoint: self.current_local_endpoint(),
            initiator_inbound_secret: initiator_inbound_secret.clone(),
        });
        if let Err(error) = self.provider.send_pairing_frame(frame) {
            self.mark_operation_failed(
                &response.operation_id,
                error.to_string(),
                Some(&responder_peer_id),
            );
            return Err(error.into());
        }

        mesh.upsert_peer(PeerInfo {
            id: responder_peer_id.clone(),
            base_url,
            enabled: true,
            capabilities,
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: now.clone(),
            updated_at: now,
            auth_token: response.responder_inbound_secret.clone(),
            inbound_secret: Some(initiator_inbound_secret.clone()),
        });

        {
            let mut state = self.write_state();
            state.peers.insert(
                responder_peer_id.clone(),
                EnsPeerSnapshot {
                    identity: response.responder.clone(),
                    endpoint: Some(response.responder_endpoint.clone()),
                    authorized: true,
                    pairing_pending: false,
                    last_error: None,
                },
            );
            state.operations.insert(
                response.operation_id.clone(),
                EnsOperationSnapshot {
                    id: response.operation_id.clone(),
                    kind: EnsOperationKind::PairingResponse,
                    status: EnsOperationStatus::Completed,
                    peer_identity: Some(response.responder),
                    session_id: Some(response.session_id),
                    error: None,
                    updated_at: now_rfc3339(),
                },
            );
        }

        Ok(EnsCommandAck {
            operation_id: response.operation_id,
            status: EnsOperationStatus::Completed,
        })
    }

    pub fn handle_pairing_offer(
        &self,
        offer: EnsPairingOffer,
    ) -> Result<EnsCommandAck, EnsTransportError> {
        self.ensure_ready()?;
        let operation_id = offer.operation_id.clone();
        let initiator_peer_id = offer.initiator.identity_hex.clone();
        let now = now_rfc3339();

        {
            let mut state = self.write_state();
            state.peers.insert(
                initiator_peer_id.clone(),
                EnsPeerSnapshot {
                    identity: offer.initiator.clone(),
                    endpoint: offer.initiator_endpoint.clone(),
                    authorized: false,
                    pairing_pending: true,
                    last_error: None,
                },
            );
            state.operations.insert(
                offer.operation_id.clone(),
                EnsOperationSnapshot {
                    id: offer.operation_id.clone(),
                    kind: EnsOperationKind::PairingOffer,
                    status: EnsOperationStatus::Pending,
                    peer_identity: Some(offer.initiator.clone()),
                    session_id: Some(offer.session_id.clone()),
                    error: None,
                    updated_at: now,
                },
            );
            state
                .pending_offers
                .insert(offer.operation_id.clone(), offer);
        }

        Ok(EnsCommandAck {
            operation_id,
            status: EnsOperationStatus::Pending,
        })
    }

    pub fn accept_pairing_offer(
        &self,
        operation_id: &str,
        pin: String,
    ) -> Result<EnsCommandAck, EnsTransportError> {
        self.ensure_ready()?;
        let local_endpoint = self
            .current_local_endpoint()
            .ok_or(EnsTransportError::MissingLocalEndpoint)?;
        let offer = self
            .pending_offer(operation_id)
            .ok_or(EnsTransportError::PairingOperationNotFound)?;
        let responder_inbound_secret = Uuid::new_v4().to_string();

        let frame = EnsPairingFrame::PairingResponse(EnsPairingResponse {
            operation_id: offer.operation_id.clone(),
            session_id: offer.session_id.clone(),
            responder: local_endpoint.identity(),
            responder_endpoint: local_endpoint,
            pin,
            responder_inbound_secret: Some(responder_inbound_secret.clone()),
        });

        if let Err(error) = self.provider.send_pairing_frame(frame) {
            self.mark_operation_failed(
                &offer.operation_id,
                error.to_string(),
                Some(&offer.initiator.identity_hex),
            );
            return Err(error.into());
        }

        {
            let mut state = self.write_state();
            state.operations.insert(
                offer.operation_id.clone(),
                EnsOperationSnapshot {
                    id: offer.operation_id.clone(),
                    kind: EnsOperationKind::PairingResponse,
                    status: EnsOperationStatus::Pending,
                    peer_identity: Some(offer.initiator.clone()),
                    session_id: Some(offer.session_id.clone()),
                    error: None,
                    updated_at: now_rfc3339(),
                },
            );
            state
                .pending_responder_inbound_secrets
                .insert(offer.operation_id.clone(), responder_inbound_secret);
        }

        Ok(EnsCommandAck {
            operation_id: offer.operation_id,
            status: EnsOperationStatus::Pending,
        })
    }

    pub fn handle_pairing_complete(
        &self,
        complete: EnsPairingComplete,
    ) -> Result<EnsCommandAck, EnsTransportError> {
        self.ensure_ready()?;
        let mesh = self.mesh.as_ref().ok_or(EnsTransportError::NotConfigured)?;
        let initiator_peer_id = complete.initiator.identity_hex.clone();
        let base_url = complete
            .initiator_endpoint
            .as_ref()
            .and_then(|endpoint| endpoint.runtime_base_url.clone())
            .ok_or_else(|| {
                self.mark_operation_failed(
                    &complete.operation_id,
                    EnsTransportError::MissingRuntimeEndpoint.to_string(),
                    Some(&initiator_peer_id),
                );
                EnsTransportError::MissingRuntimeEndpoint
            })?;
        let responder_inbound_secret = self
            .take_pending_responder_inbound_secret(&complete.operation_id)
            .ok_or(EnsTransportError::PairingOperationNotFound)?;
        let mut capabilities = match complete.initiator_endpoint.as_ref() {
            Some(endpoint) => endpoint.capabilities.clone(),
            None => Vec::new(),
        };
        if !capabilities
            .iter()
            .any(|capability| capability == "ens-control")
        {
            capabilities.push("ens-control".to_string());
        }
        if let Some(host_id) = &complete.initiator.host_id {
            capabilities.push(format!("host_id:{host_id}"));
        }

        let now = now_rfc3339();
        mesh.upsert_peer(PeerInfo {
            id: initiator_peer_id.clone(),
            base_url,
            enabled: true,
            capabilities,
            status: PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: now.clone(),
            updated_at: now,
            auth_token: Some(complete.initiator_inbound_secret.clone()),
            inbound_secret: Some(responder_inbound_secret),
        });

        {
            let mut state = self.write_state();
            state.pending_offers.remove(&complete.operation_id);
            state.peers.insert(
                initiator_peer_id.clone(),
                EnsPeerSnapshot {
                    identity: complete.initiator.clone(),
                    endpoint: complete.initiator_endpoint.clone(),
                    authorized: true,
                    pairing_pending: false,
                    last_error: None,
                },
            );
            state.operations.insert(
                complete.operation_id.clone(),
                EnsOperationSnapshot {
                    id: complete.operation_id.clone(),
                    kind: EnsOperationKind::PairingComplete,
                    status: EnsOperationStatus::Completed,
                    peer_identity: Some(complete.initiator),
                    session_id: Some(complete.session_id),
                    error: None,
                    updated_at: now_rfc3339(),
                },
            );
        }

        Ok(EnsCommandAck {
            operation_id: complete.operation_id,
            status: EnsOperationStatus::Completed,
        })
    }

    pub fn handle_pairing_cancel(
        &self,
        cancel: EnsPairingCancel,
    ) -> Result<EnsCommandAck, EnsTransportError> {
        self.ensure_ready()?;
        let pairing = self
            .pairing
            .as_ref()
            .ok_or(EnsTransportError::NotConfigured)?;
        pairing.cancel(&cancel.session_id);

        let peer_id = cancel.peer.identity_hex.clone();
        {
            let mut state = self.write_state();
            if let Some(peer) = state.peers.get_mut(&peer_id) {
                peer.pairing_pending = false;
                peer.last_error = Some(cancel.reason.clone());
            }
            state.operations.insert(
                cancel.operation_id.clone(),
                EnsOperationSnapshot {
                    id: cancel.operation_id.clone(),
                    kind: EnsOperationKind::PairingCancel,
                    status: EnsOperationStatus::Cancelled,
                    peer_identity: Some(cancel.peer),
                    session_id: Some(cancel.session_id),
                    error: Some(cancel.reason),
                    updated_at: now_rfc3339(),
                },
            );
        }

        Ok(EnsCommandAck {
            operation_id: cancel.operation_id,
            status: EnsOperationStatus::Cancelled,
        })
    }

    pub fn shutdown(&self) {
        let mut state = self.write_state();
        state.enabled = false;
        state.shutdown = true;
        state.health = EnsTransportHealth::disabled("ENS transport was shut down");
    }

    fn ensure_ready(&self) -> Result<(), EnsTransportError> {
        let state = match self.state.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if state.shutdown {
            return Err(EnsTransportError::ShutDown);
        }
        if !state.enabled {
            return Err(EnsTransportError::NotConfigured);
        }
        Ok(())
    }

    fn operation_is_cancelled(&self, operation_id: &str) -> bool {
        let state = match self.state.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        state
            .operations
            .get(operation_id)
            .map(|operation| operation.status == EnsOperationStatus::Cancelled)
            .unwrap_or(false)
    }

    fn current_local_endpoint(&self) -> Option<EnsEndpointAdvertisement> {
        self.provider
            .local_endpoint()
            .or_else(|| self.local_endpoint.clone())
    }

    fn local_identity(&self) -> EnsPeerIdentity {
        match self.current_local_endpoint().as_ref() {
            Some(endpoint) => endpoint.identity(),
            None => EnsPeerIdentity::new(self.host_id.clone()).with_host_id(self.host_id.clone()),
        }
    }

    fn pending_offer(&self, operation_id: &str) -> Option<EnsPairingOffer> {
        let state = match self.state.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.pending_offers.get(operation_id).cloned()
    }

    fn take_pending_responder_inbound_secret(&self, operation_id: &str) -> Option<String> {
        let mut state = self.write_state();
        state.pending_responder_inbound_secrets.remove(operation_id)
    }

    fn authorized_mesh_peer(&self, peer_identity_hex: &str) -> Result<PeerInfo, EnsTransportError> {
        let mesh = self.mesh.as_ref().ok_or(EnsTransportError::NotConfigured)?;
        mesh.get_peer(peer_identity_hex)
            .filter(|peer| peer.enabled)
            .ok_or_else(|| {
                EnsTransportError::UnauthorizedDataFramePeer(peer_identity_hex.to_string())
            })
    }

    fn ensure_data_frame_transport_peer(
        &self,
        transport_peer: Option<EnsPeerIdentity>,
        claimed_peer: &EnsPeerIdentity,
    ) -> Result<EnsPeerIdentity, EnsTransportError> {
        let Some(transport_peer) = transport_peer else {
            return Err(EnsTransportError::MissingDataFrameTransportPeer(
                claimed_peer.identity_hex.clone(),
            ));
        };
        if transport_peer.identity_hex != claimed_peer.identity_hex {
            return Err(EnsTransportError::DataFrameTransportPeerMismatch {
                claimed: claimed_peer.identity_hex.clone(),
                observed: transport_peer.identity_hex,
            });
        }
        Ok(transport_peer)
    }

    fn mark_operation_failed(&self, operation_id: &str, error: String, peer_id: Option<&str>) {
        let now = now_rfc3339();
        let mut state = self.write_state();
        if let Some(peer_id) = peer_id {
            if let Some(peer) = state.peers.get_mut(peer_id) {
                peer.pairing_pending = false;
                peer.last_error = Some(error.clone());
            }
        }
        if let Some(operation) = state.operations.get_mut(operation_id) {
            operation.status = EnsOperationStatus::Failed;
            operation.error = Some(error);
            operation.updated_at = now;
        }
    }

    fn write_state(&self) -> std::sync::RwLockWriteGuard<'_, EnsTransportState> {
        match self.state.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn mesh_peer_identity(peer: &PeerInfo) -> EnsPeerIdentity {
    let mut identity = EnsPeerIdentity::new(peer.id.clone());
    if let Some(host_id) = peer
        .capabilities
        .iter()
        .find_map(|capability| capability.strip_prefix("host_id:"))
    {
        identity = identity.with_host_id(host_id.to_string());
    }
    identity
}

fn signal_scope_hint(event: &SignalEvent) -> Option<String> {
    event
        .payload
        .get("scopeKey")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}
