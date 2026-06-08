use thiserror::Error;

use super::dto::{EnsInterfaceSnapshot, EnsInterfaceTopology, EnsPeerSnapshot, EnsTransportHealth};
use super::pairing_protocol::EnsPairingFrame;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsProviderSnapshot {
    pub provider_id: String,
    pub health: EnsTransportHealth,
    pub peers: Vec<EnsPeerSnapshot>,
    pub interfaces: Vec<EnsInterfaceSnapshot>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EnsProviderError {
    #[error("ENS provider unavailable: {0}")]
    Unavailable(String),
    #[error("ENS provider failed to send pairing frame: {0}")]
    SendPairingFrame(String),
    #[error("ENS provider interface was not found: {0}")]
    InterfaceNotFound(String),
    #[error("ENS provider failed to set interface topology: {0}")]
    SetInterfaceTopology(String),
}

pub trait EnsProvider: Send + Sync {
    fn provider_id(&self) -> &str;
    fn snapshot(&self) -> EnsProviderSnapshot;
    fn send_pairing_frame(&self, frame: EnsPairingFrame) -> Result<(), EnsProviderError>;
    fn set_interface_topology(
        &self,
        name: &str,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsInterfaceSnapshot, EnsProviderError>;
}
