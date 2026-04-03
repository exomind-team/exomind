use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

use thiserror::Error;

use super::sqlite_store::SqliteReminderStore;
use super::types::{CreateReminderInput, Reminder, ReminderStatus, UpdateReminderInput};

#[derive(Debug, Error)]
pub enum ReminderStoreError {
    #[error("reminder not found: {0}")]
    NotFound(String),
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: ReminderStatus,
        to: ReminderStatus,
    },
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid stored reminder status: {0}")]
    InvalidStoredStatus(String),
}

enum ReminderStoreBackend {
    Memory(RwLock<HashMap<String, HashMap<String, Reminder>>>),
    Sqlite(SqliteReminderStore),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReminderStoreBackendKind {
    Memory,
    Sqlite,
}

pub struct ReminderStore {
    backend: ReminderStoreBackend,
}

const DEFAULT_SCOPE_KEY: &str = "anonymous";

fn normalize_scope_key(scope_key: Option<&str>) -> &str {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCOPE_KEY)
}

impl Default for ReminderStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ReminderStore {
    pub fn new() -> Self {
        Self {
            backend: ReminderStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, ReminderStoreError> {
        Ok(Self {
            backend: ReminderStoreBackend::Sqlite(SqliteReminderStore::open(path)?),
        })
    }

    pub fn list_scoped(
        &self,
        scope_key: Option<&str>,
        status: Option<ReminderStatus>,
    ) -> Vec<Reminder> {
        match &self.backend {
            ReminderStoreBackend::Sqlite(store) => store
                .list_scoped(normalize_scope_key(scope_key), status)
                .unwrap_or_default(),
            ReminderStoreBackend::Memory(entries) => {
                let mut items = entries
                    .read()
                    .unwrap()
                    .get(normalize_scope_key(scope_key))
                    .cloned()
                    .unwrap_or_default()
                    .into_values()
                    .filter(|reminder| status.is_none_or(|value| reminder.status == value))
                    .collect::<Vec<_>>();
                items.sort_by_key(|reminder| (reminder.due_at, reminder.created_at));
                items
            }
        }
    }

    pub fn get_scoped(&self, scope_key: Option<&str>, id: &str) -> Option<Reminder> {
        match &self.backend {
            ReminderStoreBackend::Sqlite(store) => store
                .get_scoped(normalize_scope_key(scope_key), id)
                .ok()
                .flatten(),
            ReminderStoreBackend::Memory(entries) => entries
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .and_then(|scope| scope.get(id).cloned()),
        }
    }

    pub fn create_scoped(&self, scope_key: Option<&str>, input: CreateReminderInput) -> Reminder {
        if let ReminderStoreBackend::Sqlite(store) = &self.backend {
            return store
                .create_scoped(normalize_scope_key(scope_key), input)
                .expect("sqlite reminder create should succeed");
        }

        let now = chrono::Utc::now().timestamp_millis() as u64;
        let reminder = Reminder {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            content: input.content,
            due_at: input.due_at,
            status: ReminderStatus::Pending,
            created_at: now,
            updated_at: now,
            completed_at: None,
        };
        self.with_memory_scope_mut(scope_key, |scope| {
            scope.insert(reminder.id.clone(), reminder.clone());
        });
        reminder
    }

    pub fn update_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        input: UpdateReminderInput,
    ) -> Result<Option<Reminder>, ReminderStoreError> {
        if let ReminderStoreBackend::Sqlite(store) = &self.backend {
            return store.update_scoped(normalize_scope_key(scope_key), id, input);
        }

        let mut updated = None;
        self.with_memory_scope_mut(scope_key, |scope| {
            if let Some(reminder) = scope.get_mut(id) {
                if let Some(title) = input.title {
                    reminder.title = title;
                }
                if let Some(content) = input.content {
                    reminder.content = content;
                }
                if let Some(due_at) = input.due_at {
                    reminder.due_at = due_at;
                }
                reminder.updated_at = chrono::Utc::now().timestamp_millis() as u64;
                updated = Some(reminder.clone());
            }
        });
        Ok(updated)
    }

    pub fn transition_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        to: ReminderStatus,
        at: u64,
    ) -> Result<Option<Reminder>, ReminderStoreError> {
        if let ReminderStoreBackend::Sqlite(store) = &self.backend {
            return store.transition_scoped(normalize_scope_key(scope_key), id, to, at);
        }

        let mut updated = None;
        let mut transition_error = None;
        self.with_memory_scope_mut(scope_key, |scope| {
            if let Some(reminder) = scope.get_mut(id) {
                if !reminder.status.can_transition_to(to) && reminder.status != to {
                    transition_error = Some(ReminderStoreError::InvalidTransition {
                        from: reminder.status,
                        to,
                    });
                    return;
                }
                reminder.status = to;
                reminder.updated_at = at;
                if to == ReminderStatus::Completed {
                    reminder.completed_at = Some(at);
                }
                updated = Some(reminder.clone());
            }
        });

        if let Some(error) = transition_error {
            return Err(error);
        }

        Ok(updated)
    }

    pub fn upsert_scoped(
        &self,
        scope_key: Option<&str>,
        reminder: &Reminder,
    ) -> Result<(), ReminderStoreError> {
        if let ReminderStoreBackend::Sqlite(store) = &self.backend {
            return store.upsert_scoped(normalize_scope_key(scope_key), reminder);
        }

        self.with_memory_scope_mut(scope_key, |scope| {
            scope.insert(reminder.id.clone(), reminder.clone());
        });
        Ok(())
    }

    pub fn backend_kind(&self) -> ReminderStoreBackendKind {
        match &self.backend {
            ReminderStoreBackend::Memory(_) => ReminderStoreBackendKind::Memory,
            ReminderStoreBackend::Sqlite(_) => ReminderStoreBackendKind::Sqlite,
        }
    }

    fn with_memory_scope_mut(
        &self,
        scope_key: Option<&str>,
        f: impl FnOnce(&mut HashMap<String, Reminder>),
    ) {
        match &self.backend {
            ReminderStoreBackend::Memory(entries) => {
                let mut guard = entries.write().unwrap();
                let scope = guard
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default();
                f(scope);
            }
            ReminderStoreBackend::Sqlite(_) => {
                unreachable!("memory reminder mutation on sqlite backend")
            }
        }
    }
}
