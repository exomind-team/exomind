use std::sync::{Mutex, RwLock};

use super::data_protocol::{EnsDataFrame, EnsReceivedDataFrame};
use super::dto::{
    EnsEndpointAdvertisement, EnsInterfaceSnapshot, EnsInterfaceTopology, EnsPeerIdentity,
    EnsPeerSnapshot, EnsTransportHealth, EnsTransportHealthStatus,
};
use super::pairing_protocol::EnsPairingFrame;
use super::provider::{EnsProvider, EnsProviderError, EnsProviderSnapshot};
use super::reticulum_provider::{
    ReticulumMdnsBootstrap, can_refresh_mdns_bootstrap_peer, endpoint_from_mdns_bootstrap,
};

#[derive(Debug, Clone)]
pub struct FakeEnsSentDataFrame {
    pub peer: EnsPeerIdentity,
    pub frame: EnsDataFrame,
}

pub struct FakeEnsProvider {
    provider_id: String,
    health: RwLock<EnsTransportHealth>,
    peers: RwLock<Vec<EnsPeerSnapshot>>,
    interfaces: RwLock<Vec<EnsInterfaceSnapshot>>,
    sent_frames: Mutex<Vec<EnsPairingFrame>>,
    sent_data_frames: Mutex<Vec<FakeEnsSentDataFrame>>,
    received_data_frames: Mutex<Vec<EnsReceivedDataFrame>>,
    fail_next_send: Mutex<Option<String>>,
}

impl FakeEnsProvider {
    pub fn new() -> Self {
        Self {
            provider_id: "fake-ens".to_string(),
            health: RwLock::new(EnsTransportHealth::healthy()),
            peers: RwLock::new(Vec::new()),
            interfaces: RwLock::new(Vec::new()),
            sent_frames: Mutex::new(Vec::new()),
            sent_data_frames: Mutex::new(Vec::new()),
            received_data_frames: Mutex::new(Vec::new()),
            fail_next_send: Mutex::new(None),
        }
    }

    pub fn sent_frames(&self) -> Vec<EnsPairingFrame> {
        match self.sent_frames.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub fn sent_data_frames(&self) -> Vec<FakeEnsSentDataFrame> {
        match self.sent_data_frames.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    pub fn push_received_data_frame(
        &self,
        transport_peer: Option<EnsPeerIdentity>,
        frame: EnsDataFrame,
    ) {
        let mut frames = match self.received_data_frames.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        frames.push(EnsReceivedDataFrame {
            transport_peer,
            frame,
        });
    }

    pub fn set_fail_next_send(&self, message: impl Into<String>) {
        let mut guard = match self.fail_next_send.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(message.into());
    }

    fn take_next_failure(&self) -> Option<String> {
        let mut guard = match self.fail_next_send.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.take()
    }

    pub fn set_health(&self, health: EnsTransportHealth) {
        let mut guard = match self.health.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = health;
    }

    pub fn set_degraded(&self, message: impl Into<String>) {
        self.set_health(EnsTransportHealth {
            status: EnsTransportHealthStatus::Degraded,
            message: Some(message.into()),
        });
    }

    pub fn set_peers(&self, peers: Vec<EnsPeerSnapshot>) {
        let mut guard = match self.peers.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = peers;
    }

    pub fn set_interfaces(&self, interfaces: Vec<EnsInterfaceSnapshot>) {
        let mut guard = match self.interfaces.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = interfaces;
    }
}

impl Default for FakeEnsProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl EnsProvider for FakeEnsProvider {
    fn provider_id(&self) -> &str {
        &self.provider_id
    }

    fn snapshot(&self) -> EnsProviderSnapshot {
        let health = match self.health.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        let peers = match self.peers.read() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
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
        if let Some(message) = self.take_next_failure() {
            return Err(EnsProviderError::SendPairingFrame(message));
        }

        let mut frames = match self.sent_frames.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        frames.push(frame);
        Ok(())
    }

    fn send_data_frame(
        &self,
        peer: &EnsPeerIdentity,
        frame: EnsDataFrame,
    ) -> Result<(), EnsProviderError> {
        if let Some(message) = self.take_next_failure() {
            return Err(EnsProviderError::SendDataFrame(message));
        }

        let mut frames = match self.sent_data_frames.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        frames.push(FakeEnsSentDataFrame {
            peer: peer.clone(),
            frame,
        });
        Ok(())
    }

    fn set_interface_topology(
        &self,
        name: &str,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsInterfaceSnapshot, EnsProviderError> {
        let mut interfaces = match self.interfaces.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let Some(interface) = interfaces
            .iter_mut()
            .find(|interface| interface.name == name)
        else {
            return Err(EnsProviderError::InterfaceNotFound(name.to_string()));
        };

        interface.topology = topology;
        interface.effective_topology = topology;
        Ok(interface.clone())
    }

    fn drain_received_data_frames(&self) -> Vec<EnsReceivedDataFrame> {
        let mut frames = match self.received_data_frames.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        frames.drain(..).collect()
    }

    fn upsert_discovered_endpoint(
        &self,
        endpoint: EnsEndpointAdvertisement,
    ) -> Result<(), EnsProviderError> {
        let identity = endpoint.identity();
        let mut peers = match self.peers.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let peer = EnsPeerSnapshot {
            identity,
            endpoint: Some(endpoint),
            authorized: false,
            pairing_pending: false,
            last_error: None,
        };
        if let Some(existing) = peers
            .iter_mut()
            .find(|existing| existing.identity.identity_hex == peer.identity.identity_hex)
        {
            *existing = peer;
        } else {
            peers.push(peer);
        }
        Ok(())
    }

    fn upsert_mdns_bootstrap(
        &self,
        bootstrap: ReticulumMdnsBootstrap,
    ) -> Result<(), EnsProviderError> {
        let endpoint = endpoint_from_mdns_bootstrap(bootstrap)?;
        let identity = endpoint.identity();
        let mut peers = match self.peers.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let peer = EnsPeerSnapshot {
            identity,
            endpoint: Some(endpoint),
            authorized: false,
            pairing_pending: false,
            last_error: None,
        };
        if let Some(existing) = peers
            .iter_mut()
            .find(|existing| existing.identity.identity_hex == peer.identity.identity_hex)
        {
            if can_refresh_mdns_bootstrap_peer(existing) {
                *existing = peer;
            }
        } else {
            peers.push(peer);
        }
        Ok(())
    }
}
