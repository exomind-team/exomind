use super::{Failure, cancelled, failure, io_failure};
use exomind_beta_host::HostError;
use exomind_core::{OriginalId, ProfileId};
use std::{
    collections::HashSet,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use uuid::Uuid;

const RUNNING: u8 = 0;
const CANCELLED: u8 = 1;
const PUBLISHING: u8 = 2;
const MAX_REQUEST_IDS: usize = 4096;
const MAX_COPY_TIME: Duration = Duration::from_secs(60 * 60);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct OriginalKey {
    profile_id: ProfileId,
    original_id: OriginalId,
}

impl OriginalKey {
    fn new(profile_id: ProfileId, original_id: OriginalId) -> Self {
        Self {
            profile_id,
            original_id,
        }
    }
}

struct Job {
    id: Uuid,
    key: OriginalKey,
    phase: AtomicU8,
    wake: Notify,
}

#[derive(Default)]
struct Jobs {
    active: Option<Arc<Job>>,
    used: HashSet<Uuid>,
    release_reservations: HashSet<OriginalKey>,
}

pub(crate) struct ExportManager {
    stopping: AtomicBool,
    jobs: Mutex<Jobs>,
    idle: Condvar,
    wake: Notify,
}

impl Default for ExportManager {
    fn default() -> Self {
        Self {
            stopping: AtomicBool::new(false),
            jobs: Mutex::new(Jobs::default()),
            idle: Condvar::new(),
            wake: Notify::new(),
        }
    }
}

impl ExportManager {
    pub(crate) fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    pub(crate) fn begin(
        self: &Arc<Self>,
        request: Uuid,
        profile_id: ProfileId,
        original_id: OriginalId,
    ) -> Result<ExportLease, Failure> {
        if request.is_nil() {
            return Err(failure("invalid_request", "导出请求身份无效"));
        }
        let key = OriginalKey::new(profile_id, original_id);
        let mut jobs = self.jobs.lock().map_err(|_| io_failure())?;
        if self.stopping.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        if jobs.release_reservations.contains(&key) {
            return Err(original_busy());
        }
        if jobs.active.is_some() {
            return Err(failure(
                "export_busy",
                "已有原件正在导出，请完成或取消后重试",
            ));
        }
        if jobs.used.contains(&request) {
            return Err(failure(
                "export_request_reused",
                "此导出请求已使用，请重新发起导出",
            ));
        }
        if jobs.used.len() >= MAX_REQUEST_IDS {
            return Err(failure(
                "export_busy",
                "本次运行的导出请求过多，请重启应用后继续",
            ));
        }
        let job = Arc::new(Job {
            id: request,
            key,
            phase: AtomicU8::new(RUNNING),
            wake: Notify::new(),
        });
        jobs.used.insert(request);
        jobs.active = Some(job.clone());
        Ok(ExportLease {
            manager: self.clone(),
            job,
            started: Instant::now(),
        })
    }

    #[allow(dead_code)] // Stage 2 adds the guard before Stage 3 wires Native lifecycle commands.
    pub(crate) fn reserve_release(
        self: &Arc<Self>,
        profile_id: ProfileId,
        original_id: OriginalId,
    ) -> Result<ReleaseReservation, Failure> {
        let key = OriginalKey::new(profile_id, original_id);
        let mut jobs = self.jobs.lock().map_err(|_| io_failure())?;
        if self.stopping.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        if jobs.active.as_ref().is_some_and(|job| job.key == key)
            || !jobs.release_reservations.insert(key)
        {
            return Err(original_busy());
        }
        Ok(ReleaseReservation {
            manager: self.clone(),
            key,
        })
    }

    /// Linearizes admission closure with begin/reserve under the same state lock.
    pub(crate) fn request_stop(&self) {
        let jobs_guard = self.jobs.lock().unwrap_or_else(|error| error.into_inner());
        self.stopping.store(true, Ordering::Release);
        drop(jobs_guard);
        self.wake.notify_one();
    }

    pub(crate) fn wait_empty(&self, timeout: Duration) -> Result<(), HostError> {
        let end = Instant::now() + timeout;
        let mut jobs = self.jobs.lock().map_err(|_| HostError::StatePoisoned)?;
        while jobs.active.is_some() || !jobs.release_reservations.is_empty() {
            let remaining = end.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(HostError::Shutdown);
            }
            jobs = self
                .idle
                .wait_timeout(jobs, remaining)
                .map_err(|_| HostError::StatePoisoned)?
                .0;
        }
        Ok(())
    }

    pub(crate) fn cancel(&self, request: Uuid) -> Result<bool, Failure> {
        let jobs = self.jobs.lock().map_err(|_| io_failure())?;
        let Some(job) = jobs.active.as_ref().filter(|job| job.id == request) else {
            return Ok(false);
        };
        let accepted = job.phase.load(Ordering::Acquire) == CANCELLED
            || job
                .phase
                .compare_exchange(RUNNING, CANCELLED, Ordering::AcqRel, Ordering::Acquire)
                .is_ok();
        if accepted {
            job.wake.notify_one();
        }
        Ok(accepted)
    }

    #[cfg(target_os = "android")]
    pub(crate) fn active_request(&self) -> Result<Option<Uuid>, Failure> {
        let jobs = self.jobs.lock().map_err(|_| io_failure())?;
        Ok(jobs.active.as_ref().map(|job| job.id))
    }
}

fn original_busy() -> Failure {
    failure(
        "original_busy",
        "同一原件仍在 Native 打开或导出，请完成或取消后重试",
    )
}

pub(crate) struct ReleaseReservation {
    manager: Arc<ExportManager>,
    key: OriginalKey,
}

impl Drop for ReleaseReservation {
    fn drop(&mut self) {
        let mut jobs = self
            .manager
            .jobs
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        jobs.release_reservations.remove(&self.key);
        self.manager.idle.notify_all();
    }
}

pub(crate) struct ExportLease {
    manager: Arc<ExportManager>,
    job: Arc<Job>,
    started: Instant,
}

impl ExportLease {
    pub(crate) fn is_cancelled(&self) -> bool {
        self.job.phase.load(Ordering::Acquire) != PUBLISHING
            && (self.manager.stopping.load(Ordering::Acquire)
                || self.job.phase.load(Ordering::Acquire) == CANCELLED
                || self.started.elapsed() >= MAX_COPY_TIME)
    }

    pub(crate) fn check(&self) -> Result<(), Failure> {
        if self.is_cancelled() {
            Err(cancelled())
        } else {
            Ok(())
        }
    }

    pub(crate) fn explicitly_cancelled(&self) -> bool {
        self.job.phase.load(Ordering::Acquire) == CANCELLED
    }

    pub(crate) fn stopped_without_explicit_cancel(&self) -> bool {
        !self.explicitly_cancelled()
            && (self.manager.stopping.load(Ordering::Acquire)
                || self.started.elapsed() >= MAX_COPY_TIME)
    }

    pub(crate) async fn cancellation(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            let remaining = MAX_COPY_TIME.saturating_sub(self.started.elapsed());
            tokio::select! {
                _ = self.manager.wake.notified() => {},
                _ = self.job.wake.notified() => {},
                _ = tokio::time::sleep(remaining) => {},
            }
        }
    }

    pub(crate) fn admit_publish(&self) -> Result<(), Failure> {
        self.check()?;
        // Cancellation wins until publication admission. Once admitted, the
        // atomic no-clobber publication may finish; shutdown drains this lease.
        self.job
            .phase
            .compare_exchange(RUNNING, PUBLISHING, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| cancelled())?;
        Ok(())
    }
}

impl Drop for ExportLease {
    fn drop(&mut self) {
        let mut jobs = self
            .manager
            .jobs
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if jobs
            .active
            .as_ref()
            .is_some_and(|job| Arc::ptr_eq(job, &self.job))
        {
            jobs.active = None;
        }
        self.manager.idle.notify_all();
    }
}
