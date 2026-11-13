use crate::{Authority, BetaHost, HostError, Session, context, resources};
use exomind_core::{
    BeginStageCommand, MAX_ORIGINAL_CHUNK_BYTES, OriginalChunk, OriginalId, ProfileId, StageId,
    StageState, StageStatus,
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

const MAX_CONCURRENT_VERIFICATIONS: usize = 4;

struct ActiveVerification {
    grant: Uuid,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub(crate) struct VerificationRegistry {
    jobs: Mutex<HashMap<Uuid, ActiveVerification>>,
    idle: Condvar,
    #[cfg(test)]
    pub(crate) during_hash: Mutex<Option<VerificationPause>>,
    #[cfg(test)]
    pub(crate) after_hash: Mutex<Option<VerificationPause>>,
}

#[cfg(test)]
pub(crate) struct VerificationPause {
    pub entered: std::sync::mpsc::Sender<()>,
    pub release: std::sync::mpsc::Receiver<()>,
}

struct VerificationLease<'a> {
    registry: &'a VerificationRegistry,
    id: Uuid,
    cancelled: Arc<AtomicBool>,
}

impl VerificationRegistry {
    fn register(&self, grant: Uuid) -> Result<VerificationLease<'_>, HostError> {
        let mut jobs = self.jobs.lock().map_err(|_| HostError::StatePoisoned)?;
        if jobs.len() >= MAX_CONCURRENT_VERIFICATIONS {
            return Err(HostError::VerificationBusy);
        }
        let id = Uuid::new_v4();
        let cancelled = Arc::new(AtomicBool::new(false));
        jobs.insert(
            id,
            ActiveVerification {
                grant,
                cancelled: cancelled.clone(),
            },
        );
        Ok(VerificationLease {
            registry: self,
            id,
            cancelled,
        })
    }

    pub(crate) fn cancel_grant(&self, grant: Uuid) -> Result<(), HostError> {
        let jobs = self.jobs.lock().map_err(|_| HostError::StatePoisoned)?;
        for job in jobs.values().filter(|job| job.grant == grant) {
            job.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub(crate) fn cancel_all(&self) -> Result<(), HostError> {
        let jobs = self.jobs.lock().map_err(|_| HostError::StatePoisoned)?;
        for job in jobs.values() {
            job.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub(crate) fn wait_empty(&self, timeout: Duration) -> Result<(), HostError> {
        let deadline = Instant::now() + timeout;
        let mut jobs = self.jobs.lock().map_err(|_| HostError::StatePoisoned)?;
        while !jobs.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(HostError::Shutdown);
            }
            let (next, _) = self
                .idle
                .wait_timeout(jobs, remaining)
                .map_err(|_| HostError::StatePoisoned)?;
            jobs = next;
        }
        Ok(())
    }

    #[cfg(test)]
    fn pause(slot: &Mutex<Option<VerificationPause>>) -> Result<(), HostError> {
        let pause = slot.lock().map_err(|_| HostError::StatePoisoned)?.take();
        if let Some(pause) = pause {
            let _ = pause.entered.send(());
            pause
                .release
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| HostError::Shutdown)?;
        }
        Ok(())
    }
}

impl Drop for VerificationLease<'_> {
    fn drop(&mut self) {
        // Even a poisoned test/embedding thread must unregister its own job;
        // resource ownership still prevents releasing the root prematurely.
        let mut jobs = self
            .registry
            .jobs
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        jobs.remove(&self.id);
        self.registry.idle.notify_all();
    }
}

fn valid_range(length: usize) -> Result<(), HostError> {
    if length == 0 || length > MAX_ORIGINAL_CHUNK_BYTES {
        return Err(HostError::InvalidRequest);
    }
    Ok(())
}

impl BetaHost {
    pub fn begin_stage(
        &self,
        session: &Session,
        command: &BeginStageCommand,
    ) -> Result<StageStatus, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, command.profile_id, true)?;
        Ok(resources
            .core
            .begin_stage(&context(&resources.core, &authority)?, command)?)
    }

    pub fn stage_status(
        &self,
        session: &Session,
        profile: ProfileId,
        stage: StageId,
    ) -> Result<StageStatus, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        // Stage metadata is a private draft. An observer must not inherit the
        // human author's private-stage rights through the Core read adapter.
        let authority = self.profile_authority(resources, session, profile, true)?;
        Ok(resources
            .core
            .stage_status(&context(&resources.core, &authority)?, stage)?)
    }

    pub fn write_stage_chunk(
        &self,
        session: &Session,
        profile: ProfileId,
        stage: StageId,
        offset: u64,
        bytes: &[u8],
    ) -> Result<StageStatus, HostError> {
        if bytes.len() > MAX_ORIGINAL_CHUNK_BYTES {
            return Err(HostError::PayloadTooLarge);
        }
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, true)?;
        Ok(resources.core.write_stage_chunk(
            &context(&resources.core, &authority)?,
            stage,
            offset,
            bytes,
        )?)
    }

    /// Freeze and register while admitted, hash on Core's independent readonly
    /// ticket outside the gate, then reauthorize and seal under the current gate.
    /// The proof never becomes a caller-supplied HTTP or native capability.
    pub fn verify_stage(
        &self,
        session: &Session,
        profile: ProfileId,
        stage: StageId,
    ) -> Result<StageStatus, HostError> {
        let (ticket, lease) = {
            let state = self.active_state()?;
            let resources = resources(&state)?;
            let authority = self.profile_authority(resources, session, profile, true)?;
            let context = context(&resources.core, &authority)?;
            let status = resources.core.stage_status(&context, stage)?;
            if status.state == StageState::Verified {
                return Ok(status);
            }
            let Authority::Grant(grant) = session.authority else {
                return Err(HostError::Forbidden);
            };
            let lease = self.verifications.register(grant)?;
            let ticket = resources.core.freeze_stage(&context, stage)?;
            (ticket, lease)
        };
        #[cfg(test)]
        let checkpoints = std::cell::Cell::new(0);
        let proof = ticket.verify(|| {
            #[cfg(test)]
            {
                let checkpoint = checkpoints.get();
                checkpoints.set(checkpoint + 1);
                // Core's second cancellation checkpoint owns the independent
                // readonly connection, before its first bounded chunk read.
                if checkpoint == 1
                    && VerificationRegistry::pause(&self.verifications.during_hash).is_err()
                {
                    return true;
                }
            }
            !self.accepting.load(Ordering::Acquire) || lease.cancelled.load(Ordering::Acquire)
        });
        #[cfg(test)]
        VerificationRegistry::pause(&self.verifications.after_hash)?;
        // Recheck lifecycle/revocation even when cancellation already surfaced,
        // so the public result records stopped/revoked eligibility accurately.
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, true)?;
        let proof = proof?;
        Ok(resources
            .core
            .finish_stage(&context(&resources.core, &authority)?, &proof)?)
    }

    pub fn read_stage_range(
        &self,
        session: &Session,
        profile: ProfileId,
        stage: StageId,
        offset: u64,
        length: usize,
    ) -> Result<OriginalChunk, HostError> {
        valid_range(length)?;
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, true)?;
        Ok(resources.core.read_stage_range(
            &context(&resources.core, &authority)?,
            stage,
            offset,
            length,
        )?)
    }

    pub fn read_original_range(
        &self,
        session: &Session,
        profile: ProfileId,
        original: OriginalId,
        offset: u64,
        length: usize,
    ) -> Result<OriginalChunk, HostError> {
        valid_range(length)?;
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        // Core requires an existing event reference in this profile. Knowing an
        // original UUID/hash never grants access to a private verified draft.
        Ok(resources.core.read_original_range(
            &context(&resources.core, &authority)?,
            profile,
            original,
            offset,
            length,
        )?)
    }
}
