use exomind_core::{
    BeginStageCommand, CORE_SCHEMA_VERSION, CaptureCommand, CommandId, Core, CoreError, EventId,
    EventQuery, OriginalAvailability, OriginalId, OriginalRef, ProfileId, StageId, StageState,
    TimeblockAction, TimeblockCommand, TimeblockId, TimerSpec,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn original(bytes: &[u8]) -> OriginalRef {
    OriginalRef {
        original_id: OriginalId::new(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "unknown.bin".into(),
        media_type: "application/octet-stream".into(),
    }
}
fn capture(profile: ProfileId, text: &str, originals: Vec<OriginalRef>) -> CaptureCommand {
    CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1000,
        text: text.into(),
        tags: vec![],
        originals,
    }
}
#[test]
fn remote_manifest_is_metadata_without_a_stage_fact_receipt_or_read_credential() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    assert_eq!(CORE_SCHEMA_VERSION, 4);
    let profile = core.create_profile("metadata-only original").unwrap();
    let human = core.local_human(profile).unwrap();
    let remote = core
        .trusted_replica_context(profile, exomind_core::DeviceId::new(), Uuid::new_v4(), 1)
        .unwrap();
    let manifest = original(b"not present yet");
    assert_eq!(
        core.declare_original_manifest(&remote, &manifest).unwrap(),
        manifest
    );
    assert_eq!(
        core.declare_original_manifest(&remote, &manifest).unwrap(),
        manifest
    );
    assert!(matches!(
        core.read_original_range(&human, profile, manifest.original_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    assert!(core.events(&human, profile).unwrap().is_empty());
    assert!(core.receipt(&human, CommandId::new()).unwrap().is_none());
    let db = Connection::open(core.database_path()).unwrap();
    let counts:(i64,i64,i64)=db.query_row("SELECT (SELECT count(*) FROM original_stages),(SELECT count(*) FROM original_chunks),(SELECT count(*) FROM command_receipts)",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
    assert_eq!(counts, (0, 0, 0));
    let mut wrong = manifest.clone();
    wrong.file_name = "changed.bin".into();
    assert!(matches!(
        core.declare_original_manifest(&remote, &wrong),
        Err(CoreError::OriginalConflict)
    ));
    assert_eq!(
        core.declare_original_manifest(&remote, &manifest).unwrap(),
        manifest
    );
    let other = core.create_profile("separate profile").unwrap();
    let foreign = core
        .trusted_replica_context(other, exomind_core::DeviceId::new(), Uuid::new_v4(), 1)
        .unwrap();
    assert!(matches!(
        core.declare_original_manifest(&foreign, &manifest),
        Err(CoreError::OriginalConflict)
    ));
}
#[test]
fn a_declared_manifest_can_be_materialized_without_lifting_the_private_stage_boundary() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("materialize").unwrap();
    let human = core.local_human(p).unwrap();
    let remote = core
        .trusted_replica_context(p, exomind_core::DeviceId::new(), Uuid::new_v4(), 1)
        .unwrap();
    let bytes = b"exact original\x00\xff";
    let manifest = original(bytes);
    core.declare_original_manifest(&remote, &manifest).unwrap();
    let stage = StageId::new();
    core.begin_stage(
        &human,
        &BeginStageCommand {
            stage_id: stage,
            original_id: manifest.original_id,
            profile_id: p,
            expected_sha256: manifest.sha256.clone(),
            byte_length: manifest.byte_length,
            file_name: manifest.file_name.clone(),
            media_type: manifest.media_type.clone(),
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
    assert!(matches!(
        core.read_original_range(&human, p, manifest.original_id, 0, 1),
        Err(CoreError::OriginalAccessDenied)
    ));
    core.submit(
        &human,
        &capture(p, "explicit local reference", vec![manifest.clone()]),
    )
    .unwrap();
    assert!(
        matches!(core.original_availability(&human,p,manifest.original_id).unwrap(),OriginalAvailability::Local{stage} if stage.state==StageState::Verified)
    );
    assert_eq!(
        core.read_original_range(&human, p, manifest.original_id, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes
    );
}
#[test]
fn trusted_replica_context_is_bound_to_the_core_lifecycle_and_a_real_profile() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("lifecycle").unwrap();
    assert!(
        core.trusted_replica_context(
            ProfileId::new(),
            exomind_core::DeviceId::new(),
            Uuid::new_v4(),
            1
        )
        .is_err()
    );
    assert!(
        core.trusted_replica_context(p, core.device_id(), Uuid::new_v4(), 1)
            .is_err()
    );
    assert!(
        core.trusted_replica_context(p, exomind_core::DeviceId::new(), Uuid::nil(), 1)
            .is_err()
    );
    let ctx = core
        .trusted_replica_context(p, exomind_core::DeviceId::new(), Uuid::new_v4(), 1)
        .unwrap();
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    assert!(matches!(
        reopened.declare_original_manifest(&ctx, &original(b"foreign lifecycle")),
        Err(CoreError::ForeignContext)
    ));
}
#[test]
fn a_remote_manifest_cannot_turn_another_profiles_private_verified_stage_into_readable_bytes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("remote P").unwrap();
    let q = core.create_profile("private Q").unwrap();
    let qhuman = core.local_human(q).unwrap();
    let bytes = b"Q private bytes";
    let manifest = original(bytes);
    let stage = StageId::new();
    core.begin_stage(
        &qhuman,
        &BeginStageCommand {
            stage_id: stage,
            original_id: manifest.original_id,
            profile_id: q,
            expected_sha256: manifest.sha256.clone(),
            byte_length: manifest.byte_length,
            file_name: manifest.file_name.clone(),
            media_type: manifest.media_type.clone(),
        },
    )
    .unwrap();
    core.write_stage_chunk(&qhuman, stage, 0, bytes).unwrap();
    let proof = core
        .freeze_stage(&qhuman, stage)
        .unwrap()
        .verify(|| false)
        .unwrap();
    core.finish_stage(&qhuman, &proof).unwrap();
    let remote = core
        .trusted_replica_context(p, exomind_core::DeviceId::new(), Uuid::new_v4(), 1)
        .unwrap();
    assert!(matches!(
        core.declare_original_manifest(&remote, &manifest),
        Err(CoreError::OriginalConflict)
    ));
    let phuman = core.local_human(p).unwrap();
    assert!(
        core.read_original_range(&phuman, p, manifest.original_id, 0, bytes.len())
            .is_err()
    );
    assert_eq!(
        core.read_stage_range(&qhuman, stage, 0, bytes.len())
            .unwrap()
            .bytes,
        bytes
    );
}
#[test]
fn local_origin_positions_are_per_profile_durable_and_atomic_with_the_existing_receipt() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("P").unwrap();
    let q = core.create_profile("Q").unwrap();
    let human = core.local_human(p).unwrap();
    let identity = core.replication_identity(&human, p).unwrap();
    assert_eq!(core.origin_checkpoint(&human, p).unwrap().seq, 0);
    let qhuman = core.local_human(q).unwrap();
    let qidentity = core.replication_identity(&qhuman, q).unwrap();
    assert_ne!(identity.restoration_epoch, qidentity.restoration_epoch);
    let db = Connection::open(core.database_path()).unwrap();
    let before: i64 = db
        .query_row("SELECT count(*) FROM origin_entries", [], |row| row.get(0))
        .unwrap();
    assert_eq!(core.replication_identity(&human, p).unwrap(), identity);
    assert_eq!(core.origin_checkpoint(&human, p).unwrap().seq, 0);
    assert_eq!(
        db.query_row::<i64, _, _>("SELECT count(*) FROM origin_entries", [], |row| row.get(0))
            .unwrap(),
        before
    );
    drop(db);
    assert!(!identity.restoration_epoch.is_nil());
    assert_eq!(identity.device_id, core.device_id());
    let first = capture(p, "local fact", vec![]);
    let saved = core.submit(&human, &first).unwrap();
    let head = core.origin_checkpoint(&human, p).unwrap();
    assert_eq!(head.seq, 1);
    assert!(core.submit(&human, &first).unwrap().replayed);
    assert_eq!(core.origin_checkpoint(&human, p).unwrap(), head);
    let epoch = Uuid::new_v4();
    let stamp = core.trusted_clock_stamp(epoch, 2000, 0).unwrap();
    let revision = core.timeblock_snapshot(&human, p, &stamp).unwrap().revision;
    core.apply_timeblock(
        &human,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            expected_revision: revision,
            action: TimeblockAction::Start {
                block_id: TimeblockId::new(),
                name: "typed origin".into(),
                note: String::new(),
                timer: TimerSpec::CountUp,
            },
        },
        &stamp,
    )
    .unwrap();
    let second = core.origin_checkpoint(&human, p).unwrap();
    assert_eq!(second.seq, 2);
    assert_ne!(second.hash, head.hash);
    let qhuman = core.local_human(q).unwrap();
    core.submit(&qhuman, &capture(q, "Q position", vec![]))
        .unwrap();
    assert_eq!(core.origin_checkpoint(&qhuman, q).unwrap().seq, 1);
    assert_eq!(core.origin_checkpoint(&human, p).unwrap(), second);
    let db = Connection::open(core.database_path()).unwrap();
    db.execute_batch("CREATE TRIGGER fail_origin BEFORE INSERT ON origin_entries WHEN NEW.origin_seq=3 BEGIN SELECT RAISE(ABORT,'synthetic origin write fault'); END;").unwrap();
    let failed = capture(p, "must roll back", vec![]);
    assert!(core.submit(&human, &failed).is_err());
    assert_eq!(core.events(&human, p).unwrap().len(), 1);
    assert!(core.receipt(&human, failed.command_id).unwrap().is_none());
    assert_eq!(core.origin_checkpoint(&human, p).unwrap(), second);
    assert_eq!(
        core.events_page(&human, p, &EventQuery::default())
            .unwrap()
            .items[0]
            .event_id,
        saved.event_id
    );
    drop(db);
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    let human = reopened.local_human(p).unwrap();
    assert_eq!(reopened.replication_identity(&human, p).unwrap(), identity);
    assert_eq!(reopened.origin_checkpoint(&human, p).unwrap(), second);
}

#[test]
fn origin_checkpoint_refuses_missing_or_changed_endpoint_instead_of_claiming_complete() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("endpoint integrity").unwrap();
    let human = core.local_human(p).unwrap();
    let command = capture(p, "unchanged canonical text", vec![]);
    core.submit(&human, &command).unwrap();
    let checkpoint = core.origin_checkpoint(&human, p).unwrap();
    let db = Connection::open(core.database_path()).unwrap();
    db.execute(
        "UPDATE origin_heads SET head_hash=?1 WHERE profile_id=?2",
        rusqlite::params!["a".repeat(1024 * 1024), p.to_string()],
    )
    .unwrap();
    assert!(core.origin_checkpoint(&human, p).is_err());
    db.execute(
        "UPDATE origin_heads SET head_hash=?1 WHERE profile_id=?2",
        rusqlite::params![checkpoint.hash, p.to_string()],
    )
    .unwrap();
    let body: String = db
        .query_row(
            "SELECT body FROM events WHERE event_id=?1",
            [command.event_id.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    let mut changed: serde_json::Value = serde_json::from_str(&body).unwrap();
    changed["text"] = "tampered despite cached digest".into();
    db.execute(
        "UPDATE events SET body=?1 WHERE event_id=?2",
        rusqlite::params![
            serde_json::to_string(&changed).unwrap(),
            command.event_id.to_string()
        ],
    )
    .unwrap();
    assert!(core.origin_checkpoint(&human, p).is_err());
    db.execute(
        "UPDATE events SET body=?1 WHERE event_id=?2",
        rusqlite::params![body, command.event_id.to_string()],
    )
    .unwrap();
    assert_eq!(core.origin_checkpoint(&human, p).unwrap(), checkpoint);
    db.execute(
        "DELETE FROM origin_entries WHERE event_id=?1",
        [command.event_id.to_string()],
    )
    .unwrap();
    assert!(core.origin_checkpoint(&human, p).is_err());
    assert!(
        core.submit(
            &human,
            &capture(p, "must not append over broken lineage", vec![])
        )
        .is_err()
    );
    assert_eq!(core.events(&human, p).unwrap().len(), 1);
}
