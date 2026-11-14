//! Native-only source copies. Owner admission is shared with text operations;
//! long verification uses short independent reads outside the Host gate.
mod store;
use crate::{BetaHost, HostError, Session};
use exomind_core::{DeviceId, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
pub(crate) use store::Store;
use uuid::Uuid;
pub(crate) const DIRECTORY: &str = "private-sources";
pub(crate) const INITIALIZED: &str = "private-sources.initialized";
pub const MAX_LOCAL_SOURCE_CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_LOCAL_SOURCE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalSourceBegin {
    pub key: String,
    pub byte_length: u64,
    pub sha256: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalSourceState {
    Copying,
    Frozen,
    Ready,
    HashMismatch,
    Released,
}
impl LocalSourceState {
    fn parse(value: &str) -> Result<Self, HostError> {
        match value {
            "copying" => Ok(Self::Copying),
            "frozen" => Ok(Self::Frozen),
            "ready" => Ok(Self::Ready),
            "hash_mismatch" => Ok(Self::HashMismatch),
            "released" => Ok(Self::Released),
            _ => Err(HostError::LocalSourceCorrupt),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use exomind_core::{CaptureCommand, CommandId, EventId};
    use std::sync::mpsc;
    fn fixture() -> (tempfile::TempDir, Arc<BetaHost>, Session, ProfileId, String) {
        let directory = tempfile::tempdir().unwrap();
        let host = Arc::new(BetaHost::open(&directory.path().join("host")).unwrap());
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "hash fence")
            .unwrap();
        let key = serde_json::to_string(&[
            host.device_id.to_string(),
            profile.to_string(),
            Uuid::new_v4().to_string(),
        ])
        .unwrap();
        let hash = format!("{:x}", sha2::Sha256::digest(b"bytes"));
        host.begin_local_source(
            &owner,
            &LocalSourceBegin {
                key: key.clone(),
                byte_length: 5,
                sha256: hash,
            },
        )
        .unwrap();
        host.write_local_source_chunk(&owner, &key, 0, b"bytes")
            .unwrap();
        (directory, host, owner, profile, key)
    }
    use sha2::Digest;
    #[test]
    fn source_hash_holds_no_host_gate_and_stop_waits_for_its_owned_read_connection() {
        let (directory, host, owner, profile, key) = fixture();
        let (entered, receive) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        *host.source_jobs.during_hash.lock().unwrap() = Some(crate::originals::VerificationPause {
            entered,
            release: wait,
        });
        let worker = host.clone();
        let session = owner.clone();
        let source = key.clone();
        let hash = std::thread::spawn(move || worker.finish_local_source(&session, &source));
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        let human = host.native_human_session(&owner, profile).unwrap();
        host.capture(
            &human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                occurred_at_ms: 1,
                text: "text while Native source hash is paused".into(),
                tags: vec![],
                originals: vec![],
            },
        )
        .unwrap();
        host.request_stop();
        let stopper = host.clone();
        let (done, wait_done) = mpsc::channel();
        let stop = std::thread::spawn(move || {
            let result = stopper.stop();
            done.send(result).unwrap();
        });
        assert!(wait_done.recv_timeout(Duration::from_millis(50)).is_err());
        release.send(()).unwrap();
        assert!(matches!(hash.join().unwrap(), Err(HostError::Stopped)));
        wait_done
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        stop.join().unwrap();
        let reopened = BetaHost::open(&directory.path().join("host")).unwrap();
        assert_eq!(
            reopened
                .local_source_status(&reopened.owner_session().unwrap(), &key)
                .unwrap()
                .unwrap()
                .state,
            LocalSourceState::Frozen
        );
    }
    #[test]
    fn releasing_a_source_during_verification_is_conflict_not_a_host_stop() {
        let (_directory, host, owner, _profile, key) = fixture();
        let (entered, receive) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        *host.source_jobs.during_hash.lock().unwrap() = Some(crate::originals::VerificationPause {
            entered,
            release: wait,
        });
        let worker = host.clone();
        let session = owner.clone();
        let source = key.clone();
        let hash = std::thread::spawn(move || worker.finish_local_source(&session, &source));
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        let generation = host
            .local_source_status(&owner, &key)
            .unwrap()
            .unwrap()
            .generation;
        host.remove_local_source(&owner, &key, generation).unwrap();
        assert!(host.status().unwrap().running);
        release.send(()).unwrap();
        assert!(matches!(
            hash.join().unwrap(),
            Err(HostError::LocalSourceConflict)
        ));
        assert_eq!(
            host.local_source_status(&owner, &key)
                .unwrap()
                .unwrap()
                .state,
            LocalSourceState::Released
        );
    }
    #[test]
    fn a_completed_hash_cannot_seal_after_request_stop() {
        let (_directory, host, owner, _profile, key) = fixture();
        let (entered, receive) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        *host.source_jobs.after_hash.lock().unwrap() = Some(crate::originals::VerificationPause {
            entered,
            release: wait,
        });
        let worker = host.clone();
        let hash = std::thread::spawn(move || worker.finish_local_source(&owner, &key));
        receive.recv_timeout(Duration::from_secs(2)).unwrap();
        host.request_stop();
        release.send(()).unwrap();
        assert!(matches!(hash.join().unwrap(), Err(HostError::Stopped)));
        host.stop().unwrap();
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LocalSourceInfo {
    pub key: String,
    pub byte_length: u64,
    pub sha256: String,
    pub next_offset: u64,
    pub generation: u64,
    pub state: LocalSourceState,
}

struct Job {
    key: String,
    cancelled: Arc<AtomicBool>,
}
#[derive(Default)]
pub(crate) struct Jobs {
    active: Mutex<HashMap<Uuid, Job>>,
    idle: Condvar,
    #[cfg(test)]
    during_hash: Mutex<Option<crate::originals::VerificationPause>>,
    #[cfg(test)]
    after_hash: Mutex<Option<crate::originals::VerificationPause>>,
}
struct Lease<'a> {
    registry: &'a Jobs,
    id: Uuid,
    cancelled: Arc<AtomicBool>,
}
impl Jobs {
    #[cfg(test)]
    fn pause(slot: &Mutex<Option<crate::originals::VerificationPause>>) {
        if let Some(pause) = slot.lock().unwrap().take() {
            pause.entered.send(()).unwrap();
            pause.release.recv_timeout(Duration::from_secs(10)).unwrap();
        }
    }
    fn register(&self, key: &str) -> Result<Lease<'_>, HostError> {
        let mut jobs = self.active.lock().map_err(|_| HostError::StatePoisoned)?;
        if jobs.len() >= 2 {
            return Err(HostError::LocalSourceBusy);
        }
        let id = Uuid::new_v4();
        let cancelled = Arc::new(AtomicBool::new(false));
        jobs.insert(
            id,
            Job {
                key: key.into(),
                cancelled: cancelled.clone(),
            },
        );
        Ok(Lease {
            registry: self,
            id,
            cancelled,
        })
    }
    fn cancel_key(&self, key: &str) -> Result<(), HostError> {
        for job in self
            .active
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .values()
            .filter(|job| job.key == key)
        {
            job.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }
    pub(crate) fn cancel_all(&self) -> Result<(), HostError> {
        for job in self
            .active
            .lock()
            .map_err(|_| HostError::StatePoisoned)?
            .values()
        {
            job.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }
    pub(crate) fn wait_empty(&self, timeout: Duration) -> Result<(), HostError> {
        let end = Instant::now() + timeout;
        let mut jobs = self.active.lock().map_err(|_| HostError::StatePoisoned)?;
        while !jobs.is_empty() {
            let left = end.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(HostError::Shutdown);
            }
            jobs = self
                .idle
                .wait_timeout(jobs, left)
                .map_err(|_| HostError::StatePoisoned)?
                .0;
        }
        Ok(())
    }
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        let mut jobs = self
            .registry
            .active
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        jobs.remove(&self.id);
        self.registry.idle.notify_all();
    }
}

fn validate_key(key: &str, device: DeviceId, core: &exomind_core::Core) -> Result<(), HostError> {
    if key.len() > 256 {
        return Err(HostError::InvalidRequest);
    }
    let parts: [String; 3] = serde_json::from_str(key).map_err(|_| HostError::InvalidRequest)?;
    if serde_json::to_string(&parts).map_err(|_| HostError::InvalidRequest)? != key {
        return Err(HostError::InvalidRequest);
    }
    if parts[0] != device.to_string() {
        return Err(HostError::Forbidden);
    }
    let profile: ProfileId = parts[1].parse().map_err(|_| HostError::InvalidRequest)?;
    let id: Uuid = parts[2].parse().map_err(|_| HostError::InvalidRequest)?;
    if parts[1] != profile.to_string() || parts[2] != id.to_string() {
        return Err(HostError::InvalidRequest);
    }
    match core.local_human(profile) {
        Ok(_) => Ok(()),
        Err(exomind_core::CoreError::UnknownProfile) => Err(HostError::Forbidden),
        Err(error) => Err(HostError::Core(error)),
    }
}
fn cache(resources: &mut crate::Resources, device: DeviceId) -> Result<&mut Store, HostError> {
    if resources.local_sources.is_none() {
        resources.local_sources = Some(Store::open(&resources.persistence.root, device)?);
    }
    resources
        .local_sources
        .as_mut()
        .ok_or(HostError::LocalSourceUnavailable)
}
impl BetaHost {
    // Interrupted cleanup is resumed one physical block at a time. Releasing
    // the gate between blocks keeps text admission and stop available.
    pub fn begin_local_source(
        &self,
        owner: &Session,
        input: &LocalSourceBegin,
    ) -> Result<LocalSourceInfo, HostError> {
        loop {
            let mut state = self.active_state()?;
            self.owner(owner)?;
            let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
            validate_key(&input.key, self.device_id, &resources.core)?;
            if input.byte_length > MAX_LOCAL_SOURCE_BYTES {
                return Err(HostError::PayloadTooLarge);
            }
            if input.sha256.len() != 64
                || !input
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(HostError::InvalidRequest);
            }
            let store = cache(resources, self.device_id)?;
            if let Some(old) = store.status(&input.key)? {
                if old.byte_length != input.byte_length || old.sha256 != input.sha256 {
                    return Err(HostError::LocalSourceConflict);
                }
                if old.state == LocalSourceState::Released
                    && store.prune_released(&input.key, old.generation)?
                {
                    drop(state);
                    std::thread::yield_now();
                    continue;
                }
            }
            return store.begin(input);
        }
    }
    pub fn local_source_status(
        &self,
        owner: &Session,
        key: &str,
    ) -> Result<Option<LocalSourceInfo>, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        validate_key(key, self.device_id, &resources.core)?;
        cache(resources, self.device_id)?.status(key)
    }
    pub fn write_local_source_chunk(
        &self,
        owner: &Session,
        key: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<LocalSourceInfo, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        validate_key(key, self.device_id, &resources.core)?;
        if bytes.len() > MAX_LOCAL_SOURCE_CHUNK_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        if bytes.is_empty() || offset.checked_add(bytes.len() as u64).is_none() {
            return Err(HostError::InvalidRequest);
        }
        cache(resources, self.device_id)?.write(key, offset, bytes)
    }
    pub fn finish_local_source(
        &self,
        owner: &Session,
        key: &str,
    ) -> Result<LocalSourceInfo, HostError> {
        let (ticket, lease) = {
            let mut state = self.active_state()?;
            self.owner(owner)?;
            let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
            validate_key(key, self.device_id, &resources.core)?;
            let lease = self.source_jobs.register(key)?;
            let ticket = cache(resources, self.device_id)?.freeze(key)?;
            (ticket, lease)
        };
        #[cfg(test)]
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let actual = ticket
            .verify(|| {
                #[cfg(test)]
                if calls.fetch_add(1, Ordering::Relaxed) == 1 {
                    Jobs::pause(&self.source_jobs.during_hash);
                }
                lease.cancelled.load(Ordering::Acquire) || !self.accepting.load(Ordering::Acquire)
            })
            .map_err(|error| {
                if matches!(error, HostError::Stopped) && self.accepting.load(Ordering::Acquire) {
                    HostError::LocalSourceConflict
                } else {
                    error
                }
            })?;
        #[cfg(test)]
        Jobs::pause(&self.source_jobs.after_hash);
        let mut state = self.active_state()?;
        self.owner(owner)?;
        if lease.cancelled.load(Ordering::Acquire) {
            return Err(HostError::LocalSourceConflict);
        }
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        validate_key(key, self.device_id, &resources.core)?;
        cache(resources, self.device_id)?.seal(&ticket, &actual)
    }
    pub fn read_local_source_range(
        &self,
        owner: &Session,
        key: &str,
        offset: u64,
        length: usize,
    ) -> Result<Vec<u8>, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
        validate_key(key, self.device_id, &resources.core)?;
        if length > MAX_LOCAL_SOURCE_CHUNK_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        if length == 0 || offset.checked_add(length as u64).is_none() {
            return Err(HostError::InvalidRequest);
        }
        cache(resources, self.device_id)?.read(key, offset, length)
    }
    // The tombstone/CAS is committed before pruning. Each following block
    // rechecks that generation, so a newer explicit copy is never swept away.
    pub fn remove_local_source(
        &self,
        owner: &Session,
        key: &str,
        expected_generation: u64,
    ) -> Result<(), HostError> {
        let generation = {
            let mut state = self.active_state()?;
            self.owner(owner)?;
            let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
            validate_key(key, self.device_id, &resources.core)?;
            let generation = cache(resources, self.device_id)?.release(key, expected_generation)?;
            self.source_jobs.cancel_key(key)?;
            generation
        };
        loop {
            let mut state = self.active_state()?;
            self.owner(owner)?;
            let resources = state.resources.as_mut().ok_or(HostError::Stopped)?;
            validate_key(key, self.device_id, &resources.core)?;
            if !cache(resources, self.device_id)?.prune_released(key, generation)? {
                return Ok(());
            }
            drop(state);
            std::thread::yield_now();
        }
    }
}
