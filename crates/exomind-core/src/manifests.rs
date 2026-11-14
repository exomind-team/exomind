//! Immutable original identity is independent of this replica's byte stage.
use crate::{Core, CoreError, OriginalId, OriginalRef, ProfileId, ReplicaContext, StageStatus};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum OriginalAvailability {
    Missing { original: OriginalRef },
    Local { stage: StageStatus },
}

pub(crate) fn manifest(
    connection: &Connection,
    id: OriginalId,
) -> Result<(ProfileId, OriginalRef), CoreError> {
    type Row = (
        Option<String>,
        Option<String>,
        u64,
        Option<String>,
        Option<String>,
    );
    let row: Option<Row> = connection.query_row(
        "SELECT CASE WHEN typeof(profile_id)='text' AND length(profile_id)=36 THEN profile_id END,CASE WHEN typeof(sha256)='text' AND length(sha256)=64 THEN sha256 END,byte_length,CASE WHEN typeof(file_name)='text' AND length(file_name)<=1024 THEN file_name END,CASE WHEN typeof(media_type)='text' AND length(media_type)<=256 THEN media_type END FROM original_manifests WHERE original_id=?1",
        [id.to_string()], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
    ).optional()?;
    let (profile, sha256, byte_length, file_name, media_type) =
        row.ok_or(CoreError::UnknownOriginal)?;
    let original = OriginalRef {
        original_id: id,
        sha256: sha256.ok_or(CoreError::RecoveryRequired)?,
        byte_length,
        file_name: file_name.ok_or(CoreError::RecoveryRequired)?,
        media_type: media_type.ok_or(CoreError::RecoveryRequired)?,
    };
    crate::originals::validate_original(&original)?;
    Ok((
        profile.ok_or(CoreError::RecoveryRequired)?.parse()?,
        original,
    ))
}

pub(crate) fn ensure_manifest(
    transaction: &Transaction<'_>,
    profile: ProfileId,
    original: &OriginalRef,
) -> Result<(), CoreError> {
    crate::originals::validate_original(original)?;
    match manifest(transaction, original.original_id) {
        Ok((stored_profile, stored)) => {
            if stored_profile != profile || stored != *original {
                return Err(CoreError::OriginalConflict);
            }
            return Ok(());
        }
        Err(CoreError::UnknownOriginal) => {}
        Err(error) => return Err(error),
    }
    transaction.execute(
        "INSERT INTO original_manifests VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            original.original_id.to_string(),
            profile.to_string(),
            original.sha256,
            original.byte_length,
            original.file_name,
            original.media_type
        ],
    )?;
    Ok(())
}

impl Core {
    /// Trusted embedding only. This is metadata admission, not a byte receipt,
    /// public read credential, stage creation or a business event. Host must
    /// validate its authoritative member ledger under its final admission gate.
    pub fn declare_original_manifest(
        &self,
        context: &ReplicaContext,
        original: &OriginalRef,
    ) -> Result<OriginalRef, CoreError> {
        self.check_replica_context(context)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_manifest(&transaction, context.profile_id, original)?;
        transaction.commit()?;
        Ok(original.clone())
    }
}
