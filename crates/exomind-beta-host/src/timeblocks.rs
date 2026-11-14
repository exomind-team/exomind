use crate::{BetaHost, GrantKind, HostError, Session, context, resources};
use exomind_core::{
    DeadlineSnapshot, EventQuery, IntervalPage, IntervalQuery, ProfileId, Receipt,
    TimeblockCommand, TimeblockNodePage, TimeblockRevision, TimeblockSnapshot, TimelinePage,
};
use serde::Serialize;
use std::{
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const SCHEDULER_POLL: Duration = Duration::from_millis(100);
const SCHEDULER_BATCH: usize = 16;
#[derive(Debug, Clone)]
pub struct HostClockSample {
    pub epoch_id: Uuid,
    pub wall_ms: i64,
    pub elapsed_ms: u64,
}
pub trait HostClock: Send + Sync {
    fn sample(&self) -> HostClockSample;
}
pub(crate) struct SystemHostClock {
    epoch: Uuid,
    started: Instant,
}
impl Default for SystemHostClock {
    fn default() -> Self {
        Self {
            epoch: Uuid::new_v4(),
            started: Instant::now(),
        }
    }
}
impl HostClock for SystemHostClock {
    fn sample(&self) -> HostClockSample {
        HostClockSample {
            epoch_id: self.epoch,
            wall_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(i64::MAX as u128) as i64,
            elapsed_ms: self.started.elapsed().as_millis().min(i64::MAX as u128) as u64,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub instance_id: Uuid,
    pub running: bool,
    pub last_error: Option<String>,
}
#[derive(Default)]
struct ServiceState {
    instance: Option<Uuid>,
    running: bool,
    thread: Option<JoinHandle<()>>,
    last_error: Option<String>,
}
#[derive(Default)]
pub(crate) struct Services {
    cancelled: AtomicBool,
    state: Mutex<ServiceState>,
    changed: Condvar,
}
impl Services {
    pub fn request_stop(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.changed.notify_all();
    }
    pub fn wake(&self) {
        self.changed.notify_all();
    }
    pub fn wait_stopped(&self, timeout: Duration) -> Result<(), HostError> {
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().map_err(|_| HostError::StatePoisoned)?;
        while state.running
            || state
                .thread
                .as_ref()
                .is_some_and(|thread| !thread.is_finished())
        {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(HostError::Shutdown);
            }
            state = self
                .changed
                .wait_timeout(state, remaining.min(Duration::from_millis(10)))
                .map_err(|_| HostError::StatePoisoned)?
                .0;
        }
        let thread = state.thread.take();
        drop(state);
        if let Some(thread) = thread {
            thread.join().map_err(|_| HostError::StatePoisoned)?;
        }
        Ok(())
    }
}
struct ServiceGuard(Arc<Services>);
impl Drop for ServiceGuard {
    fn drop(&mut self) {
        let mut state = self
            .0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.running = false;
        self.0.changed.notify_all();
    }
}

fn run(weak: Weak<BetaHost>, services: Arc<Services>, clock: Arc<dyn HostClock>) {
    let _owned = ServiceGuard(services.clone());
    while !services.cancelled.load(Ordering::Acquire) {
        // A slow external clock sample owns no Core gate/connection. Eligibility
        // is checked after it returns, never only before an asynchronous gap.
        let sample = clock.sample();
        if services.cancelled.load(Ordering::Acquire) {
            break;
        }
        let Some(host) = weak.upgrade() else {
            break;
        };
        let result = host.reconcile_clock(sample);
        drop(host);
        if matches!(result, Err(HostError::Stopped)) {
            break;
        }
        if result.is_err() {
            let mut state = services
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.last_error = Some("scheduler_operation_failed".into());
        }
        let state = services
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if services.cancelled.load(Ordering::Acquire) {
            break;
        }
        drop(services.changed.wait_timeout(state, SCHEDULER_POLL));
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DeadlineEnvelope {
    pub runtime_id: Uuid,
    pub device_id: exomind_core::DeviceId,
    pub profile_id: ProfileId,
    pub projection_revision: TimeblockRevision,
    pub block_id: Option<exomind_core::TimeblockId>,
    pub deadline: Option<DeadlineSnapshot>,
}

impl BetaHost {
    pub fn start_services(self: &Arc<Self>) -> Result<ServiceStatus, HostError> {
        let _gate = self.active_state()?;
        let mut state = self
            .services
            .state
            .lock()
            .map_err(|_| HostError::StatePoisoned)?;
        if state.running {
            return Ok(ServiceStatus {
                instance_id: state.instance.ok_or(HostError::StatePoisoned)?,
                running: true,
                last_error: state.last_error.clone(),
            });
        }
        if self.services.cancelled.load(Ordering::Acquire) {
            return Err(HostError::Stopped);
        }
        let instance = Uuid::new_v4();
        state.instance = Some(instance);
        state.running = true;
        let weak = Arc::downgrade(self);
        let services = self.services.clone();
        let clock = self.clock.clone();
        match std::thread::Builder::new()
            .name("exomind-beta-scheduler".into())
            .spawn(move || run(weak, services, clock))
        {
            Ok(thread) => state.thread = Some(thread),
            Err(error) => {
                state.running = false;
                return Err(HostError::Filesystem(error));
            }
        }
        Ok(ServiceStatus {
            instance_id: instance,
            running: true,
            last_error: state.last_error.clone(),
        })
    }
    pub fn wake_services(&self) {
        self.services.wake();
    }
    pub fn service_status(&self) -> Result<Option<ServiceStatus>, HostError> {
        let state = self
            .services
            .state
            .lock()
            .map_err(|_| HostError::StatePoisoned)?;
        Ok(state.instance.map(|instance_id| ServiceStatus {
            instance_id,
            running: state.running && self.accepting.load(Ordering::Acquire),
            last_error: state.last_error.clone(),
        }))
    }
    fn reconcile_clock(&self, sample: HostClockSample) -> Result<(), HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let stamp = resources.core.trusted_clock_stamp(
            sample.epoch_id,
            sample.wall_ms,
            sample.elapsed_ms,
        )?;
        let scheduler = resources.core.local_scheduler();
        for ticket in resources
            .core
            .due_deadlines(&scheduler, &stamp, SCHEDULER_BATCH)?
        {
            if !self.accepting.load(Ordering::Acquire) {
                return Err(HostError::Stopped);
            }
            resources
                .core
                .complete_deadline(&scheduler, &ticket, &stamp)?;
        }
        Ok(())
    }
    pub fn apply_timeblock(
        &self,
        session: &Session,
        command: &TimeblockCommand,
    ) -> Result<Receipt, HostError> {
        let sample = self.clock.sample();
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, command.profile_id, true)?;
        if authority.kind != GrantKind::Human {
            return Err(HostError::Forbidden);
        }
        let context = context(&resources.core, &authority)?;
        if let Some(receipt) = resources
            .core
            .timeblock_command_receipt(&context, command)?
        {
            return Ok(receipt);
        }
        let stamp = resources.core.trusted_clock_stamp(
            sample.epoch_id,
            sample.wall_ms,
            sample.elapsed_ms,
        )?;
        // A delayed worker cannot let a new human action erase a deadline that
        // has already matured. Retried commands above still return the original
        // receipt before clock/revision advancement, as promised.
        let scheduler = resources.core.local_scheduler();
        for ticket in
            resources
                .core
                .due_deadlines_for_profile(&scheduler, command.profile_id, &stamp)?
        {
            if !self.accepting.load(Ordering::Acquire) {
                return Err(HostError::Stopped);
            }
            resources
                .core
                .complete_deadline(&scheduler, &ticket, &stamp)?;
        }
        let result = resources.core.apply_timeblock(&context, command, &stamp)?;
        drop(state);
        self.wake_services();
        Ok(result)
    }
    pub fn timeblock_snapshot(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<TimeblockSnapshot, HostError> {
        let sample = self.clock.sample();
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        let stamp = resources.core.trusted_clock_stamp(
            sample.epoch_id,
            sample.wall_ms,
            sample.elapsed_ms,
        )?;
        Ok(resources.core.timeblock_snapshot(
            &context(&resources.core, &authority)?,
            profile,
            &stamp,
        )?)
    }
    pub fn timeblock_nodes(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<TimeblockNodePage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        Ok(resources.core.timeblock_nodes(
            &context(&resources.core, &authority)?,
            profile,
            query,
        )?)
    }
    pub fn timeblock_intervals(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &IntervalQuery,
    ) -> Result<IntervalPage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        Ok(resources.core.timeblock_intervals(
            &context(&resources.core, &authority)?,
            profile,
            query,
        )?)
    }
    pub fn timeline_page(
        &self,
        session: &Session,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<TimelinePage, HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        let authority = self.profile_authority(resources, session, profile, false)?;
        Ok(resources
            .core
            .timeline_page(&context(&resources.core, &authority)?, profile, query)?)
    }
    pub fn deadline_envelope(
        &self,
        session: &Session,
        profile: ProfileId,
    ) -> Result<DeadlineEnvelope, HostError> {
        let snapshot = self.timeblock_snapshot(session, profile)?;
        Ok(DeadlineEnvelope {
            runtime_id: self.runtime_id,
            device_id: self.device_id,
            profile_id: profile,
            projection_revision: snapshot.revision,
            block_id: snapshot.active.as_ref().map(|block| block.block_id),
            deadline: snapshot.active.and_then(|block| block.deadline),
        })
    }
    /// Reserved for trusted Native membership/owner management; never mapped
    /// to a caller-selected scheduler role or to human grant revocation.
    pub fn revoke_scheduler_owner(&self, session: &Session) -> Result<(), HostError> {
        let state = self.active_state()?;
        let resources = resources(&state)?;
        self.owner(session)?;
        resources
            .core
            .revoke_scheduler_owner(&resources.core.local_scheduler())?;
        drop(state);
        self.wake_services();
        Ok(())
    }
}
