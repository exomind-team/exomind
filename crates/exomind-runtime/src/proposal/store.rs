use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use thiserror::Error;

use crate::proposal::{
    ActionType, AppendEventParams, ApproveAgentAccessParams, Comment, CreateTaskParams, Proposal,
    ProposalRef, ProposalStatus, Publisher, StartTimeblockParams,
};

const DEFAULT_SCOPE_KEY: &str = "anonymous";

#[derive(Debug, Clone)]
pub struct CreateProposalInput {
    pub title: String,
    pub body: String,
    pub action_type: ActionType,
    pub action_params: Value,
    pub references: Vec<ProposalRef>,
    pub publisher: Publisher,
}

#[derive(Debug, Clone, Default)]
pub struct ProposalFilter {
    pub status: Option<ProposalStatus>,
    pub action_type: Option<ActionType>,
}

#[derive(Debug, Error)]
pub enum ProposalStoreError {
    #[error("proposal not found: {0}")]
    NotFound(u64),
    #[error("proposal title must not be empty")]
    InvalidTitle,
    #[error("invalid publisher: {0}")]
    InvalidPublisher(String),
    #[error("invalid comment: {0}")]
    InvalidComment(String),
    #[error("invalid action params for {action_type:?}: {reason}")]
    InvalidActionParams {
        action_type: ActionType,
        reason: String,
    },
    #[error("invalid proposal status transition: {from:?} -> {to:?}")]
    InvalidStatusTransition {
        from: ProposalStatus,
        to: ProposalStatus,
    },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("time parse error: {0}")]
    TimeParse(#[from] chrono::ParseError),
}

pub struct ProposalStore {
    backend: ProposalStoreBackend,
}

enum ProposalStoreBackend {
    Memory(RwLock<MemoryProposalStore>),
    Sqlite(SqliteProposalStore),
}

#[derive(Default)]
struct MemoryProposalStore {
    next_id: u64,
    scopes: HashMap<String, BTreeMap<u64, Proposal>>,
}

struct SqliteProposalStore {
    _path: PathBuf,
    connection: Mutex<Connection>,
}

impl Default for ProposalStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ProposalStore {
    pub fn new() -> Self {
        Self {
            backend: ProposalStoreBackend::Memory(RwLock::new(MemoryProposalStore::default())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, ProposalStoreError> {
        Ok(Self {
            backend: ProposalStoreBackend::Sqlite(SqliteProposalStore::open(path)?),
        })
    }

    pub fn create(&self, input: CreateProposalInput) -> Result<Proposal, ProposalStoreError> {
        self.create_scoped(None, input)
    }

    pub fn create_scoped(
        &self,
        scope_key: Option<&str>,
        input: CreateProposalInput,
    ) -> Result<Proposal, ProposalStoreError> {
        validate_title(&input.title)?;
        validate_publisher(&input.publisher)?;
        validate_action_params(input.action_type, &input.action_params)?;

        let normalized_scope = normalize_scope_key(scope_key);
        match &self.backend {
            ProposalStoreBackend::Memory(state) => {
                let mut state = match state.write() {
                    Ok(lock) => lock,
                    Err(poisoned) => poisoned.into_inner(),
                };
                let now = Utc::now();
                state.next_id = state.next_id.saturating_add(1).max(1);
                let proposal = Proposal {
                    id: state.next_id,
                    title: input.title,
                    body: input.body,
                    action_type: input.action_type,
                    action_params: input.action_params,
                    references: input.references,
                    status: ProposalStatus::Pending,
                    publisher: input.publisher,
                    comments: Vec::new(),
                    snooze_until: None,
                    created_at: now,
                    updated_at: now,
                };
                state
                    .scopes
                    .entry(normalized_scope.to_string())
                    .or_default()
                    .insert(proposal.id, proposal.clone());
                Ok(proposal)
            }
            ProposalStoreBackend::Sqlite(store) => store.create_scoped(normalized_scope, input),
        }
    }

    pub fn list(&self, filter: &ProposalFilter) -> Result<Vec<Proposal>, ProposalStoreError> {
        self.list_scoped(None, filter)
    }

    pub fn list_scoped(
        &self,
        scope_key: Option<&str>,
        filter: &ProposalFilter,
    ) -> Result<Vec<Proposal>, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        let mut items = match &self.backend {
            ProposalStoreBackend::Memory(state) => {
                let state = match state.read() {
                    Ok(lock) => lock,
                    Err(poisoned) => poisoned.into_inner(),
                };
                state
                    .scopes
                    .get(normalized_scope)
                    .map(|scope| scope.values().cloned().collect())
                    .unwrap_or_default()
            }
            ProposalStoreBackend::Sqlite(store) => store.list_scoped(normalized_scope)?,
        };

        if let Some(status) = filter.status {
            items.retain(|proposal| proposal.status == status);
        }
        if let Some(action_type) = filter.action_type {
            items.retain(|proposal| proposal.action_type == action_type);
        }

        items.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(items)
    }

    pub fn get(&self, id: u64) -> Result<Option<Proposal>, ProposalStoreError> {
        self.get_scoped(None, id)
    }

    pub fn get_scoped(
        &self,
        scope_key: Option<&str>,
        id: u64,
    ) -> Result<Option<Proposal>, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        match &self.backend {
            ProposalStoreBackend::Memory(state) => {
                let state = match state.read() {
                    Ok(lock) => lock,
                    Err(poisoned) => poisoned.into_inner(),
                };
                Ok(state
                    .scopes
                    .get(normalized_scope)
                    .and_then(|scope| scope.get(&id))
                    .cloned())
            }
            ProposalStoreBackend::Sqlite(store) => store.get_scoped(normalized_scope, id),
        }
    }

    pub fn update_status(
        &self,
        id: u64,
        status: ProposalStatus,
        snooze_until: Option<DateTime<Utc>>,
    ) -> Result<Proposal, ProposalStoreError> {
        self.update_status_scoped(None, id, status, snooze_until)
    }

    pub fn update_status_scoped(
        &self,
        scope_key: Option<&str>,
        id: u64,
        status: ProposalStatus,
        snooze_until: Option<DateTime<Utc>>,
    ) -> Result<Proposal, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        let mut proposal = self
            .get_scoped(scope_key, id)?
            .ok_or(ProposalStoreError::NotFound(id))?;

        validate_status_transition(proposal.status, status)?;

        proposal.status = status;
        proposal.snooze_until = if status == ProposalStatus::Snoozed {
            snooze_until.or(proposal.snooze_until.clone())
        } else {
            None
        };
        proposal.updated_at = Utc::now();
        self.save_scoped(normalized_scope, &proposal)?;
        Ok(proposal)
    }

    pub fn update_action_params(
        &self,
        id: u64,
        action_params: Value,
    ) -> Result<Proposal, ProposalStoreError> {
        self.update_action_params_scoped(None, id, action_params)
    }

    pub fn update_action_params_scoped(
        &self,
        scope_key: Option<&str>,
        id: u64,
        action_params: Value,
    ) -> Result<Proposal, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        let mut proposal = self
            .get_scoped(scope_key, id)?
            .ok_or(ProposalStoreError::NotFound(id))?;

        if proposal.status.is_terminal() {
            return Err(ProposalStoreError::InvalidStatusTransition {
                from: proposal.status,
                to: proposal.status,
            });
        }

        validate_action_params(proposal.action_type, &action_params)?;
        proposal.action_params = action_params;
        proposal.updated_at = Utc::now();
        self.save_scoped(normalized_scope, &proposal)?;
        Ok(proposal)
    }

    pub fn add_comment(&self, id: u64, comment: Comment) -> Result<Proposal, ProposalStoreError> {
        self.add_comment_scoped(None, id, comment)
    }

    pub fn add_comment_scoped(
        &self,
        scope_key: Option<&str>,
        id: u64,
        comment: Comment,
    ) -> Result<Proposal, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        validate_comment(&comment)?;
        let mut proposal = self
            .get_scoped(scope_key, id)?
            .ok_or(ProposalStoreError::NotFound(id))?;

        proposal.comments.push(comment);
        proposal.updated_at = Utc::now();
        self.save_scoped(normalized_scope, &proposal)?;
        Ok(proposal)
    }

    fn save_scoped(&self, scope_key: &str, proposal: &Proposal) -> Result<(), ProposalStoreError> {
        match &self.backend {
            ProposalStoreBackend::Memory(state) => {
                let mut state = match state.write() {
                    Ok(lock) => lock,
                    Err(poisoned) => poisoned.into_inner(),
                };
                state
                    .scopes
                    .entry(scope_key.to_string())
                    .or_default()
                    .insert(proposal.id, proposal.clone());
                Ok(())
            }
            ProposalStoreBackend::Sqlite(store) => store.save_scoped(scope_key, proposal),
        }
    }
}

impl SqliteProposalStore {
    fn open(path: &Path) -> Result<Self, ProposalStoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        let store = Self {
            _path: path.to_path_buf(),
            connection: Mutex::new(connection),
        };
        store.init()?;
        Ok(store)
    }

    fn create_scoped(
        &self,
        scope_key: &str,
        input: CreateProposalInput,
    ) -> Result<Proposal, ProposalStoreError> {
        let now = Utc::now();
        let id = {
            let connection = self.connection();
            connection.execute(
                "INSERT INTO proposals (
                    scope_key, title, body, action_type, action_params_json, references_json, status,
                    publisher_json, comments_json, snooze_until, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11)",
                params![
                    scope_key,
                    input.title,
                    input.body,
                    action_type_to_str(input.action_type),
                    serde_json::to_string(&input.action_params)?,
                    serde_json::to_string(&input.references)?,
                    proposal_status_to_str(ProposalStatus::Pending),
                    serde_json::to_string(&input.publisher)?,
                    serde_json::to_string(&Vec::<Comment>::new())?,
                    now.to_rfc3339(),
                    now.to_rfc3339(),
                ],
            )?;
            connection.last_insert_rowid() as u64
        };
        self.get_scoped(scope_key, id)?
            .ok_or(ProposalStoreError::NotFound(id))
    }

    fn list_scoped(&self, scope_key: &str) -> Result<Vec<Proposal>, ProposalStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, title, body, action_type, action_params_json, references_json, status,
                    publisher_json, comments_json, snooze_until, created_at, updated_at
             FROM proposals
             WHERE scope_key = ?1
             ORDER BY created_at DESC, id DESC",
        )?;

        let rows = statement.query_map(params![scope_key], map_proposal_row)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(ProposalStoreError::from)
    }

    fn get_scoped(&self, scope_key: &str, id: u64) -> Result<Option<Proposal>, ProposalStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, title, body, action_type, action_params_json, references_json, status,
                    publisher_json, comments_json, snooze_until, created_at, updated_at
             FROM proposals
             WHERE scope_key = ?1 AND id = ?2",
        )?;

        statement
            .query_row(params![scope_key, id], map_proposal_row)
            .optional()
            .map_err(ProposalStoreError::from)
    }

    fn save_scoped(&self, scope_key: &str, proposal: &Proposal) -> Result<(), ProposalStoreError> {
        let connection = self.connection();
        connection.execute(
            "INSERT INTO proposals (
                scope_key, id, title, body, action_type, action_params_json, references_json,
                status, publisher_json, comments_json, snooze_until, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
                scope_key = excluded.scope_key,
                title = excluded.title,
                body = excluded.body,
                action_type = excluded.action_type,
                action_params_json = excluded.action_params_json,
                references_json = excluded.references_json,
                status = excluded.status,
                publisher_json = excluded.publisher_json,
                comments_json = excluded.comments_json,
                snooze_until = excluded.snooze_until,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at",
            params![
                scope_key,
                proposal.id,
                proposal.title,
                proposal.body,
                action_type_to_str(proposal.action_type),
                serde_json::to_string(&proposal.action_params)?,
                serde_json::to_string(&proposal.references)?,
                proposal_status_to_str(proposal.status),
                serde_json::to_string(&proposal.publisher)?,
                serde_json::to_string(&proposal.comments)?,
                proposal.snooze_until.map(|value| value.to_rfc3339()),
                proposal.created_at.to_rfc3339(),
                proposal.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    fn init(&self) -> Result<(), ProposalStoreError> {
        let connection = self.connection();
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS proposals (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                scope_key          TEXT NOT NULL DEFAULT 'anonymous',
                title              TEXT NOT NULL,
                body               TEXT NOT NULL DEFAULT '',
                action_type        TEXT NOT NULL,
                action_params_json TEXT NOT NULL DEFAULT '{}',
                references_json    TEXT NOT NULL DEFAULT '[]',
                status             TEXT NOT NULL DEFAULT 'pending',
                publisher_json     TEXT NOT NULL DEFAULT '{}',
                comments_json      TEXT NOT NULL DEFAULT '[]',
                snooze_until       TEXT NULL,
                created_at         TEXT NOT NULL,
                updated_at         TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_proposals_scope_created
                ON proposals(scope_key, created_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_proposals_scope_status
                ON proposals(scope_key, status);",
        )?;
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn map_proposal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Proposal> {
    let action_type: String = row.get(3)?;
    let references_json: String = row.get(5)?;
    let status: String = row.get(6)?;
    let publisher_json: String = row.get(7)?;
    let comments_json: String = row.get(8)?;
    let snooze_until: Option<String> = row.get(9)?;
    let created_at: String = row.get(10)?;
    let updated_at: String = row.get(11)?;

    Ok(Proposal {
        id: row.get::<_, i64>(0)? as u64,
        title: row.get(1)?,
        body: row.get(2)?,
        action_type: parse_action_type(&action_type)?,
        action_params: serde_json::from_str::<Value>(&row.get::<_, String>(4)?)
            .map_err(to_sqlite_conversion_error)?,
        references: serde_json::from_str(&references_json).map_err(to_sqlite_conversion_error)?,
        status: parse_proposal_status(&status)?,
        publisher: serde_json::from_str(&publisher_json).map_err(to_sqlite_conversion_error)?,
        comments: serde_json::from_str(&comments_json).map_err(to_sqlite_conversion_error)?,
        snooze_until: snooze_until
            .map(|value| DateTime::parse_from_rfc3339(&value))
            .transpose()
            .map_err(to_sqlite_conversion_error)?
            .map(|value| value.with_timezone(&Utc)),
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(to_sqlite_conversion_error)?
            .with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)
            .map_err(to_sqlite_conversion_error)?
            .with_timezone(&Utc),
    })
}

fn normalize_scope_key(scope_key: Option<&str>) -> &str {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCOPE_KEY)
}

fn validate_title(title: &str) -> Result<(), ProposalStoreError> {
    if title.trim().is_empty() {
        return Err(ProposalStoreError::InvalidTitle);
    }
    Ok(())
}

fn validate_publisher(publisher: &Publisher) -> Result<(), ProposalStoreError> {
    if publisher.id.trim().is_empty() {
        return Err(ProposalStoreError::InvalidPublisher(
            "publisher.id must not be empty".to_string(),
        ));
    }
    if publisher.name.trim().is_empty() {
        return Err(ProposalStoreError::InvalidPublisher(
            "publisher.name must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn validate_comment(comment: &Comment) -> Result<(), ProposalStoreError> {
    validate_publisher(&comment.author)?;
    if comment.content.trim().is_empty() {
        return Err(ProposalStoreError::InvalidComment(
            "comment content must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn validate_action_params(
    action_type: ActionType,
    action_params: &Value,
) -> Result<(), ProposalStoreError> {
    match action_type {
        ActionType::CreateTask => {
            let params: CreateTaskParams =
                serde_json::from_value(action_params.clone()).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            if params.title.trim().is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "title must not be empty".to_string(),
                });
            }
        }
        ActionType::AppendEvent => {
            let params: AppendEventParams =
                serde_json::from_value(action_params.clone()).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            if params.content.trim().is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "content must not be empty".to_string(),
                });
            }
        }
        ActionType::StartTimeblock => {
            let params: StartTimeblockParams = serde_json::from_value(action_params.clone())
                .map_err(|error| ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: error.to_string(),
                })?;
            if params.name.trim().is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "name must not be empty".to_string(),
                });
            }
        }
        ActionType::ApproveAgentAccess => {
            let params: ApproveAgentAccessParams = serde_json::from_value(action_params.clone())
                .map_err(|error| ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: error.to_string(),
                })?;
            if params.agent_id.trim().is_empty() || params.profile_id.trim().is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "agent_id and profile_id must not be empty".to_string(),
                });
            }
        }
    }
    Ok(())
}

fn validate_status_transition(
    from: ProposalStatus,
    to: ProposalStatus,
) -> Result<(), ProposalStoreError> {
    if from.is_terminal() {
        return Err(ProposalStoreError::InvalidStatusTransition { from, to });
    }

    if from == ProposalStatus::InReview && to == ProposalStatus::InReview {
        return Err(ProposalStoreError::InvalidStatusTransition { from, to });
    }

    if from == to {
        return Ok(());
    }

    let is_valid = match from {
        ProposalStatus::Pending => matches!(
            to,
            ProposalStatus::InReview
                | ProposalStatus::Approved
                | ProposalStatus::Rejected
                | ProposalStatus::Snoozed
        ),
        ProposalStatus::InReview => matches!(
            to,
            ProposalStatus::Pending
                | ProposalStatus::Approved
                | ProposalStatus::Rejected
                | ProposalStatus::Snoozed
        ),
        ProposalStatus::Snoozed => matches!(
            to,
            ProposalStatus::Pending
                | ProposalStatus::InReview
                | ProposalStatus::Approved
                | ProposalStatus::Rejected
                | ProposalStatus::Snoozed
        ),
        ProposalStatus::Approved | ProposalStatus::Rejected => false,
    };

    if is_valid {
        Ok(())
    } else {
        Err(ProposalStoreError::InvalidStatusTransition { from, to })
    }
}

fn action_type_to_str(value: ActionType) -> &'static str {
    match value {
        ActionType::CreateTask => "create_task",
        ActionType::AppendEvent => "append_event",
        ActionType::StartTimeblock => "start_timeblock",
        ActionType::ApproveAgentAccess => "approve_agent_access",
    }
}

fn parse_action_type(value: &str) -> rusqlite::Result<ActionType> {
    match value {
        "create_task" => Ok(ActionType::CreateTask),
        "append_event" => Ok(ActionType::AppendEvent),
        "start_timeblock" => Ok(ActionType::StartTimeblock),
        "approve_agent_access" => Ok(ActionType::ApproveAgentAccess),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(format!(
                "invalid action_type value: {other}"
            ))),
        )),
    }
}

fn proposal_status_to_str(value: ProposalStatus) -> &'static str {
    match value {
        ProposalStatus::Pending => "pending",
        ProposalStatus::InReview => "in_review",
        ProposalStatus::Approved => "approved",
        ProposalStatus::Rejected => "rejected",
        ProposalStatus::Snoozed => "snoozed",
    }
}

fn parse_proposal_status(value: &str) -> rusqlite::Result<ProposalStatus> {
    match value {
        "pending" => Ok(ProposalStatus::Pending),
        "in_review" => Ok(ProposalStatus::InReview),
        "approved" => Ok(ProposalStatus::Approved),
        "rejected" => Ok(ProposalStatus::Rejected),
        "snoozed" => Ok(ProposalStatus::Snoozed),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(format!(
                "invalid proposal status value: {other}"
            ))),
        )),
    }
}

fn to_sqlite_conversion_error<E>(error: E) -> rusqlite::Error
where
    E: std::error::Error + Send + Sync + 'static,
{
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::proposal::{ActionType, ProposalStatus, Publisher, PublisherType};

    use super::{CreateProposalInput, ProposalFilter, ProposalStore};

    fn sample_input(title: &str) -> CreateProposalInput {
        CreateProposalInput {
            title: title.to_string(),
            body: "reason".to_string(),
            action_type: ActionType::CreateTask,
            action_params: serde_json::json!({ "title": title }),
            references: vec![],
            publisher: Publisher {
                publisher_type: PublisherType::Agent,
                id: "agent-test".to_string(),
                name: "Agent Test".to_string(),
            },
        }
    }

    #[test]
    fn creates_and_filters_memory_proposals() {
        let store = ProposalStore::new();
        let first = store.create(sample_input("First task")).unwrap();
        let second = store.create(sample_input("Second task")).unwrap();

        let listed = store.list(&ProposalFilter::default()).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, second.id);
        assert_eq!(listed[1].id, first.id);

        let approved = store
            .update_status(first.id, ProposalStatus::Approved, None)
            .unwrap();
        assert_eq!(approved.status, ProposalStatus::Approved);

        let filtered = store
            .list(&ProposalFilter {
                status: Some(ProposalStatus::Approved),
                action_type: None,
            })
            .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, first.id);
    }

    #[test]
    fn sqlite_store_persists_scope_and_terminal_protection() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("proposals.sqlite");
        let store = ProposalStore::with_sqlite_path(&sqlite_path).unwrap();
        let anonymous = store.create(sample_input("Anonymous")).unwrap();
        let scoped = store
            .create_scoped(Some("profile-a"), sample_input("Profile A"))
            .unwrap();

        assert!(store.get(anonymous.id).unwrap().is_some());
        assert!(
            store
                .get_scoped(Some("profile-a"), scoped.id)
                .unwrap()
                .is_some()
        );
        assert!(
            store
                .get_scoped(Some("profile-b"), scoped.id)
                .unwrap()
                .is_none()
        );

        store
            .update_status_scoped(Some("profile-a"), scoped.id, ProposalStatus::Approved, None)
            .unwrap();
        let conflict = store.update_action_params_scoped(
            Some("profile-a"),
            scoped.id,
            serde_json::json!({ "title": "Edited" }),
        );
        assert!(conflict.is_err());
    }
}
