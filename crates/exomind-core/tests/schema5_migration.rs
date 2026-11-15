use exomind_core::*;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use uuid::Uuid;

fn copied_core(source: &Path, destination: &Path) {
    assert!(!destination.exists());
    fs::create_dir(destination).unwrap();
    // Only recognized Core files are copied. The retained source is never
    // moved, opened writable, or altered by an upgrade test.
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let kind = entry.file_type().unwrap();
        assert!(kind.is_file() && !kind.is_symlink());
        let name = entry.file_name();
        assert!(
            [
                "beta-core.sqlite3",
                "beta-core.sqlite3-wal",
                "beta-core.sqlite3-shm",
                "beta-core.sqlite3-journal"
            ]
            .iter()
            .any(|v| name == *v)
        );
        fs::copy(entry.path(), destination.join(name)).unwrap();
    }
}
fn probe(executable: &Path, root: &Path) -> (bool, String, String) {
    struct Owned(std::process::Child);
    impl Drop for Owned {
        fn drop(&mut self) {
            if self.0.try_wait().ok().flatten().is_none() {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
    }
    let logs = tempfile::tempdir().unwrap();
    let stdout = logs.path().join("stdout");
    let stderr = logs.path().join("stderr");
    let mut child = Owned(
        Command::new(executable)
            .args(["probe", "--data-dir"])
            .arg(root)
            .stdout(Stdio::from(fs::File::create(&stdout).unwrap()))
            .stderr(Stdio::from(fs::File::create(&stderr).unwrap()))
            .spawn()
            .unwrap(),
    );
    let end = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            let read = |p: &Path| {
                use std::io::Read;
                let mut bytes = vec![];
                fs::File::open(p)
                    .unwrap()
                    .take(65537)
                    .read_to_end(&mut bytes)
                    .unwrap();
                assert!(bytes.len() <= 65536);
                String::from_utf8(bytes).unwrap()
            };
            return (status.success(), read(&stdout), read(&stderr));
        }
        assert!(Instant::now() < end, "owned old Core4 probe deadline");
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn stamp(core: &Core, value: &Value) -> ClockStamp {
    core.trusted_clock_stamp(
        value["epoch_id"].as_str().unwrap().parse().unwrap(),
        value["wall_ms"].as_i64().unwrap(),
        value["elapsed_ms"].as_u64().unwrap(),
    )
    .unwrap()
}
fn deadline_rows(db: &Connection) -> Value {
    let mut query=db.prepare("SELECT deadline_id,profile_id,block_id,generation,owner_generation,command_id,event_id,state,due_wall_ms,due_elapsed_ms,clock_epoch,end_mode FROM timeblock_deadlines ORDER BY profile_id,block_id,generation,deadline_id").unwrap();
    let rows=query.query_map([],|r|Ok(json!({
        "deadline_id":r.get::<_,String>(0)?,"profile_id":r.get::<_,String>(1)?,"block_id":r.get::<_,String>(2)?,"generation":r.get::<_,u64>(3)?,"owner_generation":r.get::<_,u64>(4)?,"command_id":r.get::<_,String>(5)?,"event_id":r.get::<_,String>(6)?,"state":r.get::<_,String>(7)?,"due_wall_ms":r.get::<_,i64>(8)?,"due_elapsed_ms":r.get::<_,u64>(9)?,"clock_epoch":r.get::<_,String>(10)?,"end_mode":r.get::<_,String>(11)?
    }))).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
    Value::Array(rows)
}
fn canonical_nodes(core: &Core, p: ProfileId) -> Vec<(String, Vec<u8>)> {
    let human = core.local_human(p).unwrap();
    core.timeblock_nodes(&human, p, &EventQuery::default())
        .unwrap()
        .items
        .into_iter()
        .map(|n| (n.event_id.to_string(), n.canonical_fact_bytes().unwrap()))
        .collect()
}
#[test]
fn stable_run_payload_does_not_change_legacy_deadline_bytes() {
    let a: EventId = "11111111-1111-4111-8111-111111111111".parse().unwrap();
    let p: ProfileId = "22222222-2222-4222-8222-222222222222".parse().unwrap();
    let d: DeviceId = "33333333-3333-4333-8333-333333333333".parse().unwrap();
    let b: TimeblockId = "44444444-4444-4444-8444-444444444444".parse().unwrap();
    let id: Uuid = "55555555-5555-4555-8555-555555555555".parse().unwrap();
    let epoch: Uuid = "66666666-6666-4666-8666-666666666666".parse().unwrap();
    let node = TimeblockNodeRecord {
        event_id: a,
        profile_id: p,
        device_id: d,
        source: TimeblockSource {
            kind: TimeblockSourceKind::Scheduler,
            author_id: d.to_string().parse().unwrap(),
            owner_generation: Some(7),
        },
        parents: vec![],
        occurred_at_ms: 2200,
        effective_at_ms: 2100,
        clock: NodeClock {
            epoch_id: epoch,
            elapsed_ms: 1200,
        },
        payload: TimeblockPayload::DeadlineReached {
            block_id: b,
            deadline_id: id,
            generation: 3,
            end_mode: CountdownEndMode::Hard,
            due_wall_ms: 2100,
            due_elapsed_ms: 1100,
            clock_epoch: epoch,
        },
        digest: "ignored".into(),
        local_seq: 999,
    };
    let expected=br#"{"kind":"timeblock/1","event_id":"11111111-1111-4111-8111-111111111111","profile_id":"22222222-2222-4222-8222-222222222222","device_id":"33333333-3333-4333-8333-333333333333","source":{"kind":"scheduler","author_id":"33333333-3333-4333-8333-333333333333","owner_generation":7},"parents":[],"occurred_at_ms":2200,"effective_at_ms":2100,"clock":{"epoch_id":"66666666-6666-4666-8666-666666666666","elapsed_ms":1200},"payload":{"kind":"deadline_reached","block_id":"44444444-4444-4444-8444-444444444444","deadline_id":"55555555-5555-4555-8555-555555555555","generation":3,"end_mode":"hard","due_wall_ms":2100,"due_elapsed_ms":1100,"clock_epoch":"66666666-6666-4666-8666-666666666666"}}"#;
    assert_eq!(node.canonical_fact_bytes().unwrap(), expected);
    assert_eq!(
        node.computed_digest().unwrap(),
        format!("{:x}", Sha256::digest(expected))
    );
}

#[test]
#[ignore = "requires EXOMIND_SCHEMA4_FIXTURE pointing to the retained actual Core4 seed/probe"]
fn actual_schema_four_pending_start_and_resume_keep_their_accepted_intents_after_migration() {
    let fixture =
        std::env::var_os("EXOMIND_SCHEMA4_FIXTURE").expect("actual retained Core4 fixture");
    let fixture = Path::new(&fixture);
    let metadata: Value =
        serde_json::from_slice(&fs::read(fixture.join("provenance.json")).unwrap()).unwrap();
    let expected: Value =
        serde_json::from_slice(&fs::read(fixture.join("expected.json")).unwrap()).unwrap();
    assert_eq!(metadata["schema"], 4);
    assert_eq!(expected["actual_schema"], 4);
    assert_eq!(
        metadata["core_source"]["sha256"],
        expected["core_source_sha256"]
    );
    let old = fixture.join("exomind-core-schema4.exe");
    assert_eq!(
        format!("{:x}", Sha256::digest(fs::read(&old).unwrap())),
        metadata["binary_sha256"].as_str().unwrap()
    );
    let owned = tempfile::tempdir().unwrap();
    let root = owned.path().join("upgraded");
    copied_core(&fixture.join("core"), &root);
    let result = probe(&old, &root);
    assert!(result.0, "{}", result.2);
    assert!(result.1.contains("4"));
    let p: ProfileId = expected["profile_id"].as_str().unwrap().parse().unwrap();
    let q: ProfileId = expected["resumed_fixture"]["profile_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let bytes = fs::read(fixture.join("original.bin")).unwrap();
    let core = Core::open(&root).unwrap();
    let now = stamp(&core, &expected["clock"]);
    assert_eq!(CORE_SCHEMA_VERSION, 5);
    let database = Connection::open(core.database_path()).unwrap();
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        5
    );
    assert_eq!(deadline_rows(&database), expected["deadline_rows"]);
    for (profile, snapshot, origin, head, nodes) in [
        (
            p,
            &expected["timeblock_snapshot"],
            &expected["origin"],
            &expected["origin_head"],
            &expected["timeblock_nodes"],
        ),
        (
            q,
            &expected["resumed_fixture"]["snapshot"],
            &expected["resumed_fixture"]["origin"],
            &expected["resumed_fixture"]["origin_head"],
            &expected["resumed_fixture"]["timeblock_nodes"],
        ),
    ] {
        let human = core.local_human(profile).unwrap();
        assert_eq!(
            serde_json::to_value(core.timeblock_snapshot(&human, profile, &now).unwrap()).unwrap(),
            *snapshot
        );
        assert_eq!(
            serde_json::to_value(core.replication_identity(&human, profile).unwrap()).unwrap(),
            *origin
        );
        assert_eq!(
            serde_json::to_value(core.origin_checkpoint(&human, profile).unwrap()).unwrap(),
            *head
        );
        assert_eq!(
            serde_json::to_value(
                core.timeblock_nodes(&human, profile, &EventQuery::default())
                    .unwrap()
            )
            .unwrap(),
            *nodes
        );
    }
    let human = core.local_human(p).unwrap();
    let original: OriginalId = expected["original"]["original_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let mut actual = vec![];
    for offset in (0..bytes.len()).step_by(MAX_ORIGINAL_CHUNK_BYTES) {
        actual.extend(
            core.read_original_range(
                &human,
                p,
                original,
                offset as u64,
                (bytes.len() - offset).min(MAX_ORIGINAL_CHUNK_BYTES),
            )
            .unwrap()
            .bytes,
        );
    }
    assert_eq!(actual, bytes);
    let receipts = database
        .prepare("SELECT command_id,profile_id,input_digest,receipt FROM command_receipts ORDER BY command_id")
        .unwrap()
        .query_map([], |r| {
            Ok(json!({
                "command_id": r.get::<_, String>(0)?,
                "profile_id": r.get::<_, String>(1)?,
                "input_digest": r.get::<_, String>(2)?,
                "receipt": r.get::<_, String>(3)?,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        serde_json::to_value(receipts).unwrap(),
        expected["stored_receipts"]
    );
    let bound:Vec<(String,String)>=database.prepare("SELECT profile_id,run_event_id FROM timeblock_deadlines WHERE state='pending' ORDER BY profile_id").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
    assert_eq!(bound.len(), 2);
    assert!(
        bound.contains(&(
            p.to_string(),
            expected["timeblock_command"]["event_id"]
                .as_str()
                .unwrap()
                .into()
        ))
    );
    assert!(
        bound.contains(&(
            q.to_string(),
            expected["resumed_fixture"]["commands"]
                .as_array()
                .unwrap()
                .last()
                .unwrap()["event_id"]
                .as_str()
                .unwrap()
                .into()
        ))
    );
    let backup: Vec<_> = fs::read_dir(root.join("backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|v| v == "sqlite3"))
        .collect();
    assert_eq!(backup.len(), 1);
    assert!(
        backup[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("schema-4-")
    );
    let backup_database =
        Connection::open_with_flags(&backup[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        backup_database
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        4
    );
    assert_eq!(
        backup_database
            .query_row::<String, _, _>("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap(),
        "ok"
    );
    drop(backup_database);
    let copy = owned.path().join("backup-only");
    fs::create_dir(&copy).unwrap();
    fs::copy(&backup[0], copy.join("beta-core.sqlite3")).unwrap();
    assert!(probe(&old, &copy).0);
    drop(database);
    drop(core);
    let before = fs::read(root.join("beta-core.sqlite3")).unwrap();
    let backup_bytes = fs::read(&backup[0]).unwrap();
    let denied = probe(&old, &root);
    assert!(!denied.0);
    assert!(
        denied.2.contains("data root contains foreign files")
            || denied.2.trim() == "legacy-core4-fixture: unsupported core schema version 5"
    );
    assert_eq!(before, fs::read(root.join("beta-core.sqlite3")).unwrap());
    assert_eq!(backup_bytes, fs::read(&backup[0]).unwrap());
    let main_only = owned.path().join("schema5-only");
    fs::create_dir(&main_only).unwrap();
    fs::copy(
        root.join("beta-core.sqlite3"),
        main_only.join("beta-core.sqlite3"),
    )
    .unwrap();
    let denied = probe(&old, &main_only);
    assert!(!denied.0);
    assert_eq!(
        denied.2.trim(),
        "legacy-core4-fixture: unsupported core schema version 5"
    );
    assert_eq!(
        before,
        fs::read(main_only.join("beta-core.sqlite3")).unwrap()
    );
    let core = Core::open(&root).unwrap();
    let old_nodes_p = canonical_nodes(&core, p);
    let old_nodes_q = canonical_nodes(&core, q);
    let future = stamp(&core, &expected["future_clock"]);
    let scheduler = core.local_scheduler();
    let tickets = core.due_deadlines(&scheduler, &future, 100).unwrap();
    assert_eq!(tickets.len(), 2);
    for ticket in &tickets {
        assert!(matches!(
            core.complete_deadline(&scheduler, ticket, &future).unwrap(),
            DeadlineOutcome::Applied(_)
        ));
        assert!(matches!(
            core.complete_deadline(&scheduler, ticket, &future).unwrap(),
            DeadlineOutcome::Applied(_)
        ));
    }
    for (profile, previous) in [(p, old_nodes_p), (q, old_nodes_q)] {
        let nodes = canonical_nodes(&core, profile);
        for old in previous {
            assert!(nodes.contains(&old));
        }
        assert_eq!(nodes.len(), if profile == p { 2 } else { 4 });
    }
    assert!(
        core.due_deadlines(&scheduler, &future, 100)
            .unwrap()
            .is_empty()
    );
    let database = Connection::open(core.database_path()).unwrap();
    assert_eq!(
        database
            .query_row::<u64, _, _>("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
            .unwrap(),
        7
    );
}

#[test]
#[ignore = "requires EXOMIND_SCHEMA4_FIXTURE pointing to the retained actual Core4 seed/probe"]
fn inconsistent_legacy_pending_intent_rolls_back_migration_instead_of_guessing_a_run() {
    let fixture = std::env::var_os("EXOMIND_SCHEMA4_FIXTURE").unwrap();
    let fixture = Path::new(&fixture);
    let expected: Value =
        serde_json::from_slice(&fs::read(fixture.join("expected.json")).unwrap()).unwrap();
    let owned = tempfile::tempdir().unwrap();
    let root = owned.path().join("inconsistent");
    copied_core(&fixture.join("core"), &root);
    let database = Connection::open(root.join("beta-core.sqlite3")).unwrap();
    database.execute("UPDATE timeblock_deadlines SET generation=generation+100 WHERE profile_id=?1 AND state='pending'",[expected["profile_id"].as_str().unwrap()]).unwrap();
    let old_deadlines = deadline_rows(&database);
    drop(database);
    assert!(matches!(
        Core::open(&root),
        Err(CoreError::RecoveryRequired)
    ));
    let database = Connection::open(root.join("beta-core.sqlite3")).unwrap();
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        4
    );
    assert_eq!(deadline_rows(&database), old_deadlines);
    let columns = database
        .prepare("PRAGMA table_info(timeblock_deadlines)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(!columns.iter().any(|name| name == "run_event_id"));
    assert_eq!(
        database
            .query_row::<u64, _, _>("SELECT count(*) FROM command_receipts", [], |r| r.get(0))
            .unwrap(),
        5
    );
}
