use super::*;
use crate::{GrantKind, GrantRequest};
use exomind_core::{BeginStageCommand, CaptureCommand, CommandId, EventId, StageId};
use rusqlite::{OpenFlags, types::Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

fn host() -> (tempfile::TempDir, BetaHost, Session, ProfileId) {
    let root = tempfile::tempdir().unwrap();
    let host = BetaHost::open(root.path()).unwrap();
    let owner = host.owner_session().unwrap();
    let p = ProfileId::new();
    host.provision_profile(&owner, p, "synthetic original policy P")
        .unwrap();
    (root, host, owner, p)
}
fn seed(host: &BetaHost, p: ProfileId, publish: bool) -> OriginalId {
    let id = OriginalId::new();
    let stage = StageId::new();
    let ticket = {
        let state = host.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        let writer = core.local_human(p).unwrap();
        core.begin_stage(
            &writer,
            &BeginStageCommand {
                stage_id: stage,
                original_id: id,
                profile_id: p,
                expected_sha256: format!("{:x}", Sha256::digest(b"")),
                byte_length: 0,
                file_name: "synthetic-empty.bin".into(),
                media_type: "application/octet-stream".into(),
            },
        )
        .unwrap();
        core.freeze_stage(&writer, stage).unwrap()
    };
    let proof = ticket.verify(|| false).unwrap();
    let state = host.active_state().unwrap();
    let core = &crate::resources(&state).unwrap().core;
    let writer = core.local_human(p).unwrap();
    let original = core.finish_stage(&writer, &proof).unwrap().original;
    if publish {
        core.submit(
            &writer,
            &CaptureCommand {
                command_id: CommandId::new(),
                event_id: EventId::new(),
                profile_id: p,
                occurred_at_ms: 1000,
                text: "synthetic policy reference".into(),
                tags: vec![],
                originals: vec![original],
            },
        )
        .unwrap();
    }
    id
}
fn rows(c: &Connection, table: &str) -> Vec<Vec<Value>> {
    let mut q = c
        .prepare(&format!(
            "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
            table.replace('"', "\"\"")
        ))
        .unwrap();
    let n = q.column_count();
    q.query_map([], |r| {
        (0..n).map(|i| r.get(i)).collect::<Result<Vec<_>, _>>()
    })
    .unwrap()
    .collect::<Result<Vec<_>, _>>()
    .unwrap()
}
fn snapshot(c: &Connection) -> BTreeMap<String, Vec<Vec<Value>>> {
    let names = c
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let value = rows(c, &name);
            (name, value)
        })
        .collect()
}
fn auth(host: &BetaHost) -> BTreeMap<String, Vec<Vec<Value>>> {
    let state = host.active_state().unwrap();
    snapshot(&crate::resources(&state).unwrap().persistence.auth)
}
fn core_data(host: &BetaHost) -> BTreeMap<String, Vec<Vec<Value>>> {
    let state = host.active_state().unwrap();
    let c = Connection::open_with_flags(
        crate::resources(&state).unwrap().core.database_path(),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    snapshot(&c)
}
fn change(
    host: &BetaHost,
    owner: &Session,
    prior: &OriginalAutoPolicy,
    enabled: bool,
    max_bytes: u64,
) -> OriginalAutoPolicy {
    host.configure_original_auto_policy(
        owner,
        &OriginalAutoPolicyCommand {
            command_id: Uuid::new_v4(),
            expected_revision: prior.revision,
            enabled,
            max_bytes,
        },
    )
    .unwrap()
}
fn suppress(
    host: &BetaHost,
    owner: &Session,
    p: ProfileId,
    id: OriginalId,
    prior: Option<Uuid>,
    suppression: Option<OriginalAutoSuppression>,
) -> OriginalLocalIntent {
    host.configure_original_auto_suppression(
        owner,
        p,
        id,
        &OriginalAutoSuppressionCommand {
            command_id: Uuid::new_v4(),
            expected_intent_revision: prior,
            suppression,
        },
    )
    .unwrap()
}
fn online(host: &BetaHost, owner: &Session, enabled: bool) {
    let mut value = host.peer_network_settings(owner).unwrap();
    value.enabled = enabled;
    host.save_peer_network_settings(owner, value).unwrap();
}
fn failure(
    host: &BetaHost,
    p: ProfileId,
    id: OriginalId,
    policy: Uuid,
    intent: Option<Uuid>,
) -> Option<OriginalAutoBackoff> {
    let mut state = host.active_state().unwrap();
    let r = state.resources.as_mut().unwrap();
    let tx = super::super::membership_store::transaction(&mut r.persistence.auth).unwrap();
    let result = note_failure(&tx, p, id, "unreachable", 0, policy, intent).unwrap();
    tx.commit().unwrap();
    result
}

#[test]
fn defaults_reads_and_revision_cas_are_durable_without_core_writes() {
    let (root, host, owner, p) = host();
    let id = seed(&host, p, true);
    let before = auth(&host);
    let core_before = core_data(&host);
    let initial = host.original_auto_policy(&owner).unwrap();
    assert!(initial.enabled);
    assert_eq!(initial.max_bytes, 8 * 1024 * 1024);
    assert!(!host.peer_network_settings(&owner).unwrap().enabled);
    assert_eq!(
        host.original_local_intent(&owner, p, id)
            .unwrap()
            .intent_revision,
        None
    );
    assert_eq!(
        host.original_auto_backoff(&owner, p, id).unwrap().delay_ms,
        0
    );
    assert!(auth(&host) == before, "reads wrote auth rows");
    let command = OriginalAutoPolicyCommand {
        command_id: Uuid::new_v4(),
        expected_revision: initial.revision,
        enabled: false,
        max_bytes: MIN_ORIGINAL_AUTO_BYTES,
    };
    let saved = host
        .configure_original_auto_policy(&owner, &command)
        .unwrap();
    assert_eq!(saved.revision, command.command_id);
    assert_eq!(
        host.configure_original_auto_policy(&owner, &command)
            .unwrap(),
        saved
    );
    let mut mismatch = command.clone();
    mismatch.enabled = true;
    assert!(matches!(
        host.configure_original_auto_policy(&owner, &mismatch),
        Err(HostError::PeerMembershipConflict)
    ));
    for size in [0, MIN_ORIGINAL_AUTO_BYTES - 1, MAX_ORIGINAL_AUTO_BYTES + 1] {
        let prior = auth(&host);
        assert!(matches!(
            host.configure_original_auto_policy(
                &owner,
                &OriginalAutoPolicyCommand {
                    command_id: Uuid::new_v4(),
                    expected_revision: saved.revision,
                    enabled: true,
                    max_bytes: size
                }
            ),
            Err(HostError::InvalidRequest)
        ));
        assert!(auth(&host) == prior);
    }
    let latest = change(&host, &owner, &saved, true, MAX_ORIGINAL_AUTO_BYTES);
    let mut aba = command.clone();
    aba.expected_revision = latest.revision;
    assert!(
        matches!(
            host.configure_original_auto_policy(&owner, &aba),
            Err(HostError::PeerMembershipConflict)
        ),
        "spent revision cannot be reused to revive old work"
    );
    assert!(core_data(&host) == core_before);
    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    let fresh = reopened.owner_session().unwrap();
    assert_eq!(reopened.original_auto_policy(&fresh).unwrap(), latest);
    assert!(matches!(
        reopened.original_auto_policy(&owner),
        Err(HostError::Unauthorized)
    ));
    reopened.stop().unwrap();
}

#[test]
fn permanent_suppression_survives_policy_success_backoff_and_restart() {
    let (root, host, owner, p) = host();
    let id = seed(&host, p, true);
    let policy = host.original_auto_policy(&owner).unwrap();
    online(&host, &owner, true);
    failure(&host, p, id, policy.revision, None).unwrap();
    let cancelled = suppress(
        &host,
        &owner,
        p,
        id,
        None,
        Some(OriginalAutoSuppression::UserCancelled),
    );
    let off = change(&host, &owner, &policy, false, policy.max_bytes);
    let on = change(&host, &owner, &off, true, policy.max_bytes);
    assert_eq!(
        host.original_local_intent(&owner, p, id).unwrap(),
        cancelled
    );
    {
        let mut state = host.active_state().unwrap();
        let r = state.resources.as_mut().unwrap();
        let tx = super::super::membership_store::transaction(&mut r.persistence.auth).unwrap();
        clear_backoff(&tx, p, id).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        host.original_auto_backoff(&owner, p, id).unwrap().delay_ms,
        0
    );
    assert_eq!(
        host.original_local_intent(&owner, p, id).unwrap(),
        cancelled,
        "success clearing retry cannot clear intent"
    );
    let released = suppress(
        &host,
        &owner,
        p,
        id,
        cancelled.intent_revision,
        Some(OriginalAutoSuppression::LocalReleased),
    );
    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    let owner = reopened.owner_session().unwrap();
    assert_eq!(
        reopened.original_local_intent(&owner, p, id).unwrap(),
        released
    );
    assert_eq!(reopened.original_auto_policy(&owner).unwrap(), on);
    // Published verified bytes remain usable for an explicit one-off operation;
    // merely reading them does not restore long-term automatic admission.
    {
        let state = reopened.active_state().unwrap();
        let core = &crate::resources(&state).unwrap().core;
        core.read_original_range(&core.local_human(p).unwrap(), p, id, 0, 1)
            .unwrap();
    }
    assert_eq!(
        reopened.original_local_intent(&owner, p, id).unwrap(),
        released
    );
    let allowed = suppress(&reopened, &owner, p, id, released.intent_revision, None);
    assert_ne!(allowed.intent_revision, released.intent_revision);
    assert!(allowed.suppression.is_none());
    reopened.stop().unwrap();
}

#[test]
fn stale_policy_or_intent_cannot_publish_retry_and_none_revision_cannot_aba() {
    let (_root, host, owner, p) = host();
    let id = seed(&host, p, true);
    online(&host, &owner, true);
    let policy = host.original_auto_policy(&owner).unwrap();
    assert!(failure(&host, p, id, policy.revision, None).is_some());
    let paused = suppress(
        &host,
        &owner,
        p,
        id,
        None,
        Some(OriginalAutoSuppression::UserCancelled),
    );
    let before = auth(&host);
    assert!(failure(&host, p, id, policy.revision, None).is_none());
    assert!(failure(&host, p, id, policy.revision, paused.intent_revision).is_none());
    assert!(auth(&host) == before);
    let resumed = suppress(&host, &owner, p, id, paused.intent_revision, None);
    assert!(resumed.intent_revision.is_some());
    assert!(failure(&host, p, id, policy.revision, None).is_none());
    assert!(failure(&host, p, id, policy.revision, resumed.intent_revision).is_some());
    let changed = change(&host, &owner, &policy, true, policy.max_bytes);
    let before = auth(&host);
    assert!(failure(&host, p, id, policy.revision, resumed.intent_revision).is_none());
    assert!(auth(&host) == before);
    online(&host, &owner, false);
    assert!(failure(&host, p, id, changed.revision, resumed.intent_revision).is_none());
    let replay = OriginalAutoSuppressionCommand {
        command_id: paused.intent_revision.unwrap(),
        expected_intent_revision: resumed.intent_revision,
        suppression: Some(OriginalAutoSuppression::UserCancelled),
    };
    assert!(matches!(
        host.configure_original_auto_suppression(&owner, p, id, &replay),
        Err(HostError::PeerMembershipConflict)
    ));
    host.stop().unwrap();
}

#[test]
fn retry_delay_is_bounded_and_restored_without_a_wall_clock_deadline() {
    let (root, host, owner, p) = host();
    let id = seed(&host, p, true);
    online(&host, &owner, true);
    let policy = host.original_auto_policy(&owner).unwrap();
    for expected in [2000, 4000, 8000, 16000, 30000, 60000, 60000] {
        let retry = failure(&host, p, id, policy.revision, None).unwrap();
        assert_eq!(retry.delay_ms, expected);
        assert!(retry.failures <= 6);
    }
    let saved = host.original_auto_backoff(&owner, p, id).unwrap();
    host.stop().unwrap();
    let reopened = BetaHost::open(root.path()).unwrap();
    let owner = reopened.owner_session().unwrap();
    assert_eq!(
        reopened.original_auto_backoff(&owner, p, id).unwrap(),
        saved
    );
    assert_eq!(
        saved.delay_ms, 60000,
        "restoration must rearm this conservative delay, never derive overdue from wall time"
    );
    let state = reopened.active_state().unwrap();
    let c = &crate::resources(&state).unwrap().persistence.auth;
    let columns = c
        .prepare("PRAGMA table_info(peer_original_auto_backoff)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        !columns
            .iter()
            .any(|column| column.contains("wall") || column.contains("deadline"))
    );
    drop(state);
    reopened.stop().unwrap();
}

#[test]
fn owner_reference_scope_and_private_upload_boundaries_are_enforced() {
    let (_root, host, owner, p) = host();
    let published = seed(&host, p, true);
    let private = seed(&host, p, false);
    let q = ProfileId::new();
    host.provision_profile(&owner, q, "synthetic Q").unwrap();
    let policy = host.original_auto_policy(&owner).unwrap();
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: p,
                kind: GrantKind::Human,
                agent_id: None,
            },
        )
        .unwrap();
    let human = host.authenticate(&grant.token).unwrap();
    let before = auth(&host);
    assert!(matches!(
        host.original_auto_policy(&human),
        Err(HostError::Forbidden)
    ));
    assert!(host.original_local_intent(&human, p, published).is_err());
    let command = OriginalAutoSuppressionCommand {
        command_id: Uuid::new_v4(),
        expected_intent_revision: None,
        suppression: Some(OriginalAutoSuppression::UserCancelled),
    };
    for (profile, id) in [(p, private), (p, OriginalId::new()), (q, published)] {
        assert!(
            host.configure_original_auto_suppression(&owner, profile, id, &command)
                .is_err()
        );
    }
    assert!(auth(&host) == before);
    let state = host.active_state().unwrap();
    let c = &crate::resources(&state).unwrap().persistence.auth;
    assert!(
        !eligible(c, p, published, 0, policy.revision, None).unwrap(),
        "network is disabled"
    );
    drop(state);
    host.stop().unwrap();
}

#[test]
fn intent_cas_replay_is_exact_and_command_ids_cannot_move_to_other_originals() {
    let (_root, host, owner, p) = host();
    let first = seed(&host, p, true);
    let second = seed(&host, p, true);
    let command = OriginalAutoSuppressionCommand {
        command_id: Uuid::new_v4(),
        expected_intent_revision: None,
        suppression: Some(OriginalAutoSuppression::UserCancelled),
    };
    let saved = host
        .configure_original_auto_suppression(&owner, p, first, &command)
        .unwrap();
    let before = auth(&host);
    assert_eq!(
        host.configure_original_auto_suppression(&owner, p, first, &command)
            .unwrap(),
        saved
    );
    assert!(auth(&host) == before);
    let mut changed = command.clone();
    changed.suppression = Some(OriginalAutoSuppression::LocalReleased);
    assert!(matches!(
        host.configure_original_auto_suppression(&owner, p, first, &changed),
        Err(HostError::PeerMembershipConflict)
    ));
    assert!(matches!(
        host.configure_original_auto_suppression(&owner, p, second, &command),
        Err(HostError::PeerMembershipConflict)
    ));
    assert!(auth(&host) == before);
    host.stop().unwrap();
}

#[test]
fn permanent_intents_are_not_evicted_with_the_256_entry_progress_budget() {
    let (_root, host, owner, p) = host();
    let first = seed(&host, p, true);
    let saved = suppress(
        &host,
        &owner,
        p,
        first,
        None,
        Some(OriginalAutoSuppression::UserCancelled),
    );
    for _ in 0..256 {
        let id = seed(&host, p, true);
        suppress(
            &host,
            &owner,
            p,
            id,
            None,
            Some(OriginalAutoSuppression::LocalReleased),
        );
    }
    assert_eq!(host.original_local_intent(&owner, p, first).unwrap(), saved);
    let state = host.active_state().unwrap();
    let c = &crate::resources(&state).unwrap().persistence.auth;
    assert_eq!(
        c.query_row::<u64, _, _>("SELECT count(*) FROM peer_original_auto_intents", [], |r| r
            .get(0))
            .unwrap(),
        257
    );
    drop(state);
    host.stop().unwrap();
}

#[test]
fn denied_intent_write_rolls_back_its_revision_and_never_acknowledges_suppression() {
    let (_root, host, owner, p) = host();
    let id = seed(&host, p, true);
    {
        let mut state = host.active_state().unwrap();
        let c = &mut state.resources.as_mut().unwrap().persistence.auth;
        c.execute_batch("CREATE TRIGGER test_deny_original_intent BEFORE INSERT ON peer_original_auto_intents BEGIN SELECT RAISE(ABORT,'synthetic write denial'); END;").unwrap();
    }
    let before = auth(&host);
    assert!(matches!(
        host.configure_original_auto_suppression(
            &owner,
            p,
            id,
            &OriginalAutoSuppressionCommand {
                command_id: Uuid::new_v4(),
                expected_intent_revision: None,
                suppression: Some(OriginalAutoSuppression::UserCancelled)
            }
        ),
        Err(HostError::PeerSyncUnavailable)
    ));
    assert!(
        auth(&host) == before,
        "failed write left a spent revision or fake suppression"
    );
    assert!(
        host.original_local_intent(&owner, p, id)
            .unwrap()
            .suppression
            .is_none()
    );
    host.stop().unwrap();
}

fn drop_auto(c: &Connection) {
    c.execute_batch("DROP TABLE peer_original_auto_backoff;DROP TABLE peer_original_auto_intents;DROP TABLE peer_original_auto_policy;DROP TABLE peer_original_auto_revisions;").unwrap();
}
fn legacy_auth(version: i64) -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA user_version=1;CREATE TABLE owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),token_hash TEXT NOT NULL);CREATE TABLE grants(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,kind TEXT NOT NULL,agent_id TEXT,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);INSERT INTO owner VALUES(1,'synthetic-owner-hash');INSERT INTO grants VALUES('synthetic-grant','synthetic-P','observer',NULL,'synthetic-grant-hash',0);").unwrap();
    super::super::membership_store::migrate(&mut c).unwrap();
    drop_auto(&c);
    if version <= 4 {
        c.execute_batch("DROP TABLE peer_environment_alias;DROP TABLE peer_environment_alias_claims;")
            .unwrap();
    }
    if version <= 3 {
        c.execute_batch("DROP TABLE peer_network_routes;DROP TABLE peer_network_settings;")
            .unwrap();
    }
    if version <= 2 {
        c.execute_batch("DROP TABLE peer_sync_ack;DROP TABLE peer_sync_ack_layout;")
            .unwrap();
    }
    if version == 1 {
        c.execute_batch("DROP TABLE peer_membership_layout;DROP TABLE peer_members;DROP TABLE peer_invitations;DROP TABLE peer_claims;DROP TABLE peer_pending;").unwrap();
    }
    c.pragma_update(None, "user_version", version).unwrap();
    c
}
#[test]
fn legacy_auth_one_two_three_four_complete_every_required_step() {
    for version in 1..=4 {
        let mut c = legacy_auth(version);
        let before = snapshot(&c);
        super::super::membership_store::migrate(&mut c).unwrap();
        assert_eq!(
            c.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            super::super::membership_store::AUTH_VERSION
        );
        validate(&c).unwrap();
        for (name, value) in before {
            assert!(
                rows(&c, &name) == value,
                "old {name} changed while upgrading auth{version}"
            );
        }
        assert_eq!(policy(&c).unwrap().max_bytes, DEFAULT_ORIGINAL_AUTO_BYTES);
    }
}

#[test]
fn missing_auth_five_table_and_mixed_auth_four_are_not_silently_repaired() {
    let (root, host, _owner, _p) = host();
    host.stop().unwrap();
    let path = root.path().join("host-auth.sqlite3");
    let mut c = Connection::open(&path).unwrap();
    c.execute("DROP TABLE peer_original_auto_backoff", [])
        .unwrap();
    let before = snapshot(&c);
    assert!(super::super::membership_store::migrate(&mut c).is_err());
    assert!(snapshot(&c) == before);
    drop(c);
    assert!(matches!(
        BetaHost::open(root.path()),
        Err(HostError::PeerSyncRecoveryRequired)
    ));
    let (_root, host, _owner, _p) = self::host();
    host.stop().unwrap();
    let mut c = Connection::open(_root.path().join("host-auth.sqlite3")).unwrap();
    c.pragma_update(None, "user_version", 4).unwrap();
    let before = snapshot(&c);
    assert!(super::super::membership_store::migrate(&mut c).is_err());
    assert!(snapshot(&c) == before);
    assert_eq!(
        c.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        4
    );
}

fn tree(root: &Path) -> BTreeMap<PathBuf, String> {
    fn walk(root: &Path, current: &Path, out: &mut BTreeMap<PathBuf, String>) {
        for entry in fs::read_dir(current).unwrap() {
            let entry = entry.unwrap();
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink());
            if kind.is_dir() {
                walk(root, &entry.path(), out);
            } else {
                assert!(kind.is_file());
                let mut file = fs::File::open(entry.path()).unwrap();
                let mut hash = Sha256::new();
                let mut chunk = [0u8; 65536];
                loop {
                    let n = file.read(&mut chunk).unwrap();
                    if n == 0 {
                        break;
                    }
                    hash.update(&chunk[..n]);
                }
                out.insert(
                    entry.path().strip_prefix(root).unwrap().to_path_buf(),
                    format!("{:x}", hash.finalize()),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}
fn copy_tree(source: &Path, target: &Path) {
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let kind = entry.file_type().unwrap();
        assert!(!kind.is_symlink());
        let dest = target.join(entry.file_name());
        if kind.is_dir() {
            fs::create_dir(&dest).unwrap();
            copy_tree(&entry.path(), &dest);
        } else {
            assert!(kind.is_file());
            fs::copy(entry.path(), dest).unwrap();
        }
    }
}
#[test]
#[ignore = "requires actual retained auth4 Host via EXOMIND_HOST_AUTH4_FIXTURE"]
fn actual_auth_four_upgrade_preserves_private_owner_grants_members_and_pin() {
    let source = PathBuf::from(
        std::env::var_os("EXOMIND_HOST_AUTH4_FIXTURE").expect("retained stopped auth4 Host root"),
    );
    let before = tree(&source);
    let temp = tempfile::tempdir().unwrap();
    copy_tree(&source, temp.path());
    assert!(
        tree(&source) == before,
        "retained source changed while copying"
    );
    // Open ONLY the copy. No SQLite connection ever touches the retained source.
    let old = Connection::open_with_flags(
        temp.path().join("host-auth.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert_eq!(
        old.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        4
    );
    let expected = snapshot(&old);
    assert!(!expected["owner"].is_empty());
    assert!(!expected["peer_members"].is_empty());
    assert!(
        expected
            .get("peer_identity_binding")
            .is_some_and(|rows| !rows.is_empty()),
        "retained pairing fixture must contain its stable pin binding"
    );
    drop(old);
    let host = BetaHost::open(temp.path()).unwrap();
    let copy = Connection::open_with_flags(
        temp.path().join("host-auth.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert_eq!(
        copy.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
            .unwrap(),
        5
    );
    for (name, value) in &expected {
        assert!(
            rows(&copy, name) == *value,
            "old private auth table {name} changed"
        );
    }
    validate(&copy).unwrap();
    drop(copy);
    let owner = host.owner_session().unwrap();
    let policy = host.original_auto_policy(&owner).unwrap();
    assert!(policy.enabled);
    assert_eq!(policy.max_bytes, DEFAULT_ORIGINAL_AUTO_BYTES);
    host.stop().unwrap();
    assert!(tree(&source) == before, "retained auth4 Host files changed");
    let reopened = BetaHost::open(temp.path()).unwrap();
    reopened.stop().unwrap();
    assert!(
        tree(&source) == before,
        "retained source changed after reopen"
    );
}
