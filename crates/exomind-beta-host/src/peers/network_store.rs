//! Owner-controlled network preferences and routes. Routes never grant profile
//! access: every actual connection still pins the key and rechecks membership.
use crate::HostError;
use exomind_core::{DeviceId, ProfileId};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

const LAYOUT: &str = "exomind-peer-network/1";
const MAX_ROUTES: i64 = 256;
pub(super) const MAX_ROUTE_ENDPOINTS: usize = 8;
const OBJECTS: &[(&str, &str)] = &[
    (
        "peer_network_settings",
        "CREATE TABLE peer_network_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),preferred_port INTEGER NOT NULL CHECK(preferred_port BETWEEN 0 AND 65535),route_count INTEGER NOT NULL CHECK(route_count BETWEEN 0 AND 256))",
    ),
    (
        "peer_network_routes",
        "CREATE TABLE peer_network_routes(profile_id TEXT NOT NULL CHECK(length(profile_id)=36),device_id TEXT NOT NULL CHECK(length(device_id)=36),endpoints TEXT NOT NULL CHECK(length(endpoints)<=4096),PRIMARY KEY(profile_id,device_id))",
    ),
];
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerNetworkSettings {
    pub enabled: bool,
    pub preferred_port: u16,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Route {
    pub profile: ProfileId,
    pub device: DeviceId,
    pub endpoints: Vec<SocketAddr>,
}
fn recovery<T>(_: T) -> HostError {
    HostError::PeerSyncRecoveryRequired
}
fn unavailable<T>(_: T) -> HostError {
    HostError::PeerSyncUnavailable
}
pub(super) fn absent(connection: &Connection) -> Result<(), HostError> {
    let n:i64=connection.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('peer_network_settings','peer_network_routes')",[],|r|r.get(0)).map_err(unavailable)?;
    if n != 0 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(())
}
pub(super) fn create(connection: &Connection) -> Result<(), HostError> {
    absent(connection)?;
    for (_, sql) in OBJECTS {
        connection.execute_batch(sql).map_err(unavailable)?;
    }
    connection
        .execute(
            "INSERT INTO peer_network_settings VALUES(1,?1,0,43344,0)",
            [LAYOUT],
        )
        .map_err(unavailable)?;
    Ok(())
}
pub(super) fn validate(connection: &Connection) -> Result<(), HostError> {
    for (name, sql) in OBJECTS {
        let found:Option<Option<String>>=connection.query_row("SELECT CASE WHEN length(sql)<=2048 THEN sql END FROM sqlite_master WHERE type='table' AND name=?1",[name],|r|r.get(0)).optional().map_err(unavailable)?;
        if found.as_ref().and_then(|s| s.as_deref()) != Some(*sql) {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
    }
    let (layout,enabled,port,count):(Option<String>,i64,i64,i64)=connection.query_row("SELECT CASE WHEN length(layout)<=64 THEN layout END,enabled,preferred_port,route_count FROM peer_network_settings WHERE singleton=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(recovery)?;
    let actual: i64 = connection
        .query_row(
            "SELECT count(*) FROM (SELECT 1 FROM peer_network_routes LIMIT 257)",
            [],
            |r| r.get(0),
        )
        .map_err(unavailable)?;
    let singleton_count: i64 = connection
        .query_row("SELECT count(*) FROM peer_network_settings", [], |row| {
            row.get(0)
        })
        .map_err(unavailable)?;
    if layout.as_deref() != Some(LAYOUT)
        || !(0..=1).contains(&enabled)
        || !(0..=65535).contains(&port)
        || singleton_count != 1
        || count != actual
        || !(0..=MAX_ROUTES).contains(&count)
    {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(())
}
pub(super) fn settings(connection: &Connection) -> Result<PeerNetworkSettings, HostError> {
    validate(connection)?;
    connection
        .query_row(
            "SELECT enabled,preferred_port FROM peer_network_settings WHERE singleton=1",
            [],
            |r| {
                Ok(PeerNetworkSettings {
                    enabled: r.get(0)?,
                    preferred_port: r.get(1)?,
                })
            },
        )
        .map_err(recovery)
}
pub(super) fn save_settings(
    connection: &Connection,
    value: PeerNetworkSettings,
) -> Result<(), HostError> {
    validate(connection)?;
    connection
        .execute(
            "UPDATE peer_network_settings SET enabled=?1,preferred_port=?2 WHERE singleton=1",
            params![value.enabled, value.preferred_port],
        )
        .map_err(unavailable)?;
    Ok(())
}
pub(super) fn validate_endpoints(endpoints: &[SocketAddr]) -> Result<(), HostError> {
    if endpoints.is_empty() || endpoints.len() > MAX_ROUTE_ENDPOINTS {
        return Err(HostError::InvalidRequest);
    }
    for (n, endpoint) in endpoints.iter().enumerate() {
        if endpoint.port() == 0
            || endpoint.ip().is_unspecified()
            || endpoint.ip().is_multicast()
            || endpoints[..n].contains(endpoint)
        {
            return Err(HostError::InvalidRequest);
        }
    }
    Ok(())
}
pub(super) fn routes(connection: &Connection) -> Result<Vec<Route>, HostError> {
    validate(connection)?;
    let mut statement=connection.prepare("SELECT CASE WHEN length(profile_id)=36 THEN profile_id END,CASE WHEN length(device_id)=36 THEN device_id END,CASE WHEN length(endpoints)<=4096 THEN endpoints END FROM peer_network_routes ORDER BY profile_id,device_id LIMIT 257").map_err(unavailable)?;
    let mut rows = statement.query([]).map_err(unavailable)?;
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        if output.len() >= MAX_ROUTES as usize {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
        let p: Option<String> = row.get(0).map_err(recovery)?;
        let d: Option<String> = row.get(1).map_err(recovery)?;
        let raw: Option<String> = row.get(2).map_err(recovery)?;
        let endpoints: Vec<SocketAddr> =
            serde_json::from_str(raw.as_deref().ok_or(HostError::PeerSyncRecoveryRequired)?)
                .map_err(recovery)?;
        validate_endpoints(&endpoints).map_err(recovery)?;
        output.push(Route {
            profile: p
                .ok_or(HostError::PeerSyncRecoveryRequired)?
                .parse()
                .map_err(recovery)?,
            device: d
                .ok_or(HostError::PeerSyncRecoveryRequired)?
                .parse()
                .map_err(recovery)?,
            endpoints,
        });
    }
    Ok(output)
}
pub(super) fn save_route(connection: &Connection, route: &Route) -> Result<(), HostError> {
    validate(connection)?;
    validate_endpoints(&route.endpoints)?;
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM peer_network_routes WHERE profile_id=?1 AND device_id=?2)",
            params![route.profile.to_string(), route.device.to_string()],
            |r| r.get(0),
        )
        .map_err(unavailable)?;
    if !exists {
        let count: i64 = connection
            .query_row(
                "SELECT route_count FROM peer_network_settings WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(recovery)?;
        if count >= MAX_ROUTES {
            return Err(HostError::PeerBusy);
        }
        connection
            .execute(
                "UPDATE peer_network_settings SET route_count=route_count+1 WHERE singleton=1",
                [],
            )
            .map_err(unavailable)?;
    }
    let encoded = serde_json::to_string(&route.endpoints).map_err(unavailable)?;
    if encoded.len() > 4096 {
        return Err(HostError::InvalidRequest);
    }
    connection.execute("INSERT INTO peer_network_routes VALUES(?1,?2,?3) ON CONFLICT(profile_id,device_id) DO UPDATE SET endpoints=excluded.endpoints",params![route.profile.to_string(),route.device.to_string(),encoded]).map_err(unavailable)?;
    Ok(())
}
