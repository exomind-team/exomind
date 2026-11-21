//! Member authorization and join recovery share host-auth's FULL transaction.
//! No second SQLite authority and no raw invitation secret is persisted.
use super::membership::*;
use crate::HostError;
use exomind_core::DeviceId;
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Serialize, de::DeserializeOwned};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(crate) const AUTH_VERSION: i64 = 7;
const AUTH_VERSION_V6: i64 = 6;
const LAYOUT: &str = "exomind-peer-membership/1";
pub(super) const MAX_JSON: usize = 16384;
pub(super) const MAX_MEMBERS: i64 = 256;
pub(super) const MAX_MEMBER_PROFILE_PAGE: usize = 16;
pub(super) const MAX_INVITATIONS: i64 = 128;
pub(super) const MAX_JOINS: i64 = 256;
const SCHEMAS: &[(&str, &str)] = &[
    (
        "peer_membership_layout",
        "CREATE TABLE peer_membership_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout TEXT NOT NULL,max_wall_ms INTEGER NOT NULL CHECK(max_wall_ms>=0))",
    ),
    (
        "peer_members",
        "CREATE TABLE peer_members(profile_id TEXT NOT NULL,device_id TEXT NOT NULL,body TEXT NOT NULL CHECK(length(body)<=16384),PRIMARY KEY(profile_id,device_id))",
    ),
    (
        "peer_invitations",
        "CREATE TABLE peer_invitations(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(length(body)<=16384))",
    ),
    (
        "peer_claims",
        "CREATE TABLE peer_claims(id TEXT PRIMARY KEY,invitation_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL CHECK(length(body)<=16384))",
    ),
    (
        "peer_pending",
        "CREATE TABLE peer_pending(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(length(body)<=16384))",
    ),
];

pub(super) fn unavailable<T>(_: T) -> HostError {
    HostError::PeerMembershipUnavailable
}
pub(super) fn corrupt<T>(_: T) -> HostError {
    HostError::PeerMembershipRecoveryRequired
}

#[cfg(test)]
pub(crate) fn migrate(connection: &mut Connection) -> Result<(), HostError> {
    let wall_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(unavailable)?
        .as_millis()
        .try_into()
        .map_err(|_| HostError::InvalidRequest)?;
    migrate_for_device(connection, DeviceId::new(), wall_ms)
}

pub(crate) fn migrate_for_device(
    connection: &mut Connection,
    local_device: DeviceId,
    wall_ms: i64,
) -> Result<(), HostError> {
    if wall_ms < 0 {
        return Err(HostError::InvalidRequest);
    }
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(unavailable)?;
    if version != AUTH_VERSION {
        migrate_to_v6(connection)?;
    }
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(unavailable)?;
    if version == AUTH_VERSION_V6 {
        migrate_v6_to_v7(connection, local_device, wall_ms)?;
    } else if version != AUTH_VERSION {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate(connection)
}

fn migrate_to_v6(connection: &mut Connection) -> Result<(), HostError> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(unavailable)?;
    if (1..=3).contains(&version) {
        super::original_auto_store::absent(connection)?;
        super::network_store::absent(connection)?;
        if version < 3 {
            super::sync_store::ensure_absent(connection)?;
        } else {
            super::sync_store::validate(connection)?;
        }
        if version >= 2 {
            validate_membership_layout(connection)?;
        }
        if version == 1 {
            let existing: i64 = connection.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name IN ('peer_membership_layout','peer_members','peer_invitations','peer_claims','peer_pending')",
            [], |r| r.get(0),
        ).map_err(unavailable)?;
            if existing != 0 {
                return Err(HostError::PeerMembershipRecoveryRequired);
            }
        }
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        if version == 1 {
            for (_, schema) in SCHEMAS {
                tx.execute_batch(schema).map_err(unavailable)?;
            }
            tx.execute(
                "INSERT INTO peer_membership_layout VALUES(1,?1,0)",
                [LAYOUT],
            )
            .map_err(unavailable)?;
        }
        if version < 3 {
            super::sync_store::create_schema(&tx)?;
        }
        super::network_store::create(&tx)?;
        // Complete and validate each historical step before adding the next.
        tx.pragma_update(None, "user_version", 4)
            .map_err(unavailable)?;
        validate_v4(&tx)?;
        super::original_auto_store::create(&tx)?;
        tx.pragma_update(None, "user_version", 5)
            .map_err(unavailable)?;
        validate_v5(&tx)?;
        super::network_store::create_alias(&tx)?;
        tx.pragma_update(None, "user_version", AUTH_VERSION_V6)
            .map_err(unavailable)?;
        tx.commit().map_err(unavailable)?;
    } else if version == 4 {
        validate_v4(connection)?;
        super::original_auto_store::absent(connection)?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        validate_v4(&tx)?;
        super::original_auto_store::create(&tx)?;
        tx.pragma_update(None, "user_version", 5)
            .map_err(unavailable)?;
        validate_v5(&tx)?;
        super::network_store::create_alias(&tx)?;
        tx.pragma_update(None, "user_version", AUTH_VERSION_V6)
            .map_err(unavailable)?;
        tx.commit().map_err(unavailable)?;
    } else if version == 5 {
        validate_v5(connection)?;
        let alias_table: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='peer_environment_alias'",
                [],
                |row| row.get(0),
            )
            .map_err(unavailable)?;
        if alias_table != 0 {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        validate_v5(&tx)?;
        super::network_store::create_alias(&tx)?;
        tx.pragma_update(None, "user_version", AUTH_VERSION_V6)
            .map_err(unavailable)?;
        tx.commit().map_err(unavailable)?;
    } else if version != AUTH_VERSION_V6 {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate_v6(connection)
}
fn migrate_v6_to_v7(
    connection: &mut Connection,
    local_device: DeviceId,
    wall_ms: i64,
) -> Result<(), HostError> {
    validate_v6(connection)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    validate_v6(&tx)?;
    super::connection_store::create_v7_schema(&tx)?;
    let members = all_members_for_migration(&tx)?;
    let routes = super::network_store::routes(&tx)?;
    // The migration timestamp belongs to the new topology projection. Do not
    // advance the existing membership clock merely because a schema changed.
    let now_ms = wall_ms;
    super::connection_store::ensure_topology_from_verified_in_tx(
        &tx,
        local_device,
        &members,
        &routes,
        now_ms,
    )?;
    super::connection_store::validate_v7_schema(&tx)?;
    tx.pragma_update(None, "user_version", AUTH_VERSION)
        .map_err(unavailable)?;
    tx.commit().map_err(unavailable)
}
fn validate_common(connection: &Connection) -> Result<(), HostError> {
    validate_membership_layout(connection)?;
    super::sync_store::validate(connection)?;
    super::network_store::validate(connection)?;
    super::original_auto_store::validate(connection)
}
pub(super) fn validate_v6(connection: &Connection) -> Result<(), HostError> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(unavailable)?;
    if version != AUTH_VERSION_V6 {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate_common(connection)
}
pub(super) fn validate(connection: &Connection) -> Result<(), HostError> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(unavailable)?;
    if version != AUTH_VERSION {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate_common(connection)?;
    super::connection_store::validate_v7_schema(connection)
}
fn validate_v4(connection: &Connection) -> Result<(), HostError> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(unavailable)?;
    if version != 4 {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate_membership_layout(connection)?;
    super::sync_store::validate(connection)?;
    super::network_store::validate_v5(connection)
}
fn validate_v5(connection: &Connection) -> Result<(), HostError> {
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(unavailable)?;
    if version != 5 {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    validate_membership_layout(connection)?;
    super::sync_store::validate(connection)?;
    super::network_store::validate_v5(connection)?;
    super::original_auto_store::validate(connection)
}
fn validate_membership_layout(connection: &Connection) -> Result<(), HostError> {
    for (name, schema) in SCHEMAS {
        let found:Option<Option<String>>=connection.query_row(
            "SELECT CASE WHEN length(sql)<=1024 THEN sql END FROM sqlite_master WHERE type='table' AND name=?1",
            [name],|r|r.get(0),
        ).optional().map_err(unavailable)?;
        if found.as_ref().and_then(|value| value.as_deref()) != Some(*schema) {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
    }
    let valid:bool=connection.query_row("SELECT count(*)=1 AND min(layout)=?1 AND min(max_wall_ms)>=0 FROM peer_membership_layout",[LAYOUT],|r|r.get(0)).map_err(corrupt)?;
    if !valid {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    Ok(())
}
pub(super) fn transaction(connection: &mut Connection) -> Result<Transaction<'_>, HostError> {
    validate(connection)?;
    connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)
}
pub(super) fn now(connection: &Connection, wall_ms: i64) -> Result<i64, HostError> {
    if wall_ms < 0 {
        return Err(HostError::InvalidRequest);
    }
    connection
        .execute(
            "UPDATE peer_membership_layout SET max_wall_ms=max(max_wall_ms,?1) WHERE singleton=1",
            [wall_ms],
        )
        .map_err(unavailable)?;
    connection
        .query_row(
            "SELECT max_wall_ms FROM peer_membership_layout WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .map_err(corrupt)
}
pub(super) fn encode<T: Serialize>(value: &T) -> Result<String, HostError> {
    let raw = serde_json::to_string(value).map_err(unavailable)?;
    if raw.len() > MAX_JSON {
        return Err(HostError::PayloadTooLarge);
    }
    Ok(raw)
}
fn parse<T: DeserializeOwned>(raw: Option<String>) -> Result<T, HostError> {
    let raw = raw.ok_or(HostError::PeerMembershipRecoveryRequired)?;
    if raw.len() > MAX_JSON {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    serde_json::from_str(&raw).map_err(corrupt)
}
pub(super) fn invitation(
    connection: &Connection,
    id: Uuid,
) -> Result<Option<StoredInvitation>, HostError> {
    json(
        connection,
        "SELECT CASE WHEN length(body)<=16384 THEN body END FROM peer_invitations WHERE id=?1",
        id,
    )
}
pub(super) fn replacement_invitation(
    connection: &Connection,
    claim_id: Uuid,
) -> Result<Option<StoredInvitation>, HostError> {
    let mut statement=connection.prepare("SELECT CASE WHEN length(body)<=16384 THEN body END FROM peer_invitations WHERE json_extract(body,'$.replacement.request.claim_id')=?1 LIMIT 2").map_err(corrupt)?;
    let mut rows = statement.query([claim_id.to_string()]).map_err(corrupt)?;
    let found = match rows.next().map_err(corrupt)? {
        Some(row) => Some(parse(row.get(0).map_err(corrupt)?)?),
        None => None,
    };
    if rows.next().map_err(corrupt)?.is_some() {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    Ok(found)
}
pub(super) fn claim(connection: &Connection, id: Uuid) -> Result<Option<StoredClaim>, HostError> {
    json(
        connection,
        "SELECT CASE WHEN length(body)<=16384 THEN body END FROM peer_claims WHERE id=?1",
        id,
    )
}
pub(super) fn pending(
    connection: &Connection,
    id: Uuid,
) -> Result<Option<StoredPending>, HostError> {
    json(
        connection,
        "SELECT CASE WHEN length(body)<=16384 THEN body END FROM peer_pending WHERE id=?1",
        id,
    )
}
fn json<T: DeserializeOwned>(
    connection: &Connection,
    sql: &str,
    id: Uuid,
) -> Result<Option<T>, HostError> {
    connection
        .query_row(sql, [id.to_string()], |r| r.get::<_, Option<String>>(0))
        .optional()
        .map_err(unavailable)?
        .map(parse)
        .transpose()
}
pub(super) fn member(
    connection: &Connection,
    profile: exomind_core::ProfileId,
    device: exomind_core::DeviceId,
) -> Result<Option<StoredMember>, HostError> {
    let raw:Option<Option<String>>=connection.query_row("SELECT CASE WHEN length(body)<=16384 THEN body END FROM peer_members WHERE profile_id=?1 AND device_id=?2",params![profile.to_string(),device.to_string()],|r|r.get(0)).optional().map_err(unavailable)?;
    let member: Option<StoredMember> = raw.map(parse).transpose()?;
    if let Some(ref row) = member {
        validate_member(&row.record)?;
        if row.record.profile_id != profile || row.record.device_id != device {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
    }
    Ok(member)
}
pub(super) fn validate_member(member: &PeerMember) -> Result<(), HostError> {
    if super::transport::PeerPin::from_sha256(&member.pin).is_err()
        || member.generation == 0
        || member.generation > i64::MAX as u64
        || !matches!(member.state, PeerJoinState::Pending | PeerJoinState::Ready)
    {
        return Err(HostError::PeerMembershipRecoveryRequired);
    }
    Ok(())
}
/// A missing current row referenced by immutable join history is damage, not
/// a fresh member whose counter may restart at one and revive an old scope.
pub(super) fn member_has_history(
    connection: &Connection,
    profile: exomind_core::ProfileId,
    device: exomind_core::DeviceId,
) -> Result<bool, HostError> {
    connection.query_row(
        "SELECT EXISTS(
          SELECT 1 FROM peer_claims
           WHERE json_extract(body,'$.receipt.evidence.profile_id')=?1
             AND (json_extract(body,'$.receipt.evidence.joiner_device_id')=?2 OR json_extract(body,'$.receipt.evidence.issuer.device_id')=?2)
          UNION ALL
          SELECT 1 FROM peer_pending
           WHERE json_extract(body,'$.receipt.evidence.profile_id')=?1
             AND (json_extract(body,'$.receipt.evidence.joiner_device_id')=?2 OR json_extract(body,'$.receipt.evidence.issuer.device_id')=?2)
        )",params![profile.to_string(),device.to_string()],|r|r.get(0),
    ).map_err(corrupt)
}
pub(super) fn members(
    connection: &Connection,
    profile: exomind_core::ProfileId,
) -> Result<Vec<PeerMember>, HostError> {
    let mut statement=connection.prepare("SELECT CASE WHEN length(device_id)=36 THEN device_id END,CASE WHEN length(body)<=16384 THEN body END FROM peer_members WHERE profile_id=?1 ORDER BY device_id LIMIT 257").map_err(unavailable)?;
    let mut rows = statement
        .query([profile.to_string()])
        .map_err(unavailable)?;
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        if output.len() >= MAX_MEMBERS as usize {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        let id: String = row.get(0).map_err(corrupt)?;
        let member: StoredMember = parse(row.get(1).map_err(corrupt)?)?;
        validate_member(&member.record)?;
        if member.record.profile_id != profile || member.record.device_id.to_string() != id {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        output.push(member.record);
    }
    Ok(output)
}
pub(super) fn all_members(connection: &Connection) -> Result<Vec<PeerMember>, HostError> {
    validate(connection)?;
    all_members_rows(connection)
}
pub(super) fn all_members_for_migration(
    connection: &Connection,
) -> Result<Vec<PeerMember>, HostError> {
    validate_membership_layout(connection)?;
    all_members_rows(connection)
}
fn all_members_rows(connection: &Connection) -> Result<Vec<PeerMember>, HostError> {
    let mut statement = connection
        .prepare("SELECT CASE WHEN length(profile_id)=36 THEN profile_id END,CASE WHEN length(device_id)=36 THEN device_id END,CASE WHEN length(body)<=16384 THEN body END FROM peer_members ORDER BY profile_id,device_id LIMIT 257")
        .map_err(unavailable)?;
    let mut rows = statement.query([]).map_err(unavailable)?;
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        if output.len() >= MAX_MEMBERS as usize {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        let profile_key: String = row
            .get::<_, Option<String>>(0)
            .map_err(corrupt)?
            .ok_or(HostError::PeerMembershipRecoveryRequired)?;
        let profile_id: exomind_core::ProfileId = profile_key.parse().map_err(corrupt)?;
        let device_key: String = row
            .get::<_, Option<String>>(1)
            .map_err(corrupt)?
            .ok_or(HostError::PeerMembershipRecoveryRequired)?;
        let device_id: exomind_core::DeviceId = device_key.parse().map_err(corrupt)?;
        let member: StoredMember = parse(row.get::<_, Option<String>>(2).map_err(corrupt)?)?;
        validate_member(&member.record)?;
        if member.record.profile_id != profile_id
            || member.record.device_id != device_id
            || member.record.profile_id.to_string() != profile_key
            || member.record.device_id.to_string() != device_key
        {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        output.push(member.record);
    }
    Ok(output)
}
pub(super) fn member_profiles_page(
    connection: &Connection,
    device: exomind_core::DeviceId,
    after: Option<exomind_core::ProfileId>,
) -> Result<Vec<PeerMember>, HostError> {
    validate(connection)?;
    let mut statement = connection
        .prepare("SELECT CASE WHEN length(profile_id)=36 THEN profile_id END,CASE WHEN length(body)<=16384 THEN body END FROM peer_members WHERE device_id=?1 AND (?2 IS NULL OR profile_id>?2) ORDER BY profile_id LIMIT ?3")
        .map_err(unavailable)?;
    let mut rows = statement
        .query(params![
            device.to_string(),
            after.map(|profile| profile.to_string()),
            MAX_MEMBER_PROFILE_PAGE as i64
        ])
        .map_err(unavailable)?;
    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(unavailable)? {
        let profile_key: String = row
            .get::<_, Option<String>>(0)
            .map_err(corrupt)?
            .ok_or(HostError::PeerMembershipRecoveryRequired)?;
        let profile_id: exomind_core::ProfileId = profile_key.parse().map_err(corrupt)?;
        let member: StoredMember = parse(row.get::<_, Option<String>>(1).map_err(corrupt)?)?;
        validate_member(&member.record)?;
        if member.record.profile_id != profile_id
            || member.record.profile_id.to_string() != profile_key
            || member.record.device_id != device
        {
            return Err(HostError::PeerMembershipRecoveryRequired);
        }
        output.push(member.record);
    }
    Ok(output)
}
pub(super) fn reserve(connection: &Connection, table: &str, limit: i64) -> Result<(), HostError> {
    // Only module-owned static table names are passed here.
    let sql = match table {
        "peer_members" => "SELECT count(*) FROM (SELECT 1 FROM peer_members LIMIT 257)",
        "peer_invitations" => "SELECT count(*) FROM (SELECT 1 FROM peer_invitations LIMIT 129)",
        "peer_claims" => "SELECT count(*) FROM (SELECT 1 FROM peer_claims LIMIT 257)",
        "peer_pending" => "SELECT count(*) FROM (SELECT 1 FROM peer_pending LIMIT 257)",
        _ => return Err(HostError::InvalidRequest),
    };
    let count: i64 = connection
        .query_row(sql, [], |r| r.get(0))
        .map_err(unavailable)?;
    if count >= limit {
        return Err(HostError::PeerBusy);
    }
    Ok(())
}
pub(super) fn save_member(connection: &Connection, row: &StoredMember) -> Result<(), HostError> {
    validate_member(&row.record)?;
    if member(connection, row.record.profile_id, row.record.device_id)?.is_none() {
        reserve(connection, "peer_members", MAX_MEMBERS)?;
    }
    connection.execute("INSERT INTO peer_members VALUES(?1,?2,?3) ON CONFLICT(profile_id,device_id) DO UPDATE SET body=excluded.body",params![row.record.profile_id.to_string(),row.record.device_id.to_string(),encode(row)?]).map_err(unavailable)?;
    Ok(())
}
/// Persists an authenticated membership and its corresponding environment view
/// in the same transaction. The topology rows never grant membership or access.
pub(super) fn save_member_for_device(
    connection: &Connection,
    row: &StoredMember,
    local_device: DeviceId,
) -> Result<(), HostError> {
    save_member(connection, row)?;
    let wall_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(unavailable)?
        .as_millis()
        .try_into()
        .map_err(|_| HostError::InvalidRequest)?;
    super::connection_store::reconcile_current_topology_in_tx(
        connection,
        local_device,
        wall_ms,
    )
}
pub(super) fn save_invitation(
    connection: &Connection,
    row: &StoredInvitation,
) -> Result<(), HostError> {
    connection.execute("INSERT INTO peer_invitations VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![row.signed.offer.invitation_id.to_string(),encode(row)?]).map_err(unavailable)?;
    Ok(())
}
pub(super) fn save_claim(connection: &Connection, row: &StoredClaim) -> Result<(), HostError> {
    connection.execute("INSERT INTO peer_claims VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![row.binding.claim_id.to_string(),row.binding.invitation_id.to_string(),encode(row)?]).map_err(unavailable)?;
    Ok(())
}
pub(super) fn save_pending(connection: &Connection, row: &StoredPending) -> Result<(), HostError> {
    connection.execute("INSERT INTO peer_pending VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![row.binding.claim_id.to_string(),encode(row)?]).map_err(unavailable)?;
    Ok(())
}
