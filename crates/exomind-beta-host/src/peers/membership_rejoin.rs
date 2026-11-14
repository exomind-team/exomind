//! Explicit Owner decisions replace only a known prior claim. Both Hosts keep
//! their own generation counters; signatures and old ledgers stay unchanged.
use super::*;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(in crate::peers) struct IssuerReplacement {
    pub request: ApprovePeerInvitationReplacement,
    pub previous: StoredMember,
    pub reserved: StoredMember,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(in crate::peers) struct JoinerReplacement {
    pub expectation: PeerRejoinExpectation,
    pub previous_local: StoredMember,
    pub previous_issuer: StoredMember,
    pub reserved_local: StoredMember,
    pub reserved_issuer: StoredMember,
}

fn advance(
    previous: &StoredMember,
    claim_id: Uuid,
    caps: PeerCapabilities,
) -> Result<StoredMember, HostError> {
    let generation = previous
        .record
        .generation
        .checked_add(1)
        .filter(|g| *g <= i64::MAX as u64)
        .ok_or(HostError::PeerMembershipConflict)?;
    let mut next = previous.clone();
    next.record.generation = generation;
    next.record.capabilities = caps;
    next.record.revoked = false;
    next.record.state = PeerJoinState::Pending;
    next.claim_id = Some(claim_id);
    Ok(next)
}
fn valid_claim_ids(previous: Uuid, next: Uuid) -> bool {
    !previous.is_nil() && !next.is_nil() && previous != next
}
fn prior_pair(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    local: DeviceId,
    remote: DeviceId,
    local_pin: &str,
    remote_pin: &str,
    id: Uuid,
) -> Result<bool, HostError> {
    if let Some(pending) = store::pending(connection, id)? {
        validate_pending(&pending, id)?;
        if pending.signed.offer.profile_id != profile
            || pending.binding.joiner_device_id != local
            || pending.signed.offer.issuer.device_id != remote
            || pending.binding.joiner_pin != local_pin
            || pending.signed.offer.issuer.fingerprint_sha256 != remote_pin
        {
            return Err(HostError::PeerMembershipConflict);
        }
        return Ok(false);
    }
    let Some(claim) = store::claim(connection, id)? else {
        // A durable Owner reservation is a real pre-claim phase. It may be
        // explicitly replaced after expiry; absence of a claim row here is not
        // corruption while the original invitation approval proves ownership.
        let invitation = store::replacement_invitation(connection, id)?
            .ok_or(HostError::PeerMembershipRecoveryRequired)?;
        validate_invitation(&invitation, invitation.signed.offer.invitation_id)?;
        let approval = invitation
            .replacement
            .as_ref()
            .ok_or(HostError::PeerMembershipRecoveryRequired)?;
        if invitation.signed.offer.profile_id != profile
            || invitation.signed.offer.issuer.device_id != local
            || invitation.signed.offer.issuer.fingerprint_sha256 != local_pin
            || approval.request.device_id != remote
            || approval.reserved.record.pin != remote_pin
        {
            return Err(HostError::PeerMembershipConflict);
        }
        return Ok(true);
    };
    validate_claim(&claim, id)?;
    if claim.receipt.evidence.profile_id != profile
        || claim.receipt.evidence.issuer.device_id != local
        || claim.receipt.evidence.joiner_device_id != remote
        || claim.receipt.evidence.issuer.fingerprint_sha256 != local_pin
        || claim.receipt.evidence.joiner_pin != remote_pin
    {
        return Err(HostError::PeerMembershipConflict);
    }
    Ok(true)
}
pub(super) fn require_reserved(
    connection: &rusqlite::Connection,
    expected: &StoredMember,
) -> Result<StoredMember, HostError> {
    let current = store::member(
        connection,
        expected.record.profile_id,
        expected.record.device_id,
    )?
    .ok_or(HostError::PeerMembershipRecoveryRequired)?;
    if &current != expected {
        return Err(HostError::PeerMembershipDenied);
    }
    Ok(current)
}
pub(super) fn issuer_reservation(
    connection: &rusqlite::Connection,
    invitation: &StoredInvitation,
    claim: &ClaimBinding,
) -> Result<StoredMember, HostError> {
    let replacement = invitation
        .replacement
        .as_ref()
        .ok_or(HostError::PeerMembershipConflict)?;
    if replacement.request.claim_id != claim.claim_id
        || replacement.request.device_id != claim.joiner_device_id
        || replacement.reserved.record.pin != claim.joiner_pin
    {
        return Err(HostError::PeerMembershipDenied);
    }
    require_reserved(connection, &replacement.reserved)
}
pub(super) fn joiner_reservations(
    connection: &rusqlite::Connection,
    pending: &StoredPending,
) -> Result<(StoredMember, StoredMember), HostError> {
    let replacement = pending
        .replacement
        .as_ref()
        .ok_or(HostError::PeerMembershipConflict)?;
    Ok((
        require_reserved(connection, &replacement.reserved_local)?,
        require_reserved(connection, &replacement.reserved_issuer)?,
    ))
}
pub(super) fn validate_issuer(invitation: &StoredInvitation) -> Result<(), HostError> {
    let Some(replacement) = &invitation.replacement else {
        return Ok(());
    };
    let request = &replacement.request;
    let offer = &invitation.signed.offer;
    if !valid_claim_ids(request.previous_claim_id, request.claim_id)
        || request.invitation_id != offer.invitation_id
        || request.device_id == offer.issuer.device_id
        || replacement.previous.record.profile_id != offer.profile_id
        || replacement.previous.record.device_id != request.device_id
        || replacement.previous.claim_id != Some(request.previous_claim_id)
        || replacement.previous.record.generation != request.expected_generation
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    store::validate_member(&replacement.previous.record)?;
    if advance(&replacement.previous, request.claim_id, offer.capabilities)
        .map_err(|_| HostError::PeerMembershipRecoveryRequired)?
        != replacement.reserved
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    Ok(())
}
pub(super) fn validate_joiner(pending: &StoredPending) -> Result<(), HostError> {
    let Some(replacement) = &pending.replacement else {
        return Ok(());
    };
    let expectation = &replacement.expectation;
    let offer = &pending.signed.offer;
    if !valid_claim_ids(expectation.previous_claim_id, pending.binding.claim_id)
        || replacement.previous_local.record.profile_id != offer.profile_id
        || replacement.previous_issuer.record.profile_id != offer.profile_id
        || replacement.previous_local.record.device_id != pending.binding.joiner_device_id
        || replacement.previous_issuer.record.device_id != offer.issuer.device_id
        || replacement.previous_local.record.pin != pending.binding.joiner_pin
        || replacement.previous_issuer.record.pin != offer.issuer.fingerprint_sha256
        || replacement.previous_local.record.generation != expectation.expected_local_generation
        || replacement.previous_issuer.record.generation != expectation.expected_issuer_generation
        || replacement.previous_issuer.claim_id != Some(expectation.previous_claim_id)
        || replacement
            .previous_local
            .claim_id
            .is_some_and(|id| id != expectation.previous_claim_id)
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    store::validate_member(&replacement.previous_local.record)?;
    store::validate_member(&replacement.previous_issuer.record)?;
    if advance(
        &replacement.previous_local,
        pending.binding.claim_id,
        offer.capabilities,
    )
    .map_err(|_| HostError::PeerMembershipRecoveryRequired)?
        != replacement.reserved_local
        || advance(
            &replacement.previous_issuer,
            pending.binding.claim_id,
            PeerCapabilities::FULL,
        )
        .map_err(|_| HostError::PeerMembershipRecoveryRequired)?
            != replacement.reserved_issuer
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    if pending.receipt.is_some()
        && (pending.local_generation != Some(replacement.reserved_local.record.generation)
            || pending.issuer_generation != Some(replacement.reserved_issuer.record.generation))
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    Ok(())
}

impl BetaHost {
    pub fn approve_peer_invitation_replacement(
        &self,
        owner: &Session,
        request: &ApprovePeerInvitationReplacement,
    ) -> Result<PeerInvitationStatus, HostError> {
        if !valid_claim_ids(request.previous_claim_id, request.claim_id) {
            return Err(HostError::InvalidRequest);
        }
        let mut state = self.active_state()?;
        self.owner(owner)?;
        if request.device_id == self.device_id {
            return Err(HostError::InvalidRequest);
        }
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let now = store::now(&tx, self.clock.sample().wall_ms)?;
        let mut invitation =
            store::invitation(&tx, request.invitation_id)?.ok_or(HostError::NotFound)?;
        validate_invitation(&invitation, request.invitation_id)?;
        require_compatible_offer(&invitation.signed.offer)?;
        if invitation.revoked {
            return Err(HostError::PeerInvitationRevoked);
        }
        if let Some(approval) = &invitation.replacement {
            if &approval.request != request {
                return Err(HostError::PeerMembershipConflict);
            }
            if let Some(id) = invitation.claim_id {
                let claim =
                    store::claim(&tx, id)?.ok_or(HostError::PeerMembershipRecoveryRequired)?;
                validate_claim(&claim, id)?;
                current_member(&tx, &claim.receipt.evidence)?;
            } else {
                require_reserved(&tx, &approval.reserved)?;
            }
            let result = live_invitation_status(&tx, &invitation, now)?;
            tx.commit().map_err(store::unavailable)?;
            return Ok(result);
        }
        if invitation.claim_id.is_some() {
            return Err(HostError::PeerInvitationConsumed);
        }
        if now >= invitation.signed.offer.expires_at_unix_ms {
            tx.commit().map_err(store::unavailable)?;
            return Err(HostError::PeerInvitationExpired);
        }
        if store::claim(&tx, request.claim_id)?.is_some()
            || store::pending(&tx, request.claim_id)?.is_some()
            || store::replacement_invitation(&tx, request.claim_id)?.is_some()
        {
            return Err(HostError::PeerMembershipConflict);
        }
        let profile = invitation.signed.offer.profile_id;
        let previous =
            store::member(&tx, profile, request.device_id)?.ok_or(HostError::NotFound)?;
        if previous.claim_id != Some(request.previous_claim_id)
            || previous.record.generation != request.expected_generation
        {
            return Err(HostError::PeerMembershipConflict);
        }
        prior_pair(
            &tx,
            profile,
            self.device_id,
            request.device_id,
            &invitation.signed.offer.issuer.fingerprint_sha256,
            &previous.record.pin,
            request.previous_claim_id,
        )?;
        let reserved = advance(
            &previous,
            request.claim_id,
            invitation.signed.offer.capabilities,
        )?;
        store::save_member(&tx, &reserved)?;
        invitation.replacement = Some(IssuerReplacement {
            request: request.clone(),
            previous,
            reserved,
        });
        validate_issuer(&invitation)?;
        store::save_invitation(&tx, &invitation)?;
        let result = live_invitation_status(&tx, &invitation, now)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(result)
    }

    pub fn prepare_peer_rejoin(
        &self,
        owner: &Session,
        invitation: &PeerInvitation,
        claim_id: Uuid,
        expectation: &PeerRejoinExpectation,
    ) -> Result<PeerJoinClaim, HostError> {
        if !valid_claim_ids(expectation.previous_claim_id, claim_id) {
            return Err(HostError::InvalidRequest);
        }
        let signed = SignedOffer {
            offer: invitation.offer.clone(),
            signature: invitation.signature.clone(),
        };
        validate_offer(&signed)?;
        let identity = self.transport_identity(owner)?;
        if signed.offer.issuer.device_id == self.device_id {
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
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        r.core.local_human(signed.offer.profile_id)?;
        let tx = store::transaction(&mut r.persistence.auth)?;
        let now = store::now(&tx, self.clock.sample().wall_ms)?;
        let mut pending = store::pending(&tx, claim_id)?;
        if let Some(existing) = &pending {
            validate_pending(existing, claim_id)?;
            if existing.signed != signed || existing.binding != binding {
                return Err(HostError::PeerMembershipConflict);
            }
            if let Some(approval) = &existing.replacement {
                if &approval.expectation != expectation {
                    return Err(HostError::PeerMembershipConflict);
                }
                if existing.receipt.is_some() {
                    pending_members(&tx, existing)?;
                } else {
                    joiner_reservations(&tx, existing)?;
                }
                tx.commit().map_err(store::unavailable)?;
                return Ok(claim);
            }
            if existing.receipt.is_some() {
                return Err(HostError::PeerMembershipConflict);
            }
        } else {
            if now >= signed.offer.expires_at_unix_ms {
                tx.commit().map_err(store::unavailable)?;
                return Err(HostError::PeerInvitationExpired);
            }
            store::reserve(&tx, "peer_pending", store::MAX_JOINS)?;
        }
        let profile = signed.offer.profile_id;
        let previous_local =
            store::member(&tx, profile, self.device_id)?.ok_or(HostError::NotFound)?;
        let previous_issuer = store::member(&tx, profile, signed.offer.issuer.device_id)?
            .ok_or(HostError::NotFound)?;
        if previous_local.record.generation != expectation.expected_local_generation
            || previous_issuer.record.generation != expectation.expected_issuer_generation
            || previous_issuer.claim_id != Some(expectation.previous_claim_id)
            || previous_local
                .claim_id
                .is_some_and(|id| id != expectation.previous_claim_id)
        {
            return Err(HostError::PeerMembershipConflict);
        }
        // Different key under the same UUID remains an identity-recovery case,
        // never an invitation/rejoin capability.
        if previous_local.record.pin != identity.info.fingerprint_sha256
            || previous_issuer.record.pin != signed.offer.issuer.fingerprint_sha256
        {
            return Err(HostError::PeerMembershipDenied);
        }
        let local_was_issuer = prior_pair(
            &tx,
            profile,
            self.device_id,
            signed.offer.issuer.device_id,
            &identity.info.fingerprint_sha256,
            &previous_issuer.record.pin,
            expectation.previous_claim_id,
        )?;
        if previous_local.claim_id.is_none() && !local_was_issuer {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        let reserved_local = advance(&previous_local, claim_id, signed.offer.capabilities)?;
        let reserved_issuer = advance(&previous_issuer, claim_id, PeerCapabilities::FULL)?;
        let replacement = JoinerReplacement {
            expectation: expectation.clone(),
            previous_local,
            previous_issuer,
            reserved_local: reserved_local.clone(),
            reserved_issuer: reserved_issuer.clone(),
        };
        let mut row = pending.take().unwrap_or(StoredPending {
            signed,
            binding,
            receipt: None,
            ready: None,
            issuer_generation: None,
            local_generation: None,
            replacement: None,
        });
        row.replacement = Some(replacement);
        validate_joiner(&row)?;
        store::save_member(&tx, &reserved_local)?;
        store::save_member(&tx, &reserved_issuer)?;
        store::save_pending(&tx, &row)?;
        tx.commit().map_err(store::unavailable)?;
        Ok(claim)
    }
}
