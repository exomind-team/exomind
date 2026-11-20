use exomind_core::*;
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const BASELINE_COMMIT: &str = "5708e0baf5cdc896559fab5172dc13805531ba33";
const CORE10_PAYLOAD_COMMIT: &str = "cc3bc937c4196d1a6a838b10a82018dc37d66480";
const CORE_SOURCE_FILES: &[&str] = &[
    "crates/exomind-core/src/lib.rs",
    "crates/exomind-core/src/fact_encoding.rs",
    "crates/exomind-core/src/record_organization.rs",
    "crates/exomind-core/src/summaries/mod.rs",
    "crates/exomind-core/src/summaries/model.rs",
    "crates/exomind-core/src/summaries/facts.rs",
    "crates/exomind-core/src/summaries/sources.rs",
    "crates/exomind-core/src/summaries/store.rs",
    "crates/exomind-core/src/summaries/events_schema.rs",
    "crates/exomind-core/src/timeblocks/store.rs",
    "crates/exomind-core/src/timeblocks/model.rs",
];

fn stamp(core: &Core, wall_ms: i64) -> ClockStamp {
    core.trusted_clock_stamp(Uuid::from_u128(7), wall_ms, wall_ms as u64)
        .unwrap()
}

fn apply(core: &Core, profile: ProfileId, wall_ms: i64, action: TimeblockAction) {
    let context = core.local_human(profile).unwrap();
    let at = stamp(core, wall_ms);
    let revision = core.timeblock_snapshot(&context, profile, &at).unwrap().revision;
    core.apply_timeblock(
        &context,
        &TimeblockCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            expected_revision: revision,
            action,
        },
        &at,
    )
    .unwrap();
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn cargo_lock_path(crate_root: &Path, workspace_root: &Path) -> PathBuf {
    let isolated_lock = crate_root.join("Cargo.lock");
    if isolated_lock.is_file() {
        isolated_lock
    } else {
        workspace_root.join("Cargo.lock")
    }
}

fn sha256_file(path: &Path) -> String {
    sha256(&fs::read(path).unwrap_or_else(|error| panic!("read {}: {error}", path.display())))
}

#[test]
fn generate_legacy_summary_fixture_from_old_core() {
    let supplied_commit = env::var("EXOMIND_PREFREEZE_BASE_SHA")
        .expect("set EXOMIND_PREFREEZE_BASE_SHA to the exact old Core commit");
    assert_eq!(supplied_commit, BASELINE_COMMIT, "fixture must come from the old committed Core baseline");
    let payload_commit = env::var("EXOMIND_PREFREEZE_PAYLOAD_SHA")
        .expect("set EXOMIND_PREFREEZE_PAYLOAD_SHA to the frozen Core10 payload commit");
    assert_eq!(payload_commit, CORE10_PAYLOAD_COMMIT, "payload identity must match the frozen Core10 candidate");
    assert_eq!(exomind_core::CORE_SCHEMA_VERSION, 10, "generator must use old Core10");


    let output_dir = PathBuf::from(
        env::var_os("EXOMIND_PREFREEZE_FIXTURE_DIR")
            .expect("set EXOMIND_PREFREEZE_FIXTURE_DIR outside the repository"),
    );
    fs::create_dir_all(&output_dir).unwrap();
    for name in [
        "summary-body.json",
        "summary-digest.txt",
        "snapshot-digest.txt",
        "manifest.json",
    ] {
        assert!(!output_dir.join(name).exists(), "refusing to overwrite {}", output_dir.join(name).display());
    }

    let data = tempfile::tempdir().unwrap();
    let core = Core::open(data.path()).unwrap();
    let profile = core.create_profile("Synthetic prefreeze fixture").unwrap();
    let context = core.local_human(profile).unwrap();
    let block = TimeblockId::new();

    apply(
        &core,
        profile,
        1_000,
        TimeblockAction::Start {
            block_id: block,
            name: "Synthetic review block".into(),
            note: String::new(),
            timer: TimerSpec::CountUp,
        },
    );

    let capture = CaptureCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1_500,
        text: "Synthetic original capture remains unchanged.".into(),
        tags: vec![],
        originals: vec![],
    };
    let capture_receipt = core.submit(&context, &capture).unwrap();

    let correction = RecordCorrectionCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: 1_600,
        target_event_id: capture.event_id,
        target_digest: capture_receipt.event_digest.clone(),
        corrected_text: "Synthetic corrected fact remains a separate event.".into(),
    };
    let correction_receipt = core.record_correction(&context, &correction).unwrap();

    apply(
        &core,
        profile,
        2_000,
        TimeblockAction::EndAction { block_id: block },
    );
    apply(
        &core,
        profile,
        3_000,
        TimeblockAction::SubmitFeedback {
            block_id: block,
            feedback: FeedbackInput::Skipped,
        },
    );

    let executor = core.local_summary_executor();
    let reconciled = core.reconcile_summary_triggers(&executor).unwrap();
    assert_eq!(reconciled.created.len(), 1);
    let task_id = reconciled.created[0];
    core.summary_wait_for_configuration(&executor, profile, task_id)
        .unwrap();
    let task = core.read_summary_task(&context, profile, task_id).unwrap();
    let run = task.current_run.as_ref().unwrap();

    let work = core
        .begin_summary_attempt(
            &executor,
            &SummaryBeginCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                task_id,
                expected_owner_generation: task.owner_generation,
                expected_owner_control_event_id: task.owner_control_event_id,
                expected_run_id: run.run_id,
                attempt_id: Uuid::new_v4(),
                role_config_digest: "a".repeat(64),
                max_attempts: 2,
                now_ms: 4_000,
            },
        )
        .unwrap();

    assert!(work
        .snapshot
        .sources
        .iter()
        .any(|source| source.event_id == capture.event_id && source.kind == "capture"));
    assert!(
        !work
            .snapshot
            .sources
            .iter()
            .any(|source| source.event_id == correction.event_id),
        "old baseline must not contain the prefreeze extension"
    );

    let output = SummaryOutput {
        narrative: "Synthetic legacy artifact for byte-preservation coverage.".into(),
        evidence: vec![capture.event_id],
        read_original_ids: vec![],
        model: SummaryModelMetadata {
            provider: "synthetic-fixture".into(),
            model: "synthetic-fixture-model".into(),
            role_config_digest: "a".repeat(64),
            request_input_digest: "b".repeat(64),
            prompt_template: "exomind-summary/v3".into(),
            include_suggestions: false,
            max_output_tokens: 128,
            requested_model: "synthetic-fixture-model".into(),
        },
        usage: SummaryUsage {
            input_tokens: Some(1),
            output_tokens: Some(1),
            provider_request_id: None,
        },
    };
    let artifact_event_id = match core
        .finish_summary_attempt(&executor, &work.ticket, &output)
        .unwrap()
    {
        SummaryCommitOutcome::Applied { artifact_event_id, .. } => artifact_event_id,
        SummaryCommitOutcome::Stale => panic!("synthetic legacy artifact was not committed"),
    };

    let database = Connection::open_with_flags(
        core.database_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let (body, digest, local_seq): (Vec<u8>, String, u64) = database
        .query_row(
            "SELECT CAST(body AS BLOB),digest,local_seq FROM events WHERE profile_id=?1 AND event_id=?2 AND kind='summary/1'",
            params![profile.to_string(), artifact_event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let stored_record: SummaryArtifactRecord = serde_json::from_slice(&body).unwrap();
    assert_eq!(stored_record.digest, digest, "stored record and SQL fact digest agree");
    assert_eq!(stored_record.computed_digest().unwrap(), digest, "verify the domain digest with the old production encoder");

    let parsed: Value = serde_json::from_slice(&body).unwrap();
    let snapshot_digest = parsed["snapshot"]["digest"]
        .as_str()
        .expect("stored raw body contains its frozen snapshot digest")
        .to_owned();
    assert_eq!(snapshot_digest, work.snapshot.digest);

    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = crate_root.join("../..").canonicalize().unwrap();
    let cargo_lock = cargo_lock_path(&crate_root, &root);
    let cargo_lock_sha256 = sha256_file(&cargo_lock);
    let generator_source_sha256 = sha256_file(
        &root.join("crates/exomind-core/tests/summary_prefreeze_legacy_fixture_generator.rs"),
    );
    let mut core_source_fingerprints = BTreeMap::new();
    for relative in CORE_SOURCE_FILES {
        core_source_fingerprints.insert(
            (*relative).to_owned(),
            sha256_file(&root.join(relative)),
        );
    }

    fs::write(output_dir.join("summary-body.json"), &body).unwrap();
    fs::write(output_dir.join("summary-digest.txt"), format!("{digest}\n")).unwrap();
    fs::write(
        output_dir.join("snapshot-digest.txt"),
        format!("{snapshot_digest}\n"),
    )
    .unwrap();
    let mut manifest = json!({
        "fixture_kind": "raw database body from the committed old Core baseline",
        "baseline_commit": supplied_commit,
        "core10_payload_commit": payload_commit,
        "generator_source_sha256": generator_source_sha256,
        "cargo_lock_sha256": cargo_lock_sha256,
        "core_source_fingerprints": core_source_fingerprints,
        "artifact_event_id": artifact_event_id,
        "artifact_digest": digest,
        "artifact_local_seq": local_seq,
        "artifact_body_sha256": sha256(&body),
        "snapshot_digest": snapshot_digest,
        "profile_id": profile,
        "capture_event_id": capture.event_id,
        "capture_digest": capture_receipt.event_digest,
        "correction_event_id": correction_receipt.event_id,
        "correction_digest": correction_receipt.event_digest,
        "correction_target_event_id": correction.target_event_id,
        "correction_target_digest": correction.target_digest,
        "raw_source": "SQLite events.body cast to BLOB; no model or snapshot serialization used to create the fixture"
    });
    let database_copy = output_dir.join("beta-core.sqlite3");
    assert!(!database_copy.exists(), "refusing to overwrite old database fixture");
    database.execute("VACUUM INTO ?1", params![database_copy.to_str().unwrap()]).unwrap();
    let old_copy = Connection::open_with_flags(&database_copy, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let old_version: i64 = old_copy.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
    assert_eq!(old_version, 10);
    manifest["database_schema"] = json!(old_version);
    manifest["database_file"] = json!("beta-core.sqlite3");
    manifest["database_sha256"] = json!(sha256_file(&database_copy));
    fs::write(
        output_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    println!(
        "Raw prefreeze baseline fixture written to {}",
        output_dir.display()
    );
}
