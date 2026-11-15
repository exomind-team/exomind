//! Explicit Native download jobs. Runtime progress is bounded and disposable;
//! the Core stage offset/hash is the durable source of byte availability.
use super::*;
use crate::peers::{OriginalTransferOptions, OriginalTransferResult};
use exomind_core::{OriginalAvailability, OriginalId, OriginalRef, StageState};
use tokio::sync::Notify;

const MAX_ACTIVE: usize = 2;
const MAX_TRACKED: usize = 256;
fn transport_options() -> PeerTransportOptions {
    PeerTransportOptions {
        handshake_timeout: Duration::from_secs(3),
        channel_lifetime: Duration::from_secs(120),
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct PeerOriginalStatus {
    pub profile_id: ProfileId,
    pub original_id: OriginalId,
    pub original: OriginalRef,
    pub availability: &'static str,
    pub next_offset: u64,
    pub byte_length: u64,
    pub request_id: Option<Uuid>,
    pub peer_device_id: Option<DeviceId>,
    pub transfer_state: &'static str,
    pub last_error_code: Option<&'static str>,
}
struct Active {
    id: Uuid,
    peer: DeviceId,
    cancel: PeerCancellation,
}
struct Progress {
    active: Option<Active>,
    state: &'static str,
    error: Option<&'static str>,
    touched: Instant,
}
pub(super) struct OriginalJobs {
    entries: Mutex<HashMap<(ProfileId, OriginalId), Progress>>,
    changed: Notify,
}
impl Default for OriginalJobs {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            changed: Notify::new(),
        }
    }
}
struct Job {
    jobs: Arc<OriginalJobs>,
    key: (ProfileId, OriginalId),
    id: Uuid,
    cancel: PeerCancellation,
}
impl Drop for Job {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Ok(mut entries) = self.jobs.entries.lock() {
            if let Some(p) = entries.get_mut(&self.key) {
                if p.active.as_ref().is_some_and(|a| a.id == self.id) {
                    p.active = None;
                    if matches!(p.state, "receiving" | "verifying" | "confirming") {
                        p.state = "cancelled";
                        p.error = Some("cancelled");
                    }
                    p.touched = Instant::now();
                }
            }
        }
        self.jobs.changed.notify_one();
    }
}
impl OriginalJobs {
    fn start(
        self: &Arc<Self>,
        key: (ProfileId, OriginalId),
        peer: DeviceId,
        id: Uuid,
    ) -> Result<Job, HostError> {
        if id.is_nil() {
            return Err(HostError::InvalidRequest);
        }
        let mut entries = self.entries.lock().map_err(|_| HostError::StatePoisoned)?;
        if let Some(active) = entries.get(&key).and_then(|p| p.active.as_ref()) {
            if active.id == id && active.peer != peer {
                return Err(HostError::PeerMembershipConflict);
            }
            return Err(HostError::PeerBusy);
        }
        if entries.values().filter(|p| p.active.is_some()).count() >= MAX_ACTIVE {
            return Err(HostError::PeerBusy);
        }
        if !entries.contains_key(&key) && entries.len() >= MAX_TRACKED {
            let stale = entries
                .iter()
                .filter(|(_, p)| p.active.is_none())
                .min_by_key(|(_, p)| p.touched)
                .map(|(key, _)| *key)
                .ok_or(HostError::PeerBusy)?;
            entries.remove(&stale);
        }
        let cancel = PeerCancellation::new();
        entries.insert(
            key,
            Progress {
                active: Some(Active {
                    id,
                    peer,
                    cancel: cancel.clone(),
                }),
                state: "receiving",
                error: None,
                touched: Instant::now(),
            },
        );
        Ok(Job {
            jobs: self.clone(),
            key,
            id,
            cancel,
        })
    }
    pub(super) fn cancel_all(&self) {
        if let Ok(entries) = self.entries.lock() {
            for active in entries.values().filter_map(|p| p.active.as_ref()) {
                active.cancel.cancel();
            }
        }
    }
    pub(super) async fn wait_empty(&self) -> Result<(), HostError> {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if !self
                    .entries
                    .lock()
                    .map_err(|_| HostError::StatePoisoned)?
                    .values()
                    .any(|p| p.active.is_some())
                {
                    return Ok(());
                }
                self.changed.notified().await;
            }
        })
        .await
        .map_err(|_| HostError::Shutdown)?
    }
    fn finish(
        &self,
        key: (ProfileId, OriginalId),
        id: Uuid,
        result: &Result<OriginalTransferResult, HostError>,
    ) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(p) = entries.get_mut(&key) {
                if p.active.as_ref().is_some_and(|a| a.id == id) {
                    p.state = match result {
                        Ok(value) if value.verified => "idle",
                        Ok(_) => "idle",
                        Err(HostError::PeerCancelled | HostError::Stopped) => "cancelled",
                        Err(_) => "failed",
                    };
                    p.error = result.as_ref().err().map(original_error);
                    p.touched = Instant::now();
                }
            }
        }
    }
}
fn original_error(error: &HostError) -> &'static str {
    match error {
        HostError::Core(exomind_core::CoreError::OriginalHashMismatch) => "original_hash_mismatch",
        HostError::Core(exomind_core::CoreError::OriginalIntegrityMismatch) => {
            "original_integrity_mismatch"
        }
        HostError::Core(
            exomind_core::CoreError::OriginalNotReady | exomind_core::CoreError::StageIncomplete,
        ) => "original_not_ready",
        HostError::PeerCancelled | HostError::Stopped => "cancelled",
        HostError::PeerTimeout => "peer_timeout",
        HostError::PeerTransportUnavailable
        | HostError::PeerSyncUnavailable
        | HostError::NotFound => "unreachable",
        other => error_code(other),
    }
}
impl PeerNetwork {
    pub fn original_status(
        &self,
        profile: ProfileId,
        original_id: OriginalId,
    ) -> Result<PeerOriginalStatus, HostError> {
        self.host.qualify_transport(&self.owner)?;
        let availability = {
            let state = self.host.active_state()?;
            let core = &crate::resources(&state)?.core;
            core.original_availability(&core.local_human(profile)?, profile, original_id)?
        };
        let (original, availability, next_offset, verifying) = match availability {
            OriginalAvailability::Missing { original } => (original, "missing", 0, false),
            OriginalAvailability::Local { stage } => {
                let state = match stage.state {
                    StageState::Verified => "complete",
                    StageState::HashMismatch => "hash_mismatch",
                    _ => "partial",
                };
                let verifying = stage.state == StageState::Frozen;
                (stage.original, state, stage.next_offset, verifying)
            }
        };
        let entries = self
            .originals
            .entries
            .lock()
            .map_err(|_| HostError::StatePoisoned)?;
        let progress = entries.get(&(profile, original_id));
        let active = progress.and_then(|p| p.active.as_ref());
        let state = if active.is_some_and(|a| a.cancel.is_cancelled()) {
            "cancelled"
        } else if active.is_some() {
            if availability == "complete" {
                "confirming"
            } else if verifying {
                "verifying"
            } else {
                "receiving"
            }
        } else {
            progress.map(|p| p.state).unwrap_or("idle")
        };
        Ok(PeerOriginalStatus {
            profile_id: profile,
            original_id,
            byte_length: original.byte_length,
            original,
            availability,
            next_offset,
            request_id: active.map(|a| a.id),
            peer_device_id: active.map(|a| a.peer),
            transfer_state: state,
            last_error_code: progress.and_then(|p| p.error).or(
                if availability == "hash_mismatch" {
                    Some("original_hash_mismatch")
                } else {
                    None
                },
            ),
        })
    }
    pub fn cancel_original(
        &self,
        profile: ProfileId,
        original: OriginalId,
        request: Uuid,
    ) -> Result<bool, HostError> {
        self.host.qualify_transport(&self.owner)?;
        if request.is_nil() {
            return Err(HostError::InvalidRequest);
        }
        let mut entries = self
            .originals
            .entries
            .lock()
            .map_err(|_| HostError::StatePoisoned)?;
        if let Some(progress) = entries.get_mut(&(profile, original)) {
            if let Some(active) = progress.active.as_ref().filter(|a| a.id == request) {
                active.cancel.cancel();
                progress.state = "cancelled";
                progress.error = Some("cancelled");
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub async fn fetch_original(
        self: &Arc<Self>,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        request: Uuid,
    ) -> Result<OriginalTransferResult, HostError> {
        self.host.qualify_transport(&self.owner)?;
        if peer == self.host.device_id {
            return Err(HostError::InvalidRequest);
        }
        // Register before asynchronous listener/key setup so an immediate
        // cancellation by the exact request UUID is not lost during startup.
        let job = self.originals.start((profile, original), peer, request)?;
        let _lease = self.host.peers.register(false)?;
        let result = tokio::select! {biased;
            _=job.cancel.cancelled()=>Err(HostError::PeerCancelled),
            _=self.host.peers.cancel.cancelled()=>Err(HostError::Stopped),
            result=async {
                // This check has no staging side effect and precedes all
                // remote I/O, so private/unreferenced IDs never leave here.
                let before=self.original_status(profile,original)?;
                self.ensure_started().await?;
                let (network_cancel,generation)={let run=self.lifecycle.lock().await;let cancel=run.as_ref().ok_or(HostError::PeerTransportUnavailable)?.cancel.clone();let generation=self.shared.lock().map_err(|_|HostError::StatePoisoned)?.generation;(cancel,generation)};
                let result=tokio::select!{biased;
                    _=network_cancel.cancelled()=>Err(HostError::PeerCancelled),
                    result=self.fetch_sessions(profile,peer,original,&job.cancel,before.original)=>result,
                };
                if self.shared.lock().map_err(|_|HostError::StatePoisoned)?.generation!=generation{Err(HostError::PeerCancelled)}else{result}
            }=>result,
        };
        self.originals.finish((profile, original), request, &result);
        result
    }
    async fn fetch_sessions(
        &self,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        cancel: &PeerCancellation,
        expected: OriginalRef,
    ) -> Result<OriginalTransferResult, HostError> {
        let end = Instant::now() + Duration::from_secs(30 * 60);
        let mut first = None;
        let mut last = HostError::PeerTransportUnavailable;
        for _ in 0..32 {
            if cancel.is_cancelled() {
                return Err(HostError::PeerCancelled);
            }
            let member = self
                .host
                .peer_members(&self.owner, profile)?
                .into_iter()
                .find(|m| m.device_id == peer && !m.revoked && m.state == PeerJoinState::Ready)
                .ok_or(HostError::PeerMembershipDenied)?;
            let route = self
                .worker()
                .routes()?
                .into_iter()
                .find(|r| r.profile == profile && r.device == peer)
                .ok_or(HostError::PeerTransportUnavailable)?;
            let port = self
                .local_addresses()?
                .first()
                .ok_or(HostError::PeerTransportUnavailable)?
                .port();
            let pin = PeerPin::from_sha256(&member.pin)?;
            let mut partial = None;
            for endpoint in route.endpoints {
                let left = end.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return Err(HostError::PeerTimeout);
                }
                let channel = match self
                    .host
                    .connect_peer_transport(
                        &self.owner,
                        endpoint,
                        pin,
                        transport_options(),
                        cancel.clone(),
                    )
                    .await
                {
                    Ok(channel) => channel,
                    Err(error) => {
                        last = error;
                        continue;
                    }
                };
                self.host
                    .select_peer_service(
                        &self.owner,
                        &channel,
                        PeerServiceKind::Originals,
                        Some(profile),
                        Some(peer),
                        port,
                    )
                    .await?;
                let options = OriginalTransferOptions {
                    session_timeout: left.min(Duration::from_secs(120)),
                    ..Default::default()
                };
                match self
                    .host
                    .download_peer_original_over_transport(
                        &self.owner,
                        profile,
                        peer,
                        original,
                        channel,
                        options,
                    )
                    .await
                {
                    Ok(value) => {
                        if value.original != expected {
                            return Err(HostError::Core(exomind_core::CoreError::OriginalConflict));
                        }
                        self.worker().promote(profile, peer, endpoint)?;
                        partial = Some(value);
                        break;
                    }
                    Err(error @ (HostError::PeerTransportUnavailable | HostError::PeerTimeout)) => {
                        last = error;
                        continue;
                    }
                    Err(error) => return Err(error),
                }
            }
            let Some(mut value) = partial else {
                return Err(last);
            };
            let start = *first.get_or_insert(value.resumed_from);
            if value.verified {
                value.resumed_from = start;
                value.transferred_bytes = value.original.byte_length.saturating_sub(start);
                return Ok(value);
            }
            if value.transferred_bytes == 0 {
                return Err(HostError::PeerTransportUnavailable);
            }
        }
        Err(HostError::PeerTimeout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn exact_request_cancellation_does_not_cancel_replacement_or_another_original() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        let network = PeerNetwork::new(host.clone(), owner).unwrap();
        let p = ProfileId::new();
        let original = OriginalId::new();
        let peer = DeviceId::new();
        let first = Uuid::new_v4();
        let old = network.originals.start((p, original), peer, first).unwrap();
        assert!(
            !network
                .cancel_original(p, original, Uuid::new_v4())
                .unwrap()
        );
        assert!(
            !network
                .cancel_original(p, OriginalId::new(), first)
                .unwrap()
        );
        assert!(!old.cancel.is_cancelled());
        assert!(network.cancel_original(p, original, first).unwrap());
        assert!(old.cancel.is_cancelled());
        drop(old);
        let replacement = network
            .originals
            .start((p, original), peer, Uuid::new_v4())
            .unwrap();
        assert!(!network.cancel_original(p, original, first).unwrap());
        assert!(!replacement.cancel.is_cancelled());
        network.originals.cancel_all();
        assert!(replacement.cancel.is_cancelled());
        drop(replacement);
        network.originals.wait_empty().await.unwrap();
        drop(network);
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
    }
}
