//! Android's elapsed domain includes suspend, like AlarmManager/elapsedRealtime.
//! Kept separate from deadline facts and from other platforms' Instant clock.
use super::{HostClock, HostClockSample};
use crate::HostError;
use std::sync::Mutex;
use uuid::Uuid;

pub(super) struct Reading {
    pub wall_ms: i64,
    pub boot_ms: u64,
}
pub(super) trait Source: Send + Sync {
    fn read(&self) -> Result<Reading, HostError>;
}
pub(super) struct BootClock<S> {
    epoch: Uuid,
    source: S,
    last_boot_ms: Mutex<u64>,
}
impl<S: Source> BootClock<S> {
    pub(super) fn new(source: S) -> Result<Self, HostError> {
        let first = source.read()?;
        validate(&first)?;
        Ok(Self {
            epoch: Uuid::new_v4(),
            source,
            last_boot_ms: Mutex::new(first.boot_ms),
        })
    }
}
fn validate(value: &Reading) -> Result<(), HostError> {
    if value.wall_ms < 0 || value.boot_ms > i64::MAX as u64 {
        return Err(HostError::ClockUnavailable);
    }
    Ok(())
}
impl<S: Source> HostClock for BootClock<S> {
    fn sample(&self) -> Result<HostClockSample, HostError> {
        // Serialize hardware reads too: concurrent readers cannot make an
        // older sample finish after a later one and look like clock rollback.
        let mut last = self
            .last_boot_ms
            .lock()
            .map_err(|_| HostError::ClockUnavailable)?;
        let value = self.source.read()?;
        validate(&value)?;
        if value.boot_ms < *last {
            return Err(HostError::ClockUnavailable);
        }
        *last = value.boot_ms;
        Ok(HostClockSample {
            epoch_id: self.epoch,
            wall_ms: value.wall_ms,
            elapsed_ms: value.boot_ms,
        })
    }
}
#[cfg(target_os = "android")]
pub(super) struct AndroidSource;
#[cfg(target_os = "android")]
impl Source for AndroidSource {
    fn read(&self) -> Result<Reading, HostError> {
        let mut sample = std::mem::MaybeUninit::<libc::timespec>::uninit();
        // SAFETY: clock_gettime writes a single ABI-correct timespec to this
        // live, aligned allocation. CLOCK_BOOTTIME includes Android suspend.
        if unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, sample.as_mut_ptr()) } != 0 {
            return Err(HostError::ClockUnavailable);
        }
        let sample = unsafe { sample.assume_init() };
        if sample.tv_sec < 0 || !(0..1_000_000_000).contains(&sample.tv_nsec) {
            return Err(HostError::ClockUnavailable);
        }
        let boot_ms = (sample.tv_sec as u64)
            .checked_mul(1000)
            .and_then(|ms| ms.checked_add(sample.tv_nsec as u64 / 1_000_000))
            .ok_or(HostError::ClockUnavailable)?;
        let wall_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| HostError::ClockUnavailable)?
            .as_millis();
        if wall_ms > i64::MAX as u128 {
            return Err(HostError::ClockUnavailable);
        }
        Ok(Reading {
            wall_ms: wall_ms as i64,
            boot_ms,
        })
    }
}

#[cfg(test)]
#[path = "boot_clock_tests.rs"]
mod tests;
