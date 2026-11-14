//! Profile membership is a Host authority, separate from TLS possession and
//! local Owner/Grant sessions. All writes requalify under the shared gate.
#[path = "membership_types.rs"]
mod types;
use super::{Identity, PeerChannel, PeerPin, identity, membership_store as store};
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, ProfileId};
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub use types::*;
use uuid::Uuid;

const INVITATION_DOMAIN: &[u8] = b"exomind-peer-invitation/1\0";
const CLAIM_DOMAIN: &[u8] = b"exomind-peer-membership-claim/1\0";
const READY_DOMAIN: &[u8] = b"exomind-peer-membership-ready/1\0";
const MAX_CANDIDATES: usize = 8;
const MAX_TTL_SECONDS: u32 = 86400;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SignedOffer {
    pub offer: PeerInvitationOffer,
    pub signature: Vec<u8>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ClaimBinding {
    pub claim_id: Uuid,
    pub invitation_id: Uuid,
    pub invitation_digest: String,
    pub joiner_device_id: DeviceId,
    pub joiner_pin: String,
    pub secret_hash: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredInvitation {
    pub request_hash: String,
    pub signed: SignedOffer,
    pub secret_hash: String,
    pub revoked: bool,
    pub claim_id: Option<Uuid>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredClaim {
    pub binding: ClaimBinding,
    pub receipt: PeerClaimReceipt,
    pub ready: Option<PeerReadyReceipt>,
    pub remote_ready_observed: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredPending {
    pub signed: SignedOffer,
    pub binding: ClaimBinding,
    pub receipt: Option<PeerClaimReceipt>,
    pub ready: Option<PeerReadyReceipt>,
    pub issuer_generation: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredMember {
    pub record: PeerMember,
    pub claim_id: Option<Uuid>,
}

fn digest<T: Serialize>(value: &T) -> Result<String, HostError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(store::encode(value)?.as_bytes())
    ))
}
fn hash_secret(raw: &str) -> Result<String, HostError> {
    PeerPin::from_sha256(raw)?;
    Ok(format!("{:x}", Sha256::digest(raw.as_bytes())))
}
fn message<T: Serialize>(domain: &[u8], value: &T) -> Result<Vec<u8>, HostError> {
    let mut bytes = domain.to_vec();
    bytes.extend_from_slice(store::encode(value)?.as_bytes());
    Ok(bytes)
}
fn sign<T: Serialize>(identity: &Identity, domain: &[u8], value: &T) -> Result<Vec<u8>, HostError> {
    identity
        .certified
        .key
        .choose_scheme(&[rustls::SignatureScheme::ED25519])
        .ok_or(HostError::PeerIdentityUnavailable)?
        .sign(&message(domain, value)?)
        .map_err(|_| HostError::PeerIdentityUnavailable)
}
fn verify<T: Serialize>(
    issuer: &super::DeviceIdentityInfo,
    domain: &[u8],
    value: &T,
    signature: &[u8],
) -> Result<(), HostError> {
    if !identity::valid_spki(&issuer.spki_der)
        || identity::fingerprint(&issuer.spki_der) != issuer.fingerprint_sha256
        || signature.len() != 64
    {
        return Err(HostError::PeerMembershipDenied);
    }
    UnparsedPublicKey::new(&ED25519, &issuer.spki_der[12..])
        .verify(&message(domain, value)?, signature)
        .map_err(|_| HostError::PeerMembershipDenied)
}
fn validate_offer(signed: &SignedOffer) -> Result<(), HostError> {
    let offer = &signed.offer;
    if offer.protocol != PEER_PROTOCOL || offer.schema != PEER_CORE_SCHEMA {
        return Err(HostError::PeerProtocolMismatch);
    }
    if offer.invitation_id.is_nil()
        || offer.profile_name.trim().is_empty()
        || offer.profile_name.len() > 256
        || offer.expires_at_unix_ms <= 0
    {
        return Err(HostError::InvalidRequest);
    }
    validate_candidates(&offer.candidates)?;
    PeerPin::from_sha256(&offer.issuer.fingerprint_sha256)?;
    verify(&offer.issuer, INVITATION_DOMAIN, offer, &signed.signature)
}
fn validate_candidates(candidates: &[std::net::SocketAddr]) -> Result<(), HostError> {
    if candidates.is_empty() || candidates.len() > MAX_CANDIDATES {
        return Err(HostError::InvalidRequest);
    }
    for (index, address) in candidates.iter().enumerate() {
        if address.port() == 0
            || address.ip().is_unspecified()
            || address.ip().is_multicast()
            || candidates[..index].contains(address)
        {
            return Err(HostError::InvalidRequest);
        }
    }
    Ok(())
}
fn binding(claim: &PeerJoinClaim) -> Result<ClaimBinding, HostError> {
    if claim.claim_id.is_nil() || claim.invitation_id.is_nil() {
        return Err(HostError::InvalidRequest);
    }
    PeerPin::from_sha256(&claim.invitation_digest)?;
    PeerPin::from_sha256(&claim.joiner_pin)?;
    Ok(ClaimBinding {
        claim_id: claim.claim_id,
        invitation_id: claim.invitation_id,
        invitation_digest: claim.invitation_digest.clone(),
        joiner_device_id: claim.joiner_device_id,
        joiner_pin: claim.joiner_pin.clone(),
        secret_hash: hash_secret(&claim.secret)?,
    })
}
fn validate_invitation(invitation: &StoredInvitation, id: Uuid) -> Result<(), HostError> {
    if invitation.signed.offer.invitation_id != id
        || PeerPin::from_sha256(&invitation.secret_hash).is_err()
        || PeerPin::from_sha256(&invitation.request_hash).is_err()
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate_offer(&invitation.signed).map_err(|_| HostError::PeerMembershipRecoveryRequired)
}
fn validate_claim(claim: &StoredClaim, id: Uuid) -> Result<(), HostError> {
    if claim.remote_ready_observed && claim.ready.is_none() {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    if claim.binding.claim_id != id
        || claim.receipt.evidence.claim_id != id
        || claim.binding.invitation_id != claim.receipt.evidence.invitation_id
        || claim.binding.invitation_digest != claim.receipt.evidence.invitation_digest
        || claim.binding.joiner_device_id != claim.receipt.evidence.joiner_device_id
        || claim.binding.joiner_pin != claim.receipt.evidence.joiner_pin
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    verify(
        &claim.receipt.evidence.issuer,
        CLAIM_DOMAIN,
        &claim.receipt.evidence,
        &claim.receipt.signature,
    )
    .map_err(|_| HostError::PeerMembershipRecoveryRequired)?;
    if let Some(ready) = &claim.ready {
        if ready.claim_receipt != claim.receipt {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        verify(
            &ready.claim_receipt.evidence.issuer,
            READY_DOMAIN,
            &ready.claim_receipt,
            &ready.signature,
        )
        .map_err(|_| HostError::PeerMembershipRecoveryRequired)?;
    }
    Ok(())
}
fn validate_pending(pending: &StoredPending, id: Uuid) -> Result<(), HostError> {
    validate_offer(&pending.signed).map_err(|_| HostError::PeerMembershipRecoveryRequired)?;
    if pending.binding.claim_id != id
        || pending.binding.invitation_id != pending.signed.offer.invitation_id
        || pending.binding.invitation_digest != digest(&pending.signed)?
        || PeerPin::from_sha256(&pending.binding.secret_hash).is_err()
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    if pending.receipt.is_some() != pending.issuer_generation.is_some()
        || pending
            .issuer_generation
            .is_some_and(|g| g == 0 || g > i64::MAX as u64)
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    if let Some(receipt) = &pending.receipt {
        check_receipt(pending, receipt).map_err(|_| HostError::PeerMembershipRecoveryRequired)?;
    }
    if let Some(ready) = &pending.ready {
        if pending.receipt.as_ref() != Some(&ready.claim_receipt) {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        verify(
            &pending.signed.offer.issuer,
            READY_DOMAIN,
            &ready.claim_receipt,
            &ready.signature,
        )
        .map_err(|_| HostError::PeerMembershipRecoveryRequired)?;
    }
    Ok(())
}
fn check_receipt(pending: &StoredPending, receipt: &PeerClaimReceipt) -> Result<(), HostError> {
    let offer = &pending.signed.offer;
    let evidence = &receipt.evidence;
    if evidence.claim_id != pending.binding.claim_id
        || evidence.invitation_id != offer.invitation_id
        || evidence.invitation_digest != pending.binding.invitation_digest
        || evidence.profile_id != offer.profile_id
        || evidence.profile_name != offer.profile_name
        || evidence.issuer != offer.issuer
        || evidence.joiner_device_id != pending.binding.joiner_device_id
        || evidence.joiner_pin != pending.binding.joiner_pin
        || evidence.capabilities != offer.capabilities
        || evidence.generation == 0
        || evidence.generation > i64::MAX as u64
    {
        return Err(HostError::PeerMembershipConflict);
    }
    verify(&offer.issuer, CLAIM_DOMAIN, evidence, &receipt.signature)
}
fn invitation_status(
    invitation: &StoredInvitation,
    claim: Option<&StoredClaim>,
    now: i64,
) -> PeerInvitationStatus {
    PeerInvitationStatus {
        offer: invitation.signed.offer.clone(),
        claim_id: invitation.claim_id,
        remote_ready_observed: claim.is_some_and(|c| c.remote_ready_observed),
        state: if invitation.revoked {
            PeerInvitationState::Revoked
        } else if claim.is_some_and(|c| c.remote_ready_observed) {
            PeerInvitationState::Ready
        } else if invitation.claim_id.is_some() {
            PeerInvitationState::Claimed
        } else if now >= invitation.signed.offer.expires_at_unix_ms {
            PeerInvitationState::Expired
        } else {
            PeerInvitationState::Open
        },
    }
}
fn status(evidence: &PeerMembershipEvidence, state: PeerJoinState) -> PeerJoinStatus {
    PeerJoinStatus {
        claim_id: evidence.claim_id,
        profile_id: evidence.profile_id,
        issuer_device_id: evidence.issuer.device_id,
        joiner_device_id: evidence.joiner_device_id,
        state,
        remote_ready_observed: state == PeerJoinState::Ready,
    }
}
fn live_invitation_status(
    connection: &rusqlite::Connection,
    invitation: &StoredInvitation,
    now: i64,
) -> Result<PeerInvitationStatus, HostError> {
    let claim = invitation
        .claim_id
        .map(|id| store::claim(connection, id))
        .transpose()?
        .flatten();
    if invitation.claim_id.is_some() && claim.is_none() {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    let mut result = invitation_status(invitation, claim.as_ref(), now);
    if let Some(claim) = claim {
        validate_claim(&claim, claim.binding.claim_id)?;
        if claim.binding.invitation_id != invitation.signed.offer.invitation_id {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        match current_member(connection, &claim.receipt.evidence) {
            Ok(_) => {}
            Err(HostError::PeerMembershipDenied) => {
                result.state = PeerInvitationState::Revoked;
                result.remote_ready_observed = false;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(result)
}
fn pending_status(pending: &StoredPending, state: PeerJoinState) -> PeerJoinStatus {
    PeerJoinStatus {
        claim_id: pending.binding.claim_id,
        profile_id: pending.signed.offer.profile_id,
        issuer_device_id: pending.signed.offer.issuer.device_id,
        joiner_device_id: pending.binding.joiner_device_id,
        state,
        remote_ready_observed: state == PeerJoinState::Ready,
    }
}
impl PeerReadyReceipt {
    pub fn acknowledgement(&self) -> Result<PeerReadyAcknowledgement, HostError> {
        Ok(PeerReadyAcknowledgement {
            claim_id: self.claim_receipt.evidence.claim_id,
            ready_sha256: digest(self)?,
        })
    }
}
fn current_member(
    connection: &rusqlite::Connection,
    evidence: &PeerMembershipEvidence,
) -> Result<StoredMember, HostError> {
    let member = store::member(connection, evidence.profile_id, evidence.joiner_device_id)?
        .ok_or(HostError::PeerMembershipRecoveryRequired)?;
    if member.record.revoked
        || member.record.generation != evidence.generation
        || member.record.pin != evidence.joiner_pin
        || member.record.capabilities != evidence.capabilities
        || member.claim_id != Some(evidence.claim_id)
    {
        return Err(HostError::PeerMembershipDenied);
    }
    Ok(member)
}
fn pending_members(
    connection: &rusqlite::Connection,
    pending: &StoredPending,
) -> Result<(StoredMember, StoredMember), HostError> {
    let receipt = pending
        .receipt
        .as_ref()
        .ok_or(HostError::PeerMembershipRecoveryRequired)?;
    let local = current_member(connection, &receipt.evidence)?;
    let issuer = store::member(
        connection,
        pending.signed.offer.profile_id,
        pending.signed.offer.issuer.device_id,
    )?
    .ok_or(HostError::PeerMembershipRecoveryRequired)?;
    if issuer.record.revoked
        || issuer.record.pin != pending.signed.offer.issuer.fingerprint_sha256
        || issuer.record.capabilities != PeerCapabilities::FULL
        || Some(issuer.record.generation) != pending.issuer_generation
        || issuer.claim_id != Some(pending.binding.claim_id)
    {
        return Err(HostError::PeerMembershipDenied);
    }
    let expected = if pending.ready.is_some() {
        PeerJoinState::Ready
    } else {
        PeerJoinState::Pending
    };
    if local.record.state != expected || issuer.record.state != expected {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    Ok((local, issuer))
}
fn local_member(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    identity: &Identity,
) -> Result<(), HostError> {
    if let Some(member) = store::member(connection, profile, identity.info.device_id)? {
        if member.record.revoked
            || member.record.state != PeerJoinState::Ready
            || member.record.pin != identity.info.fingerprint_sha256
        {
            return Err(HostError::PeerMembershipDenied);
        }
        return Ok(());
    }
    store::save_member(
        connection,
        &StoredMember {
            record: PeerMember {
                profile_id: profile,
                device_id: identity.info.device_id,
                pin: identity.info.fingerprint_sha256.clone(),
                capabilities: PeerCapabilities::FULL,
                generation: 1,
                revoked: false,
                state: PeerJoinState::Ready,
            },
            claim_id: None,
        },
    )
}
fn require_local_member(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    identity: &Identity,
) -> Result<StoredMember, HostError> {
    let member = store::member(connection, profile, identity.info.device_id)?
        .ok_or(HostError::PeerMembershipRecoveryRequired)?;
    if member.record.revoked
        || member.record.state != PeerJoinState::Ready
        || member.record.pin != identity.info.fingerprint_sha256
    {
        return Err(HostError::PeerMembershipDenied);
    }
    Ok(member)
}
fn new_member(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    device: DeviceId,
    pin: &str,
    caps: PeerCapabilities,
    claim_id: Uuid,
    generation: Option<u64>,
) -> Result<StoredMember, HostError> {
    let next = match store::member(connection, profile, device)? {
        Some(member) if member.claim_id == Some(claim_id) && !member.record.revoked => {
            if member.record.pin != pin
                || member.record.capabilities != caps
                || generation.is_some_and(|g| g != member.record.generation)
            {
                return Err(HostError::PeerMembershipConflict);
            }
            return Ok(member);
        }
        Some(member) => {
            if !member.record.revoked || member.record.pin != pin {
                return Err(HostError::PeerMembershipConflict);
            }
            member
                .record
                .generation
                .checked_add(1)
                .ok_or(HostError::PeerMembershipConflict)?
        }
        None => 1,
    };
    let generation = generation.unwrap_or(next);
    if generation < next || generation > i64::MAX as u64 {
        return Err(HostError::PeerMembershipConflict);
    }
    Ok(StoredMember {
        record: PeerMember {
            profile_id: profile,
            device_id: device,
            pin: pin.into(),
            capabilities: caps,
            generation,
            revoked: false,
            state: PeerJoinState::Pending,
        },
        claim_id: Some(claim_id),
    })
}

impl BetaHost {
    pub fn create_peer_invitation(
        &self,
        owner: &Session,
        request: &CreatePeerInvitation,
    ) -> Result<IssuedPeerInvitation, HostError> {
        if request.invitation_id.is_nil()
            || request.ttl_seconds == 0
            || request.ttl_seconds > MAX_TTL_SECONDS
        {
            return Err(HostError::InvalidRequest);
        }
        validate_candidates(&request.candidates)?;
        let request_hash = digest(request)?;
        let identity = self.transport_identity(owner)?;
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let profile = resources
            .core
            .profiles()?
            .into_iter()
            .find(|p| p.profile_id == request.profile_id)
            .ok_or(HostError::NotFound)?;
        let tx = store::transaction(&mut resources.persistence.auth)?;
        let now = store::now(&tx, self.clock.sample().wall_ms)?;
        if let Some(existing) = store::invitation(&tx, request.invitation_id)? {
            validate_invitation(&existing, request.invitation_id)?;
            if existing.request_hash != request_hash {
                return Err(HostError::PeerMembershipConflict);
            }
            let status = live_invitation_status(&tx, &existing, now)?;
            tx.commit().map_err(store::unavailable)?;
            return Ok(IssuedPeerInvitation {
                invitation: None,
                status,
            });
        }
        store::reserve(&tx, "peer_invitations", store::MAX_INVITATIONS)?;
        local_member(&tx, request.profile_id, &identity)?;
        let offer = PeerInvitationOffer {
            invitation_id: request.invitation_id,
            issuer: identity.info.clone(),
            profile_id: request.profile_id,
            profile_name: profile.display_name,
            protocol: PEER_PROTOCOL.into(),
            schema: PEER_CORE_SCHEMA,
            capabilities: request.capabilities,
            candidates: request.candidates.clone(),
            expires_at_unix_ms: now
                .checked_add(i64::from(request.ttl_seconds) * 1000)
                .ok_or(HostError::InvalidRequest)?,
        };
        let signed = SignedOffer {
            signature: sign(&identity, INVITATION_DOMAIN, &offer)?,
            offer,
        };
        validate_offer(&signed)?;
        let secret = crate::storage::token();
        let invitation = StoredInvitation {
            request_hash,
            signed: signed.clone(),
            secret_hash: hash_secret(&secret)?,
            revoked: false,
            claim_id: None,
        };
        store::save_invitation(&tx, &invitation)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(IssuedPeerInvitation {
            status: invitation_status(&invitation, None, now),
            invitation: Some(PeerInvitation {
                offer: signed.offer,
                signature: signed.signature,
                secret,
            }),
        })
    }
    pub fn peer_invitation_status(
        &self,
        owner: &Session,
        id: Uuid,
    ) -> Result<PeerInvitationStatus, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let now = store::now(&tx, self.clock.sample().wall_ms)?;
        let invitation = store::invitation(&tx, id)?.ok_or(HostError::NotFound)?;
        validate_invitation(&invitation, id)?;
        let result = live_invitation_status(&tx, &invitation, now)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(result)
    }
    pub fn prepare_peer_join(
        &self,
        owner: &Session,
        invitation: &PeerInvitation,
        claim_id: Uuid,
    ) -> Result<PeerJoinClaim, HostError> {
        let signed = SignedOffer {
            offer: invitation.offer.clone(),
            signature: invitation.signature.clone(),
        };
        validate_offer(&signed)?;
        let secret_hash = hash_secret(&invitation.secret)?;
        let identity = self.transport_identity(owner)?;
        if signed.offer.issuer.device_id == self.device_id
            || signed.offer.issuer.fingerprint_sha256 == identity.info.fingerprint_sha256
        {
            return Err(HostError::PeerMembershipConflict);
        }
        let claim = PeerJoinClaim {
            claim_id,
            invitation_id: signed.offer.invitation_id,
            invitation_digest: digest(&signed)?,
            joiner_device_id: self.device_id,
            joiner_pin: identity.info.fingerprint_sha256.clone(),
            secret: invitation.secret.clone(),
        };
        let binding = binding(&claim)?;
        if binding.secret_hash != secret_hash {
            return Err(HostError::PeerMembershipDenied);
        }
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let now = store::now(&tx, self.clock.sample().wall_ms)?;
        if let Some(pending) = store::pending(&tx, claim_id)? {
            validate_pending(&pending, claim_id)?;
            if pending.signed != signed || pending.binding != binding {
                return Err(HostError::PeerMembershipConflict);
            }
            if pending.receipt.is_some() {
                pending_members(&tx, &pending)?;
            }
        } else {
            if now >= signed.offer.expires_at_unix_ms {
                tx.commit().map_err(store::unavailable)?;
                return Err(HostError::PeerInvitationExpired);
            }
            store::reserve(&tx, "peer_pending", store::MAX_JOINS)?;
            store::save_pending(
                &tx,
                &StoredPending {
                    signed: signed.clone(),
                    binding,
                    receipt: None,
                    ready: None,
                    issuer_generation: None,
                },
            )?;
        }
        tx.commit().map_err(store::unavailable)?;
        // Core and auth are distinct databases. A durable pending join is not
        // ready; provisioning is idempotent and retried before returning a claim.
        r.core
            .provision_profile(signed.offer.profile_id, &signed.offer.profile_name)?;
        Ok(claim)
    }
    pub(crate) fn claim_peer_invitation_verified(
        &self,
        channel: &PeerChannel,
        claim: &PeerJoinClaim,
    ) -> Result<PeerClaimReceipt, HostError> {
        let binding = binding(claim)?;
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let pin = channel.binding_pin(self)?.as_sha256();
        if pin != binding.joiner_pin || binding.joiner_device_id == self.device_id {
            return Err(HostError::PeerMembershipDenied);
        }
        let identity = r
            .peer_identity
            .as_ref()
            .cloned()
            .ok_or(HostError::PeerIdentityUnavailable)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let now = store::now(&tx, self.clock.sample().wall_ms)?;
        if let Some(existing) = store::claim(&tx, binding.claim_id)? {
            validate_claim(&existing, binding.claim_id)?;
            if existing.binding != binding {
                return Err(HostError::PeerMembershipConflict);
            }
            let invitation = store::invitation(&tx, binding.invitation_id)?
                .ok_or(HostError::PeerMembershipRecoveryRequired)?;
            validate_invitation(&invitation, binding.invitation_id)?;
            if invitation.revoked && existing.ready.is_none() {
                return Err(HostError::PeerInvitationRevoked);
            }
            current_member(&tx, &existing.receipt.evidence)?;
            require_local_member(&tx, existing.receipt.evidence.profile_id, &identity)?;
            channel.binding_pin(self)?;
            tx.commit().map_err(store::unavailable)?;
            return Ok(existing.receipt);
        }
        let mut invitation =
            store::invitation(&tx, binding.invitation_id)?.ok_or(HostError::NotFound)?;
        validate_invitation(&invitation, binding.invitation_id)?;
        if invitation.revoked {
            return Err(HostError::PeerInvitationRevoked);
        }
        if invitation.claim_id.is_some() {
            return Err(HostError::PeerInvitationConsumed);
        }
        if now >= invitation.signed.offer.expires_at_unix_ms {
            tx.commit().map_err(store::unavailable)?;
            return Err(HostError::PeerInvitationExpired);
        }
        if invitation.secret_hash != binding.secret_hash
            || digest(&invitation.signed)? != binding.invitation_digest
            || invitation.signed.offer.issuer != identity.info
        {
            return Err(HostError::PeerMembershipDenied);
        }
        let offer = &invitation.signed.offer;
        require_local_member(&tx, offer.profile_id, &identity)?;
        store::reserve(&tx, "peer_claims", store::MAX_JOINS)?;
        let member = new_member(
            &tx,
            offer.profile_id,
            binding.joiner_device_id,
            &binding.joiner_pin,
            offer.capabilities,
            binding.claim_id,
            None,
        )?;
        let evidence = PeerMembershipEvidence {
            claim_id: binding.claim_id,
            invitation_id: binding.invitation_id,
            invitation_digest: binding.invitation_digest.clone(),
            profile_id: offer.profile_id,
            profile_name: offer.profile_name.clone(),
            issuer: identity.info.clone(),
            joiner_device_id: binding.joiner_device_id,
            joiner_pin: binding.joiner_pin.clone(),
            capabilities: offer.capabilities,
            generation: member.record.generation,
        };
        let receipt = PeerClaimReceipt {
            signature: sign(&identity, CLAIM_DOMAIN, &evidence)?,
            evidence,
        };
        store::save_member(&tx, &member)?;
        store::save_claim(
            &tx,
            &StoredClaim {
                binding: binding.clone(),
                receipt: receipt.clone(),
                ready: None,
                remote_ready_observed: false,
            },
        )?;
        invitation.claim_id = Some(binding.claim_id);
        store::save_invitation(&tx, &invitation)?;
        channel.binding_pin(self)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(receipt)
    }
    pub(crate) fn accept_peer_claim_verified(
        &self,
        channel: &PeerChannel,
        receipt: &PeerClaimReceipt,
    ) -> Result<PeerJoinConfirmation, HostError> {
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let pin = channel.binding_pin(self)?.as_sha256();
        let tx = store::transaction(&mut r.persistence.auth)?;
        let mut pending =
            store::pending(&tx, receipt.evidence.claim_id)?.ok_or(HostError::NotFound)?;
        validate_pending(&pending, receipt.evidence.claim_id)?;
        if pending.signed.offer.issuer.fingerprint_sha256 != pin
            || pending.binding.joiner_device_id != self.device_id
        {
            return Err(HostError::PeerMembershipDenied);
        }
        check_receipt(&pending, receipt)?;
        if let Some(previous) = &pending.receipt {
            if previous != receipt {
                return Err(HostError::PeerMembershipConflict);
            }
            pending_members(&tx, &pending)?;
        } else {
            let local = new_member(
                &tx,
                receipt.evidence.profile_id,
                self.device_id,
                &pending.binding.joiner_pin,
                receipt.evidence.capabilities,
                pending.binding.claim_id,
                Some(receipt.evidence.generation),
            )?;
            let issuer = new_member(
                &tx,
                receipt.evidence.profile_id,
                pending.signed.offer.issuer.device_id,
                &pin,
                PeerCapabilities::FULL,
                pending.binding.claim_id,
                None,
            )?;
            store::save_member(&tx, &local)?;
            store::save_member(&tx, &issuer)?;
            pending.issuer_generation = Some(issuer.record.generation);
            pending.receipt = Some(receipt.clone());
            store::save_pending(&tx, &pending)?;
        }
        channel.binding_pin(self)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(PeerJoinConfirmation {
            claim_id: receipt.evidence.claim_id,
            receipt_sha256: digest(receipt)?,
        })
    }
    pub(crate) fn confirm_peer_join_verified(
        &self,
        channel: &PeerChannel,
        confirmation: &PeerJoinConfirmation,
    ) -> Result<PeerReadyReceipt, HostError> {
        PeerPin::from_sha256(&confirmation.receipt_sha256)?;
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let pin = channel.binding_pin(self)?.as_sha256();
        let identity = r
            .peer_identity
            .as_ref()
            .cloned()
            .ok_or(HostError::PeerIdentityUnavailable)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let mut claim = store::claim(&tx, confirmation.claim_id)?.ok_or(HostError::NotFound)?;
        validate_claim(&claim, confirmation.claim_id)?;
        if claim.binding.joiner_pin != pin {
            return Err(HostError::PeerMembershipDenied);
        }
        if digest(&claim.receipt)? != confirmation.receipt_sha256 {
            return Err(HostError::PeerMembershipConflict);
        }
        let mut member = current_member(&tx, &claim.receipt.evidence)?;
        require_local_member(&tx, member.record.profile_id, &identity)?;
        if let Some(ready) = claim.ready {
            channel.binding_pin(self)?;
            tx.commit().map_err(store::unavailable)?;
            return Ok(ready);
        }
        let invitation = store::invitation(&tx, claim.binding.invitation_id)?
            .ok_or(HostError::PeerMembershipRecoveryRequired)?;
        validate_invitation(&invitation, claim.binding.invitation_id)?;
        if invitation.revoked {
            return Err(HostError::PeerInvitationRevoked);
        }
        let ready = PeerReadyReceipt {
            signature: sign(&identity, READY_DOMAIN, &claim.receipt)?,
            claim_receipt: claim.receipt.clone(),
        };
        member.record.state = PeerJoinState::Ready;
        store::save_member(&tx, &member)?;
        claim.ready = Some(ready.clone());
        store::save_claim(&tx, &claim)?;
        channel.binding_pin(self)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(ready)
    }
    pub(crate) fn finish_peer_join_verified(
        &self,
        channel: &PeerChannel,
        ready: &PeerReadyReceipt,
    ) -> Result<PeerJoinStatus, HostError> {
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let pin = channel.binding_pin(self)?.as_sha256();
        let tx = store::transaction(&mut r.persistence.auth)?;
        let id = ready.claim_receipt.evidence.claim_id;
        let mut pending = store::pending(&tx, id)?.ok_or(HostError::NotFound)?;
        validate_pending(&pending, id)?;
        if pending.signed.offer.issuer.fingerprint_sha256 != pin
            || pending.binding.joiner_device_id != self.device_id
        {
            return Err(HostError::PeerMembershipDenied);
        }
        check_receipt(&pending, &ready.claim_receipt)?;
        if pending.receipt.as_ref() != Some(&ready.claim_receipt) {
            return Err(HostError::PeerMembershipConflict);
        }
        verify(
            &pending.signed.offer.issuer,
            READY_DOMAIN,
            &ready.claim_receipt,
            &ready.signature,
        )?;
        let (mut local, mut issuer) = pending_members(&tx, &pending)?;
        if issuer.record.revoked || issuer.record.pin != pin || issuer.claim_id != Some(id) {
            return Err(HostError::PeerMembershipDenied);
        }
        if let Some(previous) = &pending.ready {
            if previous != ready {
                return Err(HostError::PeerMembershipConflict);
            }
        }
        // Provisioning failure is visible and cannot be marked ready by a
        // receipt alone. The pending row survives for explicit recovery.
        r.core.provision_profile(
            pending.signed.offer.profile_id,
            &pending.signed.offer.profile_name,
        )?;
        local.record.state = PeerJoinState::Ready;
        issuer.record.state = PeerJoinState::Ready;
        store::save_member(&tx, &local)?;
        store::save_member(&tx, &issuer)?;
        pending.ready = Some(ready.clone());
        store::save_pending(&tx, &pending)?;
        channel.binding_pin(self)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(pending_status(&pending, PeerJoinState::Ready))
    }
    pub(crate) fn acknowledge_peer_ready_verified(
        &self,
        channel: &PeerChannel,
        ack: &PeerReadyAcknowledgement,
    ) -> Result<PeerJoinStatus, HostError> {
        PeerPin::from_sha256(&ack.ready_sha256)?;
        let mut state = self.active_state()?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let pin = channel.binding_pin(self)?.as_sha256();
        let tx = store::transaction(&mut r.persistence.auth)?;
        let mut claim = store::claim(&tx, ack.claim_id)?.ok_or(HostError::NotFound)?;
        validate_claim(&claim, ack.claim_id)?;
        if claim.binding.joiner_pin != pin {
            return Err(HostError::PeerMembershipDenied);
        }
        let ready = claim
            .ready
            .as_ref()
            .ok_or(HostError::PeerMembershipConflict)?;
        if digest(ready)? != ack.ready_sha256 {
            return Err(HostError::PeerMembershipConflict);
        }
        let member = current_member(&tx, &claim.receipt.evidence)?;
        if member.record.state != PeerJoinState::Ready {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        claim.remote_ready_observed = true;
        store::save_claim(&tx, &claim)?;
        channel.binding_pin(self)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(status(&claim.receipt.evidence, PeerJoinState::Ready))
    }
    pub fn peer_join_status(&self, owner: &Session, id: Uuid) -> Result<PeerJoinStatus, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let r = crate::resources(&state)?;
        store::validate(&r.persistence.auth)?;
        if let Some(pending) = store::pending(&r.persistence.auth, id)? {
            validate_pending(&pending, id)?;
            let state = if pending.receipt.is_some() {
                match pending_members(&r.persistence.auth, &pending) {
                    Ok(_) => {
                        if pending.ready.is_some() {
                            PeerJoinState::Ready
                        } else {
                            PeerJoinState::Accepted
                        }
                    }
                    Err(HostError::PeerMembershipDenied) => PeerJoinState::Revoked,
                    Err(error) => return Err(error),
                }
            } else {
                PeerJoinState::Pending
            };
            return Ok(pending_status(&pending, state));
        }
        let claim = store::claim(&r.persistence.auth, id)?.ok_or(HostError::NotFound)?;
        validate_claim(&claim, id)?;
        let state = match current_member(&r.persistence.auth, &claim.receipt.evidence) {
            Ok(_) => {
                if claim.remote_ready_observed {
                    PeerJoinState::Ready
                } else {
                    PeerJoinState::Claimed
                }
            }
            Err(HostError::PeerMembershipDenied) => PeerJoinState::Revoked,
            Err(error) => return Err(error),
        };
        Ok(status(&claim.receipt.evidence, state))
    }
    pub fn peer_members(
        &self,
        owner: &Session,
        profile: ProfileId,
    ) -> Result<Vec<PeerMember>, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let r = crate::resources(&state)?;
        r.core.local_human(profile)?;
        store::validate(&r.persistence.auth)?;
        store::members(&r.persistence.auth, profile)
    }
    pub fn revoke_peer_member(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        expected_generation: u64,
    ) -> Result<PeerMember, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        // Leaving the local profile also affects accepted scheduler ownership
        // and pending joins. That needs its own explicit lifecycle operation;
        // remote-member revocation must not leave a half-active local owner.
        if device == self.device_id {
            return Err(HostError::InvalidRequest);
        }
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let mut member = store::member(&tx, profile, device)?.ok_or(HostError::NotFound)?;
        if member.record.generation != expected_generation {
            return Err(HostError::PeerMembershipConflict);
        }
        if !member.record.revoked {
            member.record.revoked = true;
            member.record.generation = member
                .record
                .generation
                .checked_add(1)
                .filter(|g| *g <= i64::MAX as u64)
                .ok_or(HostError::PeerMembershipConflict)?;
            store::save_member(&tx, &member)?;
        }
        tx.commit().map_err(store::unavailable)?;
        Ok(member.record)
    }
    pub fn revoke_peer_invitation(&self, owner: &Session, id: Uuid) -> Result<(), HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let mut invitation = store::invitation(&tx, id)?.ok_or(HostError::NotFound)?;
        validate_invitation(&invitation, id)?;
        if invitation.revoked {
            tx.commit().map_err(store::unavailable)?;
            return Ok(());
        }
        invitation.revoked = true;
        if let Some(id) = invitation.claim_id {
            let claim = store::claim(&tx, id)?.ok_or(HostError::PeerMembershipRecoveryRequired)?;
            validate_claim(&claim, id)?;
            if claim.ready.is_none() {
                let mut member = current_member(&tx, &claim.receipt.evidence)?;
                member.record.revoked = true;
                member.record.generation = member
                    .record
                    .generation
                    .checked_add(1)
                    .ok_or(HostError::PeerMembershipConflict)?;
                store::save_member(&tx, &member)?;
            }
        }
        store::save_invitation(&tx, &invitation)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "membership_tests.rs"]
mod tests;
