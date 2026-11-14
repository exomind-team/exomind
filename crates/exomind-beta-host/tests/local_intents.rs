use exomind_beta_host::{BetaHost, GrantKind, GrantRequest, HostError};
use exomind_core::{AgentId, EventQuery, ProfileId};
use rusqlite::Connection;
use std::{
    fs,
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

fn capture_key(host: &BetaHost) -> String {
    format!("exomind:beta:drafts:{}", host.status().unwrap().device_id)
}
fn timeblock_key(host: &BetaHost, profile: ProfileId) -> String {
    format!(
        "exomind:beta:timeblocks:{}",
        serde_json::to_string(&[
            host.status().unwrap().device_id.to_string(),
            profile.to_string()
        ])
        .unwrap()
    )
}

#[test]
fn owner_intent_roundtrip_preserves_opaque_json_without_business_facts() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = BetaHost::open(&root).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic intent")
        .unwrap();
    let human = host.native_human_session(&owner, profile).unwrap();
    let raw = " \n{\"text\":\"草稿\\n\\u0000\",\"extra\":[1,true,null],\"text\":\"opaque duplicate key retained\"}\t";
    for key in [capture_key(&host), timeblock_key(&host, profile)] {
        assert!(host.read_local_intent(&owner, &key).unwrap().is_none());
        host.write_local_intent(&owner, &key, raw).unwrap();
        assert_eq!(
            host.read_local_intent(&owner, &key).unwrap().as_deref(),
            Some(raw)
        );
    }
    let page = host
        .events_page(&human, profile, &EventQuery::default())
        .unwrap();
    assert!(page.items.is_empty());
    assert_eq!(page.highwater, 0);
    host.stop().unwrap();
    let reopened = BetaHost::open(&root).unwrap();
    let new_owner = reopened.owner_session().unwrap();
    assert_eq!(
        reopened
            .read_local_intent(&new_owner, &capture_key(&reopened))
            .unwrap()
            .as_deref(),
        Some(raw)
    );
    assert!(matches!(
        reopened.read_local_intent(&owner, &capture_key(&reopened)),
        Err(HostError::Unauthorized)
    ));
}

#[test]
fn intents_reject_grants_foreign_runtime_keys_and_unknown_profiles() {
    let directory = tempfile::tempdir().unwrap();
    let host = BetaHost::open(&directory.path().join("one")).unwrap();
    let other = BetaHost::open(&directory.path().join("two")).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "scope").unwrap();
    let key = capture_key(&host);
    for kind in [GrantKind::Observer, GrantKind::Human, GrantKind::AgentNote] {
        let grant = host
            .grant(
                &owner,
                GrantRequest {
                    profile_id: profile,
                    kind,
                    agent_id: (kind == GrantKind::AgentNote).then(AgentId::new),
                },
            )
            .unwrap();
        let session = host.authenticate(&grant.token).unwrap();
        assert!(matches!(
            host.read_local_intent(&session, &key),
            Err(HostError::Forbidden)
        ));
        assert!(matches!(
            host.write_local_intent(&session, &key, "{}"),
            Err(HostError::Forbidden)
        ));
    }
    assert!(matches!(
        host.write_local_intent(&other.owner_session().unwrap(), &key, "{}"),
        Err(HostError::Unauthorized)
    ));
    for invalid in [
        "arbitrary".to_string(),
        format!("{key}/path"),
        format!("exomind:beta:drafts:{}", other.status().unwrap().device_id),
        timeblock_key(&host, ProfileId::new()),
        format!(
            "exomind:beta:timeblocks:[\"{}\",\"{}\",\"extra\"]",
            host.status().unwrap().device_id,
            profile
        ),
    ] {
        assert!(host.read_local_intent(&owner, &invalid).is_err());
        assert!(host.write_local_intent(&owner, &invalid, "{}").is_err());
    }
    assert!(!directory.path().join("one/private-ui").exists());
}

#[test]
fn invalid_or_failed_sql_writes_preserve_the_last_committed_intent() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("host");
    let host = BetaHost::open(&root).unwrap();
    let owner = host.owner_session().unwrap();
    let key = capture_key(&host);
    let old = "{\"fixed_command_id\":\"original\",\"next_draft\":\"keep\"}";
    host.write_local_intent(&owner, &key, old).unwrap();
    assert!(matches!(
        host.write_local_intent(&owner, &key, "not JSON"),
        Err(HostError::InvalidRequest)
    ));
    let oversized = format!("\"{}\"", "x".repeat(8 * 1024 * 1024));
    assert!(matches!(
        host.write_local_intent(&owner, &key, &oversized),
        Err(HostError::PayloadTooLarge)
    ));
    let connection = Connection::open(root.join("private-ui/intent.sqlite3")).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_intent_update BEFORE UPDATE ON intents BEGIN SELECT RAISE(ABORT, 'synthetic write rejection'); END;").unwrap();
    assert!(matches!(
        host.write_local_intent(&owner, &key, "{\"replacement\":true}"),
        Err(HostError::IntentCacheUnavailable)
    ));
    assert_eq!(
        host.read_local_intent(&owner, &key).unwrap().as_deref(),
        Some(old)
    );
    host.request_stop();
    assert!(matches!(
        host.write_local_intent(&owner, &key, "{}"),
        Err(HostError::Stopped)
    ));
    assert!(matches!(
        host.read_local_intent(&owner, &key),
        Err(HostError::Stopped)
    ));
    drop(connection);
    host.stop().unwrap();
    let reopened = BetaHost::open(&root).unwrap();
    assert_eq!(
        reopened
            .read_local_intent(&reopened.owner_session().unwrap(), &key)
            .unwrap()
            .as_deref(),
        Some(old)
    );
}

#[test]
fn lost_blank_foreign_and_corrupt_intent_databases_never_become_empty_cache() {
    for damage in [
        "missing",
        "blank",
        "hash",
        "device",
        "application",
        "sidecar",
        "directory",
        "anchor",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join(damage);
        let host = BetaHost::open(&root).unwrap();
        let owner = host.owner_session().unwrap();
        let profile = ProfileId::new();
        host.provision_profile(&owner, profile, "unaffected core")
            .unwrap();
        let key = capture_key(&host);
        host.write_local_intent(&owner, &key, "{\"must_not_disappear\":true}")
            .unwrap();
        host.stop().unwrap();
        let database = root.join("private-ui/intent.sqlite3");
        match damage {
            "missing" => {
                fs::rename(&database, directory.path().join("saved-intent.sqlite3")).unwrap()
            }
            "blank" => fs::write(&database, []).unwrap(),
            "sidecar" => {
                fs::remove_file(&database).unwrap();
                fs::write(
                    root.join("private-ui/intent.sqlite3-journal"),
                    b"synthetic incomplete initialization",
                )
                .unwrap();
            }
            "directory" => fs::rename(
                root.join("private-ui"),
                directory.path().join("saved-private-ui"),
            )
            .unwrap(),
            "anchor" => {
                fs::write(root.join("private-ui.initialized"), b"incomplete binding").unwrap()
            }
            _ => {
                let connection = Connection::open(&database).unwrap();
                match damage {
                    "hash" => {
                        connection
                            .execute("UPDATE intents SET raw='{}'", [])
                            .unwrap();
                    }
                    "device" => {
                        connection
                            .execute(
                                "UPDATE identity SET device_id=?1",
                                [uuid::Uuid::new_v4().to_string()],
                            )
                            .unwrap();
                    }
                    "application" => connection
                        .pragma_update(None, "application_id", 42)
                        .unwrap(),
                    _ => unreachable!(),
                }
            }
        }
        // A UI-cache fault must not prevent Core/Host startup or destroy facts.
        let reopened = BetaHost::open(&root).unwrap();
        let owner = reopened.owner_session().unwrap();
        let human = reopened.native_human_session(&owner, profile).unwrap();
        assert!(
            matches!(
                reopened.read_local_intent(&owner, &key),
                Err(HostError::IntentCacheCorrupt)
            ),
            "{damage}"
        );
        assert!(
            matches!(
                reopened.write_local_intent(&owner, &key, "{}"),
                Err(HostError::IntentCacheCorrupt)
            ),
            "{damage}"
        );
        assert!(
            reopened
                .events_page(&human, profile, &EventQuery::default())
                .unwrap()
                .items
                .is_empty()
        );
    }
}

#[test]
fn an_unanchored_complete_cache_can_finish_initialization_but_partial_or_foreign_cache_is_preserved()
 {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("complete");
    let host = BetaHost::open(&root).unwrap();
    let owner = host.owner_session().unwrap();
    let key = capture_key(&host);
    host.write_local_intent(&owner, &key, "{\"committed_before_anchor\":true}")
        .unwrap();
    host.stop().unwrap();
    fs::remove_file(root.join("private-ui.initialized")).unwrap();
    let reopened = BetaHost::open(&root).unwrap();
    assert_eq!(
        reopened
            .read_local_intent(&reopened.owner_session().unwrap(), &key)
            .unwrap()
            .as_deref(),
        Some("{\"committed_before_anchor\":true}")
    );
    assert!(root.join("private-ui.initialized").is_file());
    reopened.stop().unwrap();
    for foreign in [false, true] {
        let root = directory
            .path()
            .join(if foreign { "foreign" } else { "partial" });
        let host = BetaHost::open(&root).unwrap();
        let owner = host.owner_session().unwrap();
        let key = capture_key(&host);
        fs::create_dir(root.join("private-ui")).unwrap();
        let path = root.join("private-ui").join(if foreign {
            "unrelated.txt"
        } else {
            "intent.sqlite3"
        });
        let original = if foreign {
            b"foreign bytes".as_slice()
        } else {
            b"".as_slice()
        };
        fs::write(&path, original).unwrap();
        assert!(matches!(
            host.read_local_intent(&owner, &key),
            Err(HostError::IntentCacheCorrupt)
        ));
        assert_eq!(fs::read(path).unwrap(), original);
    }
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

#[test]
fn committed_native_embedding_intent_survives_real_owned_process_kill() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("crash-root");
    let ready = directory.path().join("ready.json");
    let mut child = OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "local_intent_writer_crash_fixture",
                "--nocapture",
            ])
            .env("EXOMIND_INTENT_FIXTURE_ROOT", &root)
            .env("EXOMIND_INTENT_FIXTURE_READY", &ready)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let end = Instant::now() + Duration::from_secs(30);
    let marker = loop {
        if let Ok(raw) = fs::read(&ready) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&raw) {
                break value;
            }
        }
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "owned writer exited before durable acknowledgement"
        );
        assert!(
            Instant::now() < end,
            "owned writer acknowledgement deadline"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let host = BetaHost::open(&root).unwrap();
    let owner = host.owner_session().unwrap();
    assert_eq!(
        host.status().unwrap().device_id.to_string(),
        marker["device"].as_str().unwrap()
    );
    assert_eq!(
        host.read_local_intent(&owner, marker["key"].as_str().unwrap())
            .unwrap()
            .as_deref(),
        marker["raw"].as_str()
    );
    assert!(host.profiles(&owner).unwrap().is_empty());
}

#[test]
#[ignore = "owned subprocess fixture; invoked by its parent test only"]
fn local_intent_writer_crash_fixture() {
    let Some(root) = std::env::var_os("EXOMIND_INTENT_FIXTURE_ROOT") else {
        return;
    };
    let ready = std::env::var_os("EXOMIND_INTENT_FIXTURE_READY").unwrap();
    let host = BetaHost::open(Path::new(&root)).unwrap();
    let owner = host.owner_session().unwrap();
    let key = capture_key(&host);
    let raw = " {\"fixed_pending\":{\"id\":\"stable\"},\"new_draft\":\"survives process kill\"}\n";
    host.write_local_intent(&owner, &key, raw).unwrap();
    fs::write(
        ready,
        serde_json::to_vec(
            &serde_json::json!({"device":host.status().unwrap().device_id,"key":key,"raw":raw}),
        )
        .unwrap(),
    )
    .unwrap();
    std::thread::sleep(Duration::from_secs(40));
}
