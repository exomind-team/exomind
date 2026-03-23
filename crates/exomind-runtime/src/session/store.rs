use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

use thiserror::Error;

use super::sqlite_store::SqliteSessionStore;
use super::types::*;

#[derive(Debug, Error)]
pub enum SessionStoreError {
    #[error("session not found: {0}")]
    NotFound(String),
    #[error("session already exists: {0}")]
    AlreadyExists(String),
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: SessionStatus,
        to: SessionStatus,
    },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid stored session status: {0}")]
    InvalidStoredStatus(String),
}

enum SessionStoreBackend {
    Memory(RwLock<HashMap<String, AgentSession>>),
    Sqlite(SqliteSessionStore),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStoreBackendKind {
    Memory,
    Sqlite,
}

pub struct SessionStore {
    backend: SessionStoreBackend,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            backend: SessionStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, SessionStoreError> {
        Ok(Self {
            backend: SessionStoreBackend::Sqlite(SqliteSessionStore::open(path)?),
        })
    }

    pub fn create(&self, input: CreateSessionInput) -> Result<AgentSession, SessionStoreError> {
        match &self.backend {
            SessionStoreBackend::Sqlite(store) => store.create(input),
            SessionStoreBackend::Memory(_) => {
                let now = chrono::Utc::now().to_rfc3339();
                let context = input.context.unwrap_or_default();
                let interaction = input.interaction.unwrap_or(InteractionMode::Structured);
                let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let session = AgentSession {
                    id: id.clone(),
                    agent_kind: input.agent_kind,
                    agent_id: input.agent_id,
                    source_host_id: input.source_host_id,
                    role: input.role.unwrap_or_default(),
                    summary: String::new(),
                    status: SessionStatus::Running,
                    interaction_mode: interaction,
                    pty_id: input.pty_id,
                    inner_session_id: input.inner_session_id,
                    context,
                    parent_session_id: input.parent_session_id,
                    created_at: now.clone(),
                    last_active_at: now,
                    turn_count: 0,
                    last_output_preview: None,
                    error_message: None,
                    quick_actions: vec![],
                };
                let result = session.clone();
                self.with_memory_mut(|sessions| {
                    if sessions.contains_key(&id) {
                        return Err(SessionStoreError::AlreadyExists(id));
                    }
                    sessions.insert(session.id.clone(), session);
                    Ok(result)
                })
            }
        }
    }

    pub fn get(&self, id: &str) -> Result<Option<AgentSession>, SessionStoreError> {
        match &self.backend {
            SessionStoreBackend::Sqlite(store) => store.get(id),
            SessionStoreBackend::Memory(_) => Ok(self.memory_map().get(id).cloned()),
        }
    }

    pub fn list(&self) -> Result<Vec<AgentSession>, SessionStoreError> {
        match &self.backend {
            SessionStoreBackend::Sqlite(store) => store.list(),
            SessionStoreBackend::Memory(_) => {
                let mut sessions: Vec<AgentSession> = self.memory_map().values().cloned().collect();
                sessions.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
                Ok(sessions)
            }
        }
    }

    pub fn list_by_status(
        &self,
        status: &SessionStatus,
    ) -> Result<Vec<AgentSession>, SessionStoreError> {
        match &self.backend {
            SessionStoreBackend::Sqlite(store) => store.list_by_status(status),
            SessionStoreBackend::Memory(_) => {
                let sessions = self
                    .list()?
                    .into_iter()
                    .filter(|s| &s.status == status)
                    .collect();
                Ok(sessions)
            }
        }
    }

    pub fn update(
        &self,
        id: &str,
        input: UpdateSessionInput,
    ) -> Result<AgentSession, SessionStoreError> {
        match &self.backend {
            SessionStoreBackend::Sqlite(store) => store.update(id, input),
            SessionStoreBackend::Memory(_) => self.with_memory_mut(|sessions| {
                let session = sessions
                    .get_mut(id)
                    .ok_or_else(|| SessionStoreError::NotFound(id.to_string()))?;

                if let Some(role) = input.role {
                    session.role = role;
                }
                if input.agent_id.is_some() {
                    session.agent_id = input.agent_id;
                }
                if input.source_host_id.is_some() {
                    session.source_host_id = input.source_host_id;
                }
                if let Some(summary) = input.summary {
                    session.summary = summary;
                }
                if let Some(status) = input.status {
                    if !session.status.can_transition_to(&status) {
                        return Err(SessionStoreError::InvalidTransition {
                            from: session.status.clone(),
                            to: status,
                        });
                    }
                    session.status = status;
                }
                if let Some(context) = input.context {
                    session.context = session.context.merge_patch(context);
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
                if let Some(quick_actions) = input.quick_actions {
                    session.quick_actions = quick_actions;
                }

                session.last_active_at = chrono::Utc::now().to_rfc3339();
                Ok(session.clone())
            }),
        }
    }

    pub fn delete(&self, id: &str) -> Result<Option<AgentSession>, SessionStoreError> {
        match &self.backend {
            SessionStoreBackend::Sqlite(store) => store.delete(id),
            SessionStoreBackend::Memory(_) => {
                Ok(self.with_memory_mut(|sessions| sessions.remove(id)))
            }
        }
    }

    pub fn backend_kind(&self) -> SessionStoreBackendKind {
        match &self.backend {
            SessionStoreBackend::Memory(_) => SessionStoreBackendKind::Memory,
            SessionStoreBackend::Sqlite(_) => SessionStoreBackendKind::Sqlite,
        }
    }

    fn memory_map(&self) -> HashMap<String, AgentSession> {
        match &self.backend {
            SessionStoreBackend::Memory(map) => map.read().unwrap().clone(),
            SessionStoreBackend::Sqlite(_) => unreachable!("memory_map called on sqlite backend"),
        }
    }

    fn with_memory_mut<R>(&self, f: impl FnOnce(&mut HashMap<String, AgentSession>) -> R) -> R {
        match &self.backend {
            SessionStoreBackend::Memory(map) => {
                let mut guard = map.write().unwrap();
                f(&mut guard)
            }
            SessionStoreBackend::Sqlite(_) => {
                unreachable!("with_memory_mut called on sqlite backend")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn create_input(agent_kind: &str, role: &str) -> CreateSessionInput {
        CreateSessionInput {
            id: None,
            agent_kind: agent_kind.to_string(),
            role: Some(role.to_string()),
            context: Some(WorkContext {
                git_branch: Some("dev".to_string()),
                issue_refs: vec!["#511".to_string()],
                ..Default::default()
            }),
            interaction: Some(InteractionMode::Terminal),
            pty_id: Some("pty-1".to_string()),
            inner_session_id: None,
            parent_session_id: None,
            agent_id: None,
            source_host_id: None,
        }
    }

    fn create_input_with_full_context(agent_kind: &str, role: &str) -> CreateSessionInput {
        CreateSessionInput {
            id: None,
            agent_kind: agent_kind.to_string(),
            role: Some(role.to_string()),
            context: Some(WorkContext {
                git_branch: Some("dev".to_string()),
                worktree_path: Some("D:/project/exomind-wt-yyxw".to_string()),
                issue_refs: vec!["#511".to_string()],
                pr_ref: Some("523".to_string()),
                work_dir: Some("D:/project/exomind-wt-yyxw".to_string()),
                labels: vec!["runtime".to_string(), "review".to_string()],
            }),
            interaction: Some(InteractionMode::Terminal),
            pty_id: Some("pty-1".to_string()),
            inner_session_id: None,
            parent_session_id: None,
            agent_id: None,
            source_host_id: None,
        }
    }

    #[test]
    fn memory_store_create_and_get() {
        let store = SessionStore::new();
        let session = store.create(create_input("claude", "任务思考")).unwrap();
        assert_eq!(session.agent_kind, "claude");
        assert_eq!(session.role, "任务思考");
        assert_eq!(session.status, SessionStatus::Running);

        let fetched = store.get(&session.id).unwrap().unwrap();
        assert_eq!(fetched.id, session.id);
    }

    #[test]
    fn memory_store_list() {
        let store = SessionStore::new();
        store.create(create_input("claude", "Task 1")).unwrap();
        store.create(create_input("codex", "Task 2")).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn memory_store_update() {
        let store = SessionStore::new();
        let session = store.create(create_input("claude", "Original")).unwrap();

        let updated = store
            .update(
                &session.id,
                UpdateSessionInput {
                    role: Some("Updated".to_string()),
                    summary: Some("New summary".to_string()),
                    status: Some(SessionStatus::WaitingInput),
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(updated.role, "Updated");
        assert_eq!(updated.summary, "New summary");
        assert_eq!(updated.status, SessionStatus::WaitingInput);
    }

    #[test]
    fn memory_store_invalid_transition() {
        let store = SessionStore::new();
        let session = store.create(create_input("claude", "Test")).unwrap();
        // Running -> Archived is not valid
        let result = store.update(
            &session.id,
            UpdateSessionInput {
                status: Some(SessionStatus::Archived),
                ..Default::default()
            },
        );
        assert!(matches!(
            result,
            Err(SessionStoreError::InvalidTransition { .. })
        ));
    }

    #[test]
    fn memory_store_delete() {
        let store = SessionStore::new();
        let session = store.create(create_input("claude", "Delete me")).unwrap();
        let deleted = store.delete(&session.id).unwrap();
        assert!(deleted.is_some());
        assert!(store.get(&session.id).unwrap().is_none());
    }

    #[test]
    fn sqlite_store_persists_across_reopen() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("sessions.sqlite");

        let store = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store.create(create_input("claude", "Persist me")).unwrap();
        drop(store);

        let reopened = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened
            .get(&created.id)
            .unwrap()
            .expect("session should persist");
        assert_eq!(loaded.role, "Persist me");
        assert_eq!(loaded.agent_kind, "claude");
        assert_eq!(loaded.context.git_branch.as_deref(), Some("dev"));
        assert_eq!(loaded.context.issue_refs, vec!["#511".to_string()]);
    }

    #[test]
    fn sqlite_store_update_and_status_transition() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("sessions.sqlite");
        let store = SessionStore::with_sqlite_path(&sqlite_path).unwrap();

        let session = store.create(create_input("claude", "Test")).unwrap();
        let updated = store
            .update(
                &session.id,
                UpdateSessionInput {
                    status: Some(SessionStatus::WaitingInput),
                    summary: Some("Waiting for user".to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.status, SessionStatus::WaitingInput);
        assert_eq!(updated.summary, "Waiting for user");
    }

    #[test]
    fn sqlite_store_list_by_status() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("sessions.sqlite");
        let store = SessionStore::with_sqlite_path(&sqlite_path).unwrap();

        store.create(create_input("claude", "Running 1")).unwrap();
        let s2 = store.create(create_input("claude", "Will wait")).unwrap();
        store
            .update(
                &s2.id,
                UpdateSessionInput {
                    status: Some(SessionStatus::WaitingInput),
                    ..Default::default()
                },
            )
            .unwrap();

        let running = store.list_by_status(&SessionStatus::Running).unwrap();
        assert_eq!(running.len(), 1);
        let waiting = store.list_by_status(&SessionStatus::WaitingInput).unwrap();
        assert_eq!(waiting.len(), 1);
    }

    #[test]
    fn memory_store_update_merges_partial_context_patch() {
        let store = SessionStore::new();
        let session = store
            .create(create_input_with_full_context("claude", "Patch context"))
            .unwrap();

        let updated = store
            .update(
                &session.id,
                UpdateSessionInput {
                    context: Some(WorkContextPatch {
                        issue_refs: Some(vec!["#523".to_string()]),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(updated.context.git_branch.as_deref(), Some("dev"));
        assert_eq!(
            updated.context.worktree_path.as_deref(),
            Some("D:/project/exomind-wt-yyxw")
        );
        assert_eq!(updated.context.issue_refs, vec!["#523".to_string()]);
        assert_eq!(updated.context.pr_ref.as_deref(), Some("523"));
        assert_eq!(
            updated.context.labels,
            vec!["runtime".to_string(), "review".to_string()]
        );
    }

    #[test]
    fn sqlite_store_update_merges_partial_context_patch() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("sessions.sqlite");
        let store = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let session = store
            .create(create_input_with_full_context("claude", "Patch context"))
            .unwrap();

        let updated = store
            .update(
                &session.id,
                UpdateSessionInput {
                    context: Some(WorkContextPatch {
                        issue_refs: Some(vec!["#523".to_string()]),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(updated.context.git_branch.as_deref(), Some("dev"));
        assert_eq!(
            updated.context.worktree_path.as_deref(),
            Some("D:/project/exomind-wt-yyxw")
        );
        assert_eq!(updated.context.issue_refs, vec!["#523".to_string()]);
        assert_eq!(updated.context.pr_ref.as_deref(), Some("523"));
        assert_eq!(
            updated.context.labels,
            vec!["runtime".to_string(), "review".to_string()]
        );
    }

    #[test]
    fn memory_store_rejects_duplicate_explicit_id() {
        let store = SessionStore::new();
        let input = CreateSessionInput {
            id: Some("fixed-session-id".to_string()),
            ..create_input("claude", "fixed")
        };

        store.create(input.clone()).unwrap();
        let duplicate = store.create(input).unwrap_err();

        assert!(matches!(
            duplicate,
            SessionStoreError::AlreadyExists(existing_id) if existing_id == "fixed-session-id"
        ));
    }

    #[test]
    fn sqlite_store_rejects_duplicate_explicit_id() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("sessions.sqlite");
        let store = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let input = CreateSessionInput {
            id: Some("fixed-session-id".to_string()),
            ..create_input("claude", "fixed")
        };

        store.create(input.clone()).unwrap();
        let duplicate = store.create(input).unwrap_err();

        assert!(matches!(
            duplicate,
            SessionStoreError::AlreadyExists(existing_id) if existing_id == "fixed-session-id"
        ));
    }

    #[test]
    fn memory_store_persists_agent_id_and_source_host_id() {
        let store = SessionStore::new();
        let session = store
            .create(CreateSessionInput {
                agent_id: Some("codex-runtime-1".to_string()),
                source_host_id: Some("host-logic-1".to_string()),
                ..create_input("codex", "Runtime Codex")
            })
            .unwrap();

        assert_eq!(session.agent_id.as_deref(), Some("codex-runtime-1"));
        assert_eq!(session.source_host_id.as_deref(), Some("host-logic-1"));
    }

    #[test]
    fn sqlite_store_persists_agent_id_and_source_host_id() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("sessions.sqlite");
        let store = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store
            .create(CreateSessionInput {
                agent_id: Some("claude-runtime-1".to_string()),
                source_host_id: Some("desktop-host".to_string()),
                ..create_input("claude", "Runtime Claude")
            })
            .unwrap();
        drop(store);

        let reopened = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened
            .get(&created.id)
            .unwrap()
            .expect("session should persist");
        assert_eq!(loaded.agent_id.as_deref(), Some("claude-runtime-1"));
        assert_eq!(loaded.source_host_id.as_deref(), Some("desktop-host"));

        // Test updating these fields
        let updated = reopened
            .update(
                &created.id,
                UpdateSessionInput {
                    agent_id: Some("claude-runtime-updated".to_string()),
                    source_host_id: Some("server-host-updated".to_string()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(updated.agent_id.as_deref(), Some("claude-runtime-updated"));
        assert_eq!(
            updated.source_host_id.as_deref(),
            Some("server-host-updated")
        );

        drop(reopened);
        let reopened_again = SessionStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded_again = reopened_again
            .get(&created.id)
            .unwrap()
            .expect("session should persist after update");
        assert_eq!(
            loaded_again.agent_id.as_deref(),
            Some("claude-runtime-updated")
        );
        assert_eq!(
            loaded_again.source_host_id.as_deref(),
            Some("server-host-updated")
        );
    }
}
