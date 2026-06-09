use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::proposal::{
    ActionType, AppendEventParams, ApproveAgentAccessParams, Comment, CreateTaskParams,
    LegacyCreateTaskParams, Proposal, ProposalRef, ProposalStatus, Publisher, StartTimeblockParams,
    TaskProposalFields, UpdateTaskParams,
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
    NotFound(String),
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
    scopes: HashMap<String, BTreeMap<String, Proposal>>,
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
        mut input: CreateProposalInput,
    ) -> Result<Proposal, ProposalStoreError> {
        input.action_params = normalize_action_params(input.action_type, input.action_params)?;
        input.references =
            merge_action_references(input.action_type, &input.action_params, input.references)?;
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
                let proposal = Proposal {
                    id: generate_proposal_id(),
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
                    .insert(proposal.id.clone(), proposal.clone());
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

    pub fn get(&self, id: &str) -> Result<Option<Proposal>, ProposalStoreError> {
        self.get_scoped(None, id)
    }

    pub fn get_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
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
                    .and_then(|scope| scope.get(id))
                    .cloned())
            }
            ProposalStoreBackend::Sqlite(store) => store.get_scoped(normalized_scope, id),
        }
    }

    pub fn update_status(
        &self,
        id: &str,
        status: ProposalStatus,
        snooze_until: Option<DateTime<Utc>>,
    ) -> Result<Proposal, ProposalStoreError> {
        self.update_status_scoped(None, id, status, snooze_until)
    }

    pub fn update_status_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        status: ProposalStatus,
        snooze_until: Option<DateTime<Utc>>,
    ) -> Result<Proposal, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        let mut proposal = self
            .get_scoped(scope_key, id)?
            .ok_or_else(|| ProposalStoreError::NotFound(id.to_string()))?;

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
        id: &str,
        action_params: Value,
    ) -> Result<Proposal, ProposalStoreError> {
        self.update_action_params_scoped(None, id, action_params)
    }

    pub fn update_action_params_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        action_params: Value,
    ) -> Result<Proposal, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        let mut proposal = self
            .get_scoped(scope_key, id)?
            .ok_or_else(|| ProposalStoreError::NotFound(id.to_string()))?;

        if proposal.status.is_terminal() {
            return Err(ProposalStoreError::InvalidStatusTransition {
                from: proposal.status,
                to: proposal.status,
            });
        }

        let normalized_action_params =
            normalize_action_params(proposal.action_type, action_params)?;
        validate_action_params(proposal.action_type, &normalized_action_params)?;
        proposal.references = merge_action_references(
            proposal.action_type,
            &normalized_action_params,
            proposal.references,
        )?;
        proposal.action_params = normalized_action_params;
        proposal.updated_at = Utc::now();
        self.save_scoped(normalized_scope, &proposal)?;
        Ok(proposal)
    }

    pub fn add_comment(&self, id: &str, comment: Comment) -> Result<Proposal, ProposalStoreError> {
        self.add_comment_scoped(None, id, comment)
    }

    pub fn add_comment_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        comment: Comment,
    ) -> Result<Proposal, ProposalStoreError> {
        let normalized_scope = normalize_scope_key(scope_key);
        validate_comment(&comment)?;
        let mut proposal = self
            .get_scoped(scope_key, id)?
            .ok_or_else(|| ProposalStoreError::NotFound(id.to_string()))?;

        proposal.comments.push(comment);
        proposal.updated_at = Utc::now();
        self.save_scoped(normalized_scope, &proposal)?;
        Ok(proposal)
    }

    pub fn save_replica_scoped(
        &self,
        scope_key: Option<&str>,
        mut proposal: Proposal,
    ) -> Result<Proposal, ProposalStoreError> {
        proposal.action_params =
            normalize_action_params(proposal.action_type, proposal.action_params)?;
        proposal.references = merge_action_references(
            proposal.action_type,
            &proposal.action_params,
            proposal.references,
        )?;
        validate_action_params(proposal.action_type, &proposal.action_params)?;
        let normalized_scope = normalize_scope_key(scope_key);
        match &self.backend {
            ProposalStoreBackend::Memory(state) => {
                let mut state = match state.write() {
                    Ok(lock) => lock,
                    Err(poisoned) => poisoned.into_inner(),
                };
                state
                    .scopes
                    .entry(normalized_scope.to_string())
                    .or_default()
                    .insert(proposal.id.clone(), proposal.clone());
                Ok(proposal)
            }
            ProposalStoreBackend::Sqlite(store) => {
                store.save_scoped(normalized_scope, &proposal)?;
                Ok(proposal)
            }
        }
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
                    .insert(proposal.id.clone(), proposal.clone());
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
        let id = generate_proposal_id();
        let proposal = Proposal {
            id,
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
        let connection = self.connection();
        connection.execute(
            "INSERT INTO proposals (
                id, scope_key, title, body, action_type, action_params_json, references_json, status,
                publisher_json, comments_json, snooze_until, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
            params![
                &proposal.id,
                scope_key,
                &proposal.title,
                &proposal.body,
                action_type_to_str(proposal.action_type),
                serde_json::to_string(&proposal.action_params)?,
                serde_json::to_string(&proposal.references)?,
                proposal_status_to_str(proposal.status),
                serde_json::to_string(&proposal.publisher)?,
                serde_json::to_string(&proposal.comments)?,
                now.to_rfc3339(),
                now.to_rfc3339(),
            ],
        )?;
        Ok(proposal)
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

    fn get_scoped(
        &self,
        scope_key: &str,
        id: &str,
    ) -> Result<Option<Proposal>, ProposalStoreError> {
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
        if has_legacy_integer_id_schema(&connection)? {
            migrate_legacy_integer_schema(&connection)?;
        }
        create_proposal_schema(&connection)?;
        Ok(())
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[derive(Debug)]
struct LegacyProposalRow {
    old_id: i64,
    scope_key: String,
    title: String,
    body: String,
    action_type: String,
    action_params_json: String,
    references_json: String,
    status: String,
    publisher_json: String,
    comments_json: String,
    snooze_until: Option<String>,
    created_at: String,
    updated_at: String,
}

fn generate_proposal_id() -> String {
    format!("prp-{}", uuid::Uuid::new_v4())
}

fn create_proposal_schema(connection: &Connection) -> Result<(), ProposalStoreError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS proposals (
            id                 TEXT PRIMARY KEY,
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

fn has_legacy_integer_id_schema(connection: &Connection) -> Result<bool, ProposalStoreError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'proposals' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Ok(false);
    }

    let mut statement = connection.prepare("PRAGMA table_info(proposals)")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;

    for row in rows {
        let (name, column_type) = row?;
        if name == "id" {
            return Ok(!column_type.eq_ignore_ascii_case("TEXT"));
        }
    }

    Ok(false)
}

fn migrate_legacy_integer_schema(connection: &Connection) -> Result<(), ProposalStoreError> {
    connection.execute_batch(
        "BEGIN IMMEDIATE;
        ALTER TABLE proposals RENAME TO proposals_legacy;
        DROP INDEX IF EXISTS idx_proposals_scope_created;
        DROP INDEX IF EXISTS idx_proposals_scope_status;",
    )?;

    create_proposal_schema(connection)?;

    let mut statement = connection.prepare(
        "SELECT id, scope_key, title, body, action_type, action_params_json, references_json,
                status, publisher_json, comments_json, snooze_until, created_at, updated_at
         FROM proposals_legacy
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(LegacyProposalRow {
            old_id: row.get(0)?,
            scope_key: row.get(1)?,
            title: row.get(2)?,
            body: row.get(3)?,
            action_type: row.get(4)?,
            action_params_json: row.get(5)?,
            references_json: row.get(6)?,
            status: row.get(7)?,
            publisher_json: row.get(8)?,
            comments_json: row.get(9)?,
            snooze_until: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    })?;

    for row in rows {
        let row = row?;
        let migrated_id = build_legacy_proposal_id(&row);
        connection.execute(
            "INSERT INTO proposals (
                id, scope_key, title, body, action_type, action_params_json, references_json,
                status, publisher_json, comments_json, snooze_until, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                migrated_id,
                row.scope_key,
                row.title,
                row.body,
                row.action_type,
                row.action_params_json,
                row.references_json,
                row.status,
                row.publisher_json,
                row.comments_json,
                row.snooze_until,
                row.created_at,
                row.updated_at,
            ],
        )?;
    }

    connection.execute_batch(
        "DROP TABLE proposals_legacy;
        COMMIT;",
    )?;
    Ok(())
}

fn build_legacy_proposal_id(row: &LegacyProposalRow) -> String {
    let mut hasher = Sha256::new();
    for part in [
        row.scope_key.as_str(),
        &row.old_id.to_string(),
        row.created_at.as_str(),
        row.action_type.as_str(),
        row.title.as_str(),
        row.body.as_str(),
        row.references_json.as_str(),
        row.publisher_json.as_str(),
    ] {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }

    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("legacy-{}", &hex[..32])
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

    let parsed_action_type = parse_action_type(&action_type)?;
    let action_params = normalize_action_params(
        parsed_action_type,
        serde_json::from_str::<Value>(&row.get::<_, String>(4)?)
            .map_err(to_sqlite_conversion_error)?,
    )
    .map_err(to_sqlite_conversion_error)?;
    let references = merge_action_references(
        parsed_action_type,
        &action_params,
        serde_json::from_str(&references_json).map_err(to_sqlite_conversion_error)?,
    )
    .map_err(to_sqlite_conversion_error)?;

    Ok(Proposal {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        action_type: parsed_action_type,
        action_params,
        references,
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
            if params.fields.title.trim().is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "fields.title must not be empty".to_string(),
                });
            }
            validate_task_dependency_params(action_type, params.fields.depends_on.as_deref())?;
        }
        ActionType::UpdateTask => {
            let params: UpdateTaskParams =
                serde_json::from_value(action_params.clone()).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            if params.task_id.trim().is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "taskId must not be empty".to_string(),
                });
            }
            if params.patch.is_empty() {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "patch must include at least one field".to_string(),
                });
            }
            if params
                .patch
                .title
                .as_deref()
                .is_some_and(|value| value.trim().is_empty())
            {
                return Err(ProposalStoreError::InvalidActionParams {
                    action_type,
                    reason: "patch.title must not be empty".to_string(),
                });
            }
            validate_task_dependency_params(action_type, params.patch.depends_on.as_deref())?;
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

fn normalize_action_params(
    action_type: ActionType,
    action_params: Value,
) -> Result<Value, ProposalStoreError> {
    match action_type {
        ActionType::CreateTask => {
            if action_params
                .as_object()
                .is_some_and(|value| value.contains_key("fields"))
            {
                let params: CreateTaskParams =
                    serde_json::from_value(action_params).map_err(|error| {
                        ProposalStoreError::InvalidActionParams {
                            action_type,
                            reason: error.to_string(),
                        }
                    })?;
                return serde_json::to_value(params).map_err(ProposalStoreError::from);
            }

            let legacy: LegacyCreateTaskParams =
                serde_json::from_value(action_params).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            serde_json::to_value(CreateTaskParams {
                fields: TaskProposalFields {
                    title: legacy.title,
                    description: legacy.description,
                    done_condition: legacy.done_condition,
                    tags: legacy.tags,
                    priority: legacy.priority,
                    estimated_minutes: legacy.estimated_minutes,
                    due_at: legacy.due_at,
                    depends_on: legacy.depends_on,
                },
            })
            .map_err(ProposalStoreError::from)
        }
        ActionType::UpdateTask => {
            let params: UpdateTaskParams =
                serde_json::from_value(action_params).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            serde_json::to_value(params).map_err(ProposalStoreError::from)
        }
        ActionType::AppendEvent => {
            let params: AppendEventParams =
                serde_json::from_value(action_params).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            serde_json::to_value(params).map_err(ProposalStoreError::from)
        }
        ActionType::StartTimeblock => {
            let params: StartTimeblockParams =
                serde_json::from_value(action_params).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            serde_json::to_value(params).map_err(ProposalStoreError::from)
        }
        ActionType::ApproveAgentAccess => {
            let params: ApproveAgentAccessParams =
                serde_json::from_value(action_params).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            serde_json::to_value(params).map_err(ProposalStoreError::from)
        }
    }
}

fn merge_action_references(
    action_type: ActionType,
    action_params: &Value,
    existing: Vec<ProposalRef>,
) -> Result<Vec<ProposalRef>, ProposalStoreError> {
    let derived = derive_action_references(action_type, action_params)?;
    let candidates = match action_type {
        ActionType::CreateTask | ActionType::UpdateTask => existing
            .into_iter()
            .filter(|reference| reference.ref_type != crate::proposal::RefType::Task)
            .chain(derived)
            .collect::<Vec<_>>(),
        _ => existing.into_iter().chain(derived).collect::<Vec<_>>(),
    };

    Ok(dedup_references(candidates))
}

fn dedup_references(references: Vec<ProposalRef>) -> Vec<ProposalRef> {
    let mut seen = std::collections::HashSet::new();
    references
        .into_iter()
        .filter(|reference| seen.insert(format!("{:?}:{}", reference.ref_type, reference.id)))
        .collect()
}

fn derive_action_references(
    action_type: ActionType,
    action_params: &Value,
) -> Result<Vec<ProposalRef>, ProposalStoreError> {
    match action_type {
        ActionType::CreateTask => {
            let params: CreateTaskParams =
                serde_json::from_value(action_params.clone()).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            Ok(params
                .fields
                .depends_on
                .unwrap_or_default()
                .into_iter()
                .map(task_reference_from_dependency)
                .collect())
        }
        ActionType::UpdateTask => {
            let params: UpdateTaskParams =
                serde_json::from_value(action_params.clone()).map_err(|error| {
                    ProposalStoreError::InvalidActionParams {
                        action_type,
                        reason: error.to_string(),
                    }
                })?;
            let mut references = vec![task_reference(&params.task_id)];
            references.extend(
                params
                    .patch
                    .depends_on
                    .unwrap_or_default()
                    .into_iter()
                    .map(task_reference_from_dependency),
            );
            Ok(references)
        }
        _ => Ok(Vec::new()),
    }
}

fn task_reference(task_id: &str) -> ProposalRef {
    ProposalRef {
        ref_type: crate::proposal::RefType::Task,
        id: task_id.to_string(),
        display_text: format!("任务 {task_id}"),
    }
}

fn task_reference_from_dependency(
    dependency: crate::proposal::ProposalTaskDependency,
) -> ProposalRef {
    task_reference(&dependency.task_id)
}

fn validate_task_dependency_params(
    action_type: ActionType,
    dependencies: Option<&[crate::proposal::ProposalTaskDependency]>,
) -> Result<(), ProposalStoreError> {
    for dependency in dependencies.unwrap_or_default() {
        if dependency.task_id.trim().is_empty() {
            return Err(ProposalStoreError::InvalidActionParams {
                action_type,
                reason: "dependsOn[].taskId must not be empty".to_string(),
            });
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
    value.canonical_name()
}

fn parse_action_type(value: &str) -> rusqlite::Result<ActionType> {
    ActionType::parse_compatible(value).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::other(format!(
                "invalid action_type value: {value}"
            ))),
        )
    })
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
    use chrono::{TimeZone, Utc};
    use rusqlite::{Connection, params};
    use tempfile::tempdir;

    use crate::proposal::{
        ActionType, CreateTaskParams, ProposalStatus, Publisher, PublisherType, TaskProposalFields,
    };

    use super::{CreateProposalInput, ProposalFilter, ProposalStore};

    fn sample_input(title: &str) -> CreateProposalInput {
        CreateProposalInput {
            title: title.to_string(),
            body: "reason".to_string(),
            action_type: ActionType::CreateTask,
            action_params: serde_json::json!({ "fields": { "title": title } }),
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
            .update_status(&first.id, ProposalStatus::Approved, None)
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

        assert!(store.get(&anonymous.id).unwrap().is_some());
        assert!(
            store
                .get_scoped(Some("profile-a"), &scoped.id)
                .unwrap()
                .is_some()
        );
        assert!(
            store
                .get_scoped(Some("profile-b"), &scoped.id)
                .unwrap()
                .is_none()
        );

        store
            .update_status_scoped(
                Some("profile-a"),
                &scoped.id,
                ProposalStatus::Approved,
                None,
            )
            .unwrap();
        let conflict = store.update_action_params_scoped(
            Some("profile-a"),
            &scoped.id,
            serde_json::json!({ "title": "Edited" }),
        );
        assert!(conflict.is_err());
    }

    #[test]
    fn independent_sqlite_stores_do_not_generate_colliding_first_ids() {
        let dir = tempdir().unwrap();
        let store_a =
            ProposalStore::with_sqlite_path(&dir.path().join("proposals-a.sqlite")).unwrap();
        let store_b =
            ProposalStore::with_sqlite_path(&dir.path().join("proposals-b.sqlite")).unwrap();

        let first = store_a
            .create_scoped(Some("profile-a"), sample_input("First from A"))
            .unwrap();
        let second = store_b
            .create_scoped(Some("profile-a"), sample_input("First from B"))
            .unwrap();

        assert_ne!(
            first.id, second.id,
            "proposal ids must be globally stable across independent stores"
        );
    }

    #[test]
    fn replica_save_keeps_independent_proposals_from_separate_stores() {
        let dir = tempdir().unwrap();
        let store_a =
            ProposalStore::with_sqlite_path(&dir.path().join("proposals-a.sqlite")).unwrap();
        let store_b =
            ProposalStore::with_sqlite_path(&dir.path().join("proposals-b.sqlite")).unwrap();

        let local = store_a
            .create_scoped(Some("profile-a"), sample_input("Local proposal"))
            .unwrap();
        let remote = store_b
            .create_scoped(Some("profile-a"), sample_input("Remote proposal"))
            .unwrap();

        store_a
            .save_replica_scoped(Some("profile-a"), remote.clone())
            .unwrap();

        let listed = store_a
            .list_scoped(Some("profile-a"), &ProposalFilter::default())
            .unwrap();
        let titles = listed
            .iter()
            .map(|proposal| proposal.title.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            listed.len(),
            2,
            "replica save should not collapse independent proposals into one row",
        );
        assert!(titles.contains(&local.title.as_str()));
        assert!(titles.contains(&remote.title.as_str()));
    }

    #[test]
    fn update_task_references_are_derived_and_refreshed_from_action_params() {
        let store = ProposalStore::new();
        let proposal = store
            .create(CreateProposalInput {
                title: "Refresh task refs".to_string(),
                body: "reason".to_string(),
                action_type: ActionType::UpdateTask,
                action_params: serde_json::json!({
                    "taskId": "task-target",
                    "patch": {
                        "dependsOn": [
                            { "taskId": "task-a", "type": "hard" }
                        ]
                    }
                }),
                references: vec![crate::proposal::ProposalRef {
                    ref_type: crate::proposal::RefType::Event,
                    id: "evt-1".to_string(),
                    display_text: "Event 1".to_string(),
                }],
                publisher: Publisher {
                    publisher_type: PublisherType::Agent,
                    id: "agent-test".to_string(),
                    name: "Agent Test".to_string(),
                },
            })
            .unwrap();

        assert_eq!(
            proposal
                .references
                .iter()
                .map(|reference| (reference.ref_type, reference.id.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (crate::proposal::RefType::Event, "evt-1"),
                (crate::proposal::RefType::Task, "task-target"),
                (crate::proposal::RefType::Task, "task-a"),
            ],
        );

        let updated = store
            .update_action_params(
                &proposal.id,
                serde_json::json!({
                    "taskId": "task-target",
                    "patch": {
                        "dependsOn": [
                            { "taskId": "task-b", "type": "soft" }
                        ]
                    }
                }),
            )
            .unwrap();
        assert_eq!(
            updated
                .references
                .iter()
                .map(|reference| (reference.ref_type, reference.id.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (crate::proposal::RefType::Event, "evt-1"),
                (crate::proposal::RefType::Task, "task-target"),
                (crate::proposal::RefType::Task, "task-b"),
            ],
        );
    }

    #[test]
    fn sqlite_rows_with_legacy_create_task_action_are_normalized_on_read() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-action-name.sqlite");
        let connection = Connection::open(&sqlite_path).unwrap();
        let now = Utc::now().to_rfc3339();
        let due_at = Utc
            .timestamp_millis_opt(1_776_201_600_000)
            .single()
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE proposals (
                    id                 TEXT PRIMARY KEY,
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
                CREATE INDEX idx_proposals_scope_created
                    ON proposals(scope_key, created_at DESC, id DESC);
                CREATE INDEX idx_proposals_scope_status
                    ON proposals(scope_key, status);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO proposals (
                    id, scope_key, title, body, action_type, action_params_json, references_json,
                    status, publisher_json, comments_json, snooze_until, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
                params![
                    "prp-legacy-action",
                    "profile-a",
                    "Legacy create task",
                    "legacy row",
                    "create_task",
                    r#"{"title":"Legacy task","due_at":1776201600000,"dependsOn":[{"taskId":"task-dep","type":"hard"}]}"#,
                    "[]",
                    "pending",
                    r#"{"publisher_type":"agent","id":"legacy-agent","name":"Legacy Agent"}"#,
                    "[]",
                    &now,
                    &now,
                ],
            )
            .unwrap();
        drop(connection);

        let store = ProposalStore::with_sqlite_path(&sqlite_path).unwrap();
        let proposals = store
            .list_scoped(
                Some("profile-a"),
                &ProposalFilter {
                    status: Some(ProposalStatus::Pending),
                    action_type: Some(ActionType::CreateTask),
                },
            )
            .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].action_type, ActionType::CreateTask);
        let expected_action_params = serde_json::to_value(CreateTaskParams {
            fields: TaskProposalFields {
                title: "Legacy task".to_string(),
                description: None,
                done_condition: None,
                tags: None,
                priority: None,
                estimated_minutes: None,
                due_at: Some(due_at),
                depends_on: Some(vec![crate::proposal::ProposalTaskDependency {
                    task_id: "task-dep".to_string(),
                    relation_type: crate::task::TaskDependencyType::Hard,
                }]),
            },
        })
        .unwrap();
        assert_eq!(proposals[0].action_params, expected_action_params,);
        assert_eq!(
            proposals[0]
                .references
                .iter()
                .map(|reference| (reference.ref_type, reference.id.as_str()))
                .collect::<Vec<_>>(),
            vec![(crate::proposal::RefType::Task, "task-dep")],
        );
    }

    #[test]
    fn sqlite_rows_with_task_create_snake_case_fields_are_normalized_on_read() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("task-create-snake-case.sqlite");
        let connection = Connection::open(&sqlite_path).unwrap();
        let now = Utc::now().to_rfc3339();
        let due_at = Utc
            .timestamp_millis_opt(1_776_633_600_000)
            .single()
            .unwrap();
        connection
            .execute_batch(
                "CREATE TABLE proposals (
                    id                 TEXT PRIMARY KEY,
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
                CREATE INDEX idx_proposals_scope_created
                    ON proposals(scope_key, created_at DESC, id DESC);
                CREATE INDEX idx_proposals_scope_status
                    ON proposals(scope_key, status);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO proposals (
                    id, scope_key, title, body, action_type, action_params_json, references_json,
                    status, publisher_json, comments_json, snooze_until, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
                params![
                    "prp-task-create-snake-case",
                    "profile-a",
                    "Task.create snake_case fields",
                    "legacy row",
                    "task.create",
                    r#"{"fields":{"title":"Task.create legacy row","due_at":1776633600000,"depends_on":[{"task_id":"task-dep","type":"soft"}]}}"#,
                    "[]",
                    "pending",
                    r#"{"publisher_type":"agent","id":"legacy-agent","name":"Legacy Agent"}"#,
                    "[]",
                    &now,
                    &now,
                ],
            )
            .unwrap();
        drop(connection);

        let store = ProposalStore::with_sqlite_path(&sqlite_path).unwrap();
        let proposals = store
            .list_scoped(
                Some("profile-a"),
                &ProposalFilter {
                    status: Some(ProposalStatus::Pending),
                    action_type: Some(ActionType::CreateTask),
                },
            )
            .unwrap();
        assert_eq!(proposals.len(), 1);
        let expected_action_params = serde_json::to_value(CreateTaskParams {
            fields: TaskProposalFields {
                title: "Task.create legacy row".to_string(),
                description: None,
                done_condition: None,
                tags: None,
                priority: None,
                estimated_minutes: None,
                due_at: Some(due_at),
                depends_on: Some(vec![crate::proposal::ProposalTaskDependency {
                    task_id: "task-dep".to_string(),
                    relation_type: crate::task::TaskDependencyType::Soft,
                }]),
            },
        })
        .unwrap();
        assert_eq!(proposals[0].action_params, expected_action_params,);
        assert_eq!(
            proposals[0]
                .references
                .iter()
                .map(|reference| (reference.ref_type, reference.id.as_str()))
                .collect::<Vec<_>>(),
            vec![(crate::proposal::RefType::Task, "task-dep")],
        );
    }

    #[test]
    fn sqlite_store_migrates_legacy_integer_id_schema_to_stable_strings() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-proposals.sqlite");
        let connection = Connection::open(&sqlite_path).unwrap();
        let now = Utc::now().to_rfc3339();
        connection
            .execute_batch(
                "CREATE TABLE proposals (
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
                CREATE INDEX idx_proposals_scope_created
                    ON proposals(scope_key, created_at DESC, id DESC);
                CREATE INDEX idx_proposals_scope_status
                    ON proposals(scope_key, status);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO proposals (
                    scope_key, title, body, action_type, action_params_json, references_json, status,
                    publisher_json, comments_json, snooze_until, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11)",
                params![
                    "profile-a",
                    "Legacy proposal",
                    "migrated from integer ids",
                    "create_task",
                    r#"{"title":"Legacy task"}"#,
                    "[]",
                    "pending",
                    r#"{"publisher_type":"agent","id":"legacy-agent","name":"Legacy Agent"}"#,
                    "[]",
                    &now,
                    &now,
                ],
            )
            .unwrap();
        drop(connection);

        let store = ProposalStore::with_sqlite_path(&sqlite_path).unwrap();
        let migrated = store
            .list_scoped(Some("profile-a"), &ProposalFilter::default())
            .unwrap();
        assert_eq!(migrated.len(), 1);
        assert!(
            migrated[0].id.starts_with("legacy-"),
            "legacy integer rows should migrate to deterministic stable ids"
        );

        let created = store
            .create_scoped(Some("profile-a"), sample_input("Fresh proposal"))
            .unwrap();
        assert!(
            created.id.starts_with("prp-"),
            "new proposals should use generated stable ids"
        );
        assert_ne!(created.id, migrated[0].id);
    }
}
