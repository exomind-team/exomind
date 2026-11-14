//! Final profile authority for peer business operations. A scope is neither a
//! local Owner/Grant Session nor a transferable token from a previous channel.
use super::{
    PeerCapabilities, PeerChannel, PeerJoinState, PeerMember, PeerPin, membership_store as store,
};
use crate::{BetaHost, HostError, Resources};
use exomind_core::{Core, DeviceId, OriginalChunk, OriginalId, ProfileId};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PeerOriginState {
    pub protocol: String,
    pub schema: i64,
    pub origin: exomind_core::OriginIdentity,
    pub head: exomind_core::OriginCursor,
}
const SYNC_PROTOCOL: &str = "exomind-peer-sync/1";

pub(super) enum PeerOperation {
    ReadTimeline,
    AppendFacts,
    ReadOriginals,
}
impl PeerOperation {
    fn permitted(&self, capabilities: PeerCapabilities) -> bool {
        match self {
            Self::ReadTimeline => capabilities.read_timeline,
            Self::AppendFacts => capabilities.append_facts,
            Self::ReadOriginals => capabilities.read_originals,
        }
    }
}
// No Deserialize, Serialize or public constructor. The scope is sealed to the
// qualified membership generation and the actual live TLS channel instance.
pub(super) struct PeerProfileScope {
    runtime_id: Uuid,
    channel_id: Uuid,
    pin: PeerPin,
    profile_id: ProfileId,
    origin_device: DeviceId,
    member_generation: u64,
    local_generation: u64,
}
struct Qualified {
    remote: PeerMember,
    local_generation: u64,
}
fn ready_member(
    resources: &Resources,
    profile: ProfileId,
    device: DeviceId,
    pin: PeerPin,
) -> Result<PeerMember, HostError> {
    let member = store::member(&resources.persistence.auth, profile, device)?
        .ok_or(HostError::PeerMembershipDenied)?
        .record;
    if member.revoked || member.state != PeerJoinState::Ready || member.pin != pin.as_sha256() {
        return Err(HostError::PeerMembershipDenied);
    }
    Ok(member)
}
fn qualify(
    host: &BetaHost,
    resources: &Resources,
    channel: &PeerChannel,
    profile: ProfileId,
    origin_device: DeviceId,
) -> Result<Qualified, HostError> {
    let pin = channel.binding_pin(host)?;
    if origin_device == host.device_id {
        return Err(HostError::PeerMembershipDenied);
    }
    store::validate(&resources.persistence.auth)?;
    let local_identity = resources
        .peer_identity
        .as_ref()
        .ok_or(HostError::PeerIdentityUnavailable)?;
    let local = ready_member(
        resources,
        profile,
        host.device_id,
        PeerPin::from_sha256(&local_identity.info.fingerprint_sha256)?,
    )?;
    // A metadata UUID or content hash never substitutes for profile authority.
    // A missing Core profile is a damaged binding, not a provision request.
    resources.core.local_human(profile)?;
    Ok(Qualified {
        remote: ready_member(resources, profile, origin_device, pin)?,
        local_generation: local.generation,
    })
}
impl BetaHost {
    pub(super) fn peer_origin_state(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
    ) -> Result<PeerOriginState, HostError> {
        self.with_peer_scope(
            channel,
            scope,
            PeerOperation::ReadTimeline,
            |core, member| {
                let reader = core.local_human(member.profile_id)?;
                Ok(PeerOriginState {
                    protocol: SYNC_PROTOCOL.into(),
                    schema: exomind_core::CORE_SCHEMA_VERSION,
                    origin: core.replication_identity(&reader, member.profile_id)?,
                    head: core.origin_checkpoint(&reader, member.profile_id)?,
                })
            },
        )
    }
    pub(super) fn peer_profile_scope(
        &self,
        channel: &PeerChannel,
        profile: ProfileId,
        origin_device: DeviceId,
    ) -> Result<PeerProfileScope, HostError> {
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        let qualified = qualify(self, resources, channel, profile, origin_device)?;
        Ok(PeerProfileScope {
            runtime_id: self.runtime_id,
            channel_id: channel.binding_id(),
            pin: channel.binding_pin(self)?,
            profile_id: profile,
            origin_device,
            member_generation: qualified.remote.generation,
            local_generation: qualified.local_generation,
        })
    }
    /// No async work or network I/O while this final qualification gate is held.
    /// The Core operation and current membership check share that same gate,
    /// so a revoked/superseded member cannot commit from an older queued scope.
    pub(super) fn with_peer_scope<T>(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        operation: PeerOperation,
        action: impl FnOnce(&Core, &PeerMember) -> Result<T, HostError>,
    ) -> Result<T, HostError> {
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        if scope.runtime_id != self.runtime_id
            || scope.channel_id != channel.binding_id()
            || scope.pin != channel.binding_pin(self)?
        {
            return Err(HostError::PeerMembershipDenied);
        }
        let qualified = qualify(
            self,
            resources,
            channel,
            scope.profile_id,
            scope.origin_device,
        )?;
        let member = qualified.remote;
        if member.generation != scope.member_generation
            || qualified.local_generation != scope.local_generation
            || !operation.permitted(member.capabilities)
        {
            return Err(HostError::PeerMembershipDenied);
        }
        action(&resources.core, &member)
    }
    /// Referenced, verified bytes only. Peer requests cannot read an author's
    /// private upload stage, source cache or UI intent, even with an original ID.
    pub(super) fn peer_original_range(
        &self,
        channel: &PeerChannel,
        scope: &PeerProfileScope,
        original: OriginalId,
        offset: u64,
        length: usize,
    ) -> Result<OriginalChunk, HostError> {
        self.with_peer_scope(
            channel,
            scope,
            PeerOperation::ReadOriginals,
            |core, member| {
                let reader = core.local_human(member.profile_id)?;
                Ok(core.read_original_range(
                    &reader,
                    member.profile_id,
                    original,
                    offset,
                    length,
                )?)
            },
        )
    }
}

#[cfg(test)]
#[path = "authorization_tests.rs"]
mod tests;
