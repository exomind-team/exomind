use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPeerIdentity {
    pub identity_hex: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

impl EnsPeerIdentity {
    pub fn new(identity_hex: impl Into<String>) -> Self {
        Self {
            identity_hex: identity_hex.into(),
            host_id: None,
            display_name: None,
        }
    }

    pub fn with_host_id(mut self, host_id: impl Into<String>) -> Self {
        self.host_id = Some(host_id.into());
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsGatewayKind {
    Reticulum,
}

impl Default for EnsGatewayKind {
    fn default() -> Self {
        Self::Reticulum
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsInterfaceMedium {
    Udp,
    Tcp,
    Mdns,
    Bluetooth,
    File,
    Jsonl,
    Queue,
    LocalDev,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsEndpointAdvertisement {
    pub identity_hex: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
    #[serde(default)]
    pub gateway: EnsGatewayKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub via_interface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub via_medium: Option<EnsInterfaceMedium>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reticulum_destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_address: Option<String>,
    pub discovery_source: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

impl EnsEndpointAdvertisement {
    pub fn identity(&self) -> EnsPeerIdentity {
        EnsPeerIdentity {
            identity_hex: self.identity_hex.clone(),
            host_id: self.host_id.clone(),
            display_name: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsInterfaceTopology {
    Off,
    Passive,
    Active,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsInterfaceSnapshot {
    pub name: String,
    #[serde(rename = "type")]
    pub interface_type: String,
    pub online: bool,
    pub outgoing: bool,
    pub topology: EnsInterfaceTopology,
    pub effective_topology: EnsInterfaceTopology,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsTransportHealthStatus {
    Disabled,
    Healthy,
    Degraded,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsTransportHealth {
    pub status: EnsTransportHealthStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl EnsTransportHealth {
    pub fn disabled(message: impl Into<String>) -> Self {
        Self {
            status: EnsTransportHealthStatus::Disabled,
            message: Some(message.into()),
        }
    }

    pub fn healthy() -> Self {
        Self {
            status: EnsTransportHealthStatus::Healthy,
            message: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsOperationKind {
    PairingOffer,
    PairingResponse,
    PairingComplete,
    PairingCancel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsOperationStatus {
    Pending,
    Completed,
    Cancelled,
    Failed,
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsOperationSnapshot {
    pub id: String,
    pub kind: EnsOperationKind,
    pub status: EnsOperationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_identity: Option<EnsPeerIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPeerSnapshot {
    pub identity: EnsPeerIdentity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<EnsEndpointAdvertisement>,
    pub authorized: bool,
    pub pairing_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsCommandAck {
    pub operation_id: String,
    pub status: EnsOperationStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPairingOfferTicket {
    pub operation_id: String,
    pub session_id: String,
    pub pin: String,
    pub status: EnsOperationStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsTransportSnapshot {
    pub enabled: bool,
    pub provider_id: String,
    pub global_topology: EnsInterfaceTopology,
    pub health: EnsTransportHealth,
    pub peers: Vec<EnsPeerSnapshot>,
    pub interfaces: Vec<EnsInterfaceSnapshot>,
    pub operations: Vec<EnsOperationSnapshot>,
    pub updated_at: String,
}
