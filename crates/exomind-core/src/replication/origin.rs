use super::{OriginCursor, OriginIdentity};
use crate::{Core, CoreError, DeviceId, EventId, ProfileId, WriterContext};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn hash(value: &impl serde::Serialize) -> Result<String, CoreError> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value)?)))
}
pub(super) fn genesis(identity: &OriginIdentity) -> Result<String, CoreError> {
    hash(&(
        "exomind-origin-genesis/1",
        identity.profile_id,
        identity.device_id,
        identity.restoration_epoch,
    ))
}
pub(super) fn entry_hash(
    identity: &OriginIdentity,
    sequence: u64,
    kind: &str,
    event: EventId,
    digest: &str,
    previous: &str,
) -> Result<String, CoreError> {
    hash(&(
        "exomind-origin-entry/1",
        identity.profile_id,
        identity.device_id,
        identity.restoration_epoch,
        sequence,
        kind,
        event,
        digest,
        previous,
    ))
}
pub(super) fn local_identity(
    connection: &Connection,
    profile: ProfileId,
    device: DeviceId,
) -> Result<OriginIdentity, CoreError> {
    let epoch: Option<Option<String>> = connection
        .query_row(
            "SELECT CASE WHEN typeof(restoration_epoch)='text' AND length(restoration_epoch)=36 THEN restoration_epoch END FROM local_origin_epochs WHERE profile_id=?1",
            [profile.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    let restoration_epoch: Uuid = epoch
        .flatten()
        .ok_or(CoreError::RecoveryRequired)?
        .parse()?;
    if restoration_epoch.is_nil() {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(OriginIdentity {
        profile_id: profile,
        device_id: device,
        restoration_epoch,
    })
}
pub(crate) fn provision_local_origin(
    transaction: &Transaction<'_>,
    profile: ProfileId,
    device: DeviceId,
) -> Result<(), CoreError> {
    let identity = OriginIdentity {
        profile_id: profile,
        device_id: device,
        restoration_epoch: Uuid::new_v4(),
    };
    transaction.execute(
        "INSERT INTO local_origin_epochs VALUES(?1,?2)",
        params![profile.to_string(), identity.restoration_epoch.to_string()],
    )?;
    transaction.execute(
        "INSERT INTO origin_heads VALUES(?1,?2,?3,0,?4)",
        params![
            profile.to_string(),
            device.to_string(),
            identity.restoration_epoch.to_string(),
            genesis(&identity)?
        ],
    )?;
    Ok(())
}
pub(super) fn head(
    connection: &Connection,
    identity: &OriginIdentity,
) -> Result<OriginCursor, CoreError> {
    let row:Option<(u64,Option<String>)>=connection.query_row("SELECT head_seq,CASE WHEN typeof(head_hash)='text' AND length(head_hash)=64 THEN head_hash END FROM origin_heads WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",params![identity.profile_id.to_string(),identity.device_id.to_string(),identity.restoration_epoch.to_string()],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    let (seq, hash) = row.ok_or(CoreError::RecoveryRequired)?;
    let hash = hash.ok_or(CoreError::RecoveryRequired)?;
    if seq > i64::MAX as u64
        || hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(CoreError::RecoveryRequired);
    }
    if seq == 0 {
        let present:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM origin_entries WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3)",params![identity.profile_id.to_string(),identity.device_id.to_string(),identity.restoration_epoch.to_string()],|row|row.get(0))?;
        if present || hash != genesis(identity)? {
            return Err(CoreError::RecoveryRequired);
        }
    } else {
        verify_endpoint(connection, identity, seq, &hash)?;
    }
    Ok(OriginCursor { seq, hash })
}

// A checkpoint is not permission to silently ignore a missing endpoint or a
// changed fact. Full prefix validation belongs to bounded export/import pages.
pub(super) fn verify_endpoint(
    connection: &Connection,
    identity: &OriginIdentity,
    seq: u64,
    expected: &str,
) -> Result<(), CoreError> {
    type Row = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let row:Option<Row>=connection.query_row("SELECT CASE WHEN length(o.event_id)=36 THEN o.event_id END,CASE WHEN length(o.fact_type)<=16 THEN o.fact_type END,CASE WHEN length(o.digest)=64 THEN o.digest END,CASE WHEN length(o.chain_hash)=64 THEN o.chain_hash END,CASE WHEN length(e.digest)=64 THEN e.digest END,CASE WHEN typeof(e.body)='text' AND length(CAST(e.body AS BLOB))<=?5 THEN e.body END FROM origin_entries o JOIN events e ON e.event_id=o.event_id AND e.profile_id=o.profile_id WHERE o.profile_id=?1 AND o.origin_device=?2 AND o.restoration_epoch=?3 AND o.origin_seq=?4",params![identity.profile_id.to_string(),identity.device_id.to_string(),identity.restoration_epoch.to_string(),seq,crate::MAX_FACT_BYTES],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?))).optional()?;
    let (event, kind, digest, chain, stored_digest, body) =
        row.ok_or(CoreError::RecoveryRequired)?;
    let event: EventId = event.ok_or(CoreError::RecoveryRequired)?.parse()?;
    let kind = kind.ok_or(CoreError::RecoveryRequired)?;
    let digest = digest.ok_or(CoreError::RecoveryRequired)?;
    let chain = chain.ok_or(CoreError::RecoveryRequired)?;
    let body = body.ok_or(CoreError::RecoveryRequired)?;
    if chain != expected || stored_digest.as_ref() != Some(&digest) {
        return Err(CoreError::RecoveryRequired);
    }
    let expected_kind = if kind == "capture/1" || kind == "capture/2" {
        "capture"
    } else {
        kind.as_str()
    };
    let matches_kind: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE event_id=?1 AND kind=?2)",
        params![event.to_string(), expected_kind],
        |row| row.get(0),
    )?;
    if !matches_kind {
        return Err(CoreError::RecoveryRequired);
    }
    let valid = match kind.as_str() {
        "capture/1" | "capture/2" => {
            let fact: crate::EventRecord = serde_json::from_str(&body)?;
            fact.event_id == event
                && fact.profile_id == identity.profile_id
                && fact.device_id == identity.device_id
                && fact.digest == digest
                && fact.computed_digest()? == digest
                && (if fact.originals.is_empty() {
                    "capture/1"
                } else {
                    "capture/2"
                }) == kind
        }
        "timeblock/1" => {
            let fact: crate::TimeblockNodeRecord = serde_json::from_str(&body)?;
            fact.event_id == event
                && fact.profile_id == identity.profile_id
                && fact.device_id == identity.device_id
                && fact.digest == digest
                && fact.computed_digest()? == digest
        }
        "summary_job/1" => {
            let fact: crate::SummaryJobRecord = serde_json::from_str(&body)?;
            fact.validate()?;
            fact.event_id == event
                && fact.profile_id == identity.profile_id
                && fact.device_id == identity.device_id
                && fact.digest == digest
        }
        "summary/1" => {
            let fact: crate::SummaryArtifactRecord = serde_json::from_str(&body)?;
            fact.validate()?;
            fact.event_id == event
                && fact.profile_id == identity.profile_id
                && fact.device_id == identity.device_id
                && fact.digest == digest
        }
        _ => false,
    };
    let previous = if seq == 1 {
        genesis(identity)?
    } else {
        connection.query_row("SELECT CASE WHEN typeof(chain_hash)='text' AND length(chain_hash)=64 THEN chain_hash END FROM origin_entries WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND origin_seq=?4",params![identity.profile_id.to_string(),identity.device_id.to_string(),identity.restoration_epoch.to_string(),seq-1],|row|row.get::<_,Option<String>>(0)).optional()?.flatten().ok_or(CoreError::RecoveryRequired)?
    };
    if !valid || entry_hash(identity, seq, &kind, event, &digest, &previous)? != chain {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}
pub(crate) fn record_local_fact(
    transaction: &Transaction<'_>,
    profile: ProfileId,
    device: DeviceId,
    event: EventId,
    kind: &str,
    digest: &str,
) -> Result<(), CoreError> {
    let identity = local_identity(transaction, profile, device)?;
    let previous = head(transaction, &identity)?;
    let sequence = previous
        .seq
        .checked_add(1)
        .filter(|value| *value <= i64::MAX as u64)
        .ok_or(CoreError::InvalidReplication("origin sequence overflow"))?;
    let chain = entry_hash(&identity, sequence, kind, event, digest, &previous.hash)?;
    transaction.execute(
        "INSERT INTO origin_entries VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            profile.to_string(),
            device.to_string(),
            identity.restoration_epoch.to_string(),
            sequence,
            event.to_string(),
            kind,
            digest,
            chain
        ],
    )?;
    transaction.execute("UPDATE origin_heads SET head_seq=?4,head_hash=?5 WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",params![profile.to_string(),device.to_string(),identity.restoration_epoch.to_string(),sequence,chain])?;
    Ok(())
}
impl Core {
    pub fn replication_identity(
        &self,
        context: &WriterContext,
        profile: ProfileId,
    ) -> Result<OriginIdentity, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        local_identity(&connection, profile, self.device_id())
    }
    pub fn origin_checkpoint(
        &self,
        context: &WriterContext,
        profile: ProfileId,
    ) -> Result<OriginCursor, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        head(
            &connection,
            &local_identity(&connection, profile, self.device_id())?,
        )
    }
}
