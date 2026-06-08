use std::sync::{Mutex, RwLock};

use super::data_protocol::EnsDataFrame;
use super::dto::{
    EnsInterfaceSnapshot, EnsInterfaceTopology, EnsPeerIdentity, EnsPeerSnapshot,
    EnsTransportHealth, EnsTransportHealthStatus,
};
use super::pairing_protocol::EnsPairingFrame;
use super::provider::{EnsProvider, EnsProviderError, EnsProviderSnapshot};

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
}
