use serde::{Deserialize, Serialize};

use super::dto::{EnsEndpointAdvertisement, EnsPeerIdentity};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPairingOffer {
    pub operation_id: String,
    pub session_id: String,
    pub initiator: EnsPeerIdentity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiator_endpoint: Option<EnsEndpointAdvertisement>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPairingResponse {
    pub operation_id: String,
    pub session_id: String,
    pub responder: EnsPeerIdentity,
    pub responder_endpoint: EnsEndpointAdvertisement,
    pub pin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responder_inbound_secret: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPairingComplete {
    pub operation_id: String,
    pub session_id: String,
    pub initiator: EnsPeerIdentity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiator_endpoint: Option<EnsEndpointAdvertisement>,
    pub initiator_inbound_secret: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsPairingCancel {
    pub operation_id: String,
    pub session_id: String,
    pub peer: EnsPeerIdentity,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum EnsPairingFrame {
    PairingOffer(EnsPairingOffer),
    PairingResponse(EnsPairingResponse),
    PairingComplete(EnsPairingComplete),
    PairingCancel(EnsPairingCancel),
}
