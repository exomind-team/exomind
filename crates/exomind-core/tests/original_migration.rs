use exomind_core::{CaptureCommand, CommandId, Core, EventId, ProfileId};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::path::Path;

// Exact schema-1 shape and canonical bytes, independent of the new initializer.
fn schema_one(root: &Path) -> (Connection, ProfileId, CaptureCommand) {
    std::fs::create_dir_all(root).unwrap();
    let database = Connection::open(root.join("beta-core.sqlite3")).unwrap();
    let initialized: bool = database
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='identity')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    if !initialized {
        database.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA application_id=1163415350; PRAGMA user_version=1; CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),device_id TEXT NOT NULL,human_author TEXT NOT NULL); CREATE TABLE profiles(id TEXT PRIMARY KEY,display_name TEXT NOT NULL); CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE command_receipts(command_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),input_digest TEXT NOT NULL,receipt TEXT NOT NULL); CREATE INDEX events_profile_sequence ON events(profile_id,local_seq);").unwrap();
    }
    let profile = ProfileId::new();
    let event = EventId::new();
    let command = CommandId::new();
    let (device, human) = if initialized {
        let values: (String, String) = database
            .query_row("SELECT device_id,human_author FROM identity", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        (
            values.0.parse::<uuid::Uuid>().unwrap(),
            values.1.parse::<uuid::Uuid>().unwrap(),
        )
    } else {
        (uuid::Uuid::new_v4(), uuid::Uuid::new_v4())
    };
    if !initialized {
        database
            .execute(
                "INSERT INTO identity VALUES(1,?1,?2)",
                params![device.to_string(), human.to_string()],
            )
            .unwrap();
    }
    database
        .execute(
            "INSERT INTO profiles VALUES(?1,'legacy')",
            [profile.to_string()],
        )
        .unwrap();
    let canonical = format!(
        r#"{{"kind":"capture/1","profile":"{profile}","event":"{event}","device":"{device}","author":"{human}","author_kind":"human","occurred_at_ms":123,"text":"legacy","tags":[]}}"#
    );
    let digest = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    let body = serde_json::json!({"event_id":event,"profile_id":profile,"device_id":device,"author_id":human,"author_kind":"human","occurred_at_ms":123,"text":"legacy","tags":[],"digest":digest,"local_seq":0});
    database
        .execute(
            "INSERT INTO events(event_id,profile_id,digest,body) VALUES(?1,?2,?3,?4)",
            params![
                event.to_string(),
                profile.to_string(),
                digest,
                body.to_string()
            ],
        )
        .unwrap();
    let receipt = serde_json::json!({"command_id":command,"event_id":event,"profile_id":profile,"local_seq":1,"event_digest":digest,"durability":"local_committed","replayed":false});
    database
        .execute(
            "INSERT INTO command_receipts VALUES(?1,?2,?3,?4)",
            params![
                command.to_string(),
                profile.to_string(),
                digest,
                receipt.to_string()
            ],
        )
        .unwrap();
    (
        database,
        profile,
        CaptureCommand {
            command_id: command,
            event_id: event,
            profile_id: profile,
            occurred_at_ms: 123,
            text: "legacy".into(),
            tags: vec![],
            originals: vec![],
        },
    )
}

struct OwnedProcess(std::process::Child);
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[test]
#[ignore = "requires EXOMIND_SCHEMA1_CLI pointing to the retained actual schema-1 binary"]
fn actual_schema_one_cli_rejects_an_upgraded_root_without_rewriting_core_or_backups() {
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let executable = std::env::var_os("EXOMIND_SCHEMA1_CLI")
        .expect("set the explicit schema-1 CLI fixture path");
    let digest = format!("{:x}", Sha256::digest(std::fs::read(&executable).unwrap()));
    assert_eq!(
        digest,
        "fbdc7b643c80301f0a99d612919ec73d7e2261e638dc8de2584adf9bba7e1d8a"
    );
    let directory = tempfile::tempdir().unwrap();
    let host_root = directory.path().join("host");
    let spawn = || {
        OwnedProcess(
            Command::new(&executable)
                .arg("--data-dir")
                .arg(&host_root)
                .args(["--port", "0"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    };
    {
        let mut old = spawn();
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if old.0.try_wait().unwrap().is_some() {
                panic!("old CLI failed to initialize its own fresh root");
            }
            if let Ok(bytes) = std::fs::read(host_root.join("connection.beta.json")) {
                if serde_json::from_slice::<serde_json::Value>(&bytes)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("url")
                            .and_then(|url| url.as_str())
                            .map(str::to_owned)
                    })
                    .is_some()
                {
                    break;
                }
            }
            assert!(Instant::now() < deadline, "old CLI startup timed out");
            std::thread::sleep(Duration::from_millis(10));
        }
        old.0.kill().unwrap();
        old.0.wait().unwrap();
    }
    let root = host_root.join("core");
    let (live, profile, command) = schema_one(&root);
    let core = Core::open(&root).unwrap();
    assert!(
        core.submit(&core.local_human(profile).unwrap(), &command)
            .unwrap()
            .replayed
    );
    drop(core);
    drop(live);
    let core_before = std::fs::read(root.join("beta-core.sqlite3")).unwrap();
    let backups: Vec<_> = std::fs::read_dir(root.join("backups"))
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let bytes = std::fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    let mut old = spawn();
    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        if let Some(status) = old.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "old CLI unexpectedly kept running against schema 2"
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(!status.success());
    assert!(std::fs::read(root.join("beta-core.sqlite3")).unwrap() == core_before);
    for (path, before) in backups {
        assert!(std::fs::read(path).unwrap() == before);
    }
}

#[test]
fn schema_one_wal_is_backed_up_before_upgrade_and_old_command_digest_stays_replayable() {
    let root = tempfile::tempdir().unwrap();
    let (live, profile, command) = schema_one(root.path());
    assert!(
        std::fs::metadata(root.path().join("beta-core.sqlite3-wal"))
            .unwrap()
            .len()
            > 0
    );
    let original_receipt: String = live
        .query_row("SELECT receipt FROM command_receipts", [], |row| row.get(0))
        .unwrap();
    let core = Core::open(root.path()).unwrap();
    let context = core.local_human(profile).unwrap();
    let receipt = core.submit(&context, &command).unwrap();
    assert!(receipt.replayed);
    assert!(
        core.events(&context, profile).unwrap()[0]
            .originals
            .is_empty()
    );
    let schema: i64 = live
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(schema, 3);
    let paths: Vec<_> = std::fs::read_dir(root.path().join("backups"))
        .unwrap()
        .map(|item| item.unwrap().path())
        .collect();
    assert_eq!(paths.len(), 1);
    let backup =
        Connection::open_with_flags(&paths[0], rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let version: i64 = backup
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 1);
    let check: String = backup
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(check, "ok");
    let backed_receipt: String = backup
        .query_row("SELECT receipt FROM command_receipts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(backed_receipt, original_receipt);
    let stored_receipt: String = live
        .query_row("SELECT receipt FROM command_receipts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stored_receipt, original_receipt);
    let expected_events = serde_json::to_value(core.events(&context, profile).unwrap()).unwrap();
    let expected_profiles = core.profiles().unwrap();
    let expected_device = core.device_id();
    let restored = tempfile::tempdir().unwrap();
    // Copy exactly the single backup DB; do not copy any -wal or -shm files.
    std::fs::copy(&paths[0], restored.path().join("beta-core.sqlite3")).unwrap();
    drop(backup);
    drop(core);
    drop(live);
    let recovered = Core::open(restored.path()).unwrap();
    assert_eq!(recovered.device_id(), expected_device);
    assert_eq!(recovered.profiles().unwrap(), expected_profiles);
    let recovered_context = recovered.local_human(profile).unwrap();
    assert_eq!(
        serde_json::to_value(recovered.events(&recovered_context, profile).unwrap()).unwrap(),
        expected_events
    );
    assert_eq!(
        recovered.submit(&recovered_context, &command).unwrap(),
        receipt
    );
    let recovered_db = Connection::open_with_flags(
        recovered.database_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let recovered_receipt: String = recovered_db
        .query_row("SELECT receipt FROM command_receipts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(recovered_receipt, original_receipt);
    drop(recovered_db);
    drop(recovered);
    Core::open(root.path()).unwrap();
    assert_eq!(
        std::fs::read_dir(root.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn unusable_backup_location_prevents_migration_without_touching_the_schema_one_facts() {
    let root = tempfile::tempdir().unwrap();
    let (database, _, _) = schema_one(root.path());
    std::fs::write(root.path().join("backups"), b"not a directory").unwrap();
    let before: String = database
        .query_row("SELECT receipt FROM command_receipts", [], |row| row.get(0))
        .unwrap();
    assert!(Core::open(root.path()).is_err());
    let version: i64 = database
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 1);
    let after: String = database
        .query_row("SELECT receipt FROM command_receipts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(before, after);
}

#[test]
fn recovery_guard_refuses_a_missing_or_blank_main_database_when_a_migration_backup_exists() {
    for blank in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let (database, _, _) = schema_one(root.path());
        let core = Core::open(root.path()).unwrap();
        drop(core);
        drop(database);
        let main = root.path().join("beta-core.sqlite3");
        let backup = std::fs::read_dir(root.path().join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let preserved = std::fs::read(&backup).unwrap();
        if blank {
            std::fs::write(&main, []).unwrap();
        } else {
            std::fs::remove_file(&main).unwrap();
        }
        assert!(
            Core::open(root.path()).is_err(),
            "an existing backup must not become a new empty identity"
        );
        assert_eq!(std::fs::read(&backup).unwrap(), preserved);
        if blank {
            assert_eq!(std::fs::metadata(main).unwrap().len(), 0);
        } else {
            assert!(!main.exists());
        }
    }
}

#[test]
fn recovery_guard_refuses_orphan_sidecars_without_creating_a_main_database() {
    for suffix in ["-wal", "-shm", "-journal"] {
        let root = tempfile::tempdir().unwrap();
        let sidecar = root.path().join(format!("beta-core.sqlite3{suffix}"));
        std::fs::write(&sidecar, []).unwrap();
        assert!(
            Core::open(root.path()).is_err(),
            "orphan sidecars are recovery evidence"
        );
        assert!(!root.path().join("beta-core.sqlite3").exists());
        assert!(sidecar.exists());
    }
}

#[test]
fn recovery_guard_distinguishes_a_fresh_empty_root_from_an_existing_blank_database() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let device = core.device_id();
    drop(core);
    assert_eq!(Core::open(root.path()).unwrap().device_id(), device);
    let blank = tempfile::tempdir().unwrap();
    let path = blank.path().join("beta-core.sqlite3");
    std::fs::write(&path, []).unwrap();
    assert!(
        Core::open(blank.path()).is_err(),
        "an interrupted blank database requires explicit recovery"
    );
    assert_eq!(std::fs::metadata(path).unwrap().len(), 0);
}

#[test]
fn recovery_guard_rejects_the_unreleased_schema_two_layout_without_resetting_facts() {
    let root = tempfile::tempdir().unwrap();
    let core = Core::open(root.path()).unwrap();
    let profile = core.create_profile("preserved layout fixture").unwrap();
    let device = core.device_id();
    drop(core);
    let database = Connection::open(root.path().join("beta-core.sqlite3")).unwrap();
    database.execute_batch("DROP TABLE core_layout").unwrap();
    drop(database);
    assert!(Core::open(root.path()).is_err());
    let database = Connection::open_with_flags(
        root.path().join("beta-core.sqlite3"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let stored: String = database
        .query_row(
            "SELECT device_id FROM identity WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, device.to_string());
    let name: String = database
        .query_row(
            "SELECT display_name FROM profiles WHERE id=?1",
            [profile.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(name, "preserved layout fixture");
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        3
    );
}

#[test]
fn recovery_guard_bound_identity_is_checked_before_schema_one_migration() {
    let root = tempfile::tempdir().unwrap();
    let (database, _, _) = schema_one(root.path());
    let before: String = database
        .query_row(
            "SELECT device_id FROM identity WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(Core::open_bound(root.path(), exomind_core::DeviceId::new()).is_err());
    assert_eq!(
        database
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        1
    );
    assert!(!root.path().join("backups").exists());
    let after: String = database
        .query_row(
            "SELECT device_id FROM identity WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
}
