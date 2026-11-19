use super::{command, reclaim_then_release, seeded_original};
use crate::{
    BeginStageCommand, Core, CoreError, OriginPageQuery, OriginalBytesState,
    OriginalLifecycleAction, OriginalLifecycleFollowupResolution, OriginalRef, ProfileId, StageId,
    StageState,
};
use tempfile::TempDir;

#[test]
fn restore_hash_mismatch_can_retry_after_restart_from_a_correct_source() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic restore retry").unwrap();
    let correct = b"1234567890abcdef";
    let wrong = b"fedcba0987654321";
    let original = seeded_original(&core, profile, correct, "source");
    reclaim_then_release(&core, &original);
    let human = core.local_human(profile).unwrap();
    let restore = command(&original, OriginalLifecycleAction::Restore, 2);
    core.apply_original_lifecycle(&human, &restore).unwrap();

    let begin = BeginStageCommand {
        stage_id: original.stage,
        profile_id: profile,
        original_id: original.original.original_id,
        expected_sha256: original.original.sha256.clone(),
        byte_length: original.original.byte_length,
        file_name: original.original.file_name.clone(),
        media_type: original.original.media_type.clone(),
    };
    core.begin_stage(&human, &begin).unwrap();
    core.write_stage_chunk(&human, original.stage, 0, wrong)
        .unwrap();
    let bad = core
        .freeze_stage(&human, original.stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    assert!(matches!(
        core.finish_stage(&human, &bad),
        Err(CoreError::OriginalHashMismatch)
    ));
    let failed = core.stage_status(&human, original.stage).unwrap();
    assert_eq!(failed.state, StageState::HashMismatch);
    drop(core);

    let core = Core::open(root.path()).unwrap();
    let human = core.local_human(profile).unwrap();
    let retry = core
        .retry_failed_original_restore(&human, profile, original.original.original_id)
        .unwrap();
    assert_eq!(retry.restore_request_event_id, restore.event_id);
    assert_eq!(retry.restore_command_id, restore.command_id);
    assert_eq!(retry.stage.state, StageState::Uploading);
    assert_eq!(retry.stage.next_offset, 0);
    assert_eq!(retry.stage.generation, failed.generation + 1);
    let chunks: i64 = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [original.stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunks, 0);

    core.write_stage_chunk(&human, original.stage, 0, correct)
        .unwrap();
    let good = core
        .freeze_stage(&human, original.stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &good).unwrap();
    assert_eq!(
        core.original_lifecycle_status(&human, profile, original.original.original_id)
            .unwrap()
            .bytes_state,
        OriginalBytesState::Available
    );
    assert_eq!(
        core.read_original_range(
            &human,
            profile,
            original.original.original_id,
            0,
            correct.len()
        )
        .unwrap()
        .bytes,
        correct
    );
}

#[test]
fn purge_reclaimed_waits_for_deadline_and_confirmation() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic deadline").unwrap();
    let original = seeded_original(&core, profile, b"reclaim until deadline", "source");
    let human = core.local_human(profile).unwrap();
    let reclaim = command(&original, OriginalLifecycleAction::Reclaim, 0);
    core.apply_original_lifecycle_with_policy(&human, &reclaim, 10_000, 60_000)
        .unwrap();
    let status = core
        .original_lifecycle_status(&human, profile, original.original.original_id)
        .unwrap();
    assert_eq!(status.reclaimed_at_ms, Some(10_000));
    assert_eq!(status.reclaim_deadline_ms, Some(70_000));

    let mut purge = command(&original, OriginalLifecycleAction::PurgeReclaimed, 1);
    purge.cleanup_confirmed = true;
    assert!(matches!(
        core.apply_original_lifecycle_with_policy(&human, &purge, 10_000, 60_000),
        Err(CoreError::OriginalLifecycleConflict)
    ));
    let chunks: i64 = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [original.stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunks, 1);
    drop(core);

    let core = Core::open(root.path()).unwrap();
    let human = core.local_human(profile).unwrap();
    let persisted = core
        .original_lifecycle_status(&human, profile, original.original.original_id)
        .unwrap();
    assert_eq!(persisted.reclaimed_at_ms, Some(10_000));
    assert_eq!(persisted.reclaim_deadline_ms, Some(70_000));
    core.apply_original_lifecycle_with_policy(&human, &purge, 70_000, 60_000)
        .unwrap();
    assert_eq!(
        core.original_lifecycle_status(&human, profile, original.original.original_id)
            .unwrap()
            .bytes_state,
        OriginalBytesState::Purged
    );
}

#[test]
fn reclaim_can_be_restored_without_purging_or_changing_remote_scope() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic reclaim restore").unwrap();
    let original = seeded_original(&core, profile, b"recoverable bytes", "source");
    let human = core.local_human(profile).unwrap();
    let reclaim = command(&original, OriginalLifecycleAction::Reclaim, 0);
    core.apply_original_lifecycle_with_policy(&human, &reclaim, 20_000, 60_000)
        .unwrap();
    let restore = command(&original, OriginalLifecycleAction::Restore, 1);
    core.apply_original_lifecycle_with_policy(&human, &restore, 21_000, 60_000)
        .unwrap();

    let status = core
        .original_lifecycle_status(&human, profile, original.original.original_id)
        .unwrap();
    assert_eq!(status.bytes_state, OriginalBytesState::Available);
    assert_eq!(status.reclaimed_at_ms, None);
    assert_eq!(status.reclaim_deadline_ms, None);
    let chunks: i64 = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [original.stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunks, 1);
}
fn verified_copy(core: &Core, profile: ProfileId, original: &OriginalRef, bytes: &[u8]) -> StageId {
    let human = core.local_human(profile).unwrap();
    let stage = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            profile_id: profile,
            original_id: original.original_id,
            expected_sha256: original.sha256.clone(),
            byte_length: original.byte_length,
            file_name: original.file_name.clone(),
            media_type: original.media_type.clone(),
        },
    )
    .unwrap();
    core.write_stage_chunk(&human, stage, 0, bytes).unwrap();
    let proof = core
        .freeze_stage(&human, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &proof).unwrap();
    stage
}

#[test]
fn cross_origin_followup_is_unresolved_until_manifest_and_reference_arrive() {
    let source_root = TempDir::new().unwrap();
    let relay_root = TempDir::new().unwrap();
    let receiver_root = TempDir::new().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    let relay = Core::open(relay_root.path()).unwrap();
    let receiver = Core::open(receiver_root.path()).unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(profile, "synthetic source")
        .unwrap();
    relay.provision_profile(profile, "synthetic relay").unwrap();
    receiver
        .provision_profile(profile, "synthetic receiver")
        .unwrap();

    let seeded = seeded_original(&source, profile, b"delayed source manifest", "source");
    let source_human = source.local_human(profile).unwrap();
    let source_page = source
        .export_origin_page(&source_human, profile, &OriginPageQuery::default())
        .unwrap();
    let relay_context = relay
        .trusted_replica_context(
            profile,
            source.device_id(),
            source_page.origin.restoration_epoch,
            1,
        )
        .unwrap();
    relay
        .import_origin_page(&relay_context, &source_page)
        .unwrap();
    verified_copy(
        &relay,
        profile,
        &seeded.original,
        b"delayed source manifest",
    );

    let relay_human = relay.local_human(profile).unwrap();
    relay
        .apply_original_lifecycle(
            &relay_human,
            &command(&seeded, OriginalLifecycleAction::Reclaim, 0),
        )
        .unwrap();
    let mut release = command(&seeded, OriginalLifecycleAction::ReleaseLocal, 1);
    release.follow_up_device_ids = vec![receiver.device_id()];
    let receipt = relay
        .apply_original_lifecycle(&relay_human, &release)
        .unwrap();
    let relay_identity = relay.replication_identity(&relay_human, profile).unwrap();
    let relay_page = relay
        .export_origin_page(&relay_human, profile, &OriginPageQuery::default())
        .unwrap();
    let relay_context = receiver
        .trusted_replica_context(
            profile,
            relay_identity.device_id,
            relay_identity.restoration_epoch,
            1,
        )
        .unwrap();
    receiver
        .import_origin_page(&relay_context, &relay_page)
        .unwrap();

    let receiver_human = receiver.local_human(profile).unwrap();
    let unresolved = receiver
        .original_lifecycle_followups(&receiver_human, profile, receiver.device_id(), None, 10)
        .unwrap();
    assert_eq!(unresolved.items.len(), 1);
    assert_eq!(unresolved.items[0].request.event_id, receipt.event_id);
    assert_eq!(
        unresolved.items[0].resolution,
        OriginalLifecycleFollowupResolution::Unresolved
    );

    let source_context = receiver
        .trusted_replica_context(
            profile,
            source_page.origin.device_id,
            source_page.origin.restoration_epoch,
            1,
        )
        .unwrap();
    receiver
        .import_origin_page(&source_context, &source_page)
        .unwrap();
    let resolved = receiver
        .original_lifecycle_followups(&receiver_human, profile, receiver.device_id(), None, 10)
        .unwrap();
    assert_eq!(resolved.items.len(), 1);
    assert_eq!(
        resolved.items[0].resolution,
        OriginalLifecycleFollowupResolution::ManifestKnown
    );
}
