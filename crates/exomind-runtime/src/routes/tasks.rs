use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::signal::types::SignalEvent;
use crate::task::{CreateTaskInput, Task, TaskStatus, TransitionInput, UpdateTaskInput};
use crate::AppState;

// ── Query types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    status: Option<TaskStatus>,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImportQuery {
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScopeQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TaskBackupJsonPayload {
    version: u32,
    tasks: Vec<Task>,
}

#[derive(Debug, Serialize)]
struct TaskBackupSqlitePayload {
    version: u32,
    file_name: String,
    content_base64: String,
    task_count: usize,
}

#[derive(Debug, Deserialize)]
struct TaskBackupSqliteImportPayload {
    content_base64: String,
}

#[derive(Debug, Serialize)]
struct TaskImportResult {
    imported: usize,
    skipped: usize,
    total: usize,
}

#[derive(Debug, Serialize)]
struct TaskBackendStatusResponse {
    backend: &'static str,
    supports_json_backup: bool,
    supports_sqlite_snapshot: bool,
}

enum TaskImportStrategy {
    Merge,
    Overwrite,
}

// ── Handlers ────────────────────────────────────────────────────

/// GET /tasks
async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Json<Vec<Task>> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let tasks = match &query.status {
        Some(status) => state.task_store.list_by_status_scoped(scope_key, status),
        None => state.task_store.list_scoped(scope_key),
    };
    Json(tasks)
}

/// GET /tasks/:id
async fn get_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Task>, StatusCode> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    state
        .task_store
        .get_scoped(scope_key, &id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// POST /tasks
async fn create_task(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<CreateTaskInput>,
) -> (StatusCode, Json<Task>) {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let task = state.task_store.create_scoped(scope_key, input);

    publish_task_signal(&state, "task.created", &task);

    (StatusCode::CREATED, Json(task))
}

/// PUT /tasks/:id
async fn update_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<UpdateTaskInput>,
) -> Result<Json<Task>, StatusCode> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let task = state
        .task_store
        .update_scoped(scope_key, &id, input)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    publish_task_signal(&state, "task.updated", &task);

    Ok(Json(task))
}

/// POST /tasks/:id/transition
async fn transition_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<TransitionInput>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let (old_status, task) = state
        .task_store
        .transition_scoped(scope_key, &id, input.status)
        .map_err(|e| {
            let code = match &e {
                crate::task::store::TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
                _ => StatusCode::CONFLICT,
            };
            (code, e.to_string())
        })?;

    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "task.transitioned".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:tasks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({
            "task": task,
            "old_status": old_status,
            "new_status": task.status,
        }),
    };
    state.signal_pool.publish(event);

    Ok(Json(task))
}

/// DELETE /tasks/:id — abandon task (set status to abandoned)
async fn delete_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let task = state.task_store.abandon_scoped(scope_key, &id).map_err(|e| {
        let code = match &e {
            crate::task::store::TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            _ => StatusCode::CONFLICT,
        };
        (code, e.to_string())
    })?;

    publish_task_signal(&state, "task.deleted", &task);

    Ok(Json(task))
}

async fn export_tasks_json(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Json<TaskBackupJsonPayload> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    Json(TaskBackupJsonPayload {
        version: 1,
        tasks: state.task_store.list_scoped(scope_key),
    })
}

async fn export_tasks_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TaskBackupSqlitePayload>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let tasks = state.task_store.list_scoped(scope_key);
    let bytes = build_task_sqlite_snapshot_bytes(scope_key, &tasks)?;

    Ok(Json(TaskBackupSqlitePayload {
        version: 1,
        file_name: "exomind-tasks.sqlite".to_string(),
        content_base64: STANDARD.encode(bytes),
        task_count: tasks.len(),
    }))
}

async fn import_tasks_json(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<TaskBackupJsonPayload>,
) -> Result<Json<TaskImportResult>, (StatusCode, String)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let result = apply_task_import(&state, scope_key, payload.tasks, strategy)?;
    Ok(Json(result))
}

async fn import_tasks_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<TaskBackupSqliteImportPayload>,
) -> Result<Json<TaskImportResult>, (StatusCode, String)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())?;
    let bytes = STANDARD
        .decode(payload.content_base64)
        .map_err(|error| (StatusCode::BAD_REQUEST, format!("invalid sqlite snapshot: {error}")))?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let imported_tasks = read_tasks_from_sqlite_snapshot(&bytes, scope_key)?;
    let result = apply_task_import(&state, scope_key, imported_tasks, strategy)?;
    Ok(Json(result))
}

async fn task_backend_status(
    State(state): State<AppState>,
) -> Json<TaskBackendStatusResponse> {
    let supports_sqlite_snapshot = matches!(
        state.task_store.backend_kind(),
        crate::task::TaskStoreBackendKind::Sqlite
    );
    Json(TaskBackendStatusResponse {
        backend: if supports_sqlite_snapshot { "rt-sqlite" } else { "memory" },
        supports_json_backup: true,
        supports_sqlite_snapshot,
    })
}

// ── Helpers ─────────────────────────────────────────────────────

fn publish_task_signal(state: &AppState, topic: &str, task: &Task) {
    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:tasks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: None,
        payload: serde_json::to_value(task).unwrap_or_default(),
    };
    state.signal_pool.publish(event);
}

fn parse_import_strategy(raw: Option<&str>) -> Result<TaskImportStrategy, (StatusCode, String)> {
    match raw.unwrap_or("merge") {
        "merge" => Ok(TaskImportStrategy::Merge),
        "overwrite" => Ok(TaskImportStrategy::Overwrite),
        value => Err((
            StatusCode::BAD_REQUEST,
            format!("unsupported task import strategy: {value}"),
        )),
    }
}

fn apply_task_import(
    state: &AppState,
    scope_key: Option<&str>,
    incoming: Vec<Task>,
    strategy: TaskImportStrategy,
) -> Result<TaskImportResult, (StatusCode, String)> {
    let existing = state.task_store.list_scoped(scope_key);
    let result = match strategy {
        TaskImportStrategy::Overwrite => {
            state
                .task_store
                .replace_all_scoped(scope_key, &incoming)
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            TaskImportResult {
                imported: incoming.len(),
                skipped: 0,
                total: incoming.len(),
            }
        }
        TaskImportStrategy::Merge => {
            let mut merged = std::collections::BTreeMap::new();
            for task in &existing {
                merged.insert(task.id.clone(), task.clone());
            }

            let mut imported = 0usize;
            let mut skipped = 0usize;
            for task in incoming {
                if merged.contains_key(&task.id) {
                    skipped += 1;
                } else {
                    imported += 1;
                }
                merged.insert(task.id.clone(), task);
            }

            let next = merged.into_values().collect::<Vec<_>>();
            state
                .task_store
                .replace_all_scoped(scope_key, &next)
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

            TaskImportResult {
                imported,
                skipped,
                total: next.len(),
            }
        }
    };

    Ok(result)
}

fn build_task_sqlite_snapshot_bytes(scope_key: Option<&str>, tasks: &[Task]) -> Result<Vec<u8>, (StatusCode, String)> {
    let temp_root = std::env::temp_dir().join(format!("exomind-task-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to create task export temp dir: {error}")))?;
    let sqlite_path = temp_root.join("tasks-export.sqlite");
    let store = crate::task::TaskStore::with_sqlite_path(&sqlite_path)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    store
        .replace_all_scoped(scope_key, tasks)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let bytes = store
        .sqlite_snapshot_bytes()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to produce scoped task sqlite snapshot".to_string(),
            )
        })?;
    drop(store);
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok(bytes)
}

fn read_tasks_from_sqlite_snapshot(bytes: &[u8], scope_key: Option<&str>) -> Result<Vec<Task>, (StatusCode, String)> {
    let temp_path = std::env::temp_dir().join(format!("exomind-task-import-{}.sqlite", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, bytes)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let store = crate::task::TaskStore::with_sqlite_path(&temp_path)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let tasks = store.list_scoped(scope_key);

    let _ = std::fs::remove_file(&temp_path);
    Ok(tasks)
}

// ── Router ──────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/backend/status", get(task_backend_status))
        .route("/tasks/backup/json", get(export_tasks_json))
        .route("/tasks/backup/sqlite", get(export_tasks_sqlite))
        .route("/tasks/import/json", post(import_tasks_json))
        .route("/tasks/import/sqlite", post(import_tasks_sqlite))
        .route("/tasks/:id", get(get_task).put(update_task).delete(delete_task))
        .route("/tasks/:id/transition", post(transition_task))
}

// ── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use crate::signal::SignalPool;
    use crate::task::TaskPriority;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        test_state_with_task_store(Arc::new(crate::task::TaskStore::new()))
    }

    fn test_state_with_task_store(task_store: Arc<crate::task::TaskStore>) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "tasks-test-host".to_string();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: crate::agent::AgentRegistry::new(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(host_id.clone(), Arc::clone(&signal_pool), None)),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store,
            timeblock_store: Arc::new(crate::timeblock::TimeBlockStore::new()),
            energy_registry: crate::energy::EnergyRegistry::new(),
            life_agents: std::collections::HashMap::new(),
            eventlog_store: Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir().join("exomind-test-tasks"),
            )),
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(Arc::clone(&signal_pool), host_id)),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn create_and_list_tasks() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        // Create
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Buy milk","tags":["shopping"]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(created["title"], "Buy milk");
        assert_eq!(created["status"], "not_started");
        assert_eq!(created["priority"], "medium");
        assert_eq!(created["tags"][0], "shopping");

        // List
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Buy milk");
    }

    #[tokio::test]
    async fn get_single_task() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Test".to_string(),
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
        });
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/tasks/{}", task.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let fetched: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(fetched["id"], task.id);
    }

    #[tokio::test]
    async fn get_nonexistent_returns_404() {
        let state = test_state();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_task_fields() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Original".to_string(),
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
        });
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Updated","priority":"high"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let updated: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(updated["title"], "Updated");
        assert_eq!(updated["priority"], "high");
    }

    #[tokio::test]
    async fn transition_task_status() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "My task".to_string(),
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
        });
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/tasks/{}/transition", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"in_progress"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let transitioned: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(transitioned["status"], "in_progress");
    }

    #[tokio::test]
    async fn invalid_transition_returns_conflict() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Task".to_string(),
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
        });
        let app = test_router(state);

        // not_started → completed is invalid
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/tasks/{}/transition", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"completed"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn delete_abandons_task() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "To abandon".to_string(),
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
        });
        // Must transition to in_progress first (not_started → abandoned is invalid)
        state.task_store.transition(&task.id, TaskStatus::InProgress).unwrap();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/tasks/{}", task.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let deleted: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(deleted["status"], "abandoned");
    }

    #[tokio::test]
    async fn list_with_status_filter() {
        let state = test_state();
        let t1 = state.task_store.create(CreateTaskInput {
            title: "Task 1".to_string(),
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
        });
        state.task_store.create(CreateTaskInput {
            title: "Task 2".to_string(),
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
        });
        state.task_store.transition(&t1.id, TaskStatus::InProgress).unwrap();

        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks?status=in_progress")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Task 1");
    }

    #[tokio::test]
    async fn exports_task_json_backup() {
        let state = test_state();
        state.task_store.create(CreateTaskInput {
            title: "Backup Task".to_string(),
            description: Some("Export me".to_string()),
            done_condition: Some("done".to_string()),
            priority: Some(TaskPriority::High),
            tags: vec!["backup".to_string()],
            source: Some("test".to_string()),
            parent_id: None,
            depends_on: vec![],
            due_at: Some(1_700_000_000_000),
            estimated_minutes: Some(25),
            time_block_ids: vec!["block-1".to_string()],
        });
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks/backup/json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["version"], 1);
        assert_eq!(payload["tasks"].as_array().map(|items| items.len()), Some(1));
        assert_eq!(payload["tasks"][0]["done_condition"], "done");
        assert_eq!(payload["tasks"][0]["time_block_ids"][0], "block-1");
    }

    #[tokio::test]
    async fn imports_task_json_backup_with_merge_strategy() {
        let state = test_state();
        let existing = state.task_store.create(CreateTaskInput {
            title: "Existing".to_string(),
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
        });
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/import/json?strategy=merge")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{
                            "version": 1,
                            "tasks": [
                                {{
                                    "id": "{}",
                                    "title": "Existing replaced",
                                    "description": null,
                                    "done_condition": null,
                                    "status": "not_started",
                                    "priority": "medium",
                                    "tags": [],
                                    "source": null,
                                    "parent_id": null,
                                    "depends_on": [],
                                    "due_at": null,
                                    "estimated_minutes": null,
                                    "time_block_ids": [],
                                    "created_at": 1000,
                                    "updated_at": 2000,
                                    "completed_at": null
                                }},
                                {{
                                    "id": "task-import-2",
                                    "title": "Imported task",
                                    "description": null,
                                    "done_condition": "ship",
                                    "status": "not_started",
                                    "priority": "high",
                                    "tags": ["rt"],
                                    "source": "backup",
                                    "parent_id": null,
                                    "depends_on": [],
                                    "due_at": null,
                                    "estimated_minutes": 30,
                                    "time_block_ids": ["block-9"],
                                    "created_at": 3000,
                                    "updated_at": 4000,
                                    "completed_at": null
                                }}
                            ]
                        }}"#,
                        existing.id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["imported"], 1);
        assert_eq!(result["skipped"], 1);
        assert_eq!(result["total"], 2);

        let tasks = state.task_store.list();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|task| task.title == "Imported task"));
        assert!(tasks.iter().any(|task| task.title == "Existing replaced"));
    }

    #[tokio::test]
    async fn exports_task_sqlite_snapshot() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        task_store.create(CreateTaskInput {
            title: "SQLite backup".to_string(),
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
        });
        let app = test_router(test_state_with_task_store(task_store));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks/backup/sqlite")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        let encoded = payload["content_base64"].as_str().expect("base64 snapshot");
        let bytes = STANDARD.decode(encoded).expect("valid sqlite bytes");
        assert!(!bytes.is_empty());
    }

    #[tokio::test]
    async fn imports_task_sqlite_snapshot_with_overwrite_strategy() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        task_store.create(CreateTaskInput {
            title: "Old task".to_string(),
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
        });

        let import_dir = tempdir().unwrap();
        let import_sqlite_path = import_dir.path().join("import.sqlite");
        let import_store = crate::task::TaskStore::with_sqlite_path(&import_sqlite_path).unwrap();
        import_store.create(CreateTaskInput {
            title: "Imported sqlite task".to_string(),
            description: Some("from snapshot".to_string()),
            done_condition: None,
            priority: Some(TaskPriority::High),
            tags: vec!["sqlite".to_string()],
            source: Some("backup".to_string()),
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: Some(50),
            time_block_ids: vec!["block-3".to_string()],
        });
        let import_bytes = std::fs::read(import_sqlite_path).unwrap();
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/import/sqlite?strategy=overwrite")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"content_base64":"{}"}}"#,
                        STANDARD.encode(import_bytes)
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["imported"], 1);
        assert_eq!(result["skipped"], 0);
        assert_eq!(result["total"], 1);
        let tasks = task_store.list();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Imported sqlite task");
        assert_eq!(tasks[0].time_block_ids, vec!["block-3".to_string()]);
    }

    #[tokio::test]
    async fn task_routes_isolate_profile_id_scope_and_keep_default_anonymous() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-scoped.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Anonymous task"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Profile A task"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let anonymous_tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks?profile_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let profile_a_tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        assert_eq!(anonymous_tasks.len(), 1);
        assert_eq!(anonymous_tasks[0]["title"], "Anonymous task");
        assert_eq!(profile_a_tasks.len(), 1);
        assert_eq!(profile_a_tasks[0]["title"], "Profile A task");
        assert_eq!(task_store.list().len(), 1, "default access should continue using anonymous scope");
        assert_eq!(
            task_store.list_in_scope(Some("profile-a")).len(),
            1,
            "profile scope should stay isolated in sqlite backend",
        );
    }
}
