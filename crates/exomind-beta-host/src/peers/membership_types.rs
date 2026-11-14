use super::identity::DeviceIdentityInfo;
use exomind_core::{DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;

pub const PEER_PROTOCOL: &str = "exomind-peer/1";
// One explicit compatibility seam, updated with the Core wire schema change.
// This is not a request to reinterpret older/newer facts in the receiver.
pub const PEER_CORE_SCHEMA: u32 = exomind_core::CORE_SCHEMA_VERSION as u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerCapabilities {
    pub read_timeline: bool,
    pub append_facts: bool,
    pub read_originals: bool,
}
impl PeerCapabilities {
    pub const FULL: Self = Self {
        read_timeline: true,
        append_facts: true,
        read_originals: true,
    };
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreatePeerInvitation {
    pub invitation_id: Uuid,
    pub profile_id: ProfileId,
    pub capabilities: PeerCapabilities,
    pub candidates: Vec<SocketAddr>,
    pub ttl_seconds: u32,
}

/// Explicit local approval to replace one prior issuer-side member binding.
/// An invitation alone never authorizes replacing an existing member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovePeerInvitationReplacement {
    pub invitation_id: Uuid,
    pub claim_id: Uuid,
    pub device_id: DeviceId,
    pub previous_claim_id: Uuid,
    pub expected_generation: u64,
}

/// Both counters are local to the joining Host; neither is the issuer's
/// counter found in a signed ClaimReceipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerRejoinExpectation {
    pub previous_claim_id: Uuid,
    pub expected_local_generation: u64,
    pub expected_issuer_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerInvitationOffer {
    pub invitation_id: Uuid,
    pub issuer: DeviceIdentityInfo,
    pub profile_id: ProfileId,
    pub profile_name: String,
    pub protocol: String,
    pub schema: u32,
    pub capabilities: PeerCapabilities,
    pub candidates: Vec<SocketAddr>,
    pub expires_at_unix_ms: i64,
}

// Deliberately no Debug. These DTOs carry the one-time secret only in the
// explicitly copied invitation or encrypted TLS claim, never status/logs.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerInvitation {
    pub offer: PeerInvitationOffer,
    pub secret: String,
    pub signature: Vec<u8>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssuedPeerInvitation {
    pub invitation: Option<PeerInvitation>,
    pub status: PeerInvitationStatus,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerJoinClaim {
    pub claim_id: Uuid,
    pub invitation_id: Uuid,
    pub invitation_digest: String,
    pub joiner_device_id: DeviceId,
    pub joiner_pin: String,
    pub secret: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerMembershipEvidence {
    pub claim_id: Uuid,
    pub invitation_id: Uuid,
    pub invitation_digest: String,
    pub profile_id: ProfileId,
    pub profile_name: String,
    pub issuer: DeviceIdentityInfo,
    pub joiner_device_id: DeviceId,
    pub joiner_pin: String,
    pub capabilities: PeerCapabilities,
    pub generation: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerClaimReceipt {
    pub evidence: PeerMembershipEvidence,
    pub signature: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerJoinConfirmation {
    pub claim_id: Uuid,
    pub receipt_sha256: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerReadyReceipt {
    pub claim_receipt: PeerClaimReceipt,
    pub signature: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerReadyAcknowledgement {
    pub claim_id: Uuid,
    pub ready_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerJoinState {
    Pending,
    Claimed,
    Accepted,
    Ready,
    Revoked,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerJoinStatus {
    pub claim_id: Uuid,
    pub profile_id: ProfileId,
    pub issuer_device_id: DeviceId,
    pub joiner_device_id: DeviceId,
    pub state: PeerJoinState,
    pub remote_ready_observed: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerInvitationState {
    Open,
    Claimed,
    Ready,
    Expired,
    Revoked,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerInvitationStatus {
    pub offer: PeerInvitationOffer,
    pub state: PeerInvitationState,
    pub claim_id: Option<Uuid>,
    pub remote_ready_observed: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerMember {
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub pin: String,
    pub capabilities: PeerCapabilities,
    pub generation: u64,
    pub revoked: bool,
    pub state: PeerJoinState,
}
