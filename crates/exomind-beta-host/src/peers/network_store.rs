//! Owner-controlled network preferences and routes. Routes never grant profile
//! access: every actual connection still pins the key and rechecks membership.
use crate::HostError;
use exomind_core::{DeviceId, ProfileId};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;

const LAYOUT: &str = "exomind-peer-network/1";
const MAX_ROUTES: i64 = 256;
pub(super) const MAX_ROUTE_ENDPOINTS: usize = 8;
const BASE_OBJECTS: &[(&str, &str)] = &[
    (
        "peer_network_settings",
        "CREATE TABLE peer_network_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),preferred_port INTEGER NOT NULL CHECK(preferred_port BETWEEN 0 AND 65535),route_count INTEGER NOT NULL CHECK(route_count BETWEEN 0 AND 256))",
    ),
    (
        "peer_network_routes",
        "CREATE TABLE peer_network_routes(profile_id TEXT NOT NULL CHECK(length(profile_id)=36),device_id TEXT NOT NULL CHECK(length(device_id)=36),endpoints TEXT NOT NULL CHECK(length(endpoints)<=4096),PRIMARY KEY(profile_id,device_id))",
    ),
];
const ALIAS_TABLE: &str = "peer_environment_alias";
const ALIAS_SCHEMA: &str = "CREATE TABLE peer_environment_alias(singleton INTEGER PRIMARY KEY CHECK(singleton=1),custom_alias TEXT CHECK(custom_alias IS NULL OR (typeof(custom_alias)='text' AND length(custom_alias) BETWEEN 1 AND 64)),revision INTEGER NOT NULL CHECK(revision>=0),last_effective_alias TEXT CHECK(last_effective_alias IS NULL OR (typeof(last_effective_alias)='text' AND length(last_effective_alias) BETWEEN 1 AND 64)),last_source TEXT CHECK(last_source IS NULL OR last_source IN ('custom','os_default','stable_id')))";
const ALIAS_CLAIM_TABLE: &str = "peer_environment_alias_claims";
const ALIAS_CLAIM_SCHEMA: &str = "CREATE TABLE peer_environment_alias_claims(device_id TEXT NOT NULL CHECK(length(device_id)=36),pin TEXT NOT NULL CHECK(length(pin)=64),effective_alias TEXT NOT NULL CHECK(typeof(effective_alias)='text' AND length(effective_alias) BETWEEN 1 AND 64),alias_source TEXT NOT NULL CHECK(alias_source IN ('custom','os_default','stable_id')),alias_revision INTEGER NOT NULL CHECK(alias_revision>=0),observed_at_ms INTEGER NOT NULL CHECK(observed_at_ms>=0),confirmed_at_ms INTEGER CHECK(confirmed_at_ms IS NULL OR confirmed_at_ms>=0),PRIMARY KEY(device_id,pin))";
const MAX_ALIAS_CLAIMS: i64 = 256;
pub const MAX_ENVIRONMENT_ALIAS_CHARS: usize = 64;
pub(super) const MAX_ENVIRONMENT_ALIAS_BYTES: usize = 256;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeerNetworkSettings {
    pub enabled: bool,
    pub preferred_port: u16,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PeerAliasClaim {
    pub effective_alias: String,
    pub source: super::network_management::EnvironmentAliasSource,
    pub revision: u64,
    pub observed_at_ms: i64,
    pub confirmed_at_ms: Option<i64>,
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
    let n:i64=connection.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('peer_network_settings','peer_network_routes','peer_environment_alias','peer_environment_alias_claims')",[],|r|r.get(0)).map_err(unavailable)?;
    if n != 0 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(())
}
pub(super) fn create(connection: &Connection) -> Result<(), HostError> {
    absent(connection)?;
    for (_, sql) in BASE_OBJECTS {
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
pub(super) fn create_alias(connection: &Connection) -> Result<(), HostError> {
    let found: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?1)",
            [ALIAS_TABLE],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if found {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    connection
        .execute_batch(&format!("{ALIAS_SCHEMA};{ALIAS_CLAIM_SCHEMA};"))
        .map_err(unavailable)?;
    connection
        .execute(
            "INSERT INTO peer_environment_alias VALUES(1,NULL,0,NULL,NULL)",
            [],
        )
        .map_err(unavailable)?;
    Ok(())
}
fn validate_base(connection: &Connection) -> Result<(), HostError> {
    for (name, sql) in BASE_OBJECTS {
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
pub(super) fn validate_v5(connection: &Connection) -> Result<(), HostError> {
    validate_base(connection)
}
pub(super) fn validate(connection: &Connection) -> Result<(), HostError> {
    validate_base(connection)?;
    let found:Option<Option<String>>=connection.query_row("SELECT CASE WHEN length(sql)<=2048 THEN sql END FROM sqlite_master WHERE type='table' AND name=?1",[ALIAS_TABLE],|r|r.get(0)).optional().map_err(unavailable)?;
    if found.as_ref().and_then(|value| value.as_deref()) != Some(ALIAS_SCHEMA) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let found:Option<Option<String>>=connection.query_row("SELECT CASE WHEN length(sql)<=2048 THEN sql END FROM sqlite_master WHERE type='table' AND name=?1",[ALIAS_CLAIM_TABLE],|r|r.get(0)).optional().map_err(unavailable)?;
    if found.as_ref().and_then(|value| value.as_deref()) != Some(ALIAS_CLAIM_SCHEMA) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let count: i64 = connection
        .query_row("SELECT count(*) FROM peer_environment_alias", [], |row| {
            row.get(0)
        })
        .map_err(unavailable)?;
    if count != 1 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let confirmed_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM peer_environment_alias_claims",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    if !(0..=MAX_ALIAS_CLAIMS).contains(&confirmed_count) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    custom_environment_alias(connection)?;
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
pub(super) fn custom_environment_alias(connection: &Connection) -> Result<Option<String>, HostError> {
    Ok(environment_alias_state(connection)?.0)
}
pub(super) fn environment_alias_state(
    connection: &Connection,
) -> Result<(Option<String>, u64), HostError> {
    let (valid, alias, revision, last_valid, source_valid): (i64, Option<String>, i64, i64, i64) = connection
        .query_row(
            "SELECT
                CASE WHEN custom_alias IS NULL THEN 1
                     WHEN length(custom_alias) BETWEEN 1 AND 64
                      AND length(CAST(custom_alias AS BLOB))<=256 THEN 1
                     ELSE 0 END,
                CASE WHEN custom_alias IS NOT NULL
                       AND length(custom_alias) BETWEEN 1 AND 64
                       AND length(CAST(custom_alias AS BLOB))<=256
                     THEN custom_alias ELSE NULL END,
                revision,
                CASE WHEN last_effective_alias IS NULL THEN 1
                     WHEN length(last_effective_alias) BETWEEN 1 AND 64
                      AND length(CAST(last_effective_alias AS BLOB))<=256 THEN 1
                     ELSE 0 END,
                CASE WHEN last_source IS NULL
                       OR last_source IN ('custom','os_default','stable_id') THEN 1
                     ELSE 0 END
             FROM peer_environment_alias WHERE singleton=1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(recovery)?;
    if valid != 1 || revision < 0 || last_valid != 1 || source_valid != 1 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    if alias.as_ref().is_some_and(|value| {
        value.is_empty()
            || value.chars().count() > MAX_ENVIRONMENT_ALIAS_CHARS
            || value.len() > MAX_ENVIRONMENT_ALIAS_BYTES
            || value.chars().any(char::is_control)
    }) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok((alias, revision as u64))
}
pub(super) fn save_custom_environment_alias(
    connection: &Connection,
    alias: Option<&str>,
) -> Result<u64, HostError> {
    connection
        .execute(
            "UPDATE peer_environment_alias
             SET custom_alias=?1,revision=revision+1
             WHERE singleton=1",
            [alias],
        )
        .map_err(unavailable)?;
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM peer_environment_alias WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(unavailable)?;
    u64::try_from(revision).map_err(|_| HostError::PeerSyncRecoveryRequired)
}
pub(super) fn advance_environment_alias_announcement(
    connection: &Connection,
    effective_alias: &str,
    source: super::network_management::EnvironmentAliasSource,
) -> Result<u64, HostError> {
    let (revision, previous_alias, previous_source): (i64, Option<String>, Option<String>) =
        connection
            .query_row(
                "SELECT revision,
                        CASE WHEN last_effective_alias IS NULL THEN NULL
                             WHEN length(last_effective_alias)<=64 THEN last_effective_alias END,
                        CASE WHEN last_source IS NULL THEN NULL
                             WHEN length(last_source)<=16 THEN last_source END
                 FROM peer_environment_alias WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(recovery)?;
    if revision < 0 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let previous_source = match previous_source.as_deref() {
        Some(value) => Some(
            super::network_management::EnvironmentAliasSource::from_storage(value)
                .ok_or(HostError::PeerSyncRecoveryRequired)?,
        ),
        None => None,
    };
    let changed = previous_alias.as_deref() != Some(effective_alias)
        || previous_source != Some(source);
    if !changed {
        return Ok(revision as u64);
    }
    let next = if changed && previous_alias.is_some() {
        revision
            .checked_add(1)
            .ok_or(HostError::PeerSyncRecoveryRequired)?
    } else {
        revision
    };
    connection
        .execute(
            "UPDATE peer_environment_alias
             SET revision=?1,last_effective_alias=?2,last_source=?3
             WHERE singleton=1",
            params![next, effective_alias, source.as_str()],
        )
        .map_err(unavailable)?;
    Ok(next as u64)
}
pub(super) fn set_environment_alias_announcement(
    connection: &Connection,
    effective_alias: &str,
    source: super::network_management::EnvironmentAliasSource,
) -> Result<(), HostError> {
    connection
        .execute(
            "UPDATE peer_environment_alias
             SET last_effective_alias=?1,last_source=?2
             WHERE singleton=1",
            params![effective_alias, source.as_str()],
        )
        .map_err(unavailable)?;
    Ok(())
}
fn valid_alias_claim(
    effective_alias: &str,
    revision: i64,
    observed_at_ms: i64,
    confirmed_at_ms: Option<i64>,
) -> bool {
    !effective_alias.is_empty()
        && effective_alias.chars().count() <= MAX_ENVIRONMENT_ALIAS_CHARS
        && effective_alias.len() <= MAX_ENVIRONMENT_ALIAS_BYTES
        && !effective_alias.chars().any(char::is_control)
        && revision >= 0
        && observed_at_ms >= 0
        && confirmed_at_ms.is_none_or(|value| value >= 0)
}
pub(super) fn alias_claim(
    connection: &Connection,
    device: DeviceId,
    pin: &str,
) -> Result<Option<PeerAliasClaim>, HostError> {
    let raw: Option<(Option<String>, Option<String>, i64, i64, Option<i64>)> = connection
        .query_row(
            "SELECT CASE WHEN length(effective_alias)<=64 THEN effective_alias END,
                    CASE WHEN length(alias_source)<=16 THEN alias_source END,
                    alias_revision,observed_at_ms,confirmed_at_ms
             FROM peer_environment_alias_claims WHERE device_id=?1 AND pin=?2",
            params![device.to_string(), pin],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(unavailable)?;
    let Some((effective_alias, source, revision, observed_at_ms, confirmed_at_ms)) = raw else {
        return Ok(None);
    };
    let effective_alias = effective_alias.ok_or(HostError::PeerSyncRecoveryRequired)?;
    let source = source
        .as_deref()
        .and_then(super::network_management::EnvironmentAliasSource::from_storage)
        .ok_or(HostError::PeerSyncRecoveryRequired)?;
    if !valid_alias_claim(
        &effective_alias,
        revision,
        observed_at_ms,
        confirmed_at_ms,
    ) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(Some(PeerAliasClaim {
        effective_alias,
        source,
        revision: revision as u64,
        observed_at_ms,
        confirmed_at_ms,
    }))
}
pub(super) fn alias_claims(
    connection: &Connection,
) -> Result<HashMap<(DeviceId, String), PeerAliasClaim>, HostError> {
    let mut statement = connection
        .prepare(
            "SELECT CASE WHEN length(device_id)=36 THEN device_id END,
                    CASE WHEN length(pin)=64 THEN pin END,
                    CASE WHEN length(effective_alias)<=64 THEN effective_alias END,
                    CASE WHEN length(alias_source)<=16 THEN alias_source END,
                    alias_revision,observed_at_ms,confirmed_at_ms
             FROM peer_environment_alias_claims
             ORDER BY device_id,pin
             LIMIT 257",
        )
        .map_err(unavailable)?;
    let mut rows = statement.query([]).map_err(unavailable)?;
    let mut output = HashMap::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        if output.len() >= MAX_ALIAS_CLAIMS as usize {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
        let device = row
            .get::<_, Option<String>>(0)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?
            .parse()
            .map_err(recovery)?;
        let pin = row
            .get::<_, Option<String>>(1)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let effective_alias = row
            .get::<_, Option<String>>(2)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let source = row
            .get::<_, Option<String>>(3)
            .map_err(recovery)?
            .as_deref()
            .and_then(super::network_management::EnvironmentAliasSource::from_storage)
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let revision = row.get::<_, i64>(4).map_err(recovery)?;
        let observed_at_ms = row.get::<_, i64>(5).map_err(recovery)?;
        let confirmed_at_ms = row.get::<_, Option<i64>>(6).map_err(recovery)?;
        if !valid_alias_claim(
            &effective_alias,
            revision,
            observed_at_ms,
            confirmed_at_ms,
        ) {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
        output.insert(
            (device, pin),
            PeerAliasClaim {
                effective_alias,
                source,
                revision: revision as u64,
                observed_at_ms,
                confirmed_at_ms,
            },
        );
    }
    Ok(output)
}
pub(super) fn save_observed_alias(
    connection: &Connection,
    device: DeviceId,
    pin: &str,
    effective_alias: &str,
    source: super::network_management::EnvironmentAliasSource,
    revision: u64,
    observed_at_ms: i64,
) -> Result<bool, HostError> {
    if observed_at_ms < 0
        || revision > i64::MAX as u64
        || !valid_alias_claim(effective_alias, revision as i64, observed_at_ms, None)
    {
        return Err(HostError::InvalidRequest);
    }
    let existing = alias_claim(connection, device, pin)?;
    let Some(existing) = existing else {
        let count: i64 = connection
            .query_row("SELECT count(*) FROM peer_environment_alias_claims", [], |row| {
                row.get(0)
            })
            .map_err(unavailable)?;
        if count >= MAX_ALIAS_CLAIMS {
            return Err(HostError::PeerBusy);
        }
        connection
            .execute(
                "INSERT INTO peer_environment_alias_claims(device_id,pin,effective_alias,alias_source,alias_revision,observed_at_ms,confirmed_at_ms)
                 VALUES(?1,?2,?3,?4,?5,?6,NULL)",
                params![
                    device.to_string(),
                    pin,
                    effective_alias,
                    source.as_str(),
                    revision as i64,
                    observed_at_ms
                ],
            )
            .map_err(unavailable)?;
        return Ok(true);
    };
    if existing.revision > revision
        || (existing.revision == revision
            && (existing.effective_alias != effective_alias || existing.source != source))
    {
        return Ok(false);
    }
    if existing.revision == revision
        && existing.effective_alias == effective_alias
        && existing.source == source
    {
        return Ok(true);
    }
    let changed_name =
        existing.effective_alias != effective_alias || existing.source != source;
    connection
        .execute(
            "UPDATE peer_environment_alias_claims
             SET effective_alias=?1,alias_source=?2,alias_revision=?3,
                 observed_at_ms=?4,confirmed_at_ms=?5
             WHERE device_id=?6 AND pin=?7",
            params![
                effective_alias,
                source.as_str(),
                revision as i64,
                observed_at_ms,
                if changed_name { None } else { existing.confirmed_at_ms },
                device.to_string(),
                pin
            ],
        )
        .map_err(unavailable)?;
    Ok(true)
}
pub(super) fn confirm_alias_claim(
    connection: &Connection,
    device: DeviceId,
    pin: &str,
    effective_alias: &str,
    source: super::network_management::EnvironmentAliasSource,
    revision: u64,
    confirmed_at_ms: i64,
) -> Result<(), HostError> {
    if confirmed_at_ms < 0
        || revision > i64::MAX as u64
        || !valid_alias_claim(effective_alias, revision as i64, confirmed_at_ms, Some(confirmed_at_ms))
    {
        return Err(HostError::InvalidRequest);
    }
    let existing = alias_claim(connection, device, pin)?;
    match existing {
        Some(existing)
            if existing.revision == revision
                && existing.effective_alias == effective_alias
                && existing.source == source =>
        {
            connection
                .execute(
                    "UPDATE peer_environment_alias_claims SET confirmed_at_ms=?1
                     WHERE device_id=?2 AND pin=?3",
                    params![confirmed_at_ms, device.to_string(), pin],
                )
                .map_err(unavailable)?;
            Ok(())
        }
        Some(_) => Err(HostError::PeerBusy),
        None => {
            let count: i64 = connection
                .query_row("SELECT count(*) FROM peer_environment_alias_claims", [], |row| {
                    row.get(0)
                })
                .map_err(unavailable)?;
            if count >= MAX_ALIAS_CLAIMS {
                return Err(HostError::PeerBusy);
            }
            connection
                .execute(
                    "INSERT INTO peer_environment_alias_claims(device_id,pin,effective_alias,alias_source,alias_revision,observed_at_ms,confirmed_at_ms)
                     VALUES(?1,?2,?3,?4,?5,?6,?6)",
                    params![
                        device.to_string(),
                        pin,
                        effective_alias,
                        source.as_str(),
                        revision as i64,
                        confirmed_at_ms
                    ],
                )
                .map_err(unavailable)?;
            Ok(())
        }
    }
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
