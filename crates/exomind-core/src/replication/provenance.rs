//! Public source keys and Host-verified position proofs. These are data-plane
//! provenance, never peer membership or grants. Facts, data cursor and proof
//! prefix commit together; a legacy unsigned cursor is not a verified prefix.
use super::{OriginCursor, OriginIdentity, OriginPage, ReplicaContext, transfer};
use crate::{Core, CoreError, DeviceId, ProfileId, WriterContext};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const OBJECTS: &[(&str, &str, &str)] = &[
    (
        "table",
        "origin_provenance_keys",
        "CREATE TABLE origin_provenance_keys(profile_id TEXT NOT NULL REFERENCES profiles(id),origin_device TEXT NOT NULL,public_key_spki BLOB NOT NULL CHECK(typeof(public_key_spki)='blob' AND length(public_key_spki)=44),fingerprint_sha256 TEXT NOT NULL CHECK(length(fingerprint_sha256)=64),PRIMARY KEY(profile_id,origin_device))",
    ),
    (
        "table",
        "origin_position_proofs",
        "CREATE TABLE origin_position_proofs(profile_id TEXT NOT NULL,origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,origin_seq INTEGER NOT NULL CHECK(origin_seq>=0),chain_hash TEXT NOT NULL CHECK(length(chain_hash)=64),signature BLOB NOT NULL CHECK(typeof(signature)='blob' AND length(signature)=64),PRIMARY KEY(profile_id,origin_device,restoration_epoch,origin_seq),FOREIGN KEY(profile_id,origin_device) REFERENCES origin_provenance_keys(profile_id,origin_device),FOREIGN KEY(profile_id,origin_device,restoration_epoch) REFERENCES origin_heads(profile_id,origin_device,restoration_epoch))",
    ),
    (
        "table",
        "verified_origin_prefixes",
        "CREATE TABLE verified_origin_prefixes(profile_id TEXT NOT NULL,origin_device TEXT NOT NULL,restoration_epoch TEXT NOT NULL,verified_seq INTEGER NOT NULL CHECK(verified_seq>=0),verified_hash TEXT NOT NULL CHECK(length(verified_hash)=64),PRIMARY KEY(profile_id,origin_device,restoration_epoch),FOREIGN KEY(profile_id,origin_device,restoration_epoch,verified_seq) REFERENCES origin_position_proofs(profile_id,origin_device,restoration_epoch,origin_seq))",
    ),
    (
        "trigger",
        "origin_provenance_key_no_update",
        "CREATE TRIGGER origin_provenance_key_no_update BEFORE UPDATE ON origin_provenance_keys BEGIN SELECT RAISE(ABORT,'origin provenance key is immutable'); END",
    ),
    (
        "trigger",
        "origin_provenance_key_no_delete",
        "CREATE TRIGGER origin_provenance_key_no_delete BEFORE DELETE ON origin_provenance_keys BEGIN SELECT RAISE(ABORT,'origin provenance key is immutable'); END",
    ),
    (
        "trigger",
        "origin_position_proof_no_update",
        "CREATE TRIGGER origin_position_proof_no_update BEFORE UPDATE ON origin_position_proofs BEGIN SELECT RAISE(ABORT,'origin position proof is immutable'); END",
    ),
    (
        "trigger",
        "origin_position_proof_no_delete",
        "CREATE TRIGGER origin_position_proof_no_delete BEFORE DELETE ON origin_position_proofs BEGIN SELECT RAISE(ABORT,'origin position proof is immutable'); END",
    ),
    (
        "trigger",
        "verified_origin_prefix_guard",
        "CREATE TRIGGER verified_origin_prefix_guard BEFORE UPDATE ON verified_origin_prefixes WHEN NEW.profile_id<>OLD.profile_id OR NEW.origin_device<>OLD.origin_device OR NEW.restoration_epoch<>OLD.restoration_epoch OR NEW.verified_seq<=OLD.verified_seq BEGIN SELECT RAISE(ABORT,'verified origin prefix must advance'); END",
    ),
    (
        "trigger",
        "verified_origin_prefix_no_delete",
        "CREATE TRIGGER verified_origin_prefix_no_delete BEFORE DELETE ON verified_origin_prefixes BEGIN SELECT RAISE(ABORT,'verified origin prefix is durable'); END",
    ),
];

pub(crate) fn migrate(tx: &Transaction<'_>) -> Result<(), CoreError> {
    // Do not silently adopt names planted in an older database.
    for (_, name, definition) in OBJECTS {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",
            [name],
            |r| r.get(0),
        )?;
        if exists {
            return Err(CoreError::RecoveryRequired);
        }
        tx.execute_batch(definition)?;
    }
    validate(tx)
}
pub(crate) fn validate(connection: &Connection) -> Result<(), CoreError> {
    super::schema::validate_objects(connection, OBJECTS)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginProvenanceKey {
    pub public_key_spki: Vec<u8>,
    pub fingerprint_sha256: String,
}
impl OriginProvenanceKey {
    fn validate(&self) -> Result<(), CoreError> {
        const ED25519_SPKI_PREFIX: &[u8] = &[
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ];
        if self.public_key_spki.len() != 44
            || !self.public_key_spki.starts_with(ED25519_SPKI_PREFIX)
            || self.fingerprint_sha256 != format!("{:x}", Sha256::digest(&self.public_key_spki))
        {
            return Err(CoreError::InvalidReplication(
                "invalid source provenance key",
            ));
        }
        Ok(())
    }
}

/// Transportable bytes, not a verified capability. Host must authenticate each
/// entry position and the frozen head under the qualified key before admission.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginPageProof {
    pub entry_signatures: Vec<Vec<u8>>,
    pub through_signature: Vec<u8>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifiedOriginState {
    pub key: OriginProvenanceKey,
    pub cursor: OriginCursor,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginReceiveState {
    pub data: OriginCursor,
    pub verified: OriginCursor,
    /// Empty sources also establish their accepted epoch and signed genesis.
    pub proofs_present: bool,
}

/// Explicit Host admission for authenticated source positions carried by a
/// currently authorized peer. Never deserialize this from a request. It adds
/// no member and cannot bypass the Host's final current-generation gate.
///
/// ```compile_fail
/// let _: exomind_core::VerifiedOriginContext = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Clone)]
pub struct VerifiedOriginContext {
    pub(super) replica: ReplicaContext,
    key: OriginProvenanceKey,
    carrier_device: DeviceId,
}
impl VerifiedOriginContext {
    pub fn carrier_device(&self) -> DeviceId {
        self.carrier_device
    }
    pub fn member_generation(&self) -> u64 {
        self.replica.member_generation()
    }
}

fn load_key(
    connection: &Connection,
    profile: ProfileId,
    device: DeviceId,
) -> Result<Option<OriginProvenanceKey>, CoreError> {
    let key = connection.query_row(
        "SELECT CASE WHEN typeof(public_key_spki)='blob' AND length(public_key_spki)=44 THEN public_key_spki END,CASE WHEN typeof(fingerprint_sha256)='text' AND length(fingerprint_sha256)=64 THEN fingerprint_sha256 END FROM origin_provenance_keys WHERE profile_id=?1 AND origin_device=?2",
        params![profile.to_string(), device.to_string()],
        |r| Ok((r.get::<_,Option<Vec<u8>>>(0)?,r.get::<_,Option<String>>(1)?)),
    ).optional()?;
    key.map(|(spki, fingerprint)| {
        let key = OriginProvenanceKey {
            public_key_spki: spki.ok_or(CoreError::RecoveryRequired)?,
            fingerprint_sha256: fingerprint.ok_or(CoreError::RecoveryRequired)?,
        };
        key.validate().map_err(|_| CoreError::RecoveryRequired)?;
        Ok(key)
    })
    .transpose()
}

fn proof_signature(
    connection: &Connection,
    id: &OriginIdentity,
    position: &OriginCursor,
) -> Result<Vec<u8>, CoreError> {
    let row = connection.query_row(
        "SELECT chain_hash,CASE WHEN typeof(signature)='blob' AND length(signature)=64 THEN signature END FROM origin_position_proofs WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND origin_seq=?4",
        params![id.profile_id.to_string(), id.device_id.to_string(), id.restoration_epoch.to_string(), position.seq],
        |r| Ok((r.get::<_,String>(0)?,r.get::<_,Option<Vec<u8>>>(1)?)),
    ).optional()?.ok_or(CoreError::RecoveryRequired)?;
    if row.0 != position.hash {
        return Err(CoreError::RecoveryRequired);
    }
    row.1.ok_or(CoreError::RecoveryRequired)
}

fn load_prefix(
    connection: &Connection,
    id: &OriginIdentity,
) -> Result<Option<OriginCursor>, CoreError> {
    let cursor = connection.query_row(
        "SELECT verified_seq,CASE WHEN typeof(verified_hash)='text' AND length(verified_hash)=64 THEN verified_hash END FROM verified_origin_prefixes WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",
        params![id.profile_id.to_string(), id.device_id.to_string(), id.restoration_epoch.to_string()],
        |r| Ok((r.get::<_,u64>(0)?,r.get::<_,Option<String>>(1)?)),
    ).optional()?;
    cursor
        .map(|(seq, hash)| {
            let cursor = OriginCursor {
                seq,
                hash: hash.ok_or(CoreError::RecoveryRequired)?,
            };
            if transfer::cursor_at(connection, id, seq)? != cursor {
                return Err(CoreError::RecoveryRequired);
            }
            proof_signature(connection, id, &cursor)?;
            Ok(cursor)
        })
        .transpose()
}

fn save_position(
    tx: &Transaction<'_>,
    id: &OriginIdentity,
    position: &OriginCursor,
    signature: &[u8],
) -> Result<(), CoreError> {
    let existing: Option<String> = tx.query_row(
        "SELECT chain_hash FROM origin_position_proofs WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3 AND origin_seq=?4",
        params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),position.seq], |r|r.get(0),
    ).optional()?;
    if let Some(hash) = existing {
        if hash != position.hash {
            return Err(CoreError::InvalidReplication(
                "source proof position conflict",
            ));
        }
        proof_signature(tx, id, position)?;
    } else {
        tx.execute(
            "INSERT INTO origin_position_proofs VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                id.restoration_epoch.to_string(),
                position.seq,
                position.hash,
                signature
            ],
        )?;
    }
    Ok(())
}

/// Called only within ingest's fact/cursor transaction, after canonical chain
/// validation. Any storage/key/prefix failure rolls the whole page back.
pub(super) fn admit(
    tx: &Transaction<'_>,
    page: &OriginPage,
    key: &OriginProvenanceKey,
    proof: &OriginPageProof,
) -> Result<(), CoreError> {
    key.validate()?;
    if proof.entry_signatures.len() != page.entries.len()
        || proof.through_signature.len() != 64
        || proof.entry_signatures.iter().any(|s| s.len() != 64)
    {
        return Err(CoreError::InvalidReplication("invalid source proof shape"));
    }
    let id = &page.origin;
    let old = load_prefix(tx, id)?;
    let previous = old.clone().unwrap_or(OriginCursor {
        seq: 0,
        hash: super::origin::genesis(id)?,
    });
    if page.from.seq > previous.seq {
        return Err(CoreError::InvalidReplication("source proof prefix gap"));
    }
    if let Some(stored) = load_key(tx, id.profile_id, id.device_id)? {
        if &stored != key {
            return Err(CoreError::InvalidReplication(
                "source provenance key changed",
            ));
        }
        if old.is_none() {
            return Err(CoreError::RecoveryRequired);
        }
    } else {
        tx.execute(
            "INSERT INTO origin_provenance_keys VALUES(?1,?2,?3,?4)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                key.public_key_spki,
                key.fingerprint_sha256
            ],
        )?;
    }
    for (entry, signature) in page.entries.iter().zip(&proof.entry_signatures) {
        save_position(
            tx,
            id,
            &OriginCursor {
                seq: entry.origin_seq,
                hash: entry.chain_hash.clone(),
            },
            signature,
        )?;
    }
    // Do not advertise a signed future head as an already verified prefix.
    if page.to == page.through {
        save_position(tx, id, &page.through, &proof.through_signature)?;
    }
    if old.is_none() {
        tx.execute(
            "INSERT INTO verified_origin_prefixes VALUES(?1,?2,?3,?4,?5)",
            params![
                id.profile_id.to_string(),
                id.device_id.to_string(),
                id.restoration_epoch.to_string(),
                page.to.seq,
                page.to.hash
            ],
        )?;
    } else if page.to.seq > previous.seq {
        tx.execute("UPDATE verified_origin_prefixes SET verified_seq=?4,verified_hash=?5 WHERE profile_id=?1 AND origin_device=?2 AND restoration_epoch=?3",params![id.profile_id.to_string(),id.device_id.to_string(),id.restoration_epoch.to_string(),page.to.seq,page.to.hash])?;
    }
    Ok(())
}

impl Core {
    /// Profile-wide read projections at the end of a bounded sync session.
    /// Receipt of facts, interpretable timer state and original bytes remain
    /// separate conditions, including a no-op session with no imported pages.
    pub fn replication_health(
        &self,
        context: &WriterContext,
        profile: ProfileId,
    ) -> Result<(bool, bool), CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let complete: bool = connection.query_row(
            "SELECT status='complete' FROM replication_projection_status WHERE profile_id=?1",
            [profile.to_string()],
            |r| r.get(0),
        )?;
        let missing: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM original_manifests m WHERE m.profile_id=?1 AND EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=m.original_id AND e.profile_id=?1) AND NOT EXISTS(SELECT 1 FROM original_stages s WHERE s.original_id=m.original_id AND s.profile_id=?1 AND s.state='verified' AND s.next_offset=s.byte_length))", [profile.to_string()], |r|r.get(0))?;
        Ok((complete, missing))
    }
    /// Data and verified-prefix positions differ while backfilling legacy
    /// history. Neither position is writable authority or a network member.
    pub fn verified_origin_receive_state(
        &self,
        context: &VerifiedOriginContext,
    ) -> Result<OriginReceiveState, CoreError> {
        self.check_replica_context(&context.replica)?;
        let connection = self.connection()?;
        let id = transfer::identity(&context.replica);
        let data = transfer::receiver_cursor(&connection, &id)?;
        let stored_key = load_key(&connection, id.profile_id, id.device_id)?;
        let prefix = load_prefix(&connection, &id)?;
        match (stored_key, prefix) {
            (Some(key), Some(prefix)) if key == context.key => Ok(OriginReceiveState {
                data,
                verified: prefix,
                proofs_present: true,
            }),
            (None, None) => Ok(OriginReceiveState {
                data,
                verified: OriginCursor {
                    seq: 0,
                    hash: super::origin::genesis(&id)?,
                },
                proofs_present: false,
            }),
            (Some(_), Some(_)) => Err(CoreError::InvalidReplication(
                "source provenance key changed",
            )),
            _ => Err(CoreError::RecoveryRequired),
        }
    }

    /// Trusted in-process seam. Host verifies cryptography and current profile
    /// authority, pin/epoch/revocation before issuing this context and keeps its
    /// qualification gate held through import. Core owns no membership truth.
    pub fn trusted_verified_origin_context(
        &self,
        profile: ProfileId,
        carrier: DeviceId,
        origin: &OriginIdentity,
        carrier_generation: u64,
        key: OriginProvenanceKey,
    ) -> Result<VerifiedOriginContext, CoreError> {
        if profile != origin.profile_id {
            return Err(CoreError::ScopeMismatch);
        }
        if carrier == self.device_id() {
            return Err(CoreError::InvalidReplication(
                "local device cannot be a remote carrier",
            ));
        }
        key.validate()?;
        let replica = self.trusted_replica_context(
            profile,
            origin.device_id,
            origin.restoration_epoch,
            carrier_generation,
        )?;
        Ok(VerifiedOriginContext {
            replica,
            key,
            carrier_device: carrier,
        })
    }

    pub fn import_verified_origin_page(
        &self,
        context: &VerifiedOriginContext,
        page: &OriginPage,
        proof: &OriginPageProof,
    ) -> Result<super::ImportAck, CoreError> {
        super::ingest::import_page_with_provenance(
            self,
            &context.replica,
            page,
            Some((&context.key, proof)),
        )
    }

    pub fn origin_provenance_key(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        device: DeviceId,
    ) -> Result<Option<OriginProvenanceKey>, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        load_key(&connection, profile, device)
    }

    /// The verified prefix can lag the fact receive cursor on legacy imports.
    /// None means no retained proofs, never an empty but complete history.
    pub fn verified_origin_state(
        &self,
        context: &WriterContext,
        id: &OriginIdentity,
    ) -> Result<Option<VerifiedOriginState>, CoreError> {
        self.check_scope(context, id.profile_id)?;
        let connection = self.connection()?;
        // Epoch validation remains independent of the proof table.
        transfer::receiver_cursor(&connection, id)?;
        let key = load_key(&connection, id.profile_id, id.device_id)?;
        let prefix = load_prefix(&connection, id)?;
        match (key, prefix) {
            (None, None) => Ok(None),
            (Some(key), Some(cursor)) => Ok(Some(VerifiedOriginState { key, cursor })),
            _ => Err(CoreError::RecoveryRequired),
        }
    }

    /// Retain the original signatures; a relay must never re-sign foreign
    /// history. Core page export still validates all actual canonical bodies.
    pub fn origin_page_proof(
        &self,
        context: &WriterContext,
        page: &OriginPage,
    ) -> Result<(OriginProvenanceKey, OriginPageProof), CoreError> {
        self.check_scope(context, page.origin.profile_id)?;
        if page.entries.len() > 100
            || page.to.seq.checked_sub(page.from.seq) != Some(page.entries.len() as u64)
            || page.to.seq > page.through.seq
        {
            return Err(CoreError::InvalidReplication("invalid proof export range"));
        }
        let connection = self.connection()?;
        let key = load_key(&connection, page.origin.profile_id, page.origin.device_id)?
            .ok_or(CoreError::InvalidReplication("source proofs unavailable"))?;
        let prefix = load_prefix(&connection, &page.origin)?.ok_or(CoreError::RecoveryRequired)?;
        if page.through.seq > prefix.seq {
            return Err(CoreError::InvalidReplication("source proofs incomplete"));
        }
        let mut previous = page.from.clone();
        if transfer::cursor_at(&connection, &page.origin, previous.seq)? != previous {
            return Err(CoreError::InvalidReplication("proof export prefix differs"));
        }
        let mut signatures = Vec::new();
        for entry in &page.entries {
            if previous.seq.checked_add(1) != Some(entry.origin_seq) {
                return Err(CoreError::InvalidReplication("proof export sequence gap"));
            }
            previous = OriginCursor {
                seq: entry.origin_seq,
                hash: entry.chain_hash.clone(),
            };
            signatures.push(proof_signature(&connection, &page.origin, &previous)?);
        }
        if previous != page.to {
            return Err(CoreError::InvalidReplication(
                "proof export endpoint differs",
            ));
        }
        Ok((
            key,
            OriginPageProof {
                entry_signatures: signatures,
                through_signature: proof_signature(&connection, &page.origin, &page.through)?,
            },
        ))
    }
}
