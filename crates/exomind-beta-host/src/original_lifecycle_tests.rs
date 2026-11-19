use super::*;

#[test]
fn stale_automatic_queue_pages_cannot_reanimate_released_or_retained_bytes() {
    assert!(!automatic_fetch_allowed(OriginalBytesState::Available));
    assert!(!automatic_fetch_allowed(OriginalBytesState::Reclaimed));
    assert!(!automatic_fetch_allowed(OriginalBytesState::Released));
    assert!(!automatic_fetch_allowed(OriginalBytesState::Purged));
    assert!(automatic_fetch_allowed(OriginalBytesState::Missing));
    assert!(automatic_fetch_allowed(OriginalBytesState::RestorePending));
}

#[test]
fn a_remote_member_is_only_a_probe_candidate_until_its_bytes_are_checked() {
    let candidate = OriginalLifecycleRemoteSource {
        device_id: DeviceId::new(),
        state: RemoteOriginalProbeState::NeedsProbe,
    };
    assert_eq!(candidate.state, RemoteOriginalProbeState::NeedsProbe);
}

#[path = "original_lifecycle_postfix_tests.rs"]
mod lifecycle_postfix_tests;
