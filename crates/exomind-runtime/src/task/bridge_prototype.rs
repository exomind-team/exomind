#![allow(dead_code)]

use std::path::Path;

use serde_json::{Map, Value, json};
use thiserror::Error;

use super::types::{Task, TaskStatus, TaskStatusTransition, TaskTransitionReason};
use crate::sqlite_json_bridge::{
    BridgeError, ExtFieldDef, FieldDef, IndexDef, JsonKey, PreservedFieldDef, SchemaRegistry,
    SqliteJsonBridge, TableSchema,
};

const DEFAULT_SCOPE_KEY: &str = "anonymous";
const TASKS_TABLE: &str = "tasks";

#[derive(Debug, Error)]
pub enum TaskBridgePrototypeError {
    #[error("bridge error: {0}")]
    Bridge(#[from] BridgeError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub(crate) struct SqliteTaskBridgePrototype {
    bridge: SqliteJsonBridge,
}

impl SqliteTaskBridgePrototype {
    pub(crate) fn open(path: &Path) -> Result<Self, TaskBridgePrototypeError> {
        Ok(Self {
            bridge: SqliteJsonBridge::open(path, task_bridge_registry()?)?,
        })
    }

    pub(crate) fn open_in_memory() -> Result<Self, TaskBridgePrototypeError> {
        Ok(Self {
            bridge: SqliteJsonBridge::open_in_memory(task_bridge_registry()?)?,
        })
    }

    pub(crate) fn path(&self) -> Option<&Path> {
        self.bridge.path()
    }

    pub(crate) fn upsert_scoped(
        &self,
        scope_key: &str,
        task: &Task,
    ) -> Result<(), TaskBridgePrototypeError> {
        self.bridge
            .upsert_json(TASKS_TABLE, task_to_bridge_doc(scope_key, task)?)?;
        Ok(())
    }

    pub(crate) fn get_scoped(
        &self,
        scope_key: &str,
        id: &str,
    ) -> Result<Option<Task>, TaskBridgePrototypeError> {
        self.bridge
            .get_json(TASKS_TABLE, &task_key(scope_key, id))?
            .map(task_from_bridge_doc)
            .transpose()
    }

    pub(crate) fn list_scoped(
        &self,
        scope_key: &str,
    ) -> Result<Vec<Task>, TaskBridgePrototypeError> {
        self.query_tasks(
            "scope_key = ?1 ORDER BY created_at DESC, id DESC",
            &[json!(normalize_scope_key(scope_key))],
        )
    }

    pub(crate) fn list_by_status_scoped(
        &self,
        scope_key: &str,
        status: &TaskStatus,
    ) -> Result<Vec<Task>, TaskBridgePrototypeError> {
        self.query_tasks(
            "scope_key = ?1 AND status = ?2 ORDER BY created_at DESC, id DESC",
            &[
                json!(normalize_scope_key(scope_key)),
                serde_json::to_value(status)?,
            ],
        )
    }

    pub(crate) fn list_by_tag_scoped(
        &self,
        scope_key: &str,
        tag: &str,
    ) -> Result<Vec<Task>, TaskBridgePrototypeError> {
        self.query_tasks(
            "scope_key = ?1
             AND EXISTS (
                 SELECT 1
                 FROM json_each(tasks.tags_json, '$') tags
                 WHERE tags.value = ?2
             )
             ORDER BY created_at DESC, id DESC",
            &[json!(normalize_scope_key(scope_key)), json!(tag)],
        )
    }

    fn query_tasks(
        &self,
        sql_where: &str,
        params: &[Value],
    ) -> Result<Vec<Task>, TaskBridgePrototypeError> {
        self.bridge
            .query_json(TASKS_TABLE, sql_where, params)?
            .into_iter()
            .map(task_from_bridge_doc)
            .collect()
    }
}

fn task_bridge_registry() -> Result<SchemaRegistry, BridgeError> {
    let mut registry = SchemaRegistry::new();
    registry.register(task_table_schema())?;
    Ok(registry)
}

fn task_table_schema() -> TableSchema {
    // NOTE: Column ordering must match SqliteTaskStore::insert_task exactly,
    // so that row_to_json positional reads stay aligned with the SQLite table.
    // SqliteTaskStore creates the table via CREATE TABLE IF NOT EXISTS (store schema).
    // If SqliteTaskBridgePrototype init runs first, it creates the table with this schema.
    TableSchema::new(TASKS_TABLE)
        .primary_keys(&["scope_key", "id"])
        .expanded_fields(vec![
            // Positions 0-13: match store's column order (scope_key through completed_at)
            FieldDef::text("scope_key").default_json(json!(DEFAULT_SCOPE_KEY)), // 0
            FieldDef::text("id"),                                              // 1
            FieldDef::text("title"),                                           // 2
            FieldDef::text("description").nullable(),                           // 3
            FieldDef::text("done_condition").nullable(),                       // 4
            FieldDef::text("status"),                                          // 5
            FieldDef::text("priority"),                                        // 6
            FieldDef::text("source").nullable(),                               // 7 — matches store's position 8 (after priority)
            FieldDef::text("parent_id").nullable(),                            // 8 — matches store's position 9
            // NOTE: tags_json, depends_on_json, time_block_ids_json, status_transitions_json
            //       are preserved fields (positions 14-17), NOT expanded fields
            FieldDef::integer("due_at").nullable(),        // 9 — matches store's position 11
            FieldDef::integer("estimated_minutes").nullable(), // 10 — matches store's position 12
            FieldDef::integer("created_at"),               // 11 — matches store's position 15
            FieldDef::integer("updated_at"),               // 12 — matches store's position 16
            FieldDef::integer("completed_at").nullable(),  // 13 — matches store's position 17
        ])
        .preserved_fields(vec![
            // Positions 14-17: match store's column order
            PreservedFieldDef::json("tags").default_json(json!([])),          // 14 → tags_json
            PreservedFieldDef::json("depends_on").default_json(json!([])),    // 15 → depends_on_json
            PreservedFieldDef::json("time_block_ids").default_json(json!([])), // 16 → time_block_ids_json
            PreservedFieldDef::json("status_transitions").default_json(json!([])), // 17 → status_transitions_json
        ])
        .ext_field(ExtFieldDef::new("_ext_json").default_json(json!({})))
        .indexes(vec![
            IndexDef::new("idx_tasks_scope_status", &["scope_key", "status"]),
            IndexDef::new("idx_tasks_scope_created", &["scope_key", "created_at"]),
        ])
}

fn normalize_scope_key(scope_key: &str) -> &str {
    let trimmed = scope_key.trim();
    if trimmed.is_empty() {
        DEFAULT_SCOPE_KEY
    } else {
        trimmed
    }
}

fn task_key(scope_key: &str, id: &str) -> JsonKey {
    Map::from_iter([
        (
            "scope_key".to_string(),
            Value::String(normalize_scope_key(scope_key).to_string()),
        ),
        ("id".to_string(), Value::String(id.to_string())),
    ])
}

fn task_to_bridge_doc(scope_key: &str, task: &Task) -> Result<Value, TaskBridgePrototypeError> {
    let mut doc = match serde_json::to_value(task)? {
        Value::Object(map) => map,
        _ => unreachable!("task serialization must produce a JSON object"),
    };
    doc.insert(
        "scope_key".to_string(),
        Value::String(normalize_scope_key(scope_key).to_string()),
    );
    Ok(Value::Object(doc))
}

fn task_from_bridge_doc(value: Value) -> Result<Task, TaskBridgePrototypeError> {
    let mut doc = match value {
        Value::Object(map) => map,
        _ => unreachable!("bridge row must decode into a JSON object"),
    };
    doc.remove("scope_key");
    Ok(serde_json::from_value(Value::Object(doc))?)
}

#[cfg(test)]
mod tests {
    use super::super::sqlite_store::SqliteTaskStore;
    use super::super::types::{TaskDependency, TaskDependencyType, TaskPriority};
    use super::*;
    use tempfile::tempdir;

    fn sample_task(id: &str, title: &str, status: TaskStatus, created_at: u64) -> Task {
        Task {
            id: id.to_string(),
            title: title.to_string(),
            description: Some(format!("{title} description")),
            done_condition: Some("done".to_string()),
            status,
            priority: TaskPriority::High,
            tags: vec!["bridge".to_string(), "prototype".to_string()],
            source: Some("unit-test".to_string()),
            parent_id: Some("parent-1".to_string()),
            depends_on: vec![TaskDependency {
                task_id: "dep-1".to_string(),
                relation_type: TaskDependencyType::Hard,
            }],
            due_at: Some(created_at + 500),
            estimated_minutes: Some(45),
            time_block_ids: vec!["block-1".to_string()],
            status_transitions: if status == TaskStatus::Completed {
                vec![
                    TaskStatusTransition {
                        id: format!("{id}-init"),
                        at: created_at,
                        from_status: None,
                        to_status: TaskStatus::Pending,
                        reason: TaskTransitionReason::TaskCreate,
                        actor_id: None,
                        source_host_id: None,
                        operation_id: None,
                        related_time_block_id: None,
                        related_time_block_transition_ref: None,
                        auto_generated: None,
                    },
                    TaskStatusTransition {
                        id: format!("{id}-progress"),
                        at: created_at + 1,
                        from_status: Some(TaskStatus::Pending),
                        to_status: TaskStatus::InProgress,
                        reason: TaskTransitionReason::TaskTransition,
                        actor_id: None,
                        source_host_id: None,
                        operation_id: None,
                        related_time_block_id: None,
                        related_time_block_transition_ref: None,
                        auto_generated: None,
                    },
                    TaskStatusTransition {
                        id: format!("{id}-done"),
                        at: created_at + 2,
                        from_status: Some(TaskStatus::InProgress),
                        to_status: TaskStatus::Completed,
                        reason: TaskTransitionReason::TaskTransition,
                        actor_id: None,
                        source_host_id: None,
                        operation_id: None,
                        related_time_block_id: None,
                        related_time_block_transition_ref: None,
                        auto_generated: None,
                    },
                ]
            } else if status == TaskStatus::InProgress {
                vec![
                    TaskStatusTransition {
                        id: format!("{id}-init"),
                        at: created_at,
                        from_status: None,
                        to_status: TaskStatus::Pending,
                        reason: TaskTransitionReason::TaskCreate,
                        actor_id: None,
                        source_host_id: None,
                        operation_id: None,
                        related_time_block_id: None,
                        related_time_block_transition_ref: None,
                        auto_generated: None,
                    },
                    TaskStatusTransition {
                        id: format!("{id}-progress"),
                        at: created_at + 1,
                        from_status: Some(TaskStatus::Pending),
                        to_status: TaskStatus::InProgress,
                        reason: TaskTransitionReason::TaskTransition,
                        actor_id: None,
                        source_host_id: None,
                        operation_id: None,
                        related_time_block_id: None,
                        related_time_block_transition_ref: None,
                        auto_generated: None,
                    },
                ]
            } else {
                vec![TaskStatusTransition {
                    id: format!("{id}-init"),
                    at: created_at,
                    from_status: None,
                    to_status: TaskStatus::Pending,
                    reason: TaskTransitionReason::TaskCreate,
                    actor_id: None,
                    source_host_id: None,
                    operation_id: None,
                    related_time_block_id: None,
                    related_time_block_transition_ref: None,
                    auto_generated: None,
                }]
            },
            created_at,
            updated_at: created_at + 1,
            completed_at: status.is_terminal().then_some(created_at + 2),
        }
    }

    fn assert_task_eq(tag: &str, expected: &Task, actual: &Task) {
        let mut expected = expected.clone();
        let mut actual = actual.clone();
        super::super::store::normalize_task_status_history(&mut expected);
        super::super::store::normalize_task_status_history(&mut actual);
        let expected_json = serde_json::to_value(&expected).unwrap();
        let actual_json = serde_json::to_value(&actual).unwrap();
        assert_eq!(
            actual_json, expected_json,
            "[{tag}] task mismatch",
        );
    }

    #[test]
    fn roundtrips_task_in_memory() {
        let prototype = SqliteTaskBridgePrototype::open_in_memory().unwrap();
        let task = sample_task("task-1", "Prototype task", TaskStatus::Pending, 1000);

        prototype.upsert_scoped("alpha", &task).unwrap();

        let loaded = prototype.get_scoped("alpha", &task.id).unwrap().unwrap();
        assert_task_eq("roundtrip", &task, &loaded);
    }

    #[test]
    fn composite_key_keeps_scopes_isolated() {
        let prototype = SqliteTaskBridgePrototype::open_in_memory().unwrap();
        let alpha = sample_task("same-id", "Alpha task", TaskStatus::Pending, 1000);
        let beta = sample_task("same-id", "Beta task", TaskStatus::InProgress, 2000);

        prototype.upsert_scoped("alpha", &alpha).unwrap();
        prototype.upsert_scoped("beta", &beta).unwrap();

        let loaded_alpha = prototype.get_scoped("alpha", "same-id").unwrap().unwrap();
        let loaded_beta = prototype.get_scoped("beta", "same-id").unwrap().unwrap();

        assert_eq!(loaded_alpha.title, "Alpha task");
        assert_eq!(loaded_beta.title, "Beta task");
        assert_eq!(prototype.list_scoped("alpha").unwrap().len(), 1);
        assert_eq!(prototype.list_scoped("beta").unwrap().len(), 1);
    }

    #[test]
    fn list_by_status_and_tag_queries_work() {
        let prototype = SqliteTaskBridgePrototype::open_in_memory().unwrap();
        let pending = sample_task("task-1", "Pending", TaskStatus::Pending, 1000);
        let mut active = sample_task("task-2", "Active", TaskStatus::InProgress, 2000);
        active.tags.push("focus".to_string());

        prototype.upsert_scoped("alpha", &pending).unwrap();
        prototype.upsert_scoped("alpha", &active).unwrap();

        let in_progress = prototype
            .list_by_status_scoped("alpha", &TaskStatus::InProgress)
            .unwrap();
        assert_eq!(in_progress.len(), 1);
        assert_eq!(in_progress[0].id, "task-2");

        let tagged = prototype.list_by_tag_scoped("alpha", "focus").unwrap();
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0].id, "task-2");
    }

    #[test]
    fn file_backed_store_survives_reopen() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("task-bridge.sqlite");
        let task = sample_task("task-3", "Persisted", TaskStatus::Completed, 3000);

        {
            let prototype = SqliteTaskBridgePrototype::open(&sqlite_path).unwrap();
            assert_eq!(prototype.path(), Some(sqlite_path.as_path()));
            prototype.upsert_scoped("", &task).unwrap();
        }

        let reopened = SqliteTaskBridgePrototype::open(&sqlite_path).unwrap();
        let loaded = reopened
            .get_scoped(DEFAULT_SCOPE_KEY, &task.id)
            .unwrap()
            .unwrap();

        assert_task_eq("reopen", &task, &loaded);
    }

    #[test]
    fn bridge_can_read_tasks_written_by_sqlite_task_store() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("shared-tasks.sqlite");
        let store = SqliteTaskStore::open(&sqlite_path).unwrap();
        let prototype = SqliteTaskBridgePrototype::open(&sqlite_path).unwrap();
        let mut task = sample_task("task-4", "From store", TaskStatus::InProgress, 4000);
        task.tags.push("interop".to_string());

        store.upsert_scoped("alpha", &task).unwrap();

        let loaded = prototype.get_scoped("alpha", &task.id).unwrap().unwrap();
        assert_task_eq("bridge2store-get", &task, &loaded);

        let by_status = prototype
            .list_by_status_scoped("alpha", &TaskStatus::InProgress)
            .unwrap();
        assert_eq!(by_status.len(), 1);
        assert_task_eq("bridge2store-by-status", &task, &by_status[0]);

        let by_tag = prototype.list_by_tag_scoped("alpha", "interop").unwrap();
        assert_eq!(by_tag.len(), 1);
        assert_task_eq("bridge2store-by-tag", &task, &by_tag[0]);
    }

    #[test]
    fn sqlite_task_store_can_read_tasks_written_by_bridge() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("shared-tasks.sqlite");
        let prototype = SqliteTaskBridgePrototype::open(&sqlite_path).unwrap();
        let store = SqliteTaskStore::open(&sqlite_path).unwrap();
        let task = sample_task("task-5", "From bridge", TaskStatus::Pending, 5000);
        let completed = sample_task("task-6", "Completed by bridge", TaskStatus::Completed, 6000);

        prototype.upsert_scoped("beta", &task).unwrap();
        prototype.upsert_scoped("beta", &completed).unwrap();
        prototype
            .upsert_scoped(
                "gamma",
                &sample_task("task-6", "Other scope", TaskStatus::Pending, 7000),
            )
            .unwrap();

        let loaded = store.get_scoped("beta", &task.id).unwrap().unwrap();
        assert_task_eq("store2bridge-get", &task, &loaded);

        let listed = store.list_scoped("beta").unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|candidate| candidate.id == task.id));
        assert!(listed.iter().any(|candidate| candidate.id == completed.id));

        let completed_only = store
            .list_by_status_scoped("beta", &TaskStatus::Completed)
            .unwrap();
        assert_eq!(completed_only.len(), 1);
        assert_task_eq("store2bridge-completed", &completed, &completed_only[0]);
        assert!(store.get_scoped("beta", "missing").unwrap().is_none());
    }
}
