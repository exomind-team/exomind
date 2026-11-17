use super::{
    PeerJoinState,
    membership::PeerInvitation,
    network_store::{self, PeerNetworkSettings, Route},
};
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, OriginCursor, OriginIdentity, ProfileId};
use std::net::SocketAddr;

impl PeerInvitation {
    /// Read the explicitly supplied invitation; this does not provision a
    /// profile or turn a self-signed key into a trusted member.
    pub fn verified_offer(&self) -> Result<super::PeerInvitationOffer, HostError> {
        super::membership::verified_invitation_offer(self)
    }
}
impl BetaHost {
    pub fn peer_rejoin_expectation(
        &self,
        owner: &Session,
        profile: ProfileId,
        issuer: DeviceId,
    ) -> Result<Option<super::PeerRejoinExpectation>, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let resources = crate::resources(&state)?;
        let local =
            super::membership_store::member(&resources.persistence.auth, profile, self.device_id)?;
        let remote = super::membership_store::member(&resources.persistence.auth, profile, issuer)?;
        match (local, remote) {
            (None, None) => Ok(None),
            (Some(local), Some(remote)) => {
                let previous = remote
                    .claim_id
                    .or(local.claim_id)
                    .ok_or(HostError::PeerMembershipConflict)?;
                Ok(Some(super::PeerRejoinExpectation {
                    previous_claim_id: previous,
                    expected_local_generation: local.record.generation,
                    expected_issuer_generation: remote.record.generation,
                }))
            }
            _ => Err(HostError::PeerMembershipConflict),
        }
    }
    pub fn peer_replacement_request(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        invitation_id: uuid::Uuid,
        claim_id: uuid::Uuid,
    ) -> Result<super::ApprovePeerInvitationReplacement, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let resources = crate::resources(&state)?;
        let member = super::membership_store::member(&resources.persistence.auth, profile, device)?
            .ok_or(HostError::NotFound)?;
        Ok(super::ApprovePeerInvitationReplacement {
            invitation_id,
            claim_id,
            device_id: device,
            previous_claim_id: member.claim_id.ok_or(HostError::PeerMembershipConflict)?,
            expected_generation: member.record.generation,
        })
    }
    pub fn peer_network_settings(&self, owner: &Session) -> Result<PeerNetworkSettings, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        network_store::settings(&crate::resources(&state)?.persistence.auth)
    }
    pub fn save_peer_network_settings(
        &self,
        owner: &Session,
        value: PeerNetworkSettings,
    ) -> Result<(), HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = super::membership_store::transaction(&mut resources.persistence.auth)?;
        network_store::save_settings(&tx, value)?;
        tx.commit()?;
        Ok(())
    }
    pub fn save_peer_routes(
        &self,
        owner: &Session,
        profile: ProfileId,
        device: DeviceId,
        endpoints: Vec<SocketAddr>,
    ) -> Result<(), HostError> {
        network_store::validate_endpoints(&endpoints)?;
        let mut state = self.active_state()?;
        self.owner(owner)?;
        if device == self.device_id {
            return Err(HostError::InvalidRequest);
        }
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        resources.core.local_human(profile)?;
        let member = super::membership_store::member(&resources.persistence.auth, profile, device)?
            .ok_or(HostError::NotFound)?;
        if member.record.revoked || member.record.state != PeerJoinState::Ready {
            return Err(HostError::PeerMembershipDenied);
        }
        let tx = super::membership_store::transaction(&mut resources.persistence.auth)?;
        network_store::save_route(
            &tx,
            &Route {
                profile,
                device,
                endpoints,
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub(super) fn peer_routes(&self, owner: &Session) -> Result<Vec<Route>, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        network_store::routes(&crate::resources(&state)?.persistence.auth)
    }
    pub fn local_origin_state(
        &self,
        owner: &Session,
        profile: ProfileId,
    ) -> Result<(OriginIdentity, OriginCursor), HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let core = &crate::resources(&state)?.core;
        let reader = core.local_human(profile)?;
        Ok((
            core.replication_identity(&reader, profile)?,
            core.origin_checkpoint(&reader, profile)?,
        ))
    }
    /// Bounded metadata-only hint for anti-entropy. Never a fact/proof ACK or
    /// profile capability; a real transfer still requalifies every page.
    pub fn local_history_fingerprint(
        &self,
        owner: &Session,
        profile: ProfileId,
    ) -> Result<String, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let core = &crate::resources(&state)?.core;
        let reader = core.local_human(profile)?;
        super::source_history::inventory_fingerprint(
            profile,
            &core.origin_inventory(&reader, profile, super::source_history::MAX_SOURCES)?,
        )
    }
}
