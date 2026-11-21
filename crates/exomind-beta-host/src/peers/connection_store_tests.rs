use super::*;
use crate::{
    BetaHost, GrantKind, GrantRequest, HostError,
    peers::sync_store::{OutgoingAckKey, confirm, register},
    peers::{PeerCapabilities, PeerJoinState},
};
use exomind_core::{DeviceId, OriginCursor, OriginIdentity, ProfileId};
use rusqlite::{Connection, params};
use serde_json::json;
use std::{net::SocketAddr, sync::Arc};
use tempfile::{TempDir, tempdir};
use uuid::Uuid;

fn store() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory SQLite");
    create_v7_schema(&connection).expect("v7 schema");
    connection
}

fn member(profile_id: ProfileId, device_id: DeviceId) -> PeerMember {
    PeerMember {
        profile_id,
        device_id,
        pin: "a".repeat(64),
        capabilities: PeerCapabilities::FULL,
        generation: 1,
        revoked: false,
        state: PeerJoinState::Ready,
    }
}

fn route(profile: ProfileId, device: DeviceId, endpoints: &[&str]) -> Route {
    Route {
        profile,
        device,
        endpoints: endpoints
            .iter()
            .map(|endpoint| endpoint.parse::<SocketAddr>().expect("valid endpoint"))
            .collect(),
    }
}

fn expect_recovery(result: Result<(), HostError>) {
    assert!(matches!(
        result,
        Err(HostError::PeerSyncRecoveryRequired) | Err(HostError::PeerMembershipRecoveryRequired)
    ));
}

fn create_v7_auth_database(local: DeviceId) -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "PRAGMA synchronous=FULL;
             PRAGMA user_version=1;
             CREATE TABLE owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),token_hash TEXT NOT NULL);
             CREATE TABLE grants(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,kind TEXT NOT NULL,agent_id TEXT,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
             INSERT INTO owner VALUES(1,'a0b1c2d3');
             INSERT INTO grants VALUES('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','observer',NULL,'observer-token-hash',0);",
        )
        .unwrap();
    membership_store::migrate_for_device(&mut connection, local, 1_000).unwrap();
    connection
}

fn downgrade_to_v6(connection: &Connection) {
    connection
        .execute_batch(
            "DROP TABLE peer_connection_endpoints;
             DROP TABLE peer_connections;
             DROP TABLE peer_environments;
             PRAGMA user_version=6;",
        )
        .unwrap();
}

fn preserved_v6_snapshot(connection: &Connection) -> serde_json::Value {
    let owner: String = connection
        .query_row(
            "SELECT token_hash FROM owner WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let grant: (String, String, String, Option<String>, String, i64) = connection
        .query_row(
            "SELECT id,profile_id,kind,agent_id,token_hash,revoked FROM grants",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();
    let members: Vec<(String, String, String)> = {
        let mut statement = connection
            .prepare(
                "SELECT profile_id,device_id,body FROM peer_members ORDER BY profile_id,device_id",
            )
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let routes: Vec<(String, String, String)> = {
        let mut statement = connection
            .prepare(
                "SELECT profile_id,device_id,endpoints FROM peer_network_routes ORDER BY profile_id,device_id",
            )
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let network_settings: (String, i64, i64, i64) = connection
        .query_row(
            "SELECT layout,enabled,preferred_port,route_count FROM peer_network_settings WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    let alias: (Option<String>, i64, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT custom_alias,revision,last_effective_alias,last_source FROM peer_environment_alias WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    let alias_claim: (String, String, String, String, i64, i64, Option<i64>) = connection
        .query_row(
            "SELECT device_id,pin,effective_alias,alias_source,alias_revision,observed_at_ms,confirmed_at_ms FROM peer_environment_alias_claims",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .unwrap();
    let sync_ack: (String, String, String, String, Option<i64>, Option<String>) = connection
        .query_row(
            "SELECT profile_id,origin_device,origin_epoch,target_device,ack_seq,ack_hash FROM peer_sync_ack",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();
    let original_policy: (String, String, i64, u64, String) = connection
        .query_row(
            "SELECT layout,revision,enabled,max_bytes,input_digest FROM peer_original_auto_policy WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .unwrap();
    json!({
        "owner": owner,
        "grant": grant,
        "members": members,
        "routes": routes,
        "network_settings": network_settings,
        "alias": alias,
        "alias_claim": alias_claim,
        "sync_ack": sync_ack,
        "original_policy": original_policy,
    })
}

fn v6_database_with_authoritative_data(
    local: DeviceId,
) -> (Connection, ProfileId, DeviceId, DeviceId) {
    let mut connection = create_v7_auth_database(local);
    let profile = "11111111-1111-4111-8111-111111111111"
        .parse::<ProfileId>()
        .unwrap();
    let profile_b = "22222222-2222-4222-8222-222222222222"
        .parse::<ProfileId>()
        .unwrap();
    let remote = DeviceId::new();
    let member_only = DeviceId::new();
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    membership_store::save_member(
        &tx,
        &super::super::membership::StoredMember {
            record: member(profile, remote),
            claim_id: None,
        },
    )
    .unwrap();
    membership_store::save_member(
        &tx,
        &super::super::membership::StoredMember {
            record: member(profile_b, remote),
            claim_id: None,
        },
    )
    .unwrap();
    membership_store::save_member(
        &tx,
        &super::super::membership::StoredMember {
            record: member(profile, member_only),
            claim_id: None,
        },
    )
    .unwrap();
    membership_store::save_member(
        &tx,
        &super::super::membership::StoredMember {
            record: member(profile, local),
            claim_id: None,
        },
    )
    .unwrap();
    super::super::network_store::save_route(
        &tx,
        &route(profile, remote, &["10.30.0.2:43344", "10.30.0.3:43344"]),
    )
    .unwrap();
    super::super::network_store::save_route(
        &tx,
        &route(profile_b, remote, &["10.30.0.3:43344", "[fd00::2]:43344"]),
    )
    .unwrap();
    super::super::network_store::save_route(&tx, &route(profile, local, &["127.0.0.1:43344"]))
        .unwrap();
    super::super::network_store::save_settings(
        &tx,
        super::super::PeerNetworkSettings {
            enabled: true,
            preferred_port: 45555,
        },
    )
    .unwrap();
    super::super::network_store::save_custom_environment_alias(&tx, Some("Studio")).unwrap();
    super::super::network_store::save_observed_alias(
        &tx,
        remote,
        &"b".repeat(64),
        "Remote Studio",
        super::super::network_management::EnvironmentAliasSource::Custom,
        7,
        9_000,
    )
    .unwrap();
    super::super::network_store::confirm_alias_claim(
        &tx,
        remote,
        &"b".repeat(64),
        "Remote Studio",
        super::super::network_management::EnvironmentAliasSource::Custom,
        7,
        9_100,
    )
    .unwrap();
    tx.commit().unwrap();

    let origin = OriginIdentity {
        profile_id: profile,
        device_id: remote,
        restoration_epoch: Uuid::new_v4(),
    };
    let key = OutgoingAckKey::new(origin, DeviceId::new()).unwrap();
    register(&mut connection, &key).unwrap();
    confirm(
        &mut connection,
        &key,
        &OriginCursor {
            seq: 42,
            hash: "c".repeat(64),
        },
    )
    .unwrap();
    downgrade_to_v6(&connection);
    (connection, profile, remote, member_only)
}

#[test]
fn v6_to_v7_preserves_authoritative_tables_and_builds_shared_topology() {
    let local = DeviceId::new();
    let (mut connection, profile, remote, member_only) = v6_database_with_authoritative_data(local);
    let before = preserved_v6_snapshot(&connection);

    membership_store::migrate_for_device(&mut connection, local, 1_000).unwrap();

    assert_eq!(preserved_v6_snapshot(&connection), before);
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, membership_store::AUTH_VERSION);
    let environments = list_environments(&connection).unwrap();
    assert_eq!(environments.len(), 2);
    assert!(environments.iter().any(|row| row.device_id == remote));
    assert!(environments.iter().any(|row| row.device_id == member_only));
    assert!(!environments.iter().any(|row| row.device_id == local));
    let connections = list_connections(&connection).unwrap();
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].remote_device_id, remote);
    assert_eq!(connections[0].kind, ConnectionKind::Legacy);
    assert!(connections[0].local_enabled);
    assert_eq!(connections[0].remote_enabled_observed, None);
    assert_eq!(connections[0].last_test_state, LastTestState::Untested);
    assert_eq!(
        connections[0].endpoints,
        vec![
            "10.30.0.2:43344".parse::<SocketAddr>().unwrap(),
            "10.30.0.3:43344".parse::<SocketAddr>().unwrap(),
            "[fd00::2]:43344".parse::<SocketAddr>().unwrap(),
        ]
    );
    assert_eq!(connections[0].endpoints.len(), 3);
    assert!(profile.to_string().len() == 36);
}

#[test]
fn v6_to_v7_failure_rolls_back_all_new_tables_and_keeps_version_six() {
    let local = DeviceId::new();
    let (mut connection, _profile, _remote, _member_only) =
        v6_database_with_authoritative_data(local);
    connection
        .execute("UPDATE peer_members SET body='{' WHERE rowid=1", [])
        .unwrap();
    let route_before: String = connection
        .query_row(
            "SELECT endpoints FROM peer_network_routes ORDER BY profile_id,device_id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert!(matches!(
        membership_store::migrate_for_device(&mut connection, local, 1_000),
        Err(HostError::PeerMembershipRecoveryRequired)
    ));

    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 6);
    for table in [
        "peer_environments",
        "peer_connections",
        "peer_connection_endpoints",
    ] {
        let present: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!present, "{table} leaked from a failed migration");
    }
    let route_after: String = connection
        .query_row(
            "SELECT endpoints FROM peer_network_routes ORDER BY profile_id,device_id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(route_after, route_before);
}

#[test]
fn remote_enabled_is_unknown_or_observed_with_a_timestamp_but_never_inferred() {
    let mut connection = store();
    let remote = DeviceId::new();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [remote.to_string()],
        )
        .unwrap();
    let id = Uuid::new_v4();
    connection
        .execute(
            "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'manual',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
            params![id.to_string(), remote.to_string()],
        )
        .unwrap();
    set_local_enabled_cas(&mut connection, id, 0, false, 10).unwrap();
    let row = list_connections(&connection).unwrap().remove(0);
    assert_eq!(row.remote_enabled_observed, None);
    connection
        .execute(
            "UPDATE peer_connections SET remote_enabled_observed=1,remote_state_observed_at_ms=11 WHERE connection_id=?1",
            [id.to_string()],
        )
        .unwrap();
    let row = list_connections(&connection).unwrap().remove(0);
    assert_eq!(row.remote_enabled_observed, Some(true));
    assert_eq!(row.remote_state_observed_at_ms, Some(11));

    connection
        .pragma_update(None, "ignore_check_constraints", true)
        .unwrap();
    connection
        .execute(
            "UPDATE peer_connections SET remote_state_observed_at_ms=NULL WHERE connection_id=?1",
            [id.to_string()],
        )
        .unwrap();
    expect_recovery(validate_v7_schema(&connection));
}

fn host_with_route() -> (TempDir, Arc<BetaHost>, crate::Session, ProfileId, DeviceId) {
    let root = tempdir().unwrap();
    let host = Arc::new(BetaHost::open(root.path()).unwrap());
    let owner = host.owner_session().unwrap();
    let profile = ProfileId::new();
    let remote = DeviceId::new();
    host.provision_profile(&owner, profile, "synthetic")
        .unwrap();
    {
        let mut state = host.state().unwrap();
        let resources = state.resources.as_mut().unwrap();
        let tx = membership_store::transaction(&mut resources.persistence.auth).unwrap();
        membership_store::save_member_for_device(
            &tx,
            &super::super::membership::StoredMember {
                record: member(profile, remote),
                claim_id: None,
            },
            host.device_id,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    host.save_peer_routes(
        &owner,
        profile,
        remote,
        vec!["192.0.2.40:43344".parse().unwrap()],
    )
    .unwrap();
    (root, host, owner, profile, remote)
}

#[test]
fn topology_merges_profiles_by_device_and_deduplicates_endpoints_in_source_order() {
    let mut connection = store();
    let local = DeviceId::new();
    let remote = DeviceId::new();
    let profile_a = "11111111-1111-4111-8111-111111111111"
        .parse::<ProfileId>()
        .unwrap();
    let profile_b = "22222222-2222-4222-8222-222222222222"
        .parse::<ProfileId>()
        .unwrap();
    let members = [member(profile_a, remote), member(profile_b, remote)];
    let routes = [
        route(profile_a, remote, &["10.0.0.2:4000", "10.0.0.3:4001"]),
        route(profile_b, remote, &["10.0.0.3:4001", "[fd00::2]:4002"]),
    ];

    ensure_topology_from_verified(&mut connection, local, &members, &routes, 1234)
        .expect("build topology");

    let environments = list_environments(&connection).expect("list environments");
    assert_eq!(environments.len(), 1);
    assert_eq!(environments[0].device_id, remote);
    let connections = list_connections(&connection).expect("list connections");
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].kind, ConnectionKind::Legacy);
    assert_eq!(connections[0].remote_device_id, remote);
    assert!(connections[0].local_enabled);
    assert_eq!(connections[0].remote_enabled_observed, None);
    assert_eq!(connections[0].last_test_state, LastTestState::Untested);
    assert_eq!(
        connections[0].endpoints,
        vec![
            "10.0.0.2:4000".parse::<SocketAddr>().unwrap(),
            "10.0.0.3:4001".parse::<SocketAddr>().unwrap(),
            "[fd00::2]:4002".parse::<SocketAddr>().unwrap(),
        ]
    );
}

#[test]
fn member_only_and_route_only_devices_create_independent_legacy_connections() {
    let mut connection = store();
    let local = DeviceId::new();
    let member_only = DeviceId::new();
    let route_only = DeviceId::new();
    let profile = ProfileId::new();
    let members = [member(profile, member_only)];
    let routes = [route(profile, route_only, &["192.0.2.9:4312"])];

    ensure_topology_from_verified(&mut connection, local, &members, &routes, 88)
        .expect("build topology");

    let connections = list_connections(&connection).expect("list connections");
    assert_eq!(connections.len(), 1);
    let environments = list_environments(&connection).expect("list environments");
    assert_eq!(environments.len(), 2);
    assert!(environments.iter().any(|row| row.device_id == member_only));
    let route_row = connections
        .iter()
        .find(|row| row.remote_device_id == route_only)
        .expect("route-only row");
    assert_eq!(route_row.endpoints, vec!["192.0.2.9:4312".parse().unwrap()]);
    assert_eq!(route_row.remote_enabled_observed, None);
    assert_eq!(route_row.last_test_state, LastTestState::Untested);
}

#[test]
fn topology_is_idempotent_and_appends_new_legacy_endpoints_without_reordering_old_ones() {
    let mut connection = store();
    let remote = DeviceId::new();
    let profile_a = ProfileId::new();
    let profile_b = ProfileId::new();
    let routes_a = [route(profile_a, remote, &["10.1.0.2:4000"])];
    ensure_topology_from_verified(&mut connection, DeviceId::new(), &[], &routes_a, 1)
        .expect("initial topology");
    let routes_b = [route(profile_b, remote, &["10.1.0.3:4001"])];
    ensure_topology_from_verified(&mut connection, DeviceId::new(), &[], &routes_b, 2)
        .expect("incremental topology");
    ensure_topology_from_verified(&mut connection, DeviceId::new(), &[], &routes_b, 3)
        .expect("repeated topology");

    let rows = list_connections(&connection).expect("list connections");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].endpoints.len(), 2);
    assert_eq!(rows[0].endpoints[0].to_string(), "10.1.0.2:4000");
    assert_eq!(rows[0].endpoints[1].to_string(), "10.1.0.3:4001");
}

#[test]
fn local_enabled_compare_and_swap_advances_revision_and_rejects_stale_revision() {
    let mut connection = store();
    let remote = DeviceId::new();
    let profile = ProfileId::new();
    let routes = [route(profile, remote, &["10.2.0.2:4000"])];
    ensure_topology_from_verified(&mut connection, DeviceId::new(), &[], &routes, 10)
        .expect("topology");
    let row = list_connections(&connection)
        .expect("list connections")
        .remove(0);

    let updated = set_local_enabled_cas(&mut connection, row.connection_id, 0, false, 20)
        .expect("compare and swap");
    assert!(!updated.local_enabled);
    assert_eq!(updated.revision, 1);
    assert_eq!(updated.remote_enabled_observed, None);
    assert!(matches!(
        set_local_enabled_cas(&mut connection, row.connection_id, 0, true, 30),
        Err(HostError::PeerMembershipConflict)
    ));
}

#[test]
fn host_topology_api_is_owner_only_and_disable_keeps_membership_and_remote_unknown() {
    let (_root, host, owner, profile, remote) = host_with_route();
    let environments = host.peer_environments(&owner).unwrap();
    assert_eq!(environments.len(), 1);
    assert_eq!(environments[0].device_id, remote);
    let before = host.peer_connections(&owner).unwrap();
    assert_eq!(before.len(), 1);
    assert!(before[0].local_enabled);
    assert_eq!(before[0].remote_enabled_observed, None);

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
    let grant_session = host.authenticate(&grant.token).unwrap();
    assert!(matches!(
        host.peer_environments(&grant_session),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.peer_connections(&grant_session),
        Err(HostError::Forbidden)
    ));
    assert!(matches!(
        host.set_peer_connection_enabled(
            &grant_session,
            before[0].connection_id,
            before[0].revision,
            false
        ),
        Err(HostError::Forbidden)
    ));

    let updated = host
        .set_peer_connection_enabled(&owner, before[0].connection_id, 0, false)
        .unwrap();
    assert!(!updated.local_enabled);
    assert_eq!(updated.revision, 1);
    assert_eq!(updated.remote_enabled_observed, None);
    assert!(matches!(
        host.set_peer_connection_enabled(&owner, before[0].connection_id, 0, true),
        Err(HostError::PeerMembershipConflict)
    ));

    let member = host.peer_members(&owner, profile).unwrap();
    assert_eq!(member.len(), 1);
    assert_eq!(member[0].generation, 1);
    assert!(!member[0].revoked);
    assert_eq!(member[0].state, PeerJoinState::Ready);

    let payload = serde_json::to_value(&updated).unwrap();
    assert_eq!(payload["kind"], "legacy");
    assert_eq!(payload["last_test_state"], "untested");
    assert_eq!(payload["remote_enabled_observed"], serde_json::Value::Null);
    assert_eq!(payload["endpoints"][0], "192.0.2.40:43344");
}

#[test]
fn validate_rejects_noncanonical_or_malformed_uuid_fields() {
    let connection = store();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [DeviceId::new().to_string()],
        )
        .expect("valid environment");
    connection
        .pragma_update(None, "ignore_check_constraints", true)
        .expect("ignore checks for corruption fixture");
    connection
        .execute("UPDATE peer_environments SET device_id='bad-device-id'", [])
        .expect("corrupt stored key");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn validate_rejects_unknown_enum_values_even_when_sqlite_checks_are_bypassed() {
    let connection = store();
    let remote = DeviceId::new();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [remote.to_string()],
        )
        .expect("environment");
    let id = Uuid::new_v4();
    connection
        .execute(
            "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'legacy',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
            params![id.to_string(), remote.to_string()],
        )
        .expect("connection");
    connection
        .pragma_update(None, "ignore_check_constraints", true)
        .expect("ignore checks for corruption fixture");
    connection
        .execute(
            "UPDATE peer_connections SET kind='unknown_kind' WHERE connection_id=?1",
            [id.to_string()],
        )
        .expect("corrupt enum");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn validate_rejects_malformed_socket_addresses() {
    let connection = store();
    let remote = DeviceId::new();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [remote.to_string()],
        )
        .expect("environment");
    let id = Uuid::new_v4();
    connection
        .execute(
            "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'legacy',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
            params![id.to_string(), remote.to_string()],
        )
        .expect("connection");
    connection
        .execute(
            "INSERT INTO peer_connection_endpoints(connection_id,ordinal,endpoint) VALUES(?1,0,'not-an-socket')",
            [id.to_string()],
        )
        .expect("malformed endpoint is stored for read validation");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn validate_rejects_more_than_maximum_environments() {
    let connection = store();
    let transaction = connection.unchecked_transaction().expect("transaction");
    for _ in 0..=MAX_ENVIRONMENTS {
        transaction
            .execute(
                "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
                [DeviceId::new().to_string()],
            )
            .expect("environment row");
    }
    transaction.commit().expect("commit");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn validate_rejects_more_than_maximum_connections() {
    let connection = store();
    let remote = DeviceId::new();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [remote.to_string()],
        )
        .expect("environment");
    let transaction = connection.unchecked_transaction().expect("transaction");
    for _ in 0..=MAX_CONNECTIONS {
        transaction
            .execute(
                "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'manual',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
                params![Uuid::new_v4().to_string(), remote.to_string()],
            )
            .expect("connection row");
    }
    transaction.commit().expect("commit");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn validate_rejects_more_than_maximum_endpoint_rows() {
    let connection = store();
    let remote = DeviceId::new();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [remote.to_string()],
        )
        .expect("environment");
    let id = Uuid::new_v4();
    connection
        .execute(
            "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'legacy',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
            params![id.to_string(), remote.to_string()],
        )
        .expect("connection");
    let transaction = connection.unchecked_transaction().expect("transaction");
    for ordinal in 0..=MAX_ENDPOINTS {
        transaction
            .execute(
                "INSERT INTO peer_connection_endpoints(connection_id,ordinal,endpoint) VALUES(?1,?2,?3)",
                params![id.to_string(), ordinal as i64, format!("10.0.0.2:{}", ordinal + 1)],
            )
            .expect("endpoint row");
    }
    transaction.commit().expect("commit");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn legacy_connection_endpoints_cannot_exceed_the_maximum_old_route_union() {
    let connection = store();
    let remote = DeviceId::new();
    connection
        .execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,0,0)",
            [remote.to_string()],
        )
        .expect("environment");
    let id = Uuid::new_v4();
    connection
        .execute(
            "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'legacy',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
            params![id.to_string(), remote.to_string()],
        )
        .expect("legacy connection");
    let transaction = connection.unchecked_transaction().expect("transaction");
    for ordinal in 0..=MAX_LEGACY_ENDPOINTS {
        transaction
            .execute(
                "INSERT INTO peer_connection_endpoints(connection_id,ordinal,endpoint) VALUES(?1,?2,?3)",
                params![id.to_string(), ordinal as i64, format!("10.0.0.1:{}", ordinal + 1)],
            )
            .expect("legacy endpoint");
    }
    transaction.commit().expect("commit");

    expect_recovery(validate_v7_schema(&connection));
}

#[test]
fn validate_rejects_partial_v7_tables_and_weakened_ddl() {
    let partial = store();
    partial
        .execute_batch("DROP TABLE peer_connection_endpoints")
        .expect("remove one v7 table");
    expect_recovery(validate_v7_schema(&partial));

    let weakened = store();
    weakened
        .execute_batch(
            "DROP TABLE peer_connection_endpoints;
             DROP TABLE peer_connections;
             DROP TABLE peer_environments;
             CREATE TABLE peer_environments(device_id TEXT PRIMARY KEY);",
        )
        .expect("replace with weakened environment schema");
    expect_recovery(validate_v7_schema(&weakened));
}

#[test]
fn v6_migration_rejects_a_partial_v7_table_without_advancing_the_version() {
    let local = DeviceId::new();
    let mut connection = create_v7_auth_database(local);
    downgrade_to_v6(&connection);
    connection
        .execute_batch("CREATE TABLE peer_environments(device_id TEXT)")
        .expect("create a partial v7 artifact");

    assert!(matches!(
        membership_store::migrate_for_device(&mut connection, local, 1_000),
        Err(HostError::PeerSyncRecoveryRequired)
    ));
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 6);
    let environment_schema: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='peer_environments'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        environment_schema,
        "CREATE TABLE peer_environments(device_id TEXT)"
    );
    for table in ["peer_connections", "peer_connection_endpoints"] {
        let present: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!present, "unexpected migration artifact: {table}");
    }
}

#[test]
fn ordinary_connections_are_limited_to_eight_endpoints() {
    let mut connection = store();
    let remote = DeviceId::new();
    let profile = ProfileId::new();
    let members: [PeerMember; 0] = [];
    let route = route(
        profile,
        remote,
        &[
            "10.3.0.1:4001",
            "10.3.0.2:4002",
            "10.3.0.3:4003",
            "10.3.0.4:4004",
            "10.3.0.5:4005",
            "10.3.0.6:4006",
            "10.3.0.7:4007",
            "10.3.0.8:4008",
        ],
    );
    ensure_topology_from_verified(&mut connection, DeviceId::new(), &members, &[route], 1)
        .expect("legacy may accept source endpoint count");
    let row = list_connections(&connection).expect("legacy row").remove(0);
    assert_eq!(row.endpoints.len(), 8);

    let id = Uuid::new_v4();
    connection
        .execute(
            "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,'manual',1,NULL,NULL,NULL,NULL,'untested',NULL,NULL,NULL,0,0,0)",
            params![id.to_string(), remote.to_string()],
        )
        .expect("manual connection");
    let transaction = connection.unchecked_transaction().expect("transaction");
    for ordinal in 0..9 {
        transaction
            .execute(
                "INSERT INTO peer_connection_endpoints(connection_id,ordinal,endpoint) VALUES(?1,?2,?3)",
                params![id.to_string(), ordinal, format!("10.4.0.{}:{}", ordinal + 1, 5000 + ordinal)],
            )
            .expect("ordinary endpoint");
    }
    transaction.commit().expect("commit");

    expect_recovery(validate_v7_schema(&connection));
}
