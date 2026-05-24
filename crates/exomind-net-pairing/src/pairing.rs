use serde::{Deserialize, Serialize};
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
