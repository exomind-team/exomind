//! Append-only original lifecycle facts and the local-byte projection.
//!
//! A lifecycle fact records a human's reclaim, restore, or local-release action.
//! The mutable projection is only a bounded read/write aid; the fact and the
//! immutable manifest/reference rows remain authoritative history.

use crate::{
    AuthorKind, CommandId, Core, CoreError, DeviceId, Durability, EventId, OriginalId, OriginalRef,
    ProfileId, Receipt, WriterContext,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const ORIGINAL_LIFECYCLE_FACT_TYPE: &str = "orig_lifecycle/1";
/// Adjustable engineering default; Host persists the deadline chosen at reclaim time.
pub const DEFAULT_ORIGINAL_RECLAIM_WINDOW_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

const OBJECTS: &[(&str, &str, &str)] = &[
    (
        "table",
        "original_lifecycle_local_state",
        "CREATE TABLE original_lifecycle_local_state(profile_id TEXT NOT NULL REFERENCES profiles(id),original_id TEXT NOT NULL REFERENCES original_manifests(original_id),generation INTEGER NOT NULL CHECK(generation>0),state TEXT NOT NULL CHECK(state IN ('available','reclaimed','released','purged','restore_pending')),latest_event_id TEXT NOT NULL REFERENCES events(event_id),restore_request_event_id TEXT,restore_completion_event_id TEXT,restore_command_id TEXT,restore_author_id TEXT,restore_occurred_at_ms INTEGER,reclaim_started_at_ms INTEGER,reclaim_clock_epoch_id TEXT,reclaim_elapsed_ms INTEGER,recovery_window_ms INTEGER,reclaim_deadline_ms INTEGER,PRIMARY KEY(profile_id,original_id),CHECK((state='restore_pending' AND restore_request_event_id IS NOT NULL AND restore_completion_event_id IS NOT NULL AND restore_command_id IS NOT NULL AND restore_author_id IS NOT NULL AND restore_occurred_at_ms IS NOT NULL) OR (state<>'restore_pending' AND restore_request_event_id IS NULL AND restore_completion_event_id IS NULL AND restore_command_id IS NULL AND restore_author_id IS NULL AND restore_occurred_at_ms IS NULL)),CHECK((state='reclaimed' AND reclaim_started_at_ms IS NOT NULL AND reclaim_clock_epoch_id IS NOT NULL AND reclaim_elapsed_ms IS NOT NULL AND recovery_window_ms IS NOT NULL AND reclaim_deadline_ms IS NOT NULL) OR (state<>'reclaimed' AND reclaim_started_at_ms IS NULL AND reclaim_clock_epoch_id IS NULL AND reclaim_elapsed_ms IS NULL AND recovery_window_ms IS NULL AND reclaim_deadline_ms IS NULL)))",
    ),
    (
        "trigger",
        "original_lifecycle_state_generation_guard",
        "CREATE TRIGGER original_lifecycle_state_generation_guard BEFORE UPDATE ON original_lifecycle_local_state WHEN NEW.profile_id<>OLD.profile_id OR NEW.original_id<>OLD.original_id OR NEW.generation<>OLD.generation+1 BEGIN SELECT RAISE(ABORT,'original lifecycle generation must advance'); END",
    ),
    (
        "trigger",
        "original_lifecycle_state_no_delete",
        "CREATE TRIGGER original_lifecycle_state_no_delete BEFORE DELETE ON original_lifecycle_local_state BEGIN SELECT RAISE(ABORT,'original lifecycle projection is durable'); END",
    ),
    (
        "trigger",
        "original_lifecycle_fact_no_update",
        "CREATE TRIGGER original_lifecycle_fact_no_update BEFORE UPDATE ON events WHEN OLD.kind='orig_lifecycle/1' BEGIN SELECT RAISE(ABORT,'original lifecycle facts are immutable'); END",
    ),
    (
        "trigger",
        "original_lifecycle_fact_no_delete",
        "CREATE TRIGGER original_lifecycle_fact_no_delete BEFORE DELETE ON events WHEN OLD.kind='orig_lifecycle/1' BEGIN SELECT RAISE(ABORT,'original lifecycle facts are immutable'); END",
    ),
    (
        "table",
        "original_lifecycle_followups",
        "CREATE TABLE original_lifecycle_followups(event_id TEXT NOT NULL REFERENCES events(event_id),profile_id TEXT NOT NULL REFERENCES profiles(id),original_id TEXT NOT NULL,target_device_id TEXT NOT NULL,local_seq INTEGER NOT NULL CHECK(local_seq>0),PRIMARY KEY(event_id,target_device_id))",
    ),
    (
        "table",
        "original_lifecycle_followups_pending",
        "CREATE TABLE original_lifecycle_followups_pending(event_id TEXT NOT NULL,target_device_id TEXT NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),local_seq INTEGER NOT NULL CHECK(local_seq>0),PRIMARY KEY(event_id,target_device_id),FOREIGN KEY(event_id,target_device_id) REFERENCES original_lifecycle_followups(event_id,target_device_id))",
    ),
    (
        "index",
        "original_lifecycle_followups_pending_target_sequence",
        "CREATE INDEX original_lifecycle_followups_pending_target_sequence ON original_lifecycle_followups_pending(profile_id,target_device_id,local_seq,event_id)",
    ),
    (
        "trigger",
        "original_lifecycle_followups_no_update",
        "CREATE TRIGGER original_lifecycle_followups_no_update BEFORE UPDATE ON original_lifecycle_followups BEGIN SELECT RAISE(ABORT,'original lifecycle follow-up is immutable'); END",
    ),
    (
        "trigger",
        "original_lifecycle_followups_no_delete",
        "CREATE TRIGGER original_lifecycle_followups_no_delete BEFORE DELETE ON original_lifecycle_followups BEGIN SELECT RAISE(ABORT,'original lifecycle follow-up is immutable'); END",
    ),
    (
        "table",
        "original_lifecycle_followup_responses",
        "CREATE TABLE original_lifecycle_followup_responses(response_event_id TEXT PRIMARY KEY REFERENCES events(event_id),request_event_id TEXT NOT NULL,target_device_id TEXT NOT NULL,profile_id TEXT NOT NULL REFERENCES profiles(id),original_id TEXT NOT NULL,UNIQUE(request_event_id,target_device_id))",
    ),
    (
        "index",
        "original_lifecycle_followup_responses_request",
        "CREATE INDEX original_lifecycle_followup_responses_request ON original_lifecycle_followup_responses(profile_id,request_event_id,target_device_id)",
    ),
    (
        "trigger",
        "original_lifecycle_followup_responses_no_update",
        "CREATE TRIGGER original_lifecycle_followup_responses_no_update BEFORE UPDATE ON original_lifecycle_followup_responses BEGIN SELECT RAISE(ABORT,'original lifecycle follow-up response is immutable'); END",
    ),
    (
        "trigger",
        "original_lifecycle_followup_responses_no_delete",
        "CREATE TRIGGER original_lifecycle_followup_responses_no_delete BEFORE DELETE ON original_lifecycle_followup_responses BEGIN SELECT RAISE(ABORT,'original lifecycle follow-up response is immutable'); END",
    ),
    (
        "table",
        "original_lifecycle_delete_gate",
        "CREATE TABLE original_lifecycle_delete_gate(stage_id TEXT NOT NULL REFERENCES original_stages(stage_id),event_id TEXT NOT NULL REFERENCES events(event_id),profile_id TEXT NOT NULL REFERENCES profiles(id),original_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>0),action TEXT NOT NULL CHECK(action IN ('release_local','purge_reclaimed')),PRIMARY KEY(stage_id,event_id))",
    ),
    (
        "trigger",
        "original_lifecycle_delete_gate_insert_guard",
        "CREATE TRIGGER original_lifecycle_delete_gate_insert_guard BEFORE INSERT ON original_lifecycle_delete_gate WHEN NEW.action NOT IN ('release_local','purge_reclaimed') OR NOT EXISTS(SELECT 1 FROM original_stages s JOIN original_lifecycle_local_state l ON l.profile_id=s.profile_id AND l.original_id=s.original_id JOIN events e ON e.event_id=NEW.event_id WHERE s.stage_id=NEW.stage_id AND s.profile_id=NEW.profile_id AND s.original_id=NEW.original_id AND l.profile_id=NEW.profile_id AND l.original_id=NEW.original_id AND l.generation=NEW.generation AND l.latest_event_id=NEW.event_id AND ((NEW.action='release_local' AND l.state='released') OR (NEW.action='purge_reclaimed' AND l.state='purged')) AND e.profile_id=NEW.profile_id AND e.kind='orig_lifecycle/1' AND json_extract(e.body,'$.action')=NEW.action AND json_extract(e.body,'$.profile_id')=NEW.profile_id AND json_extract(e.body,'$.original_id')=NEW.original_id AND json_extract(e.body,'$.generation')=NEW.generation) BEGIN SELECT RAISE(ABORT,'original chunk deletion requires a matching release or purge fact'); END",
    ),
    (
        "table",
        "original_lifecycle_restore_retry_gate",
        "CREATE TABLE original_lifecycle_restore_retry_gate(stage_id TEXT NOT NULL REFERENCES original_stages(stage_id),profile_id TEXT NOT NULL REFERENCES profiles(id),original_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>0),request_event_id TEXT NOT NULL REFERENCES events(event_id),restore_command_id TEXT NOT NULL,PRIMARY KEY(stage_id,request_event_id))",
    ),
    (
        "trigger",
        "original_lifecycle_restore_retry_gate_insert_guard",
        "CREATE TRIGGER original_lifecycle_restore_retry_gate_insert_guard BEFORE INSERT ON original_lifecycle_restore_retry_gate WHEN NOT EXISTS(SELECT 1 FROM original_stages s JOIN original_lifecycle_local_state l ON l.profile_id=s.profile_id AND l.original_id=s.original_id JOIN events e ON e.event_id=NEW.request_event_id WHERE s.stage_id=NEW.stage_id AND s.profile_id=NEW.profile_id AND s.original_id=NEW.original_id AND s.state='hash_mismatch' AND l.profile_id=NEW.profile_id AND l.original_id=NEW.original_id AND l.state='restore_pending' AND l.generation=NEW.generation AND l.latest_event_id=NEW.request_event_id AND l.restore_request_event_id=NEW.request_event_id AND l.restore_command_id=NEW.restore_command_id AND e.profile_id=NEW.profile_id AND e.kind='orig_lifecycle/1' AND json_extract(e.body,'$.action')='restore_requested' AND json_extract(e.body,'$.original_id')=NEW.original_id AND json_extract(e.body,'$.command_id')=NEW.restore_command_id) BEGIN SELECT RAISE(ABORT,'restore retry can only clear a failed stage for its pending request'); END",
    ),
    (
        "index",
        "original_lifecycle_correction_target_sequence",
        "CREATE INDEX original_lifecycle_correction_target_sequence ON events(profile_id,json_extract(body,'$.target_event_id'),local_seq DESC) WHERE kind='correction/1'",
    ),
];

const OLD_CHUNK_DELETE_TRIGGER: &str = "CREATE TRIGGER original_chunks_no_delete BEFORE DELETE ON original_chunks\n BEGIN SELECT RAISE(ABORT,'original release requires a later explicit lifecycle'); END";
const NEW_CHUNK_DELETE_TRIGGER: &str = "CREATE TRIGGER original_chunks_no_delete BEFORE DELETE ON original_chunks WHEN NOT (EXISTS(SELECT 1 FROM original_lifecycle_delete_gate g JOIN original_stages s ON s.stage_id=g.stage_id JOIN original_lifecycle_local_state l ON l.profile_id=s.profile_id AND l.original_id=s.original_id JOIN events e ON e.event_id=g.event_id WHERE g.stage_id=OLD.stage_id AND g.profile_id=s.profile_id AND g.original_id=s.original_id AND g.profile_id=l.profile_id AND g.original_id=l.original_id AND g.generation=l.generation AND g.event_id=l.latest_event_id AND ((g.action='release_local' AND l.state='released') OR (g.action='purge_reclaimed' AND l.state='purged')) AND e.profile_id=g.profile_id AND e.kind='orig_lifecycle/1' AND json_extract(e.body,'$.action')=g.action AND g.action IN ('release_local','purge_reclaimed') AND json_extract(e.body,'$.profile_id')=g.profile_id AND json_extract(e.body,'$.original_id')=g.original_id AND json_extract(e.body,'$.generation')=g.generation) OR EXISTS(SELECT 1 FROM original_lifecycle_restore_retry_gate g JOIN original_stages s ON s.stage_id=g.stage_id JOIN original_lifecycle_local_state l ON l.profile_id=s.profile_id AND l.original_id=s.original_id WHERE g.stage_id=OLD.stage_id AND g.profile_id=s.profile_id AND g.original_id=s.original_id AND g.generation=l.generation AND g.request_event_id=l.latest_event_id AND l.state='restore_pending' AND l.restore_request_event_id=g.request_event_id AND l.restore_command_id=g.restore_command_id AND s.state='hash_mismatch')) BEGIN SELECT RAISE(ABORT,'original chunk deletion requires a matching lifecycle action'); END";

/// The user-facing action. Q04 reclaim/restore/purge is recoverable; Q24 local
/// release is a separate explicit action that may start while bytes are available.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalLifecycleAction {
    Reclaim,
    Restore,
    PurgeReclaimed,
    ReleaseLocal,
}

/// Current local-byte state; `Missing` is derived when no local verified stage
/// or lifecycle projection exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalBytesState {
    Available,
    Reclaimed,
    Released,
    Purged,
    RestorePending,
    Missing,
}

impl OriginalBytesState {
    fn label(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Reclaimed => "reclaimed",
            Self::Released => "released",
            Self::Purged => "purged",
            Self::RestorePending => "restore_pending",
            Self::Missing => "missing",
        }
    }

    fn parse(raw: &str) -> Result<Self, CoreError> {
        match raw {
            "available" => Ok(Self::Available),
            "reclaimed" => Ok(Self::Reclaimed),
            "released" => Ok(Self::Released),
            "purged" => Ok(Self::Purged),
            "restore_pending" => Ok(Self::RestorePending),
            _ => Err(CoreError::RecoveryRequired),
        }
    }
}

/// A caller-provided lifecycle command. IDs and the target device list are
/// fixed before admission so a retry cannot silently change its meaning.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleCommand {
    pub command_id: CommandId,
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub original_id: OriginalId,
    pub expected_generation: u64,
    pub occurred_at_ms: i64,
    pub action: OriginalLifecycleAction,
    pub cleanup_confirmed: bool,
    /// Empty by default. Only explicitly selected peers are named; receiving
    /// this fact never deletes their local bytes by itself.
    pub follow_up_device_ids: Vec<DeviceId>,
    pub responds_to_event_id: Option<EventId>,
}

/// Trusted Host clock sample used to start and enforce a local reclaim window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleClock {
    pub epoch_id: Uuid,
    pub wall_ms: i64,
    pub elapsed_ms: u64,
}

/// Replicated lifecycle fact. It describes an action on its authoring device;
/// importers preserve it as history and never apply its byte mutation locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleRecord {
    pub event_id: EventId,
    pub profile_id: ProfileId,
    pub device_id: DeviceId,
    pub author_id: Uuid,
    pub original_id: OriginalId,
    pub action: String,
    pub generation: u64,
    pub command_id: CommandId,
    pub occurred_at_ms: i64,
    pub follow_up_device_ids: Vec<DeviceId>,
    pub responds_to_event_id: Option<EventId>,
    pub local_seq: u64,
    pub digest: String,
}

impl OriginalLifecycleRecord {
    pub fn computed_digest(&self) -> Result<String, CoreError> {
        let canonical = serde_json::to_vec(&(
            ORIGINAL_LIFECYCLE_FACT_TYPE,
            self.event_id,
            self.profile_id,
            self.device_id,
            self.author_id,
            self.original_id,
            self.action.as_str(),
            self.generation,
            self.command_id,
            self.occurred_at_ms,
            &self.follow_up_device_ids,
            self.responds_to_event_id,
        ))?;
        Ok(format!("{:x}", Sha256::digest(canonical)))
    }

    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        if self.author_id.is_nil()
            || self.generation == 0
            || self.occurred_at_ms < 0
            || self.local_seq != 0
            || self.follow_up_device_ids.len() > 256
            || !matches!(
                self.action.as_str(),
                "reclaim"
                    | "restore_requested"
                    | "restore_completed"
                    | "release_local"
                    | "purge_reclaimed"
            )
            || (self.action != "release_local" && !self.follow_up_device_ids.is_empty())
            || (!matches!(self.action.as_str(), "release_local" | "restore_completed")
                && self.responds_to_event_id.is_some())
            || self
                .follow_up_device_ids
                .windows(2)
                .any(|pair| pair[0].to_string() >= pair[1].to_string())
            || self.follow_up_device_ids.contains(&self.device_id)
            || self.computed_digest()? != self.digest
        {
            return Err(CoreError::InvalidOriginalLifecycleFact);
        }
        Ok(())
    }
}

/// Query result scoped to one profile and original ID.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleStatus {
    pub profile_id: ProfileId,
    pub original: OriginalRef,
    pub bytes_state: OriginalBytesState,
    pub generation: u64,
    pub latest_event_id: Option<EventId>,
    pub restore_request_event_id: Option<EventId>,
    pub restore_completion_event_id: Option<EventId>,
    /// Trusted HostClock wall stamp at reclaim time.
    pub reclaimed_at_ms: Option<i64>,
    pub reclaim_clock_epoch_id: Option<Uuid>,
    pub reclaim_elapsed_ms: Option<u64>,
    pub recovery_window_ms: Option<u64>,
    /// Fixed at reclaim time. Expiry never purges by itself.
    pub reclaim_deadline_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalLifecycleFollowupResolution {
    Unresolved,
    ManifestKnown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleFollowup {
    pub request: OriginalLifecycleRecord,
    pub resolution: OriginalLifecycleFollowupResolution,
}

/// A freshness permit for a multi-range read or export. Callers must check it
/// after their last chunk and before publishing the output file.
#[derive(Debug, Clone)]
pub struct OriginalReadPermit {
    core_lifecycle: Uuid,
    profile_id: ProfileId,
    original_id: OriginalId,
    generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLifecycleFollowupPage {
    pub items: Vec<OriginalLifecycleFollowup>,
    pub next_after: Option<EventId>,
}

#[derive(Debug)]
struct CurrentState {
    state: OriginalBytesState,
    generation: u64,
    latest_event_id: Option<EventId>,
    restore_request_event_id: Option<EventId>,
    restore_completion_event_id: Option<EventId>,
    restore_command_id: Option<CommandId>,
    restore_author_id: Option<Uuid>,
    restore_occurred_at_ms: Option<i64>,
    reclaim_started_at_ms: Option<i64>,
    reclaim_clock_epoch_id: Option<Uuid>,
    reclaim_elapsed_ms: Option<u64>,
    recovery_window_ms: Option<u64>,
    reclaim_deadline_ms: Option<i64>,
}

fn unavailable<T>(_: T) -> CoreError {
    CoreError::RecoveryRequired
}

fn manifest_and_reference(
    connection: &Connection,
    profile: ProfileId,
    original: OriginalId,
) -> Result<OriginalRef, CoreError> {
    let (bound_profile, metadata) = crate::manifests::manifest(connection, original)?;
    if bound_profile != profile {
        return Err(CoreError::ScopeMismatch);
    }
    let referenced: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM event_originals r JOIN events e ON e.event_id=r.event_id WHERE r.original_id=?1 AND e.profile_id=?2)",
        params![original.to_string(), profile.to_string()],
        |row| row.get(0),
    )?;
    if !referenced {
        return Err(CoreError::OriginalAccessDenied);
    }
    Ok(metadata)
}

fn current_state(
    connection: &Connection,
    profile: ProfileId,
    original: OriginalId,
) -> Result<CurrentState, CoreError> {
    let row: Option<(
        String,
        u64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
    )> = connection
        .query_row(
            "SELECT state,generation,latest_event_id,restore_request_event_id,restore_completion_event_id,restore_command_id,restore_author_id,restore_occurred_at_ms,reclaim_started_at_ms,reclaim_clock_epoch_id,reclaim_elapsed_ms,recovery_window_ms,reclaim_deadline_ms FROM original_lifecycle_local_state WHERE profile_id=?1 AND original_id=?2",
            params![profile.to_string(), original.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?, row.get(12)?)),
        )
        .optional()?;
    if let Some((
        state,
        generation,
        latest,
        request,
        completion,
        command,
        author,
        occurred,
        reclaim_started,
        reclaim_epoch,
        reclaim_elapsed,
        recovery_window,
        reclaim_deadline,
    )) = row
    {
        return Ok(CurrentState {
            state: OriginalBytesState::parse(&state)?,
            generation,
            latest_event_id: Some(latest.parse().map_err(unavailable)?),
            restore_request_event_id: request
                .map(|id| id.parse().map_err(unavailable))
                .transpose()?,
            restore_completion_event_id: completion
                .map(|id| id.parse().map_err(unavailable))
                .transpose()?,
            restore_command_id: command
                .map(|id| id.parse().map_err(unavailable))
                .transpose()?,
            restore_author_id: author
                .map(|id| Uuid::parse_str(&id).map_err(unavailable))
                .transpose()?,
            restore_occurred_at_ms: occurred,
            reclaim_started_at_ms: reclaim_started,
            reclaim_clock_epoch_id: reclaim_epoch
                .map(|id| Uuid::parse_str(&id).map_err(unavailable))
                .transpose()?,
            reclaim_elapsed_ms: reclaim_elapsed
                .map(|value| u64::try_from(value).map_err(unavailable))
                .transpose()?,
            recovery_window_ms: recovery_window
                .map(|value| u64::try_from(value).map_err(unavailable))
                .transpose()?,
            reclaim_deadline_ms: reclaim_deadline,
        });
    }
    let available: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM original_stages WHERE original_id=?1 AND profile_id=?2 AND state='verified' AND next_offset=byte_length)",
        params![original.to_string(), profile.to_string()],
        |row| row.get(0),
    )?;
    Ok(CurrentState {
        state: if available {
            OriginalBytesState::Available
        } else {
            OriginalBytesState::Missing
        },
        generation: 0,
        latest_event_id: None,
        restore_request_event_id: None,
        restore_completion_event_id: None,
        restore_command_id: None,
        restore_author_id: None,
        restore_occurred_at_ms: None,
        reclaim_started_at_ms: None,
        reclaim_clock_epoch_id: None,
        reclaim_elapsed_ms: None,
        recovery_window_ms: None,
        reclaim_deadline_ms: None,
    })
}

pub(crate) fn bytes_state_in_connection(
    connection: &Connection,
    profile: ProfileId,
    original: OriginalId,
) -> Result<OriginalBytesState, CoreError> {
    Ok(current_state(connection, profile, original)?.state)
}

pub(crate) fn bytes_state_generation_in_connection(
    connection: &Connection,
    profile: ProfileId,
    original: OriginalId,
) -> Result<(OriginalBytesState, u64), CoreError> {
    let current = current_state(connection, profile, original)?;
    Ok((current.state, current.generation))
}

pub(crate) fn pending_restore_identity(
    connection: &Connection,
    profile: ProfileId,
    original: OriginalId,
) -> Result<(EventId, CommandId, Uuid, u64), CoreError> {
    let current = current_state(connection, profile, original)?;
    if current.state != OriginalBytesState::RestorePending {
        return Err(CoreError::OriginalLifecycleConflict);
    }
    Ok((
        current
            .restore_request_event_id
            .ok_or(CoreError::RecoveryRequired)?,
        current
            .restore_command_id
            .ok_or(CoreError::RecoveryRequired)?,
        current
            .restore_author_id
            .ok_or(CoreError::RecoveryRequired)?,
        current.generation,
    ))
}

fn status_from(
    connection: &Connection,
    profile: ProfileId,
    original: OriginalId,
) -> Result<OriginalLifecycleStatus, CoreError> {
    let metadata = manifest_and_reference(connection, profile, original)?;
    let state = current_state(connection, profile, original)?;
    Ok(OriginalLifecycleStatus {
        profile_id: profile,
        original: metadata,
        bytes_state: state.state,
        generation: state.generation,
        latest_event_id: state.latest_event_id,
        restore_request_event_id: state.restore_request_event_id,
        restore_completion_event_id: state.restore_completion_event_id,
        reclaimed_at_ms: state.reclaim_started_at_ms,
        reclaim_clock_epoch_id: state.reclaim_clock_epoch_id,
        reclaim_elapsed_ms: state.reclaim_elapsed_ms,
        recovery_window_ms: state.recovery_window_ms,
        reclaim_deadline_ms: state.reclaim_deadline_ms,
    })
}

fn validate_command(command: &OriginalLifecycleCommand) -> Result<(), CoreError> {
    if command.occurred_at_ms < 0
        || command.follow_up_device_ids.len() > 256
        || command
            .follow_up_device_ids
            .windows(2)
            .any(|pair| pair[0].to_string() >= pair[1].to_string())
    {
        return Err(CoreError::InvalidOriginalLifecycleCommand);
    }
    match command.action {
        OriginalLifecycleAction::ReleaseLocal => {
            if !command.cleanup_confirmed {
                return Err(CoreError::OriginalLifecycleCleanupConfirmationRequired);
            }
        }
        OriginalLifecycleAction::PurgeReclaimed => {
            if !command.cleanup_confirmed {
                return Err(CoreError::OriginalLifecycleCleanupConfirmationRequired);
            }
            if !command.follow_up_device_ids.is_empty() || command.responds_to_event_id.is_some() {
                return Err(CoreError::InvalidOriginalLifecycleCommand);
            }
        }
        OriginalLifecycleAction::Restore => {
            if !command.follow_up_device_ids.is_empty()
                || command.responds_to_event_id.is_some()
                || command.cleanup_confirmed
            {
                return Err(CoreError::InvalidOriginalLifecycleCommand);
            }
        }
        OriginalLifecycleAction::Reclaim => {
            if command.cleanup_confirmed
                || !command.follow_up_device_ids.is_empty()
                || command.responds_to_event_id.is_some()
            {
                return Err(CoreError::InvalidOriginalLifecycleCommand);
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct CommandDigestInput<'a> {
    domain: &'static str,
    command: &'a OriginalLifecycleCommand,
}

fn command_digest(command: &OriginalLifecycleCommand) -> Result<String, CoreError> {
    let bytes = serde_json::to_vec(&CommandDigestInput {
        domain: "original-lifecycle-command/1",
        command,
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn next_generation(generation: u64) -> Result<u64, CoreError> {
    generation
        .checked_add(1)
        .filter(|value| *value <= i64::MAX as u64)
        .ok_or(CoreError::InvalidOriginalLifecycleCommand)
}

fn make_record(
    context: &WriterContext,
    command_id: CommandId,
    event_id: EventId,
    original_id: OriginalId,
    action: &str,
    generation: u64,
    occurred_at_ms: i64,
    follow_up_device_ids: Vec<DeviceId>,
    responds_to_event_id: Option<EventId>,
) -> Result<OriginalLifecycleRecord, CoreError> {
    let mut record = OriginalLifecycleRecord {
        event_id,
        profile_id: context.profile_id,
        device_id: context.device_id,
        author_id: context.author_id,
        original_id,
        action: action.to_owned(),
        generation,
        command_id,
        occurred_at_ms,
        follow_up_device_ids,
        responds_to_event_id,
        local_seq: 0,
        digest: String::new(),
    };
    record.digest = record.computed_digest()?;
    record.validate()?;
    Ok(record)
}

fn insert_fact(
    transaction: &Transaction<'_>,
    context: &WriterContext,
    record: &OriginalLifecycleRecord,
) -> Result<u64, CoreError> {
    record.validate()?;
    let existing: Option<(String, String)> = transaction
        .query_row(
            "SELECT digest,kind FROM events WHERE event_id=?1",
            [record.event_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if existing.is_some() {
        return Err(CoreError::EventConflict);
    }
    let body = crate::fact_encoding::encode_fact(record)?;
    transaction.execute(
        "INSERT INTO events(event_id,profile_id,digest,body,kind) VALUES(?1,?2,?3,?4,?5)",
        params![
            record.event_id.to_string(),
            record.profile_id.to_string(),
            record.digest,
            body,
            ORIGINAL_LIFECYCLE_FACT_TYPE
        ],
    )?;
    let sequence =
        u64::try_from(transaction.last_insert_rowid()).map_err(|_| CoreError::RecoveryRequired)?;
    crate::original_lifecycle::index_followups(transaction, record)?;
    crate::replication::record_local_fact(
        transaction,
        record.profile_id,
        context.device_id,
        record.event_id,
        ORIGINAL_LIFECYCLE_FACT_TYPE,
        &record.digest,
    )?;
    Ok(sequence)
}

fn set_local_state(
    transaction: &Transaction<'_>,
    profile: ProfileId,
    original: OriginalId,
    generation: u64,
    state: OriginalBytesState,
    latest_event: EventId,
    restore: Option<(EventId, EventId, CommandId, Uuid, i64)>,
    reclaim_clock: Option<OriginalLifecycleClock>,
    recovery_window_ms: Option<u64>,
    reclaim_deadline_ms: Option<i64>,
) -> Result<(), CoreError> {
    let (request, completion, command, author, occurred) = match restore {
        Some((request, completion, command, author, occurred)) => (
            Some(request.to_string()),
            Some(completion.to_string()),
            Some(command.to_string()),
            Some(author.to_string()),
            Some(occurred),
        ),
        None => (None, None, None, None, None),
    };
    let (reclaim_started, reclaim_epoch, reclaim_elapsed) =
        reclaim_clock.map_or((None, None, None), |clock| {
            (
                Some(clock.wall_ms),
                Some(clock.epoch_id.to_string()),
                Some(clock.elapsed_ms),
            )
        });
    transaction.execute(
        "INSERT INTO original_lifecycle_local_state(profile_id,original_id,generation,state,latest_event_id,restore_request_event_id,restore_completion_event_id,restore_command_id,restore_author_id,restore_occurred_at_ms,reclaim_started_at_ms,reclaim_clock_epoch_id,reclaim_elapsed_ms,recovery_window_ms,reclaim_deadline_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(profile_id,original_id) DO UPDATE SET generation=excluded.generation,state=excluded.state,latest_event_id=excluded.latest_event_id,restore_request_event_id=excluded.restore_request_event_id,restore_completion_event_id=excluded.restore_completion_event_id,restore_command_id=excluded.restore_command_id,restore_author_id=excluded.restore_author_id,restore_occurred_at_ms=excluded.restore_occurred_at_ms,reclaim_started_at_ms=excluded.reclaim_started_at_ms,reclaim_clock_epoch_id=excluded.reclaim_clock_epoch_id,reclaim_elapsed_ms=excluded.reclaim_elapsed_ms,recovery_window_ms=excluded.recovery_window_ms,reclaim_deadline_ms=excluded.reclaim_deadline_ms",
        params![
            profile.to_string(),
            original.to_string(),
            generation,
            state.label(),
            latest_event.to_string(),
            request,
            completion,
            command,
            author,
            occurred,
            reclaim_started,
            reclaim_epoch,
            reclaim_elapsed,
            recovery_window_ms,
            reclaim_deadline_ms
        ],
    )?;
    Ok(())
}

fn reclaim_window_expired(
    previous: &CurrentState,
    clock: OriginalLifecycleClock,
) -> Result<bool, CoreError> {
    let deadline = previous
        .reclaim_deadline_ms
        .ok_or(CoreError::RecoveryRequired)?;
    let window = previous
        .recovery_window_ms
        .ok_or(CoreError::RecoveryRequired)?;
    if previous.reclaim_clock_epoch_id == Some(clock.epoch_id) {
        let started = previous
            .reclaim_elapsed_ms
            .ok_or(CoreError::RecoveryRequired)?;
        let elapsed = clock
            .elapsed_ms
            .checked_sub(started)
            .ok_or(CoreError::InvalidOriginalLifecycleCommand)?;
        Ok(elapsed >= window)
    } else {
        Ok(clock.wall_ms >= deadline)
    }
}

fn apply_local_command(
    transaction: &Transaction<'_>,
    context: &WriterContext,
    command: &OriginalLifecycleCommand,
    clock: OriginalLifecycleClock,
    reclaim_window_ms: u64,
) -> Result<Receipt, CoreError> {
    if context.author_kind != AuthorKind::Human {
        return Err(CoreError::OriginalLifecycleHumanOnly);
    }
    validate_command(command)?;
    if clock.epoch_id.is_nil()
        || clock.wall_ms < 0
        || clock.elapsed_ms > i64::MAX as u64
        || reclaim_window_ms > i64::MAX as u64
    {
        return Err(CoreError::InvalidOriginalLifecycleCommand);
    }
    let reclaim_window_i64 = reclaim_window_ms as i64;
    manifest_and_reference(transaction, command.profile_id, command.original_id)?;
    if command.follow_up_device_ids.contains(&context.device_id) {
        return Err(CoreError::InvalidOriginalLifecycleCommand);
    }
    let input_digest = command_digest(command)?;
    let prior: Option<(String, String)> = transaction
        .query_row(
            "SELECT input_digest,receipt FROM command_receipts WHERE command_id=?1",
            [command.command_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((digest, receipt)) = prior {
        let same_profile: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM command_receipts WHERE command_id=?1 AND profile_id=?2)",
            params![
                command.command_id.to_string(),
                command.profile_id.to_string()
            ],
            |row| row.get(0),
        )?;
        if !same_profile || digest != input_digest {
            return Err(CoreError::CommandConflict);
        }
        let mut receipt: Receipt = serde_json::from_str(&receipt)?;
        receipt.replayed = true;
        return Ok(receipt);
    }

    let previous = current_state(transaction, command.profile_id, command.original_id)?;
    if previous.generation != command.expected_generation {
        return Err(CoreError::OriginalLifecycleConflict);
    }
    if let Some(request) = command.responds_to_event_id {
        let follows: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM original_lifecycle_followups WHERE event_id=?1 AND profile_id=?2 AND original_id=?3 AND target_device_id=?4)",
            params![request.to_string(), command.profile_id.to_string(), command.original_id.to_string(), context.device_id.to_string()],
            |row| row.get(0),
        )?;
        if !follows {
            return Err(CoreError::OriginalLifecycleConflict);
        }
        let already_answered: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM original_lifecycle_followup_responses WHERE request_event_id=?1 AND target_device_id=?2)",
            params![request.to_string(), context.device_id.to_string()],
            |row| row.get(0),
        )?;
        if already_answered {
            return Err(CoreError::OriginalLifecycleConflict);
        }
    }
    let generation = next_generation(previous.generation)?;
    let (new_state, fact_action, restore, reclaim_clock, recovery_window_ms, reclaim_deadline_ms) =
        match command.action {
            OriginalLifecycleAction::Reclaim => {
                if previous.state != OriginalBytesState::Available {
                    return Err(CoreError::OriginalLifecycleConflict);
                }
                let deadline = clock
                    .wall_ms
                    .checked_add(reclaim_window_i64)
                    .ok_or(CoreError::InvalidOriginalLifecycleCommand)?;
                (
                    OriginalBytesState::Reclaimed,
                    "reclaim",
                    None,
                    Some(clock),
                    Some(reclaim_window_ms),
                    Some(deadline),
                )
            }
            OriginalLifecycleAction::Restore => match previous.state {
                OriginalBytesState::Reclaimed => (
                    OriginalBytesState::Available,
                    "restore_completed",
                    None,
                    None,
                    None,
                    None,
                ),
                OriginalBytesState::Released
                | OriginalBytesState::Purged
                | OriginalBytesState::Missing => {
                    let completion = EventId::new();
                    (
                        OriginalBytesState::RestorePending,
                        "restore_requested",
                        Some((
                            command.event_id,
                            completion,
                            command.command_id,
                            context.author_id,
                            clock.wall_ms,
                        )),
                        None,
                        None,
                        None,
                    )
                }
                OriginalBytesState::Available | OriginalBytesState::RestorePending => {
                    return Err(CoreError::OriginalLifecycleConflict);
                }
            },
            OriginalLifecycleAction::ReleaseLocal => {
                if !matches!(
                    previous.state,
                    OriginalBytesState::Available | OriginalBytesState::Reclaimed
                ) {
                    return Err(CoreError::OriginalLifecycleConflict);
                }
                (
                    OriginalBytesState::Released,
                    "release_local",
                    None,
                    None,
                    None,
                    None,
                )
            }
            OriginalLifecycleAction::PurgeReclaimed => {
                if previous.state != OriginalBytesState::Reclaimed
                    || !reclaim_window_expired(&previous, clock)?
                {
                    return Err(CoreError::OriginalLifecycleConflict);
                }
                (
                    OriginalBytesState::Purged,
                    "purge_reclaimed",
                    None,
                    None,
                    None,
                    None,
                )
            }
        };
    let event_id = command.event_id;
    let record = make_record(
        context,
        command.command_id,
        event_id,
        command.original_id,
        fact_action,
        generation,
        clock.wall_ms,
        command.follow_up_device_ids.clone(),
        command.responds_to_event_id,
    )?;
    let local_seq = insert_fact(transaction, context, &record)?;

    if matches!(
        command.action,
        OriginalLifecycleAction::ReleaseLocal | OriginalLifecycleAction::PurgeReclaimed
    ) {
        let stage: Option<String> = transaction
            .query_row(
                "SELECT stage_id FROM original_stages WHERE original_id=?1 AND profile_id=?2 AND state='verified' AND next_offset=byte_length",
                params![command.original_id.to_string(), command.profile_id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        let stage = stage.ok_or(CoreError::OriginalLifecycleConflict)?;
        transaction.execute(
            "UPDATE original_stages SET state='uploading',next_offset=0,generation=generation+1 WHERE stage_id=?1 AND profile_id=?2 AND state='verified'",
            params![stage, command.profile_id.to_string()],
        )?;
        if transaction.changes() != 1 {
            return Err(CoreError::OriginalLifecycleConflict);
        }
    }

    set_local_state(
        transaction,
        command.profile_id,
        command.original_id,
        generation,
        new_state,
        event_id,
        restore,
        reclaim_clock,
        recovery_window_ms,
        reclaim_deadline_ms,
    )?;

    if matches!(
        command.action,
        OriginalLifecycleAction::ReleaseLocal | OriginalLifecycleAction::PurgeReclaimed
    ) {
        let stage: String = transaction.query_row(
            "SELECT stage_id FROM original_stages WHERE original_id=?1 AND profile_id=?2",
            params![
                command.original_id.to_string(),
                command.profile_id.to_string()
            ],
            |row| row.get(0),
        )?;
        let action = if command.action == OriginalLifecycleAction::ReleaseLocal {
            "release_local"
        } else {
            "purge_reclaimed"
        };
        transaction.execute(
            "INSERT INTO original_lifecycle_delete_gate(stage_id,event_id,profile_id,original_id,generation,action) VALUES(?1,?2,?3,?4,?5,?6)",
            params![stage, event_id.to_string(), command.profile_id.to_string(), command.original_id.to_string(), generation, action],
        )?;
        transaction.execute("DELETE FROM original_chunks WHERE stage_id=?1", [&stage])?;
        transaction.execute(
            "DELETE FROM original_lifecycle_delete_gate WHERE stage_id=?1 AND event_id=?2",
            params![stage, event_id.to_string()],
        )?;
    }

    let receipt = Receipt {
        command_id: command.command_id,
        event_id,
        profile_id: command.profile_id,
        local_seq,
        event_digest: record.digest,
        durability: Durability::LocalCommitted,
        replayed: false,
    };
    transaction.execute(
        "INSERT INTO command_receipts(command_id,profile_id,input_digest,receipt) VALUES(?1,?2,?3,?4)",
        params![
            command.command_id.to_string(),
            command.profile_id.to_string(),
            input_digest,
            serde_json::to_string(&receipt)?
        ],
    )?;
    Ok(receipt)
}

pub(crate) fn complete_restore(
    transaction: &Transaction<'_>,
    context: &WriterContext,
    original: OriginalId,
) -> Result<bool, CoreError> {
    let pending = current_state(transaction, context.profile_id, original)?;
    if pending.state != OriginalBytesState::RestorePending {
        return Ok(false);
    }
    let request = pending
        .restore_request_event_id
        .ok_or(CoreError::RecoveryRequired)?;
    let completion = pending
        .restore_completion_event_id
        .ok_or(CoreError::RecoveryRequired)?;
    let command = pending
        .restore_command_id
        .ok_or(CoreError::RecoveryRequired)?;
    let author = pending
        .restore_author_id
        .ok_or(CoreError::RecoveryRequired)?;
    let occurred = pending
        .restore_occurred_at_ms
        .ok_or(CoreError::RecoveryRequired)?;
    if author != context.author_id || context.author_kind != AuthorKind::Human {
        return Err(CoreError::OriginalLifecycleHumanOnly);
    }
    let generation = next_generation(pending.generation)?;
    let record = make_record(
        context,
        command,
        completion,
        original,
        "restore_completed",
        generation,
        now_ms().max(occurred),
        Vec::new(),
        Some(request),
    )?;
    insert_fact(transaction, context, &record)?;
    set_local_state(
        transaction,
        context.profile_id,
        original,
        generation,
        OriginalBytesState::Available,
        completion,
        None,
        None,
        None,
        None,
    )?;
    Ok(true)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

/// Creates and checks the schema-10 lifecycle projection and its one narrow
/// delete gate. Migration must preserve every original manifest and reference.
pub(crate) fn migrate_schema(transaction: &Transaction<'_>) -> Result<(), CoreError> {
    let trigger: Option<String> = transaction
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='original_chunks_no_delete'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if trigger.as_deref() != Some(OLD_CHUNK_DELETE_TRIGGER) {
        return Err(CoreError::RecoveryRequired);
    }
    transaction.execute_batch("DROP TRIGGER original_chunks_no_delete")?;
    for (_, _, sql) in OBJECTS {
        transaction.execute_batch(sql)?;
    }
    transaction.execute_batch(NEW_CHUNK_DELETE_TRIGGER)?;
    validate_schema(transaction)
}

pub(crate) fn validate_schema(connection: &Connection) -> Result<(), CoreError> {
    for (kind, name, expected) in OBJECTS {
        let actual: Option<Option<String>> = connection
            .query_row(
                "SELECT CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=4096 THEN sql END FROM sqlite_schema WHERE type=?1 AND name=?2",
                params![kind, name],
                |row| row.get(0),
            )
            .optional()?;
        if actual.flatten().as_deref() != Some(*expected) {
            return Err(CoreError::RecoveryRequired);
        }
    }
    let trigger: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='original_chunks_no_delete'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if trigger.as_deref() != Some(NEW_CHUNK_DELETE_TRIGGER) {
        return Err(CoreError::RecoveryRequired);
    }
    let gate_rows: i64 = connection.query_row(
        "SELECT (SELECT count(*) FROM original_lifecycle_delete_gate)+(SELECT count(*) FROM original_lifecycle_restore_retry_gate)",
        [],
        |row| row.get(0),
    )?;
    if gate_rows != 0 {
        return Err(CoreError::RecoveryRequired);
    }
    Ok(())
}

pub(crate) fn index_followups(
    transaction: &Transaction<'_>,
    record: &OriginalLifecycleRecord,
) -> Result<(), CoreError> {
    let local_seq: i64 = transaction.query_row(
        "SELECT local_seq FROM events WHERE event_id=?1 AND profile_id=?2 AND kind='orig_lifecycle/1'",
        params![record.event_id.to_string(), record.profile_id.to_string()],
        |row| row.get(0),
    )?;
    if local_seq <= 0 {
        return Err(CoreError::RecoveryRequired);
    }
    for device in &record.follow_up_device_ids {
        transaction.execute(
            "INSERT INTO original_lifecycle_followups(event_id,profile_id,original_id,target_device_id,local_seq) VALUES(?1,?2,?3,?4,?5)",
            params![
                record.event_id.to_string(),
                record.profile_id.to_string(),
                record.original_id.to_string(),
                device.to_string(),
                local_seq
            ],
        )?;
        let already_answered: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM original_lifecycle_followup_responses WHERE request_event_id=?1 AND target_device_id=?2 AND profile_id=?3)",
            params![record.event_id.to_string(), device.to_string(), record.profile_id.to_string()],
            |row| row.get(0),
        )?;
        if !already_answered {
            transaction.execute(
                "INSERT INTO original_lifecycle_followups_pending(event_id,target_device_id,profile_id,local_seq) VALUES(?1,?2,?3,?4)",
                params![record.event_id.to_string(), device.to_string(), record.profile_id.to_string(), local_seq],
            )?;
        }
    }
    if record.action == "release_local" {
        if let Some(request) = record.responds_to_event_id {
            let target = record.device_id.to_string();
            transaction.execute(
                "INSERT INTO original_lifecycle_followup_responses(response_event_id,request_event_id,target_device_id,profile_id,original_id) VALUES(?1,?2,?3,?4,?5)",
                params![
                    record.event_id.to_string(),
                    request.to_string(),
                    target,
                    record.profile_id.to_string(),
                    record.original_id.to_string()
                ],
            )?;
            transaction.execute(
                "DELETE FROM original_lifecycle_followups_pending WHERE event_id=?1 AND target_device_id=?2 AND profile_id=?3",
                params![request.to_string(), record.device_id.to_string(), record.profile_id.to_string()],
            )?;
        }
    }
    Ok(())
}

/// Imports build the follow-up index only. They never change this device's
/// projection or `original_chunks`.
pub(crate) fn index_imported_fact(
    transaction: &Transaction<'_>,
    record: &OriginalLifecycleRecord,
) -> Result<(), CoreError> {
    index_followups(transaction, record)
}

impl Core {
    pub fn original_lifecycle_status(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        original: OriginalId,
    ) -> Result<OriginalLifecycleStatus, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        status_from(&connection, profile, original)
    }

    pub fn apply_original_lifecycle(
        &self,
        context: &WriterContext,
        command: &OriginalLifecycleCommand,
    ) -> Result<Receipt, CoreError> {
        self.apply_original_lifecycle_with_policy(
            context,
            command,
            now_ms(),
            DEFAULT_ORIGINAL_RECLAIM_WINDOW_MS,
        )
    }

    /// Core-only/test policy path. A fresh epoch makes expiry use the trusted
    /// wall stamp, including after a simulated restart.
    pub fn apply_original_lifecycle_with_policy(
        &self,
        context: &WriterContext,
        command: &OriginalLifecycleCommand,
        trusted_now_ms: i64,
        reclaim_window_ms: u64,
    ) -> Result<Receipt, CoreError> {
        self.apply_original_lifecycle_with_clock(
            context,
            command,
            OriginalLifecycleClock {
                epoch_id: Uuid::new_v4(),
                wall_ms: trusted_now_ms,
                elapsed_ms: 0,
            },
            reclaim_window_ms,
        )
    }

    /// Host callers pass their full clock sample. The elapsed clock enforces
    /// the window while the epoch is live; the persisted wall deadline resumes
    /// it after restart. Expiry never triggers a purge by itself.
    pub fn apply_original_lifecycle_with_clock(
        &self,
        context: &WriterContext,
        command: &OriginalLifecycleCommand,
        clock: OriginalLifecycleClock,
        reclaim_window_ms: u64,
    ) -> Result<Receipt, CoreError> {
        self.check_scope(context, command.profile_id)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let receipt =
            apply_local_command(&transaction, context, command, clock, reclaim_window_ms)?;
        transaction.commit()?;
        Ok(receipt)
    }

    /// Checks a durable replay before Host revalidates optional peer targets.
    /// This keeps a repeated stable command idempotent after membership state
    /// changes without admitting a new release to a revoked target.
    pub fn original_lifecycle_replay(
        &self,
        context: &WriterContext,
        command: &OriginalLifecycleCommand,
    ) -> Result<Option<Receipt>, CoreError> {
        self.check_scope(context, command.profile_id)?;
        if context.author_kind != AuthorKind::Human {
            return Err(CoreError::OriginalLifecycleHumanOnly);
        }
        validate_command(command)?;
        let input_digest = command_digest(command)?;
        let connection = self.connection()?;
        let prior: Option<(String, String, String)> = connection
            .query_row(
                "SELECT profile_id,input_digest,receipt FROM command_receipts WHERE command_id=?1",
                [command.command_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((profile, digest, encoded_receipt)) = prior else {
            return Ok(None);
        };
        if profile != command.profile_id.to_string() || digest != input_digest {
            return Err(CoreError::CommandConflict);
        }
        let mut receipt: Receipt = serde_json::from_str(&encoded_receipt)?;
        receipt.replayed = true;
        Ok(Some(receipt))
    }

    pub fn begin_original_read(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        original: OriginalId,
    ) -> Result<OriginalReadPermit, CoreError> {
        self.check_scope(context, profile)?;
        let connection = self.connection()?;
        let status = status_from(&connection, profile, original)?;
        if !matches!(
            status.bytes_state,
            OriginalBytesState::Available | OriginalBytesState::Reclaimed
        ) {
            return Err(CoreError::OriginalNotReady);
        }
        Ok(OriginalReadPermit {
            core_lifecycle: self.lifecycle(),
            profile_id: profile,
            original_id: original,
            generation: status.generation,
        })
    }

    pub fn read_original_range_with_permit(
        &self,
        context: &WriterContext,
        permit: &OriginalReadPermit,
        offset: u64,
        length: usize,
    ) -> Result<crate::OriginalChunk, CoreError> {
        self.check_scope(context, permit.profile_id)?;
        if self.lifecycle() != permit.core_lifecycle {
            return Err(CoreError::ForeignContext);
        }
        let before =
            self.original_lifecycle_status(context, permit.profile_id, permit.original_id)?;
        if before.generation != permit.generation
            || !matches!(
                before.bytes_state,
                OriginalBytesState::Available | OriginalBytesState::Reclaimed
            )
        {
            return Err(CoreError::StaleOriginalRead);
        }
        let bytes = self.read_original_range(
            context,
            permit.profile_id,
            permit.original_id,
            offset,
            length,
        )?;
        let after =
            self.original_lifecycle_status(context, permit.profile_id, permit.original_id)?;
        if after.generation != permit.generation
            || !matches!(
                after.bytes_state,
                OriginalBytesState::Available | OriginalBytesState::Reclaimed
            )
        {
            return Err(CoreError::StaleOriginalRead);
        }
        Ok(bytes)
    }

    pub fn finish_original_read(
        &self,
        context: &WriterContext,
        permit: &OriginalReadPermit,
    ) -> Result<(), CoreError> {
        self.check_scope(context, permit.profile_id)?;
        if self.lifecycle() != permit.core_lifecycle {
            return Err(CoreError::ForeignContext);
        }
        let status =
            self.original_lifecycle_status(context, permit.profile_id, permit.original_id)?;
        if status.generation != permit.generation
            || !matches!(
                status.bytes_state,
                OriginalBytesState::Available | OriginalBytesState::Reclaimed
            )
        {
            return Err(CoreError::StaleOriginalRead);
        }
        Ok(())
    }

    pub fn original_lifecycle_followups(
        &self,
        context: &WriterContext,
        profile: ProfileId,
        target: DeviceId,
        after: Option<EventId>,
        limit: usize,
    ) -> Result<OriginalLifecycleFollowupPage, CoreError> {
        self.check_scope(context, profile)?;
        if limit == 0 || limit > 100 {
            return Err(CoreError::InvalidQuery(
                "original lifecycle follow-up limit",
            ));
        }
        let connection = self.connection()?;
        let after_seq = after
            .map(|event| {
                connection
                    .query_row(
                        "SELECT local_seq FROM original_lifecycle_followups WHERE event_id=?1 AND profile_id=?2 AND target_device_id=?3",
                        params![event.to_string(), profile.to_string(), target.to_string()],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .ok_or(CoreError::InvalidQuery("original lifecycle follow-up cursor"))
            })
            .transpose()?
            .unwrap_or(0);
        // The pending projection is indexed by target and local sequence, so
        // the page walks only unresolved candidates after this cursor.
        let mut statement = connection.prepare(
            "SELECT f.event_id,p.local_seq,e.body,EXISTS(SELECT 1 FROM original_manifests m JOIN event_originals r ON r.original_id=m.original_id JOIN events c ON c.event_id=r.event_id WHERE m.original_id=f.original_id AND m.profile_id=p.profile_id AND c.profile_id=p.profile_id) FROM original_lifecycle_followups_pending p JOIN original_lifecycle_followups f ON f.event_id=p.event_id AND f.target_device_id=p.target_device_id JOIN events e ON e.event_id=f.event_id WHERE p.profile_id=?1 AND p.target_device_id=?2 AND p.local_seq>?3 ORDER BY p.local_seq,p.event_id LIMIT ?4",
        )?;
        let rows = statement.query_map(
            params![
                profile.to_string(),
                target.to_string(),
                after_seq,
                limit + 1
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            },
        )?;
        let mut items = rows
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(id, sequence, body, manifest_known)| {
                let mut record: OriginalLifecycleRecord = serde_json::from_str(&body)?;
                if record.event_id.to_string() != id
                    || record.profile_id != profile
                    || !record.follow_up_device_ids.contains(&target)
                {
                    return Err(CoreError::RecoveryRequired);
                }
                record.validate()?;
                record.local_seq = sequence;
                Ok(OriginalLifecycleFollowup {
                    request: record,
                    resolution: if manifest_known {
                        OriginalLifecycleFollowupResolution::ManifestKnown
                    } else {
                        OriginalLifecycleFollowupResolution::Unresolved
                    },
                })
            })
            .collect::<Result<Vec<_>, CoreError>>()?;
        let has_more = items.len() > limit;
        items.truncate(limit);
        let next_after = has_more
            .then(|| items.last().map(|item| item.request.event_id))
            .flatten();
        Ok(OriginalLifecycleFollowupPage { items, next_after })
    }
}

#[cfg(test)]
#[path = "original_lifecycle_tests.rs"]
mod tests;
