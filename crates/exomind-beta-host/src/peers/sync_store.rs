//! Outgoing data ACKs, not member authorization. The caller must hold the Host
//! gate and requalify its sealed scope; Core must verify each received cursor
//! against the actual local origin prefix before confirm is called.
use crate::HostError;
use exomind_core::{DeviceId, OriginCursor, OriginIdentity};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use uuid::Uuid;

const LAYOUT: &str = "exomind-peer-sync-ack/1";
const MAX_STREAMS: i64 = 4096;
const MAX_SQL_ROW_BYTES: i32 = 8192;
const OBJECTS: &[(&str, &str)] = &[
    (
        "peer_sync_ack_layout",
        "CREATE TABLE peer_sync_ack_layout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout TEXT NOT NULL,registered_count INTEGER NOT NULL CHECK(registered_count>=0 AND registered_count<=4096))",
    ),
    (
        "peer_sync_ack",
        "CREATE TABLE peer_sync_ack(profile_id TEXT NOT NULL CHECK(length(profile_id)=36),origin_device TEXT NOT NULL CHECK(length(origin_device)=36),origin_epoch TEXT NOT NULL CHECK(length(origin_epoch)=36),target_device TEXT NOT NULL CHECK(length(target_device)=36),ack_seq INTEGER,ack_hash TEXT,PRIMARY KEY(profile_id,origin_device,origin_epoch,target_device),CHECK((ack_seq IS NULL AND ack_hash IS NULL) OR (ack_seq IS NOT NULL AND ack_hash IS NOT NULL AND typeof(ack_seq)='integer' AND ack_seq>=0 AND typeof(ack_hash)='text' AND length(ack_hash)=64 AND ack_hash NOT GLOB '*[^0-9a-f]*')))",
    ),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OutgoingAckKey {
    origin: OriginIdentity,
    target: DeviceId,
}
impl OutgoingAckKey {
    pub(super) fn new(origin: OriginIdentity, target: DeviceId) -> Result<Self, HostError> {
        if origin.restoration_epoch.is_nil() || origin.device_id == target {
            return Err(HostError::InvalidRequest);
        }
        Ok(Self { origin, target })
    }
    pub(super) fn origin(&self) -> &OriginIdentity {
        &self.origin
    }
    pub(super) fn target(&self) -> DeviceId {
        self.target
    }
}
/// A snapshot taken before one RPC. Comparing against a later global highwater
/// would incorrectly classify a slower concurrent session's response as reset.
#[derive(Debug, Clone)]
pub(super) struct AckBaseline {
    key: OutgoingAckKey,
    cursor: Option<OriginCursor>,
}
impl AckBaseline {
    pub(super) fn key(&self) -> &OutgoingAckKey {
        &self.key
    }
    pub(super) fn cursor(&self) -> Option<&OriginCursor> {
        self.cursor.as_ref()
    }
}
fn unavailable<T>(_: T) -> HostError {
    HostError::PeerSyncUnavailable
}
fn recovery<T>(_: T) -> HostError {
    HostError::PeerSyncRecoveryRequired
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_cursor(cursor: &OriginCursor) -> bool {
    cursor.seq <= i64::MAX as u64 && valid_hash(&cursor.hash)
}

pub(super) fn ensure_absent(connection: &Connection) -> Result<(), HostError> {
    let count:i64=connection.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('peer_sync_ack','peer_sync_ack_layout')",[],|r|r.get(0)).map_err(unavailable)?;
    if count != 0 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(())
}
pub(super) fn create_schema(connection: &Connection) -> Result<(), HostError> {
    ensure_absent(connection)?;
    for (_, sql) in OBJECTS {
        connection.execute_batch(sql).map_err(unavailable)?;
    }
    connection
        .execute("INSERT INTO peer_sync_ack_layout VALUES(1,?1,0)", [LAYOUT])
        .map_err(unavailable)?;
    Ok(())
}
pub(super) fn validate(connection: &Connection) -> Result<(), HostError> {
    // A scoped limit also bounds SQLite's own decoding of a damaged ACK row.
    // Restore it on every return; other auth tables retain their own budgets.
    let previous = connection.limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH);
    connection.set_limit(
        rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
        previous.min(MAX_SQL_ROW_BYTES),
    );
    let _restore = LengthLimit {
        connection,
        previous,
    };
    let singleton_count:i64=connection.query_row("SELECT count(*) FROM peer_sync_ack_layout",[],|row|row.get(0)).map_err(recovery)?;
    if singleton_count!=1 {return Err(HostError::PeerSyncRecoveryRequired);}
    for (name, sql) in OBJECTS {
        let actual:Option<Option<String>>=connection.query_row("SELECT CASE WHEN length(sql)<=2048 THEN sql END FROM sqlite_master WHERE name=?1 AND type='table'",[name],|r|r.get(0)).optional().map_err(unavailable)?;
        if actual.as_ref().and_then(|v| v.as_deref()) != Some(*sql) {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
    }
    let (layout,count):(Option<String>,i64)=connection.query_row("SELECT CASE WHEN length(layout)<=64 THEN layout END,registered_count FROM peer_sync_ack_layout WHERE singleton=1",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(recovery)?;
    if layout.as_deref() != Some(LAYOUT) || !(0..=MAX_STREAMS).contains(&count) {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let anchors: i64 = connection
        .query_row(
            "SELECT count(*) FROM (SELECT 1 FROM peer_sync_ack_layout LIMIT 2)",
            [],
            |r| r.get(0),
        )
        .map_err(recovery)?;
    let rows: i64 = connection
        .query_row(
            "SELECT count(*) FROM (SELECT 1 FROM peer_sync_ack LIMIT 4097)",
            [],
            |r| r.get(0),
        )
        .map_err(recovery)?;
    if anchors != 1 || rows != count {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    // Bound SQLite-to-Rust values even if an external writer disabled CHECKs.
    // Validation has a hard row-count bound and retains no full-table cache.
    let mut statement=connection.prepare("SELECT CASE WHEN typeof(profile_id)='text' AND length(profile_id)=36 THEN profile_id END,CASE WHEN typeof(origin_device)='text' AND length(origin_device)=36 THEN origin_device END,CASE WHEN typeof(origin_epoch)='text' AND length(origin_epoch)=36 THEN origin_epoch END,CASE WHEN typeof(target_device)='text' AND length(target_device)=36 THEN target_device END,CASE WHEN typeof(ack_seq)='integer' THEN ack_seq END,CASE WHEN typeof(ack_hash)='text' AND length(ack_hash)=64 THEN ack_hash END,ack_seq IS NULL AND ack_hash IS NULL FROM peer_sync_ack LIMIT 4097").map_err(recovery)?;
    let mut rows = statement.query([]).map_err(recovery)?;
    while let Some(row) = rows.next().map_err(recovery)? {
        let profile: String = row
            .get::<_, Option<String>>(0)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let device: String = row
            .get::<_, Option<String>>(1)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let epoch: String = row
            .get::<_, Option<String>>(2)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let target: String = row
            .get::<_, Option<String>>(3)
            .map_err(recovery)?
            .ok_or(HostError::PeerSyncRecoveryRequired)?;
        let profile = profile.parse().map_err(recovery)?;
        let device = device.parse().map_err(recovery)?;
        let target = target.parse().map_err(recovery)?;
        let epoch: Uuid = epoch.parse().map_err(recovery)?;
        OutgoingAckKey::new(
            OriginIdentity {
                profile_id: profile,
                device_id: device,
                restoration_epoch: epoch,
            },
            target,
        )
        .map_err(recovery)?;
        let none: bool = row.get(6).map_err(recovery)?;
        let seq: Option<i64> = row.get(4).map_err(recovery)?;
        let hash: Option<String> = row.get(5).map_err(recovery)?;
        if !none && (seq.is_none_or(|s| s < 0) || hash.as_deref().is_none_or(|h| !valid_hash(h))) {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
    }
    Ok(())
}
struct LengthLimit<'a> {
    connection: &'a Connection,
    previous: i32,
}
impl Drop for LengthLimit<'_> {
    fn drop(&mut self) {
        self.connection
            .set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH, self.previous);
    }
}
fn current(
    connection: &Connection,
    key: &OutgoingAckKey,
) -> Result<Option<OriginCursor>, HostError> {
    let row:Option<(Option<i64>,Option<String>)>=connection.query_row("SELECT ack_seq,CASE WHEN length(ack_hash)=64 THEN ack_hash END FROM peer_sync_ack WHERE profile_id=?1 AND origin_device=?2 AND origin_epoch=?3 AND target_device=?4",params![key.origin.profile_id.to_string(),key.origin.device_id.to_string(),key.origin.restoration_epoch.to_string(),key.target.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(unavailable)?;
    match row.ok_or(HostError::PeerSyncRecoveryRequired)? {
        (None, None) => Ok(None),
        (Some(seq), Some(hash)) if seq >= 0 && valid_hash(&hash) => Ok(Some(OriginCursor {
            seq: seq as u64,
            hash,
        })),
        _ => Err(HostError::PeerSyncRecoveryRequired),
    }
}
pub(super) fn load(
    connection: &Connection,
    key: &OutgoingAckKey,
) -> Result<AckBaseline, HostError> {
    super::membership_store::validate(connection)?;
    Ok(AckBaseline {
        key: key.clone(),
        cursor: current(connection, key)?,
    })
}
pub(super) fn register(
    connection: &mut Connection,
    key: &OutgoingAckKey,
) -> Result<AckBaseline, HostError> {
    super::membership_store::validate(connection)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM peer_sync_ack WHERE profile_id=?1 AND origin_device=?2 AND origin_epoch=?3 AND target_device=?4)",params![key.origin.profile_id.to_string(),key.origin.device_id.to_string(),key.origin.restoration_epoch.to_string(),key.target.to_string()],|r|r.get(0)).map_err(unavailable)?;
    if !exists {
        let count: i64 = tx
            .query_row(
                "SELECT registered_count FROM peer_sync_ack_layout WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .map_err(recovery)?;
        if count >= MAX_STREAMS {
            return Err(HostError::PeerBusy);
        }
        tx.execute(
            "INSERT INTO peer_sync_ack VALUES(?1,?2,?3,?4,NULL,NULL)",
            params![
                key.origin.profile_id.to_string(),
                key.origin.device_id.to_string(),
                key.origin.restoration_epoch.to_string(),
                key.target.to_string()
            ],
        )
        .map_err(unavailable)?;
        tx.execute(
            "UPDATE peer_sync_ack_layout SET registered_count=registered_count+1 WHERE singleton=1",
            [],
        )
        .map_err(unavailable)?;
    }
    let baseline = AckBaseline {
        key: key.clone(),
        cursor: current(&tx, key)?,
    };
    tx.commit().map_err(unavailable)?;
    Ok(baseline)
}
pub(super) fn fence(baseline: &AckBaseline, remote: &OriginCursor) -> Result<(), HostError> {
    if !valid_cursor(remote) {
        return Err(HostError::InvalidRequest);
    }
    if let Some(known) = &baseline.cursor {
        if remote.seq < known.seq || (remote.seq == known.seq && remote.hash != known.hash) {
            return Err(HostError::PeerSyncResetRequired);
        }
    }
    Ok(())
}
pub(super) fn confirm(
    connection: &mut Connection,
    key: &OutgoingAckKey,
    ack: &OriginCursor,
) -> Result<OriginCursor, HostError> {
    if !valid_cursor(ack) {
        return Err(HostError::InvalidRequest);
    }
    super::membership_store::validate(connection)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(unavailable)?;
    if let Some(known) = current(&tx, key)? {
        if ack.seq < known.seq {
            tx.commit().map_err(unavailable)?;
            return Ok(known);
        }
        if ack.seq == known.seq {
            if ack.hash != known.hash {
                return Err(HostError::PeerSyncResetRequired);
            }
            tx.commit().map_err(unavailable)?;
            return Ok(known);
        }
    }
    tx.execute("UPDATE peer_sync_ack SET ack_seq=?1,ack_hash=?2 WHERE profile_id=?3 AND origin_device=?4 AND origin_epoch=?5 AND target_device=?6",params![ack.seq as i64,ack.hash,key.origin.profile_id.to_string(),key.origin.device_id.to_string(),key.origin.restoration_epoch.to_string(),key.target.to_string()]).map_err(unavailable)?;
    tx.commit().map_err(unavailable)?;
    Ok(ack.clone())
}

#[cfg(test)]
#[path = "sync_store_tests.rs"]
mod tests;
