// Compile and exercise the exact Native export manager in the Host test lane.
// This harness also exercises the exact Native Source against real Host/Core state.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/beta_native_export_manager.rs"]
mod beta_native_export_manager;

use exomind_core::{OriginalId, ProfileId};
use std::{
    sync::{Arc, Barrier},
    thread,
    time::Duration,
};
use uuid::Uuid;

#[derive(Debug)]
struct Failure {
    code: &'static str,
    _message: &'static str,
}

fn failure(code: &'static str, message: &'static str) -> Failure {
    Failure {
        code,
        _message: message,
    }
}

fn cancelled() -> Failure {
    failure("export_cancelled", "manager is stopped")
}

fn io_failure() -> Failure {
    failure("export_io", "manager state is unavailable")
}

fn assert_error_code<T>(result: Result<T, Failure>, expected: &str) {
    match result {
        Err(error) => assert_eq!(error.code, expected),
        Ok(_) => panic!("expected error code {expected}"),
    }
}

#[test]
fn reservations_are_source_scoped_and_exact_cancel_allows_retry_after_drop() {
    use beta_native_export_manager::ExportManager;

    let manager = Arc::new(ExportManager::default());
    let profile_a = ProfileId::new();
    let original_a = OriginalId::new();
    let profile_b = ProfileId::new();
    let original_b = OriginalId::new();
    let request_a = Uuid::new_v4();
    let active = manager.begin(request_a, profile_a, original_a).unwrap();

    assert_error_code(
        manager.begin(Uuid::new_v4(), profile_b, original_a),
        "export_busy",
    );
    assert_error_code(
        manager.reserve_release(profile_a, original_a),
        "original_busy",
    );

    // A different profile or a different original must not be mistaken for A.
    let profile_reservation = manager.reserve_release(profile_b, original_a).unwrap();
    let original_reservation = manager.reserve_release(profile_a, original_b).unwrap();
    let retry_request = Uuid::new_v4();
    assert_error_code(
        manager.begin(retry_request, profile_b, original_a),
        "original_busy",
    );
    drop(profile_reservation);
    drop(original_reservation);

    assert!(!manager.cancel(Uuid::new_v4()).unwrap());
    assert!(manager.cancel(request_a).unwrap());
    assert_error_code(
        manager.reserve_release(profile_a, original_a),
        "original_busy",
    );
    drop(active);

    let reservation = manager.reserve_release(profile_a, original_a).unwrap();
    assert_error_code(
        manager.begin(retry_request, profile_a, original_a),
        "original_busy",
    );
    drop(reservation);
    let retried = manager.begin(retry_request, profile_a, original_a).unwrap();
    drop(retried);
}

#[test]
fn same_key_begin_and_release_reservation_linearize_under_real_concurrency() {
    use beta_native_export_manager::ExportManager;

    let manager = Arc::new(ExportManager::default());
    let profile = ProfileId::new();
    let original = OriginalId::new();
    let barrier = Arc::new(Barrier::new(3));

    let begin_manager = manager.clone();
    let begin_barrier = barrier.clone();
    let begin_thread = thread::spawn(move || {
        begin_barrier.wait();
        begin_manager.begin(Uuid::new_v4(), profile, original)
    });

    let reserve_manager = manager.clone();
    let reserve_barrier = barrier.clone();
    let reserve_thread = thread::spawn(move || {
        reserve_barrier.wait();
        reserve_manager.reserve_release(profile, original)
    });

    barrier.wait();
    let begin = begin_thread.join().unwrap();
    let reservation = reserve_thread.join().unwrap();
    assert_ne!(
        begin.is_ok(),
        reservation.is_ok(),
        "exactly one same-key admission may win"
    );
    if let Err(error) = &begin {
        assert_eq!(error.code, "original_busy");
    }
    if let Err(error) = &reservation {
        assert_eq!(error.code, "original_busy");
    }

    drop(begin);
    drop(reservation);
    manager.wait_empty(Duration::ZERO).unwrap();
}

#[test]
fn stop_rejects_new_jobs_and_reservations_and_drains_existing_guards() {
    use beta_native_export_manager::ExportManager;

    let manager = Arc::new(ExportManager::default());
    let profile = ProfileId::new();
    let original = OriginalId::new();
    let reservation_profile = ProfileId::new();
    let reservation_original = OriginalId::new();
    let active = manager.begin(Uuid::new_v4(), profile, original).unwrap();
    let reservation = manager
        .reserve_release(reservation_profile, reservation_original)
        .unwrap();

    manager.request_stop();
    assert!(active.is_cancelled());
    assert_error_code(
        manager.begin(Uuid::new_v4(), profile, original),
        "export_cancelled",
    );
    assert_error_code(
        manager.reserve_release(ProfileId::new(), OriginalId::new()),
        "export_cancelled",
    );
    assert!(manager.wait_empty(Duration::ZERO).is_err());

    drop(active);
    assert!(manager.wait_empty(Duration::ZERO).is_err());
    drop(reservation);
    manager.wait_empty(Duration::ZERO).unwrap();
}

#[path = "../../../src-tauri/src/beta_native_original_source.rs"]
mod beta_native_original_source;
use beta_native_export_manager::ExportManager;
use beta_native_original_source::Source;
use exomind_beta_host::BetaHost;
use sha2::{Digest, Sha256};

// This harness only observes success/failure; Native owns the UI error mapping.
impl From<exomind_beta_host::HostError> for Failure {
    fn from(_: exomind_beta_host::HostError) -> Self {
        failure("host_error", "Host original access failed")
    }
}

#[test]
fn source_permit_rejects_reclaimed_generation_while_unpermitted_bytes_remain_readable() {
    use exomind_core::{
        BeginStageCommand, CaptureCommand, CommandId, EventId, EventQuery, OriginalBytesState,
        OriginalLifecycleAction, OriginalLifecycleCommand, StageId,
    };

    let directory = tempfile::tempdir().unwrap();
    let host = Arc::new(BetaHost::open(&directory.path().join("beta")).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic Native Source")
        .unwrap();
    let session = host.native_human_session(&owner, profile).unwrap();
    let bytes = b"Native Source permit generation fixture";
    let original_id = OriginalId::new();
    let stage_id = StageId::new();

    host.begin_stage(
        &session,
        &BeginStageCommand {
            stage_id,
            original_id,
            profile_id: profile,
            expected_sha256: format!("{:x}", Sha256::digest(bytes)),
            byte_length: bytes.len() as u64,
            file_name: "synthetic-source.bin".into(),
            media_type: "application/octet-stream".into(),
        },
    )
    .unwrap();
    host.write_stage_chunk(&session, profile, stage_id, 0, bytes)
        .unwrap();
    let verified = host.verify_stage(&session, profile, stage_id).unwrap();
    host.capture(
        &session,
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            occurred_at_ms: 1_794_000_000_000,
            text: "synthetic original reference".into(),
            tags: vec![],
            originals: vec![verified.original],
        },
    )
    .unwrap();

    let source = Source::begin(host.clone(), session.clone(), profile, original_id).unwrap();
    assert_eq!(source.read(0, bytes.len()).unwrap(), bytes);

    // The Native release reservation has no Host/Core callback. A same-key
    // active Source job must be rejected without creating a lifecycle fact.
    let manager = Arc::new(ExportManager::default());
    let active = manager.begin(Uuid::new_v4(), profile, original_id).unwrap();
    let before = host
        .original_lifecycle_status(&owner, profile, original_id)
        .unwrap();
    assert_eq!(before.local.bytes_state, OriginalBytesState::Available);
    let event_count = host
        .events_page(&session, profile, &EventQuery::default())
        .unwrap()
        .items
        .len();
    let blocked = manager.reserve_release(profile, original_id);
    match blocked {
        Err(error) => assert_eq!(error.code, "original_busy"),
        Ok(_) => panic!("same-source reservation must be busy while Native is active"),
    }
    let after = host
        .original_lifecycle_status(&owner, profile, original_id)
        .unwrap();
    assert_eq!(after.local.generation, before.local.generation);
    assert_eq!(
        host.events_page(&session, profile, &EventQuery::default())
            .unwrap()
            .items
            .len(),
        event_count,
        "a busy reservation must not append a Core event"
    );
    drop(active);

    // Reclaim changes the real Core generation while keeping local bytes.
    // The permit-backed Source must reject both its next range and finish.
    let status = host
        .original_lifecycle_status(&owner, profile, original_id)
        .unwrap();
    host.apply_original_lifecycle(
        &owner,
        &OriginalLifecycleCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            original_id,
            expected_generation: status.local.generation,
            occurred_at_ms: 1_794_000_000_001,
            action: OriginalLifecycleAction::Reclaim,
            cleanup_confirmed: false,
            follow_up_device_ids: vec![],
            responds_to_event_id: None,
        },
    )
    .unwrap();

    assert_eq!(
        host.read_original_range(&session, profile, original_id, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes,
        "the fixture must prove bytes remain readable without the stale permit"
    );
    assert!(source.read(0, bytes.len()).is_err());
    assert!(source.finish().is_err());
}
