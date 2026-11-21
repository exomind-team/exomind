use super::{PeerMember, membership_store, network_store::Route};
use crate::HostError;
use exomind_core::DeviceId;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    net::SocketAddr,
    str::FromStr,
};
use uuid::Uuid;

pub(super) const MAX_ENVIRONMENTS: usize = 512;
pub(super) const MAX_CONNECTIONS: usize = 4096;
pub(super) const MAX_ENDPOINTS: usize = 32768;

const MAX_SOURCE_ROWS: usize = 256;
const MAX_LEGACY_ENDPOINTS: usize = MAX_SOURCE_ROWS * 8;
const MAX_ERROR_CODE_CHARS: usize = 64;

const ENVIRONMENT_SCHEMA: &str = "CREATE TABLE peer_environments(device_id TEXT PRIMARY KEY CHECK(typeof(device_id)='text' AND length(device_id)=36),created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>=0),updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>=created_at_ms))";
const CONNECTION_SCHEMA: &str = "CREATE TABLE peer_connections(connection_id TEXT PRIMARY KEY CHECK(typeof(connection_id)='text' AND length(connection_id)=36),remote_device_id TEXT NOT NULL CHECK(typeof(remote_device_id)='text' AND length(remote_device_id)=36),kind TEXT NOT NULL CHECK(kind IN ('legacy','physical_lan','easytier','overlay','other','manual')),local_enabled INTEGER NOT NULL CHECK(typeof(local_enabled)='integer' AND local_enabled IN (0,1)),remote_enabled_observed INTEGER CHECK(remote_enabled_observed IS NULL OR (typeof(remote_enabled_observed)='integer' AND remote_enabled_observed IN (0,1))),remote_state_observed_at_ms INTEGER CHECK(remote_state_observed_at_ms IS NULL OR (typeof(remote_state_observed_at_ms)='integer' AND remote_state_observed_at_ms>=0)),preferred_endpoint TEXT CHECK(preferred_endpoint IS NULL OR (typeof(preferred_endpoint)='text' AND length(preferred_endpoint) BETWEEN 1 AND 128)),last_success_endpoint TEXT CHECK(last_success_endpoint IS NULL OR (typeof(last_success_endpoint)='text' AND length(last_success_endpoint) BETWEEN 1 AND 128)),last_test_state TEXT NOT NULL CHECK(last_test_state IN ('untested','testing','reachable','identity_mismatch','protocol_mismatch','membership_denied','connection_disabled','busy','timeout','unreachable')),last_test_error_code TEXT CHECK(last_test_error_code IS NULL OR (typeof(last_test_error_code)='text' AND length(last_test_error_code) BETWEEN 1 AND 64)),last_tested_at_ms INTEGER CHECK(last_tested_at_ms IS NULL OR (typeof(last_tested_at_ms)='integer' AND last_tested_at_ms>=0)),last_success_at_ms INTEGER CHECK(last_success_at_ms IS NULL OR (typeof(last_success_at_ms)='integer' AND last_success_at_ms>=0)),revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=0),created_at_ms INTEGER NOT NULL CHECK(typeof(created_at_ms)='integer' AND created_at_ms>=0),updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms>=created_at_ms),CHECK((remote_enabled_observed IS NULL AND remote_state_observed_at_ms IS NULL) OR (remote_enabled_observed IS NOT NULL AND remote_state_observed_at_ms IS NOT NULL)),CHECK((last_test_state='untested' AND last_tested_at_ms IS NULL AND last_test_error_code IS NULL) OR (last_test_state<>'untested' AND last_tested_at_ms IS NOT NULL)),FOREIGN KEY(remote_device_id) REFERENCES peer_environments(device_id))";
const ENDPOINT_SCHEMA: &str = "CREATE TABLE peer_connection_endpoints(connection_id TEXT NOT NULL CHECK(typeof(connection_id)='text' AND length(connection_id)=36),ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),endpoint TEXT NOT NULL CHECK(typeof(endpoint)='text' AND length(endpoint) BETWEEN 1 AND 128),PRIMARY KEY(connection_id,ordinal),UNIQUE(connection_id,endpoint),FOREIGN KEY(connection_id) REFERENCES peer_connections(connection_id))";
const SCHEMAS: &[(&str, &str)] = &[
    ("peer_environments", ENVIRONMENT_SCHEMA),
    ("peer_connections", CONNECTION_SCHEMA),
    ("peer_connection_endpoints", ENDPOINT_SCHEMA),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Legacy,
    PhysicalLan,
    EasyTier,
    Overlay,
    Other,
    Manual,
}

impl ConnectionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Legacy => "legacy",
            Self::PhysicalLan => "physical_lan",
            Self::EasyTier => "easytier",
            Self::Overlay => "overlay",
            Self::Other => "other",
            Self::Manual => "manual",
        }
    }

    fn parse(value: &str) -> Result<Self, HostError> {
        match value {
            "legacy" => Ok(Self::Legacy),
            "physical_lan" => Ok(Self::PhysicalLan),
            "easytier" => Ok(Self::EasyTier),
            "overlay" => Ok(Self::Overlay),
            "other" => Ok(Self::Other),
            "manual" => Ok(Self::Manual),
            _ => Err(recovery()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LastTestState {
    Untested,
    Testing,
    Reachable,
    IdentityMismatch,
    ProtocolMismatch,
    MembershipDenied,
    ConnectionDisabled,
    Busy,
    Timeout,
    Unreachable,
}

impl LastTestState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Untested => "untested",
            Self::Testing => "testing",
            Self::Reachable => "reachable",
            Self::IdentityMismatch => "identity_mismatch",
            Self::ProtocolMismatch => "protocol_mismatch",
            Self::MembershipDenied => "membership_denied",
            Self::ConnectionDisabled => "connection_disabled",
            Self::Busy => "busy",
            Self::Timeout => "timeout",
            Self::Unreachable => "unreachable",
        }
    }

    fn parse(value: &str) -> Result<Self, HostError> {
        match value {
            "untested" => Ok(Self::Untested),
            "testing" => Ok(Self::Testing),
            "reachable" => Ok(Self::Reachable),
            "identity_mismatch" => Ok(Self::IdentityMismatch),
            "protocol_mismatch" => Ok(Self::ProtocolMismatch),
            "membership_denied" => Ok(Self::MembershipDenied),
            "connection_disabled" => Ok(Self::ConnectionDisabled),
            "busy" => Ok(Self::Busy),
            "timeout" => Ok(Self::Timeout),
            "unreachable" => Ok(Self::Unreachable),
            _ => Err(recovery()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerEnvironment {
    pub device_id: DeviceId,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerConnection {
    pub connection_id: Uuid,
    pub remote_device_id: DeviceId,
    pub kind: ConnectionKind,
    pub local_enabled: bool,
    pub remote_enabled_observed: Option<bool>,
    pub remote_state_observed_at_ms: Option<i64>,
    pub preferred_endpoint: Option<SocketAddr>,
    pub last_success_endpoint: Option<SocketAddr>,
    pub last_test_state: LastTestState,
    pub last_test_error_code: Option<String>,
    pub last_tested_at_ms: Option<i64>,
    pub last_success_at_ms: Option<i64>,
    pub revision: u64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub endpoints: Vec<SocketAddr>,
}

fn recovery() -> HostError {
    HostError::PeerSyncRecoveryRequired
}

fn unavailable<T>(_: T) -> HostError {
    HostError::PeerSyncUnavailable
}

/// Creates the three v7 topology tables. The caller owns the surrounding migration transaction.
pub(super) fn create_v7_schema(connection: &Connection) -> Result<(), HostError> {
    for (name, _) in SCHEMAS {
        let present: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?1)",
                [name],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        if present {
            return Err(recovery());
        }
    }
    for (_, schema) in SCHEMAS {
        connection
            .execute_batch(&format!("{schema};"))
            .map_err(unavailable)?;
    }
    validate_v7_schema(connection)
}

/// Validates exact DDL, bounded row counts, stored fields, endpoint ordering, and references.
pub(super) fn validate_v7_schema(connection: &Connection) -> Result<(), HostError> {
    let state = load_validated_state(connection)?;
    drop(state);
    Ok(())
}

/// Builds device topology from already validated source snapshots without granting access.
/// Member-only devices receive an environment; a legacy connection exists only when a route exists.
#[cfg(test)]
pub(super) fn ensure_topology_from_verified(
    connection: &mut Connection,
    local_device: DeviceId,
    members: &[PeerMember],
    routes: &[Route],
    now_ms: i64,
) -> Result<(), HostError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    ensure_topology_from_verified_in_tx(&tx, local_device, members, routes, now_ms)?;
    tx.commit().map_err(unavailable)
}

pub(super) fn ensure_topology_from_verified_in_tx(
    connection: &Connection,
    local_device: DeviceId,
    members: &[PeerMember],
    routes: &[Route],
    now_ms: i64,
) -> Result<(), HostError> {
    if now_ms < 0 || members.len() > MAX_SOURCE_ROWS || routes.len() > MAX_SOURCE_ROWS {
        return Err(HostError::InvalidRequest);
    }

    let mut member_keys = BTreeSet::new();
    let mut environment_ids = BTreeMap::<String, DeviceId>::new();
    for member in members {
        membership_store::validate_member(member)?;
        let key = (member.profile_id.to_string(), member.device_id.to_string());
        if !member_keys.insert(key) {
            return Err(HostError::InvalidRequest);
        }
        if member.device_id != local_device {
            environment_ids.insert(member.device_id.to_string(), member.device_id);
        }
    }

    let mut route_keys = BTreeSet::new();
    let mut sorted_routes: Vec<&Route> = routes.iter().collect();
    sorted_routes.sort_by_key(|route| (route.profile.to_string(), route.device.to_string()));
    let mut legacy_endpoints =
        BTreeMap::<String, (DeviceId, Vec<SocketAddr>, HashSet<SocketAddr>)>::new();
    for route in sorted_routes {
        let key = (route.profile.to_string(), route.device.to_string());
        if !route_keys.insert(key) {
            return Err(HostError::InvalidRequest);
        }
        super::network_store::validate_endpoints(&route.endpoints)
            .map_err(|_| HostError::InvalidRequest)?;
        if route.device == local_device {
            continue;
        }
        let device_key = route.device.to_string();
        environment_ids.insert(device_key.clone(), route.device);
        let (_, endpoints, seen) = legacy_endpoints
            .entry(device_key)
            .or_insert_with(|| (route.device, Vec::new(), HashSet::new()));
        for endpoint in &route.endpoints {
            if seen.insert(*endpoint) {
                endpoints.push(*endpoint);
            }
        }
    }

    let tx = connection;
    let (existing_environments, existing_connections) = load_validated_state(&tx)?;
    let environment_set: HashSet<String> = existing_environments
        .iter()
        .map(|environment| environment.device_id.to_string())
        .collect();
    let connection_count = existing_connections.len();
    let endpoint_count: usize = existing_connections
        .iter()
        .map(|connection| connection.endpoints.len())
        .sum();

    let new_environments = environment_ids
        .keys()
        .filter(|device| !environment_set.contains(*device))
        .count();
    let mut legacy_by_device = HashMap::<DeviceId, &PeerConnection>::new();
    for peer_connection in &existing_connections {
        if peer_connection.kind == ConnectionKind::Legacy {
            if legacy_by_device
                .insert(peer_connection.remote_device_id, peer_connection)
                .is_some()
            {
                return Err(recovery());
            }
        }
    }
    let new_connections = legacy_endpoints
        .keys()
        .filter(|device| {
            let id = environment_ids.get(*device).copied();
            id.is_some_and(|id| !legacy_by_device.contains_key(&id))
        })
        .count();
    let endpoint_additions: usize = legacy_endpoints
        .iter()
        .map(|(device, (_, endpoints, _))| {
            let Some(device_id) = environment_ids.get(device).copied() else {
                return 0;
            };
            let Some(existing) = legacy_by_device.get(&device_id) else {
                return endpoints.len();
            };
            let existing_endpoints: HashSet<SocketAddr> =
                existing.endpoints.iter().copied().collect();
            endpoints
                .iter()
                .filter(|endpoint| !existing_endpoints.contains(endpoint))
                .count()
        })
        .sum();
    if existing_environments.len() + new_environments > MAX_ENVIRONMENTS
        || connection_count + new_connections > MAX_CONNECTIONS
        || endpoint_count + endpoint_additions > MAX_ENDPOINTS
    {
        return Err(HostError::PeerBusy);
    }

    for (device_id, _) in &environment_ids {
        tx.execute(
            "INSERT INTO peer_environments(device_id,created_at_ms,updated_at_ms) VALUES(?1,?2,?2) ON CONFLICT(device_id) DO NOTHING",
            params![device_id, now_ms],
        )
        .map_err(unavailable)?;
    }

    let mut topology: Vec<(String, DeviceId, Vec<SocketAddr>)> = legacy_endpoints
        .into_iter()
        .map(|(key, (device, endpoints, _))| (key, device, endpoints))
        .collect();
    topology.sort_by(|left, right| left.0.cmp(&right.0));
    for (device_key, device_id, endpoints) in topology {
        let existing: Option<(String, Vec<SocketAddr>, i64)> = existing_connections
            .iter()
            .find(|row| row.remote_device_id == device_id && row.kind == ConnectionKind::Legacy)
            .map(|row| {
                (
                    row.connection_id.to_string(),
                    row.endpoints.clone(),
                    row.revision as i64,
                )
            });
        let (connection_id, mut known_endpoints, revision, is_new) = match existing {
            Some((id, known, revision)) => (id, known, revision, false),
            None => {
                let id = Uuid::new_v4();
                tx.execute(
                    "INSERT INTO peer_connections(connection_id,remote_device_id,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,preferred_endpoint,last_success_endpoint,last_test_state,last_test_error_code,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,1,NULL,NULL,NULL,NULL,?4,NULL,NULL,NULL,0,?5,?5)",
                    params![
                        id.to_string(),
                        device_key,
                        ConnectionKind::Legacy.as_str(),
                        LastTestState::Untested.as_str(),
                        now_ms
                    ],
                )
                .map_err(unavailable)?;
                (id.to_string(), Vec::new(), 0, true)
            }
        };
        let mut additions = Vec::new();
        for endpoint in endpoints {
            if !known_endpoints.contains(&endpoint) {
                known_endpoints.push(endpoint);
                additions.push(endpoint);
            }
        }
        let start = known_endpoints.len() - additions.len();
        for (offset, endpoint) in additions.iter().enumerate() {
            let ordinal = i64::try_from(start + offset).map_err(|_| recovery())?;
            tx.execute(
                "INSERT INTO peer_connection_endpoints(connection_id,ordinal,endpoint) VALUES(?1,?2,?3)",
                params![connection_id, ordinal, endpoint.to_string()],
            )
            .map_err(unavailable)?;
        }
        if !additions.is_empty() && !is_new {
            let next_revision = revision.checked_add(1).ok_or_else(recovery)?;
            tx.execute(
                "UPDATE peer_connections SET revision=?1,updated_at_ms=max(updated_at_ms,?2) WHERE connection_id=?3",
                params![next_revision, now_ms, connection_id],
            )
            .map_err(unavailable)?;
        } else if !additions.is_empty() {
            tx.execute(
                "UPDATE peer_connections SET updated_at_ms=max(updated_at_ms,?1) WHERE connection_id=?2",
                params![now_ms, connection_id],
            )
            .map_err(unavailable)?;
        }
    }

    load_validated_state(&tx)?;
    Ok(())
}

/// Refreshes the environment-level projection after a verified membership or
/// route write. The profile-scoped membership and route tables remain the
/// authorization and current dialing authorities.
pub(super) fn reconcile_current_topology_in_tx(
    connection: &Connection,
    local_device: DeviceId,
    now_ms: i64,
) -> Result<(), HostError> {
    let members = membership_store::all_members_for_migration(connection)?;
    let routes = super::network_store::routes(connection)?;
    ensure_topology_from_verified_in_tx(connection, local_device, &members, &routes, now_ms)
}

pub(super) fn list_environments(
    connection: &Connection,
) -> Result<Vec<PeerEnvironment>, HostError> {
    Ok(load_validated_state(connection)?.0)
}

pub(super) fn list_connections(connection: &Connection) -> Result<Vec<PeerConnection>, HostError> {
    Ok(load_validated_state(connection)?.1)
}

/// Changes only the local dialing permission and advances the connection revision by CAS.
pub(super) fn set_local_enabled_cas(
    connection: &mut Connection,
    connection_id: Uuid,
    expected_revision: u64,
    enabled: bool,
    now_ms: i64,
) -> Result<PeerConnection, HostError> {
    if now_ms < 0 || connection_id.is_nil() {
        return Err(HostError::InvalidRequest);
    }
    let expected_revision =
        i64::try_from(expected_revision).map_err(|_| HostError::InvalidRequest)?;
    if expected_revision == i64::MAX {
        return Err(HostError::PeerMembershipConflict);
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    load_validated_state(&tx)?;
    let changed = tx
        .execute(
            "UPDATE peer_connections SET local_enabled=?1,revision=revision+1,updated_at_ms=max(updated_at_ms,?2) WHERE connection_id=?3 AND revision=?4",
            params![if enabled { 1_i64 } else { 0_i64 }, now_ms, connection_id.to_string(), expected_revision],
        )
        .map_err(unavailable)?;
    if changed == 0 {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM peer_connections WHERE connection_id=?1)",
                [connection_id.to_string()],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        return if exists {
            Err(HostError::PeerMembershipConflict)
        } else {
            Err(HostError::NotFound)
        };
    }
    let (_, connections) = load_validated_state(&tx)?;
    let updated = connections
        .into_iter()
        .find(|row| row.connection_id == connection_id)
        .ok_or(HostError::PeerSyncRecoveryRequired)?;
    tx.commit().map_err(unavailable).map(|()| updated)
}

fn load_validated_state(
    connection: &Connection,
) -> Result<(Vec<PeerEnvironment>, Vec<PeerConnection>), HostError> {
    validate_layout(connection)?;
    let environments = load_environments(connection)?;
    let environment_ids: HashSet<String> = environments
        .iter()
        .map(|environment| environment.device_id.to_string())
        .collect();
    let mut connections = load_connections(connection)?;
    let mut connection_indexes = HashMap::with_capacity(connections.len());
    let mut legacy_devices = HashSet::new();
    for (index, peer_connection) in connections.iter().enumerate() {
        if !environment_ids.contains(&peer_connection.remote_device_id.to_string()) {
            return Err(recovery());
        }
        if peer_connection.kind == ConnectionKind::Legacy
            && !legacy_devices.insert(peer_connection.remote_device_id)
        {
            return Err(recovery());
        }
        connection_indexes.insert(peer_connection.connection_id, index);
    }
    load_endpoints(connection, &mut connections, &connection_indexes)?;
    Ok((environments, connections))
}

fn validate_layout(connection: &Connection) -> Result<(), HostError> {
    for (name, expected_schema) in SCHEMAS {
        let found: Option<Option<String>> = connection
            .query_row(
                "SELECT CASE WHEN length(sql)<=4096 THEN sql END FROM sqlite_master WHERE type='table' AND name=?1",
                [name],
                |row| row.get(0),
            )
            .optional()
            .map_err(unavailable)?;
        if found.as_ref().and_then(|schema| schema.as_deref()) != Some(*expected_schema) {
            return Err(recovery());
        }
    }
    check_row_limit(connection, "peer_environments", MAX_ENVIRONMENTS)?;
    check_row_limit(connection, "peer_connections", MAX_CONNECTIONS)?;
    check_row_limit(connection, "peer_connection_endpoints", MAX_ENDPOINTS)?;
    validate_scalar_shapes(connection)?;
    Ok(())
}

fn check_row_limit(connection: &Connection, table: &str, max: usize) -> Result<(), HostError> {
    let sql = format!("SELECT count(*) FROM (SELECT 1 FROM {table} LIMIT ?1)");
    let count: i64 = connection
        .query_row(
            &sql,
            [i64::try_from(max + 1).map_err(|_| recovery())?],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if count > max as i64 {
        return Err(recovery());
    }
    Ok(())
}

fn validate_scalar_shapes(connection: &Connection) -> Result<(), HostError> {
    let invalid: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM peer_environments WHERE typeof(device_id)<>'text' OR length(device_id)<>36 OR typeof(created_at_ms)<>'integer' OR typeof(updated_at_ms)<>'integer' LIMIT 1)",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if invalid {
        return Err(recovery());
    }
    let invalid: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM peer_connections WHERE typeof(connection_id)<>'text' OR length(connection_id)<>36 OR typeof(remote_device_id)<>'text' OR length(remote_device_id)<>36 OR typeof(kind)<>'text' OR length(kind)>32 OR typeof(local_enabled)<>'integer' OR (remote_enabled_observed IS NOT NULL AND typeof(remote_enabled_observed)<>'integer') OR (remote_state_observed_at_ms IS NOT NULL AND typeof(remote_state_observed_at_ms)<>'integer') OR (preferred_endpoint IS NOT NULL AND (typeof(preferred_endpoint)<>'text' OR length(preferred_endpoint)>128)) OR (last_success_endpoint IS NOT NULL AND (typeof(last_success_endpoint)<>'text' OR length(last_success_endpoint)>128)) OR typeof(last_test_state)<>'text' OR length(last_test_state)>32 OR (last_test_error_code IS NOT NULL AND (typeof(last_test_error_code)<>'text' OR length(last_test_error_code)>64)) OR (last_tested_at_ms IS NOT NULL AND typeof(last_tested_at_ms)<>'integer') OR (last_success_at_ms IS NOT NULL AND typeof(last_success_at_ms)<>'integer') OR typeof(revision)<>'integer' OR typeof(created_at_ms)<>'integer' OR typeof(updated_at_ms)<>'integer' LIMIT 1)",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if invalid {
        return Err(recovery());
    }
    let invalid: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM peer_connection_endpoints WHERE typeof(connection_id)<>'text' OR length(connection_id)<>36 OR typeof(ordinal)<>'integer' OR typeof(endpoint)<>'text' OR length(endpoint)>128 LIMIT 1)",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if invalid {
        return Err(recovery());
    }
    Ok(())
}

fn load_environments(connection: &Connection) -> Result<Vec<PeerEnvironment>, HostError> {
    let mut statement = connection
        .prepare(
            "SELECT CASE WHEN typeof(device_id)='text' AND length(device_id)=36 THEN device_id END,created_at_ms,updated_at_ms FROM peer_environments ORDER BY device_id LIMIT 513",
        )
        .map_err(unavailable)?;
    let mut rows = statement.query([]).map_err(unavailable)?;
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        if output.len() >= MAX_ENVIRONMENTS {
            return Err(recovery());
        }
        let raw_id: Option<String> = row.get(0).map_err(|_| recovery())?;
        let created_at_ms: i64 = row.get(1).map_err(|_| recovery())?;
        let updated_at_ms: i64 = row.get(2).map_err(|_| recovery())?;
        let device_id = parse_device_id(raw_id.as_deref().ok_or_else(recovery)?)?;
        if created_at_ms < 0 || updated_at_ms < created_at_ms {
            return Err(recovery());
        }
        output.push(PeerEnvironment {
            device_id,
            created_at_ms,
            updated_at_ms,
        });
    }
    Ok(output)
}

fn load_connections(connection: &Connection) -> Result<Vec<PeerConnection>, HostError> {
    let mut statement = connection
        .prepare(
            "SELECT CASE WHEN typeof(connection_id)='text' AND length(connection_id)=36 THEN connection_id END,CASE WHEN typeof(remote_device_id)='text' AND length(remote_device_id)=36 THEN remote_device_id END,kind,local_enabled,remote_enabled_observed,remote_state_observed_at_ms,CASE WHEN preferred_endpoint IS NULL OR (typeof(preferred_endpoint)='text' AND length(preferred_endpoint)<=128) THEN preferred_endpoint END,CASE WHEN last_success_endpoint IS NULL OR (typeof(last_success_endpoint)='text' AND length(last_success_endpoint)<=128) THEN last_success_endpoint END,last_test_state,CASE WHEN last_test_error_code IS NULL OR (typeof(last_test_error_code)='text' AND length(last_test_error_code)<=64) THEN last_test_error_code END,last_tested_at_ms,last_success_at_ms,revision,created_at_ms,updated_at_ms FROM peer_connections ORDER BY remote_device_id,kind,connection_id LIMIT 4097",
        )
        .map_err(unavailable)?;
    let mut rows = statement.query([]).map_err(unavailable)?;
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        if output.len() >= MAX_CONNECTIONS {
            return Err(recovery());
        }
        let connection_id = parse_uuid(
            row.get::<_, Option<String>>(0)
                .map_err(|_| recovery())?
                .as_deref()
                .ok_or_else(recovery)?,
        )?;
        let remote_device_id = parse_device_id(
            row.get::<_, Option<String>>(1)
                .map_err(|_| recovery())?
                .as_deref()
                .ok_or_else(recovery)?,
        )?;
        let kind = ConnectionKind::parse(&row.get::<_, String>(2).map_err(|_| recovery())?)?;
        let local_enabled = parse_bool(row.get(3).map_err(|_| recovery())?)?;
        let remote_enabled_observed = row
            .get::<_, Option<i64>>(4)
            .map_err(|_| recovery())?
            .map(parse_bool)
            .transpose()?;
        let remote_state_observed_at_ms: Option<i64> = row.get(5).map_err(|_| recovery())?;
        let preferred_raw: Option<String> = row.get(6).map_err(|_| recovery())?;
        let last_success_raw: Option<String> = row.get(7).map_err(|_| recovery())?;
        let last_test_state =
            LastTestState::parse(&row.get::<_, String>(8).map_err(|_| recovery())?)?;
        let last_test_error_code: Option<String> = row.get(9).map_err(|_| recovery())?;
        let last_tested_at_ms: Option<i64> = row.get(10).map_err(|_| recovery())?;
        let last_success_at_ms: Option<i64> = row.get(11).map_err(|_| recovery())?;
        let revision = u64::try_from(row.get::<_, i64>(12).map_err(|_| recovery())?)
            .map_err(|_| recovery())?;
        let created_at_ms: i64 = row.get(13).map_err(|_| recovery())?;
        let updated_at_ms: i64 = row.get(14).map_err(|_| recovery())?;
        let preferred_endpoint = preferred_raw.as_deref().map(parse_endpoint).transpose()?;
        let last_success_endpoint = last_success_raw
            .as_deref()
            .map(parse_endpoint)
            .transpose()?;
        if remote_enabled_observed.is_some() != remote_state_observed_at_ms.is_some()
            || remote_state_observed_at_ms.is_some_and(|time| time < 0)
            || last_test_error_code
                .as_deref()
                .is_some_and(|code| !valid_error_code(code))
            || (last_test_state == LastTestState::Untested
                && (last_tested_at_ms.is_some() || last_test_error_code.is_some()))
            || (last_test_state != LastTestState::Untested && last_tested_at_ms.is_none())
            || last_tested_at_ms.is_some_and(|time| time < 0)
            || last_success_at_ms.is_some_and(|time| time < 0)
            || created_at_ms < 0
            || updated_at_ms < created_at_ms
        {
            return Err(recovery());
        }
        output.push(PeerConnection {
            connection_id,
            remote_device_id,
            kind,
            local_enabled,
            remote_enabled_observed,
            remote_state_observed_at_ms,
            preferred_endpoint,
            last_success_endpoint,
            last_test_state,
            last_test_error_code,
            last_tested_at_ms,
            last_success_at_ms,
            revision,
            created_at_ms,
            updated_at_ms,
            endpoints: Vec::new(),
        });
    }
    Ok(output)
}

fn load_endpoints(
    connection: &Connection,
    connections: &mut [PeerConnection],
    connection_indexes: &HashMap<Uuid, usize>,
) -> Result<(), HostError> {
    let mut statement = connection
        .prepare(
            "SELECT CASE WHEN typeof(connection_id)='text' AND length(connection_id)=36 THEN connection_id END,ordinal,CASE WHEN typeof(endpoint)='text' AND length(endpoint)<=128 THEN endpoint END FROM peer_connection_endpoints ORDER BY connection_id,ordinal LIMIT 32769",
        )
        .map_err(unavailable)?;
    let mut rows = statement.query([]).map_err(unavailable)?;
    let mut endpoint_counts = HashMap::<Uuid, usize>::new();
    let mut endpoint_sets = HashMap::<Uuid, HashSet<SocketAddr>>::new();
    let mut total_endpoints = 0;
    while let Some(row) = rows.next().map_err(unavailable)? {
        if total_endpoints >= MAX_ENDPOINTS {
            return Err(recovery());
        }
        let id = parse_uuid(
            row.get::<_, Option<String>>(0)
                .map_err(|_| recovery())?
                .as_deref()
                .ok_or_else(recovery)?,
        )?;
        let ordinal: i64 = row.get(1).map_err(|_| recovery())?;
        let endpoint_raw: Option<String> = row.get(2).map_err(|_| recovery())?;
        let endpoint = parse_endpoint(endpoint_raw.as_deref().ok_or_else(recovery)?)?;
        let index = *connection_indexes.get(&id).ok_or_else(recovery)?;
        let current = endpoint_counts.entry(id).or_default();
        if ordinal != *current as i64 || !endpoint_sets.entry(id).or_default().insert(endpoint) {
            return Err(recovery());
        }
        *current += 1;
        total_endpoints += 1;
        let endpoint_limit = if connections[index].kind == ConnectionKind::Legacy {
            MAX_LEGACY_ENDPOINTS
        } else {
            8
        };
        if *current > endpoint_limit {
            return Err(recovery());
        }
        connections[index].endpoints.push(endpoint);
    }
    Ok(())
}

fn parse_device_id(raw: &str) -> Result<DeviceId, HostError> {
    let parsed = DeviceId::from_str(raw).map_err(|_| recovery())?;
    if parsed.to_string() != raw {
        return Err(recovery());
    }
    Ok(parsed)
}

fn parse_uuid(raw: &str) -> Result<Uuid, HostError> {
    let parsed = Uuid::parse_str(raw).map_err(|_| recovery())?;
    if parsed.is_nil() || parsed.to_string() != raw {
        return Err(recovery());
    }
    Ok(parsed)
}

fn parse_bool(value: i64) -> Result<bool, HostError> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(recovery()),
    }
}

fn parse_endpoint(raw: &str) -> Result<SocketAddr, HostError> {
    let endpoint = SocketAddr::from_str(raw).map_err(|_| recovery())?;
    if endpoint.to_string() != raw
        || endpoint.port() == 0
        || endpoint.ip().is_unspecified()
        || endpoint.ip().is_multicast()
    {
        return Err(recovery());
    }
    Ok(endpoint)
}

fn valid_error_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ERROR_CODE_CHARS
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

#[cfg(test)]
#[path = "connection_store_tests.rs"]
mod tests;
