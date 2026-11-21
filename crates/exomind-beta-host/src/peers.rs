//! Device-key transport and durable profile membership. A verified key alone is not a profile
//! member, local owner, human writer or grant.
mod authorization;
mod original_transfer;
#[cfg(test)]
mod test_discovery;
pub use original_transfer::{OriginalTransferOptions, OriginalTransferResult};
pub(crate) mod framing;
pub(crate) mod identity;
mod origin_proof;
mod source_history;
mod network;
mod network_management;
mod network_store;
mod connection_store;
pub use connection_store::{
    ConnectionKind as PeerConnectionKind, LastTestState as PeerConnectionTestState,
    PeerConnection as PeerNetworkConnection, PeerEnvironment as PeerEnvironmentRecord,
};
pub use network_management::{EnvironmentAliasSource, EnvironmentAliasView};
mod original_admission;
mod original_auto_store;
pub use original_auto_store::{
    DEFAULT_ORIGINAL_AUTO_BYTES, MAX_ORIGINAL_AUTO_BYTES, MIN_ORIGINAL_AUTO_BYTES,
    OriginalAutoBackoff, OriginalAutoPolicy, OriginalAutoPolicyCommand, OriginalAutoSuppression,
    OriginalAutoSuppressionCommand, OriginalLocalIntent,
};
pub(crate) mod sync_store;
pub use network::{
    NearbyPeerCandidate, NetworkScanResult, OriginalAutoQueueStatus, PeerConnectionView,
    PeerNetwork, PeerNetworkStatus, PeerOriginalStatus, ScanScope,
};
mod service;
pub use network_store::{MAX_ENVIRONMENT_ALIAS_CHARS, PeerNetworkSettings};
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
use exomind_core::{
    Core, OriginPage, OriginPageProof, OriginPageQuery, OriginProvenanceKey, ProfileId,
};
pub use identity::DeviceIdentityInfo;
pub(crate) use identity::Identity;
use std::{
    net::SocketAddr,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

pub(crate) fn sign_archive_origin_page(
    identity: &Identity,
    core: &Core,
    profile: ProfileId,
    query: &OriginPageQuery,
) -> Result<(OriginPage, OriginProvenanceKey, OriginPageProof), HostError> {
    let signed = origin_proof::export_local_archive_page(identity, core, profile, query)?;
    let key = OriginProvenanceKey {
        public_key_spki: signed.signer.spki_der.clone(),
        fingerprint_sha256: signed.signer.fingerprint_sha256.clone(),
    };
    let proof = OriginPageProof {
        entry_signatures: signed.entry_signatures,
        through_signature: signed.through_signature,
    };
    Ok((signed.page, key, proof))
}

/// Verify historical source positions without granting live peer membership.
pub(crate) fn verify_archive_origin_page(
    page: &OriginPage,
    key: &OriginProvenanceKey,
    proof: &OriginPageProof,
) -> Result<(), HostError> {
    let signer = DeviceIdentityInfo {
        device_id: page.origin.device_id,
        spki_der: key.public_key_spki.clone(),
        fingerprint_sha256: key.fingerprint_sha256.clone(),
    };
    let signed = origin_proof::SignedOriginPage {
        page: page.clone(),
        signer: signer.clone(),
        through_signature: proof.through_signature.clone(),
        entry_signatures: proof.entry_signatures.clone(),
    };
    signed.verify_positions(&page.origin, &signer)
}

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
    listener_address: Option<SocketAddr>,
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
            counts.listener_address = None;
        }
        Ok(Lease {
            runtime: self.clone(),
            listener,
        })
    }
    pub(crate) fn request_stop(&self) {
        self.cancel.cancel();
    }
    pub(crate) fn set_listener_address(&self, address: SocketAddr) -> Result<(), HostError> {
        let mut counts = self.counts.lock().map_err(|_| HostError::StatePoisoned)?;
        if !counts.listener {
            return Err(HostError::PeerTransportUnavailable);
        }
        counts.listener_address = Some(address);
        Ok(())
    }
    pub(crate) fn listener_address(&self) -> Option<SocketAddr> {
        self.counts
            .lock()
            .ok()
            .and_then(|counts| counts.listener_address)
    }
    pub(crate) fn clear_listener_address(&self, address: SocketAddr) {
        if let Ok(mut counts) = self.counts.lock() {
            if counts.listener_address == Some(address) {
                counts.listener_address = None;
            }
        }
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
            counts.listener_address = None;
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
