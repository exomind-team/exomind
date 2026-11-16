//! Device-key transport and durable profile membership. A verified key alone is not a profile
//! member, local owner, human writer or grant.
mod authorization;
mod original_transfer;
#[cfg(test)]
mod test_discovery;
pub use original_transfer::{OriginalTransferOptions, OriginalTransferResult};
pub(crate) mod framing;
pub(crate) mod identity;
mod network;
mod network_management;
mod network_store;
mod original_admission;
mod original_auto_store;
pub use original_auto_store::{
    DEFAULT_ORIGINAL_AUTO_BYTES, MAX_ORIGINAL_AUTO_BYTES, MIN_ORIGINAL_AUTO_BYTES,
    OriginalAutoBackoff, OriginalAutoPolicy, OriginalAutoPolicyCommand, OriginalAutoSuppression,
    OriginalAutoSuppressionCommand, OriginalLocalIntent,
};
pub(crate) mod sync_store;
pub use network::{PeerConnectionView, PeerNetwork, PeerNetworkStatus, PeerOriginalStatus};
mod service;
pub use network_store::PeerNetworkSettings;
pub use service::{PeerProbe, PeerServiceKind, PeerServiceOutcome};
mod synchronization;
pub use synchronization::{PeerSnapshot, PeerSyncOptions, PeerSyncResult};
mod membership;
pub(crate) mod membership_store;
mod sync_ack;
pub use membership::*;
mod pairing;
mod transport;
use crate::{BetaHost, HostError, Session};
pub use identity::DeviceIdentityInfo;
pub(crate) use identity::Identity;
use std::{
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};
const MAX_CONNECTIONS: usize = 8;
pub use transport::{
    PeerCancellation, PeerChannel, PeerPin, PeerTransportListener, PeerTransportOptions,
};
pub(crate) fn load_identity(
    persistence: &mut crate::storage::Persistence,
    device: exomind_core::DeviceId,
    initialize: bool,
) -> Result<Option<Arc<Identity>>, HostError> {
    let bound = persistence.peer_identity_pin(device)?;
    let evidence = Identity::has_evidence(&persistence.root)?;
    if bound.is_some() && !evidence {
        return Err(HostError::PeerIdentityRecoveryRequired);
    }
    if !initialize && !evidence {
        return Ok(None);
    }
    let identity = Identity::open(&persistence.root, device)?;
    if bound.is_some_and(|pin| pin != identity.info.fingerprint_sha256) {
        return Err(HostError::PeerIdentityRecoveryRequired);
    }
    persistence.bind_peer_identity(device, &identity.info.fingerprint_sha256)?;
    Ok(Some(Arc::new(identity)))
}
#[derive(Default)]
struct Counts {
    jobs: usize,
    listener: bool,
}
pub(crate) struct Runtime {
    cancel: PeerCancellation,
    counts: Mutex<Counts>,
    idle: Condvar,
    connections: Arc<tokio::sync::Semaphore>,
}
struct Lease {
    runtime: Arc<Runtime>,
    listener: bool,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            cancel: PeerCancellation::new(),
            counts: Mutex::new(Counts::default()),
            idle: Condvar::new(),
            connections: Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS)),
        }
    }
}
impl Runtime {
    fn register(self: &Arc<Self>, listener: bool) -> Result<Lease, HostError> {
        let mut counts = self.counts.lock().map_err(|_| HostError::StatePoisoned)?;
        if self.cancel.is_cancelled() {
            return Err(HostError::Stopped);
        }
        if listener && counts.listener {
            return Err(HostError::PeerBusy);
        }
        counts.jobs += 1;
        if listener {
            counts.listener = true;
        }
        Ok(Lease {
            runtime: self.clone(),
            listener,
        })
    }
    pub(crate) fn request_stop(&self) {
        self.cancel.cancel();
    }
    pub(crate) fn wait_empty(&self, timeout: Duration) -> Result<(), HostError> {
        let end = Instant::now() + timeout;
        let mut counts = self.counts.lock().map_err(|_| HostError::StatePoisoned)?;
        while counts.jobs != 0 {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(HostError::Shutdown);
            }
            counts = self
                .idle
                .wait_timeout(counts, left)
                .map_err(|_| HostError::StatePoisoned)?
                .0;
        }
        Ok(())
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut counts = self
            .runtime
            .counts
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        counts.jobs -= 1;
        if self.listener {
            counts.listener = false;
        }
        self.runtime.idle.notify_all();
    }
}

impl BetaHost {
    pub fn device_identity(&self, owner: &Session) -> Result<DeviceIdentityInfo, HostError> {
        Ok(self.transport_identity(owner)?.info.clone())
    }
    pub(super) fn transport_identity(&self, owner: &Session) -> Result<Arc<Identity>, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        if resources.peer_identity.is_none() {
            resources.peer_identity =
                load_identity(&mut resources.persistence, self.device_id, true)?;
        }
        resources
            .peer_identity
            .as_ref()
            .cloned()
            .ok_or(HostError::PeerIdentityUnavailable)
    }
    pub(super) fn qualify_transport(&self, owner: &Session) -> Result<(), HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        super::resources(&state)?;
        Ok(())
    }
}
