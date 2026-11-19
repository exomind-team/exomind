use super::{HostError, SystemHostClock};
use std::time::{Duration, UNIX_EPOCH};

#[test]
fn pre_epoch_sample_returns_clock_unavailable_without_changing_epoch_or_elapsed_domain() {
    let clock = SystemHostClock::default();
    let before = clock
        .sample_at(UNIX_EPOCH)
        .expect("Unix epoch is a valid wall sample");
    let pre_epoch = UNIX_EPOCH
        .checked_sub(Duration::from_millis(1))
        .expect("one millisecond before Unix epoch is representable");

    let result = clock.sample_at(pre_epoch);

    assert!(
        matches!(result, Err(HostError::ClockUnavailable)),
        "pre-epoch wall time must remain a clock error"
    );

    let after = clock
        .sample_at(UNIX_EPOCH)
        .expect("Unix epoch remains a valid wall sample after failure");
    assert_eq!(after.epoch_id, before.epoch_id);
    assert!(after.elapsed_ms >= before.elapsed_ms);
}

#[test]
fn unix_epoch_is_a_valid_zero_wall_sample() {
    let sample = SystemHostClock::default()
        .sample_at(UNIX_EPOCH)
        .expect("Unix epoch is a valid wall sample");

    assert_eq!(sample.wall_ms, 0);
}
