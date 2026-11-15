use exomind_core::{CaptureCommand, CommandId, Core, EventQuery, OriginalId, ProfileId};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::path::Path;

#[test]
fn actual_new_database_separates_manifest_reference_schema_from_local_materialization() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let db = Connection::open(core.database_path()).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(
        version, exomind_core::CORE_SCHEMA_VERSION,
        "metadata-first replication requires an actual migration, not an advertised constant"
    );
    let targets = db
        .prepare("PRAGMA foreign_key_list(event_originals)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(2))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(targets.iter().any(|table| table == "original_manifests"));
    assert!(!targets.iter().any(|table| table == "original_stages"));
}
fn copy_seed(owned: &Path, from: &Path, to: &Path) {
    assert!(
        !to.exists(),
        "copy never overwrites a retained or existing root"
    );
    assert!(
        to.parent()
            .unwrap()
            .canonicalize()
            .unwrap()
            .starts_with(owned.canonicalize().unwrap())
    );
    std::fs::create_dir_all(to).unwrap();
    assert_ne!(from.canonicalize().unwrap(), to.canonicalize().unwrap());
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        assert!(!entry.file_type().unwrap().is_symlink());
        if entry.file_type().unwrap().is_dir() {
            copy_seed(owned, &entry.path(), &to.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }
}
struct Probe {
    success: bool,
    stdout: String,
    stderr: String,
}
fn assert_legacy_timer(core: &Core, expected: &serde_json::Value) {
    let profile = expected["profile_id"].as_str().unwrap().parse().unwrap();
    let node = &expected["timeblock_nodes"]["items"][0];
    let stamp = core
        .trusted_clock_stamp(
            node["clock"]["epoch_id"].as_str().unwrap().parse().unwrap(),
            node["occurred_at_ms"].as_i64().unwrap(),
            node["clock"]["elapsed_ms"].as_u64().unwrap(),
        )
        .unwrap();
    let snapshot = core
        .timeblock_snapshot(&core.local_human(profile).unwrap(), profile, &stamp)
        .unwrap();
    assert!(
        snapshot
            .active
            .as_ref()
            .unwrap()
            .deadline
            .as_ref()
            .unwrap()
            .eligible
    );
    assert_eq!(
        serde_json::to_value(snapshot).unwrap(),
        expected["timeblock_snapshot"]
    );
}
fn probe(executable: &Path, root: &Path) -> Probe {
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
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
    let stdout = logs.path().join("stdout.log");
    let stderr = logs.path().join("stderr.log");
    let mut child = Owned(
        Command::new(executable)
            .arg("probe")
            .arg("--data-dir")
            .arg(root)
            .stdout(Stdio::from(std::fs::File::create(&stdout).unwrap()))
            .stderr(Stdio::from(std::fs::File::create(&stderr).unwrap()))
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            let read = |path: &Path| {
                use std::io::Read;
                let mut bytes = vec![];
                std::fs::File::open(path)
                    .unwrap()
                    .take(65537)
                    .read_to_end(&mut bytes)
                    .unwrap();
                assert!(bytes.len() <= 65536, "legacy probe output bounded");
                String::from_utf8(bytes).unwrap()
            };
            return Probe {
                success: status.success(),
                stdout: read(&stdout),
                stderr: read(&stderr),
            };
        }
        assert!(
            Instant::now() < deadline,
            "owned legacy Core probe deadline"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
#[ignore = "requires EXOMIND_SCHEMA3_FIXTURE pointing to the retained actual Core3 seed/probe directory"]
fn actual_schema_three_seed_migrates_all_bytes_facts_and_receipts_and_old_binary_refuses_current() {
    let fixture =
        std::env::var_os("EXOMIND_SCHEMA3_FIXTURE").expect("retained schema3 fixture required");
    let fixture = Path::new(&fixture);
    let executable = fixture.join("exomind-core-schema3.exe");
    let provenance: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture.join("provenance.json")).unwrap()).unwrap();
    assert_eq!(
        format!("{:x}", Sha256::digest(std::fs::read(&executable).unwrap())),
        provenance["binary_sha256"].as_str().unwrap()
    );
    let expected: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture.join("expected.json")).unwrap()).unwrap();
    assert_eq!(provenance["schema"], 3);
    assert_eq!(expected["actual_schema"], 3);
    assert_eq!(expected["fixture_protocol"], "exomind-core3-retained/1");
    assert_eq!(provenance["base_git_commit"], expected["base_git_commit"]);
    assert_eq!(
        provenance["core_source"]["sha256"],
        expected["core_source_sha256"]
    );
    let bytes = std::fs::read(fixture.join("original.bin")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("core");
    copy_seed(directory.path(), &fixture.join("core"), &root);
    let old = probe(&executable, &root);
    assert!(old.success, "{}", old.stderr);
    let result: serde_json::Value = serde_json::from_str(old.stdout.trim()).unwrap();
    assert_eq!(result["opened_schema"], 3);
    let live = Connection::open(root.join("beta-core.sqlite3")).unwrap();
    assert_eq!(
        live.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        3
    );
    live.pragma_update(None, "journal_mode", "WAL").unwrap();
    live.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
    let profile: ProfileId = expected["profile_id"].as_str().unwrap().parse().unwrap();
    let empty_profile = ProfileId::new();
    live.execute(
        "INSERT INTO profiles VALUES(?1,'empty retained schema3 profile')",
        [empty_profile.to_string()],
    )
    .unwrap();
    live.execute(
        "UPDATE profiles SET display_name=display_name || ' • live WAL' WHERE id=?1",
        [profile.to_string()],
    )
    .unwrap();
    let wal = root.join("beta-core.sqlite3-wal");
    assert!(std::fs::metadata(&wal).unwrap().len() > 0);
    let core = Core::open(&root).unwrap();
    assert_legacy_timer(&core, &expected);
    let human = core.local_human(profile).unwrap();
    let empty_context = core.local_human(empty_profile).unwrap();
    let empty_identity = core
        .replication_identity(&empty_context, empty_profile)
        .unwrap();
    assert_eq!(
        core.origin_checkpoint(&empty_context, empty_profile)
            .unwrap()
            .seq,
        0
    );
    assert_eq!(
        core.device_id().to_string(),
        expected["device_id"].as_str().unwrap()
    );
    assert!(
        core.profiles()
            .unwrap()
            .iter()
            .find(|p| p.profile_id == profile)
            .unwrap()
            .display_name
            .ends_with(" • live WAL")
    );
    assert_eq!(
        serde_json::to_value(core.events(&human, profile).unwrap()).unwrap(),
        expected["events"]
    );
    assert_eq!(
        serde_json::to_value(
            core.timeblock_nodes(&human, profile, &EventQuery::default())
                .unwrap()
        )
        .unwrap(),
        expected["timeblock_nodes"]
    );
    for field in ["capture_receipt", "timeblock_receipt"] {
        let id: CommandId = expected[field]["command_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            serde_json::to_value(core.receipt(&human, id).unwrap().unwrap()).unwrap(),
            expected[field]
        );
    }
    let original: OriginalId = expected["original"]["original_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let mut actual = vec![];
    for offset in (0..bytes.len()).step_by(256 * 1024) {
        actual.extend(
            core.read_original_range(
                &human,
                profile,
                original,
                offset as u64,
                (bytes.len() - offset).min(256 * 1024),
            )
            .unwrap()
            .bytes,
        );
    }
    assert_eq!(actual, bytes);
    let command: CaptureCommand =
        serde_json::from_value(expected["capture_command"].clone()).unwrap();
    assert!(core.submit(&human, &command).unwrap().replayed);
    let stored = live
        .prepare("SELECT command_id,input_digest,receipt FROM command_receipts ORDER BY command_id")
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        serde_json::to_value(stored).unwrap(),
        expected["stored_receipts"]
    );
    let backups: Vec<_> = std::fs::read_dir(root.join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sqlite3"))
        .collect();
    assert_eq!(backups.len(), 1);
    assert!(
        backups[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("schema-3-")
    );
    let backup =
        Connection::open_with_flags(&backups[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        backup
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        3
    );
    assert!(
        backup
            .query_row(
                "SELECT display_name FROM profiles WHERE id=?1",
                [profile.to_string()],
                |row| row.get::<_, String>(0)
            )
            .unwrap()
            .ends_with(" • live WAL")
    );
    drop(backup);
    let restored = tempfile::tempdir().unwrap();
    std::fs::copy(&backups[0], restored.path().join("beta-core.sqlite3")).unwrap();
    assert!(
        probe(&executable, restored.path()).success,
        "one backup file must restore without WAL/SHM"
    );
    drop(core);
    drop(live);
    let before = std::fs::read(root.join("beta-core.sqlite3")).unwrap();
    let retained = std::fs::read(&backups[0]).unwrap();
    let rejected = probe(&executable, &root);
    assert!(!rejected.success);
    assert_eq!(
        rejected.stderr.trim(),
        "legacy-core3-fixture: data root contains foreign files",
        "Core3 rejects the new schema-3 backup name before opening the main database"
    );
    assert_eq!(
        std::fs::read(root.join("beta-core.sqlite3")).unwrap(),
        before
    );
    assert_eq!(std::fs::read(&backups[0]).unwrap(), retained);
    // Preserve the actual upgraded root and its backup. A separate owned copy
    // without the new backup name exercises the old binary's version guard.
    let version_probe_root = tempfile::tempdir().unwrap();
    let version_probe_db = version_probe_root.path().join("beta-core.sqlite3");
    assert!(!version_probe_db.exists());
    std::fs::copy(root.join("beta-core.sqlite3"), &version_probe_db).unwrap();
    let version_rejected = probe(&executable, version_probe_root.path());
    assert!(!version_rejected.success);
    assert_eq!(
        version_rejected.stderr.trim(),
        format!("legacy-core3-fixture: unsupported core schema version {}",exomind_core::CORE_SCHEMA_VERSION)
    );
    assert_eq!(std::fs::read(&version_probe_db).unwrap(), before);
    let reopened = Core::open(&root).unwrap();
    assert_legacy_timer(&reopened, &expected);
    let human = reopened.local_human(profile).unwrap();
    assert_eq!(
        reopened
            .replication_identity(&reopened.local_human(empty_profile).unwrap(), empty_profile)
            .unwrap(),
        empty_identity
    );
    assert_eq!(
        serde_json::to_value(reopened.events(&human, profile).unwrap()).unwrap(),
        expected["events"]
    );
    assert_eq!(
        serde_json::to_value(
            reopened
                .timeblock_nodes(&human, profile, &EventQuery::default())
                .unwrap()
        )
        .unwrap(),
        expected["timeblock_nodes"]
    );
    for field in ["capture_receipt", "timeblock_receipt"] {
        let id = expected[field]["command_id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            serde_json::to_value(reopened.receipt(&human, id).unwrap().unwrap()).unwrap(),
            expected[field]
        );
    }
    let mut hash = Sha256::new();
    for offset in (0..bytes.len()).step_by(256 * 1024) {
        hash.update(
            reopened
                .read_original_range(
                    &human,
                    profile,
                    original,
                    offset as u64,
                    (bytes.len() - offset).min(256 * 1024),
                )
                .unwrap()
                .bytes,
        );
    }
    assert_eq!(
        format!("{:x}", hash.finalize()),
        format!("{:x}", Sha256::digest(&bytes))
    );
}
