//! Host authorization and DTO boundary for original lifecycle commands.
//!
//! The Core owns facts and local bytes. Host admits only the local owner for
//! destructive human actions and presents remote members as probe candidates;
//! membership alone never claims that a peer still has the bytes.

use crate::{BetaHost, HostError, Session};
use exomind_core::{
    DeviceId, OriginalBytesState, OriginalId, OriginalLifecycleClock, OriginalLifecycleCommand,
    OriginalLifecycleFollowupPage, OriginalLifecycleStatus, ProfileId,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Adjustable engineering default; not a user-selected preference.
pub const DEFAULT_ORIGINAL_RECLAIM_WINDOW: Duration =
    Duration::from_millis(exomind_core::DEFAULT_ORIGINAL_RECLAIM_WINDOW_MS);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteOriginalProbeState {
    NeedsProbe,
    Fetchable,
    Missing,
    Denied,
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleRemoteSource {
    pub device_id: DeviceId,
    /// `NeedsProbe` means membership and `read_originals` capability were
    /// checked. It is not a claim that this peer has a verified copy.
    pub state: RemoteOriginalProbeState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleHostStatus {
    pub local: OriginalLifecycleStatus,
    pub remote_sources: Vec<OriginalLifecycleRemoteSource>,
}

/// Whether an existing missing-original queue row can start an automatic
/// transfer. Released originals require a new human restore command first.
pub(crate) fn automatic_fetch_allowed(state: OriginalBytesState) -> bool {
    matches!(
        state,
        OriginalBytesState::Missing | OriginalBytesState::RestorePending
    )
}

impl BetaHost {
    /// Returns profile-scoped local state and authorized peer candidates.
    /// A caller must probe a candidate before presenting it as fetchable.
    pub fn original_lifecycle_status(
        &self,
        owner: &Session,
        profile: ProfileId,
        original: OriginalId,
    ) -> Result<OriginalLifecycleHostStatus, HostError> {
        self.owner(owner)?;
        let local = {
            let state = self.active_state()?;
            let resources = crate::resources(&state)?;
            let human = resources.core.local_human(profile)?;
            resources
                .core
                .original_lifecycle_status(&human, profile, original)?
        };
        let remote_sources = self
            .peer_members(owner, profile)?
            .into_iter()
            .filter(|member| {
                member.device_id != self.device_id
                    && !member.revoked
                    && member.state == crate::peers::PeerJoinState::Ready
                    && member.capabilities.read_originals
            })
            .map(|member| OriginalLifecycleRemoteSource {
                device_id: member.device_id,
                state: RemoteOriginalProbeState::NeedsProbe,
            })
            .collect();
        Ok(OriginalLifecycleHostStatus {
            local,
            remote_sources,
        })
    }

    /// Applies a local human lifecycle command. Receiving a replicated release
    /// fact never calls this method and cannot mutate another device's bytes.
    pub fn apply_original_lifecycle(
        &self,
        owner: &Session,
        command: &OriginalLifecycleCommand,
    ) -> Result<exomind_core::Receipt, HostError> {
        self.owner(owner)?;
        let replay = {
            let state = self.active_state()?;
            let resources = crate::resources(&state)?;
            let human = resources.core.local_human(command.profile_id)?;
            resources.core.original_lifecycle_replay(&human, command)?
        };
        if let Some(receipt) = replay {
            return Ok(receipt);
        }
        if !command.follow_up_device_ids.is_empty() {
            let members = self.peer_members(owner, command.profile_id)?;
            if command.follow_up_device_ids.iter().any(|target| {
                !members.iter().any(|member| {
                    member.device_id == *target
                        && !member.revoked
                        && member.state == crate::peers::PeerJoinState::Ready
                        && member.capabilities.read_originals
                })
            }) {
                return Err(HostError::PeerMembershipDenied);
            }
        }
        let sample = self.clock.sample()?;
        if sample.wall_ms < 0 {
            return Err(HostError::ClockUnavailable);
        }
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        let human = resources.core.local_human(command.profile_id)?;
        Ok(resources.core.apply_original_lifecycle_with_clock(
            &human,
            command,
            OriginalLifecycleClock {
                epoch_id: sample.epoch_id,
                wall_ms: sample.wall_ms,
                elapsed_ms: sample.elapsed_ms,
            },
            self.original_reclaim_window_ms,
        )?)
    }

    /// Explicitly retries bytes after a failed hash verification. The Core
    /// keeps the original restore request and command identity pending.
    pub fn retry_failed_original_restore(
        &self,
        owner: &Session,
        profile: ProfileId,
        original: OriginalId,
    ) -> Result<exomind_core::OriginalRestoreRetry, HostError> {
        self.owner(owner)?;
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        let human = resources.core.local_human(profile)?;
        Ok(resources
            .core
            .retry_failed_original_restore(&human, profile, original)?)
    }

    /// Lists explicit release requests addressed to this device. A returned
    /// request is informational; the local human must submit its own release.
    pub fn original_lifecycle_followups(
        &self,
        owner: &Session,
        profile: ProfileId,
        after: Option<exomind_core::EventId>,
        limit: usize,
    ) -> Result<OriginalLifecycleFollowupPage, HostError> {
        self.owner(owner)?;
        let state = self.active_state()?;
        let resources = crate::resources(&state)?;
        let human = resources.core.local_human(profile)?;
        Ok(resources.core.original_lifecycle_followups(
            &human,
            profile,
            self.device_id,
            after,
            limit,
        )?)
    }
}

#[cfg(test)]
#[path = "original_lifecycle_tests.rs"]
mod tests;
