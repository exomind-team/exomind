use exomind_beta_host::{
    BetaHost, GrantKind, GrantRequest, HostError, LocalSourceBegin, LocalSourceState,
};
use exomind_core::{EventQuery, ProfileId};
use sha2::{Digest, Sha256};

const CHUNK: usize = 256 * 1024;
fn fixture() -> (
    tempfile::TempDir,
    BetaHost,
    exomind_beta_host::Session,
    ProfileId,
    String,
) {
    let directory = tempfile::tempdir().unwrap();
    let host = BetaHost::open(&directory.path().join("host")).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic sources")
        .unwrap();
    let key = serde_json::to_string(&[
        host.status().unwrap().device_id.to_string(),
        profile.to_string(),
        uuid::Uuid::new_v4().to_string(),
    ])
    .unwrap();
    (directory, host, owner, profile, key)
}
fn command(key: &str, bytes: &[u8]) -> LocalSourceBegin {
    LocalSourceBegin {
        key: key.into(),
        byte_length: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}

#[test]
fn source_chunks_restart_exactly_and_never_create_business_facts() {
    let (directory, host, owner, profile, key) = fixture();
    let bytes: Vec<u8> = (0..CHUNK + 137).map(|i| (i % 256) as u8).collect();
    let input = command(&key, &bytes);
    let first = host.begin_local_source(&owner, &input).unwrap();
    assert_eq!(first.state, LocalSourceState::Copying);
    host.write_local_source_chunk(&owner, &key, 0, &bytes[..CHUNK])
        .unwrap();
    assert_eq!(
        host.write_local_source_chunk(&owner, &key, 0, &bytes[..CHUNK])
            .unwrap()
            .next_offset,
        CHUNK as u64
    );
    assert!(matches!(
        host.finish_local_source(&owner, &key),
        Err(HostError::LocalSourceIncomplete)
    ));
    host.stop().unwrap();
    let host = BetaHost::open(&directory.path().join("host")).unwrap();
    let owner = host.owner_session().unwrap();
    assert_eq!(
        host.local_source_status(&owner, &key)
            .unwrap()
            .unwrap()
            .next_offset,
        CHUNK as u64
    );
    host.write_local_source_chunk(&owner, &key, CHUNK as u64, &bytes[CHUNK..])
        .unwrap();
    let ready = host.finish_local_source(&owner, &key).unwrap();
    assert_eq!(ready.state, LocalSourceState::Ready);
    assert!(
        host.read_local_source_range(&owner, &key, CHUNK as u64 - 31, 117)
            .unwrap()
            == bytes[CHUNK - 31..CHUNK + 86]
    );
    let session = host.native_human_session(&owner, profile).unwrap();
    assert!(
        host.events_page(&session, profile, &EventQuery::default())
            .unwrap()
            .items
            .is_empty()
    );
    assert!(matches!(
        host.read_local_source_range(&owner, &key, u64::MAX, 2),
        Err(HostError::InvalidRequest)
    ));
    assert!(matches!(
        host.read_local_source_range(&owner, &key, 0, CHUNK + 1),
        Err(HostError::PayloadTooLarge)
    ));
}

#[test]
fn owner_scope_and_old_runtime_are_checked_before_private_source_access() {
    let (directory, host, owner, profile, key) = fixture();
    for kind in [GrantKind::Human, GrantKind::Observer, GrantKind::AgentNote] {
        let grant = host
            .grant(
                &owner,
                GrantRequest {
                    profile_id: profile,
                    kind,
                    agent_id: (kind == GrantKind::AgentNote).then(exomind_core::AgentId::new),
                },
            )
            .unwrap();
        let session = host.authenticate(&grant.token).unwrap();
        assert!(matches!(
            host.begin_local_source(&session, &command(&key, b"x")),
            Err(HostError::Forbidden)
        ));
        assert!(matches!(
            host.local_source_status(&session, &key),
            Err(HostError::Forbidden)
        ));
    }
    let foreign = serde_json::to_string(&[
        uuid::Uuid::new_v4().to_string(),
        profile.to_string(),
        uuid::Uuid::new_v4().to_string(),
    ])
    .unwrap();
    assert!(matches!(
        host.local_source_status(&owner, &foreign),
        Err(HostError::Forbidden)
    ));
    host.request_stop();
    assert!(matches!(
        host.begin_local_source(&owner, &command(&key, b"x")),
        Err(HostError::Stopped)
    ));
    host.stop().unwrap();
    let reopened = BetaHost::open(&directory.path().join("host")).unwrap();
    assert!(matches!(
        reopened.local_source_status(&owner, &key),
        Err(HostError::Unauthorized)
    ));
}

#[test]
fn released_identity_is_immutable_and_late_cleanup_cannot_delete_new_generation() {
    let (_directory, host, owner, _profile, key) = fixture();
    let input = command(&key, b"original bytes");
    host.begin_local_source(&owner, &input).unwrap();
    host.write_local_source_chunk(&owner, &key, 0, b"original bytes")
        .unwrap();
    let old = host.finish_local_source(&owner, &key).unwrap();
    host.remove_local_source(&owner, &key, old.generation)
        .unwrap();
    assert!(matches!(
        host.begin_local_source(&owner, &command(&key, b"different bytes")),
        Err(HostError::LocalSourceConflict)
    ));
    let newer = host.begin_local_source(&owner, &input).unwrap();
    assert!(newer.generation > old.generation);
    host.write_local_source_chunk(&owner, &key, 0, b"original bytes")
        .unwrap();
    let ready = host.finish_local_source(&owner, &key).unwrap();
    assert!(matches!(
        host.remove_local_source(&owner, &key, old.generation),
        Err(HostError::LocalSourceConflict)
    ));
    assert_eq!(
        host.local_source_status(&owner, &key)
            .unwrap()
            .unwrap()
            .generation,
        ready.generation
    );
    assert!(host.read_local_source_range(&owner, &key, 0, 14).unwrap() == b"original bytes");
}

#[test]
fn wrong_hash_is_retained_and_missing_database_requires_recovery_without_breaking_core() {
    let (directory, host, owner, profile, key) = fixture();
    host.begin_local_source(&owner, &command(&key, b"good"))
        .unwrap();
    host.write_local_source_chunk(&owner, &key, 0, b"evil")
        .unwrap();
    assert!(matches!(
        host.finish_local_source(&owner, &key),
        Err(HostError::LocalSourceHashMismatch)
    ));
    assert_eq!(
        host.local_source_status(&owner, &key)
            .unwrap()
            .unwrap()
            .state,
        LocalSourceState::HashMismatch
    );
    host.stop().unwrap();
    std::fs::rename(
        directory
            .path()
            .join("host/private-sources/sources.sqlite3"),
        directory.path().join("saved.sqlite3"),
    )
    .unwrap();
    let reopened = BetaHost::open(&directory.path().join("host")).unwrap();
    let owner = reopened.owner_session().unwrap();
    assert!(matches!(
        reopened.local_source_status(&owner, &key),
        Err(HostError::LocalSourceCorrupt)
    ));
    assert!(
        reopened
            .profiles(&owner)
            .unwrap()
            .iter()
            .any(|item| item.profile_id == profile)
    );
}

#[test]
fn revived_source_must_reserve_total_quota_again_and_failed_writes_keep_the_prefix() {
    let (directory, host, owner, _profile, key) = fixture();
    let huge = LocalSourceBegin {
        key: key.clone(),
        byte_length: 4 * 1024 * 1024 * 1024,
        sha256: "a".repeat(64),
    };
    let first = host.begin_local_source(&owner, &huge).unwrap();
    host.remove_local_source(&owner, &key, first.generation)
        .unwrap();
    let parts: Vec<String> = serde_json::from_str(&key).unwrap();
    for _ in 0..2 {
        let another = serde_json::to_string(&[
            parts[0].clone(),
            parts[1].clone(),
            uuid::Uuid::new_v4().to_string(),
        ])
        .unwrap();
        host.begin_local_source(
            &owner,
            &LocalSourceBegin {
                key: another,
                byte_length: huge.byte_length,
                sha256: "b".repeat(64),
            },
        )
        .unwrap();
    }
    assert!(matches!(
        host.begin_local_source(&owner, &huge),
        Err(HostError::PayloadTooLarge)
    ));
    host.stop().unwrap();
    let root = directory.path().join("other");
    let other = BetaHost::open(&root).unwrap();
    let owner = other.owner_session().unwrap();
    let profile = ProfileId::new();
    other
        .provision_profile(&owner, profile, "write failure")
        .unwrap();
    let key = serde_json::to_string(&[
        other.status().unwrap().device_id.to_string(),
        profile.to_string(),
        uuid::Uuid::new_v4().to_string(),
    ])
    .unwrap();
    other
        .begin_local_source(&owner, &command(&key, b"safe"))
        .unwrap();
    let db = rusqlite::Connection::open(root.join("private-sources/sources.sqlite3")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_copy BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT,'synthetic disk failure');END;").unwrap();
    assert!(matches!(
        other.write_local_source_chunk(&owner, &key, 0, b"safe"),
        Err(HostError::LocalSourceUnavailable)
    ));
    assert_eq!(
        other
            .local_source_status(&owner, &key)
            .unwrap()
            .unwrap()
            .next_offset,
        0
    );
}

#[test]
fn ready_reverification_checks_full_digest_even_if_chunk_checksum_was_replaced() {
    let (directory, host, owner, _profile, key) = fixture();
    host.begin_local_source(&owner, &command(&key, b"good"))
        .unwrap();
    host.write_local_source_chunk(&owner, &key, 0, b"good")
        .unwrap();
    host.finish_local_source(&owner, &key).unwrap();
    let db = rusqlite::Connection::open(
        directory
            .path()
            .join("host/private-sources/sources.sqlite3"),
    )
    .unwrap();
    db.execute_batch("DROP TRIGGER immutable_source_chunk;")
        .unwrap();
    db.execute(
        "UPDATE chunks SET bytes=?1,sha256=?2 WHERE key=?3",
        rusqlite::params![b"evil", format!("{:x}", Sha256::digest(b"evil")), key],
    )
    .unwrap();
    assert!(matches!(
        host.finish_local_source(&owner, &key),
        Err(HostError::LocalSourceHashMismatch)
    ));
    assert_eq!(
        host.local_source_status(&owner, &key)
            .unwrap()
            .unwrap()
            .state,
        LocalSourceState::HashMismatch
    );
}

#[test]
fn malformed_manifest_shape_never_becomes_a_valid_ready_reader() {
    for damage in ["hash", "offset", "released"] {
        let (directory, host, owner, _profile, key) = fixture();
        host.begin_local_source(&owner, &command(&key, b"good"))
            .unwrap();
        host.write_local_source_chunk(&owner, &key, 0, b"good")
            .unwrap();
        host.finish_local_source(&owner, &key).unwrap();
        let db = rusqlite::Connection::open(
            directory
                .path()
                .join("host/private-sources/sources.sqlite3"),
        )
        .unwrap();
        match damage {
            "hash" => {
                db.execute(
                    "UPDATE sources SET sha256=?1 WHERE key=?2",
                    rusqlite::params!["G".repeat(64), key],
                )
                .unwrap();
            }
            "offset" => {
                db.execute("UPDATE sources SET next_offset=1 WHERE key=?1", [&key])
                    .unwrap();
            }
            _ => {
                db.execute("UPDATE sources SET state='released' WHERE key=?1", [&key])
                    .unwrap();
            }
        }
        assert!(
            matches!(
                host.local_source_status(&owner, &key),
                Err(HostError::LocalSourceCorrupt)
            ),
            "{damage}"
        );
    }
}

#[test]
fn native_ready_bytes_survive_a_real_owned_writer_process_kill() {
    struct Owned(std::process::Child);
    impl Drop for Owned {
        fn drop(&mut self) {
            if self.0.try_wait().ok().flatten().is_none() {
                let _ = self.0.kill();
            }
            let _ = self.0.wait();
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("writer");
    let receipt = directory.path().join("source-ready.json");
    let mut writer = Owned(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "native_source_writer_crash_fixture",
                "--nocapture",
            ])
            .env("EXOMIND_SOURCE_FIXTURE_ROOT", &root)
            .env("EXOMIND_SOURCE_FIXTURE_READY", &receipt)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
    );
    let end = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let ready = loop {
        if let Ok(raw) = std::fs::read(&receipt) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&raw) {
                break value;
            }
        }
        assert!(writer.0.try_wait().unwrap().is_none());
        assert!(std::time::Instant::now() < end, "source writer deadline");
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    writer.0.kill().unwrap();
    writer.0.wait().unwrap();
    let host = BetaHost::open(&root).unwrap();
    let owner = host.owner_session().unwrap();
    let key = ready["key"].as_str().unwrap();
    let info = host.local_source_status(&owner, key).unwrap().unwrap();
    assert_eq!(info.state, LocalSourceState::Ready);
    assert_eq!(info.generation, ready["generation"].as_u64().unwrap());
    assert_eq!(info.sha256, ready["sha256"].as_str().unwrap());
    assert!(host.read_local_source_range(&owner, key, 0, 4).unwrap() == [0, 255, 137, 42]);
}

#[test]
#[ignore = "owned process fixture, invoked only by its parent test"]
fn native_source_writer_crash_fixture() {
    let Some(root) = std::env::var_os("EXOMIND_SOURCE_FIXTURE_ROOT") else {
        return;
    };
    let ready = std::env::var_os("EXOMIND_SOURCE_FIXTURE_READY").unwrap();
    let host = BetaHost::open(std::path::Path::new(&root)).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "source writer crash")
        .unwrap();
    let key = serde_json::to_string(&[
        host.status().unwrap().device_id.to_string(),
        profile.to_string(),
        uuid::Uuid::new_v4().to_string(),
    ])
    .unwrap();
    let bytes = [0u8, 255, 137, 42];
    host.begin_local_source(&owner, &command(&key, &bytes))
        .unwrap();
    host.write_local_source_chunk(&owner, &key, 0, &bytes)
        .unwrap();
    let info = host.finish_local_source(&owner, &key).unwrap();
    std::fs::write(
        ready,
        serde_json::to_vec(
            &serde_json::json!({"key":key,"generation":info.generation,"sha256":info.sha256}),
        )
        .unwrap(),
    )
    .unwrap();
    std::thread::sleep(std::time::Duration::from_secs(40));
}

#[test]
fn oversized_identity_is_rejected_on_open_and_verification_without_losing_source_bytes() {
    for column in ["device_id", "layout"] {
        let (directory, host, owner, _profile, key) = fixture();
        let root = directory.path().join("host");
        let bytes = b"source survives malformed identity";
        host.begin_local_source(&owner, &command(&key, bytes))
            .unwrap();
        host.write_local_source_chunk(&owner, &key, 0, bytes)
            .unwrap();
        let ready = host.finish_local_source(&owner, &key).unwrap();
        let database =
            rusqlite::Connection::open(root.join("private-sources/sources.sqlite3")).unwrap();
        let original: String = database
            .query_row(&format!("SELECT {column} FROM identity"), [], |row| {
                row.get(0)
            })
            .unwrap();
        // The external corruption fixture has no Host connection limits. The
        // application must reject this value rather than decode it as String.
        let oversized = "x".repeat(1024 * 1024);
        database
            .execute(&format!("UPDATE identity SET {column}=?1"), [&oversized])
            .unwrap();
        assert!(matches!(
            host.finish_local_source(&owner, &key),
            Err(HostError::LocalSourceCorrupt)
        ));
        host.stop().unwrap();
        let reopened = BetaHost::open(&root).unwrap();
        let owner = reopened.owner_session().unwrap();
        assert!(!reopened.profiles(&owner).unwrap().is_empty());
        assert!(matches!(
            reopened.local_source_status(&owner, &key),
            Err(HostError::LocalSourceCorrupt)
        ));
        database
            .execute(&format!("UPDATE identity SET {column}=?1"), [&original])
            .unwrap();
        let restored = reopened.local_source_status(&owner, &key).unwrap().unwrap();
        assert_eq!(restored.generation, ready.generation);
        assert_eq!(restored.sha256, ready.sha256);
        assert_eq!(
            reopened
                .read_local_source_range(&owner, &key, 0, bytes.len())
                .unwrap(),
            bytes
        );
    }
}
