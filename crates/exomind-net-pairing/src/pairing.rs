use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::time::{SystemTime, UNIX_EPOCH};

/// A successfully paired peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedPeer {
    pub host_id: String,
    pub node_name: String,
    pub identity_hex: String,
    pub paired_at_ms: u64,
}

/// Result of a pairing attempt.
#[derive(Debug, Clone)]
pub enum PairingResult {
    Success(PairedPeer),
    Rejected(String), // reason
    Timeout,
}

/// Pairing-related events.
#[derive(Debug, Clone)]
pub enum PairingEvent {
    PairingRequested { peer_host_id: String },
    PairingCompleted { peer_host_id: String },
    PairingFailed { peer_host_id: String, reason: String },
}

/// Message exchanged during pairing over the Link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingMessage {
    pub msg_type: PairingMsgType,
    pub host_id: String,
    pub pairing_token: String,
    pub node_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PairingMsgType {
    Hello,
    TokenVerify,
    TokenAccepted,
    TokenRejected,
}


/// Pairing response sent over an encrypted Reticulum Link from the responder
/// to the initiator. This carries the PIN and responder inbound token, so it
/// must never be embedded in public Announce app_data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RetPairingLinkFrame {
    /// Offer sent by the initiator to notify the responder that a pairing
    /// session has been created. The responder should display a PIN input
    /// dialog upon receiving this frame.
    PairingOffer {
        session_id: String,
        initiator_peer_id: String,
        initiator_host_id: String,
        initiator_node_name: String,
    },
    /// Cancel sent by the initiator when the user dismisses the PIN dialog.
    /// The responder clears its pairing_pending state for this peer.
    PairingCancel {
        initiator_peer_id: String,
    },
    /// Response sent by the responder back to the initiator over the
    /// encrypted Reticulum Link, carrying the PIN and responder's inbound
    /// token. This must never be embedded in public Announce app_data.
    PairingResponse {
        request_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        pin: String,
        initiator_peer_id: String,
        responder_peer_id: String,
        responder_host_id: String,
        responder_node_name: String,
        responder_port: u16,
        responder_base_url: String,
        responder_inbound_token: String,
    },
}

/// Pairing result announced after the initiator validates the encrypted Link
/// frame. It intentionally contains no bearer tokens or PIN material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetPairingResultAnnounce {
    pub request_id: String,
    pub accepted: bool,
    pub initiator_peer_id: String,
    pub responder_peer_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Derive the initiator's inbound token without publishing it in Announce data.
/// Both sides know the PIN and responder_inbound_token only after the encrypted
/// Link request, while passive announce observers do not.
pub fn derive_initiator_inbound_token(
    request_id: &str,
    pin: &str,
    initiator_peer_id: &str,
    responder_peer_id: &str,
    responder_inbound_token: &str,
) -> String {
    let mut hasher = sha2::Sha256::new();
    hasher.update(b"exomind-ret-pairing-v1:init-inbound");
    hasher.update(request_id.as_bytes());
    hasher.update(pin.as_bytes());
    hasher.update(initiator_peer_id.as_bytes());
    hasher.update(responder_peer_id.as_bytes());
    hasher.update(responder_inbound_token.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// A pairing session in progress.
#[derive(Debug, Clone)]
pub struct PairingSession {
    pub session_id: String,
    pub initiator_host_id: String,
    pub responder_host_id: Option<String>,
    pub pin: String,
    pub token: String,
    pub created_at_ms: u64,
}

impl PairingSession {
    pub fn is_expired(&self, ttl_ms: u64) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        now - self.created_at_ms > ttl_ms
    }
}
