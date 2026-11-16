//! Explicit Native download jobs. Runtime progress is bounded and disposable;
//! the Core stage offset/hash is the durable source of byte availability.
use super::*;
use crate::peers::original_admission::{OriginalAdmission, OriginalFetchMode};
use crate::peers::original_auto_store::{
    self, OriginalAutoSuppression, OriginalAutoSuppressionCommand,
};
use crate::peers::original_transfer::TransferCompletion;
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
    cancel_intent_revision: Option<Uuid>,
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
    _jobs: Arc<OriginalJobs>,
    cancel: PeerCancellation,
    completion: Arc<TransferCompletion>,
}
impl Drop for Job {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.completion.close();
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
        let jobs = Arc::downgrade(self);
        let completion = TransferCompletion::new(move || {
            if let Some(jobs) = jobs.upgrade() {
                jobs.drained(key, id);
            }
        });
        entries.insert(
            key,
            Progress {
                active: Some(Active {
                    id,
                    peer,
                    cancel: cancel.clone(),
                    cancel_intent_revision: None,
                }),
                state: "receiving",
                error: None,
                touched: Instant::now(),
            },
        );
        Ok(Job {
            _jobs: self.clone(),
            cancel,
            completion,
        })
    }
    fn drained(&self, key: (ProfileId, OriginalId), id: Uuid) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(p) = entries.get_mut(&key) {
                if p.active.as_ref().is_some_and(|a| a.id == id) {
                    p.active = None;
                    if matches!(p.state, "receiving" | "verifying" | "confirming") {
                        p.state = "cancelled";
                        p.error = Some("cancelled");
                    }
                    p.touched = Instant::now();
                }
            }
        }
        self.changed.notify_waiters();
    }
    pub(super) fn cancel_all(&self) {
        if let Ok(entries) = self.entries.lock() {
            for active in entries.values().filter_map(|p| p.active.as_ref()) {
                active.cancel.cancel();
            }
        }
    }
    pub(super) async fn wait_empty(&self) -> Result<(), HostError> {
        self.wait_for(None).await
    }
    async fn wait_request(
        &self,
        key: (ProfileId, OriginalId),
        request: Uuid,
    ) -> Result<(), HostError> {
        self.wait_for(Some((key, request))).await
    }
    async fn wait_for(
        &self,
        request: Option<((ProfileId, OriginalId), Uuid)>,
    ) -> Result<(), HostError> {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                // Register BEFORE checking state. Both the RPC and network
                // stop can wait for this scope; notify_waiters must wake both.
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                let pending = {
                    let entries = self.entries.lock().map_err(|_| HostError::StatePoisoned)?;
                    match request {
                        Some((key, id)) => entries
                            .get(&key)
                            .and_then(|p| p.active.as_ref())
                            .is_some_and(|a| a.id == id),
                        None => entries.values().any(|p| p.active.is_some()),
                    }
                };
                if !pending {
                    return Ok(());
                }
                changed.await;
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
        if request.is_nil() {
            return Err(HostError::InvalidRequest);
        }
        // Global order is Host gate -> entries. The request cannot be replaced
        // between its identity check, durable suppression commit and signal.
        let mut state = self.host.active_state()?;
        self.host.owner(&self.owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let mut entries = self
            .originals
            .entries
            .lock()
            .map_err(|_| HostError::StatePoisoned)?;
        if let Some(progress) = entries.get_mut(&(profile, original)) {
            if let Some(active) = progress.active.as_mut().filter(|a| a.id == request) {
                resources.core.original_availability(
                    &resources.core.local_human(profile)?,
                    profile,
                    original,
                )?;
                let prior =
                    original_auto_store::intent(&resources.persistence.auth, profile, original)?;
                if active.cancel_intent_revision != prior.intent_revision
                    || prior.suppression != Some(OriginalAutoSuppression::UserCancelled)
                {
                    let tx = super::super::membership_store::transaction(
                        &mut resources.persistence.auth,
                    )?;
                    let intent = original_auto_store::save_intent(
                        &tx,
                        profile,
                        original,
                        &OriginalAutoSuppressionCommand {
                            command_id: Uuid::new_v4(),
                            expected_intent_revision: prior.intent_revision,
                            suppression: Some(OriginalAutoSuppression::UserCancelled),
                        },
                    )?;
                    tx.commit().map_err(|_| HostError::PeerSyncUnavailable)?;
                    active.cancel_intent_revision = intent.intent_revision;
                }
                active.cancel.cancel();
                progress.state = "cancelled";
                progress.error = Some("cancelled");
                return Ok(true);
            }
        }
        Ok(false)
    }
    /// A true result includes durable suppression and this exact request's
    /// physical completion, not merely acceptance of its cancellation signal.
    pub async fn cancel_original_and_wait(
        self: &Arc<Self>,
        profile: ProfileId,
        original: OriginalId,
        request: Uuid,
    ) -> Result<bool, HostError> {
        // Preserve the Native adapter's gate/disk work off its async executor.
        // This short owned operation also participates in Host shutdown.
        let host_lease = self.host.peers.register(false)?;
        let network = self.clone();
        let accepted = tokio::task::spawn_blocking(move || {
            let _lease = host_lease;
            network.cancel_original(profile, original, request)
        })
        .await
        .map_err(|_| HostError::StatePoisoned)??;
        if accepted {
            self.originals
                .wait_request((profile, original), request)
                .await?;
        }
        Ok(accepted)
    }
    pub async fn fetch_original(
        self: &Arc<Self>,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        request: Uuid,
    ) -> Result<OriginalTransferResult, HostError> {
        self.fetch_original_mode(profile, peer, original, request, OriginalFetchMode::Manual)
            .await
    }
    async fn fetch_original_mode(
        self: &Arc<Self>,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        request: Uuid,
        mode: OriginalFetchMode,
    ) -> Result<OriginalTransferResult, HostError> {
        if peer == self.host.device_id {
            return Err(HostError::InvalidRequest);
        }
        // Admission and startup serialize with disable. No old fetch queued
        // behind a pause may implicitly turn the persisted preference on.
        let (job, _lease, network_cancel, generation, before, intent_revision) = {
            let _control = self.control.lock().await;
            let (job, lease, before, intent_revision) = {
                let state = self.host.active_state()?;
                self.host.owner(&self.owner)?;
                let r = crate::resources(&state)?;
                if !super::super::network_store::settings(&r.persistence.auth)?.enabled {
                    return Err(HostError::PeerNetworkDisabled);
                }
                let before = match r.core.original_availability(
                    &r.core.local_human(profile)?,
                    profile,
                    original,
                )? {
                    OriginalAvailability::Missing { original } => original,
                    OriginalAvailability::Local { stage } => stage.original,
                };
                let intent = original_auto_store::intent(&r.persistence.auth, profile, original)?;
                if let OriginalFetchMode::Automatic { policy_revision } = mode {
                    if !original_auto_store::eligible(
                        &r.persistence.auth,
                        profile,
                        original,
                        before.byte_length,
                        policy_revision,
                        intent.intent_revision,
                    )? {
                        return Err(HostError::PeerCancelled);
                    }
                }
                let job = self.originals.start((profile, original), peer, request)?;
                (
                    job,
                    self.host.peers.register(false)?,
                    before,
                    intent.intent_revision,
                )
            };
            // Register before async key/listener setup, preserving exact-ID
            // cancellation while that setup is in progress.
            tokio::select! {biased;_=job.cancel.cancelled()=>return Err(HostError::PeerCancelled),_=self.host.peers.cancel.cancelled()=>return Err(HostError::Stopped),result=self.start()=>{result?;}}
            let run = self.lifecycle.lock().await;
            let cancel = run
                .as_ref()
                .ok_or(HostError::PeerTransportUnavailable)?
                .cancel
                .clone();
            let generation = self
                .shared
                .lock()
                .map_err(|_| HostError::StatePoisoned)?
                .generation;
            (job, lease, cancel, generation, before, intent_revision)
        };
        let shared = self.shared.clone();
        let jobs = Arc::downgrade(&self.originals);
        let network_guard = network_cancel.clone();
        let admission = OriginalAdmission::managed(
            self.host.runtime_id,
            profile,
            before.clone(),
            intent_revision,
            mode,
            job.cancel.clone(),
            move || {
                if network_guard.is_cancelled() {
                    return Ok(false);
                }
                if shared
                    .lock()
                    .map_err(|_| HostError::StatePoisoned)?
                    .generation
                    != generation
                {
                    return Ok(false);
                }
                let Some(jobs) = jobs.upgrade() else {
                    return Ok(false);
                };
                let entries = jobs.entries.lock().map_err(|_| HostError::StatePoisoned)?;
                Ok(entries
                    .get(&(profile, original))
                    .and_then(|p| p.active.as_ref())
                    .is_some_and(|a| a.id == request && !a.cancel.is_cancelled()))
            },
        );
        let result = tokio::select! {biased;
            _=job.cancel.cancelled()=>Err(HostError::PeerCancelled),
            _=self.host.peers.cancel.cancelled()=>Err(HostError::Stopped),
            result=async {
                // This check has no staging side effect and precedes all
                // remote I/O, so private/unreferenced IDs never leave here.
                let result=tokio::select!{biased;
                    _=network_cancel.cancelled()=>Err(HostError::PeerCancelled),
                    result=self.fetch_sessions(profile,peer,original,&job.cancel,before,&job.completion,&admission)=>result,
                };
                if self.shared.lock().map_err(|_|HostError::StatePoisoned)?.generation!=generation{Err(HostError::PeerCancelled)}else{result}
            }=>result,
        };
        let mut result = result;
        // Publication shares the same gate/order as cancellation. A committed
        // pause cannot be overwritten by an old successful async result.
        match self.host.active_state() {
            Ok(state) => {
                let validation = crate::resources(&state)
                    .and_then(|r| admission.validate_result(&self.host, r, &result, None));
                if let Err(error) = validation {
                    result = Err(error);
                }
                self.originals.finish((profile, original), request, &result);
            }
            Err(error) => {
                result = Err(error);
                self.originals.finish((profile, original), request, &result);
            }
        }
        job.cancel.cancel();
        job.completion.close();
        self.originals
            .wait_request((profile, original), request)
            .await?;
        result
    }
    async fn fetch_sessions(
        &self,
        profile: ProfileId,
        peer: DeviceId,
        original: OriginalId,
        cancel: &PeerCancellation,
        expected: OriginalRef,
        completion: &Arc<TransferCompletion>,
        admission: &Arc<OriginalAdmission>,
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
                completion.track_channel(&channel)?;
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
                    .download_peer_original_owned(
                        &self.owner,
                        profile,
                        peer,
                        original,
                        channel,
                        options,
                        Some(completion.clone()),
                        Some(admission.clone()),
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
    fn committed_original(host: &BetaHost, owner: &Session) -> (ProfileId, OriginalId) {
        let p = ProfileId::new();
        host.provision_profile(owner, p, "synthetic cancellable original")
            .unwrap();
        let stage = exomind_core::StageId::new();
        let id = OriginalId::new();
        let ticket = {
            let state = host.active_state().unwrap();
            let core = &crate::resources(&state).unwrap().core;
            let human = core.local_human(p).unwrap();
            core.begin_stage(
                &human,
                &exomind_core::BeginStageCommand {
                    stage_id: stage,
                    original_id: id,
                    profile_id: p,
                    expected_sha256:
                        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
                    byte_length: 0,
                    file_name: "synthetic-cancel.bin".into(),
                    media_type: "application/octet-stream".into(),
                },
            )
            .unwrap();
            core.freeze_stage(&human, stage).unwrap()
        };
        let proof = ticket.verify(|| false).unwrap();
        {
            let state = host.active_state().unwrap();
            let core = &crate::resources(&state).unwrap().core;
            let human = core.local_human(p).unwrap();
            let original = core.finish_stage(&human, &proof).unwrap().original;
            core.submit(
                &human,
                &exomind_core::CaptureCommand {
                    command_id: exomind_core::CommandId::new(),
                    event_id: exomind_core::EventId::new(),
                    profile_id: p,
                    occurred_at_ms: 1000,
                    text: "synthetic cancellation reference".into(),
                    tags: vec![],
                    originals: vec![original],
                },
            )
            .unwrap();
        }
        (p, id)
    }
    fn has_active(network: &PeerNetwork) -> bool {
        network
            .originals
            .entries
            .lock()
            .unwrap()
            .values()
            .any(|p| p.active.is_some())
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn original_cancel_and_network_stop_wait_for_owned_blocking_completion_only() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        let key = committed_original(&host, &owner);
        let network = PeerNetwork::new(host.clone(), owner).unwrap();
        let peer = DeviceId::new();
        let request = Uuid::new_v4();
        let job = network.originals.start(key, peer, request).unwrap();
        let completion = job.completion.clone();
        let guard = completion.register().unwrap();
        let owned = host.peers.register(false).unwrap();
        let unrelated = host.peers.register(false).unwrap();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::sync_channel(1);
        let blocking = tokio::task::spawn_blocking(move || {
            let _done = guard;
            let _owned = owned;
            entered.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5))
                .expect("owned blocking fixture release");
        });
        tokio::time::timeout(Duration::from_secs(2), ready)
            .await
            .unwrap()
            .unwrap();
        assert!(network.cancel_original(key.0, key.1, request).unwrap());
        drop(job);
        assert!(
            has_active(&network),
            "dropping caller must not hide its running blocking worker"
        );
        assert!(
            matches!(
                network.originals.start(key, peer, Uuid::new_v4()),
                Err(HostError::PeerBusy)
            ),
            "replacement cannot overlap old blocking work"
        );
        assert!(
            matches!(completion.register(), Err(HostError::PeerCancelled)),
            "closed old scope cannot admit late work"
        );
        let mut stopping = Box::pin(network.stop());
        std::future::poll_fn(|cx| {
            assert!(
                std::future::Future::poll(stopping.as_mut(), cx).is_pending(),
                "stop falsely drained a live blocking worker"
            );
            std::task::Poll::Ready(())
        })
        .await;
        let mut waiting_request = Box::pin(network.originals.wait_request(key, request));
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(waiting_request.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        release.send(()).unwrap();
        let (stopped, request_drained) = tokio::join!(
            tokio::time::timeout(Duration::from_secs(2), &mut stopping),
            tokio::time::timeout(Duration::from_secs(2), &mut waiting_request)
        );
        stopped.unwrap().unwrap();
        request_drained.unwrap().unwrap();
        drop(waiting_request);
        drop(stopping);
        tokio::time::timeout(Duration::from_secs(2), blocking)
            .await
            .unwrap()
            .unwrap();
        assert!(!has_active(&network));
        assert_eq!(
            host.peers.counts.lock().unwrap().jobs,
            1,
            "network stop must not wait for an unrelated peer lease"
        );
        drop(unrelated);
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
        let reopened = BetaHost::open(root.path()).unwrap();
        reopened.stop().unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fetch_queued_after_disable_started_cannot_reenable_or_deadlock_drain() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        host.save_peer_network_settings(
            &owner,
            PeerNetworkSettings {
                enabled: false,
                preferred_port: 0,
            },
        )
        .unwrap();
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        network.set_enabled(true).await.unwrap();
        // Hold one old owned request so disable is observably past cancel_all
        // and still draining while a NEW fetch is first polled.
        let blocker = network
            .originals
            .start(
                (ProfileId::new(), OriginalId::new()),
                DeviceId::new(),
                Uuid::new_v4(),
            )
            .unwrap();
        let mut disabling = Box::pin(network.set_enabled(false));
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(disabling.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        assert!(blocker.cancel.is_cancelled());
        let mut late = Box::pin(network.fetch_original(
            ProfileId::new(),
            DeviceId::new(),
            OriginalId::new(),
            Uuid::new_v4(),
        ));
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(late.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        let admitted = network
            .originals
            .entries
            .lock()
            .unwrap()
            .values()
            .filter(|p| p.active.is_some())
            .count();
        drop(blocker);
        let disabled = tokio::time::timeout(Duration::from_secs(2), &mut disabling).await;
        drop(disabling);
        let result = tokio::time::timeout(Duration::from_secs(2), &mut late).await;
        drop(late);
        let enabled = host.peer_network_settings(&owner).unwrap().enabled;
        let addresses = network.local_addresses().unwrap();
        network.stop().await.unwrap();
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            admitted, 1,
            "late fetch registered behind disable's cancellation sweep"
        );
        disabled.expect("disable drain deadline").unwrap();
        assert!(matches!(
            result.expect("late fetch deadline"),
            Err(HostError::PeerNetworkDisabled)
        ));
        assert!(!enabled);
        assert!(addresses.is_empty());
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn disabled_original_fetch_never_enables_or_starts_network() {
        let _discovery = crate::peers::test_discovery::lease().await;
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        host.save_peer_network_settings(
            &owner,
            PeerNetworkSettings {
                enabled: false,
                preferred_port: 0,
            },
        )
        .unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "synthetic paused network")
            .unwrap();
        // A real committed reference lets the existing availability preflight
        // succeed. No private/unknown original is used to short-circuit it.
        let stage = exomind_core::StageId::new();
        let original = OriginalId::new();
        let ticket = {
            let state = host.active_state().unwrap();
            let core = &crate::resources(&state).unwrap().core;
            let human = core.local_human(profile).unwrap();
            core.begin_stage(
                &human,
                &exomind_core::BeginStageCommand {
                    stage_id: stage,
                    original_id: original,
                    profile_id: profile,
                    expected_sha256:
                        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
                    byte_length: 0,
                    file_name: "synthetic-empty.bin".into(),
                    media_type: "application/octet-stream".into(),
                },
            )
            .unwrap();
            core.freeze_stage(&human, stage).unwrap()
        };
        let proof = ticket.verify(|| false).unwrap();
        {
            let state = host.active_state().unwrap();
            let core = &crate::resources(&state).unwrap().core;
            let human = core.local_human(profile).unwrap();
            let original = core.finish_stage(&human, &proof).unwrap().original;
            core.submit(
                &human,
                &exomind_core::CaptureCommand {
                    command_id: exomind_core::CommandId::new(),
                    event_id: exomind_core::EventId::new(),
                    profile_id: profile,
                    occurred_at_ms: 1000,
                    text: "synthetic committed original".into(),
                    tags: vec![],
                    originals: vec![original],
                },
            )
            .unwrap();
        }
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        assert!(!host.peer_network_settings(&owner).unwrap().enabled);
        assert!(network.local_addresses().unwrap().is_empty());
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            network.fetch_original(profile, DeviceId::new(), original, Uuid::new_v4()),
        )
        .await
        .expect("finite disabled-fetch regression");
        let enabled = host.peer_network_settings(&owner).unwrap().enabled;
        let addresses = network.local_addresses().unwrap();
        let active = network
            .originals
            .entries
            .lock()
            .unwrap()
            .values()
            .filter(|p| p.active.is_some())
            .count();
        // Always clean our own actor/leases before making the red assertion.
        network.stop().await.unwrap();
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(&result, Err(HostError::PeerNetworkDisabled)),
            "paused network fetch must return the typed disabled error: {result:?}"
        );
        assert!(
            !enabled,
            "fetch silently persisted enabled=true after user paused network"
        );
        assert!(
            addresses.is_empty(),
            "fetch started a listener while network was paused: {addresses:?}"
        );
        assert_eq!(active, 0, "disabled fetch retained an original job");
    }
    #[tokio::test]
    async fn exact_request_cancellation_does_not_cancel_replacement_or_another_original() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        let (p, original) = committed_original(&host, &owner);
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
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
        let persisted = host.original_local_intent(&owner, p, original).unwrap();
        assert_eq!(
            persisted.suppression,
            Some(OriginalAutoSuppression::UserCancelled)
        );
        assert!(network.cancel_original(p, original, first).unwrap());
        assert_eq!(
            host.original_local_intent(&owner, p, original).unwrap(),
            persisted,
            "repeat cancel must not spend another revision"
        );
        drop(old);
        let replacement = network
            .originals
            .start((p, original), peer, Uuid::new_v4())
            .unwrap();
        assert!(!network.cancel_original(p, original, first).unwrap());
        assert!(!replacement.cancel.is_cancelled());
        assert_eq!(
            host.original_local_intent(&owner, p, original).unwrap(),
            persisted,
            "old UUID cannot suppress its replacement"
        );
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

    #[tokio::test]
    async fn cancellation_write_failure_never_signals_or_spends_a_revision() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        let (p, id) = committed_original(&host, &owner);
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        let request = Uuid::new_v4();
        let job = network
            .originals
            .start((p, id), DeviceId::new(), request)
            .unwrap();
        {
            let mut state = host.active_state().unwrap();
            state.resources.as_mut().unwrap().persistence.auth.execute_batch("CREATE TRIGGER test_deny_cancel_intent BEFORE INSERT ON peer_original_auto_intents BEGIN SELECT RAISE(ABORT,'synthetic cancel write denial'); END;").unwrap();
        }
        let before = host.original_local_intent(&owner, p, id).unwrap();
        let revisions = {
            let state = host.active_state().unwrap();
            crate::resources(&state)
                .unwrap()
                .persistence
                .auth
                .query_row::<u64, _, _>(
                    "SELECT count(*) FROM peer_original_auto_revisions",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert!(matches!(
            network.cancel_original(p, id, request),
            Err(HostError::PeerSyncUnavailable)
        ));
        assert!(
            !job.cancel.is_cancelled(),
            "failed durable intent cannot be acknowledged as cancelled"
        );
        assert_eq!(host.original_local_intent(&owner, p, id).unwrap(), before);
        {
            let mut state = host.active_state().unwrap();
            let c = &mut state.resources.as_mut().unwrap().persistence.auth;
            assert_eq!(
                c.query_row::<u64, _, _>(
                    "SELECT count(*) FROM peer_original_auto_revisions",
                    [],
                    |r| r.get(0)
                )
                .unwrap(),
                revisions
            );
            c.execute("DROP TRIGGER test_deny_cancel_intent", [])
                .unwrap();
        }
        network.cancel_original(p, id, request).unwrap();
        assert!(job.cancel.is_cancelled());
        assert_eq!(
            host.original_local_intent(&owner, p, id)
                .unwrap()
                .suppression,
            Some(OriginalAutoSuppression::UserCancelled)
        );
        drop(job);
        network.stop().await.unwrap();
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancellation_signal_observes_committed_intent_and_async_cancel_waits_for_completion() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(root.path()).unwrap());
        let owner = host.owner_session().unwrap();
        let (p, id) = committed_original(&host, &owner);
        let network = PeerNetwork::new(host.clone(), owner.clone()).unwrap();
        let request = Uuid::new_v4();
        let job = network
            .originals
            .start((p, id), DeviceId::new(), request)
            .unwrap();
        let cancel = job.cancel.clone();
        let guard = job.completion.register().unwrap();
        let mut cancelling = Box::pin(network.cancel_original_and_wait(p, id, request));
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(cancelling.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        tokio::time::timeout(Duration::from_secs(2), cancel.cancelled())
            .await
            .unwrap();
        assert!(cancel.is_cancelled());
        assert_eq!(
            host.original_local_intent(&owner, p, id)
                .unwrap()
                .suppression,
            Some(OriginalAutoSuppression::UserCancelled)
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut cancelling)
                .await
                .is_err(),
            "durable cancellation must still await its held completion guard"
        );
        drop(job);
        assert!(has_active(&network));
        drop(guard);
        assert!(
            tokio::time::timeout(Duration::from_secs(2), &mut cancelling)
                .await
                .unwrap()
                .unwrap()
        );
        drop(cancelling);
        assert!(!has_active(&network));
        network.stop().await.unwrap();
        tokio::task::spawn_blocking(move || host.stop())
            .await
            .unwrap()
            .unwrap();
    }
}
