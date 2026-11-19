//! Bounded local-reference scanner. No Self/PeerNetwork Arc is retained by its
//! workers; Core availability, not metadata ACKs, is the byte truth.
use super::*;
use tokio::task::JoinSet;
const CAP: usize = 256;
#[derive(Debug, Clone, Serialize)]
pub struct OriginalAutoQueueStatus {
    pub network_enabled: bool,
    pub policy_enabled: bool,
    pub active_outbound: usize,
    pub deferred: bool,
    pub last_error_code: Option<&'static str>,
}
pub(in crate::peers::network) struct AutoQueue {
    started: Instant,
    profile_cursor: usize,
    pages: HashMap<ProfileId, Option<OriginalId>>,
    retry: HashMap<(ProfileId, OriginalId), Instant>,
    sources: HashMap<(ProfileId, OriginalId), usize>,
    defer_until: Option<Instant>,
}
pub(in crate::peers::network) enum Disposition {
    Ready,
    Partial,
    Retry(u64),
    Skipped,
    Blocked,
    Error(&'static str),
}
pub(in crate::peers::network) struct AutoCompletion {
    key: (ProfileId, OriginalId),
    disposition: Disposition,
}
impl AutoQueue {
    pub(in crate::peers::network) fn new() -> Self {
        Self {
            started: Instant::now(),
            profile_cursor: 0,
            pages: HashMap::new(),
            retry: HashMap::new(),
            sources: HashMap::new(),
            defer_until: None,
        }
    }
    pub(in crate::peers::network) fn completed(
        &mut self,
        result: Result<AutoCompletion, tokio::task::JoinError>,
        worker: &Worker,
    ) {
        match result {
            Ok(done) => match done.disposition {
                Disposition::Retry(delay) => {
                    let now = Instant::now();
                    self.retry.retain(|_, until| *until > now);
                    if self.retry.len() < CAP || self.retry.contains_key(&done.key) {
                        self.retry
                            .insert(done.key, now + Duration::from_millis(delay));
                    } else {
                        self.defer_until = Some(now + Duration::from_millis(delay));
                        if let Ok(mut state) = worker.shared.lock() {
                            state.auto_deferred = true;
                            state.auto_error = Some("original_queue_full");
                        }
                    }
                    if self.sources.len() >= CAP && !self.sources.contains_key(&done.key) {
                        if let Some(stale) = self
                            .sources
                            .keys()
                            .find(|key| !self.retry.contains_key(*key))
                            .copied()
                        {
                            self.sources.remove(&stale);
                        }
                    }
                    if self.sources.len() < CAP || self.sources.contains_key(&done.key) {
                        let n = self.sources.entry(done.key).or_default();
                        *n = n.wrapping_add(1);
                    }
                }
                Disposition::Ready | Disposition::Blocked => {
                    self.retry.remove(&done.key);
                    self.sources.remove(&done.key);
                }
                Disposition::Error(code) => {
                    if let Ok(mut state) = worker.shared.lock() {
                        state.auto_error = Some(code);
                        state.auto_deferred = true;
                    }
                }
                Disposition::Partial =>
                {
                    #[cfg(test)]
                    if let Ok(mut state) = worker.shared.lock() {
                        state.auto_yields = state.auto_yields.saturating_add(1);
                    }
                }
                Disposition::Skipped => {}
            },
            Err(error) if error.is_cancelled() => {}
            Err(_) => {
                if let Ok(mut state) = worker.shared.lock() {
                    state.auto_error = Some("original_worker_failed");
                    state.auto_deferred = true;
                }
            }
        }
    }
    pub(in crate::peers::network) fn tick(
        &mut self,
        worker: &Worker,
        cancel: &PeerCancellation,
        generation: u64,
        jobs: &mut JoinSet<AutoCompletion>,
    ) -> Result<(), HostError> {
        {
            let mut state = worker.shared.lock().map_err(|_| HostError::StatePoisoned)?;
            if state.generation != generation || cancel.is_cancelled() {
                return Ok(());
            }
            state.auto_deferred = false;
        }
        let policy = worker.host.original_auto_policy(&worker.owner)?;
        if !worker.host.peer_network_settings(&worker.owner)?.enabled || !policy.enabled {
            jobs.abort_all();
            return Ok(());
        }
        if self.defer_until.is_some_and(|until| until > Instant::now()) {
            worker.auto_deferred()?;
            return Ok(());
        }
        self.defer_until = None;
        let active = worker
            .originals
            .entries
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .values()
            .filter(|p| p.active.is_some())
            .count();
        let free = MAX_ACTIVE
            .saturating_sub(active)
            .min(MAX_ACTIVE.saturating_sub(jobs.len()));
        if free == 0 {
            return Ok(());
        }
        let routes = worker.routes()?;
        let mut profiles = routes.iter().map(|r| r.profile).collect::<Vec<_>>();
        profiles.sort_by_key(ToString::to_string);
        profiles.dedup();
        if profiles.is_empty() {
            return Ok(());
        }
        self.pages.retain(|p, _| profiles.contains(p));
        let profile = profiles[self.profile_cursor % profiles.len()];
        self.profile_cursor = self.profile_cursor.wrapping_add(1);
        if !self.pages.contains_key(&profile) && self.pages.len() >= CAP {
            worker.auto_deferred()?;
            return Ok(());
        }
        let peers = worker.metadata_original_sources(profile, &routes)?;
        let after = self.pages.get(&profile).copied().flatten();
        let page = {
            let state = worker.host.active_state()?;
            worker.host.owner(&worker.owner)?;
            let r = crate::resources(&state)?;
            r.core
                .missing_originals_page(&r.core.local_human(profile)?, profile, after, 100)?
        };
        self.pages.insert(profile, page.next_after);
        worker
            .shared
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .auto_error = None;
        let now = Instant::now();
        self.retry.retain(|_, until| *until > now);
        let mut spawned = 0;
        for original in page.items {
            if spawned >= free {
                break;
            }
            if original.byte_length > policy.max_bytes {
                continue;
            }
            let key = (profile, original.original_id);
            let (intent, backoff, blocked) = {
                let state = worker.host.active_state()?;
                let r = crate::resources(&state)?;
                let intent = original_auto_store::intent(
                    &r.persistence.auth,
                    profile,
                    original.original_id,
                )?;
                let backoff = original_auto_store::backoff(
                    &r.persistence.auth,
                    profile,
                    original.original_id,
                )?;
                let lifecycle = r.core.original_lifecycle_status(
                    &r.core.local_human(profile)?,
                    profile,
                    original.original_id,
                )?;
                let blocked = !crate::original_lifecycle::automatic_fetch_allowed(
                    lifecycle.bytes_state,
                ) || matches!(r.core.original_availability(&r.core.local_human(profile)?,profile,original.original_id)?,OriginalAvailability::Local{stage}if stage.state==StageState::HashMismatch);
                (intent, backoff, blocked)
            };
            if intent.suppression.is_some() || blocked {
                continue;
            }
            let deadline = self
                .retry
                .get(&key)
                .copied()
                .unwrap_or(self.started + Duration::from_millis(backoff.delay_ms));
            if deadline > now {
                continue;
            }
            if peers.is_empty() {
                let mut state = worker.shared.lock().map_err(|_| HostError::StatePoisoned)?;
                state.auto_deferred = true;
                state.auto_error = Some("original_source_waiting");
                break;
            }
            // Unexpired live deadlines are never evicted/rearmed from an old
            // bootstrap anchor. Overflow is visible and admission is deferred.
            if self.retry.len() >= CAP && !self.retry.contains_key(&key) {
                worker.auto_deferred()?;
                break;
            }
            let index = self.sources.get(&key).copied().unwrap_or(0) % peers.len();
            let peer = peers[index];
            let worker = worker.clone();
            let cancel = cancel.clone();
            let policy_revision = policy.revision;
            jobs.spawn(async move {
                worker
                    .auto_attempt(profile, peer, original, policy_revision, cancel, generation)
                    .await
            });
            spawned += 1;
        }
        Ok(())
    }
}
impl Worker {
    fn auto_deferred(&self) -> Result<(), HostError> {
        let mut state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        state.auto_deferred = true;
        Ok(())
    }
    fn metadata_original_sources(
        &self,
        p: ProfileId,
        routes: &[Route],
    ) -> Result<Vec<DeviceId>, HostError> {
        let members = self.host.peer_members(&self.owner, p)?;
        let Some(local) = members.iter().find(|m| {
            m.device_id == self.host.device_id
                && !m.revoked
                && m.state == PeerJoinState::Ready
                && m.capabilities.read_originals
        }) else {
            return Ok(vec![]);
        };
        let own = self.host.local_origin_state(&self.owner, p)?;
        let state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let mut peers = vec![];
        for route in routes.iter().filter(|r| r.profile == p) {
            let Some(member) = members.iter().find(|m| {
                m.device_id == route.device && !m.revoked && m.state == PeerJoinState::Ready
            }) else {
                continue;
            };
            if state
                .progress
                .get(&(p, route.device))
                .is_some_and(|progress| {
                    progress.error.is_none()
                        && progress.member_generation == member.generation
                        && progress.memo.as_ref().is_some_and(|memo| {
                            // A known original is authorized and hash-bound at
                            // every admission/write/seal below. Unrelated unsigned
                            // history may keep the profile incomplete indefinitely;
                            // it must not veto independently referenced bytes.
                            memo.local_member_generation == local.generation
                                && (!memo.can_send
                                    || memo
                                        .sent_snapshot
                                        .as_ref()
                                        .is_some_and(|s| s.origin == own.0 && s.head == own.1))
                                && (!memo.can_receive
                                    || (memo.peer_runtime_id == progress.observed_runtime
                                        && memo.received_snapshot == progress.observed_snapshot))
                        })
                })
            {
                peers.push(route.device);
            }
        }
        Ok(peers)
    }
    async fn auto_attempt(
        &self,
        p: ProfileId,
        peer: DeviceId,
        original: OriginalRef,
        policy_revision: Uuid,
        network_cancel: PeerCancellation,
        generation: u64,
    ) -> AutoCompletion {
        let key = (p, original.original_id);
        let request = Uuid::new_v4();
        let mode = OriginalFetchMode::Automatic { policy_revision };
        let admitted =
            (|| -> Result<Option<(Job, crate::peers::Lease, Option<Uuid>)>, HostError> {
                let state = self.host.active_state()?;
                self.host.owner(&self.owner)?;
                let r = crate::resources(&state)?;
                if network_cancel.is_cancelled()
                    || self
                        .shared
                        .lock()
                        .map_err(|_| HostError::StatePoisoned)?
                        .generation
                        != generation
                {
                    return Ok(None);
                }
                let availability = r.core.original_availability(
                    &r.core.local_human(p)?,
                    p,
                    original.original_id,
                )?;
                if matches!(&availability,OriginalAvailability::Local{stage}if stage.state==StageState::Verified||stage.state==StageState::HashMismatch)
                {
                    return Ok(None);
                }
                let actual = match availability {
                    OriginalAvailability::Missing { original } => original,
                    OriginalAvailability::Local { stage } => stage.original,
                };
                if actual != original {
                    return Err(HostError::Core(exomind_core::CoreError::OriginalConflict));
                }
                let intent =
                    original_auto_store::intent(&r.persistence.auth, p, original.original_id)?;
                if !original_auto_store::eligible(
                    &r.persistence.auth,
                    p,
                    original.original_id,
                    original.byte_length,
                    policy_revision,
                    intent.intent_revision,
                )? {
                    return Ok(None);
                }
                let job = self.originals.start(key, peer, request)?;
                Ok(Some((
                    job,
                    self.host.peers.register(false)?,
                    intent.intent_revision,
                )))
            })();
        let (job, _lease, intent_revision) = match admitted {
            Ok(Some(value)) => value,
            Ok(None)
            | Err(
                HostError::PeerBusy
                | HostError::PeerCancelled
                | HostError::PeerNetworkDisabled
                | HostError::Stopped,
            ) => {
                return AutoCompletion {
                    key,
                    disposition: Disposition::Skipped,
                };
            }
            Err(error) => {
                return AutoCompletion {
                    key,
                    disposition: Disposition::Error(original_error(&error)),
                };
            }
        };
        let shared = self.shared.clone();
        let jobs = Arc::downgrade(&self.originals);
        let run_cancel = network_cancel.clone();
        let id = original.original_id;
        let admission = OriginalAdmission::managed(
            self.host.runtime_id,
            p,
            original.clone(),
            intent_revision,
            mode,
            job.cancel.clone(),
            move || {
                if run_cancel.is_cancelled()
                    || shared
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
                    .get(&(p, id))
                    .and_then(|p| p.active.as_ref())
                    .is_some_and(|a| a.id == request && !a.cancel.is_cancelled()))
            },
        );
        let mut result = tokio::select! {biased;
            _=job.cancel.cancelled()=>Err(HostError::PeerCancelled),
            _=network_cancel.cancelled()=>Err(HostError::PeerCancelled),
            _=self.host.peers.cancel.cancelled()=>Err(HostError::Stopped),
            result=self.fetch_sessions(p,peer,id,&job.cancel,original.clone(),&job.completion,&admission,true)=>result,
        };
        let mut disposition = Disposition::Skipped;
        match self.host.active_state() {
            Ok(mut state) => {
                if let Some(r) = state.resources.as_mut() {
                    match admission.validate_result(&self.host, r, &result, None) {
                        Err(error) => result = Err(error),
                        Ok(()) => {
                            let persist = (|| -> Result<Disposition, HostError> {
                                let availability =
                                    r.core
                                        .original_availability(&r.core.local_human(p)?, p, id)?;
                                if matches!(&availability,OriginalAvailability::Local{stage}if stage.state==StageState::HashMismatch)
                                {
                                    return Ok(Disposition::Blocked);
                                }
                                let ready = matches!(&availability,OriginalAvailability::Local{stage}if stage.state==StageState::Verified&&stage.next_offset==stage.original.byte_length);
                                let tx = super::super::super::membership_store::transaction(
                                    &mut r.persistence.auth,
                                )?;
                                let decision = if ready {
                                    original_auto_store::clear_backoff(&tx, p, id)?;
                                    Disposition::Ready
                                } else {
                                    match &result {
                                        Ok(_) => Disposition::Partial,
                                        Err(
                                            HostError::PeerBusy
                                            | HostError::PeerCancelled
                                            | HostError::PeerNetworkDisabled
                                            | HostError::Stopped,
                                        ) => Disposition::Skipped,
                                        Err(error) => match original_auto_store::note_failure(
                                            &tx,
                                            p,
                                            id,
                                            original_error(error),
                                            original.byte_length,
                                            policy_revision,
                                            intent_revision,
                                        )? {
                                            Some(retry) => Disposition::Retry(retry.delay_ms),
                                            None => Disposition::Skipped,
                                        },
                                    }
                                };
                                tx.commit().map_err(|_| HostError::PeerSyncUnavailable)?;
                                Ok(decision)
                            })();
                            disposition = match persist {
                                Ok(value) => value,
                                Err(error) => Disposition::Error(original_error(&error)),
                            };
                        }
                    }
                    self.originals.finish(key, request, &result);
                } else {
                    result = Err(HostError::Stopped);
                    self.originals.finish(key, request, &result);
                }
            }
            Err(error) => {
                result = Err(error);
                self.originals.finish(key, request, &result);
            }
        }
        job.cancel.cancel();
        job.completion.close();
        if self.originals.wait_request(key, request).await.is_err() {
            disposition = Disposition::Error("original_drain_failed");
        }
        AutoCompletion { key, disposition }
    }
}
impl PeerNetwork {
    #[cfg(test)]
    pub(in crate::peers) fn auto_yields_for_test(&self) -> usize {
        self.shared.lock().unwrap().auto_yields
    }
    #[cfg(test)]
    pub(in crate::peers) async fn source_hook_for_test(
        &self,
        hook: impl FnOnce() + Send + 'static,
    ) {
        self.lifecycle
            .lock()
            .await
            .as_ref()
            .unwrap()
            .incoming
            .set_source_hook(hook);
    }
    pub fn original_auto_queue_status(&self) -> Result<OriginalAutoQueueStatus, HostError> {
        let network = self.host.peer_network_settings(&self.owner)?;
        let policy = self.host.original_auto_policy(&self.owner)?;
        let state = self.shared.lock().map_err(|_| HostError::StatePoisoned)?;
        let active = self
            .originals
            .entries
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .values()
            .filter(|p| p.active.is_some())
            .count();
        Ok(OriginalAutoQueueStatus {
            network_enabled: network.enabled,
            policy_enabled: policy.enabled,
            active_outbound: active,
            deferred: state.auto_deferred,
            last_error_code: state.auto_error,
        })
    }
}
