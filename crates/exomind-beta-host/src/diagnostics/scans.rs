//! Lifecycle coordination for explicit Native storage scans.
//!
//! This module owns only admission and cancellation state. The filesystem walk
//! stays in `storage::scan_host_storage` and must run on a blocking worker.

use super::storage::CancellationToken;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, MutexGuard},
};
use uuid::Uuid;

/// Maximum number of cancel-before-start IDs retained by one Host instance.
pub const MAX_EARLY_CANCELLED_SCAN_IDS: usize = 32;

/// Recent completed IDs prevent a late cancel from becoming a future scan's
/// early cancellation and make accidental ID reuse an explicit duplicate.
const MAX_RECENTLY_FINISHED_SCAN_IDS: usize = 32;

/// Coordinates at most one active storage scan for one Native Host instance.
#[derive(Clone, Default)]
pub struct StorageScanCoordinator {
    state: Arc<Mutex<CoordinatorState>>,
}

#[derive(Default)]
struct CoordinatorState {
    stopped: bool,
    active: Option<ActiveScan>,
    early_cancelled: VecDeque<Uuid>,
    recently_finished: VecDeque<Uuid>,
}

struct ActiveScan {
    scan_id: Uuid,
    lease_id: Uuid,
    cancellation: CancellationToken,
}

/// Why a scan request could not acquire the single active slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanStartError {
    Stopped,
    Duplicate,
    Busy,
}

/// A scan's cancellation handle and RAII ownership of its active slot.
///
/// Dropping this lease on success, error, or unwind releases only the matching
/// generation. Cancelling the async caller does not preempt a blocking OS call;
/// explicit cancellation is cooperative between the walker's OS operations.
/// Call `finish` at normal completion; `Drop` remains the failure-path guard.
pub struct StorageScanLease {
    state: Arc<Mutex<CoordinatorState>>,
    scan_id: Uuid,
    lease_id: Uuid,
    cancellation: CancellationToken,
    armed: bool,
}

impl StorageScanCoordinator {
    /// Creates a lease, consuming any matching cancel-before-start request.
    pub fn begin(&self, scan_id: Uuid) -> Result<StorageScanLease, ScanStartError> {
        let mut state = self.lock_state();
        if state.stopped {
            return Err(ScanStartError::Stopped);
        }

        if let Some(active) = &state.active {
            return Err(if active.scan_id == scan_id {
                ScanStartError::Duplicate
            } else {
                ScanStartError::Busy
            });
        }

        if state.recently_finished.contains(&scan_id) {
            return Err(ScanStartError::Duplicate);
        }

        let cancellation = CancellationToken::new();
        if remove_id(&mut state.early_cancelled, scan_id) {
            cancellation.cancel();
        }

        let lease_id = Uuid::new_v4();
        state.active = Some(ActiveScan {
            scan_id,
            lease_id,
            cancellation: cancellation.clone(),
        });

        Ok(StorageScanLease {
            state: Arc::clone(&self.state),
            scan_id,
            lease_id,
            cancellation,
            armed: true,
        })
    }

    /// Requests cancellation for the matching active scan, or remembers a
    /// bounded cancel-before-start request for an unknown ID.
    ///
    /// Another active scan is unaffected. Its presence does not prove the
    /// unknown request stale: a delayed Native invocation may not have started.
    /// Recently finished IDs are ignored rather than re-armed for cancellation.
    pub fn request_cancel(&self, scan_id: Uuid) -> bool {
        let mut state = self.lock_state();
        if state.stopped {
            return false;
        }

        if let Some(active) = &state.active {
            if active.scan_id == scan_id {
                active.cancellation.cancel();
                return true;
            }
        }

        if state.recently_finished.contains(&scan_id) {
            return false;
        }
        if state.early_cancelled.contains(&scan_id) {
            return true;
        }
        if state.early_cancelled.len() == MAX_EARLY_CANCELLED_SCAN_IDS {
            let _ = state.early_cancelled.pop_front();
        }
        state.early_cancelled.push_back(scan_id);
        true
    }

    /// Fences new scans and cooperatively cancels the currently active scan.
    pub fn request_stop(&self) {
        let mut state = self.lock_state();
        state.stopped = true;
        state.early_cancelled.clear();
        state.recently_finished.clear();
        if let Some(active) = &state.active {
            active.cancellation.cancel();
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, CoordinatorState> {
        // Recovering a poisoned coordinator preserves stop/cancel behavior;
        // each critical section mutates only this small in-memory state.
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl StorageScanLease {
    /// The caller's scan ID for its response envelope.
    pub fn scan_id(&self) -> Uuid {
        self.scan_id
    }

    /// Cooperative cancellation token to pass into the storage walker.
    pub fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }

    /// Releases this lease after a report has been produced successfully.
    pub fn finish(mut self) {
        self.release();
    }

    fn release(&mut self) {
        if !self.armed {
            return;
        }
        self.armed = false;

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let owns_active = state.active.as_ref().is_some_and(|active| {
            active.scan_id == self.scan_id && active.lease_id == self.lease_id
        });
        if !owns_active {
            return;
        }

        state.active = None;
        remember_recently_finished(&mut state.recently_finished, self.scan_id);
    }
}

impl Drop for StorageScanLease {
    fn drop(&mut self) {
        self.release();
    }
}

fn remove_id(ids: &mut VecDeque<Uuid>, scan_id: Uuid) -> bool {
    let Some(index) = ids.iter().position(|id| *id == scan_id) else {
        return false;
    };
    let _ = ids.remove(index);
    true
}

fn remember_recently_finished(ids: &mut VecDeque<Uuid>, scan_id: Uuid) {
    remove_id(ids, scan_id);
    if ids.len() == MAX_RECENTLY_FINISHED_SCAN_IDS {
        let _ = ids.pop_front();
    }
    ids.push_back(scan_id);
}

#[cfg(test)]
mod tests {
    use super::{MAX_EARLY_CANCELLED_SCAN_IDS, ScanStartError, StorageScanCoordinator};
    use crate::diagnostics::{
        DiagnosticReason,
        storage::{StorageScanLimits, StorageScanStatus, scan_host_storage},
    };
    use uuid::Uuid;

    fn scan_report(
        lease: &super::StorageScanLease,
    ) -> crate::diagnostics::storage::StorageScanReport {
        let root = tempfile::tempdir().unwrap();
        scan_host_storage(
            root.path(),
            StorageScanLimits::default(),
            lease.cancellation(),
        )
    }

    #[test]
    fn cancel_before_start_returns_a_cancelled_partial_report() {
        let coordinator = StorageScanCoordinator::default();
        let scan_id = Uuid::new_v4();

        assert!(coordinator.request_cancel(scan_id));
        let lease = coordinator.begin(scan_id).unwrap();
        let report = scan_report(&lease);

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
        lease.finish();
    }

    #[test]
    fn active_cancel_is_cooperative_and_reported_as_partial() {
        let coordinator = StorageScanCoordinator::default();
        let scan_id = Uuid::new_v4();
        let lease = coordinator.begin(scan_id).unwrap();

        assert!(coordinator.request_cancel(scan_id));
        let report = scan_report(&lease);

        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
        lease.finish();
    }

    #[test]
    fn cancellation_before_delayed_start_survives_another_active_scan() {
        let coordinator = StorageScanCoordinator::default();
        let first = coordinator.begin(Uuid::new_v4()).unwrap();
        let delayed_id = Uuid::new_v4();

        // Native invocations may be polled out of order: the second panel can
        // close before its scan invocation starts, while the first is active.
        coordinator.request_cancel(delayed_id);
        assert_eq!(scan_report(&first).status, StorageScanStatus::Complete);
        first.finish();

        let delayed = coordinator.begin(delayed_id).unwrap();
        let report = scan_report(&delayed);
        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
        delayed.finish();
    }

    #[test]
    fn stale_cancel_does_not_affect_a_different_active_scan() {
        let coordinator = StorageScanCoordinator::default();
        let old_id = Uuid::new_v4();
        let old_lease = coordinator.begin(old_id).unwrap();
        old_lease.finish();

        let new_id = Uuid::new_v4();
        let new_lease = coordinator.begin(new_id).unwrap();
        assert!(!coordinator.request_cancel(old_id));

        let report = scan_report(&new_lease);
        assert_eq!(report.status, StorageScanStatus::Complete);
        assert!(
            !report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
        new_lease.finish();
    }

    #[test]
    fn only_one_scan_is_active_and_duplicate_ids_are_explained() {
        let coordinator = StorageScanCoordinator::default();
        let active_id = Uuid::new_v4();
        let lease = coordinator.begin(active_id).unwrap();

        assert_eq!(
            coordinator.begin(active_id).err(),
            Some(ScanStartError::Duplicate)
        );
        assert_eq!(
            coordinator.begin(Uuid::new_v4()).err(),
            Some(ScanStartError::Busy)
        );
        assert!(coordinator.request_cancel(Uuid::new_v4()));
        lease.finish();
        assert_eq!(
            coordinator.begin(active_id).err(),
            Some(ScanStartError::Duplicate)
        );
    }

    #[test]
    fn concurrent_starts_admit_exactly_one_scan() {
        let coordinator = StorageScanCoordinator::default();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let workers = (0..2)
            .map(|_| {
                let coordinator = coordinator.clone();
                let barrier = std::sync::Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    let result = coordinator.begin(Uuid::new_v4());
                    barrier.wait();
                    match result {
                        Ok(lease) => {
                            drop(lease);
                            Ok(())
                        }
                        Err(error) => Err(error),
                    }
                })
            })
            .collect::<Vec<_>>();

        barrier.wait();
        barrier.wait();
        let outcomes = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        let errors = outcomes
            .iter()
            .filter_map(|outcome| outcome.as_ref().err())
            .copied()
            .collect::<Vec<_>>();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0], ScanStartError::Busy);
    }

    #[test]
    fn early_cancel_cache_has_a_hard_capacity_and_evicts_oldest() {
        let coordinator = StorageScanCoordinator::default();
        let ids = (0..=MAX_EARLY_CANCELLED_SCAN_IDS)
            .map(|_| Uuid::new_v4())
            .collect::<Vec<_>>();
        for scan_id in &ids {
            assert!(coordinator.request_cancel(*scan_id));
        }

        let evicted = coordinator.begin(ids[0]).unwrap();
        assert_eq!(scan_report(&evicted).status, StorageScanStatus::Complete);
        evicted.finish();

        let retained = coordinator.begin(*ids.last().unwrap()).unwrap();
        let report = scan_report(&retained);
        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
        retained.finish();
    }

    #[test]
    fn drop_and_normal_finish_release_only_their_active_lease() {
        let coordinator = StorageScanCoordinator::default();
        let first_id = Uuid::new_v4();
        drop(coordinator.begin(first_id).unwrap());

        let second_id = Uuid::new_v4();
        let second = coordinator.begin(second_id).unwrap();
        second.finish();

        let third = coordinator.begin(Uuid::new_v4()).unwrap();
        assert_eq!(
            coordinator.begin(third.scan_id()).err(),
            Some(ScanStartError::Duplicate)
        );
        third.finish();
    }

    #[test]
    fn error_return_drops_its_lease_and_marks_that_id_finished() {
        let coordinator = StorageScanCoordinator::default();
        let failed_id = Uuid::new_v4();
        let result = (|| {
            let _lease = coordinator.begin(failed_id).unwrap();
            Err::<(), _>("simulated scan failure")
        })();

        assert_eq!(result, Err("simulated scan failure"));
        assert_eq!(
            coordinator.begin(failed_id).err(),
            Some(ScanStartError::Duplicate)
        );
        let next = coordinator.begin(Uuid::new_v4()).unwrap();
        next.finish();
    }

    #[test]
    fn stop_cancels_active_work_and_rejects_future_work() {
        let coordinator = StorageScanCoordinator::default();
        let lease = coordinator.begin(Uuid::new_v4()).unwrap();

        coordinator.request_stop();

        let report = scan_report(&lease);
        assert_eq!(report.status, StorageScanStatus::Partial);
        assert!(
            report
                .partial_reasons
                .contains(&DiagnosticReason::Cancelled)
        );
        lease.finish();
        assert_eq!(
            coordinator.begin(Uuid::new_v4()).err(),
            Some(ScanStartError::Stopped)
        );
        assert!(!coordinator.request_cancel(Uuid::new_v4()));
    }
}
