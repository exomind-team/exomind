use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use super::store::SessionStoreError;
use super::types::*;

pub struct SqliteSessionStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteSessionStore {
    pub fn open(path: &Path) -> Result<Self, SessionStoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        let store = Self {
            path: path.to_path_buf(),
            connection: Mutex::new(connection),
        };
        store.init()?;
        Ok(store)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().expect("session store connection lock poisoned")
    }

    fn init(&self) -> Result<(), SessionStoreError> {
        let conn = self.connection();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_sessions (
                id                TEXT PRIMARY KEY,
                agent_kind        TEXT NOT NULL,
                role              TEXT NOT NULL DEFAULT '',
                summary           TEXT NOT NULL DEFAULT '',
                status            TEXT NOT NULL DEFAULT 'running',
                interaction_mode  TEXT NOT NULL DEFAULT 'structured',
                pty_id            TEXT,
                inner_session_id  TEXT,

                -- Work context
                git_branch        TEXT,
                worktree_path     TEXT,
                issue_refs        TEXT,
                pr_ref            TEXT,
                work_dir          TEXT,
                labels            TEXT,

                -- Relations
                parent_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,

                -- Time
                created_at        TEXT NOT NULL,
                last_active_at    TEXT NOT NULL,

                -- History
                turn_count        INTEGER NOT NULL DEFAULT 0,
                last_output_preview TEXT,
                error_message     TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_status ON agent_sessions(status);
            CREATE INDEX IF NOT EXISTS idx_sessions_agent ON agent_sessions(agent_kind);
            CREATE INDEX IF NOT EXISTS idx_sessions_active ON agent_sessions(last_active_at DESC);

            PRAGMA user_version = 1;",
        )?;
        Ok(())
    }

    pub fn create(&self, input: CreateSessionInput) -> Result<AgentSession, SessionStoreError> {
        let now = chrono::Utc::now().to_rfc3339();
        let context = input.context.unwrap_or_default();
        let interaction = input.interaction.unwrap_or(InteractionMode::Structured);

        let session = AgentSession {
            id: uuid::Uuid::new_v4().to_string(),
            agent_kind: input.agent_kind,
            role: input.role.unwrap_or_default(),
            summary: String::new(),
            status: SessionStatus::Running,
            interaction_mode: interaction,
            pty_id: input.pty_id,
            inner_session_id: None,
            context,
            parent_session_id: input.parent_session_id,
            created_at: now.clone(),
            last_active_at: now,
            turn_count: 0,
            last_output_preview: None,
            error_message: None,
        };

        self.insert_session(&session)?;
        Ok(session)
    }

    pub fn get(&self, id: &str) -> Result<Option<AgentSession>, SessionStoreError> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT
                id, agent_kind, role, summary, status, interaction_mode,
                pty_id, inner_session_id,
                git_branch, worktree_path, issue_refs, pr_ref, work_dir, labels,
                parent_session_id,
                created_at, last_active_at,
                turn_count, last_output_preview, error_message
             FROM agent_sessions
             WHERE id = ?1",
        )?;

        stmt.query_row(params![id], map_session_row)
            .optional()
            .map_err(SessionStoreError::from)
    }

    pub fn list(&self) -> Result<Vec<AgentSession>, SessionStoreError> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT
                id, agent_kind, role, summary, status, interaction_mode,
                pty_id, inner_session_id,
                git_branch, worktree_path, issue_refs, pr_ref, work_dir, labels,
                parent_session_id,
                created_at, last_active_at,
                turn_count, last_output_preview, error_message
             FROM agent_sessions
             ORDER BY last_active_at DESC",
        )?;
        let rows = stmt.query_map([], map_session_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(SessionStoreError::from)
    }

    pub fn list_by_status(&self, status: &SessionStatus) -> Result<Vec<AgentSession>, SessionStoreError> {
        let conn = self.connection();
        let mut stmt = conn.prepare(
            "SELECT
                id, agent_kind, role, summary, status, interaction_mode,
                pty_id, inner_session_id,
                git_branch, worktree_path, issue_refs, pr_ref, work_dir, labels,
                parent_session_id,
                created_at, last_active_at,
                turn_count, last_output_preview, error_message
             FROM agent_sessions
             WHERE status = ?1
             ORDER BY last_active_at DESC",
        )?;
        let rows = stmt.query_map(params![status.as_str()], map_session_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(SessionStoreError::from)
    }

    pub fn update(&self, id: &str, input: UpdateSessionInput) -> Result<AgentSession, SessionStoreError> {
        let mut session = self
            .get(id)?
            .ok_or_else(|| SessionStoreError::NotFound(id.to_string()))?;

        if let Some(role) = input.role {
            session.role = role;
        }
        if let Some(summary) = input.summary {
            session.summary = summary;
        }
        if let Some(status) = input.status {
            if !session.status.can_transition_to(&status) {
                return Err(SessionStoreError::InvalidTransition {
                    from: session.status,
                    to: status,
                });
            }
            session.status = status;
        }
        if let Some(context) = input.context {
            session.context = context;
        }
        if let Some(preview) = input.last_output_preview {
            session.last_output_preview = Some(preview);
        }
        if let Some(error_message) = input.error_message {
            session.error_message = Some(error_message);
        }
        if let Some(inner_session_id) = input.inner_session_id {
            session.inner_session_id = Some(inner_session_id);
        }

        session.last_active_at = chrono::Utc::now().to_rfc3339();
        self.persist_session(&session)?;
        Ok(session)
    }

    pub fn delete(&self, id: &str) -> Result<Option<AgentSession>, SessionStoreError> {
        let existing = self.get(id)?;
        if existing.is_none() {
            return Ok(None);
        }

        let conn = self.connection();
        conn.execute(
            "DELETE FROM agent_sessions WHERE id = ?1",
            params![id],
        )?;
        Ok(existing)
    }

    pub fn increment_turn_count(&self, id: &str) -> Result<(), SessionStoreError> {
        let conn = self.connection();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agent_sessions SET turn_count = turn_count + 1, last_active_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn update_output_preview(&self, id: &str, preview: &str) -> Result<(), SessionStoreError> {
        let conn = self.connection();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agent_sessions SET last_output_preview = ?2, last_active_at = ?3 WHERE id = ?1",
            params![id, preview, now],
        )?;
        Ok(())
    }

    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, SessionStoreError> {
        std::fs::read(&self.path).map_err(SessionStoreError::from)
    }

    fn insert_session(&self, session: &AgentSession) -> Result<(), SessionStoreError> {
        let conn = self.connection();
        conn.execute(
            "INSERT INTO agent_sessions (
                id, agent_kind, role, summary, status, interaction_mode,
                pty_id, inner_session_id,
                git_branch, worktree_path, issue_refs, pr_ref, work_dir, labels,
                parent_session_id,
                created_at, last_active_at,
                turn_count, last_output_preview, error_message
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![
                session.id,
                session.agent_kind,
                session.role,
                session.summary,
                session.status.as_str(),
                session.interaction_mode.as_str(),
                session.pty_id,
                session.inner_session_id,
                session.context.git_branch,
                session.context.worktree_path,
                serde_json::to_string(&session.context.issue_refs)?,
                session.context.pr_ref,
                session.context.work_dir,
                serde_json::to_string(&session.context.labels)?,
                session.parent_session_id,
                session.created_at,
                session.last_active_at,
                session.turn_count,
                session.last_output_preview,
                session.error_message,
            ],
        )?;
        Ok(())
    }

    fn persist_session(&self, session: &AgentSession) -> Result<(), SessionStoreError> {
        let conn = self.connection();
        conn.execute(
            "INSERT INTO agent_sessions (
                id, agent_kind, role, summary, status, interaction_mode,
                pty_id, inner_session_id,
                git_branch, worktree_path, issue_refs, pr_ref, work_dir, labels,
                parent_session_id,
                created_at, last_active_at,
                turn_count, last_output_preview, error_message
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
            ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                summary = excluded.summary,
                status = excluded.status,
                interaction_mode = excluded.interaction_mode,
                pty_id = excluded.pty_id,
                inner_session_id = excluded.inner_session_id,
                git_branch = excluded.git_branch,
                worktree_path = excluded.worktree_path,
                issue_refs = excluded.issue_refs,
                pr_ref = excluded.pr_ref,
                work_dir = excluded.work_dir,
                labels = excluded.labels,
                parent_session_id = excluded.parent_session_id,
                last_active_at = excluded.last_active_at,
                turn_count = excluded.turn_count,
                last_output_preview = excluded.last_output_preview,
                error_message = excluded.error_message",
            params![
                session.id,
                session.agent_kind,
                session.role,
                session.summary,
                session.status.as_str(),
                session.interaction_mode.as_str(),
                session.pty_id,
                session.inner_session_id,
                session.context.git_branch,
                session.context.worktree_path,
                serde_json::to_string(&session.context.issue_refs)?,
                session.context.pr_ref,
                session.context.work_dir,
                serde_json::to_string(&session.context.labels)?,
                session.parent_session_id,
                session.created_at,
                session.last_active_at,
                session.turn_count,
                session.last_output_preview,
                session.error_message,
            ],
        )?;
        Ok(())
    }
}

fn map_session_row(row: &rusqlite::Row) -> Result<AgentSession, rusqlite::Error> {
    let status_str: String = row.get(4)?;
    let interaction_str: String = row.get(5)?;
    let issue_refs_json: String = row.get(10)?;
    let labels_json: String = row.get(13)?;

    let status = SessionStatus::from_str(&status_str)
        .unwrap_or(SessionStatus::Running);
    let interaction_mode = InteractionMode::from_str(&interaction_str)
        .unwrap_or(InteractionMode::Structured);
    let issue_refs: Vec<String> = serde_json::from_str(&issue_refs_json)
        .unwrap_or_default();
    let labels: Vec<String> = serde_json::from_str(&labels_json)
        .unwrap_or_default();

    Ok(AgentSession {
        id: row.get(0)?,
        agent_kind: row.get(1)?,
        role: row.get(2)?,
        summary: row.get(3)?,
        status,
        interaction_mode,
        pty_id: row.get(6)?,
        inner_session_id: row.get(7)?,
        context: WorkContext {
            git_branch: row.get(8)?,
            worktree_path: row.get(9)?,
            issue_refs,
            pr_ref: row.get(11)?,
            work_dir: row.get(12)?,
            labels,
        },
        parent_session_id: row.get(14)?,
        created_at: row.get(15)?,
        last_active_at: row.get(16)?,
        turn_count: row.get(17)?,
        last_output_preview: row.get(18)?,
        error_message: row.get(19)?,
    })
}
