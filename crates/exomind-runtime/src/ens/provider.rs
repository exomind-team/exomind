use thiserror::Error;

use super::data_protocol::{EnsDataFrame, EnsReceivedDataFrame};
use super::dto::{
    EnsEndpointAdvertisement, EnsInterfaceSnapshot, EnsInterfaceTopology, EnsPeerIdentity,
    EnsPeerSnapshot, EnsTransportHealth,
};
use super::pairing_protocol::EnsPairingFrame;
use super::reticulum_provider::ReticulumMdnsBootstrap;

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
    #[error("ENS provider failed to send data frame: {0}")]
    SendDataFrame(String),
    #[error("ENS provider interface was not found: {0}")]
    InterfaceNotFound(String),
    #[error("ENS provider failed to set interface topology: {0}")]
    SetInterfaceTopology(String),
}

pub trait EnsProvider: Send + Sync {
    fn provider_id(&self) -> &str;
    fn snapshot(&self) -> EnsProviderSnapshot;
    fn local_endpoint(&self) -> Option<EnsEndpointAdvertisement> {
        None
    }
    fn send_pairing_frame(&self, frame: EnsPairingFrame) -> Result<(), EnsProviderError>;
    fn drain_received_pairing_frames(&self) -> Vec<EnsPairingFrame> {
        Vec::new()
    }
    fn send_data_frame(
        &self,
        peer: &EnsPeerIdentity,
        frame: EnsDataFrame,
    ) -> Result<(), EnsProviderError>;
    fn set_interface_topology(
        &self,
        name: &str,
        topology: EnsInterfaceTopology,
    ) -> Result<EnsInterfaceSnapshot, EnsProviderError>;
    fn drain_received_data_frames(&self) -> Vec<EnsReceivedDataFrame> {
        Vec::new()
    }
    fn upsert_discovered_endpoint(
        &self,
        endpoint: EnsEndpointAdvertisement,
    ) -> Result<(), EnsProviderError> {
        let _ = endpoint;
        Ok(())
    }
    fn upsert_mdns_bootstrap(
        &self,
        bootstrap: ReticulumMdnsBootstrap,
    ) -> Result<(), EnsProviderError> {
        let _ = bootstrap;
        Ok(())
    }
}
