use crate::{AuthorKind, Core, CoreError, OriginalId, ProfileId, StageId, WriterContext};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::PathBuf, time::Duration};
use uuid::Uuid;

pub const MAX_ORIGINAL_CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_CAPTURE_ORIGINALS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BeginStageCommand {
    pub stage_id: StageId,
    pub original_id: OriginalId,
    pub profile_id: ProfileId,
    pub expected_sha256: String,
    pub byte_length: u64,
    pub file_name: String,
    pub media_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalRef {
    pub original_id: OriginalId,
    pub sha256: String,
    pub byte_length: u64,
    pub file_name: String,
    pub media_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageState {
    Uploading,
    Frozen,
    Verified,
    HashMismatch,
}

impl StageState {
    fn label(self) -> &'static str {
        match self {
            Self::Uploading => "uploading",
            Self::Frozen => "frozen",
            Self::Verified => "verified",
            Self::HashMismatch => "hash_mismatch",
        }
    }
    fn parse(value: &str) -> Result<Self, CoreError> {
        match value {
            "uploading" => Ok(Self::Uploading),
            "frozen" => Ok(Self::Frozen),
            "verified" => Ok(Self::Verified),
            "hash_mismatch" => Ok(Self::HashMismatch),
            _ => Err(CoreError::InvalidOriginal("stored stage state")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageStatus {
    pub stage_id: StageId,
    pub profile_id: ProfileId,
    pub original: OriginalRef,
    pub state: StageState,
    pub next_offset: u64,
    pub generation: u64,
}

/// A stage preview carries expected metadata, not a verification claim. The
/// public-original reader additionally requires a committed profile reference.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalChunk {
    pub original: OriginalRef,
    pub offset: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
struct Stage {
    status: StageStatus,
    author: Uuid,
    author_kind: AuthorKind,
}

fn author_label(kind: AuthorKind) -> &'static str {
    match kind {
        AuthorKind::Human => "human",
        AuthorKind::AgentNote => "agent_note",
    }
}

fn load_stage(connection: &Connection, id: StageId) -> Result<Stage, CoreError> {
    let row = connection.query_row("SELECT original_id,profile_id,author_id,author_kind,expected_sha256,byte_length,file_name,media_type,next_offset,generation,state FROM original_stages WHERE stage_id=?1",[id.to_string()],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,u64>(5)?,row.get::<_,String>(6)?,row.get::<_,String>(7)?,row.get::<_,u64>(8)?,row.get::<_,u64>(9)?,row.get::<_,String>(10)?))).optional()?.ok_or(CoreError::UnknownStage)?;
    let author_kind = match row.3.as_str() {
        "human" => AuthorKind::Human,
        "agent_note" => AuthorKind::AgentNote,
        _ => return Err(CoreError::InvalidOriginal("stored author kind")),
    };
    Ok(Stage {
        status: StageStatus {
            stage_id: id,
            profile_id: row.1.parse()?,
            original: OriginalRef {
                original_id: row.0.parse()?,
                sha256: row.4,
                byte_length: row.5,
                file_name: row.6,
                media_type: row.7,
            },
            next_offset: row.8,
            generation: row.9,
            state: StageState::parse(&row.10)?,
        },
        author: Uuid::parse_str(&row.2)?,
        author_kind,
    })
}

fn stage_for_original(connection: &Connection, id: OriginalId) -> Result<Stage, CoreError> {
    let stage: Option<String> = connection
        .query_row(
            "SELECT stage_id FROM original_stages WHERE original_id=?1",
            [id.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    load_stage(
        connection,
        stage.ok_or(CoreError::UnknownOriginal)?.parse()?,
    )
}

pub(crate) fn validate_original(original: &OriginalRef) -> Result<(), CoreError> {
    if original.sha256.len() != 64
        || !original
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CoreError::InvalidOriginal("expected lowercase SHA-256"));
    }
    if original.byte_length > i64::MAX as u64
        || original.file_name.is_empty()
        || original.file_name.len() > 1024
        || original
            .file_name
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
        || original.media_type.len() > 256
        || original.media_type.chars().any(char::is_control)
    {
        return Err(CoreError::InvalidOriginal(
            "size, name or media type outside supported bounds",
        ));
    }
    Ok(())
}

fn creator(stage: &Stage, context: &WriterContext) -> Result<(), CoreError> {
    if stage.status.profile_id != context.profile_id {
        return Err(CoreError::ScopeMismatch);
    }
    if stage.author != context.author_id || stage.author_kind != context.author_kind {
        return Err(CoreError::OriginalAccessDenied);
    }
    Ok(())
}

fn referenced(
    connection: &Connection,
    original: OriginalId,
    profile: ProfileId,
) -> Result<bool, CoreError> {
    Ok(connection.query_row("SELECT EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=?1 AND e.profile_id=?2)",params![original.to_string(),profile.to_string()],|row|row.get(0))?)
}

pub(crate) fn validate_references(
    transaction: &Transaction<'_>,
    context: &WriterContext,
    originals: &[OriginalRef],
) -> Result<(), CoreError> {
    let mut seen = HashSet::new();
    for original in originals {
        validate_original(original)?;
        if !seen.insert(original.original_id) {
            return Err(CoreError::InvalidOriginal(
                "duplicate original ID in capture",
            ));
        }
        let stage = stage_for_original(transaction, original.original_id)?;
        if stage.status.profile_id != context.profile_id {
            return Err(CoreError::ScopeMismatch);
        }
        if stage.status.original != *original {
            return Err(CoreError::OriginalConflict);
        }
        if stage.status.state != StageState::Verified {
            return Err(CoreError::OriginalNotReady);
        }
        if !referenced(transaction, original.original_id, context.profile_id)? {
            creator(&stage, context)?;
        }
    }
    Ok(())
}

/// Private capability for one immutable generation. It owns no main Core lock
/// or connection, and is Send; adapters must run verify outside their gate.
#[derive(Debug)]
pub struct VerificationTicket {
    database_path: PathBuf,
    lifecycle: Uuid,
    stage: Stage,
}

/// Only verify can construct this proof. Never deserialize proofs from a client.
#[derive(Debug)]
pub struct VerificationProof {
    lifecycle: Uuid,
    stage: Stage,
    actual_sha256: String,
    actual_length: u64,
}

impl VerificationProof {
    pub fn stage_id(&self) -> StageId {
        self.stage.status.stage_id
    }
}

impl VerificationTicket {
    pub fn verify(&self, cancelled: impl Fn() -> bool) -> Result<VerificationProof, CoreError> {
        if cancelled() {
            return Err(CoreError::VerificationCancelled);
        }
        let mut connection =
            Connection::open_with_flags(&self.database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.busy_timeout(Duration::from_millis(250))?;
        let application: i64 =
            connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if application != crate::migrations::APPLICATION_ID
            || version != crate::migrations::SCHEMA_VERSION
        {
            return Err(CoreError::StaleVerification);
        }
        let mut offset = 0u64;
        let mut hasher = Sha256::new();
        loop {
            if cancelled() {
                return Err(CoreError::VerificationCancelled);
            }
            // Frozen bytes cannot be changed through the API or schema triggers.
            // Each batch releases its read transaction so a long hash does not
            // retain a multi-GB WAL snapshot or the main connection mutex.
            let transaction = connection.transaction()?;
            let current = load_stage(&transaction, self.stage.status.stage_id)?;
            if current.status.generation != self.stage.status.generation
                || current.status.original != self.stage.status.original
                || current.status.profile_id != self.stage.status.profile_id
                || current.author != self.stage.author
                || current.author_kind != self.stage.author_kind
                || !matches!(
                    current.status.state,
                    StageState::Frozen | StageState::Verified
                )
            {
                return Err(CoreError::StaleVerification);
            }
            let chunk:Option<(u64,Vec<u8>,String)>=transaction.query_row("SELECT offset,bytes,chunk_sha256 FROM original_chunks WHERE stage_id=?1 AND offset>=?2 ORDER BY offset LIMIT 1",params![self.stage.status.stage_id.to_string(),offset],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
            transaction.commit()?;
            let Some((position, bytes, chunk_sha256)) = chunk else {
                break;
            };
            if position != offset || bytes.is_empty() || bytes.len() > MAX_ORIGINAL_CHUNK_BYTES {
                return Err(CoreError::StageIncomplete);
            }
            check_chunk_integrity(&bytes, &chunk_sha256)?;
            offset = offset
                .checked_add(bytes.len() as u64)
                .ok_or(CoreError::InvalidOriginalOffset)?;
            if offset > self.stage.status.original.byte_length {
                return Err(CoreError::StageIncomplete);
            }
            hasher.update(&bytes);
        }
        if cancelled() {
            return Err(CoreError::VerificationCancelled);
        }
        if offset != self.stage.status.original.byte_length {
            return Err(CoreError::StageIncomplete);
        }
        Ok(VerificationProof {
            lifecycle: self.lifecycle,
            stage: self.stage.clone(),
            actual_sha256: format!("{:x}", hasher.finalize()),
            actual_length: offset,
        })
    }
}

impl Core {
    pub fn begin_stage(
        &self,
        context: &WriterContext,
        input: &BeginStageCommand,
    ) -> Result<StageStatus, CoreError> {
        self.check_scope(context, input.profile_id)?;
        let original = OriginalRef {
            original_id: input.original_id,
            sha256: input.expected_sha256.clone(),
            byte_length: input.byte_length,
            file_name: input.file_name.clone(),
            media_type: input.media_type.clone(),
        };
        validate_original(&original)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        match load_stage(&transaction, input.stage_id) {
            Ok(stage) => {
                creator(&stage, context)?;
                if stage.status.original != original {
                    return Err(CoreError::StageConflict);
                }
                return Ok(stage.status);
            }
            Err(CoreError::UnknownStage) => {}
            Err(error) => return Err(error),
        }
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM original_stages WHERE original_id=?1)",
            [input.original_id.to_string()],
            |row| row.get(0),
        )?;
        if exists {
            return Err(CoreError::OriginalConflict);
        }
        transaction.execute(
            "INSERT INTO original_stages VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,0,1,'uploading')",
            params![
                input.stage_id.to_string(),
                input.original_id.to_string(),
                input.profile_id.to_string(),
                context.author_id.to_string(),
                author_label(context.author_kind),
                input.expected_sha256,
                input.byte_length,
                input.file_name,
                input.media_type
            ],
        )?;
        let status = load_stage(&transaction, input.stage_id)?.status;
        transaction.commit()?;
        Ok(status)
    }

    pub fn stage_status(
        &self,
        context: &WriterContext,
        id: StageId,
    ) -> Result<StageStatus, CoreError> {
        self.check_scope(context, context.profile_id)?;
        let connection = self.connection()?;
        let stage = load_stage(&connection, id)?;
        creator(&stage, context)?;
        Ok(stage.status)
    }

    pub fn write_stage_chunk(
        &self,
        context: &WriterContext,
        id: StageId,
        offset: u64,
        bytes: &[u8],
    ) -> Result<StageStatus, CoreError> {
        self.check_scope(context, context.profile_id)?;
        if bytes.is_empty() || bytes.len() > MAX_ORIGINAL_CHUNK_BYTES {
            return Err(CoreError::InvalidOriginal("chunk length"));
        }
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or(CoreError::InvalidOriginalOffset)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stage = load_stage(&transaction, id)?;
        creator(&stage, context)?;
        if stage.status.state != StageState::Uploading {
            return Err(CoreError::StageNotUploading);
        }
        if end > stage.status.original.byte_length || offset > stage.status.next_offset {
            return Err(CoreError::InvalidOriginalOffset);
        }
        if offset < stage.status.next_offset {
            if end > stage.status.next_offset {
                return Err(CoreError::InvalidOriginalOffset);
            }
            let existing = read_bytes(&transaction, &stage, offset, bytes.len())?;
            if existing != bytes {
                return Err(CoreError::ChunkConflict);
            }
            return Ok(stage.status);
        }
        let block_size = MAX_ORIGINAL_CHUNK_BYTES as u64;
        let tail_length = (offset % block_size) as usize;
        let mut consumed = 0usize;
        if tail_length != 0 {
            let block_offset = offset - tail_length as u64;
            let (mut tail, digest): (Vec<u8>, String) = transaction.query_row(
                "SELECT bytes,chunk_sha256 FROM original_chunks WHERE stage_id=?1 AND offset=?2",
                params![id.to_string(), block_offset],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if tail.len() != tail_length {
                return Err(CoreError::StageIncomplete);
            }
            check_chunk_integrity(&tail, &digest)?;
            consumed = bytes.len().min(MAX_ORIGINAL_CHUNK_BYTES - tail_length);
            tail.extend_from_slice(&bytes[..consumed]);
            transaction.execute("UPDATE original_chunks SET bytes=?3,chunk_sha256=?4 WHERE stage_id=?1 AND offset=?2",
                params![id.to_string(),block_offset,tail,format!("{:x}",Sha256::digest(&tail))])?;
            if consumed < bytes.len() {
                // Only this transaction observes the intermediate boundary;
                // a failed following insert rolls back bytes and offset alike.
                transaction.execute(
                    "UPDATE original_stages SET next_offset=?2 WHERE stage_id=?1",
                    params![id.to_string(), offset + consumed as u64],
                )?;
            }
        }
        if consumed < bytes.len() {
            let remainder = &bytes[consumed..];
            transaction.execute(
                "INSERT INTO original_chunks VALUES(?1,?2,?3,?4)",
                params![
                    id.to_string(),
                    offset + consumed as u64,
                    remainder,
                    format!("{:x}", Sha256::digest(remainder))
                ],
            )?;
        }
        transaction.execute(
            "UPDATE original_stages SET next_offset=?2,generation=generation+1 WHERE stage_id=?1",
            params![id.to_string(), end],
        )?;
        let status = load_stage(&transaction, id)?.status;
        transaction.commit()?;
        Ok(status)
    }

    pub fn freeze_stage(
        &self,
        context: &WriterContext,
        id: StageId,
    ) -> Result<VerificationTicket, CoreError> {
        self.check_scope(context, context.profile_id)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut stage = load_stage(&transaction, id)?;
        creator(&stage, context)?;
        if stage.status.next_offset != stage.status.original.byte_length {
            return Err(CoreError::StageIncomplete);
        }
        if stage.status.state == StageState::HashMismatch {
            return Err(CoreError::OriginalHashMismatch);
        }
        if stage.status.state == StageState::Uploading {
            transaction.execute("UPDATE original_stages SET state='frozen',generation=generation+1 WHERE stage_id=?1",[id.to_string()])?;
            stage = load_stage(&transaction, id)?;
        }
        transaction.commit()?;
        Ok(VerificationTicket {
            database_path: self.database_path().to_owned(),
            lifecycle: self.lifecycle(),
            stage,
        })
    }

    pub fn finish_stage(
        &self,
        context: &WriterContext,
        proof: &VerificationProof,
    ) -> Result<StageStatus, CoreError> {
        self.check_scope(context, proof.stage.status.profile_id)?;
        if proof.lifecycle != self.lifecycle() {
            return Err(CoreError::StaleVerification);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stage = load_stage(&transaction, proof.stage.status.stage_id)?;
        creator(&stage, context)?;
        if stage.status.generation != proof.stage.status.generation
            || stage.status.original != proof.stage.status.original
        {
            return Err(CoreError::StaleVerification);
        }
        if stage.status.state == StageState::HashMismatch {
            return Err(CoreError::OriginalHashMismatch);
        }
        if !matches!(
            stage.status.state,
            StageState::Frozen | StageState::Verified
        ) {
            return Err(CoreError::StaleVerification);
        }
        let valid = proof.actual_length == stage.status.original.byte_length
            && proof.actual_sha256 == stage.status.original.sha256;
        let state = if valid {
            StageState::Verified
        } else {
            StageState::HashMismatch
        };
        transaction.execute(
            "UPDATE original_stages SET state=?2 WHERE stage_id=?1",
            params![stage.status.stage_id.to_string(), state.label()],
        )?;
        let status = load_stage(&transaction, stage.status.stage_id)?.status;
        transaction.commit()?;
        if valid {
            Ok(status)
        } else {
            Err(CoreError::OriginalHashMismatch)
        }
    }

    pub fn read_stage_range(
        &self,
        context: &WriterContext,
        id: StageId,
        offset: u64,
        length: usize,
    ) -> Result<OriginalChunk, CoreError> {
        self.check_scope(context, context.profile_id)?;
        let connection = self.connection()?;
        let stage = load_stage(&connection, id)?;
        creator(&stage, context)?;
        let bytes = read_bytes(&connection, &stage, offset, length)?;
        Ok(OriginalChunk {
            original: stage.status.original,
            offset,
            bytes,
        })
    }

    pub fn read_original_range(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        id: OriginalId,
        offset: u64,
        length: usize,
    ) -> Result<OriginalChunk, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let stage = stage_for_original(&connection, id)?;
        if stage.status.profile_id != profile {
            return Err(CoreError::ScopeMismatch);
        }
        if !referenced(&connection, id, profile)? {
            return Err(CoreError::OriginalAccessDenied);
        }
        if stage.status.state != StageState::Verified {
            return Err(CoreError::OriginalNotReady);
        }
        let bytes = read_bytes(&connection, &stage, offset, length)?;
        Ok(OriginalChunk {
            original: stage.status.original,
            offset,
            bytes,
        })
    }
}

fn read_bytes(
    connection: &Connection,
    stage: &Stage,
    offset: u64,
    length: usize,
) -> Result<Vec<u8>, CoreError> {
    if length == 0 || length > MAX_ORIGINAL_CHUNK_BYTES || offset > stage.status.next_offset {
        return Err(CoreError::InvalidOriginalOffset);
    }
    let end = offset
        .saturating_add(length as u64)
        .min(stage.status.next_offset);
    let mut position = offset;
    let mut output = Vec::with_capacity((end - offset) as usize);
    while position < end {
        let block_offset =
            position / MAX_ORIGINAL_CHUNK_BYTES as u64 * MAX_ORIGINAL_CHUNK_BYTES as u64;
        let row:Option<(u64,Vec<u8>,String)>=connection.query_row("SELECT offset,bytes,chunk_sha256 FROM original_chunks WHERE stage_id=?1 AND offset=?2",params![stage.status.stage_id.to_string(),block_offset],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
        let (start, bytes, chunk_sha256) = row.ok_or(CoreError::StageIncomplete)?;
        let index =
            usize::try_from(position - start).map_err(|_| CoreError::InvalidOriginalOffset)?;
        let expected_length =
            (stage.status.next_offset - block_offset).min(MAX_ORIGINAL_CHUNK_BYTES as u64) as usize;
        if start != block_offset || bytes.len() != expected_length || index >= bytes.len() {
            return Err(CoreError::StageIncomplete);
        }
        check_chunk_integrity(&bytes, &chunk_sha256)?;
        let amount = (bytes.len() - index).min((end - position) as usize);
        output.extend_from_slice(&bytes[index..index + amount]);
        position += amount as u64;
    }
    Ok(output)
}

fn check_chunk_integrity(bytes: &[u8], expected: &str) -> Result<(), CoreError> {
    if format!("{:x}", Sha256::digest(bytes)) != expected {
        return Err(CoreError::OriginalIntegrityMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
