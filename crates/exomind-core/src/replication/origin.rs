use super::{OriginCursor, OriginIdentity, OriginSnapshot};
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
        "agent_summary/1" => {
            let fact: crate::ExternalSummaryRecord = serde_json::from_str(&body)?;
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
    /// A bounded change inventory for all already materialized sources in P.
    /// This reads only stream/endpoint metadata, never fact bodies or original
    /// bytes. It is not an attestation: export/import still validate canonical
    /// facts before they can be sent or admitted. Overflow is explicit rather
    /// than a truncated inventory being mistaken for complete source coverage.
    pub fn origin_inventory(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        limit: usize,
    ) -> Result<Vec<OriginSnapshot>, CoreError> {
        const MAX_INVENTORY: usize = 4096;
        self.check_scope(context, profile)?;
        if limit == 0 || limit > MAX_INVENTORY {
            return Err(CoreError::InvalidQuery("origin inventory budget"));
        }
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT
                CASE WHEN typeof(h.origin_device)='text' AND length(h.origin_device)=36 THEN h.origin_device END,
                CASE WHEN typeof(h.restoration_epoch)='text' AND length(h.restoration_epoch)=36 THEN h.restoration_epoch END,
                h.head_seq,CASE WHEN typeof(h.head_hash)='text' AND length(h.head_hash)=64 THEN h.head_hash END,
                CASE WHEN h.origin_device=?2 THEN l.restoration_epoch ELSE a.restoration_epoch END,
                (SELECT CASE WHEN length(e.chain_hash)=64 THEN e.chain_hash END FROM origin_entries e WHERE e.profile_id=h.profile_id AND e.origin_device=h.origin_device AND e.restoration_epoch=h.restoration_epoch AND e.origin_seq=h.head_seq),
                EXISTS(SELECT 1 FROM origin_entries e WHERE e.profile_id=h.profile_id AND e.origin_device=h.origin_device AND e.restoration_epoch=h.restoration_epoch),
                v.verified_seq,v.verified_hash,s.chain_hash,
                CASE WHEN typeof(s.signature)='blob' THEN length(s.signature) END,
                (SELECT chain_hash FROM origin_entries e WHERE e.profile_id=h.profile_id AND e.origin_device=h.origin_device AND e.restoration_epoch=h.restoration_epoch AND e.origin_seq=v.verified_seq),
                CASE WHEN typeof(k.public_key_spki)='blob' AND length(k.public_key_spki)=44 AND typeof(k.fingerprint_sha256)='text' AND length(k.fingerprint_sha256)=64 THEN k.fingerprint_sha256 END
             FROM origin_heads h
             LEFT JOIN local_origin_epochs l ON l.profile_id=h.profile_id
             LEFT JOIN accepted_origin_epochs a ON a.profile_id=h.profile_id AND a.origin_device=h.origin_device
             LEFT JOIN verified_origin_prefixes v ON v.profile_id=h.profile_id AND v.origin_device=h.origin_device AND v.restoration_epoch=h.restoration_epoch
             LEFT JOIN origin_position_proofs s ON s.profile_id=v.profile_id AND s.origin_device=v.origin_device AND s.restoration_epoch=v.restoration_epoch AND s.origin_seq=v.verified_seq
             LEFT JOIN origin_provenance_keys k ON k.profile_id=h.profile_id AND k.origin_device=h.origin_device
             WHERE h.profile_id=?1 ORDER BY h.origin_device,h.restoration_epoch LIMIT ?3",
        )?;
        let mut rows = statement.query(params![
            profile.to_string(),
            self.device_id().to_string(),
            limit + 1
        ])?;
        let mut inventory = Vec::new();
        while let Some(row) = rows.next()? {
            if inventory.len() == limit {
                return Err(CoreError::InvalidQuery("origin inventory exceeds budget"));
            }
            let device = row
                .get::<_, Option<String>>(0)?
                .ok_or(CoreError::RecoveryRequired)?;
            let epoch = row
                .get::<_, Option<String>>(1)?
                .ok_or(CoreError::RecoveryRequired)?;
            let seq = row.get::<_, u64>(2)?;
            let hash = row
                .get::<_, Option<String>>(3)?
                .ok_or(CoreError::RecoveryRequired)?;
            let registered: Option<String> = row.get(4)?;
            let endpoint: Option<String> = row.get(5)?;
            let has_entries: bool = row.get(6)?;
            let identity = OriginIdentity {
                profile_id: profile,
                device_id: device.parse()?,
                restoration_epoch: epoch.parse().map_err(|_| CoreError::RecoveryRequired)?,
            };
            if identity.restoration_epoch.is_nil()
                || registered.as_deref() != Some(epoch.as_str())
                || seq > i64::MAX as u64
                || !hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                || seq == 0 && (has_entries || hash != genesis(&identity)?)
                || seq > 0 && endpoint.as_deref() != Some(hash.as_str())
            {
                return Err(CoreError::RecoveryRequired);
            }
            let proof_seq: Option<u64> = row.get(7)?;
            let proof_hash: Option<String> = row.get(8)?;
            let signed_hash: Option<String> = row.get(9)?;
            let signature_length: Option<usize> = row.get(10)?;
            let proof_endpoint: Option<String> = row.get(11)?;
            let key_pin: Option<String> = row.get(12)?;
            let own = identity.device_id == self.device_id();
            let verified_head = match (proof_seq, proof_hash) {
                (None, None) => {
                    if signed_hash.is_some() || signature_length.is_some() || key_pin.is_some() {
                        return Err(CoreError::RecoveryRequired);
                    }
                    own.then(|| OriginCursor {
                        seq,
                        hash: hash.clone(),
                    })
                }
                (Some(position), Some(digest)) if !own => {
                    if position > seq
                        || digest.len() != 64
                        || !digest
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                        || signed_hash.as_deref() != Some(digest.as_str())
                        || signature_length != Some(64)
                        || key_pin.as_ref().is_none_or(|p| {
                            !p.bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                        })
                        || position == 0 && digest != genesis(&identity)?
                        || position > 0 && proof_endpoint.as_deref() != Some(digest.as_str())
                    {
                        return Err(CoreError::RecoveryRequired);
                    }
                    Some(OriginCursor {
                        seq: position,
                        hash: digest,
                    })
                }
                _ => return Err(CoreError::RecoveryRequired),
            };
            inventory.push(OriginSnapshot {
                origin: identity,
                head: OriginCursor { seq, hash },
                verified_head,
            });
        }
        Ok(inventory)
    }

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
