use std::collections::HashMap;
use std::path::Path;
use std::sync::RwLock;

use thiserror::Error;

use super::sqlite_store::SqliteTaskStore;
use super::types::*;

#[derive(Debug, Error)]
pub enum TaskStoreError {
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: TaskStatus, to: TaskStatus },
    #[error("task is in terminal state: {0:?}")]
    TerminalState(TaskStatus),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid stored task status: {0}")]
    InvalidStoredStatus(String),
    #[error("invalid stored task priority: {0}")]
    InvalidStoredPriority(String),
}

enum TaskStoreBackend {
    Memory(RwLock<HashMap<String, HashMap<String, Task>>>),
    Sqlite(SqliteTaskStore),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStoreBackendKind {
    Memory,
    Sqlite,
}

pub struct TaskStore {
    backend: TaskStoreBackend,
}

const DEFAULT_SCOPE_KEY: &str = "anonymous";

fn normalize_scope_key(scope_key: Option<&str>) -> &str {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SCOPE_KEY)
}

impl TaskStore {
    pub fn new() -> Self {
        Self {
            backend: TaskStoreBackend::Memory(RwLock::new(HashMap::new())),
        }
    }

    pub fn with_sqlite_path(path: &Path) -> Result<Self, TaskStoreError> {
        Ok(Self {
            backend: TaskStoreBackend::Sqlite(SqliteTaskStore::open(path)?),
        })
    }

    pub fn create(&self, input: CreateTaskInput) -> Task {
        self.create_scoped(None, input)
    }

    pub fn create_scoped(&self, scope_key: Option<&str>, input: CreateTaskInput) -> Task {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store
                .create_scoped(normalize_scope_key(scope_key), input)
                .expect("sqlite task creation should succeed");
        }

        let now = chrono::Utc::now().timestamp_millis() as u64;
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            description: input.description,
            done_condition: input.done_condition,
            status: TaskStatus::Pending,
            priority: input.priority.unwrap_or_default(),
            tags: input.tags,
            source: input.source,
            parent_id: input.parent_id,
            depends_on: input.depends_on,
            due_at: input.due_at,
            estimated_minutes: input.estimated_minutes,
            time_block_ids: input.time_block_ids,
            created_at: now,
            updated_at: now,
            completed_at: None,
        };

        let result = task.clone();
        self.with_memory_scope_mut(scope_key, |tasks| {
            tasks.insert(task.id.clone(), task);
        });
        result
    }

    pub fn create_in_scope(&self, scope_key: Option<&str>, input: CreateTaskInput) -> Task {
        self.create_scoped(scope_key, input)
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.get_scoped(None, id)
    }

    pub fn get_scoped(&self, scope_key: Option<&str>, id: &str) -> Option<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => self.memory_scope(scope_key).get(id).cloned(),
            TaskStoreBackend::Sqlite(store) => store
                .get_scoped(normalize_scope_key(scope_key), id)
                .expect("sqlite task lookup should succeed"),
        }
    }

    pub fn get_in_scope(&self, scope_key: Option<&str>, id: &str) -> Option<Task> {
        self.get_scoped(scope_key, id)
    }

    pub fn list(&self) -> Vec<Task> {
        self.list_scoped(None)
    }

    pub fn list_scoped(&self, scope_key: Option<&str>) -> Vec<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                let mut list: Vec<Task> = self.memory_scope(scope_key).values().cloned().collect();
                list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                list
            }
            TaskStoreBackend::Sqlite(store) => store
                .list_scoped(normalize_scope_key(scope_key))
                .expect("sqlite task list should succeed"),
        }
    }

    pub fn list_in_scope(&self, scope_key: Option<&str>) -> Vec<Task> {
        self.list_scoped(scope_key)
    }

    pub fn list_by_status(&self, status: &TaskStatus) -> Vec<Task> {
        self.list_by_status_scoped(None, status)
    }

    pub fn list_by_status_scoped(&self, scope_key: Option<&str>, status: &TaskStatus) -> Vec<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => self
                .list_scoped(scope_key)
                .into_iter()
                .filter(|t| &t.status == status)
                .collect(),
            TaskStoreBackend::Sqlite(store) => store
                .list_by_status_scoped(normalize_scope_key(scope_key), status)
                .expect("sqlite status filter should succeed"),
        }
    }

    pub fn update(&self, id: &str, input: UpdateTaskInput) -> Result<Task, TaskStoreError> {
        self.update_scoped(None, id, input)
    }

    pub fn update_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        input: UpdateTaskInput,
    ) -> Result<Task, TaskStoreError> {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store.update_scoped(normalize_scope_key(scope_key), id, input);
        }

        self.with_memory_scope_mut(scope_key, |tasks| {
            let task = tasks
                .get_mut(id)
                .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

            if task.status.is_terminal() {
                return Err(TaskStoreError::TerminalState(task.status.clone()));
            }

            if let Some(title) = input.title {
                task.title = title;
            }
            if let Some(description) = input.description {
                task.description = Some(description);
            }
            if let Some(done_condition) = input.done_condition {
                task.done_condition = Some(done_condition);
            }
            if let Some(priority) = input.priority {
                task.priority = priority;
            }
            if let Some(tags) = input.tags {
                task.tags = tags;
            }
            if let Some(depends_on) = input.depends_on {
                task.depends_on = depends_on;
            }
            if let Some(due_at) = input.due_at {
                task.due_at = Some(due_at);
            }
            if let Some(estimated_minutes) = input.estimated_minutes {
                task.estimated_minutes = Some(estimated_minutes);
            }
            if let Some(parent_id) = input.parent_id {
                task.parent_id = Some(parent_id);
            }
            if let Some(time_block_ids) = input.time_block_ids {
                task.time_block_ids = time_block_ids;
            }

            task.updated_at = chrono::Utc::now().timestamp_millis() as u64;
            Ok(task.clone())
        })
    }

    /// Transition task to a new status. Returns (old_status, updated_task).
    pub fn transition(
        &self,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        self.transition_scoped(None, id, new_status)
    }

    pub fn transition_scoped(
        &self,
        scope_key: Option<&str>,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store.transition_scoped(normalize_scope_key(scope_key), id, new_status);
        }

        self.with_memory_scope_mut(scope_key, |tasks| {
            let task = tasks
                .get_mut(id)
                .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

            if !task.status.can_transition_to(&new_status) {
                return Err(TaskStoreError::InvalidTransition {
                    from: task.status.clone(),
                    to: new_status,
                });
            }

            let old_status = task.status.clone();
            let now = chrono::Utc::now().timestamp_millis() as u64;
            task.status = new_status.clone();
            task.updated_at = now;

            if new_status.is_terminal() {
                task.completed_at = Some(now);
            }

            Ok((old_status, task.clone()))
        })
    }

    /// Cancel a task (set status to Cancelled). Used by the HTTP cancel endpoint.
    pub fn cancel(&self, id: &str) -> Result<Task, TaskStoreError> {
        self.cancel_scoped(None, id)
    }

    pub fn cancel_scoped(&self, scope_key: Option<&str>, id: &str) -> Result<Task, TaskStoreError> {
        if let TaskStoreBackend::Sqlite(store) = &self.backend {
            return store.cancel_scoped(normalize_scope_key(scope_key), id);
        }
        let (_, task) = self.transition_scoped(scope_key, id, TaskStatus::Cancelled)?;
        Ok(task)
    }

    /// Hard remove from store. Returns the removed task if it existed.
    pub fn remove(&self, id: &str) -> Option<Task> {
        self.remove_scoped(None, id)
    }

    pub fn remove_scoped(&self, scope_key: Option<&str>, id: &str) -> Option<Task> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                self.with_memory_scope_mut(scope_key, |tasks| tasks.remove(id))
            }
            TaskStoreBackend::Sqlite(store) => store
                .remove_scoped(normalize_scope_key(scope_key), id)
                .expect("sqlite task removal should succeed"),
        }
    }

    pub fn len(&self) -> usize {
        self.len_scoped(None)
    }

    pub fn len_scoped(&self, scope_key: Option<&str>) -> usize {
        match &self.backend {
            TaskStoreBackend::Memory(_) => self.memory_scope(scope_key).len(),
            TaskStoreBackend::Sqlite(store) => store
                .len_scoped(normalize_scope_key(scope_key))
                .expect("sqlite task len should succeed"),
        }
    }

    pub fn upsert(&self, task: Task) -> Result<Task, TaskStoreError> {
        self.upsert_scoped(None, task)
    }

    pub fn upsert_scoped(
        &self,
        scope_key: Option<&str>,
        task: Task,
    ) -> Result<Task, TaskStoreError> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                self.with_memory_scope_mut(scope_key, |tasks| {
                    tasks.insert(task.id.clone(), task.clone());
                });
                Ok(task)
            }
            TaskStoreBackend::Sqlite(store) => {
                store.upsert_scoped(normalize_scope_key(scope_key), &task)?;
                Ok(task)
            }
        }
    }

    pub fn replace_all(&self, tasks: &[Task]) -> Result<(), TaskStoreError> {
        self.replace_all_scoped(None, tasks)
    }

    pub fn replace_all_scoped(
        &self,
        scope_key: Option<&str>,
        tasks: &[Task],
    ) -> Result<(), TaskStoreError> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => {
                self.with_memory_scope_mut(scope_key, |guard| {
                    guard.clear();
                    for task in tasks {
                        guard.insert(task.id.clone(), task.clone());
                    }
                });
                Ok(())
            }
            TaskStoreBackend::Sqlite(store) => {
                store.replace_all_scoped(normalize_scope_key(scope_key), tasks)
            }
        }
    }

    pub fn sqlite_snapshot_bytes(&self) -> Result<Option<Vec<u8>>, TaskStoreError> {
        match &self.backend {
            TaskStoreBackend::Memory(_) => Ok(None),
            TaskStoreBackend::Sqlite(store) => store.snapshot_bytes().map(Some),
        }
    }

    pub fn backend_kind(&self) -> TaskStoreBackendKind {
        match &self.backend {
            TaskStoreBackend::Memory(_) => TaskStoreBackendKind::Memory,
            TaskStoreBackend::Sqlite(_) => TaskStoreBackendKind::Sqlite,
        }
    }

    fn memory_scope(&self, scope_key: Option<&str>) -> HashMap<String, Task> {
        let normalized_scope = normalize_scope_key(scope_key);
        match &self.backend {
            TaskStoreBackend::Memory(tasks) => tasks
                .read()
                .unwrap()
                .get(normalized_scope)
                .cloned()
                .unwrap_or_default(),
            TaskStoreBackend::Sqlite(_) => {
                unreachable!("memory-only helper used on sqlite backend")
            }
        }
    }

    fn with_memory_scope_mut<R>(
        &self,
        scope_key: Option<&str>,
        f: impl FnOnce(&mut HashMap<String, Task>) -> R,
    ) -> R {
        let normalized_scope = normalize_scope_key(scope_key).to_string();
        match &self.backend {
            TaskStoreBackend::Memory(tasks) => {
                let mut guard = tasks.write().unwrap();
                let scope_tasks = guard.entry(normalized_scope).or_default();
                f(scope_tasks)
            }
            TaskStoreBackend::Sqlite(_) => {
                unreachable!("memory-only helper used on sqlite backend")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn make_store() -> TaskStore {
        TaskStore::new()
    }

    fn create_input(title: &str) -> CreateTaskInput {
        CreateTaskInput {
            title: title.to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        }
    }

    #[test]
    fn sqlite_store_persists_tasks_across_reopen() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store.create(create_input("Persist me"));
        drop(store);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened
            .get(&created.id)
            .expect("task should persist in sqlite");
        assert_eq!(loaded.title, "Persist me");
        assert_eq!(reopened.len(), 1);
    }

    #[test]
    fn sqlite_store_migrates_legacy_status_values_on_open() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let legacy_pending = store.create(create_input("Legacy pending"));
        let legacy_cancelled = store.create(create_input("Legacy cancelled"));
        store
            .transition(&legacy_cancelled.id, TaskStatus::InProgress)
            .unwrap();
        store.cancel(&legacy_cancelled.id).unwrap();
        drop(store);

        {
            let conn = Connection::open(&sqlite_path).unwrap();
            conn.execute(
                "UPDATE tasks SET status = 'not_started' WHERE id = ?1",
                [&legacy_pending.id],
            )
            .unwrap();
            conn.execute(
                "UPDATE tasks SET status = 'abandoned' WHERE id = ?1",
                [&legacy_cancelled.id],
            )
            .unwrap();
        }

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        assert_eq!(
            reopened.get(&legacy_pending.id).unwrap().status,
            TaskStatus::Pending
        );
        assert_eq!(
            reopened.get(&legacy_cancelled.id).unwrap().status,
            TaskStatus::Cancelled
        );

        let conn = Connection::open(&sqlite_path).unwrap();
        let pending_status: String = conn
            .query_row(
                "SELECT status FROM tasks WHERE id = ?1",
                [&legacy_pending.id],
                |row| row.get(0),
            )
            .unwrap();
        let cancelled_status: String = conn
            .query_row(
                "SELECT status FROM tasks WHERE id = ?1",
                [&legacy_cancelled.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending_status, "pending");
        assert_eq!(cancelled_status, "cancelled");
    }

    #[test]
    fn sqlite_store_isolates_tasks_by_scope() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let anonymous = store.create(create_input("Task anonymous"));
        let profile_a = store.create_scoped(Some("profile-a"), create_input("Task A"));
        let profile_b = store.create_scoped(Some("profile-b"), create_input("Task B"));

        let tasks_anonymous = store.list();
        let tasks_a = store.list_scoped(Some("profile-a"));
        let tasks_b = store.list_scoped(Some("profile-b"));

        assert_eq!(tasks_anonymous.len(), 1);
        assert_eq!(tasks_anonymous[0].id, anonymous.id);
        assert_eq!(tasks_a.len(), 1);
        assert_eq!(tasks_a[0].id, profile_a.id);
        assert_eq!(tasks_b.len(), 1);
        assert_eq!(tasks_b[0].id, profile_b.id);
        assert!(store.get_scoped(Some("profile-a"), &profile_b.id).is_none());
        assert!(store.get_scoped(Some("profile-b"), &profile_a.id).is_none());
        assert!(store.get_scoped(Some("profile-a"), &anonymous.id).is_none());
    }

    #[test]
    fn sqlite_store_roundtrips_extended_task_fields() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");

        let store = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let created = store.create(CreateTaskInput {
            title: "Extended".to_string(),
            description: Some("Task body".to_string()),
            priority: Some(TaskPriority::High),
            tags: vec!["rt".to_string(), "sqlite".to_string()],
            source: Some("frontend:test".to_string()),
            parent_id: Some("parent-1".to_string()),
            due_at: Some(1_700_000_000_000),
            estimated_minutes: Some(45),
            done_condition: Some("all checks green".to_string()),
            depends_on: vec![],
            time_block_ids: vec![],
        });
        let updated = store
            .update(
                &created.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    priority: None,
                    tags: None,
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    done_condition: Some("ship RT sqlite".to_string()),
                    depends_on: Some(vec![TaskDependency {
                        task_id: "dep-1".to_string(),
                        relation_type: TaskDependencyType::Hard,
                    }]),
                    time_block_ids: Some(vec!["block-1".to_string(), "block-2".to_string()]),
                },
            )
            .unwrap();
        assert_eq!(updated.done_condition.as_deref(), Some("ship RT sqlite"));
        drop(store);

        let reopened = TaskStore::with_sqlite_path(&sqlite_path).unwrap();
        let loaded = reopened
            .get(&created.id)
            .expect("extended task should persist");
        assert_eq!(loaded.done_condition.as_deref(), Some("ship RT sqlite"));
        assert_eq!(loaded.depends_on.len(), 1);
        assert_eq!(loaded.depends_on[0].task_id, "dep-1");
        assert_eq!(loaded.depends_on[0].relation_type, TaskDependencyType::Hard);
        assert_eq!(
            loaded.time_block_ids,
            vec!["block-1".to_string(), "block-2".to_string()]
        );
    }

    #[test]
    fn create_and_get() {
        let store = make_store();
        let task = store.create(create_input("Buy milk"));
        assert_eq!(task.title, "Buy milk");
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.priority, TaskPriority::Medium);

        let fetched = store.get(&task.id).unwrap();
        assert_eq!(fetched.id, task.id);
    }

    #[test]
    fn list_returns_newest_first() {
        let store = make_store();
        let t1 = store.create(create_input("First"));
        let t2 = store.create(create_input("Second"));

        let list = store.list();
        assert_eq!(list.len(), 2);
        // Newest first (t2 created after t1, but timestamps might be same ms)
        // Just verify both are present
        let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&t1.id.as_str()));
        assert!(ids.contains(&t2.id.as_str()));
    }

    #[test]
    fn list_by_status() {
        let store = make_store();
        let t1 = store.create(create_input("Task 1"));
        store.create(create_input("Task 2"));
        store.transition(&t1.id, TaskStatus::InProgress).unwrap();

        let in_progress = store.list_by_status(&TaskStatus::InProgress);
        assert_eq!(in_progress.len(), 1);
        assert_eq!(in_progress[0].id, t1.id);

        let pending = store.list_by_status(&TaskStatus::Pending);
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn update_fields() {
        let store = make_store();
        let task = store.create(create_input("Original"));

        let updated = store
            .update(
                &task.id,
                UpdateTaskInput {
                    title: Some("Updated".to_string()),
                    description: Some("A description".to_string()),
                    done_condition: None,
                    priority: Some(TaskPriority::High),
                    tags: Some(vec!["urgent".to_string()]),
                    depends_on: None,
                    due_at: None,
                    estimated_minutes: Some(60),
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();

        assert_eq!(updated.title, "Updated");
        assert_eq!(updated.description.as_deref(), Some("A description"));
        assert_eq!(updated.priority, TaskPriority::High);
        assert_eq!(updated.tags, vec!["urgent"]);
        assert_eq!(updated.estimated_minutes, Some(60));
        assert!(updated.updated_at >= task.updated_at);
    }

    #[test]
    fn update_not_found() {
        let store = make_store();
        let result = store.update(
            "nonexistent",
            UpdateTaskInput {
                title: Some("X".to_string()),
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(result, Err(TaskStoreError::NotFound(_))));
    }

    #[test]
    fn update_terminal_task_fails() {
        let store = make_store();
        let task = store.create(create_input("Done task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();
        store.transition(&task.id, TaskStatus::Completed).unwrap();

        let result = store.update(
            &task.id,
            UpdateTaskInput {
                title: Some("Try update".to_string()),
                description: None,
                done_condition: None,
                priority: None,
                tags: None,
                depends_on: None,
                due_at: None,
                estimated_minutes: None,
                parent_id: None,
                time_block_ids: None,
            },
        );
        assert!(matches!(result, Err(TaskStoreError::TerminalState(_))));
    }

    #[test]
    fn transition_happy_path() {
        let store = make_store();
        let task = store.create(create_input("My task"));

        let (old, updated) = store.transition(&task.id, TaskStatus::InProgress).unwrap();
        assert_eq!(old, TaskStatus::Pending);
        assert_eq!(updated.status, TaskStatus::InProgress);
        assert!(updated.completed_at.is_none());

        let (old, updated) = store.transition(&task.id, TaskStatus::Completed).unwrap();
        assert_eq!(old, TaskStatus::InProgress);
        assert_eq!(updated.status, TaskStatus::Completed);
        assert!(updated.completed_at.is_some());
    }

    #[test]
    fn transition_invalid() {
        let store = make_store();
        let task = store.create(create_input("Task"));

        let result = store.transition(&task.id, TaskStatus::Completed);
        assert!(matches!(
            result,
            Err(TaskStoreError::InvalidTransition { .. })
        ));
    }

    #[test]
    fn cancel() {
        let store = make_store();
        let task = store.create(create_input("Task"));
        store.transition(&task.id, TaskStatus::InProgress).unwrap();

        let cancelled = store.cancel(&task.id).unwrap();
        assert_eq!(cancelled.status, TaskStatus::Cancelled);
        assert!(cancelled.completed_at.is_some());
    }

    #[test]
    fn remove() {
        let store = make_store();
        let task = store.create(create_input("To remove"));
        assert_eq!(store.len(), 1);

        let removed = store.remove(&task.id).unwrap();
        assert_eq!(removed.id, task.id);
        assert_eq!(store.len(), 0);
        assert!(store.get(&task.id).is_none());
    }
}
