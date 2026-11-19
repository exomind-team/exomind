//! Synthetic retained Beta08/Core7 is produced by its old executable, never
//! downgraded from a newer Core. Only independent copies are opened; source
//! hashes must remain unchanged.
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
fn rows(db: &Connection, table: &str) -> Vec<Vec<Value>> {
    let mut q = db
        .prepare(&format!(
            "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
            table.replace('"', "\"\"")
        ))
        .unwrap();
    let count = q.column_count();
    q.query_map([], |r| {
        (0..count)
            .map(|n| r.get(n))
            .collect::<Result<Vec<Value>, _>>()
    })
    .unwrap()
    .collect::<Result<Vec<_>, _>>()
    .unwrap()
}
fn snapshot(db: &Connection) -> BTreeMap<String, Vec<Vec<Value>>> {
    let names = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|n| {
            let data = rows(db, &n);
            (n, data)
        })
        .collect()
}
fn hashes(root: &Path) -> BTreeMap<String, String> {
    fs::read_dir(root)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            assert!(e.file_type().unwrap().is_file() && !e.file_type().unwrap().is_symlink());
            (
                e.file_name().to_str().unwrap().to_string(),
                format!("{:x}", Sha256::digest(fs::read(e.path()).unwrap())),
            )
        })
        .collect()
}
fn copy_fixture(source: &Path) -> tempfile::TempDir {
    let target = tempfile::tempdir().unwrap();
    for entry in fs::read_dir(source).unwrap() {
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
            .any(|s| name == *s)
        );
        assert!(entry.file_type().unwrap().is_file() && !entry.file_type().unwrap().is_symlink());
        fs::copy(entry.path(), target.path().join(name)).unwrap();
    }
    target
}

#[test]
#[ignore = "explicit immutable synthetic Beta08/Core7 via EXOMIND_CORE_SCHEMA7_FIXTURE"]
fn beta08_core7_archive_upgrade_preserves_facts_receipts_and_reopen_identity() {
    let source = std::path::PathBuf::from(
        std::env::var_os("EXOMIND_CORE_SCHEMA7_FIXTURE")
            .expect("explicit immutable synthetic Beta08/Core7"),
    );
    assert!(source.is_absolute());
    let original_hashes = hashes(&source);
    let root = copy_fixture(&source);
    let path = root.path().join("beta-core.sqlite3");
    let old = readonly(&path);
    assert_eq!(
        old.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        7
    );
    let expected = snapshot(&old);
    for name in [
        "events",
        "origin_entries",
        "receive_cursors",
        "command_receipts",
        "original_chunks",
    ] {
        assert!(
            !expected[name].is_empty(),
            "retained fixture must contain {name}"
        );
    }
    drop(old);
    let core = Core::open(root.path()).unwrap();
    let db = readonly(core.database_path());
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        CORE_SCHEMA_VERSION
    );
    for (table, values) in &expected {
        assert_eq!(
            &rows(&db, table),
            values,
            "old values/rowids/BLOBs differ in {table}"
        );
    }
    for table in [
        "origin_provenance_keys",
        "origin_position_proofs",
        "verified_origin_prefixes",
    ] {
        assert!(rows(&db, table).is_empty());
    }
    assert!(
        db.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none()
    );
    for p in core.profiles().unwrap() {
        let reader = core.local_human(p.profile_id).unwrap();
        for item in core.origin_inventory(&reader, p.profile_id, 4096).unwrap() {
            if item.origin.device_id != core.device_id() {
                assert!(
                    core.verified_origin_state(&reader, &item.origin)
                        .unwrap()
                        .is_none()
                );
            }
        }
    }
    let mut retained_record = None;
    for profile in core.profiles().unwrap() {
        let context = core.local_human(profile.profile_id).unwrap();
        retained_record = core
            .events(&context, profile.profile_id)
            .unwrap()
            .into_iter()
            .find(|event| !event.tags.is_empty());
        if retained_record.is_some() {
            break;
        }
    }
    let retained_record = retained_record.expect("Beta08 fixture includes a tagged capture");
    let profile = retained_record.profile_id;
    let context = core.local_human(profile).unwrap();
    let tag = retained_record.tags[0].clone();
    assert!(
        core.events_page_with_tag(&context, profile, &EventQuery::default(), Some(&tag))
            .unwrap()
            .items
            .iter()
            .any(|event| event.event_id == retained_record.event_id)
    );
    let correction = RecordCorrectionCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: retained_record.occurred_at_ms.saturating_add(1),
        target_event_id: retained_record.event_id,
        target_digest: retained_record.digest.clone(),
        corrected_text: "synthetic post-upgrade correction".into(),
    };
    let correction_receipt = core.record_correction(&context, &correction).unwrap();
    let device_id = core.device_id();

    let backups = fs::read_dir(root.path().join("backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    assert!(
        backups[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("schema-7-")
    );
    let backup = readonly(&backups[0]);
    assert_eq!(
        backup
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        7
    );
    assert_eq!(snapshot(&backup), expected);
    drop(backup);
    drop(db);
    drop(core);
    let reopened = Core::open(root.path()).unwrap();
    assert_eq!(reopened.device_id(), device_id);
    let reopened_context = reopened.local_human(profile).unwrap();
    assert!(
        reopened
            .origin_checkpoint(&reopened_context, profile)
            .unwrap()
            .seq
            > 0
    );
    assert_eq!(
        reopened
            .receipt(&reopened_context, correction.command_id)
            .unwrap()
            .unwrap(),
        correction_receipt
    );
    let reopened_corrections = reopened
        .corrections_page(&reopened_context, profile, &EventQuery::default())
        .unwrap();
    assert!(reopened_corrections.items.iter().any(|item| {
        item.record.event_id == correction.event_id
            && item.target_state == CorrectionTargetState::DigestMatches
    }));
    drop(reopened);
    assert_eq!(
        fs::read_dir(root.path().join("backups")).unwrap().count(),
        1
    );
    assert_eq!(hashes(&source), original_hashes);

    // An older DB with a colliding object is not a partial new schema to repair.
    let damaged = copy_fixture(&source);
    let path = damaged.path().join("beta-core.sqlite3");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE origin_provenance_keys(untrusted TEXT)")
        .unwrap();
    let before = snapshot(&db);
    drop(db);
    assert!(matches!(
        Core::open(damaged.path()),
        Err(CoreError::RecoveryRequired)
    ));
    let db = readonly(&path);
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        7
    );
    assert_eq!(snapshot(&db), before);
    assert_eq!(hashes(&source), original_hashes);
}

#[test]
#[ignore = "explicit immutable synthetic Core8 provenance archive via EXOMIND_CORE_SCHEMA8_FIXTURE"]
fn core8_upgrade_preserves_receipts_origin_positions_and_verified_proofs() {
    let source = std::path::PathBuf::from(
        std::env::var_os("EXOMIND_CORE_SCHEMA8_FIXTURE")
            .expect("explicit immutable synthetic Core8 provenance archive"),
    );
    assert!(source.is_absolute());
    let original_hashes = hashes(&source);
    let root = copy_fixture(&source);
    let path = root.path().join("beta-core.sqlite3");
    let old = readonly(&path);
    assert_eq!(
        old.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        8
    );
    let expected = snapshot(&old);
    for name in [
        "events",
        "command_receipts",
        "origin_entries",
        "origin_position_proofs",
        "verified_origin_prefixes",
    ] {
        assert!(
            !expected[name].is_empty(),
            "synthetic Core8 fixture must exercise {name}"
        );
    }
    drop(old);

    let core = Core::open(root.path()).unwrap();
    let database = readonly(core.database_path());
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        CORE_SCHEMA_VERSION
    );
    for (table, values) in &expected {
        assert_eq!(
            &rows(&database, table),
            values,
            "Core8 values, rowids, receipts and proofs must remain byte-for-byte stable in {table}"
        );
    }
    let profile = core.profiles().unwrap()[0].profile_id;
    let context = core.local_human(profile).unwrap();
    let target = core
        .events(&context, profile)
        .unwrap()
        .into_iter()
        .find(|event| !event.tags.is_empty())
        .expect("synthetic Core8 fixture includes a tagged capture");
    assert!(
        core.events_page_with_tag(
            &context,
            profile,
            &EventQuery::default(),
            Some(&target.tags[0]),
        )
        .unwrap()
        .items
        .iter()
        .any(|event| event.event_id == target.event_id)
    );
    let correction = RecordCorrectionCommand {
        command_id: CommandId::new(),
        event_id: EventId::new(),
        profile_id: profile,
        occurred_at_ms: target.occurred_at_ms.saturating_add(1),
        target_event_id: target.event_id,
        target_digest: target.digest.clone(),
        corrected_text: "synthetic Core8 post-upgrade correction".into(),
    };
    let correction_receipt = core.record_correction(&context, &correction).unwrap();
    assert_eq!(
        serde_json::to_value(
            core.events(&context, profile)
                .unwrap()
                .into_iter()
                .find(|event| event.event_id == target.event_id)
                .unwrap()
        )
        .unwrap(),
        serde_json::to_value(&target).unwrap()
    );
    let device_id = core.device_id();
    assert!(
        database
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none()
    );
    let backup = fs::read_dir(root.path().join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backup.len(), 1);
    assert!(
        backup[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("schema-8-")
    );
    drop(database);
    drop(core);

    let reopened = Core::open(root.path()).unwrap();
    assert_eq!(reopened.device_id(), device_id);
    let context = reopened.local_human(profile).unwrap();
    assert_eq!(
        reopened.receipt(&context, correction.command_id).unwrap(),
        Some(correction_receipt)
    );
    assert!(
        reopened
            .corrections_page(&context, profile, &EventQuery::default())
            .unwrap()
            .items
            .iter()
            .any(|item| item.record.event_id == correction.event_id
                && item.target_state == CorrectionTargetState::DigestMatches)
    );
    drop(reopened);
    assert_eq!(
        fs::read_dir(root.path().join("backups")).unwrap().count(),
        1
    );
    assert_eq!(hashes(&source), original_hashes);
}

#[test]
fn damaged_current_proof_schema_is_rejected_without_recreation() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let p = core.create_profile("synthetic proof schema").unwrap();
    let path = core.database_path().to_path_buf();
    drop(core);
    let db = Connection::open(&path).unwrap();
    db.execute_batch("DROP TRIGGER origin_position_proof_no_update")
        .unwrap();
    let before = snapshot(&db);
    drop(db);
    assert!(matches!(
        Core::open(root.path()),
        Err(CoreError::RecoveryRequired)
    ));
    let db = readonly(&path);
    assert_eq!(snapshot(&db), before);
    assert_eq!(
        db.query_row::<u64, _, _>(
            "SELECT count(*) FROM profiles WHERE id=?1",
            [p.to_string()],
            |r| r.get(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row::<u64, _, _>(
            "SELECT count(*) FROM sqlite_schema WHERE name='origin_position_proof_no_update'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        0
    );
}

// Unlike the synthetic value-by-value test above, this streaming audit never
// prints record bodies, receipts, filenames or original bytes on failure.
// It can safely inspect a retained field diagnostic COPY through an explicit
// path; the original input files are hashed as files, never opened by SQLite.
fn table_audit(db: &Connection, table: &str) -> (u64, String) {
    use rusqlite::types::ValueRef;
    let mut statement = db
        .prepare(&format!(
            "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
            table.replace('"', "\"\"")
        ))
        .unwrap();
    let columns = statement.column_count();
    let mut rows = statement.query([]).unwrap();
    let mut hash = Sha256::new();
    let mut count = 0u64;
    while let Some(row) = rows.next().unwrap() {
        hash.update([0xff]);
        hash.update((columns as u64).to_le_bytes());
        for column in 0..columns {
            match row.get_ref(column).unwrap() {
                ValueRef::Null => hash.update([0]),
                ValueRef::Integer(value) => {
                    hash.update([1]);
                    hash.update(value.to_le_bytes());
                }
                ValueRef::Real(value) => {
                    hash.update([2]);
                    hash.update(value.to_bits().to_le_bytes());
                }
                ValueRef::Text(value) => {
                    hash.update([3]);
                    hash.update((value.len() as u64).to_le_bytes());
                    hash.update(value);
                }
                ValueRef::Blob(value) => {
                    hash.update([4]);
                    hash.update((value.len() as u64).to_le_bytes());
                    hash.update(value);
                }
            }
        }
        count += 1;
    }
    (count, format!("{:x}", hash.finalize()))
}
fn audited_tables(db: &Connection) -> BTreeMap<String, (u64, String)> {
    let names = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let audit = table_audit(db, &name);
            (name, audit)
        })
        .collect()
}

#[test]
#[ignore = "explicit retained diagnostic COPY via EXOMIND_CORE7_AUDIT_INPUT; output contains only counts/digests"]
fn retained_core7_diagnostic_copy_upgrade_preserves_all_rows_without_content_output() {
    use std::io::Read;
    let source = std::path::PathBuf::from(
        std::env::var_os("EXOMIND_CORE7_AUDIT_INPUT")
            .expect("explicit retained diagnostic copy directory"),
    );
    assert!(source.is_absolute());
    let inputs = [
        "beta-core.sqlite3",
        "beta-core.sqlite3-wal",
        "beta-core.sqlite3-shm",
        "beta-core.sqlite3-journal",
    ];
    let input_hashes = || {
        let mut result = BTreeMap::new();
        for name in inputs {
            let path = source.join(name);
            if !path.exists() {
                continue;
            }
            assert!(fs::symlink_metadata(&path).unwrap().file_type().is_file());
            let mut file = fs::File::open(path).unwrap();
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = file.read(&mut buffer).unwrap();
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            result.insert(name, format!("{:x}", hash.finalize()));
        }
        assert!(result.contains_key("beta-core.sqlite3"));
        result
    };
    let before_files = input_hashes();
    let root = tempfile::tempdir().unwrap();
    for name in before_files.keys() {
        fs::copy(source.join(name), root.path().join(name)).unwrap();
    }
    let path = root.path().join("beta-core.sqlite3");
    let old = readonly(&path);
    assert_eq!(
        old.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        7
    );
    let expected = audited_tables(&old);
    drop(old);
    println!(
        "retained Core7 copy audited; {} tables, {} events; beginning protected migration",
        expected.len(),
        expected["events"].0
    );
    let started = std::time::Instant::now();
    let core = Core::open(root.path()).unwrap();
    let migration_ms = started.elapsed().as_millis();
    let db = readonly(core.database_path());
    assert_eq!(
        db.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        CORE_SCHEMA_VERSION
    );
    for (table, expected) in &expected {
        assert_eq!(
            &table_audit(&db, table),
            expected,
            "old table count/digest differs: {table}"
        );
    }
    let backups = fs::read_dir(root.path().join("backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let backup = readonly(&backups[0]);
    assert_eq!(
        backup
            .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        7
    );
    assert_eq!(audited_tables(&backup), expected);
    drop(backup);
    for profile in core.profiles().unwrap() {
        let reader = core.local_human(profile.profile_id).unwrap();
        core.origin_inventory(&reader, profile.profile_id, 4096)
            .unwrap();
    }
    drop(db);
    drop(core);
    drop(Core::open(root.path()).unwrap());
    assert_eq!(
        input_hashes(),
        before_files,
        "retained diagnostic input must remain untouched"
    );
    println!(
        "Core7->{} migration {}ms; all old tables/backup/input digests retained; no live device or Host credentials opened",
        CORE_SCHEMA_VERSION, migration_ms
    );
}
