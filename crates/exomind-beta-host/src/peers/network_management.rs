use super::{
    PeerJoinState,
    membership::PeerInvitation,
    network_store::{
        self, MAX_ENVIRONMENT_ALIAS_BYTES, MAX_ENVIRONMENT_ALIAS_CHARS, PeerNetworkSettings, Route,
    },
};
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, OriginCursor, OriginIdentity, ProfileId};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvironmentAliasSource {
    Custom,
    OsDefault,
    StableId,
}

impl EnvironmentAliasSource {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Custom => "custom",
            Self::OsDefault => "os_default",
            Self::StableId => "stable_id",
        }
    }

    pub(crate) fn from_storage(value: &str) -> Option<Self> {
        match value {
            "custom" => Some(Self::Custom),
            "os_default" => Some(Self::OsDefault),
            "stable_id" => Some(Self::StableId),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentAliasView {
    pub device_id: DeviceId,
    pub effective_alias: String,
    pub source: EnvironmentAliasSource,
    pub custom_alias: Option<String>,
    pub max_chars: usize,
}

#[cfg(windows)]
fn os_host_name() -> Option<String> {
    use windows::Win32::System::SystemInformation::{
        ComputerNameDnsHostname, GetComputerNameExW,
    };
    use windows::core::PWSTR;

    let mut buffer = [0u16; 256];
    let mut length = buffer.len() as u32;
    unsafe {
        GetComputerNameExW(
            ComputerNameDnsHostname,
            Some(PWSTR(buffer.as_mut_ptr())),
            &mut length,
        )
        .ok()?;
    }
    let length = usize::try_from(length).ok()?.min(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..length]))
}

#[cfg(target_os = "android")]
fn android_property(name: &str) -> Option<String> {
    use std::{ffi::CString, os::raw::c_char};

    let name = CString::new(name).ok()?;
    let mut buffer = [0 as c_char; 128];
    let length = unsafe { libc::__system_property_get(name.as_ptr(), buffer.as_mut_ptr()) };
    if length <= 0 {
        return None;
    }
    let bytes = buffer[..usize::try_from(length).ok()?]
        .iter()
        .map(|value| *value as u8)
        .collect::<Vec<_>>();
    String::from_utf8(bytes).ok()
}

#[cfg(target_os = "android")]
fn os_host_name() -> Option<String> {
    ["ro.product.model", "ro.product.device", "ro.product.name"]
        .into_iter()
        .find_map(android_property)
}

#[cfg(all(unix, not(target_os = "android")))]
fn os_host_name() -> Option<String> {
    let mut buffer = [0u8; 256];
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return None;
    }
    let length = buffer.iter().position(|byte| *byte == 0)?;
    String::from_utf8(buffer[..length].to_vec()).ok()
}

#[cfg(not(any(windows, unix)))]
fn os_host_name() -> Option<String> {
    None
}

/// Alias text is display-only. Collapsing whitespace and rejecting controls
/// keeps the same value bounded and stable across SQLite, JSON and UI layers.
pub(crate) fn normalize_environment_alias(raw: &str) -> Result<String, HostError> {
    if raw.len() > MAX_ENVIRONMENT_ALIAS_BYTES * 4
        || raw
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
    {
        return Err(HostError::InvalidRequest);
    }
    let normalized = raw
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty()
        || normalized.chars().count() > MAX_ENVIRONMENT_ALIAS_CHARS
        || normalized.len() > MAX_ENVIRONMENT_ALIAS_BYTES
    {
        return Err(HostError::InvalidRequest);
    }
    Ok(normalized)
}

pub(crate) fn stable_environment_alias(device: DeviceId) -> String {
    format!("外心 {}", device.to_string().chars().take(8).collect::<String>())
}

fn environment_alias_view(
    device: DeviceId,
    custom_alias: Option<String>,
) -> EnvironmentAliasView {
    let (effective_alias, source) = if let Some(alias) = custom_alias.as_ref() {
        (alias.clone(), EnvironmentAliasSource::Custom)
    } else if let Some(host_name) = os_host_name()
        .as_deref()
        .and_then(|value| normalize_environment_alias(value).ok())
    {
        (host_name, EnvironmentAliasSource::OsDefault)
    } else {
        (
            stable_environment_alias(device),
            EnvironmentAliasSource::StableId,
        )
    };
    EnvironmentAliasView {
        device_id: device,
        effective_alias,
        source,
        custom_alias,
        max_chars: MAX_ENVIRONMENT_ALIAS_CHARS,
    }
}

impl PeerInvitation {
    /// Read the explicitly supplied invitation; this does not provision a
    /// profile or turn a self-signed key into a trusted member.
    pub fn verified_offer(&self) -> Result<super::PeerInvitationOffer, HostError> {
        super::membership::verified_invitation_offer(self)
    }
}
impl BetaHost {
    pub fn environment_alias(&self, owner: &Session) -> Result<EnvironmentAliasView, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let custom =
            network_store::custom_environment_alias(&crate::resources(&state)?.persistence.auth)?;
        Ok(environment_alias_view(self.device_id, custom))
    }
    pub(super) fn environment_alias_announcement(
        &self,
        owner: &Session,
    ) -> Result<(String, EnvironmentAliasSource, u64), HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = super::membership_store::transaction(&mut resources.persistence.auth)?;
        let (custom, _) = network_store::environment_alias_state(&tx)?;
        let view = environment_alias_view(self.device_id, custom);
        let revision =
            network_store::advance_environment_alias_announcement(&tx, &view.effective_alias, view.source)?;
        tx.commit()?;
        Ok((view.effective_alias, view.source, revision))
    }

    /// `None` resets the device-global alias to the current OS-derived default.
    pub fn set_environment_alias(
        &self,
        owner: &Session,
        alias: Option<String>,
    ) -> Result<EnvironmentAliasView, HostError> {
        let normalized = alias
            .map(|value| normalize_environment_alias(&value))
            .transpose()?;
        let view = environment_alias_view(self.device_id, normalized.clone());
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = super::membership_store::transaction(&mut resources.persistence.auth)?;
        network_store::save_custom_environment_alias(&tx, normalized.as_deref())?;
        network_store::set_environment_alias_announcement(&tx, &view.effective_alias, view.source)?;
        tx.commit()?;
        Ok(view)
    }

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
    pub fn peer_environments(
        &self,
        owner: &Session,
    ) -> Result<Vec<super::PeerEnvironmentRecord>, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        super::connection_store::list_environments(&crate::resources(&state)?.persistence.auth)
    }
    pub fn peer_connections(
        &self,
        owner: &Session,
    ) -> Result<Vec<super::PeerNetworkConnection>, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        super::connection_store::list_connections(&crate::resources(&state)?.persistence.auth)
    }
    /// Changes only this device's permission to dial the connection. Membership,
    /// grants and the peer's own enabled state remain untouched.
    pub fn set_peer_connection_enabled(
        &self,
        owner: &Session,
        connection_id: uuid::Uuid,
        expected_revision: u64,
        enabled: bool,
    ) -> Result<super::PeerNetworkConnection, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let wall_ms = self.clock.sample()?.wall_ms;
        super::connection_store::set_local_enabled_cas(
            &mut resources.persistence.auth,
            connection_id,
            expected_revision,
            enabled,
            wall_ms,
        )
    }
    pub(super) fn peer_alias_claims(
        &self,
        owner: &Session,
    ) -> Result<
        std::collections::HashMap<(DeviceId, String), network_store::PeerAliasClaim>,
        HostError,
    > {
        let state = self.active_state()?;
        self.owner(owner)?;
        network_store::alias_claims(&crate::resources(&state)?.persistence.auth)
    }
    pub(super) fn peer_alias_claim(
        &self,
        owner: &Session,
        device: DeviceId,
        pin: &str,
    ) -> Result<Option<network_store::PeerAliasClaim>, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        network_store::alias_claim(
            &crate::resources(&state)?.persistence.auth,
            device,
            pin,
        )
    }
    pub(super) fn record_observed_peer_alias(
        &self,
        owner: &Session,
        device: DeviceId,
        pin: &str,
        effective_alias: &str,
        source: EnvironmentAliasSource,
        revision: u64,
        observed_at_ms: i64,
    ) -> Result<bool, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = super::membership_store::transaction(&mut resources.persistence.auth)?;
        let saved = network_store::save_observed_alias(
            &tx,
            device,
            pin,
            effective_alias,
            source,
            revision,
            observed_at_ms,
        )?;
        tx.commit()?;
        Ok(saved)
    }
    pub(super) fn record_confirmed_peer_alias(
        &self,
        owner: &Session,
        device: DeviceId,
        pin: &str,
        effective_alias: &str,
        source: EnvironmentAliasSource,
        revision: u64,
        confirmed_at_ms: i64,
    ) -> Result<(), HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = super::membership_store::transaction(&mut resources.persistence.auth)?;
        network_store::confirm_alias_claim(
            &tx,
            device,
            pin,
            effective_alias,
            source,
            revision,
            confirmed_at_ms,
        )?;
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
        super::connection_store::reconcile_current_topology_in_tx(
            &tx,
            self.device_id,
            self.clock.sample()?.wall_ms,
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
