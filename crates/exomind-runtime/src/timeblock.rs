use std::path::Path;
use std::collections::HashMap;
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
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub start_time: u64,
    pub end_time: u64,
    #[serde(default)]
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub task_status_outcomes: Option<HashMap<String, String>>,
    #[serde(default)]
    pub task_association_log: Vec<BlockTaskAssociationEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockTaskAssociationEvent {
    pub block_id: String,
    pub task_id: String,
    pub action: String,
    pub timestamp: u64,
    pub source: String,
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
    #[serde(default)]
    pub task_ids: Vec<String>,
    #[serde(default)]
    pub task_association_log: Vec<BlockTaskAssociationEvent>,
    /// Deprecated: legacy single-task field. Read for compat, never written.
    #[serde(default, skip_serializing)]
    pub task_id: Option<String>,
}

impl ActiveBlockData {
    pub fn normalize_task_ids(mut self) -> Self {
        if self.task_ids.is_empty() {
            let task_ids_from_log = current_task_ids_from_log(&self.task_association_log);
            if !task_ids_from_log.is_empty() {
                self.task_ids = task_ids_from_log;
                return self;
            }
            if let Some(task_id) = self
                .task_id
                .clone()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                self.task_ids = vec![task_id];
            }
        }
        self
    }
}

fn current_task_ids_from_log(task_association_log: &[BlockTaskAssociationEvent]) -> Vec<String> {
    let mut ordered_task_ids: Vec<String> = Vec::new();
    let mut active_task_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for event in task_association_log {
        let task_id = event.task_id.trim();
        if task_id.is_empty() {
            continue;
        }

        if event.action == "associated" {
            if active_task_ids.insert(task_id.to_string()) {
                ordered_task_ids.push(task_id.to_string());
            }
            continue;
        }

        active_task_ids.remove(task_id);
    }

    ordered_task_ids
        .into_iter()
        .filter(|task_id| active_task_ids.contains(task_id))
        .collect()
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
struct TimeBlockScopeState {
    completed: Vec<TimeBlockData>,
    active: Option<ActiveBlockData>,
}

enum TimeBlockStoreBackend {
    Memory(RwLock<HashMap<String, TimeBlockScopeState>>),
    Sqlite(SqliteTimeBlockStore),
}

pub struct TimeBlockStore {
    backend: TimeBlockStoreBackend,
}

const DEFAULT_SCOPE_KEY: &str = "anonymous";

fn normalize_scope_key(scope_key: Option<&str>) -> &str {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCOPE_KEY)
}

impl TimeBlockStore {
    pub fn new() -> Self {
        Self {
            backend: TimeBlockStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, TimeBlockStoreError> {
        Ok(Self {
            backend: TimeBlockStoreBackend::Sqlite(SqliteTimeBlockStore::open(path)?),
        })
    }

    pub fn list_completed(&self) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        self.list_completed_scoped(None)
    }

    pub fn list_completed_scoped(&self, scope_key: Option<&str>) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .map(|scope| scope.completed.clone())
                .unwrap_or_default()),
            TimeBlockStoreBackend::Sqlite(store) => store.list_completed_scoped(normalize_scope_key(scope_key)),
        }
    }

    pub fn list_completed_in_scope(&self, scope_key: Option<&str>) -> Result<Vec<TimeBlockData>, TimeBlockStoreError> {
        self.list_completed_scoped(scope_key)
    }

    pub fn replace_completed(&self, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        self.replace_completed_scoped(None, blocks)
    }

    pub fn replace_completed_scoped(&self, scope_key: Option<&str>, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state
                    .write()
                    .unwrap()
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default()
                    .completed = blocks.to_vec();
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => store.replace_completed_scoped(normalize_scope_key(scope_key), blocks),
        }
    }

    pub fn replace_completed_in_scope(&self, scope_key: Option<&str>, blocks: &[TimeBlockData]) -> Result<(), TimeBlockStoreError> {
        self.replace_completed_scoped(scope_key, blocks)
    }

    pub fn get_active(&self) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        self.get_active_scoped(None)
    }

    pub fn get_active_scoped(&self, scope_key: Option<&str>) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .and_then(|scope| scope.active.clone().map(ActiveBlockData::normalize_task_ids))),
            TimeBlockStoreBackend::Sqlite(store) => store.get_active_scoped(normalize_scope_key(scope_key)),
        }
    }

    pub fn get_active_in_scope(&self, scope_key: Option<&str>) -> Result<Option<ActiveBlockData>, TimeBlockStoreError> {
        self.get_active_scoped(scope_key)
    }

    pub fn put_active(&self, block: ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        self.put_active_scoped(None, block)
    }

    pub fn put_active_scoped(&self, scope_key: Option<&str>, block: ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                state
                    .write()
                    .unwrap()
                    .entry(normalize_scope_key(scope_key).to_string())
                    .or_default()
                    .active = Some(block.normalize_task_ids());
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => store.put_active_scoped(normalize_scope_key(scope_key), &block),
        }
    }

    pub fn put_active_in_scope(&self, scope_key: Option<&str>, block: ActiveBlockData) -> Result<(), TimeBlockStoreError> {
        self.put_active_scoped(scope_key, block)
    }

    pub fn delete_active(&self) -> Result<(), TimeBlockStoreError> {
        self.delete_active_scoped(None)
    }

    pub fn delete_active_scoped(&self, scope_key: Option<&str>) -> Result<(), TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => {
                if let Some(scope) = state.write().unwrap().get_mut(normalize_scope_key(scope_key)) {
                    scope.active = None;
                }
                Ok(())
            }
            TimeBlockStoreBackend::Sqlite(store) => store.delete_active_scoped(normalize_scope_key(scope_key)),
        }
    }

    pub fn delete_active_in_scope(&self, scope_key: Option<&str>) -> Result<(), TimeBlockStoreError> {
        self.delete_active_scoped(scope_key)
    }

    pub fn len_completed(&self) -> Result<usize, TimeBlockStoreError> {
        self.len_completed_scoped(None)
    }

    pub fn len_completed_scoped(&self, scope_key: Option<&str>) -> Result<usize, TimeBlockStoreError> {
        match &self.backend {
            TimeBlockStoreBackend::Memory(state) => Ok(state
                .read()
                .unwrap()
                .get(normalize_scope_key(scope_key))
                .map(|scope| scope.completed.len())
                .unwrap_or(0)),
            TimeBlockStoreBackend::Sqlite(store) => store.len_completed_scoped(normalize_scope_key(scope_key)),
        }
    }

    pub fn len_completed_in_scope(&self, scope_key: Option<&str>) -> Result<usize, TimeBlockStoreError> {
        self.len_completed_scoped(scope_key)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn sqlite_store_isolates_timeblocks_by_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks.sqlite");
        let store = TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap();

        store.replace_completed_scoped(Some("profile-a"), &[TimeBlockData {
            id: "tb-a".to_string(),
            name: "A".to_string(),
            start_id: "start-a".to_string(),
            end_id: "end-a".to_string(),
            note: None,
            tags: vec!["block_feedback".to_string()],
            start_time: 1,
            end_time: 2,
            task_ids: vec!["task-a".to_string()],
            task_status_outcomes: Some(HashMap::from([("task-a".to_string(), "continue".to_string())])),
            task_association_log: vec![BlockTaskAssociationEvent {
                block_id: "tb-a".to_string(),
                task_id: "task-a".to_string(),
                action: "associated".to_string(),
                timestamp: 1,
                source: "block_start".to_string(),
            }],
        }]).unwrap();
        store.replace_completed_scoped(Some("profile-b"), &[TimeBlockData {
            id: "tb-b".to_string(),
            name: "B".to_string(),
            start_id: "start-b".to_string(),
            end_id: "end-b".to_string(),
            note: None,
            tags: vec!["block_feedback".to_string()],
            start_time: 3,
            end_time: 4,
            task_ids: vec![],
            task_status_outcomes: None,
            task_association_log: vec![],
        }]).unwrap();

        store.put_active_scoped(Some("profile-a"), ActiveBlockData {
            start_id: "active-a".to_string(),
            name: "Active A".to_string(),
            mode: "countup".to_string(),
            target_minutes: None,
            elapsed: 100,
            updated_at: None,
            phase: Some("running".to_string()),
            version: Some(1),
            actor_id: None,
            last_transition_at: None,
            last_resumed_at: None,
            accumulated_run_ms: None,
            start_time: 10,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: None,
            paused: false,
            paused_at: None,
            task_ids: vec!["task-a".to_string()],
            task_association_log: vec![BlockTaskAssociationEvent {
                block_id: "active-a".to_string(),
                task_id: "task-a".to_string(),
                action: "associated".to_string(),
                timestamp: 10,
                source: "block_start".to_string(),
            }],
            task_id: None,
        }).unwrap();

        let completed_a = store.list_completed_scoped(Some("profile-a")).unwrap();
        let completed_b = store.list_completed_scoped(Some("profile-b")).unwrap();
        let active_a = store.get_active_scoped(Some("profile-a")).unwrap();
        let active_b = store.get_active_scoped(Some("profile-b")).unwrap();

        assert_eq!(completed_a.len(), 1);
        assert_eq!(completed_a[0].id, "tb-a");
        assert_eq!(completed_a[0].task_ids, vec!["task-a".to_string()]);
        assert_eq!(completed_b.len(), 1);
        assert_eq!(completed_b[0].id, "tb-b");
        assert_eq!(active_a.as_ref().map(|block| block.start_id.as_str()), Some("active-a"));
        assert_eq!(active_a.as_ref().map(|block| block.task_ids.clone()), Some(vec!["task-a".to_string()]));
        assert!(active_b.is_none());
    }

    #[test]
    fn active_block_promotes_legacy_task_id_to_task_ids() {
        let block: ActiveBlockData = serde_json::from_value(json!({
            "startId": "legacy-active",
            "name": "Legacy active",
            "mode": "countup",
            "elapsed": 10,
            "paused": false,
            "startTime": 123,
            "taskId": "legacy-task",
        }))
        .unwrap();

        let normalized = block.normalize_task_ids();
        let serialized = serde_json::to_value(&normalized).unwrap();

        assert_eq!(normalized.task_ids, vec!["legacy-task".to_string()]);
        assert_eq!(serialized["taskIds"], json!(["legacy-task"]));
        assert!(serialized.get("taskId").is_none());
    }

    #[test]
    fn active_block_recovers_task_ids_from_association_log() {
        let block: ActiveBlockData = serde_json::from_value(json!({
            "startId": "log-active",
            "name": "Log active",
            "mode": "countup",
            "elapsed": 10,
            "paused": false,
            "startTime": 123,
            "taskAssociationLog": [
                {
                    "blockId": "log-active",
                    "taskId": "task-1",
                    "action": "associated",
                    "timestamp": 1,
                    "source": "block_start"
                },
                {
                    "blockId": "log-active",
                    "taskId": "task-2",
                    "action": "associated",
                    "timestamp": 2,
                    "source": "manual"
                },
                {
                    "blockId": "log-active",
                    "taskId": "task-1",
                    "action": "disassociated",
                    "timestamp": 3,
                    "source": "manual"
                }
            ]
        }))
        .unwrap();

        let normalized = block.normalize_task_ids();
        let serialized = serde_json::to_value(&normalized).unwrap();

        assert_eq!(normalized.task_ids, vec!["task-2".to_string()]);
        assert_eq!(serialized["taskIds"], json!(["task-2"]));
        assert!(serialized.get("taskId").is_none());
    }
}
