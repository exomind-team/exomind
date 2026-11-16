//! Actual old schema-5 input is retained separately; never downgrade a new
//! database and label it an old release fixture.
use exomind_core::*;
use rusqlite::{Connection, OpenFlags, types::Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};

fn readonly(path: &Path) -> Connection {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .unwrap()
}
fn rows(c: &Connection, table: &str) -> Vec<Vec<Value>> {
    let mut q = c
        .prepare(&format!(
            "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
            table.replace('"', "\"\"")
        ))
        .unwrap();
    let count = q.column_count();
    q.query_map([], |r| {
        (0..count).map(|n| r.get(n)).collect::<Result<Vec<_>, _>>()
    })
    .unwrap()
    .collect::<Result<Vec<_>, _>>()
    .unwrap()
}
fn snapshot(c: &Connection) -> BTreeMap<String, Vec<Vec<Value>>> {
    let names = c
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let values = rows(c, &name);
            (name, values)
        })
        .collect()
}
fn hashes(root: &Path) -> BTreeMap<String, String> {
    fs::read_dir(root)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            assert!(entry.file_type().unwrap().is_file());
            let name = entry.file_name().to_str().unwrap().to_string();
            let hash = format!("{:x}", Sha256::digest(fs::read(entry.path()).unwrap()));
            (name, hash)
        })
        .collect()
}

#[test]
#[ignore = "requires immutable actual Core5 fixture via EXOMIND_CORE_SCHEMA5_FIXTURE"]
fn actual_schema5_backup_preserves_all_old_rows_receipts_original_bytes_and_origin_positions() {
    let source = std::path::PathBuf::from(
        std::env::var_os("EXOMIND_CORE_SCHEMA5_FIXTURE")
            .expect("actual retained Core5 fixture path"),
    );
    let source_hash = hashes(&source);
    let input = readonly(&source.join("beta-core.sqlite3"));
    assert_eq!(
        input
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        5
    );
    let expected = snapshot(&input);
    assert!(!expected["events"].is_empty());
    assert!(!expected["command_receipts"].is_empty());
    assert!(!expected["origin_entries"].is_empty());
    assert!(!expected["original_chunks"].is_empty());
    drop(input);
    let root = tempfile::tempdir().unwrap();
    for entry in fs::read_dir(&source).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        assert!(
            [
                "beta-core.sqlite3",
                "beta-core.sqlite3-wal",
                "beta-core.sqlite3-shm",
                "beta-core.sqlite3-journal"
            ]
            .iter()
            .any(|allowed| name == *allowed)
        );
        fs::copy(entry.path(), root.path().join(name)).unwrap();
    }
    let core = Core::open(root.path()).unwrap();
    let db = readonly(core.database_path());
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        CORE_SCHEMA_VERSION
    );
    for (name, expected) in &expected {
        assert_eq!(
            &rows(&db, name),
            expected,
            "old {name} rowid and values unchanged"
        );
    }
    let backups = fs::read_dir(root.path().join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    assert!(
        backups[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("schema-5-")
    );
    let backup = readonly(&backups[0]);
    assert_eq!(snapshot(&backup), expected);
    assert_eq!(
        backup
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        5
    );
    drop(backup);
    for profile in core.profiles().unwrap() {
        let ctx = core.local_human(profile.profile_id).unwrap();
        let mut query = OriginPageQuery {
            max_bytes: MAX_ORIGIN_PAGE_BYTES,
            ..Default::default()
        };
        loop {
            let page = core
                .export_origin_page(&ctx, profile.profile_id, &query)
                .unwrap();
            for entry in &page.entries {
                match &entry.fact {
                    ReplicatedFact::Capture(v) => {
                        assert_eq!(v.digest, v.computed_digest().unwrap())
                    }
                    ReplicatedFact::Timeblock(v) => {
                        assert_eq!(v.digest, v.computed_digest().unwrap())
                    }
                    _ => panic!("old fixture cannot contain summary facts"),
                }
            }
            if !page.has_more {
                break;
            }
            query.after = Some(page.to);
            query.through = Some(page.through);
        }
    }
    let exec = core.local_summary_executor();
    assert!(
        core.reconcile_summary_triggers(&exec)
            .unwrap()
            .created
            .is_empty(),
        "migration never charges a historical backlog"
    );
    // The migrated event CHECK accepts BOTH actual new record types through
    // normal Core APIs, while preserving the old snapshots checked above.
    let profile = core
        .profiles()
        .unwrap()
        .into_iter()
        .find(|p| {
            !core
                .events(&core.local_human(p.profile_id).unwrap(), p.profile_id)
                .unwrap()
                .is_empty()
        })
        .unwrap()
        .profile_id;
    let human = core.local_human(profile).unwrap();
    core.request_summary(
        &human,
        &SummaryRequestCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: profile,
            purpose: SummaryPurpose::ManualCompressV1,
            artifact_kind: SummaryArtifactKind::CompressedMessage,
            selection: SummarySelection {
                block_ids: vec![TimeblockId::new()],
                from_ms: 0,
                to_ms: i64::MAX,
                selected_original_ids: vec![],
            },
        },
    )
    .unwrap();
    let task = core
        .summary_tasks_page(&human, profile, None, 100)
        .unwrap()
        .items
        .pop()
        .unwrap();
    let work = core
        .begin_summary_attempt(
            &exec,
            &SummaryBeginCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: profile,
                task_id: task.task_id,
                expected_owner_generation: task.owner_generation,
                expected_owner_control_event_id: task.owner_control_event_id,
                expected_run_id: task.current_run.unwrap().run_id,
                attempt_id: uuid::Uuid::new_v4(),
                role_config_digest: "a".repeat(64),
                max_attempts: 1,
                now_ms: 1000,
            },
        )
        .unwrap();
    let output = SummaryOutput {
        narrative: "Synthetic post-migration result".into(),
        evidence: vec![work.snapshot.sources[0].event_id],
        read_original_ids: vec![],
        model: SummaryModelMetadata {
            provider: "synthetic".into(),
            model: "synthetic".into(),
            role_config_digest: "a".repeat(64),
            request_input_digest: "b".repeat(64),
            prompt_template: "exomind-summary/v1".into(),
            include_suggestions: false,
            max_output_tokens: 64,
            requested_model: "synthetic".into(),
        },
        usage: SummaryUsage {
            input_tokens: None,
            output_tokens: None,
            provider_request_id: None,
        },
    };
    assert!(matches!(
        core.finish_summary_attempt(&exec, &work.ticket, &output)
            .unwrap(),
        SummaryCommitOutcome::Applied { .. }
    ));
    drop(db);
    drop(core);
    assert_eq!(hashes(&source), source_hash, "retained input unchanged");
    let core = Core::open(root.path()).unwrap();
    assert_eq!(
        fs::read_dir(root.path().join("backups")).unwrap().count(),
        1,
        "same version creates no additional backup"
    );
    drop(core);
}

#[test]
fn same_version_missing_summary_index_is_recovery_without_fact_or_receipt_changes() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic P").unwrap();
    core.submit(
        &core.local_human(p).unwrap(),
        &CaptureCommand {
            command_id: CommandId::new(),
            event_id: EventId::new(),
            profile_id: p,
            occurred_at_ms: 1000,
            text: "retained".into(),
            tags: vec![],
            originals: vec![],
        },
    )
    .unwrap();
    let path = core.database_path().to_path_buf();
    drop(core);
    let c = Connection::open(&path).unwrap();
    let rejected=c.execute("INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,'digest','{}','unknown/999')",rusqlite::params![EventId::new().to_string(),p.to_string()]);
    assert!(
        rejected.is_err(),
        "schema6 retains an explicit accepted-kind domain"
    );
    c.execute("DELETE FROM summary_capture_sources", [])
        .unwrap();
    let before = snapshot(&c);
    drop(c);
    assert!(matches!(
        Core::open(root.path()),
        Err(CoreError::RecoveryRequired)
    ));
    assert_eq!(snapshot(&readonly(&path)), before);
}
