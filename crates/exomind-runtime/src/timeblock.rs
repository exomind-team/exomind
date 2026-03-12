use std::path::Path;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::timeblock_sqlite::SqliteTimeBlockStore;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimeBlockData {
    pub id: String,
    pub name: String,
    pub start_id: String,
    pub end_id: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub start_time: u64,
    pub end_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBlockData {
    pub start_id: String,
    pub name: String,
    pub mode: String,
    pub target_minutes: Option<u64>,
    pub elapsed: u64,
    pub updated_at: Option<u64>,
    pub phase: Option<String>,
    pub version: Option<u64>,
    pub actor_id: Option<String>,
    pub last_transition_at: Option<u64>,
    pub last_resumed_at: Option<u64>,
    pub accumulated_run_ms: Option<u64>,
    pub start_time: u64,
    pub action_ended_at: Option<u64>,
    pub feedback_started_at: Option<u64>,
    pub feedback_submitted_at: Option<u64>,
    pub pause_accumulated_ms: Option<u64>,
    pub paused: bool,
    pub paused_at: Option<u64>,
    pub task_id: Option<String>,
}

#[derive(Debug, Error)]
pub enum TimeBlockStoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeBlockStoreBackendKind {
    Memory,
    Sqlite,
}

#[derive(Default)]
struct TimeBlockMemoryState {
    completed: Vec<TimeBlockData>,
    active: Option<ActiveBlockData>,
}

enum TimeBlockStoreBackend {
    Memory(RwLock<TimeBlockMemoryState>),
    Sqlite(SqliteTimeBlockStore),
}

pub struct TimeBlockStore {
    backend: TimeBlockStoreBackend,
}

impl TimeBlockStore {
    pub fn new() -> Self {
        Self {
            backend: TimeBlockStoreBackend::Memory(RwLock::new(TimeBlockMemoryState::default())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, TimeBlockStoreError> {
        Ok(Self {
            backend: TimeBlockStoreBackend::Sqlite(SqliteTimeBlockStore::open(path)?),
        })
    }

    pub fn list_completed(&self) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state.read().unwrap().completed.clone()),
            TimeBlockStoreBackend::Sqlite(store) => store.list_completed(),
        }
    }

    pub fn replace_completed(&self, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state.write().unwrap().completed = blocks.to_vec();
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => store.replace_completed(blocks),
        }
    }

    pub fn get_active(&self) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state.read().unwrap().active.clone()),
            TimeBlockStoreBackend::Sqlite(store) => store.get_active(),
        }
    }

    pub fn put_active(&self, block: ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state.write().unwrap().active = Some(block);
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => store.put_active(&block),
        }
    }

    pub fn delete_active(&self) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state.write().unwrap().active = None;
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => store.delete_active(),
        }
    }

    pub fn len_completed(&self) -> Result<usize, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state.read().unwrap().completed.len()),
            TimeBlockStoreBackend::Sqlite(store) => store.len_completed(),
        }
    }

    pub fn sqlite_snapshot_bytes(&self) -> Result<Option<Vec<u8>>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(_) => Ok(None),
            TimeBlockStoreBackend::Sqlite(store) => store.snapshot_bytes().map(Some),
        }
    }

    pub fn backend_kind(&self) -> TimeBlockStoreBackendKind {
        match &self.backend {
            TimeBlockStoreBackend::Memory(_) => TimeBlockStoreBackendKind::Memory,
            TimeBlockStoreBackend::Sqlite(_) => TimeBlockStoreBackendKind::Sqlite,
        }
    }
}

impl Default for TimeBlockStore {
    fn default() -> Self {
        Self::new()
    }
}
