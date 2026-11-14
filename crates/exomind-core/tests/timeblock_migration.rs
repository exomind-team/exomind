use exomind_core::{
    CommandId, Core, Durability, EventId, OriginalId, OriginalRef, ProfileId, Receipt, StageId,
};
use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[test]
#[ignore = "requires EXOMIND_SCHEMA2_CLI pointing to the retained actual schema-2 binary"]
fn actual_schema_two_cli_refuses_schema_three_without_rewriting_main_or_backups() {
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
    let executable = std::env::var_os("EXOMIND_SCHEMA2_CLI")
        .expect("set the retained actual schema-2 executable");
    assert_eq!(
        format!("{:x}", Sha256::digest(std::fs::read(&executable).unwrap())),
        "af65cf00c226545451aedb6d88771df2143cbd8435535924122c34908d8f16af"
    );
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let launch = || {
        Owned(
            Command::new(&executable)
                .arg("--data-dir")
                .arg(&root)
                .args(["--port", "0"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    };
    let mut old = launch();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        assert!(
            old.0.try_wait().unwrap().is_none(),
            "old fixture exited before its own startup"
        );
        if std::fs::read(root.join("connection.beta.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .is_some_and(|value| value["url"].is_string())
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "owned old fixture startup exceeded its deadline"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    old.0.kill().unwrap();
    old.0.wait().unwrap();
    drop(old);
    let core_root = root.join("core");
    let core = Core::open(&core_root).unwrap();
    drop(core);
    let main = core_root.join("beta-core.sqlite3");
    let before = std::fs::read(&main).unwrap();
    let backup: Vec<_> = std::fs::read_dir(core_root.join("backups"))
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let bytes = std::fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    assert_eq!(backup.len(), 1);
    let mut old = launch();
    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        if let Some(status) = old.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < deadline,
            "old schema-2 fixture kept running against schema 3"
        );
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(!status.success());
    assert!(std::fs::read(main).unwrap() == before);
    for (path, bytes) in backup {
        assert!(std::fs::read(path).unwrap() == bytes);
    }
}

#[derive(Serialize)]
struct SchemaTwoFact<'a> {
    kind: &'static str,
    profile: ProfileId,
    event: EventId,
    device: Uuid,
    author: Uuid,
    author_kind: &'static str,
    occurred_at_ms: i64,
    text: &'static str,
    tags: &'a [String],
    originals: &'a [OriginalRef],
}

#[test]
fn schema_two_to_three_backup_restores_original_bytes_references_identity_and_receipt_from_one_file()
 {
    let root = tempfile::tempdir().unwrap();
    let main = root.path().join("beta-core.sqlite3");
    let database = Connection::open(&main).unwrap();
    database
        .execute_batch(include_str!("fixtures/schema2-fixed-block.sql"))
        .unwrap();
    database.pragma_update(None, "journal_mode", "WAL").unwrap();
    database
        .pragma_update(None, "wal_autocheckpoint", 0)
        .unwrap();
    let device = Uuid::new_v4();
    let human = Uuid::new_v4();
    let profile = ProfileId::new();
    let command = CommandId::new();
    let event = EventId::new();
    let stage = StageId::new();
    let bytes = b"schema-two exact original\x00\xff";
    let original = OriginalRef {
        original_id: OriginalId::new(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len() as u64,
        file_name: "retained.bin".into(),
        media_type: "application/octet-stream".into(),
    };
    database
        .execute(
            "INSERT INTO identity VALUES(1,?1,?2)",
            params![device.to_string(), human.to_string()],
        )
        .unwrap();
    database
        .execute(
            "INSERT INTO profiles VALUES(?1,'schema-two profile')",
            [profile.to_string()],
        )
        .unwrap();
    database
        .execute(
            "INSERT INTO original_stages VALUES(?1,?2,?3,?4,'human',?5,?6,?7,?8,0,1,'uploading')",
            params![
                stage.to_string(),
                original.original_id.to_string(),
                profile.to_string(),
                human.to_string(),
                original.sha256,
                original.byte_length,
                original.file_name,
                original.media_type
            ],
        )
        .unwrap();
    database
        .execute(
            "INSERT INTO original_chunks VALUES(?1,0,?2,?3)",
            params![stage.to_string(), bytes.as_slice(), original.sha256],
        )
        .unwrap();
    database.execute("UPDATE original_stages SET next_offset=?2,generation=2,state='verified' WHERE stage_id=?1",params![stage.to_string(),bytes.len()]).unwrap();
    let fact = SchemaTwoFact {
        kind: "capture/2",
        profile,
        event,
        device,
        author: human,
        author_kind: "human",
        occurred_at_ms: 123,
        text: "schema-two text",
        tags: &[],
        originals: std::slice::from_ref(&original),
    };
    let digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&fact).unwrap()));
    let body = serde_json::json!({"event_id":event,"profile_id":profile,"device_id":device,"author_id":human,"author_kind":"human","occurred_at_ms":123,"text":"schema-two text","tags":[],"originals":[original.clone()],"digest":digest,"local_seq":0});
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
    database
        .execute(
            "INSERT INTO event_originals VALUES(?1,0,?2)",
            params![event.to_string(), original.original_id.to_string()],
        )
        .unwrap();
    let receipt = Receipt {
        command_id: command,
        event_id: event,
        profile_id: profile,
        local_seq: 1,
        event_digest: digest,
        durability: Durability::LocalCommitted,
        replayed: false,
    };
    let raw_receipt = serde_json::to_string(&receipt).unwrap();
    database
        .execute(
            "INSERT INTO command_receipts VALUES(?1,?2,?3,?4)",
            params![
                command.to_string(),
                profile.to_string(),
                receipt.event_digest,
                raw_receipt
            ],
        )
        .unwrap();
    // Keep this source connection alive: data in its WAL is part of the snapshot.
    assert!(
        std::fs::metadata(root.path().join("beta-core.sqlite3-wal"))
            .unwrap()
            .len()
            > 0
    );
    let core = Core::open(root.path()).unwrap();
    let version: i64 = database
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(
        version, 3,
        "timeblock typed facts require an explicit schema migration"
    );
    let context = core.local_human(profile).unwrap();
    assert_eq!(core.device_id().to_string(), device.to_string());
    assert_eq!(core.receipt(&context, command).unwrap().unwrap(), receipt);
    assert!(
        core.read_original_range(&context, profile, original.original_id, 0, bytes.len())
            .unwrap()
            .bytes
            == bytes
    );
    let paths: Vec<_> = std::fs::read_dir(root.path().join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(paths.len(), 1);
    assert!(
        paths[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("schema-2-")
    );
    let backup =
        Connection::open_with_flags(&paths[0], rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        backup
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        2
    );
    assert_eq!(
        backup
            .pragma_query_value::<String, _>(None, "journal_mode", |row| row.get(0))
            .unwrap(),
        "delete"
    );
    assert_eq!(
        backup
            .query_row::<String, _, _>("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap(),
        "ok"
    );
    let backed_bytes: Vec<u8> = backup
        .query_row(
            "SELECT bytes FROM original_chunks WHERE stage_id=?1",
            [stage.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert!(backed_bytes == bytes);
    let backed_receipt: String = backup
        .query_row(
            "SELECT receipt FROM command_receipts WHERE command_id=?1",
            [command.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(backed_receipt, raw_receipt);
    let restore = tempfile::tempdir().unwrap();
    std::fs::copy(&paths[0], restore.path().join("beta-core.sqlite3")).unwrap();
    drop(backup);
    drop(core);
    drop(database);
    let restored = Core::open(restore.path()).unwrap();
    let context = restored.local_human(profile).unwrap();
    assert_eq!(restored.device_id().to_string(), device.to_string());
    assert_eq!(
        restored.receipt(&context, command).unwrap().unwrap(),
        receipt
    );
    let facts = restored.events(&context, profile).unwrap();
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].originals, vec![original.clone()]);
    assert_eq!(facts[0].text, "schema-two text");
    assert!(
        restored
            .read_original_range(&context, profile, original.original_id, 0, bytes.len())
            .unwrap()
            .bytes
            == bytes
    );
}
