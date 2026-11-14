use crate::{
    AgentId, AuthorKind, CaptureCommand, CommandId, CoreError, DeviceId, Durability, EventPage,
    EventQuery, EventRecord, MAX_EVENT_PAGE_SIZE, ProfileId, ProfileInfo, Receipt, WriterContext,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::Duration,
};
use uuid::Uuid;

const DATABASE_NAME: &str = "beta-core.sqlite3";
const MAX_TEXT_BYTES: usize = 128 * 1024;
const MAX_TAGS: usize = 64;
const MAX_TAG_BYTES: usize = 128;

/// One explicit Beta database; no discovery, legacy import, environment
/// overrides, or fallback backend. The mutex protects this connection only;
/// independent processes/connections synchronize through SQLite transactions.
pub struct Core {
    connection: Mutex<Connection>,
    database_path: PathBuf,
    device_id: DeviceId,
    human_author: Uuid,
    owner: Uuid,
}

impl Core {
    pub fn open(root: &Path) -> Result<Self, CoreError> {
        Self::open_expected(root, None)
    }

    /// A persistent embedding may bind its authority to one device. Validate
    /// that identity after SQLite journal recovery but before any migration.
    pub fn open_bound(root: &Path, expected_device: DeviceId) -> Result<Self, CoreError> {
        Self::open_expected(root, Some(expected_device))
    }

    fn open_expected(root: &Path, expected_device: Option<DeviceId>) -> Result<Self, CoreError> {
        if !root.is_absolute()
            || (root.exists() && std::fs::symlink_metadata(root)?.file_type().is_symlink())
        {
            return Err(CoreError::InvalidRoot);
        }
        let mut recovery_evidence = false;
        if root.exists() {
            for entry in std::fs::read_dir(root)? {
                let entry = entry?;
                if entry.file_type()?.is_symlink() {
                    return Err(CoreError::InvalidRoot);
                }
                let name = entry.file_name();
                if name == "backups" {
                    crate::migrations::validate_backup_directory(&entry.path())?;
                    recovery_evidence = true;
                    continue;
                }
                if ![
                    DATABASE_NAME,
                    "beta-core.sqlite3-wal",
                    "beta-core.sqlite3-shm",
                    // Initialization precedes WAL; a crashed writer can leave
                    // a genuine rollback journal which SQLite must recover.
                    "beta-core.sqlite3-journal",
                ]
                .iter()
                .any(|allowed| name == *allowed)
                {
                    return Err(CoreError::ForeignRoot);
                }
                if name != DATABASE_NAME {
                    recovery_evidence = true;
                }
            }
        }
        std::fs::create_dir_all(root)?;
        let database_path = root.canonicalize()?.join(DATABASE_NAME);
        let existed = database_path.exists();
        if (!existed && (recovery_evidence || expected_device.is_some()))
            || (existed && std::fs::metadata(&database_path)?.len() == 0)
        {
            return Err(CoreError::RecoveryRequired);
        }
        if database_path.exists()
            && std::fs::symlink_metadata(&database_path)?
                .file_type()
                .is_symlink()
        {
            return Err(CoreError::InvalidRoot);
        }
        let mut connection = Connection::open(&database_path)?;
        if connection.is_readonly(rusqlite::DatabaseName::Main)? {
            return Err(CoreError::ReadOnlyDatabase);
        }
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        crate::migrations::initialize(&mut connection, &database_path, !existed, expected_device)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        let (device, human): (String, String) = connection.query_row(
            "SELECT device_id, human_author FROM identity WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let human_author = Uuid::parse_str(&human)?;
        if human_author.is_nil() {
            return Err(CoreError::NilAuthorIdentity);
        }
        Ok(Self {
            connection: Mutex::new(connection),
            database_path,
            device_id: device.parse()?,
            human_author,
            owner: Uuid::new_v4(),
        })
    }

    pub fn device_id(&self) -> DeviceId {
        self.device_id
    }
    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn create_profile(&self, name: &str) -> Result<ProfileId, CoreError> {
        self.provision_profile(ProfileId::new(), name)
            .map(|profile| profile.profile_id)
    }

    /// Allows a host to reserve the UUID before its first request, so a lost
    /// response cannot create a second profile when that request is repeated.
    pub fn provision_profile(
        &self,
        profile_id: ProfileId,
        name: &str,
    ) -> Result<ProfileInfo, CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::InvalidCapture("empty profile display name"));
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<String> = transaction
            .query_row(
                "SELECT display_name FROM profiles WHERE id=?1",
                [profile_id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing != name {
                return Err(CoreError::ProfileConflict);
            }
            return Ok(ProfileInfo {
                profile_id,
                display_name: existing,
            });
        }
        transaction.execute(
            "INSERT INTO profiles(id, display_name) VALUES (?1,?2)",
            params![profile_id.to_string(), name],
        )?;
        transaction.commit()?;
        Ok(ProfileInfo {
            profile_id,
            display_name: name.to_owned(),
        })
    }

    pub fn profiles(&self) -> Result<Vec<ProfileInfo>, CoreError> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare("SELECT id,display_name FROM profiles ORDER BY display_name,id")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut profiles = Vec::new();
        for row in rows {
            let (profile, name) = row?;
            profiles.push(ProfileInfo {
                profile_id: profile.parse()?,
                display_name: name,
            });
        }
        Ok(profiles)
    }

    /// Local management authority: adapters must not expose session creation
    /// as an unauthenticated HTTP command. Future token/member checks belong at
    /// that boundary; a command body cannot provide this context or its author.
    pub fn local_human(&self, profile: ProfileId) -> Result<WriterContext, CoreError> {
        self.local_context(profile, self.human_author, AuthorKind::Human)
    }

    pub fn local_agent(
        &self,
        profile: ProfileId,
        agent: AgentId,
    ) -> Result<WriterContext, CoreError> {
        self.local_context(profile, agent.uuid(), AuthorKind::AgentNote)
    }

    fn local_context(
        &self,
        profile: ProfileId,
        author: Uuid,
        kind: AuthorKind,
    ) -> Result<WriterContext, CoreError> {
        let exists: bool = self.connection()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1)",
            [profile.to_string()],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(CoreError::UnknownProfile);
        }
        Ok(WriterContext {
            owner: self.owner,
            profile_id: profile,
            device_id: self.device_id,
            author_id: author,
            author_kind: kind,
        })
    }

    pub(crate) fn check_scope(
        &self,
        context: &WriterContext,
        profile: ProfileId,
    ) -> Result<(), CoreError> {
        if context.owner != self.owner || context.device_id != self.device_id {
            return Err(CoreError::ForeignContext);
        }
        if context.profile_id != profile {
            return Err(CoreError::ScopeMismatch);
        }
        Ok(())
    }

    pub fn submit(
        &self,
        context: &WriterContext,
        input: &CaptureCommand,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(context, input.profile_id)?;
        if (input.text.trim().is_empty() && input.originals.is_empty())
            || input.text.len() > MAX_TEXT_BYTES
            || input.occurred_at_ms < 0
        {
            return Err(CoreError::InvalidCapture(
                "text or timestamp outside supported bounds",
            ));
        }
        if input.originals.len() > crate::MAX_CAPTURE_ORIGINALS {
            return Err(CoreError::InvalidOriginal("capture group too large"));
        }
        for original in &input.originals {
            crate::originals::validate_original(original)?;
        }
        if input.tags.len() > MAX_TAGS
            || input
                .tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.len() > MAX_TAG_BYTES)
        {
            return Err(CoreError::InvalidCapture("tags outside supported bounds"));
        }
        let tags: Vec<String> = input
            .tags
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        #[derive(Serialize)]
        struct Fact<'a> {
            kind: &'static str,
            profile: ProfileId,
            event: crate::EventId,
            device: DeviceId,
            author: Uuid,
            author_kind: AuthorKind,
            occurred_at_ms: i64,
            text: &'a str,
            tags: &'a [String],
            #[serde(skip_serializing_if = "Option::is_none")]
            originals: Option<&'a [crate::OriginalRef]>,
        }
        let fact = Fact {
            kind: if input.originals.is_empty() {
                "capture/1"
            } else {
                "capture/2"
            },
            profile: input.profile_id,
            event: input.event_id,
            device: context.device_id,
            author: context.author_id,
            author_kind: context.author_kind,
            occurred_at_ms: input.occurred_at_ms,
            text: &input.text,
            tags: &tags,
            originals: (!input.originals.is_empty()).then_some(input.originals.as_slice()),
        };
        let canonical = serde_json::to_vec(&fact)?;
        let digest = format!("{:x}", Sha256::digest(&canonical));
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<(String, String)> = transaction
            .query_row(
                "SELECT input_digest, receipt FROM command_receipts WHERE command_id=?1",
                [input.command_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((previous, receipt)) = existing {
            if previous != digest {
                return Err(CoreError::CommandConflict);
            }
            let mut receipt: Receipt = serde_json::from_str(&receipt)?;
            receipt.replayed = true;
            return Ok(receipt);
        }
        crate::originals::validate_references(&transaction, context, &input.originals)?;
        let existing: Option<(i64, String)> = transaction
            .query_row(
                "SELECT local_seq,digest FROM events WHERE event_id=?1",
                [input.event_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let local_seq = if let Some((sequence, previous)) = existing {
            if previous != digest {
                return Err(CoreError::EventConflict);
            }
            sequence
        } else {
            let event = EventRecord {
                event_id: input.event_id,
                profile_id: input.profile_id,
                device_id: context.device_id,
                author_id: context.author_id,
                author_kind: context.author_kind,
                occurred_at_ms: input.occurred_at_ms,
                text: input.text.clone(),
                tags,
                originals: input.originals.clone(),
                digest: digest.clone(),
                local_seq: 0,
            };
            transaction.execute(
                "INSERT INTO events(event_id,profile_id,digest,body) VALUES (?1,?2,?3,?4)",
                params![
                    input.event_id.to_string(),
                    input.profile_id.to_string(),
                    digest,
                    serde_json::to_string(&event)?
                ],
            )?;
            let event_sequence = transaction.last_insert_rowid();
            for (ordinal, original) in input.originals.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO event_originals(event_id,ordinal,original_id) VALUES(?1,?2,?3)",
                    params![
                        input.event_id.to_string(),
                        ordinal as i64,
                        original.original_id.to_string()
                    ],
                )?;
            }
            event_sequence
        };
        let receipt = Receipt {
            command_id: input.command_id,
            event_id: input.event_id,
            profile_id: input.profile_id,
            local_seq: local_seq as u64,
            event_digest: digest.clone(),
            durability: Durability::LocalCommitted,
            replayed: false,
        };
        transaction.execute("INSERT INTO command_receipts(command_id,profile_id,input_digest,receipt) VALUES (?1,?2,?3,?4)", params![input.command_id.to_string(),input.profile_id.to_string(),digest,serde_json::to_string(&receipt)?])?;
        transaction.commit()?;
        // There is no fallible notification, checkpoint, or alternate-store
        // write after commit that could turn this receipt into a false failure.
        Ok(receipt)
    }

    pub fn events(
        &self,
        context: &WriterContext,
        profile: ProfileId,
    ) -> Result<Vec<EventRecord>, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT local_seq,body FROM events WHERE profile_id=?1 AND kind='capture' ORDER BY local_seq")?;
        let rows = statement.query_map([profile.to_string()], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut events = Vec::new();
        for row in rows {
            let (sequence, body) = row?;
            let mut event: EventRecord = serde_json::from_str(&body)?;
            event.local_seq = sequence as u64;
            events.push(event);
        }
        Ok(events)
    }

    /// Case-sensitive literal substring search over the original text. The
    /// extra row is only lookahead; next_before always names the last returned
    /// fact, preventing duplicates at equal timestamps and sparse sequences.
    pub fn events_page(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        query: &EventQuery,
    ) -> Result<EventPage, CoreError> {
        self.check_scope(context, profile)?;
        if !(1..=MAX_EVENT_PAGE_SIZE).contains(&query.limit) {
            return Err(CoreError::InvalidQuery("limit must be between 1 and 100"));
        }
        let connection = self.connection()?;
        let current: i64 = connection.query_row(
            "SELECT coalesce(max(local_seq),0) FROM events WHERE profile_id=?1",
            [profile.to_string()],
            |row| row.get(0),
        )?;
        let current = u64::try_from(current)
            .map_err(|_| CoreError::InvalidQuery("invalid stored sequence"))?;
        let highwater = query.through.unwrap_or(current);
        if highwater > current {
            return Err(CoreError::InvalidQuery(
                "snapshot is ahead of available history",
            ));
        }
        if let Some(before) = query.before {
            if before == 0 || before > highwater + 1 {
                return Err(CoreError::InvalidQuery(
                    "before must be positive and within the snapshot",
                ));
            }
        }
        // SQLite sequences are signed; highwater+1 is still a valid exclusive
        // upper boundary at i64::MAX, represented by no additional predicate.
        let before = query.before.and_then(|value| i64::try_from(value).ok());
        let through = i64::try_from(highwater)
            .map_err(|_| CoreError::InvalidQuery("snapshot exceeds the SQLite sequence range"))?;
        let mut statement = connection.prepare(
            "SELECT local_seq,body FROM events WHERE profile_id=?1 AND kind='capture' AND local_seq<=?2 AND (?3 IS NULL OR local_seq<?3) AND (?4 IS NULL OR instr(json_extract(body,'$.text'),?4)>0) ORDER BY local_seq DESC LIMIT ?5"
        )?;
        let rows = statement.query_map(
            params![
                profile.to_string(),
                through,
                before,
                query.search.as_deref(),
                (query.limit + 1) as i64
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?;
        let mut items = Vec::new();
        for row in rows {
            let (sequence, body) = row?;
            let mut event: EventRecord = serde_json::from_str(&body)?;
            event.local_seq = sequence as u64;
            items.push(event);
        }
        let has_more = items.len() > query.limit;
        items.truncate(query.limit);
        let next_before = if has_more {
            items.last().map(|event| event.local_seq)
        } else {
            None
        };
        Ok(EventPage {
            items,
            next_before,
            highwater,
        })
    }

    pub fn receipt(
        &self,
        context: &WriterContext,
        command: CommandId,
    ) -> Result<Option<Receipt>, CoreError> {
        self.check_scope(context, context.profile_id)?;
        let stored: Option<String> = self
            .connection()?
            .query_row(
                "SELECT receipt FROM command_receipts WHERE command_id=?1 AND profile_id=?2",
                params![command.to_string(), context.profile_id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        stored
            .map(|value| serde_json::from_str(&value).map_err(CoreError::from))
            .transpose()
    }

    pub(crate) fn lifecycle(&self) -> Uuid {
        self.owner
    }

    pub(crate) fn connection(&self) -> Result<MutexGuard<'_, Connection>, CoreError> {
        self.connection
            .lock()
            .map_err(|_| CoreError::ConnectionPoisoned)
    }
}
