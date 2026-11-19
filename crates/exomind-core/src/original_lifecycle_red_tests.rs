use super::{command, reclaim_then_release, seeded_original};
use crate::{
    BeginStageCommand, Core, DeviceId, EventId, OriginPageQuery, OriginalBytesState,
    OriginalLifecycleAction, OriginalRef, ProfileId, StageId,
};
use rusqlite::{Connection, OptionalExtension, params};
use tempfile::TempDir;

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
fn q24_release_local_succeeds_directly_from_available() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic Q24").unwrap();
    let original = seeded_original(&core, profile, b"direct local release", "source");
    let human = core.local_human(profile).unwrap();
    let release = command(&original, OriginalLifecycleAction::ReleaseLocal, 0);

    core.apply_original_lifecycle(&human, &release).unwrap();

    let status = core
        .original_lifecycle_status(&human, profile, original.original.original_id)
        .unwrap();
    assert_eq!(status.bytes_state, OriginalBytesState::Released);
    assert_eq!(status.generation, 1);
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
}

#[test]
fn cross_origin_followup_is_indexed_before_its_manifest_arrives() {
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

    let seeded = seeded_original(
        &source,
        profile,
        b"source bytes for delayed manifest",
        "source",
    );
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
        b"source bytes for delayed manifest",
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
    relay
        .apply_original_lifecycle(&relay_human, &release)
        .unwrap();
    let relay_origin = relay.replication_identity(&relay_human, profile).unwrap();
    let relay_page = relay
        .export_origin_page(&relay_human, profile, &OriginPageQuery::default())
        .unwrap();
    let relay_context = receiver
        .trusted_replica_context(
            profile,
            relay_origin.device_id,
            relay_origin.restoration_epoch,
            1,
        )
        .unwrap();

    // The receiver has no source manifest yet. This origin page must still commit.
    receiver
        .import_origin_page(&relay_context, &relay_page)
        .unwrap();
    let receiver_human = receiver.local_human(profile).unwrap();
    let unresolved = receiver
        .original_lifecycle_followups(&receiver_human, profile, receiver.device_id(), None, 10)
        .unwrap();
    assert_eq!(unresolved.items.len(), 1);

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
}

#[test]
fn failed_sql_gate_cannot_reuse_a_reclaim_or_other_original_fact() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic SQL gate").unwrap();
    let original = seeded_original(&core, profile, b"guarded bytes", "source");
    let human = core.local_human(profile).unwrap();
    let reclaim = command(&original, OriginalLifecycleAction::Reclaim, 0);
    core.apply_original_lifecycle(&human, &reclaim).unwrap();
    let other = seeded_original(&core, profile, b"other original bytes", "other source");
    let (other_release, _) = reclaim_then_release(&core, &other);

    let db = core.connection().unwrap();
    let has_bound_gate = db
        .prepare("SELECT profile_id,original_id,generation,action FROM original_lifecycle_delete_gate LIMIT 0")
        .is_ok();
    let has_reclaim_stamp = db
        .prepare("SELECT reclaim_started_at_ms,reclaim_deadline_ms FROM original_lifecycle_local_state LIMIT 0")
        .is_ok();
    let has_full_reclaim_clock = db
        .prepare("SELECT reclaim_clock_epoch_id,reclaim_elapsed_ms,recovery_window_ms FROM original_lifecycle_local_state LIMIT 0")
        .is_ok();
    db.execute_batch("DROP TRIGGER original_lifecycle_state_generation_guard")
        .unwrap();

    if has_full_reclaim_clock {
        db.execute(
            "UPDATE original_lifecycle_local_state SET state='released',latest_event_id=?1,reclaim_started_at_ms=NULL,reclaim_clock_epoch_id=NULL,reclaim_elapsed_ms=NULL,recovery_window_ms=NULL,reclaim_deadline_ms=NULL WHERE profile_id=?2 AND original_id=?3",
            params![reclaim.event_id.to_string(), profile.to_string(), original.original.original_id.to_string()],
        )
        .unwrap();
    } else if has_reclaim_stamp {
        db.execute(
            "UPDATE original_lifecycle_local_state SET state='released',latest_event_id=?1,reclaim_started_at_ms=NULL,reclaim_deadline_ms=NULL WHERE profile_id=?2 AND original_id=?3",
            params![reclaim.event_id.to_string(), profile.to_string(), original.original.original_id.to_string()],
        )
        .unwrap();
    } else {
        db.execute(
            "UPDATE original_lifecycle_local_state SET state='released',latest_event_id=?1 WHERE profile_id=?2 AND original_id=?3",
            params![reclaim.event_id.to_string(), profile.to_string(), original.original.original_id.to_string()],
        )
        .unwrap();
    }
    let reclaim_gate = if has_bound_gate {
        db.execute(
            "INSERT INTO original_lifecycle_delete_gate(stage_id,event_id,profile_id,original_id,generation,action) VALUES(?1,?2,?3,?4,1,'release_local')",
            params![original.stage.to_string(), reclaim.event_id.to_string(), profile.to_string(), original.original.original_id.to_string()],
        )
    } else {
        db.execute(
            "INSERT INTO original_lifecycle_delete_gate(stage_id,event_id) VALUES(?1,?2)",
            params![original.stage.to_string(), reclaim.event_id.to_string()],
        )
    };
    if reclaim_gate.is_ok() {
        let _ = db.execute(
            "DELETE FROM original_chunks WHERE stage_id=?1",
            [original.stage.to_string()],
        );
    }
    assert!(
        reclaim_gate.is_err(),
        "a reclaim fact cannot authorize release deletion"
    );

    db.execute(
        "UPDATE original_lifecycle_local_state SET generation=2,latest_event_id=?1 WHERE profile_id=?2 AND original_id=?3",
        params![other_release.event_id.to_string(), profile.to_string(), original.original.original_id.to_string()],
    )
    .unwrap();
    let other_gate = if has_bound_gate {
        db.execute(
            "INSERT INTO original_lifecycle_delete_gate(stage_id,event_id,profile_id,original_id,generation,action) VALUES(?1,?2,?3,?4,2,'release_local')",
            params![original.stage.to_string(), other_release.event_id.to_string(), profile.to_string(), original.original.original_id.to_string()],
        )
    } else {
        db.execute(
            "INSERT INTO original_lifecycle_delete_gate(stage_id,event_id) VALUES(?1,?2)",
            params![
                original.stage.to_string(),
                other_release.event_id.to_string()
            ],
        )
    };
    assert!(
        other_gate.is_err(),
        "another original's release fact cannot authorize these chunks"
    );
    let chunks: i64 = db
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [original.stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunks, 1);
}

#[test]
fn followup_candidate_index_is_target_sequence_ordered_and_used_without_sort() {
    let root = TempDir::new().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("synthetic follow-up index").unwrap();
    let target = DeviceId::new();
    let db = core.connection().unwrap();
    let sql: Option<String> = db
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type='index' AND name='original_lifecycle_followups_pending_target_sequence'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(
        sql.as_deref().is_some_and(
            |definition| definition.contains("profile_id,target_device_id,local_seq,event_id")
        ),
        "schema10 must index follow-ups by profile, target and local sequence"
    );
    let mut statement = db
        .prepare(
            "EXPLAIN QUERY PLAN SELECT f.event_id,p.local_seq,e.body,EXISTS(SELECT 1 FROM original_manifests m JOIN event_originals r ON r.original_id=m.original_id JOIN events c ON c.event_id=r.event_id WHERE m.original_id=f.original_id AND m.profile_id=p.profile_id AND c.profile_id=p.profile_id) FROM original_lifecycle_followups_pending p JOIN original_lifecycle_followups f ON f.event_id=p.event_id AND f.target_device_id=p.target_device_id JOIN events e ON e.event_id=f.event_id WHERE p.profile_id=?1 AND p.target_device_id=?2 AND p.local_seq>?3 ORDER BY p.local_seq,p.event_id LIMIT ?4",
        )
        .unwrap();
    let details = statement
        .query_map(
            params![profile.to_string(), target.to_string(), 0_i64, 101_i64],
            |row| row.get::<_, String>(3),
        )
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        details
            .iter()
            .any(|detail| detail.contains("original_lifecycle_followups_pending_target_sequence"))
    );
    assert!(details.iter().all(|detail| !detail.contains("TEMP B-TREE")));
}

#[test]
fn schema10_correction_target_sequence_expression_index_is_present_and_validated() {
    let root = TempDir::new().unwrap();
    drop(Core::open(root.path()).unwrap());
    let path = root.path().join("beta-core.sqlite3");
    let database = Connection::open(&path).unwrap();
    let sql: Option<String> = database
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type='index' AND name='original_lifecycle_correction_target_sequence'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    let sql = sql.expect("schema10 correction target expression index");
    assert!(sql.contains("json_extract(body,'$.target_event_id')"));
    assert!(sql.contains("local_seq DESC"));
    let details = database
        .prepare(
            "EXPLAIN QUERY PLAN SELECT event_id FROM events WHERE profile_id=?1 AND kind='correction/1' AND json_extract(body,'$.target_event_id')=?2 ORDER BY local_seq DESC LIMIT 101",
        )
        .unwrap()
        .query_map(params![ProfileId::new().to_string(), EventId::new().to_string()], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        details
            .iter()
            .any(|detail| detail.contains("original_lifecycle_correction_target_sequence"))
    );
    database
        .execute_batch(
            "DROP INDEX original_lifecycle_correction_target_sequence; CREATE INDEX original_lifecycle_correction_target_sequence ON events(profile_id,local_seq DESC) WHERE kind='correction/1';",
        )
        .unwrap();
    drop(database);
    assert!(matches!(
        Core::open(root.path()),
        Err(crate::CoreError::RecoveryRequired)
    ));
}

#[test]
fn remote_release_fact_cannot_remove_a_preexisting_receiver_copy() {
    let source_root = TempDir::new().unwrap();
    let receiver_root = TempDir::new().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    let receiver = Core::open(receiver_root.path()).unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(profile, "synthetic source")
        .unwrap();
    receiver
        .provision_profile(profile, "synthetic receiver")
        .unwrap();
    let bytes = b"preexisting receiver copy survives imported release";
    let seeded = seeded_original(&source, profile, bytes, "source");
    let source_human = source.local_human(profile).unwrap();
    let capture_page = source
        .export_origin_page(&source_human, profile, &OriginPageQuery::default())
        .unwrap();
    let context = receiver
        .trusted_replica_context(
            profile,
            source.device_id(),
            capture_page.origin.restoration_epoch,
            1,
        )
        .unwrap();
    receiver
        .import_origin_page(&context, &capture_page)
        .unwrap();
    let receiver_stage = verified_copy(&receiver, profile, &seeded.original, bytes);

    source
        .apply_original_lifecycle(
            &source_human,
            &command(&seeded, OriginalLifecycleAction::Reclaim, 0),
        )
        .unwrap();
    let mut release = command(&seeded, OriginalLifecycleAction::ReleaseLocal, 1);
    release.follow_up_device_ids = vec![receiver.device_id()];
    let receipt = source
        .apply_original_lifecycle(&source_human, &release)
        .unwrap();

    let reclaim_page = source
        .export_origin_page(
            &source_human,
            profile,
            &OriginPageQuery {
                after: Some(capture_page.to.clone()),
                limit: 1,
                ..OriginPageQuery::default()
            },
        )
        .unwrap();
    let context = receiver
        .trusted_replica_context(
            profile,
            source.device_id(),
            capture_page.origin.restoration_epoch,
            2,
        )
        .unwrap();
    receiver
        .import_origin_page(&context, &reclaim_page)
        .unwrap();
    let release_page = source
        .export_origin_page(
            &source_human,
            profile,
            &OriginPageQuery {
                after: Some(reclaim_page.to.clone()),
                limit: 1,
                ..OriginPageQuery::default()
            },
        )
        .unwrap();
    assert_eq!(release_page.entries.len(), 1);
    let context = receiver
        .trusted_replica_context(
            profile,
            source.device_id(),
            capture_page.origin.restoration_epoch,
            3,
        )
        .unwrap();
    receiver
        .import_origin_page(&context, &release_page)
        .unwrap();

    let human = receiver.local_human(profile).unwrap();
    assert_eq!(
        receiver
            .original_lifecycle_status(&human, profile, seeded.original.original_id)
            .unwrap()
            .bytes_state,
        OriginalBytesState::Available
    );
    assert_eq!(
        receiver
            .read_original_range(&human, profile, seeded.original.original_id, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes
    );
    let followups = receiver
        .original_lifecycle_followups(&human, profile, receiver.device_id(), None, 10)
        .unwrap();
    assert_eq!(followups.items.len(), 1);
    assert_eq!(followups.items[0].request.event_id, receipt.event_id);

    receiver
        .apply_original_lifecycle(
            &human,
            &command(&seeded, OriginalLifecycleAction::Reclaim, 0),
        )
        .unwrap();
    let mut local_release = command(&seeded, OriginalLifecycleAction::ReleaseLocal, 1);
    local_release.responds_to_event_id = Some(receipt.event_id);
    receiver
        .apply_original_lifecycle(&human, &local_release)
        .unwrap();
    assert_eq!(
        receiver
            .original_lifecycle_status(&human, profile, seeded.original.original_id)
            .unwrap()
            .bytes_state,
        OriginalBytesState::Released
    );
    let chunks: i64 = receiver
        .connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [receiver_stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunks, 0);
}
