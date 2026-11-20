use super::*;

#[test]
fn reclaim_deadline_uses_host_clock_and_expiry_never_deletes_automatically() {
    use sha2::{Digest, Sha256};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    struct ManualClock(Mutex<crate::HostClockSample>);
    impl ManualClock {
        fn set_wall(&self, value: i64) {
            let mut sample = self.0.lock().unwrap();
            let delta = (value - sample.wall_ms).max(0) as u64;
            sample.wall_ms = value;
            sample.elapsed_ms = sample.elapsed_ms.saturating_add(delta);
        }
    }
    impl crate::HostClock for ManualClock {
        fn sample(&self) -> Result<crate::HostClockSample, HostError> {
            self.0
                .lock()
                .map(|sample| sample.clone())
                .map_err(|_| HostError::StatePoisoned)
        }
    }

    let root = tempfile::tempdir().unwrap();
    let now = 1_700_000_000_000_i64;
    let clock_epoch = uuid::Uuid::new_v4();
    let clock = Arc::new(ManualClock(Mutex::new(crate::HostClockSample {
        epoch_id: clock_epoch,
        wall_ms: now,
        elapsed_ms: 10,
    })));
    let host = BetaHost::open_with_clock_and_recovery_window(
        root.path(),
        clock.clone(),
        Duration::from_secs(60),
    )
    .unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic lifecycle")
        .unwrap();

    let (original, stage) = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let human = core.local_human(profile).unwrap();
        let bytes = b"synthetic Host-clock bytes";
        let stage = exomind_core::StageId::new();
        core.begin_stage(
            &human,
            &exomind_core::BeginStageCommand {
                stage_id: stage,
                profile_id: profile,
                original_id: exomind_core::OriginalId::new(),
                expected_sha256: format!("{:x}", Sha256::digest(bytes)),
                byte_length: bytes.len() as u64,
                file_name: "synthetic.bin".into(),
                media_type: "application/octet-stream".into(),
            },
        )
        .unwrap();
        core.write_stage_chunk(&human, stage, 0, bytes).unwrap();
        let proof = core
            .freeze_stage(&human, stage)
            .unwrap()
            .verify(|| false)
            .unwrap();
        let original = core.finish_stage(&human, &proof).unwrap().original;
        core.submit(
            &human,
            &exomind_core::CaptureCommand {
                command_id: exomind_core::CommandId::new(),
                event_id: exomind_core::EventId::new(),
                profile_id: profile,
                occurred_at_ms: 1,
                text: "synthetic source".into(),
                tags: vec![],
                originals: vec![original.clone()],
            },
        )
        .unwrap();
        (original, stage)
    };

    let reclaim = exomind_core::OriginalLifecycleCommand {
        command_id: exomind_core::CommandId::new(),
        event_id: exomind_core::EventId::new(),
        profile_id: profile,
        original_id: original.original_id,
        expected_generation: 0,
        occurred_at_ms: 7,
        action: exomind_core::OriginalLifecycleAction::Reclaim,
        cleanup_confirmed: false,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    };
    host.apply_original_lifecycle(&owner, &reclaim).unwrap();
    let status = host
        .original_lifecycle_status(&owner, profile, original.original_id)
        .unwrap();
    assert_eq!(status.local.reclaimed_at_ms, Some(now));
    assert_eq!(status.local.reclaim_clock_epoch_id, Some(clock_epoch));
    assert_eq!(status.local.reclaim_elapsed_ms, Some(10));
    assert_eq!(status.local.recovery_window_ms, Some(60_000));
    assert_eq!(status.local.reclaim_deadline_ms, Some(now + 60_000));

    let purge = exomind_core::OriginalLifecycleCommand {
        command_id: exomind_core::CommandId::new(),
        event_id: exomind_core::EventId::new(),
        profile_id: profile,
        original_id: original.original_id,
        expected_generation: 1,
        occurred_at_ms: 8,
        action: exomind_core::OriginalLifecycleAction::PurgeReclaimed,
        cleanup_confirmed: true,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    };
    assert!(matches!(
        host.apply_original_lifecycle(&owner, &purge),
        Err(HostError::Core(
            exomind_core::CoreError::OriginalLifecycleConflict
        ))
    ));
    host.stop().unwrap();

    let host = BetaHost::open_with_clock_and_recovery_window(
        root.path(),
        clock.clone(),
        Duration::from_secs(60),
    )
    .unwrap();
    let owner = host.owner_session().unwrap();
    let persisted = host
        .original_lifecycle_status(&owner, profile, original.original_id)
        .unwrap();
    assert_eq!(persisted.local.reclaimed_at_ms, Some(now));
    assert_eq!(persisted.local.reclaim_clock_epoch_id, Some(clock_epoch));
    assert_eq!(persisted.local.reclaim_elapsed_ms, Some(10));
    assert_eq!(persisted.local.recovery_window_ms, Some(60_000));
    assert_eq!(persisted.local.reclaim_deadline_ms, Some(now + 60_000));

    clock.set_wall(now + 60_000);
    assert_eq!(
        host.original_lifecycle_status(&owner, profile, original.original_id)
            .unwrap()
            .local
            .bytes_state,
        OriginalBytesState::Reclaimed
    );
    let chunks: i64 = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        rusqlite::Connection::open_with_flags(
            core.database_path(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [stage.to_string()],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert_eq!(chunks, 1, "deadline expiry alone must not delete bytes");

    host.apply_original_lifecycle(&owner, &purge).unwrap();
    assert_eq!(
        host.original_lifecycle_status(&owner, profile, original.original_id)
            .unwrap()
            .local
            .bytes_state,
        OriginalBytesState::Purged
    );
    let chunks: i64 = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        rusqlite::Connection::open_with_flags(
            core.database_path(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [stage.to_string()],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert_eq!(chunks, 0);
    host.stop().unwrap();
}

#[test]
fn replication_negotiates_the_current_core11_schema() {
    assert_eq!(exomind_core::CORE_SCHEMA_VERSION, 11);
    assert_eq!(crate::PEER_CORE_SCHEMA, 11);
}
