use super::*;
use crate::{BetaHost, GrantKind, GrantRequest};
use exomind_core::ProfileId;
use tempfile::{TempDir, tempdir};

fn database() -> (TempDir, Connection) {
    let root = tempdir().unwrap();
    let mut db = Connection::open(root.path().join("auth.sqlite3")).unwrap();
    db.execute_batch("PRAGMA synchronous=FULL;PRAGMA user_version=1;CREATE TABLE owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),token_hash TEXT NOT NULL);CREATE TABLE grants(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,kind TEXT NOT NULL,agent_id TEXT,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);").unwrap();
    super::super::membership_store::migrate(&mut db).unwrap();
    (root, db)
}
fn key() -> OutgoingAckKey {
    OutgoingAckKey::new(
        OriginIdentity {
            profile_id: ProfileId::new(),
            device_id: DeviceId::new(),
            restoration_epoch: Uuid::new_v4(),
        },
        DeviceId::new(),
    )
    .unwrap()
}
fn cursor(seq: u64) -> OriginCursor {
    OriginCursor {
        seq,
        hash: format!("{:064x}", seq + 1),
    }
}

#[test]
fn outgoing_ack_register_no_ack_and_lost_ack_remain_distinct_after_restart() {
    let (root, mut db) = database();
    let key = key();
    assert!(matches!(
        load(&db, &key),
        Err(HostError::PeerSyncRecoveryRequired)
    ));
    let initial = register(&mut db, &key).unwrap();
    assert!(initial.cursor().is_none());
    assert_eq!(initial.key(), &key);
    // Observing a cursor/producing a page isn't receiving its ACK.
    fence(&initial, &cursor(5)).unwrap();
    assert!(load(&db, &key).unwrap().cursor().is_none());
    drop(db);
    let mut reopened = Connection::open(root.path().join("auth.sqlite3")).unwrap();
    super::super::membership_store::migrate(&mut reopened).unwrap();
    assert!(register(&mut reopened, &key).unwrap().cursor().is_none());
    confirm(&mut reopened, &key, &cursor(5)).unwrap();
    drop(reopened);
    let db = Connection::open(root.path().join("auth.sqlite3")).unwrap();
    assert_eq!(load(&db, &key).unwrap().cursor(), Some(&cursor(5)));
}

#[test]
fn outgoing_ack_fence_uses_rpc_baseline_and_late_confirm_is_monotonic() {
    let (_root, mut db) = database();
    let key = key();
    register(&mut db, &key).unwrap();
    confirm(&mut db, &key, &cursor(5)).unwrap();
    let before_rpc = load(&db, &key).unwrap();
    confirm(&mut db, &key, &cursor(10)).unwrap();
    fence(&before_rpc, &cursor(5)).unwrap();
    assert_eq!(confirm(&mut db, &key, &cursor(5)).unwrap(), cursor(10));
    assert!(matches!(
        fence(&load(&db, &key).unwrap(), &cursor(5)),
        Err(HostError::PeerSyncResetRequired)
    ));
    assert!(matches!(
        fence(&before_rpc, &cursor(4)),
        Err(HostError::PeerSyncResetRequired)
    ));
    let fork = OriginCursor {
        seq: 5,
        hash: "f".repeat(64),
    };
    assert!(matches!(
        fence(&before_rpc, &fork),
        Err(HostError::PeerSyncResetRequired)
    ));
    let fork = OriginCursor {
        seq: 10,
        hash: "f".repeat(64),
    };
    assert!(matches!(
        confirm(&mut db, &key, &fork),
        Err(HostError::PeerSyncResetRequired)
    ));
    assert_eq!(load(&db, &key).unwrap().cursor(), Some(&cursor(10)));
    for bad in [
        OriginCursor {
            seq: 11,
            hash: "A".repeat(64),
        },
        OriginCursor {
            seq: u64::MAX,
            hash: "0".repeat(64),
        },
        OriginCursor {
            seq: 0,
            hash: String::new(),
        },
    ] {
        assert!(matches!(
            confirm(&mut db, &key, &bad),
            Err(HostError::InvalidRequest)
        ));
        assert!(matches!(
            fence(&before_rpc, &bad),
            Err(HostError::InvalidRequest)
        ));
    }
}

#[test]
fn outgoing_ack_real_sql_failures_preserve_highwater_and_registration_count() {
    let (_root, mut db) = database();
    let key = key();
    register(&mut db, &key).unwrap();
    confirm(&mut db, &key, &cursor(5)).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_ack BEFORE UPDATE ON peer_sync_ack BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
    assert!(matches!(
        confirm(&mut db, &key, &cursor(10)),
        Err(HostError::PeerSyncUnavailable)
    ));
    assert_eq!(load(&db, &key).unwrap().cursor(), Some(&cursor(5)));
    db.execute_batch("DROP TRIGGER refuse_ack").unwrap();
    db.execute_batch("CREATE TRIGGER refuse_register BEFORE UPDATE ON peer_sync_ack_layout BEGIN SELECT RAISE(ABORT,'fixture'); END").unwrap();
    let another = OutgoingAckKey::new(key.origin.clone(), DeviceId::new()).unwrap();
    assert!(matches!(
        register(&mut db, &another),
        Err(HostError::PeerSyncUnavailable)
    ));
    let count: i64 = db
        .query_row(
            "SELECT registered_count FROM peer_sync_ack_layout",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let rows: i64 = db
        .query_row("SELECT count(*) FROM peer_sync_ack", [], |r| r.get(0))
        .unwrap();
    assert_eq!((count, rows), (1, 1));
    db.execute_batch("DROP TRIGGER refuse_register").unwrap();
    register(&mut db, &another).unwrap();
    assert_eq!(load(&db, &key).unwrap().cursor(), Some(&cursor(5)));
}

#[test]
fn outgoing_ack_missing_row_bad_hash_and_oversized_values_never_become_empty_baseline() {
    for fault in [
        "missing",
        "hash",
        "sequence",
        "oversized",
        "table",
        "layout",
    ] {
        let (root, mut db) = database();
        let key = key();
        register(&mut db, &key).unwrap();
        confirm(&mut db, &key, &cursor(5)).unwrap();
        match fault{
            "missing"=>db.execute_batch("DELETE FROM peer_sync_ack").unwrap(),
            "hash"=>db.execute_batch("PRAGMA ignore_check_constraints=ON;UPDATE peer_sync_ack SET ack_hash=printf('%063d',0)||'x';PRAGMA ignore_check_constraints=OFF").unwrap(),
            "sequence"=>db.execute_batch("PRAGMA ignore_check_constraints=ON;UPDATE peer_sync_ack SET ack_seq=-1;PRAGMA ignore_check_constraints=OFF").unwrap(),
            "oversized"=>db.execute_batch("PRAGMA ignore_check_constraints=ON;UPDATE peer_sync_ack SET ack_hash=printf('%.*c',32768,'x');PRAGMA ignore_check_constraints=OFF").unwrap(),
            "table"=>db.execute_batch("DROP TABLE peer_sync_ack").unwrap(),
            "layout"=>db.execute_batch("DELETE FROM peer_sync_ack_layout").unwrap(),
            _=>unreachable!(),
        }
        let previous = db.limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH);
        assert!(
            matches!(load(&db, &key), Err(HostError::PeerSyncRecoveryRequired)),
            "{fault}"
        );
        assert_eq!(
            db.limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH),
            previous
        );
        assert!(matches!(
            register(&mut db, &key),
            Err(HostError::PeerSyncRecoveryRequired)
        ));
        drop(db);
        let mut reopened = Connection::open(root.path().join("auth.sqlite3")).unwrap();
        assert!(
            matches!(
                super::super::membership_store::migrate(&mut reopened),
                Err(HostError::PeerSyncRecoveryRequired)
            ),
            "{fault}"
        );
    }
}

#[test]
fn outgoing_ack_auth_two_upgrade_preserves_signed_invitation_owner_and_grants() {
    let root = tempdir().unwrap();
    let host = BetaHost::open(root.path()).unwrap();
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    let invitation = host
        .create_peer_invitation(
            &owner,
            &crate::CreatePeerInvitation {
                invitation_id: Uuid::new_v4(),
                profile_id: profile,
                capabilities: crate::PeerCapabilities::FULL,
                candidates: vec!["127.0.0.1:5589".parse().unwrap()],
                ttl_seconds: 60,
            },
        )
        .unwrap()
        .invitation
        .unwrap();
    let grant = host
        .grant(
            &owner,
            GrantRequest {
                profile_id: profile,
                kind: GrantKind::Observer,
                agent_id: None,
            },
        )
        .unwrap();
    host.stop().unwrap();
    let path = root.path().join("host-auth.sqlite3");
    let db = Connection::open(&path).unwrap();
    let before: String = db
        .query_row(
            "SELECT body FROM peer_invitations WHERE id=?1",
            [invitation.offer.invitation_id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    let owner_hash: String = db
        .query_row("SELECT token_hash FROM owner", [], |r| r.get(0))
        .unwrap();
    db.execute_batch(
        "DROP TABLE peer_connection_endpoints;DROP TABLE peer_connections;DROP TABLE peer_environments;DROP TABLE peer_original_auto_backoff;DROP TABLE peer_original_auto_intents;DROP TABLE peer_original_auto_policy;DROP TABLE peer_original_auto_revisions;DROP TABLE peer_sync_ack;DROP TABLE peer_sync_ack_layout;DROP TABLE peer_network_routes;DROP TABLE peer_network_settings;DROP TABLE peer_environment_alias;DROP TABLE peer_environment_alias_claims;PRAGMA user_version=2",
    )
    .unwrap();
    drop(db);
    let reopened = BetaHost::open(root.path()).unwrap();
    assert!(reopened.authenticate(&grant.token).is_ok());
    assert_eq!(
        reopened
            .peer_invitation_status(
                &reopened.owner_session().unwrap(),
                invitation.offer.invitation_id
            )
            .unwrap()
            .offer,
        invitation.offer
    );
    reopened.stop().unwrap();
    let db = Connection::open(path).unwrap();
    let after: String = db
        .query_row(
            "SELECT body FROM peer_invitations WHERE id=?1",
            [invitation.offer.invitation_id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    assert!(before == after);
    let after_owner: String = db
        .query_row("SELECT token_hash FROM owner", [], |r| r.get(0))
        .unwrap();
    assert!(owner_hash == after_owner);
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, super::super::membership_store::AUTH_VERSION);
}

#[test]
fn outgoing_ack_schema_three_loss_or_mixed_schema_two_is_not_an_upgrade() {
    let (_root, mut db) = database();
    db.execute_batch("PRAGMA user_version=2").unwrap();
    assert!(matches!(
        super::super::membership_store::migrate(&mut db),
        Err(HostError::PeerSyncRecoveryRequired)
    ));
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 2);
    let root = tempdir().unwrap();
    let host = BetaHost::open(root.path()).unwrap();
    host.stop().unwrap();
    let path = root.path().join("host-auth.sqlite3");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE peer_sync_ack").unwrap();
    drop(db);
    assert!(matches!(
        BetaHost::open(root.path()),
        Err(HostError::PeerSyncRecoveryRequired)
    ));
    let db = Connection::open(&path).unwrap();
    let absent: bool = db
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name='peer_sync_ack')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(absent);
}

#[test]
fn outgoing_ack_key_survives_new_member_generation_and_isolates_target_and_origin_epoch() {
    let (_root, mut db) = database();
    let key = key();
    register(&mut db, &key).unwrap();
    confirm(&mut db, &key, &cursor(9)).unwrap();
    let old = super::super::membership::StoredMember {
        record: crate::PeerMember {
            profile_id: key.origin.profile_id,
            device_id: key.target,
            pin: "0".repeat(64),
            capabilities: crate::PeerCapabilities::FULL,
            generation: 1,
            revoked: false,
            state: crate::PeerJoinState::Ready,
        },
        claim_id: Some(Uuid::new_v4()),
    };
    super::super::membership_store::save_member(&db, &old).unwrap();
    let mut replacement = old.clone();
    replacement.record.generation = 4;
    replacement.claim_id = Some(Uuid::new_v4());
    super::super::membership_store::save_member(&db, &replacement).unwrap();
    assert_eq!(register(&mut db, &key).unwrap().cursor(), Some(&cursor(9)));
    let other = OutgoingAckKey::new(key.origin.clone(), DeviceId::new()).unwrap();
    assert!(register(&mut db, &other).unwrap().cursor().is_none());
    let epoch = OutgoingAckKey::new(
        OriginIdentity {
            restoration_epoch: Uuid::new_v4(),
            ..key.origin.clone()
        },
        key.target,
    )
    .unwrap();
    assert!(register(&mut db, &epoch).unwrap().cursor().is_none());
    assert_eq!(load(&db, &key).unwrap().cursor(), Some(&cursor(9)));
    assert!(OutgoingAckKey::new(key.origin.clone(), key.origin.device_id).is_err());
    assert!(
        OutgoingAckKey::new(
            OriginIdentity {
                restoration_epoch: Uuid::nil(),
                ..key.origin.clone()
            },
            key.target
        )
        .is_err()
    );
}
