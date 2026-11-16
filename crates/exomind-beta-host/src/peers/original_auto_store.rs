//! Local policy and durable download intent. No queue, wall-clock deadline,
//! remote permission or Core/original mutation lives in this store.
use crate::{BetaHost, HostError, Session};
use exomind_core::{OriginalId, ProfileId};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const MIN_ORIGINAL_AUTO_BYTES: u64 = 1024 * 1024;
pub const DEFAULT_ORIGINAL_AUTO_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_ORIGINAL_AUTO_BYTES: u64 = 256 * 1024 * 1024;
const LAYOUT: &str = "exomind-original-auto/1";
const OBJECTS: &[(&str, &str)] = &[
    (
        "peer_original_auto_revisions",
        "CREATE TABLE peer_original_auto_revisions(revision TEXT PRIMARY KEY CHECK(length(revision)=36))",
    ),
    (
        "peer_original_auto_policy",
        "CREATE TABLE peer_original_auto_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1),layout TEXT NOT NULL,revision TEXT NOT NULL UNIQUE REFERENCES peer_original_auto_revisions(revision),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),max_bytes INTEGER NOT NULL CHECK(max_bytes BETWEEN 1048576 AND 268435456),input_digest TEXT NOT NULL CHECK(length(input_digest)=64))",
    ),
    (
        "peer_original_auto_intents",
        "CREATE TABLE peer_original_auto_intents(profile_id TEXT NOT NULL CHECK(length(profile_id)=36),original_id TEXT NOT NULL CHECK(length(original_id)=36),intent_revision TEXT NOT NULL UNIQUE REFERENCES peer_original_auto_revisions(revision),suppression TEXT CHECK(suppression IN ('user_cancelled','local_released')),input_digest TEXT NOT NULL CHECK(length(input_digest)=64),PRIMARY KEY(profile_id,original_id))",
    ),
    (
        "peer_original_auto_backoff",
        "CREATE TABLE peer_original_auto_backoff(profile_id TEXT NOT NULL CHECK(length(profile_id)=36),original_id TEXT NOT NULL CHECK(length(original_id)=36),failures INTEGER NOT NULL CHECK(failures BETWEEN 1 AND 6),delay_ms INTEGER NOT NULL CHECK(delay_ms=CASE failures WHEN 1 THEN 2000 WHEN 2 THEN 4000 WHEN 3 THEN 8000 WHEN 4 THEN 16000 WHEN 5 THEN 30000 ELSE 60000 END),error_code TEXT NOT NULL CHECK(length(error_code) BETWEEN 1 AND 64),PRIMARY KEY(profile_id,original_id))",
    ),
];
fn recovery<T>(_: T) -> HostError {
    HostError::PeerSyncRecoveryRequired
}
fn unavailable<T>(_: T) -> HostError {
    HostError::PeerSyncUnavailable
}
fn digest(value: &impl Serialize) -> Result<String, HostError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(unavailable)?)
    ))
}
fn uuid(raw: &str) -> Result<Uuid, HostError> {
    let id = Uuid::parse_str(raw).map_err(recovery)?;
    if id.is_nil() {
        Err(HostError::PeerSyncRecoveryRequired)
    } else {
        Ok(id)
    }
}
fn sha(raw: &str) -> bool {
    raw.len() == 64
        && raw
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalAutoPolicy {
    pub revision: Uuid,
    pub enabled: bool,
    pub max_bytes: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalAutoPolicyCommand {
    pub command_id: Uuid,
    pub expected_revision: Uuid,
    pub enabled: bool,
    pub max_bytes: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalAutoSuppression {
    UserCancelled,
    LocalReleased,
}
impl OriginalAutoSuppression {
    fn label(self) -> &'static str {
        match self {
            Self::UserCancelled => "user_cancelled",
            Self::LocalReleased => "local_released",
        }
    }
    fn parse(raw: &str) -> Result<Self, HostError> {
        match raw {
            "user_cancelled" => Ok(Self::UserCancelled),
            "local_released" => Ok(Self::LocalReleased),
            _ => Err(HostError::PeerSyncRecoveryRequired),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalLocalIntent {
    pub profile_id: ProfileId,
    pub original_id: OriginalId,
    pub intent_revision: Option<Uuid>,
    pub suppression: Option<OriginalAutoSuppression>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginalAutoSuppressionCommand {
    pub command_id: Uuid,
    pub expected_intent_revision: Option<Uuid>,
    pub suppression: Option<OriginalAutoSuppression>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
/// On runtime restoration the caller must arm a NEW monotonic wait of this
/// entire delay once, rather than treating a saved wall timestamp as overdue.
pub struct OriginalAutoBackoff {
    pub profile_id: ProfileId,
    pub original_id: OriginalId,
    pub failures: u32,
    pub delay_ms: u64,
    pub last_error_code: Option<String>,
}

pub(super) fn absent(c: &Connection) -> Result<(), HostError> {
    let n: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name GLOB 'peer_original_auto_*'",
            [],
            |r| r.get(0),
        )
        .map_err(unavailable)?;
    if n != 0 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(())
}
pub(super) fn create(c: &Connection) -> Result<(), HostError> {
    absent(c)?;
    for (_, sql) in OBJECTS {
        c.execute_batch(sql).map_err(unavailable)?;
    }
    let revision = Uuid::new_v4();
    c.execute(
        "INSERT INTO peer_original_auto_revisions VALUES(?1)",
        [revision.to_string()],
    )
    .map_err(unavailable)?;
    c.execute(
        "INSERT INTO peer_original_auto_policy VALUES(1,?1,?2,1,?3,?4)",
        params![
            LAYOUT,
            revision.to_string(),
            DEFAULT_ORIGINAL_AUTO_BYTES,
            digest(&("original-auto-default/1", true, DEFAULT_ORIGINAL_AUTO_BYTES))?
        ],
    )
    .map_err(unavailable)?;
    validate(c)
}
pub(super) fn validate(c: &Connection) -> Result<(), HostError> {
    for (name, sql) in OBJECTS {
        let actual:Option<Option<String>>=c.query_row("SELECT CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=2048 THEN sql END FROM sqlite_schema WHERE type='table' AND name=?1",[name],|r|r.get(0)).optional().map_err(unavailable)?;
        if actual.flatten().as_deref() != Some(*sql) {
            return Err(HostError::PeerSyncRecoveryRequired);
        }
    }
    let count: i64 = c
        .query_row("SELECT count(*) FROM peer_original_auto_policy", [], |r| {
            r.get(0)
        })
        .map_err(unavailable)?;
    if count != 1 {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    let(layout,revision,enabled,max_bytes,input):(Option<String>,Option<String>,i64,u64,Option<String>)=c.query_row("SELECT CASE WHEN typeof(layout)='text' AND length(layout)<=64 THEN layout END,CASE WHEN typeof(revision)='text' AND length(revision)=36 THEN revision END,enabled,max_bytes,CASE WHEN typeof(input_digest)='text' AND length(input_digest)=64 THEN input_digest END FROM peer_original_auto_policy WHERE singleton=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(recovery)?;
    let layout = layout.ok_or(HostError::PeerSyncRecoveryRequired)?;
    let revision = revision.ok_or(HostError::PeerSyncRecoveryRequired)?;
    let input = input.ok_or(HostError::PeerSyncRecoveryRequired)?;
    if layout != LAYOUT
        || !(0..=1).contains(&enabled)
        || !(MIN_ORIGINAL_AUTO_BYTES..=MAX_ORIGINAL_AUTO_BYTES).contains(&max_bytes)
        || !sha(&input)
    {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    uuid(&revision)?;
    let missing: bool = c
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM peer_original_auto_revisions WHERE revision=?1)",
            [revision],
            |r| r.get(0),
        )
        .map_err(unavailable)?;
    if missing {
        return Err(HostError::PeerSyncRecoveryRequired);
    }
    Ok(())
}
fn policy_raw(c: &Connection) -> Result<(OriginalAutoPolicy, String), HostError> {
    validate(c)?;
    let(revision,enabled,max_bytes,input):(String,bool,u64,String)=c.query_row("SELECT revision,enabled,max_bytes,input_digest FROM peer_original_auto_policy WHERE singleton=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(recovery)?;
    Ok((
        OriginalAutoPolicy {
            revision: uuid(&revision)?,
            enabled,
            max_bytes,
        },
        input,
    ))
}
pub(super) fn policy(c: &Connection) -> Result<OriginalAutoPolicy, HostError> {
    Ok(policy_raw(c)?.0)
}
fn intent_raw(
    c: &Connection,
    p: ProfileId,
    id: OriginalId,
) -> Result<(OriginalLocalIntent, Option<String>), HostError> {
    validate(c)?;
    let row:Option<(Option<String>,Option<String>,Option<String>)>=c.query_row("SELECT CASE WHEN typeof(intent_revision)='text' AND length(intent_revision)=36 THEN intent_revision END,CASE WHEN suppression IS NULL OR (typeof(suppression)='text' AND length(suppression)<=32) THEN suppression ELSE 'invalid' END,CASE WHEN typeof(input_digest)='text' AND length(input_digest)=64 THEN input_digest END FROM peer_original_auto_intents WHERE profile_id=?1 AND original_id=?2",params![p.to_string(),id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(unavailable)?;
    let (revision, suppression, input) = match row {
        Some((revision, suppression, input)) => {
            let revision = revision.ok_or(HostError::PeerSyncRecoveryRequired)?;
            let input = input.ok_or(HostError::PeerSyncRecoveryRequired)?;
            if !sha(&input) {
                return Err(HostError::PeerSyncRecoveryRequired);
            }
            let exists: bool = c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM peer_original_auto_revisions WHERE revision=?1)",
                    [&revision],
                    |r| r.get(0),
                )
                .map_err(unavailable)?;
            if !exists {
                return Err(HostError::PeerSyncRecoveryRequired);
            }
            (
                Some(uuid(&revision)?),
                suppression
                    .as_deref()
                    .map(OriginalAutoSuppression::parse)
                    .transpose()?,
                Some(input),
            )
        }
        None => (None, None, None),
    };
    Ok((
        OriginalLocalIntent {
            profile_id: p,
            original_id: id,
            intent_revision: revision,
            suppression,
        },
        input,
    ))
}
pub(super) fn intent(
    c: &Connection,
    p: ProfileId,
    id: OriginalId,
) -> Result<OriginalLocalIntent, HostError> {
    Ok(intent_raw(c, p, id)?.0)
}
fn unused_revision(c: &Connection, id: Uuid) -> Result<(), HostError> {
    if id.is_nil() {
        return Err(HostError::InvalidRequest);
    }
    let used: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM peer_original_auto_revisions WHERE revision=?1)",
            [id.to_string()],
            |r| r.get(0),
        )
        .map_err(unavailable)?;
    if used {
        return Err(HostError::PeerMembershipConflict);
    }
    Ok(())
}
fn save_policy(
    c: &Connection,
    command: &OriginalAutoPolicyCommand,
) -> Result<OriginalAutoPolicy, HostError> {
    if command.command_id.is_nil()
        || command.expected_revision.is_nil()
        || !(MIN_ORIGINAL_AUTO_BYTES..=MAX_ORIGINAL_AUTO_BYTES).contains(&command.max_bytes)
    {
        return Err(HostError::InvalidRequest);
    }
    let input = digest(&("original-auto-policy/1", command))?;
    let (prior, old_input) = policy_raw(c)?;
    if prior.revision == command.command_id {
        return if old_input == input {
            Ok(prior)
        } else {
            Err(HostError::PeerMembershipConflict)
        };
    }
    if prior.revision != command.expected_revision {
        return Err(HostError::PeerMembershipConflict);
    }
    unused_revision(c, command.command_id)?;
    c.execute(
        "INSERT INTO peer_original_auto_revisions VALUES(?1)",
        [command.command_id.to_string()],
    )
    .map_err(unavailable)?;
    c.execute("UPDATE peer_original_auto_policy SET revision=?1,enabled=?2,max_bytes=?3,input_digest=?4 WHERE singleton=1",params![command.command_id.to_string(),command.enabled,command.max_bytes,input]).map_err(unavailable)?;
    policy(c)
}
pub(super) fn save_intent(
    c: &Connection,
    p: ProfileId,
    id: OriginalId,
    command: &OriginalAutoSuppressionCommand,
) -> Result<OriginalLocalIntent, HostError> {
    if command.command_id.is_nil()
        || command
            .expected_intent_revision
            .is_some_and(|id| id.is_nil())
    {
        return Err(HostError::InvalidRequest);
    }
    let input = digest(&("original-auto-intent/1", p, id, command))?;
    let (prior, old_input) = intent_raw(c, p, id)?;
    if prior.intent_revision == Some(command.command_id) {
        return if old_input.as_deref() == Some(input.as_str()) {
            Ok(prior)
        } else {
            Err(HostError::PeerMembershipConflict)
        };
    }
    if prior.intent_revision != command.expected_intent_revision {
        return Err(HostError::PeerMembershipConflict);
    }
    unused_revision(c, command.command_id)?;
    c.execute(
        "INSERT INTO peer_original_auto_revisions VALUES(?1)",
        [command.command_id.to_string()],
    )
    .map_err(unavailable)?;
    c.execute("INSERT INTO peer_original_auto_intents VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id,original_id) DO UPDATE SET intent_revision=excluded.intent_revision,suppression=excluded.suppression,input_digest=excluded.input_digest",params![p.to_string(),id.to_string(),command.command_id.to_string(),command.suppression.map(OriginalAutoSuppression::label),input]).map_err(unavailable)?;
    intent(c, p, id)
}
/// Final store-side predicate. Runtime/channel/member qualification remains
/// mandatory in the caller's SAME Host gate; this grants no peer capability.
pub(super) fn eligible(
    c: &Connection,
    p: ProfileId,
    id: OriginalId,
    bytes: u64,
    policy_revision: Uuid,
    intent_revision: Option<Uuid>,
) -> Result<bool, HostError> {
    let policy = policy(c)?;
    let intent = intent(c, p, id)?;
    Ok(super::network_store::settings(c)?.enabled
        && policy.enabled
        && policy.revision == policy_revision
        && bytes <= policy.max_bytes
        && intent.intent_revision == intent_revision
        && intent.suppression.is_none())
}
pub(super) fn backoff(
    c: &Connection,
    p: ProfileId,
    id: OriginalId,
) -> Result<OriginalAutoBackoff, HostError> {
    validate(c)?;
    let row:Option<(u32,u64,Option<String>)>=c.query_row("SELECT failures,delay_ms,CASE WHEN typeof(error_code)='text' AND length(error_code) BETWEEN 1 AND 64 THEN error_code END FROM peer_original_auto_backoff WHERE profile_id=?1 AND original_id=?2",params![p.to_string(),id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(unavailable)?;
    let (failures, delay_ms, last_error_code) = match row {
        Some((failures, delay, code)) => {
            let code = code.ok_or(HostError::PeerSyncRecoveryRequired)?;
            let expected = delay_for(failures)?;
            if expected != delay || !error_code(&code) {
                return Err(HostError::PeerSyncRecoveryRequired);
            }
            (failures, delay, Some(code))
        }
        None => (0, 0, None),
    };
    Ok(OriginalAutoBackoff {
        profile_id: p,
        original_id: id,
        failures,
        delay_ms,
        last_error_code,
    })
}
fn error_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 64
        && code
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
fn delay_for(failures: u32) -> Result<u64, HostError> {
    match failures {
        1 => Ok(2000),
        2 => Ok(4000),
        3 => Ok(8000),
        4 => Ok(16000),
        5 => Ok(30000),
        6 => Ok(60000),
        _ => Err(HostError::PeerSyncRecoveryRequired),
    }
}
pub(super) fn note_failure(
    c: &Connection,
    p: ProfileId,
    id: OriginalId,
    code: &str,
    bytes: u64,
    policy_revision: Uuid,
    intent_revision: Option<Uuid>,
) -> Result<Option<OriginalAutoBackoff>, HostError> {
    if !error_code(code) {
        return Err(HostError::InvalidRequest);
    }
    if !eligible(c, p, id, bytes, policy_revision, intent_revision)? {
        return Ok(None);
    }
    let failures = backoff(c, p, id)?.failures.saturating_add(1).min(6);
    let delay = delay_for(failures)?;
    c.execute("INSERT INTO peer_original_auto_backoff VALUES(?1,?2,?3,?4,?5) ON CONFLICT(profile_id,original_id) DO UPDATE SET failures=excluded.failures,delay_ms=excluded.delay_ms,error_code=excluded.error_code",params![p.to_string(),id.to_string(),failures,delay,code]).map_err(unavailable)?;
    backoff(c, p, id).map(Some)
}
/// Clear derived retry state only. A verified/manual success must never erase
/// the independent permanent intent row or its revision history.
pub(super) fn clear_backoff(c: &Connection, p: ProfileId, id: OriginalId) -> Result<(), HostError> {
    validate(c)?;
    c.execute(
        "DELETE FROM peer_original_auto_backoff WHERE profile_id=?1 AND original_id=?2",
        params![p.to_string(), id.to_string()],
    )
    .map_err(unavailable)?;
    Ok(())
}

impl BetaHost {
    pub fn original_auto_policy(&self, owner: &Session) -> Result<OriginalAutoPolicy, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let r = crate::resources(&state)?;
        super::membership_store::validate(&r.persistence.auth)?;
        policy(&r.persistence.auth)
    }
    pub fn configure_original_auto_policy(
        &self,
        owner: &Session,
        command: &OriginalAutoPolicyCommand,
    ) -> Result<OriginalAutoPolicy, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        let tx = super::membership_store::transaction(&mut r.persistence.auth)?;
        let value = save_policy(&tx, command)?;
        tx.commit().map_err(unavailable)?;
        Ok(value)
    }
    pub fn original_local_intent(
        &self,
        owner: &Session,
        p: ProfileId,
        id: OriginalId,
    ) -> Result<OriginalLocalIntent, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let r = crate::resources(&state)?;
        r.core
            .original_availability(&r.core.local_human(p)?, p, id)?;
        super::membership_store::validate(&r.persistence.auth)?;
        intent(&r.persistence.auth, p, id)
    }
    pub fn configure_original_auto_suppression(
        &self,
        owner: &Session,
        p: ProfileId,
        id: OriginalId,
        command: &OriginalAutoSuppressionCommand,
    ) -> Result<OriginalLocalIntent, HostError> {
        let mut state = self.active_state()?;
        self.owner(owner)?;
        let r = state.resources.as_mut().ok_or(HostError::Stopped)?;
        r.core
            .original_availability(&r.core.local_human(p)?, p, id)?;
        let tx = super::membership_store::transaction(&mut r.persistence.auth)?;
        let value = save_intent(&tx, p, id, command)?;
        tx.commit().map_err(unavailable)?;
        Ok(value)
    }
    pub fn original_auto_backoff(
        &self,
        owner: &Session,
        p: ProfileId,
        id: OriginalId,
    ) -> Result<OriginalAutoBackoff, HostError> {
        let state = self.active_state()?;
        self.owner(owner)?;
        let r = crate::resources(&state)?;
        r.core
            .original_availability(&r.core.local_human(p)?, p, id)?;
        super::membership_store::validate(&r.persistence.auth)?;
        backoff(&r.persistence.auth, p, id)
    }
}

#[cfg(test)]
#[path = "original_auto_store_tests.rs"]
mod tests;
