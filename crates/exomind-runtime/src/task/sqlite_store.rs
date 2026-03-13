use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

use super::store::TaskStoreError;
use super::types::{CreateTaskInput, Task, TaskDependency, TaskPriority, TaskStatus, UpdateTaskInput};

const DEFAULT_SCOPE_KEY: &str = "anonymous";

pub struct SqliteTaskStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl SqliteTaskStore {
    pub fn open(path: &Path) -> Result<Self, TaskStoreError> {
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

    pub fn create(&self, input: CreateTaskInput) -> Result<Task, TaskStoreError> {
        self.create_scoped(DEFAULT_SCOPE_KEY, input)
    }

    pub fn create_scoped(&self, scope_key: &str, input: CreateTaskInput) -> Result<Task, TaskStoreError> {
        let now = chrono::Utc::now().timestamp_millis() as u64;
        let task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            description: input.description,
            done_condition: input.done_condition,
            status: TaskStatus::NotStarted,
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

        self.insert_task(scope_key, &task)?;
        Ok(task)
    }

    pub fn get(&self, id: &str) -> Result<Option<Task>, TaskStoreError> {
        self.get_scoped(DEFAULT_SCOPE_KEY, id)
    }

    pub fn get_scoped(&self, scope_key: &str, id: &str) -> Result<Option<Task>, TaskStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT
                id, title, description, done_condition, status, priority, tags_json, source,
                parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                created_at, updated_at, completed_at
             FROM tasks
             WHERE scope_key = ?1 AND id = ?2",
        )?;

        statement
            .query_row(params![normalize_scope_key(scope_key), id], map_task_row)
            .optional()
            .map_err(TaskStoreError::from)
    }

    pub fn list(&self) -> Result<Vec<Task>, TaskStoreError> {
        self.list_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn list_scoped(&self, scope_key: &str) -> Result<Vec<Task>, TaskStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT
                id, title, description, done_condition, status, priority, tags_json, source,
                parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                created_at, updated_at, completed_at
             FROM tasks
             WHERE scope_key = ?1
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = statement.query_map(params![normalize_scope_key(scope_key)], map_task_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(TaskStoreError::from)
    }

    pub fn list_by_status(&self, status: &TaskStatus) -> Result<Vec<Task>, TaskStoreError> {
        self.list_by_status_scoped(DEFAULT_SCOPE_KEY, status)
    }

    pub fn list_by_status_scoped(&self, scope_key: &str, status: &TaskStatus) -> Result<Vec<Task>, TaskStoreError> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT
                id, title, description, done_condition, status, priority, tags_json, source,
                parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                created_at, updated_at, completed_at
             FROM tasks
             WHERE scope_key = ?1 AND status = ?2
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = statement.query_map(params![normalize_scope_key(scope_key), task_status_to_db(status)], map_task_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(TaskStoreError::from)
    }

    pub fn update(&self, id: &str, input: UpdateTaskInput) -> Result<Task, TaskStoreError> {
        self.update_scoped(DEFAULT_SCOPE_KEY, id, input)
    }

    pub fn update_scoped(&self, scope_key: &str, id: &str, input: UpdateTaskInput) -> Result<Task, TaskStoreError> {
        let mut task = self
            .get_scoped(scope_key, id)?
            .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

        if task.status.is_terminal() {
            return Err(TaskStoreError::TerminalState(task.status));
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

        self.persist_task(scope_key, &task)?;
        Ok(task)
    }

    pub fn transition(
        &self,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        self.transition_scoped(DEFAULT_SCOPE_KEY, id, new_status)
    }

    pub fn transition_scoped(
        &self,
        scope_key: &str,
        id: &str,
        new_status: TaskStatus,
    ) -> Result<(TaskStatus, Task), TaskStoreError> {
        let mut task = self
            .get_scoped(scope_key, id)?
            .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

        if !task.status.can_transition_to(&new_status) {
            return Err(TaskStoreError::InvalidTransition {
                from: task.status,
                to: new_status,
            });
        }

        let old_status = task.status;
        let now = chrono::Utc::now().timestamp_millis() as u64;
        task.status = new_status;
        task.updated_at = now;
        task.completed_at = task.status.is_terminal().then_some(now);

        self.persist_task(scope_key, &task)?;
        Ok((old_status, task))
    }

    pub fn abandon(&self, id: &str) -> Result<Task, TaskStoreError> {
        self.abandon_scoped(DEFAULT_SCOPE_KEY, id)
    }

    pub fn abandon_scoped(&self, scope_key: &str, id: &str) -> Result<Task, TaskStoreError> {
        let (_, task) = self.transition_scoped(scope_key, id, TaskStatus::Abandoned)?;
        Ok(task)
    }

    pub fn remove(&self, id: &str) -> Result<Option<Task>, TaskStoreError> {
        self.remove_scoped(DEFAULT_SCOPE_KEY, id)
    }

    pub fn remove_scoped(&self, scope_key: &str, id: &str) -> Result<Option<Task>, TaskStoreError> {
        let existing = self.get_scoped(scope_key, id)?;
        if existing.is_none() {
            return Ok(None);
        }

        let connection = self.connection();
        connection.execute(
            "DELETE FROM tasks WHERE scope_key = ?1 AND id = ?2",
            params![normalize_scope_key(scope_key), id],
        )?;
        Ok(existing)
    }

    pub fn len(&self) -> Result<usize, TaskStoreError> {
        self.len_scoped(DEFAULT_SCOPE_KEY)
    }

    pub fn len_scoped(&self, scope_key: &str) -> Result<usize, TaskStoreError> {
        let connection = self.connection();
        let count: i64 = connection.query_row(
            "SELECT COUNT(1) FROM tasks WHERE scope_key = ?1",
            params![normalize_scope_key(scope_key)],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn upsert(&self, task: &Task) -> Result<(), TaskStoreError> {
        self.upsert_scoped(DEFAULT_SCOPE_KEY, task)
    }

    pub fn upsert_scoped(&self, scope_key: &str, task: &Task) -> Result<(), TaskStoreError> {
        let connection = self.connection();
        connection.execute(
            "INSERT INTO tasks (
                scope_key, id, title, description, done_condition, status, priority, tags_json, source,
                parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                created_at, updated_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(scope_key, id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                done_condition = excluded.done_condition,
                status = excluded.status,
                priority = excluded.priority,
                tags_json = excluded.tags_json,
                source = excluded.source,
                parent_id = excluded.parent_id,
                depends_on_json = excluded.depends_on_json,
                due_at = excluded.due_at,
                estimated_minutes = excluded.estimated_minutes,
                time_block_ids_json = excluded.time_block_ids_json,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                completed_at = excluded.completed_at",
            params![
                normalize_scope_key(scope_key),
                task.id,
                task.title,
                task.description,
                task.done_condition,
                task_status_to_db(&task.status),
                task_priority_to_db(&task.priority),
                serde_json::to_string(&task.tags)?,
                task.source,
                task.parent_id,
                serde_json::to_string(&task.depends_on)?,
                task.due_at,
                task.estimated_minutes,
                serde_json::to_string(&task.time_block_ids)?,
                task.created_at,
                task.updated_at,
                task.completed_at,
            ],
        )?;
        Ok(())
    }

    pub fn replace_all(&self, tasks: &[Task]) -> Result<(), TaskStoreError> {
        self.replace_all_scoped(DEFAULT_SCOPE_KEY, tasks)
    }

    pub fn replace_all_scoped(&self, scope_key: &str, tasks: &[Task]) -> Result<(), TaskStoreError> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        tx.execute(
            "DELETE FROM tasks WHERE scope_key = ?1",
            params![normalize_scope_key(scope_key)],
        )?;
        for task in tasks {
            insert_task_in_transaction(&tx, scope_key, task)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn snapshot_bytes(&self) -> Result<Vec<u8>, TaskStoreError> {
        std::fs::read(&self.path).map_err(TaskStoreError::from)
    }

    fn init(&self) -> Result<(), TaskStoreError> {
        let connection = self.connection();
        let has_tasks_table: bool = connection.query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
            [],
            |row| Ok(row.get::<_, i64>(0)? > 0),
        )?;

        if has_tasks_table {
            let mut statement = connection.prepare("PRAGMA table_info(tasks)")?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;

            if !columns.iter().any(|column| column == "scope_key") {
                connection.execute_batch(
                    "ALTER TABLE tasks RENAME TO tasks_legacy;
                     CREATE TABLE tasks (
                        scope_key TEXT NOT NULL,
                        id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        description TEXT NULL,
                        done_condition TEXT NULL,
                        status TEXT NOT NULL,
                        priority TEXT NOT NULL,
                        tags_json TEXT NOT NULL,
                        source TEXT NULL,
                        parent_id TEXT NULL,
                        depends_on_json TEXT NOT NULL,
                        due_at INTEGER NULL,
                        estimated_minutes INTEGER NULL,
                        time_block_ids_json TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        completed_at INTEGER NULL,
                        PRIMARY KEY (scope_key, id)
                     );
                     INSERT INTO tasks (
                        scope_key, id, title, description, done_condition, status, priority, tags_json, source,
                        parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                        created_at, updated_at, completed_at
                     )
                     SELECT
                        'anonymous', id, title, description, done_condition, status, priority, tags_json, source,
                        parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                        created_at, updated_at, completed_at
                     FROM tasks_legacy;
                     DROP TABLE tasks_legacy;",
                )?;
            }
        }

        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS tasks (
                scope_key TEXT NOT NULL,
                id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NULL,
                done_condition TEXT NULL,
                status TEXT NOT NULL,
                priority TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                source TEXT NULL,
                parent_id TEXT NULL,
                depends_on_json TEXT NOT NULL,
                due_at INTEGER NULL,
                estimated_minutes INTEGER NULL,
                time_block_ids_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER NULL,
                PRIMARY KEY (scope_key, id)
            );",
        )?;
        Ok(())
    }

    fn persist_task(&self, scope_key: &str, task: &Task) -> Result<(), TaskStoreError> {
        self.upsert_scoped(scope_key, task)
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        match self.connection.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn insert_task(&self, scope_key: &str, task: &Task) -> Result<(), TaskStoreError> {
        let connection = self.connection();
        connection.execute(
            "INSERT INTO tasks (
                scope_key, id, title, description, done_condition, status, priority, tags_json, source,
                parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
                created_at, updated_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                normalize_scope_key(scope_key),
                task.id,
                task.title,
                task.description,
                task.done_condition,
                task_status_to_db(&task.status),
                task_priority_to_db(&task.priority),
                serde_json::to_string(&task.tags)?,
                task.source,
                task.parent_id,
                serde_json::to_string(&task.depends_on)?,
                task.due_at,
                task.estimated_minutes,
                serde_json::to_string(&task.time_block_ids)?,
                task.created_at,
                task.updated_at,
                task.completed_at,
            ],
        )?;
        Ok(())
    }
}

fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let status: String = row.get(4)?;
    let priority: String = row.get(5)?;
    let tags_json: String = row.get(6)?;
    let depends_on_json: String = row.get(9)?;
    let time_block_ids_json: String = row.get(12)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).map_err(map_json_error)?;
    let depends_on: Vec<TaskDependency> =
        serde_json::from_str(&depends_on_json).map_err(map_json_error)?;
    let time_block_ids: Vec<String> =
        serde_json::from_str(&time_block_ids_json).map_err(map_json_error)?;

    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        done_condition: row.get(3)?,
        status: parse_task_status(&status).map_err(map_task_status_error)?,
        priority: parse_task_priority(&priority).map_err(map_task_priority_error)?,
        tags,
        source: row.get(7)?,
        parent_id: row.get(8)?,
        depends_on,
        due_at: row.get(10)?,
        estimated_minutes: row.get(11)?,
        time_block_ids,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        completed_at: row.get(15)?,
    })
}

fn task_status_to_db(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::NotStarted => "not_started",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Suspended => "suspended",
        TaskStatus::Completed => "completed",
        TaskStatus::Abandoned => "abandoned",
    }
}

fn parse_task_status(value: &str) -> Result<TaskStatus, TaskStoreError> {
    match value {
        "not_started" => Ok(TaskStatus::NotStarted),
        "in_progress" => Ok(TaskStatus::InProgress),
        "suspended" => Ok(TaskStatus::Suspended),
        "completed" => Ok(TaskStatus::Completed),
        "abandoned" => Ok(TaskStatus::Abandoned),
        _ => Err(TaskStoreError::InvalidStoredStatus(value.to_string())),
    }
}

fn task_priority_to_db(priority: &TaskPriority) -> &'static str {
    match priority {
        TaskPriority::Low => "low",
        TaskPriority::Medium => "medium",
        TaskPriority::High => "high",
    }
}

fn parse_task_priority(value: &str) -> Result<TaskPriority, TaskStoreError> {
    match value {
        "low" => Ok(TaskPriority::Low),
        "medium" => Ok(TaskPriority::Medium),
        "high" => Ok(TaskPriority::High),
        _ => Err(TaskStoreError::InvalidStoredPriority(value.to_string())),
    }
}

fn map_task_status_error(error: TaskStoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(error),
    )
}

fn map_task_priority_error(error: TaskStoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(error),
    )
}

fn map_json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(error),
    )
}

fn insert_task_in_transaction(
    tx: &rusqlite::Transaction<'_>,
    scope_key: &str,
    task: &Task,
) -> Result<(), TaskStoreError> {
    tx.execute(
        "INSERT INTO tasks (
            scope_key, id, title, description, done_condition, status, priority, tags_json, source,
            parent_id, depends_on_json, due_at, estimated_minutes, time_block_ids_json,
            created_at, updated_at, completed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            normalize_scope_key(scope_key),
            task.id,
            task.title,
            task.description,
            task.done_condition,
            task_status_to_db(&task.status),
            task_priority_to_db(&task.priority),
            serde_json::to_string(&task.tags)?,
            task.source,
            task.parent_id,
            serde_json::to_string(&task.depends_on)?,
            task.due_at,
            task.estimated_minutes,
            serde_json::to_string(&task.time_block_ids)?,
            task.created_at,
            task.updated_at,
            task.completed_at,
        ],
    )?;
    Ok(())
}

fn normalize_scope_key(scope_key: &str) -> &str {
    let normalized = scope_key.trim();
    if normalized.is_empty() {
        DEFAULT_SCOPE_KEY
    } else {
        normalized
    }
}
