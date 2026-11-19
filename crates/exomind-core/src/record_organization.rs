use crate::{
    AuthorKind, Core, CoreError, DeviceId, Durability, EventId, EventPage, EventQuery, EventRecord,
    MAX_EVENT_PAGE_SIZE, ProfileId, Receipt, WriterContext,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Maximum UTF-8 byte length of a stored or queried capture tag.
pub const MAX_EVENT_TAG_BYTES: usize = 128;
const MAX_CORRECTION_TEXT_BYTES: usize = 128 * 1024;
const CORRECTION_FACT_TYPE: &str = "correction/1";

const EVENTS8: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1','agent_summary/1')))";
const EVENTS9: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1','agent_summary/1','correction/1')))";
const EVENTS10: &str = "CREATE TABLE events(local_seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),digest TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'capture' CHECK(kind IN ('capture','timeblock/1','summary_job/1','summary/1','agent_summary/1','correction/1','orig_lifecycle/1')))";
const EVENTS_PROFILE_SEQUENCE: &str =
    "CREATE INDEX events_profile_sequence ON events(profile_id,local_seq)";
const EVENTS_PROFILE_KIND_SEQUENCE: &str =
    "CREATE INDEX events_profile_kind_sequence ON events(profile_id,kind,local_seq DESC)";
const EVENT_TAGS: &str = "CREATE TABLE event_tags(profile_id TEXT NOT NULL REFERENCES profiles(id),event_id TEXT NOT NULL REFERENCES events(event_id),local_seq INTEGER NOT NULL CHECK(local_seq>0),tag TEXT NOT NULL CHECK(length(CAST(tag AS BLOB)) BETWEEN 1 AND 128),PRIMARY KEY(event_id,tag))";
const EVENT_TAGS_PROFILE_TAG_SEQUENCE: &str =
    "CREATE INDEX event_tags_profile_tag_sequence ON event_tags(profile_id,tag,local_seq DESC)";
const EVENT_TAG_INSERT_GUARD: &str = "CREATE TRIGGER event_tag_insert_guard BEFORE INSERT ON event_tags WHEN NOT EXISTS(SELECT 1 FROM events e WHERE e.event_id=NEW.event_id AND e.profile_id=NEW.profile_id AND e.local_seq=NEW.local_seq AND e.kind='capture') BEGIN SELECT RAISE(ABORT,'capture tag index must match its fact'); END";

/// A new immutable fact that records a human correction to an existing capture.
/// The target digest is the identity of the wording being corrected; it remains
/// fixed even if the target arrives later or proves to have different content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordCorrectionCommand {
    pub command_id: crate::CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub occurred_at_ms: i64,
    pub target_event_id: EventId,
    pub target_digest: String,
    pub corrected_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub author_id: Uuid,
    pub author_kind: AuthorKind,
    pub occurred_at_ms: i64,
    pub target_event_id: EventId,
    pub target_digest: String,
    pub corrected_text: String,
    pub digest: String,
    pub local_seq: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CorrectionTargetState {
    /// The referenced capture is not present in this profile on this device.
    Unresolved,
    /// The local capture's canonical digest matches the correction target.
    DigestMatches,
    /// The capture is present but its kind or digest does not match.
    DigestConflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionEntry {
    pub record: CorrectionRecord,
    pub target_state: CorrectionTargetState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionPage {
    pub items: Vec<CorrectionEntry>,
    pub next_before: Option<u64>,
    pub highwater: u64,
}

#[derive(Serialize)]
struct CorrectionFact<'a> {
    kind: &'static str,
    profile: ProfileId,
    event: EventId,
    device: DeviceId,
    author: Uuid,
    author_kind: AuthorKind,
    occurred_at_ms: i64,
    target_event: EventId,
    target_digest: &'a str,
    corrected_text: &'a str,
}

impl<'a> CorrectionFact<'a> {
    fn local(context: &WriterContext, command: &'a RecordCorrectionCommand) -> Self {
        Self {
            kind: CORRECTION_FACT_TYPE,
            profile: command.profile_id,
            event: command.event_id,
            device: context.device_id,
            author: context.author_id,
            author_kind: context.author_kind,
            occurred_at_ms: command.occurred_at_ms,
            target_event: command.target_event_id,
            target_digest: &command.target_digest,
            corrected_text: &command.corrected_text,
        }
    }

    fn bytes(&self) -> Result<Vec<u8>, CoreError> {
        Ok(serde_json::to_vec(self)?)
    }

    fn digest(&self) -> Result<String, CoreError> {
        Ok(format!("{:x}", Sha256::digest(self.bytes()?)))
    }
}

impl CorrectionRecord {
    fn fact(&self) -> CorrectionFact<'_> {
        CorrectionFact {
            kind: CORRECTION_FACT_TYPE,
            profile: self.profile_id,
            event: self.event_id,
            device: self.device_id,
            author: self.author_id,
            author_kind: self.author_kind,
            occurred_at_ms: self.occurred_at_ms,
            target_event: self.target_event_id,
            target_digest: &self.target_digest,
            corrected_text: &self.corrected_text,
        }
    }

    pub fn canonical_fact_bytes(&self) -> Result<Vec<u8>, CoreError> {
        self.fact().bytes()
    }

    pub fn computed_digest(&self) -> Result<String, CoreError> {
        self.fact().digest()
    }

    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        if self.author_id.is_nil()
            || self.author_kind != AuthorKind::Human
            || self.occurred_at_ms < 0
            || self.event_id == self.target_event_id
            || self.corrected_text.trim().is_empty()
            || self.corrected_text.len() > MAX_CORRECTION_TEXT_BYTES
            || !valid_sha256(&self.target_digest)
            || self.computed_digest()? != self.digest
        {
            return Err(CoreError::InvalidCorrection(
                "identity, author, target, text or digest is invalid",
            ));
        }
        Ok(())
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_tag(tag: &str) -> Result<(), CoreError> {
    if tag.trim().is_empty() || tag.len() > MAX_EVENT_TAG_BYTES {
        return Err(CoreError::InvalidQuery(
            "tag must contain non-whitespace text within the supported byte limit",
        ));
    }
    Ok(())
}

fn page_bounds(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    query: &EventQuery,
) -> Result<(u64, i64, Option<i64>), CoreError> {
    if !(1..=MAX_EVENT_PAGE_SIZE).contains(&query.limit) {
        return Err(CoreError::InvalidQuery("limit must be between 1 and 100"));
    }
    let current: i64 = connection.query_row(
        "SELECT coalesce(max(local_seq),0) FROM events WHERE profile_id=?1",
        [profile.to_string()],
        |row| row.get(0),
    )?;
    let current =
        u64::try_from(current).map_err(|_| CoreError::InvalidQuery("invalid stored sequence"))?;
    let highwater = query.through.unwrap_or(current);
    if highwater > current {
        return Err(CoreError::InvalidQuery(
            "snapshot is ahead of available history",
        ));
    }
    if let Some(before) = query.before {
        if before == 0 || before > highwater.saturating_add(1) {
            return Err(CoreError::InvalidQuery(
                "before must be positive and within the snapshot",
            ));
        }
    }
    let before = query.before.and_then(|value| i64::try_from(value).ok());
    let through = i64::try_from(highwater)
        .map_err(|_| CoreError::InvalidQuery("snapshot exceeds the SQLite sequence range"))?;
    Ok((highwater, through, before))
}

pub(crate) fn index_capture_tags(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    event: EventId,
    local_seq: u64,
    tags: &[String],
) -> Result<(), CoreError> {
    let sequence = i64::try_from(local_seq)
        .map_err(|_| CoreError::InvalidQuery("capture sequence exceeds the SQLite range"))?;
    for tag in tags {
        validate_tag(tag)?;
        connection.execute(
            "INSERT OR IGNORE INTO event_tags(profile_id,event_id,local_seq,tag) VALUES(?1,?2,?3,?4)",
            params![profile.to_string(), event.to_string(), sequence, tag],
        )?;
    }
    Ok(())
}

fn backfill_capture_tags(tx: &rusqlite::Transaction<'_>) -> Result<(), CoreError> {
    let mut after = 0_i64;
    loop {
        let rows = {
            let mut statement = tx.prepare(
                "SELECT local_seq,event_id,profile_id,digest,body FROM events WHERE kind='capture' AND local_seq>?1 ORDER BY local_seq LIMIT ?2",
            )?;
            statement
                .query_map(params![after, MAX_EVENT_PAGE_SIZE as i64], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if rows.is_empty() {
            break;
        }
        for (sequence, event_id, profile_id, digest, body) in rows {
            if sequence <= after || sequence <= 0 {
                return Err(CoreError::RecoveryRequired);
            }
            let event_id = event_id
                .parse::<EventId>()
                .map_err(|_| CoreError::RecoveryRequired)?;
            let profile_id = profile_id
                .parse::<ProfileId>()
                .map_err(|_| CoreError::RecoveryRequired)?;
            let record: EventRecord =
                serde_json::from_str(&body).map_err(|_| CoreError::RecoveryRequired)?;
            if record.profile_id != profile_id
                || record.event_id != event_id
                || record.digest != digest
                || record.computed_digest()? != digest
            {
                return Err(CoreError::RecoveryRequired);
            }
            crate::replication::ReplicatedFact::Capture(record.clone()).validate()?;
            index_capture_tags(tx, profile_id, event_id, sequence as u64, &record.tags)?;
            after = sequence;
        }
    }
    Ok(())
}

impl Core {
    /// Read captures by their exact stored tag. Tag matching is a profile
    /// browsing filter and has no effect on the writer or reader capability.
    /// Search, tag, sequence cursor and highwater are applied in SQLite.
    pub fn events_page_with_tag(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &EventQuery,
        tag: Option<&str>,
    ) -> Result<EventPage, CoreError> {
        self.check_scope(context, profile)?;
        if let Some(tag) = tag {
            validate_tag(tag)?;
        }
        let connection = self.connection()?;
        let (highwater, through, before) = page_bounds(&connection, profile, query)?;
        let rows = if let Some(tag) = tag {
            let mut statement = connection.prepare(
                "SELECT e.local_seq,e.body FROM event_tags t JOIN events e ON e.event_id=t.event_id AND e.profile_id=t.profile_id AND e.local_seq=t.local_seq AND e.kind='capture' WHERE t.profile_id=?1 AND t.tag=?2 AND t.local_seq<=?3 AND (?4 IS NULL OR t.local_seq<?4) AND (?5 IS NULL OR instr(json_extract(e.body,'$.text'),?5)>0) ORDER BY t.local_seq DESC LIMIT ?6",
            )?;
            statement
                .query_map(
                    params![
                        profile.to_string(),
                        tag,
                        through,
                        before,
                        query.search.as_deref(),
                        (query.limit + 1) as i64,
                    ],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            let mut statement = connection.prepare(
                "SELECT local_seq,body FROM events WHERE profile_id=?1 AND kind='capture' AND local_seq<=?2 AND (?3 IS NULL OR local_seq<?3) AND (?4 IS NULL OR instr(json_extract(body,'$.text'),?4)>0) ORDER BY local_seq DESC LIMIT ?5",
            )?;
            statement
                .query_map(
                    params![
                        profile.to_string(),
                        through,
                        before,
                        query.search.as_deref(),
                        (query.limit + 1) as i64,
                    ],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )?
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut records = rows
            .into_iter()
            .map(|(sequence, body)| {
                let mut event: EventRecord = serde_json::from_str(&body)?;
                event.local_seq =
                    u64::try_from(sequence).map_err(|_| CoreError::RecoveryRequired)?;
                Ok(event)
            })
            .collect::<Result<Vec<_>, CoreError>>()?;
        let has_more = records.len() > query.limit;
        records.truncate(query.limit);
        let next_before = if has_more {
            records.last().map(|event| event.local_seq)
        } else {
            None
        };
        Ok(EventPage {
            items: records,
            next_before,
            highwater,
        })
    }

    /// Append a separately identified human correction without changing its target.
    pub fn record_correction(
        &self,
        context: &WriterContext,
        command: &RecordCorrectionCommand,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(context, command.profile_id)?;
        if context.author_kind != AuthorKind::Human {
            return Err(CoreError::CorrectionRequiresHuman);
        }
        validate_correction_command(command)?;
        let fact = CorrectionFact::local(context, command);
        let digest = fact.digest()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous: Option<(String, String)> = transaction
            .query_row(
                "SELECT input_digest,receipt FROM command_receipts WHERE command_id=?1",
                [command.command_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((previous, receipt)) = previous {
            if previous != digest {
                return Err(CoreError::CommandConflict);
            }
            let mut receipt: Receipt = serde_json::from_str(&receipt)?;
            receipt.replayed = true;
            return Ok(receipt);
        }

        let existing: Option<(i64, String, String)> = transaction
            .query_row(
                "SELECT local_seq,digest,kind FROM events WHERE event_id=?1",
                [command.event_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let local_seq = if let Some((sequence, existing_digest, kind)) = existing {
            if existing_digest != digest || kind != CORRECTION_FACT_TYPE {
                return Err(CoreError::EventConflict);
            }
            sequence
        } else {
            validate_local_target(&transaction, command)?;
            let record = CorrectionRecord {
                event_id: command.event_id,
                profile_id: command.profile_id,
                device_id: context.device_id,
                author_id: context.author_id,
                author_kind: context.author_kind,
                occurred_at_ms: command.occurred_at_ms,
                target_event_id: command.target_event_id,
                target_digest: command.target_digest.clone(),
                corrected_text: command.corrected_text.clone(),
                digest: digest.clone(),
                local_seq: 0,
            };
            record.validate()?;
            transaction.execute(
                "INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,?5)",
                params![
                    command.event_id.to_string(),
                    command.profile_id.to_string(),
                    digest,
                    crate::fact_encoding::encode_fact(&record)?,
                    CORRECTION_FACT_TYPE,
                ],
            )?;
            let sequence = transaction.last_insert_rowid();
            crate::replication::record_local_fact(
                &transaction,
                command.profile_id,
                context.device_id,
                command.event_id,
                CORRECTION_FACT_TYPE,
                &digest,
            )?;
            sequence
        };
        let receipt = Receipt {
            command_id: command.command_id,
            event_id: command.event_id,
            profile_id: command.profile_id,
            local_seq: u64::try_from(local_seq).map_err(|_| CoreError::RecoveryRequired)?,
            event_digest: digest.clone(),
            durability: Durability::LocalCommitted,
            replayed: false,
        };
        transaction.execute(
            "INSERT INTO command_receipts(command_id,profile_id,input_digest,receipt) VALUES(?1,?2,?3,?4)",
            params![
                command.command_id.to_string(),
                command.profile_id.to_string(),
                digest,
                serde_json::to_string(&receipt)?,
            ],
        )?;
        transaction.commit()?;
        Ok(receipt)
    }

    /// Read correction facts with target resolution derived from this profile's
    /// current local event set. Resolution never rewrites the correction fact.
    pub fn corrections_page(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<CorrectionPage, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let (highwater, through, before) = page_bounds(&connection, profile, query)?;
        let mut statement = connection.prepare(
            "SELECT local_seq,event_id,digest,body FROM events WHERE profile_id=?1 AND kind='correction/1' AND local_seq<=?2 AND (?3 IS NULL OR local_seq<?3) AND (?4 IS NULL OR instr(json_extract(body,'$.corrected_text'),?4)>0) ORDER BY local_seq DESC LIMIT ?5",
        )?;
        let rows = statement
            .query_map(
                params![
                    profile.to_string(),
                    through,
                    before,
                    query.search.as_deref(),
                    (query.limit + 1) as i64,
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let mut records = rows
            .into_iter()
            .map(|(sequence, stored_event, stored_digest, body)| {
                let mut record: CorrectionRecord = serde_json::from_str(&body)?;
                if record.profile_id != profile
                    || record.event_id.to_string() != stored_event
                    || record.digest != stored_digest
                    || record.validate().is_err()
                {
                    return Err(CoreError::RecoveryRequired);
                }
                record.local_seq =
                    u64::try_from(sequence).map_err(|_| CoreError::RecoveryRequired)?;
                Ok(record)
            })
            .collect::<Result<Vec<_>, CoreError>>()?;
        let has_more = records.len() > query.limit;
        records.truncate(query.limit);
        let next_before = if has_more {
            records.last().map(|record| record.local_seq)
        } else {
            None
        };
        let items = records
            .into_iter()
            .map(|record| {
                let target_state = correction_target_state(
                    &connection,
                    profile,
                    record.target_event_id,
                    &record.target_digest,
                )?;
                Ok(CorrectionEntry {
                    record,
                    target_state,
                })
            })
            .collect::<Result<Vec<_>, CoreError>>()?;
        Ok(CorrectionPage {
            items,
            next_before,
            highwater,
        })
    }
}

fn validate_correction_command(command: &RecordCorrectionCommand) -> Result<(), CoreError> {
    if command.occurred_at_ms < 0
        || command.event_id == command.target_event_id
        || command.corrected_text.trim().is_empty()
        || command.corrected_text.len() > MAX_CORRECTION_TEXT_BYTES
        || !valid_sha256(&command.target_digest)
    {
        return Err(CoreError::InvalidCorrection(
            "identity, target, text or digest is outside supported bounds",
        ));
    }
    Ok(())
}

fn validate_local_target(
    transaction: &rusqlite::Transaction<'_>,
    command: &RecordCorrectionCommand,
) -> Result<(), CoreError> {
    let existing: Option<(String, String, String, String)> = transaction
        .query_row(
            "SELECT profile_id,kind,digest,body FROM events WHERE event_id=?1",
            [command.target_event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((profile, kind, digest, body)) = existing else {
        return Ok(());
    };
    if profile != command.profile_id.to_string() || kind != "capture" {
        return Err(CoreError::CorrectionTargetConflict);
    }
    let record: EventRecord = serde_json::from_str(&body)?;
    if record.profile_id != command.profile_id
        || record.event_id != command.target_event_id
        || record.digest != digest
        || record.computed_digest()? != digest
    {
        return Err(CoreError::RecoveryRequired);
    }
    if digest != command.target_digest {
        return Err(CoreError::CorrectionTargetConflict);
    }
    Ok(())
}

fn correction_target_state(
    connection: &rusqlite::Connection,
    profile: ProfileId,
    target_event: EventId,
    target_digest: &str,
) -> Result<CorrectionTargetState, CoreError> {
    let existing: Option<(String, String, String)> = connection
        .query_row(
            "SELECT kind,digest,body FROM events WHERE profile_id=?1 AND event_id=?2",
            params![profile.to_string(), target_event.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((kind, digest, body)) = existing else {
        return Ok(CorrectionTargetState::Unresolved);
    };
    if kind != "capture" {
        return Ok(CorrectionTargetState::DigestConflict);
    }
    let record: EventRecord = serde_json::from_str(&body)?;
    if record.profile_id != profile
        || record.event_id != target_event
        || record.digest != digest
        || record.computed_digest()? != digest
    {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(if digest == target_digest {
        CorrectionTargetState::DigestMatches
    } else {
        CorrectionTargetState::DigestConflict
    })
}

/// Core9 widens only the accepted fact kind and adds derived tag indexes. The
/// event rows retain their local sequence, canonical JSON, digest and identity;
/// all existing child foreign keys continue to target the replacement table.
pub(crate) fn migrate_schema(tx: &rusqlite::Transaction<'_>) -> Result<(), CoreError> {
    crate::replication::validate_objects(
        tx,
        &[
            ("table", "events", EVENTS8),
            ("index", "events_profile_sequence", EVENTS_PROFILE_SEQUENCE),
        ],
    )?;
    if tx.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0))? {
        return Err(CoreError::RecoveryRequired);
    }
    let sequence: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let legacy: bool = tx.pragma_query_value(None, "legacy_alter_table", |row| row.get(0))?;
    tx.pragma_update(None, "legacy_alter_table", true)?;
    tx.execute_batch("ALTER TABLE events RENAME TO events_schema8;")?;
    tx.execute_batch(EVENTS9)?;
    tx.execute_batch("INSERT INTO events(local_seq,event_id,profile_id,digest,body,kind) SELECT local_seq,event_id,profile_id,digest,body,kind FROM events_schema8 ORDER BY local_seq; DROP TABLE events_schema8;")?;
    tx.execute_batch(EVENTS_PROFILE_SEQUENCE)?;
    tx.execute_batch(EVENTS_PROFILE_KIND_SEQUENCE)?;
    match sequence {
        Some((rowid, seq)) => {
            tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
            tx.execute(
                "INSERT INTO sqlite_sequence(rowid,name,seq) VALUES(?1,'events',?2)",
                params![rowid, seq],
            )?;
        }
        None => {
            tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
        }
    };
    tx.pragma_update(None, "legacy_alter_table", legacy)?;
    tx.execute_batch(EVENT_TAGS)?;
    tx.execute_batch(EVENT_TAGS_PROFILE_TAG_SEQUENCE)?;
    tx.execute_batch(EVENT_TAG_INSERT_GUARD)?;
    backfill_capture_tags(tx)?;
    validate_schema_v9(tx)
}

/// Core9 validator retained for the schema-9-to-10 upgrade precondition.
pub(crate) fn validate_schema_v9(connection: &rusqlite::Connection) -> Result<(), CoreError> {
    crate::replication::validate_objects(
        connection,
        &[
            ("table", "events", EVENTS9),
            ("index", "events_profile_sequence", EVENTS_PROFILE_SEQUENCE),
            (
                "index",
                "events_profile_kind_sequence",
                EVENTS_PROFILE_KIND_SEQUENCE,
            ),
            ("table", "event_tags", EVENT_TAGS),
            (
                "index",
                "event_tags_profile_tag_sequence",
                EVENT_TAGS_PROFILE_TAG_SEQUENCE,
            ),
            ("trigger", "event_tag_insert_guard", EVENT_TAG_INSERT_GUARD),
        ],
    )
}

/// Schema10 widens only the event-kind check. Event IDs, bodies, digests,
/// local sequence, child foreign keys and tag indexes are preserved.
pub(crate) fn migrate_original_lifecycle_kind(
    tx: &rusqlite::Transaction<'_>,
) -> Result<(), CoreError> {
    validate_schema_v9(tx)?;
    if tx.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0))? {
        return Err(CoreError::RecoveryRequired);
    }
    let sequence: Option<(i64, i64)> = tx
        .query_row(
            "SELECT rowid,seq FROM sqlite_sequence WHERE name='events'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let legacy: bool = tx.pragma_query_value(None, "legacy_alter_table", |row| row.get(0))?;
    tx.pragma_update(None, "legacy_alter_table", true)?;
    tx.execute_batch("ALTER TABLE events RENAME TO events_schema9;")?;
    tx.execute_batch(EVENTS10)?;
    tx.execute_batch("INSERT INTO events(local_seq,event_id,profile_id,digest,body,kind) SELECT local_seq,event_id,profile_id,digest,body,kind FROM events_schema9 ORDER BY local_seq; DROP TABLE events_schema9;")?;
    tx.execute_batch(EVENTS_PROFILE_SEQUENCE)?;
    tx.execute_batch(EVENTS_PROFILE_KIND_SEQUENCE)?;
    match sequence {
        Some((rowid, seq)) => {
            tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
            tx.execute(
                "INSERT INTO sqlite_sequence(rowid,name,seq) VALUES(?1,'events',?2)",
                params![rowid, seq],
            )?;
        }
        None => {
            tx.execute("DELETE FROM sqlite_sequence WHERE name='events'", [])?;
        }
    };
    tx.pragma_update(None, "legacy_alter_table", legacy)?;
    validate_schema(tx)
}

pub(crate) fn validate_schema(connection: &rusqlite::Connection) -> Result<(), CoreError> {
    crate::replication::validate_objects(
        connection,
        &[
            ("table", "events", EVENTS10),
            ("index", "events_profile_sequence", EVENTS_PROFILE_SEQUENCE),
            (
                "index",
                "events_profile_kind_sequence",
                EVENTS_PROFILE_KIND_SEQUENCE,
            ),
            ("table", "event_tags", EVENT_TAGS),
            (
                "index",
                "event_tags_profile_tag_sequence",
                EVENT_TAGS_PROFILE_TAG_SEQUENCE,
            ),
            ("trigger", "event_tag_insert_guard", EVENT_TAG_INSERT_GUARD),
        ],
    )
}
