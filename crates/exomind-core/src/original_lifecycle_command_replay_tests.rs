use super::*;

fn stored_receipt(core: &Core, command_id: CommandId) -> String {
    core.connection()
        .unwrap()
        .query_row(
            "SELECT receipt FROM command_receipts WHERE command_id=?1",
            [command_id.to_string()],
            |row| row.get(0),
        )
        .unwrap()
}

fn chunk_count(core: &Core, stage: StageId) -> i64 {
    core.connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [stage.to_string()],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn release_local_replay_after_chunk_deletion_preserves_capture_and_action_receipts() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic release replay").unwrap();
    let original = seeded_original(&core, profile, b"release replay bytes", "source");
    let human = core.local_human(profile).unwrap();
    let capture_receipt_before = stored_receipt(&core, original.capture.command_id);
    let release = command(&original, OriginalLifecycleAction::ReleaseLocal, 0);

    let first = core.apply_original_lifecycle(&human, &release).unwrap();
    assert_eq!(chunk_count(&core, original.stage), 0);
    let action_receipt_before = stored_receipt(&core, release.command_id);
    let replay = core.apply_original_lifecycle(&human, &release).unwrap();

    assert!(replay.replayed);
    assert_eq!(replay.event_id, first.event_id);
    assert_eq!(
        stored_receipt(&core, release.command_id),
        action_receipt_before
    );
    assert_eq!(
        stored_receipt(&core, original.capture.command_id),
        capture_receipt_before
    );
}

#[test]
fn purge_reclaimed_replay_after_chunk_deletion_preserves_capture_and_action_receipts() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic purge replay").unwrap();
    let original = seeded_original(&core, profile, b"purge replay bytes", "source");
    let human = core.local_human(profile).unwrap();
    let capture_receipt_before = stored_receipt(&core, original.capture.command_id);
    let reclaim = command(&original, OriginalLifecycleAction::Reclaim, 0);
    core.apply_original_lifecycle_with_policy(&human, &reclaim, 10_000, 60_000)
        .unwrap();

    let mut purge = command(&original, OriginalLifecycleAction::PurgeReclaimed, 1);
    purge.cleanup_confirmed = true;
    let first = core
        .apply_original_lifecycle_with_policy(&human, &purge, 70_000, 60_000)
        .unwrap();
    assert_eq!(chunk_count(&core, original.stage), 0);
    let action_receipt_before = stored_receipt(&core, purge.command_id);
    let replay = core
        .apply_original_lifecycle_with_policy(&human, &purge, 70_000, 60_000)
        .unwrap();

    assert!(replay.replayed);
    assert_eq!(replay.event_id, first.event_id);
    assert_eq!(
        stored_receipt(&core, purge.command_id),
        action_receipt_before
    );
    assert_eq!(
        stored_receipt(&core, original.capture.command_id),
        capture_receipt_before
    );
}
