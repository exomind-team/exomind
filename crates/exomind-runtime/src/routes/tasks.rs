use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::signal::types::SignalEvent;
use crate::task::store::TaskStoreError;
use crate::task::{
    BatchTransitionInput, BatchTransitionResponse, BatchTransitionResult, CreateTaskInput, Task,
    TaskStatus, TransitionInput, UpdateTaskInput,
};

// ── Query types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    status: Option<TaskStatus>,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
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

#[derive(Debug, Deserialize)]
struct TaskReplicationUpsertRequest {
    task: Task,
    #[serde(default)]
    source_host_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct TaskReplicationUpsertResponse {
    status: &'static str,
}

#[derive(Debug, Deserialize)]
struct TransitionQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    shortcut: Option<bool>,
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
    let mut tasks = match &query.status {
        Some(status) => state.task_store.list_by_status_scoped(scope_key, status),
        None => state.task_store.list_scoped(scope_key),
    };

    if let Some(tag) = &query.tag {
        tasks.retain(|task| task.tags.iter().any(|task_tag| task_tag == tag));
    }

    if let Some(parent_id) = &query.parent_id {
        tasks.retain(|task| task.parent_id.as_deref() == Some(parent_id.as_str()));
    }

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
    publish_task_replication_signal(&state, scope_key, &task).await;

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
        .map_err(|error| match error {
            TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            _ => StatusCode::CONFLICT,
        })?;

    publish_task_signal(&state, "task.updated", &task);
    publish_task_replication_signal(&state, scope_key, &task).await;

    Ok(Json(task))
}

/// POST /tasks/:id/transition
async fn transition_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<TransitionQuery>,
    Json(input): Json<TransitionInput>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    if query.shortcut.unwrap_or(false) {
        let steps = state
            .task_store
            .transition_with_shortcut_scoped(scope_key, &id, input.status)
            .map_err(map_task_store_error)?;
        let (_, final_task) = steps.last().cloned().ok_or((
            StatusCode::CONFLICT,
            "task already at target status".to_string(),
        ))?;

        for (old_status, task) in &steps {
            publish_task_transition_signal(&state, *old_status, task);
            publish_task_replication_signal(&state, scope_key, task).await;
            write_task_transition_eventlog(
                &state,
                scope_key,
                task,
                *old_status,
                "http:tasks/transition",
            )
            .await;
        }

        return Ok(Json(final_task));
    }

    let (old_status, task) = state
        .task_store
        .transition_scoped(scope_key, &id, input.status)
        .map_err(map_task_store_error)?;

    publish_task_transition_signal(&state, old_status, &task);
    publish_task_replication_signal(&state, scope_key, &task).await;
    write_task_transition_eventlog(
        &state,
        scope_key,
        &task,
        old_status,
        "http:tasks/transition",
    )
    .await;

    Ok(Json(task))
}

async fn batch_transition_tasks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<BatchTransitionInput>,
) -> Json<BatchTransitionResponse> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let use_shortcut = input.shortcut.unwrap_or(false);
    let mut results = Vec::with_capacity(input.tasks.len());
    let mut succeeded = 0usize;
    let mut failed = 0usize;

    for item in input.tasks {
        if use_shortcut {
            match state
                .task_store
                .transition_with_shortcut_scoped(scope_key, &item.id, item.status)
                .and_then(|steps| {
                    steps
                        .last()
                        .cloned()
                        .ok_or(TaskStoreError::InvalidTransition {
                            from: item.status,
                            to: item.status,
                        })
                        .map(|last| (steps, last))
                }) {
                Ok((steps, (old_status, task))) => {
                    for (step_old_status, step_task) in &steps {
                        publish_task_transition_signal(&state, *step_old_status, step_task);
                        publish_task_replication_signal(&state, scope_key, step_task).await;
                        write_task_transition_eventlog(
                            &state,
                            scope_key,
                            step_task,
                            *step_old_status,
                            "http:tasks/batch-transition",
                        )
                        .await;
                    }
                    succeeded += 1;
                    results.push(BatchTransitionResult {
                        id: item.id,
                        success: true,
                        old_status: Some(old_status),
                        new_status: Some(task.status),
                        error: None,
                    });
                }
                Err(error) => {
                    failed += 1;
                    results.push(BatchTransitionResult {
                        id: item.id,
                        success: false,
                        old_status: None,
                        new_status: None,
                        error: Some(error.to_string()),
                    });
                }
            }
            continue;
        }

        match state
            .task_store
            .transition_scoped(scope_key, &item.id, item.status)
        {
            Ok((old_status, task)) => {
                publish_task_transition_signal(&state, old_status, &task);
                publish_task_replication_signal(&state, scope_key, &task).await;
                write_task_transition_eventlog(
                    &state,
                    scope_key,
                    &task,
                    old_status,
                    "http:tasks/batch-transition",
                )
                .await;
                succeeded += 1;
                results.push(BatchTransitionResult {
                    id: item.id,
                    success: true,
                    old_status: Some(old_status),
                    new_status: Some(task.status),
                    error: None,
                });
            }
            Err(error) => {
                failed += 1;
                results.push(BatchTransitionResult {
                    id: item.id,
                    success: false,
                    old_status: None,
                    new_status: None,
                    error: Some(error.to_string()),
                });
            }
        }
    }

    Json(BatchTransitionResponse {
        results,
        succeeded,
        failed,
    })
}

fn cancel_task_in_scope(
    state: &AppState,
    scope_key: Option<&str>,
    id: &str,
) -> Result<(TaskStatus, Task), (StatusCode, String)> {
    let old_status = state
        .task_store
        .get_scoped(scope_key, id)
        .map(|task| task.status)
        .ok_or((StatusCode::NOT_FOUND, format!("task not found: {id}")))?;
    let task = state
        .task_store
        .cancel_scoped(scope_key, id)
        .map_err(map_task_store_error)?;

    Ok((old_status, task))
}

/// POST /tasks/:id/cancel — cancel task (set status to cancelled)
async fn cancel_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let (old_status, task) = cancel_task_in_scope(&state, scope_key, &id)?;

    publish_task_signal(&state, "task.cancelled", &task);
    publish_task_replication_signal(&state, scope_key, &task).await;
    write_task_transition_eventlog(&state, scope_key, &task, old_status, "http:tasks/cancel").await;

    Ok(Json(task))
}

/// DELETE /tasks/:id — compatibility alias for cancel
async fn delete_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let (old_status, task) = cancel_task_in_scope(&state, scope_key, &id)?;

    publish_task_signal(&state, "task.cancelled", &task);
    publish_task_replication_signal(&state, scope_key, &task).await;
    write_task_transition_eventlog(&state, scope_key, &task, old_status, "http:tasks/delete").await;

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
    let bytes = STANDARD.decode(payload.content_base64).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid sqlite snapshot: {error}"),
        )
    })?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let imported_tasks = read_tasks_from_sqlite_snapshot(&bytes, scope_key)?;
    let result = apply_task_import(&state, scope_key, imported_tasks, strategy)?;
    Ok(Json(result))
}

async fn task_backend_status(State(state): State<AppState>) -> Json<TaskBackendStatusResponse> {
    let supports_sqlite_snapshot = matches!(
        state.task_store.backend_kind(),
        crate::task::TaskStoreBackendKind::Sqlite
    );
    Json(TaskBackendStatusResponse {
        backend: if supports_sqlite_snapshot {
            "rt-sqlite"
        } else {
            "memory"
        },
        supports_json_backup: true,
        supports_sqlite_snapshot,
    })
}

// ── Helpers ─────────────────────────────────────────────────────

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

fn build_task_replication_payload(
    state: &AppState,
    scope_key: Option<&str>,
    task: &Task,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "task_snapshot",
            "taskId": task.id,
            "updatedAt": task.updated_at,
            "originHostId": state.host_id,
        },
        "task": task,
    })
}

async fn publish_task_replication_signal(state: &AppState, scope_key: Option<&str>, task: &Task) {
    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "task.replication.upserted".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:tasks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("task:{}", task.id)),
        payload: build_task_replication_payload(state, scope_key, task),
    };

    state.signal_pool.publish(event.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.forward_event_to_peers(event).await;
    }
}

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

fn should_accept_replicated_task(
    existing: &Task,
    incoming: &Task,
    source_host_id: Option<&str>,
    local_host_id: &str,
) -> bool {
    if incoming.updated_at > existing.updated_at {
        return true;
    }
    if incoming.updated_at < existing.updated_at {
        return false;
    }

    if incoming.status.is_terminal() != existing.status.is_terminal() {
        return incoming.status.is_terminal();
    }

    if incoming.completed_at.unwrap_or(0) > existing.completed_at.unwrap_or(0) {
        return true;
    }

    if incoming.completed_at.unwrap_or(0) == existing.completed_at.unwrap_or(0) {
        if let Some(source_host_id) = source_host_id {
            return source_host_id > local_host_id;
        }
    }

    false
}

async fn replication_upsert_task(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<TaskReplicationUpsertRequest>,
) -> Result<Json<TaskReplicationUpsertResponse>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let existing = state.task_store.get_scoped(scope_key, &payload.task.id);

    let status = match existing {
        None => {
            state
                .task_store
                .upsert_scoped(scope_key, payload.task)
                .map_err(map_task_store_error)?;
            "inserted"
        }
        Some(current)
            if should_accept_replicated_task(
                &current,
                &payload.task,
                payload.source_host_id.as_deref(),
                &state.host_id,
            ) =>
        {
            state
                .task_store
                .upsert_scoped(scope_key, payload.task)
                .map_err(map_task_store_error)?;
            "updated"
        }
        Some(_) => "ignored",
    };

    Ok(Json(TaskReplicationUpsertResponse { status }))
}

fn publish_task_transition_signal(state: &AppState, old_status: TaskStatus, task: &Task) {
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
}

async fn write_task_transition_eventlog(
    state: &AppState,
    scope_key: Option<&str>,
    task: &Task,
    old_status: TaskStatus,
    trigger: &str,
) {
    let tag = task_transition_event_tag(old_status, task.status);
    let event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        content: format!("{}：{}", task_transition_event_content(tag), task.title),
        tags: vec![tag.to_string()],
        metadata: Some(serde_json::json!({
            "task_id": task.id,
            "task_title": task.title,
            "old_status": old_status,
            "new_status": task.status,
            "source": {
                "app": "exomind-runtime",
                "trigger": trigger,
            }
        })),
    };

    if let Err(error) = state.eventlog_store.append_event(scope_key, event.clone()) {
        tracing::warn!(error = %error, "failed to write task transition eventlog");
        return;
    }

    crate::routes::eventlog::publish_eventlog_replication_append(state, scope_key, &event).await;
}

fn task_transition_event_content(tag: &str) -> &'static str {
    match tag {
        "task_started" => "任务启动",
        "task_resumed" => "任务继续",
        "task_suspended" => "任务挂起",
        "task_completed" => "任务完成",
        "task_cancelled" => "任务取消",
        _ => "任务状态变更",
    }
}

fn task_transition_event_tag(old_status: TaskStatus, new_status: TaskStatus) -> &'static str {
    match (old_status, new_status) {
        (TaskStatus::Suspended, TaskStatus::InProgress) => "task_resumed",
        (_, TaskStatus::InProgress) => "task_started",
        (_, TaskStatus::Suspended) => "task_suspended",
        (_, TaskStatus::Completed) => "task_completed",
        (_, TaskStatus::Cancelled) => "task_cancelled",
        // Keep the legacy tag as a fallback for backward compatibility if a new transition appears.
        _ => "task_transition",
    }
}

fn map_task_store_error(error: TaskStoreError) -> (StatusCode, String) {
    let code = match error {
        TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::CONFLICT,
    };
    (code, error.to_string())
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

fn build_task_sqlite_snapshot_bytes(
    scope_key: Option<&str>,
    tasks: &[Task],
) -> Result<Vec<u8>, (StatusCode, String)> {
    let temp_root =
        std::env::temp_dir().join(format!("exomind-task-export-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to create task export temp dir: {error}"),
        )
    })?;
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

fn read_tasks_from_sqlite_snapshot(
    bytes: &[u8],
    scope_key: Option<&str>,
) -> Result<Vec<Task>, (StatusCode, String)> {
    let temp_path = std::env::temp_dir().join(format!(
        "exomind-task-import-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
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
        .route("/tasks/batch-transition", post(batch_transition_tasks))
        .route("/tasks/backend/status", get(task_backend_status))
        .route("/tasks/backup/json", get(export_tasks_json))
        .route("/tasks/backup/sqlite", get(export_tasks_sqlite))
        .route("/tasks/import/json", post(import_tasks_json))
        .route("/tasks/import/sqlite", post(import_tasks_sqlite))
        .route("/tasks/replication/upsert", post(replication_upsert_task))
        .route("/tasks/:id/cancel", post(cancel_task))
        .route(
            "/tasks/:id",
            get(get_task).put(update_task).delete(delete_task),
        )
        .route("/tasks/:id/transition", post(transition_task))
}

// ── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use crate::task::TaskPriority;
    use axum::body::Body;
    use axum::http::Request;
    use base64::engine::general_purpose::STANDARD;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        test_state_with_task_store(Arc::new(crate::task::TaskStore::new()))
    }

    fn test_state_with_task_store(task_store: Arc<crate::task::TaskStore>) -> AppState {
        test_state_with_task_store_and_eventlog(
            task_store,
            Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir().join(format!("exomind-test-tasks-{}", uuid::Uuid::new_v4())),
            )),
        )
    }

    fn test_state_with_task_store_and_eventlog(
        task_store: Arc<crate::task::TaskStore>,
        eventlog_store: Arc<crate::eventlog::EventLogStore>,
    ) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "tasks-test-host".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            allow_lan_without_auth: false,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            config_store: Arc::new(crate::config::ConfigStore::new()),
            reminder_store: Arc::new(crate::reminder::ReminderStore::new()),
            task_store,
            proposal_store: Arc::new(crate::proposal::ProposalStore::new()),
            session_store: Arc::new(crate::session::SessionStore::new()),
            agent_api_session_store: Arc::new(crate::agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx: {
                let (tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
                eventlog_store.set_watch_tx(tx.clone());
                tx
            },
            timeblock_store: Arc::new(crate::timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(crate::tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn create_and_list_tasks() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state.clone());

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
        assert_eq!(created["status"], "pending");
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
    async fn create_task_rejects_client_supplied_status() {
        let state = test_state();
        let app = test_router(state.clone());

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"title":"Should fail","status":"completed"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_response.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let list_response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list_response.status(), StatusCode::OK);
        let body = list_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(tasks.is_empty());
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
        let app = test_router(state.clone());

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
    async fn update_terminal_task_description_returns_conflict() {
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
            estimated_minutes: Some(30),
            time_block_ids: vec![],
        });
        state
            .task_store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap();
        state
            .task_store
            .transition(&task.id, TaskStatus::Completed)
            .unwrap();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"description":"Post-completion note"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn update_terminal_task_title_returns_conflict() {
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
        state
            .task_store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap();
        state
            .task_store
            .transition(&task.id, TaskStatus::Completed)
            .unwrap();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Renamed after completion"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn update_terminal_task_frozen_fields_return_conflict() {
        let state = test_state();
        let upstream = state.task_store.create(CreateTaskInput {
            title: "Upstream".to_string(),
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
            estimated_minutes: Some(30),
            time_block_ids: vec![],
        });
        state
            .task_store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap();
        state
            .task_store
            .transition(&task.id, TaskStatus::Completed)
            .unwrap();
        let app = test_router(state.clone());

        let estimate_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"estimated_minutes":45}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(estimate_response.status(), StatusCode::CONFLICT);

        let dependency_response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"depends_on":[{{"task_id":"{}","type":"hard"}}]}}"#,
                        upstream.id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(dependency_response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn update_task_dependency_cycle_returns_conflict() {
        let state = test_state();
        let task_a = state.task_store.create(CreateTaskInput {
            title: "A".to_string(),
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
        let task_b = state.task_store.create(CreateTaskInput {
            title: "B".to_string(),
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
        let task_c = state.task_store.create(CreateTaskInput {
            title: "C".to_string(),
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

        state
            .task_store
            .update_scoped(
                None,
                &task_a.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![crate::task::TaskDependency {
                        task_id: task_b.id.clone(),
                        relation_type: crate::task::TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();
        state
            .task_store
            .update_scoped(
                None,
                &task_b.id,
                UpdateTaskInput {
                    title: None,
                    description: None,
                    done_condition: None,
                    priority: None,
                    tags: None,
                    depends_on: Some(vec![crate::task::TaskDependency {
                        task_id: task_c.id.clone(),
                        relation_type: crate::task::TaskDependencyType::Hard,
                    }]),
                    due_at: None,
                    estimated_minutes: None,
                    parent_id: None,
                    time_block_ids: None,
                },
            )
            .unwrap();

        let app = test_router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/tasks/{}", task_c.id))
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"depends_on":[{{"task_id":"{}","type":"hard"}}]}}"#,
                        task_a.id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
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

        // pending → completed is invalid
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
    async fn transition_shortcut_pending_to_completed() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Shortcut task".to_string(),
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
                    .method("POST")
                    .uri(format!("/tasks/{}/transition?shortcut=true", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"completed"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let transitioned: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(transitioned["status"], "completed");
    }

    #[tokio::test]
    async fn transition_writes_eventlog() {
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!(
                "exomind-test-task-transition-eventlog-{}",
                uuid::Uuid::new_v4()
            )),
        ));
        let state = test_state_with_task_store_and_eventlog(
            Arc::new(crate::task::TaskStore::new()),
            eventlog_store.clone(),
        );
        let task = state.task_store.create(CreateTaskInput {
            title: "Task with eventlog".to_string(),
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
                    .uri(format!("/tasks/{}/transition", task.id))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"status":"in_progress"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tags, vec!["task_started".to_string()]);
        assert_eq!(events[0].content, "任务启动：Task with eventlog");
        assert_eq!(events[0].metadata.as_ref().unwrap()["task_id"], task.id);
        assert_eq!(
            events[0].metadata.as_ref().unwrap()["old_status"],
            "pending"
        );
        let replication = state
            .signal_pool
            .window()
            .recent(10)
            .into_iter()
            .find(|event| event.topic == "eventlog.replication.appended")
            .expect("task transition should publish eventlog.replication.appended");
        assert_eq!(
            replication.payload["scopeKey"],
            serde_json::json!("anonymous")
        );
        assert_eq!(
            replication.payload["record"]["tags"],
            serde_json::json!(["task_started"])
        );
        assert_eq!(
            events[0].metadata.as_ref().unwrap()["new_status"],
            "in_progress"
        );
    }

    #[tokio::test]
    async fn cancel_writes_eventlog() {
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!(
                "exomind-test-task-cancel-eventlog-{}",
                uuid::Uuid::new_v4()
            )),
        ));
        let state = test_state_with_task_store_and_eventlog(
            Arc::new(crate::task::TaskStore::new()),
            eventlog_store.clone(),
        );
        let task = state.task_store.create(CreateTaskInput {
            title: "Task cancel eventlog".to_string(),
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
        state
            .task_store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/tasks/{}/cancel", task.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tags, vec!["task_cancelled".to_string()]);
        assert_eq!(events[0].content, "任务取消：Task cancel eventlog");
        assert_eq!(events[0].metadata.as_ref().unwrap()["task_id"], task.id);
        assert_eq!(
            events[0].metadata.as_ref().unwrap()["new_status"],
            "cancelled"
        );
    }

    #[tokio::test]
    async fn cancel_route_cancels_task() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "To cancel".to_string(),
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
                    .uri(format!("/tasks/{}/cancel", task.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let cancelled: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(cancelled["status"], "cancelled");
    }

    #[tokio::test]
    async fn delete_route_remains_cancel_alias_for_compatibility() {
        let state = test_state();
        let task = state.task_store.create(CreateTaskInput {
            title: "Delete alias".to_string(),
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
        state
            .task_store
            .transition(&task.id, TaskStatus::InProgress)
            .unwrap();
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
        let cancelled: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(cancelled["status"], "cancelled");
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
        state
            .task_store
            .transition(&t1.id, TaskStatus::InProgress)
            .unwrap();

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
    async fn list_with_tag_filter() {
        let state = test_state();
        state.task_store.create(CreateTaskInput {
            title: "Work only".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec!["work".to_string()],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        state.task_store.create(CreateTaskInput {
            title: "Personal".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec!["personal".to_string()],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        state.task_store.create(CreateTaskInput {
            title: "Work urgent".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec!["work".to_string(), "urgent".to_string()],
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
                    .uri("/tasks?tag=work")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|task| task["title"] == "Work only"));
        assert!(tasks.iter().any(|task| task["title"] == "Work urgent"));
    }

    #[tokio::test]
    async fn list_with_parent_id_filter() {
        let state = test_state();
        let parent = state.task_store.create(CreateTaskInput {
            title: "Parent".to_string(),
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
            title: "Child A".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: Some(parent.id.clone()),
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        state.task_store.create(CreateTaskInput {
            title: "Child B".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: Some(parent.id.clone()),
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        state.task_store.create(CreateTaskInput {
            title: "Orphan".to_string(),
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
                    .uri(format!("/tasks?parent_id={}", parent.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().any(|task| task["title"] == "Child A"));
        assert!(tasks.iter().any(|task| task["title"] == "Child B"));
    }

    #[tokio::test]
    async fn list_with_combined_filters() {
        let state = test_state();
        let pending = state.task_store.create(CreateTaskInput {
            title: "Pending work".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec!["work".to_string()],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        let in_progress = state.task_store.create(CreateTaskInput {
            title: "Active work".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec!["work".to_string()],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        state.task_store.create(CreateTaskInput {
            title: "Pending personal".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec!["personal".to_string()],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
        state
            .task_store
            .transition(&in_progress.id, TaskStatus::InProgress)
            .unwrap();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks?status=pending&tag=work")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["id"], pending.id);
    }

    #[tokio::test]
    async fn batch_transition_succeeds_for_valid_tasks() {
        let state = test_state();
        let task_a = state.task_store.create(CreateTaskInput {
            title: "Task A".to_string(),
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
        let task_b = state.task_store.create(CreateTaskInput {
            title: "Task B".to_string(),
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
        let task_c = state.task_store.create(CreateTaskInput {
            title: "Task C".to_string(),
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
                    .method("POST")
                    .uri("/tasks/batch-transition")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{
                            "tasks": [
                                {{"id":"{}","status":"in_progress"}},
                                {{"id":"{}","status":"in_progress"}},
                                {{"id":"{}","status":"in_progress"}}
                            ]
                        }}"#,
                        task_a.id, task_b.id, task_c.id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["succeeded"], 3);
        assert_eq!(payload["failed"], 0);
        assert_eq!(
            payload["results"].as_array().map(|items| items.len()),
            Some(3)
        );
    }

    #[tokio::test]
    async fn batch_transition_partial_failure() {
        let state = test_state();
        let pending = state.task_store.create(CreateTaskInput {
            title: "Pending".to_string(),
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
        let completed = state.task_store.create(CreateTaskInput {
            title: "Completed".to_string(),
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
        state
            .task_store
            .transition(&completed.id, TaskStatus::InProgress)
            .unwrap();
        state
            .task_store
            .transition(&completed.id, TaskStatus::Completed)
            .unwrap();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/batch-transition")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{
                            "tasks": [
                                {{"id":"{}","status":"in_progress"}},
                                {{"id":"{}","status":"in_progress"}}
                            ]
                        }}"#,
                        pending.id, completed.id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["succeeded"], 1);
        assert_eq!(payload["failed"], 1);
        let results = payload["results"].as_array().unwrap();
        assert!(results.iter().any(|result| result["success"] == true));
        assert!(results.iter().any(|result| result["success"] == false));
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
        assert_eq!(
            payload["tasks"].as_array().map(|items| items.len()),
            Some(1)
        );
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
                                    "status": "pending",
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
        assert_eq!(
            task_store.list().len(),
            1,
            "default access should continue using anonymous scope"
        );
        assert_eq!(
            task_store.list_in_scope(Some("profile-a")).len(),
            1,
            "profile scope should stay isolated in sqlite backend",
        );
    }

    #[tokio::test]
    async fn task_routes_accept_user_id_alias_for_scoped_queries() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-user-id-scoped.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"User A task"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/tasks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let scoped_tasks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        assert_eq!(scoped_tasks.len(), 1);
        assert_eq!(scoped_tasks[0]["title"], "User A task");
        assert!(
            task_store.list().is_empty(),
            "default anonymous scope should stay isolated"
        );
        assert_eq!(task_store.list_in_scope(Some("user-a")).len(), 1);
    }

    #[tokio::test]
    async fn scoped_task_replication_payload_includes_scope_key() {
        let state = test_state();
        let app = test_router(state.clone());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks?user_id=profile-argon")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"title":"Scoped replication task"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        let replication = state
            .signal_pool
            .window()
            .recent(10)
            .into_iter()
            .find(|event| event.topic == "task.replication.upserted")
            .expect("task create should publish task.replication.upserted");

        assert_eq!(
            replication.payload["scopeKey"],
            serde_json::json!("profile-argon")
        );
        assert_eq!(
            replication.payload["cursor"]["kind"],
            serde_json::json!("task_snapshot")
        );
    }

    #[tokio::test]
    async fn replication_upsert_inserts_scoped_task_and_ignores_older_snapshot() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-replication.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/replication/upsert?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                        "task": {
                            "id": "task-rep-1",
                            "title": "Replicated task",
                            "description": null,
                            "done_condition": null,
                            "status": "pending",
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
                        },
                        "source_host_id": "desktop-host"
                    }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/replication/upsert?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                        "task": {
                            "id": "task-rep-1",
                            "title": "Replicated task older",
                            "description": null,
                            "done_condition": null,
                            "status": "pending",
                            "priority": "medium",
                            "tags": [],
                            "source": null,
                            "parent_id": null,
                            "depends_on": [],
                            "due_at": null,
                            "estimated_minutes": null,
                            "time_block_ids": [],
                            "created_at": 1000,
                            "updated_at": 1500,
                            "completed_at": null
                        },
                        "source_host_id": "mobile-host"
                    }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ignored");

        let scoped_tasks = task_store.list_in_scope(Some("user-a"));
        assert_eq!(scoped_tasks.len(), 1);
        assert_eq!(scoped_tasks[0].title, "Replicated task");
        assert_eq!(scoped_tasks[0].updated_at, 2000);
        assert!(
            task_store.list().is_empty(),
            "anonymous scope should remain isolated from replicated scoped data"
        );
    }
}
