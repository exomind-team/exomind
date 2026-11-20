use super::*;
use crate::{
    AgentId, BeginStageCommand, CaptureCommand, EventQuery, ExternalSummaryAppendCommand, StageId,
    SummarySourceRef, TimelineItem,
};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

struct SeededOriginal {
    profile: ProfileId,
    original: OriginalRef,
    stage: StageId,
    capture: Receipt,
}

fn seeded_original(core: &Core, profile: ProfileId, bytes: &[u8], text: &str) -> SeededOriginal {
    let human = core.local_human(profile).unwrap();
    let original_id = OriginalId::new();
    let stage = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            profile_id: profile,
            original_id,
            expected_sha256: format!("{:x}", Sha256::digest(bytes)),
            byte_length: bytes.len() as u64,
            file_name: "synthetic-original.bin".into(),
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
    let capture = core
        .submit(
            &human,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                occurred_at_ms: 1_000,
                text: text.into(),
                tags: vec![],
                originals: vec![original.clone()],
            },
        )
        .unwrap();
    SeededOriginal {
        profile,
        original,
        stage,
        capture,
    }
}

fn command(
    value: &SeededOriginal,
    action: OriginalLifecycleAction,
    expected_generation: u64,
) -> OriginalLifecycleCommand {
    OriginalLifecycleCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: value.profile,
        original_id: value.original.original_id,
        expected_generation,
        occurred_at_ms: 2_000,
        action,
        cleanup_confirmed: action == OriginalLifecycleAction::ReleaseLocal,
        follow_up_device_ids: vec![],
        responds_to_event_id: None,
    }
}

fn reclaim_then_release(
    core: &Core,
    value: &SeededOriginal,
) -> (Receipt, OriginalLifecycleCommand) {
    let human = core.local_human(value.profile).unwrap();
    let reclaim = command(value, OriginalLifecycleAction::Reclaim, 0);
    core.apply_original_lifecycle(&human, &reclaim).unwrap();
    let release = command(value, OriginalLifecycleAction::ReleaseLocal, 1);
    let receipt = core.apply_original_lifecycle(&human, &release).unwrap();
    (receipt, release)
}

#[test]
fn explicit_local_release_only_removes_p_bytes_and_preserves_source_and_derived_facts() {
    let directory = TempDir::new().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let p = core.create_profile("synthetic P").unwrap();
    let q = core.create_profile("synthetic Q").unwrap();
    let bytes = b"same hash, independently owned rows";
    let in_p = seeded_original(&core, p, bytes, "P capture source");
    let in_q = seeded_original(&core, q, bytes, "Q capture source");
    assert_eq!(in_p.original.sha256, in_q.original.sha256);
    assert_ne!(in_p.original.original_id, in_q.original.original_id);

    let summary_source = SummarySourceRef {
        event_id: in_p.capture.event_id,
        kind: "capture".into(),
        digest: in_p.capture.event_digest.clone(),
    };
    let observed_through = core
        .events_page(&core.local_human(p).unwrap(), p, &EventQuery::default())
        .unwrap()
        .highwater;
    let summary = core
        .append_external_summary(
            &core
                .local_external_summary_producer(p, AgentId::new())
                .unwrap(),
            &ExternalSummaryAppendCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                occurred_at_ms: 2_500,
                observed_through,
                sources: vec![summary_source],
                narrative: "Synthetic derived note keeps its material citation".into(),
                evidence: vec![in_p.capture.event_id],
            },
        )
        .unwrap();

    let capture_before: (String, String) = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT digest,body FROM events WHERE event_id=?1",
            [in_p.capture.event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let capture_origin_before: String = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT chain_hash FROM origin_entries WHERE event_id=?1",
            [in_p.capture.event_id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    reclaim_then_release(&core, &in_p);

    let state = core
        .original_lifecycle_status(&core.local_human(p).unwrap(), p, in_p.original.original_id)
        .unwrap();
    assert_eq!(state.bytes_state, OriginalBytesState::Released);
    assert_eq!(state.generation, 2);
    let db = core.connection().unwrap();
    let (p_chunks, q_chunks, p_manifests, p_refs, capture_after, capture_origin_after): (i64, i64, i64, i64, (String, String), String) = db
        .query_row(
            "SELECT (SELECT count(*) FROM original_chunks WHERE stage_id=?1),(SELECT count(*) FROM original_chunks WHERE stage_id=?2),(SELECT count(*) FROM original_manifests WHERE original_id=?3),(SELECT count(*) FROM event_originals WHERE original_id=?3),(SELECT digest FROM events WHERE event_id=?4),(SELECT body FROM events WHERE event_id=?4),(SELECT chain_hash FROM origin_entries WHERE event_id=?4)",
            params![in_p.stage.to_string(), in_q.stage.to_string(), in_p.original.original_id.to_string(), in_p.capture.event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, (row.get(4)?, row.get(5)?), row.get(6)?)),
        )
        .unwrap();
    assert_eq!(p_chunks, 0);
    assert_eq!(q_chunks, 1);
    assert_eq!(p_manifests, 1);
    assert_eq!(p_refs, 1);
    assert_eq!(capture_after, capture_before);
    assert_eq!(capture_origin_after, capture_origin_before);
    assert!(db
        .execute(
            "UPDATE events SET body=body WHERE event_id=(SELECT event_id FROM events WHERE kind='orig_lifecycle/1' ORDER BY local_seq DESC LIMIT 1)",
            [],
        )
        .is_err());
    drop(db);
    let derived = match core
        .read_timeline_event(&core.local_human(p).unwrap(), p, summary.event_id)
        .unwrap()
        .unwrap()
    {
        TimelineItem::AgentSummary(record) => record,
        _ => panic!("expected the retained derived fact"),
    };
    assert_eq!(
        derived.snapshot.materials[0].original_id,
        in_p.original.original_id
    );
    assert_eq!(
        derived.snapshot.coverage.unread_original_ids,
        vec![in_p.original.original_id]
    );
}

#[test]
fn lifecycle_commands_are_idempotent_and_reject_reused_ids_with_changed_payload() {
    let directory = TempDir::new().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let original = seeded_original(&core, profile, b"stable command bytes", "source");
    let human = core.local_human(profile).unwrap();
    let reclaim = command(&original, OriginalLifecycleAction::Reclaim, 0);
    let first = core.apply_original_lifecycle(&human, &reclaim).unwrap();
    let replay = core.apply_original_lifecycle(&human, &reclaim).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.event_id, first.event_id);

    let mut conflict = command(&original, OriginalLifecycleAction::ReleaseLocal, 1);
    core.apply_original_lifecycle(&human, &conflict).unwrap();
    conflict.follow_up_device_ids.push(DeviceId::new());
    assert!(matches!(
        core.apply_original_lifecycle(&human, &conflict),
        Err(CoreError::CommandConflict)
    ));
}

#[test]
fn old_stage_writer_cannot_recreate_released_bytes_without_restore_intent() {
    let directory = TempDir::new().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let original = seeded_original(&core, profile, b"released bytes", "source");
    reclaim_then_release(&core, &original);
    let human = core.local_human(profile).unwrap();
    assert!(matches!(
        core.write_stage_chunk(&human, original.stage, 0, b"released bytes"),
        Err(CoreError::OriginalLifecycleRestoreRequired)
    ));
    let bytes: i64 = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM original_chunks WHERE stage_id=?1",
            [original.stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(bytes, 0);
}

#[test]
fn explicit_restore_waits_for_verified_bytes_and_completes_with_a_new_fact() {
    let directory = TempDir::new().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let original = seeded_original(&core, profile, b"restore bytes with exact hash", "source");
    reclaim_then_release(&core, &original);
    let human = core.local_human(profile).unwrap();
    let restore = command(&original, OriginalLifecycleAction::Restore, 2);
    core.apply_original_lifecycle(&human, &restore).unwrap();
    assert_eq!(
        core.original_lifecycle_status(&human, profile, original.original.original_id)
            .unwrap()
            .bytes_state,
        OriginalBytesState::RestorePending
    );

    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: original.stage,
            profile_id: profile,
            original_id: original.original.original_id,
            expected_sha256: original.original.sha256.clone(),
            byte_length: original.original.byte_length,
            file_name: original.original.file_name.clone(),
            media_type: original.original.media_type.clone(),
        },
    )
    .unwrap();
    let bytes = b"restore bytes with exact hash";
    core.write_stage_chunk(&human, original.stage, 0, bytes)
        .unwrap();
    let proof = core
        .freeze_stage(&human, original.stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&human, &proof).unwrap();
    let restored = core
        .original_lifecycle_status(&human, profile, original.original.original_id)
        .unwrap();
    assert_eq!(restored.bytes_state, OriginalBytesState::Available);
    assert_eq!(restored.generation, 4);
    let restored_bytes = core
        .read_original_range(
            &human,
            profile,
            original.original.original_id,
            0,
            bytes.len(),
        )
        .unwrap();
    assert_eq!(restored_bytes.bytes, bytes);
}

#[test]
fn read_and_export_permit_cannot_claim_success_after_concurrent_release() {
    let directory = TempDir::new().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core.create_profile("synthetic P").unwrap();
    let original = seeded_original(&core, profile, b"exported in bounded chunks", "source");
    let human = core.local_human(profile).unwrap();
    let permit = core
        .begin_original_read(&human, profile, original.original.original_id)
        .unwrap();
    let first = core
        .read_original_range_with_permit(&human, &permit, 0, 8)
        .unwrap();
    assert_eq!(first.bytes, b"exported");
    reclaim_then_release(&core, &original);
    assert!(matches!(
        core.read_original_range_with_permit(&human, &permit, 8, 8),
        Err(CoreError::StaleOriginalRead)
    ));
    assert!(matches!(
        core.finish_original_read(&human, &permit),
        Err(CoreError::StaleOriginalRead)
    ));
}

#[test]
fn schema9_to_current_preserves_original_facts_references_bytes_receipt_and_origin_prefix() {
    const EVENTS9: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1','agent_summary/1','correction/1')))";
    const ORIGIN_ENTRIES9: &str = "CREATE TABLE origin_entries(profile_id TEXT NOT NULL,origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,origin_seq INTEGER NOT NULL CHECK(origin_seq>0),event_id TEXT NOT NULL REFERENCES events(event_id),fact_type TEXT NOT NULL CHECK(fact_type IN ('capture/1','capture/2','timeblock/1','summary_job/1','summary/1','agent_summary/1','correction/1')),digest TEXT NOT NULL,chain_hash TEXT NOT NULL,PRIMARY KEY(profile_id,origin_device,restoration_epoch,origin_seq),UNIQUE(profile_id,origin_device,restoration_epoch,event_id),FOREIGN KEY(profile_id,origin_device,restoration_epoch) REFERENCES origin_heads(profile_id,origin_device,restoration_epoch))";
    const ORIGINAL_CHUNK_DELETE9: &str = "CREATE TRIGGER original_chunks_no_delete BEFORE DELETE ON original_chunks\n BEGIN SELECT RAISE(ABORT,'original release requires a later explicit lifecycle'); END";

    let directory = TempDir::new().unwrap();
    let core = Core::open(directory.path()).unwrap();
    let profile = core.create_profile("synthetic schema9 P").unwrap();
    let seeded = seeded_original(&core, profile, b"schema9 migration bytes", "kept source");
    let origin_before: String = core
        .connection()
        .unwrap()
        .query_row(
            "SELECT chain_hash FROM origin_entries WHERE event_id=?1",
            [seeded.capture.event_id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    drop(core);

    let path = directory.path().join("beta-core.sqlite3");
    let database = Connection::open(&path).unwrap();
    database.pragma_update(None, "foreign_keys", false).unwrap();
    database
        .pragma_update(None, "legacy_alter_table", true)
        .unwrap();
    database
        .execute_batch(
            "DROP TRIGGER original_chunks_no_delete;
         DROP TRIGGER original_lifecycle_delete_gate_insert_guard;
         DROP TRIGGER original_lifecycle_state_generation_guard;
         DROP TRIGGER original_lifecycle_state_no_delete;
         DROP TRIGGER original_lifecycle_followups_no_update;
         DROP TRIGGER original_lifecycle_followups_no_delete;
         DROP TRIGGER original_lifecycle_followup_responses_no_update;
         DROP TRIGGER original_lifecycle_followup_responses_no_delete;
         DROP TRIGGER original_lifecycle_restore_retry_gate_insert_guard;
         DROP INDEX original_lifecycle_followups_pending_target_sequence;
         DROP INDEX original_lifecycle_correction_target_sequence;
         DROP INDEX original_lifecycle_followup_responses_request;
         DROP TABLE original_lifecycle_restore_retry_gate;
         DROP TABLE original_lifecycle_followups_pending;
         DROP TABLE original_lifecycle_followup_responses;
         DROP TABLE original_lifecycle_followups;
         DROP TABLE original_lifecycle_delete_gate;
         DROP TABLE original_lifecycle_local_state;
",
        )
        .unwrap();
    database.execute_batch(ORIGINAL_CHUNK_DELETE9).unwrap();
    database
        .execute_batch("ALTER TABLE events RENAME TO events_schema10;")
        .unwrap();
    database.execute_batch(EVENTS9).unwrap();
    database
        .execute_batch("INSERT INTO events(local_seq,event_id,profile_id,digest,body,kind) SELECT local_seq,event_id,profile_id,digest,body,kind FROM events_schema10 ORDER BY local_seq; DROP TABLE events_schema10;")
        .unwrap();
    database
        .execute_batch("CREATE INDEX events_profile_sequence ON events(profile_id,local_seq); CREATE INDEX events_profile_kind_sequence ON events(profile_id,kind,local_seq DESC);")
        .unwrap();
    database
        .execute_batch("ALTER TABLE origin_entries RENAME TO origin_entries_schema10;")
        .unwrap();
    database.execute_batch(ORIGIN_ENTRIES9).unwrap();
    database
        .execute_batch("INSERT INTO origin_entries(rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash) SELECT rowid,profile_id,origin_device,restoration_epoch,origin_seq,event_id,fact_type,digest,chain_hash FROM origin_entries_schema10; DROP TABLE origin_entries_schema10;")
        .unwrap();
    database.pragma_update(None, "user_version", 9).unwrap();
    database
        .pragma_update(None, "legacy_alter_table", false)
        .unwrap();
    database.pragma_update(None, "foreign_keys", true).unwrap();
    drop(database);

    let migrated = Core::open(directory.path()).unwrap();
    assert_eq!(
        migrated
            .read_original_range(
                &migrated.local_human(profile).unwrap(),
                profile,
                seeded.original.original_id,
                0,
                b"schema9 migration bytes".len(),
            )
            .unwrap()
            .bytes,
        b"schema9 migration bytes"
    );
    assert_eq!(
        migrated
            .receipt(
                &migrated.local_human(profile).unwrap(),
                seeded.capture.command_id
            )
            .unwrap()
            .unwrap()
            .event_id,
        seeded.capture.event_id
    );
    let origin_after: String = migrated
        .connection()
        .unwrap()
        .query_row(
            "SELECT chain_hash FROM origin_entries WHERE event_id=?1",
            [seeded.capture.event_id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(origin_after, origin_before);
    assert_eq!(
        migrated
            .original_lifecycle_status(
                &migrated.local_human(profile).unwrap(),
                profile,
                seeded.original.original_id,
            )
            .unwrap()
            .bytes_state,
        OriginalBytesState::Available
    );
    assert_eq!(
        migrated
            .connection()
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        crate::CORE_SCHEMA_VERSION
    );
}

#[test]
fn schema10_peer_import_preserves_release_fact_without_releasing_the_receivers_copy() {
    let source_root = TempDir::new().unwrap();
    let destination_root = TempDir::new().unwrap();
    let source = Core::open(source_root.path()).unwrap();
    let destination = Core::open(destination_root.path()).unwrap();
    let profile = ProfileId::new();
    source
        .provision_profile(profile, "same schema source")
        .unwrap();
    destination
        .provision_profile(profile, "same schema source")
        .unwrap();
    let seeded = seeded_original(
        &source,
        profile,
        b"replicated lifecycle metadata only",
        "source",
    );
    let source_human = source.local_human(profile).unwrap();
    source
        .apply_original_lifecycle(
            &source_human,
            &command(&seeded, OriginalLifecycleAction::Reclaim, 0),
        )
        .unwrap();
    let mut release = command(&seeded, OriginalLifecycleAction::ReleaseLocal, 1);
    release.follow_up_device_ids = vec![destination.device_id()];
    let release_receipt = source
        .apply_original_lifecycle(&source_human, &release)
        .unwrap();

    let origin = source.replication_identity(&source_human, profile).unwrap();
    let context = destination
        .trusted_replica_context(profile, source.device_id(), origin.restoration_epoch, 1)
        .unwrap();
    let page = source
        .export_origin_page(&source_human, profile, &crate::OriginPageQuery::default())
        .unwrap();
    destination.import_origin_page(&context, &page).unwrap();

    assert_eq!(
        destination
            .original_lifecycle_status(
                &destination.local_human(profile).unwrap(),
                profile,
                seeded.original.original_id,
            )
            .unwrap()
            .bytes_state,
        OriginalBytesState::Missing
    );
    let followups = destination
        .original_lifecycle_followups(
            &destination.local_human(profile).unwrap(),
            profile,
            destination.device_id(),
            None,
            10,
        )
        .unwrap();
    assert_eq!(followups.items.len(), 1);
    assert_eq!(
        followups.items[0].request.event_id,
        release_receipt.event_id
    );
    assert_eq!(followups.items[0].request.action, "release_local");
    assert_eq!(
        followups.items[0].resolution,
        OriginalLifecycleFollowupResolution::ManifestKnown
    );
}

#[path = "original_lifecycle_red_tests.rs"]
mod lifecycle_red_tests;

#[path = "original_lifecycle_postfix_tests.rs"]
mod lifecycle_postfix_tests;

#[path = "original_lifecycle_command_replay_tests.rs"]
mod lifecycle_command_replay_tests;
