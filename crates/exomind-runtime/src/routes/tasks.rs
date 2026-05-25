use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

use crate::AppState;
use crate::eventlog::EventListFilter;
use crate::auth::AuthenticatedPeerIdentity;
use crate::signal::types::SignalEvent;
use crate::task::store::{
    TaskStoreError, append_task_status_transition, build_initial_task_status_transition,
    compare_task_replication_preference, merge_task_snapshot, merge_task_status_history,
    normalize_task_status_history, prepare_task_for_storage, task_replication_revision_projection,
    validate_partial_task_status_history,
};
use crate::task::{
    BatchTransitionInput, BatchTransitionResponse, BatchTransitionResult, CreateTaskInput, Task,
    TaskStatus, TaskTransitionContext, TaskTransitionReason, TransitionInput, UpdateTaskInput,
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
    #[serde(rename = "source_host_id")]
    #[serde(default)]
    _source_host_id: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct TaskReplicationSummary {
    schema_version: u32,
    scope_key: String,
    task_count: usize,
    max_updated_at: u64,
    revision_hash: String,
    generated_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct TaskReplicationPullCursor {
    kind: String,
    updated_at: u64,
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct TaskReplicationPullQuery {
    #[serde(default)]
    after_updated_at: Option<u64>,
    #[serde(default)]
    after_task_id: Option<String>,
    #[serde(default = "default_task_replication_pull_limit")]
    limit: usize,
}

#[derive(Debug, Deserialize)]
struct ScopedTaskReplicationPullQuery {
    #[serde(default)]
    after_updated_at: Option<u64>,
    #[serde(default)]
    after_task_id: Option<String>,
    #[serde(default = "default_task_replication_pull_limit")]
    limit: usize,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TaskReplicationPullResponse {
    schema_version: u32,
    scope_key: String,
    items: Vec<Task>,
    next_cursor: Option<TaskReplicationPullCursor>,
    has_more: bool,
    summary: TaskReplicationSummary,
}

#[derive(Debug, Serialize)]
struct TaskScopeGrantReconcileResponse {
    scope_key: String,
    granted_peers: usize,
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

const TASK_SCOPE_GRANT_DOMAIN: &str = "tasks";

// ── Handlers ────────────────────────────────────────────────────

/// GET /tasks
async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Json<Vec<Task>> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    ensure_legacy_task_status_history_repaired(&state, scope_key);
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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
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
    publish_task_replication_signal(&state, scope_key, &task);

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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    let task = state
        .task_store
        .update_scoped(scope_key, &id, input)
        .map_err(|error| match error {
            TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            _ => StatusCode::CONFLICT,
        })?;

    publish_task_signal(&state, "task.updated", &task);
    publish_task_replication_signal(&state, scope_key, &task);

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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    let steps = transition_task_in_scope_with_context(
        &state,
        scope_key,
        &id,
        input.status,
        query.shortcut.unwrap_or(false),
        TaskTransitionContext {
            reason: Some(TaskTransitionReason::TaskTransition),
            actor_id: Some("rt:tasks/transition".to_string()),
            source_host_id: Some(state.host_id.clone()),
            operation_id: Some(uuid::Uuid::new_v4().to_string()),
            ..TaskTransitionContext::default()
        },
        "http:tasks/transition",
    )
    .await;
    let (_, final_task) = steps?.last().cloned().ok_or((
        StatusCode::CONFLICT,
        "task already at target status".to_string(),
    ))?;
    Ok(Json(final_task))
}

async fn batch_transition_tasks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<BatchTransitionInput>,
) -> Json<BatchTransitionResponse> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    let use_shortcut = input.shortcut.unwrap_or(false);
    let mut results = Vec::with_capacity(input.tasks.len());
    let mut succeeded = 0usize;
    let mut failed = 0usize;

    for item in input.tasks {
        match transition_task_in_scope_with_context(
            &state,
            scope_key,
            &item.id,
            item.status,
            use_shortcut,
            TaskTransitionContext {
                reason: Some(TaskTransitionReason::TaskTransition),
                actor_id: Some("rt:tasks/batch-transition".to_string()),
                source_host_id: Some(state.host_id.clone()),
                operation_id: Some(uuid::Uuid::new_v4().to_string()),
                ..TaskTransitionContext::default()
            },
            "http:tasks/batch-transition",
        )
        .await
        {
            Ok(steps) => {
                let Some((old_status, task)) = steps.last().cloned() else {
                    failed += 1;
                    results.push(BatchTransitionResult {
                        id: item.id,
                        success: false,
                        old_status: None,
                        new_status: None,
                        error: Some("task already at target status".to_string()),
                    });
                    continue;
                };
                succeeded += 1;
                results.push(BatchTransitionResult {
                    id: item.id,
                    success: true,
                    old_status: Some(old_status),
                    new_status: Some(task.status),
                    error: None,
                });
            }
            Err((_, error)) => {
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

pub(crate) async fn transition_task_in_scope_with_context(
    state: &AppState,
    scope_key: Option<&str>,
    id: &str,
    target_status: TaskStatus,
    shortcut: bool,
    context: TaskTransitionContext,
    trigger: &str,
) -> Result<Vec<(TaskStatus, Task)>, (StatusCode, String)> {
    let steps = if shortcut {
        state
            .task_store
            .transition_with_shortcut_scoped_with_context(scope_key, id, target_status, context)
            .map_err(map_task_store_error)?
    } else {
        vec![
            state
                .task_store
                .transition_scoped_with_context(scope_key, id, target_status, context)
                .map_err(map_task_store_error)?,
        ]
    };

    for (old_status, task) in &steps {
        publish_task_transition_signal(state, *old_status, task);
        publish_task_replication_signal(state, scope_key, task);
        write_task_transition_eventlog(state, scope_key, task, *old_status, trigger).await;
    }

    Ok(steps)
}

fn cancel_task_in_scope_with_context(
    state: &AppState,
    scope_key: Option<&str>,
    id: &str,
    context: TaskTransitionContext,
) -> Result<(TaskStatus, Task), (StatusCode, String)> {
    let old_status = state
        .task_store
        .get_scoped(scope_key, id)
        .map(|task| task.status)
        .ok_or((StatusCode::NOT_FOUND, format!("task not found: {id}")))?;
    let task = state
        .task_store
        .cancel_scoped_with_context(scope_key, id, context)
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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    let (old_status, task) = cancel_task_in_scope_with_context(
        &state,
        scope_key,
        &id,
        TaskTransitionContext {
            reason: Some(TaskTransitionReason::TaskTransition),
            actor_id: Some("rt:tasks/cancel".to_string()),
            source_host_id: Some(state.host_id.clone()),
            operation_id: Some(uuid::Uuid::new_v4().to_string()),
            ..TaskTransitionContext::default()
        },
    )?;

    publish_task_transition_signal(&state, old_status, &task);
    publish_task_signal(&state, "task.cancelled", &task);
    publish_task_replication_signal(&state, scope_key, &task);
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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    let (old_status, task) = cancel_task_in_scope_with_context(
        &state,
        scope_key,
        &id,
        TaskTransitionContext {
            reason: Some(TaskTransitionReason::TaskTransition),
            actor_id: Some("rt:tasks/delete".to_string()),
            source_host_id: Some(state.host_id.clone()),
            operation_id: Some(uuid::Uuid::new_v4().to_string()),
            ..TaskTransitionContext::default()
        },
    )?;

    publish_task_transition_signal(&state, old_status, &task);
    publish_task_signal(&state, "task.cancelled", &task);
    publish_task_replication_signal(&state, scope_key, &task);
    write_task_transition_eventlog(&state, scope_key, &task, old_status, "http:tasks/delete").await;

    Ok(Json(task))
}

async fn export_tasks_json(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Json<TaskBackupJsonPayload> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    ensure_legacy_task_status_history_repaired(&state, scope_key);
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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
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
    ensure_legacy_task_status_history_repaired(&state, scope_key);
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

async fn replication_summary_tasks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Json<TaskReplicationSummary> {
    let scope_key = scope_query_key(&query);
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    Json(build_task_replication_summary(
        scope_key,
        &state.task_store.list_scoped(scope_key),
    ))
}

async fn replication_pull_tasks(
    State(state): State<AppState>,
    Query(query): Query<ScopedTaskReplicationPullQuery>,
) -> Json<TaskReplicationPullResponse> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    ensure_legacy_task_status_history_repaired(&state, scope_key);
    Json(build_task_replication_pull_response(
        scope_key,
        &state.task_store.list_scoped(scope_key),
        TaskReplicationPullQuery {
            after_updated_at: query.after_updated_at,
            after_task_id: query.after_task_id,
            limit: query.limit,
        },
    ))
}

async fn reconcile_task_scope_grants(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TaskScopeGrantReconcileResponse>, (StatusCode, String)> {
    let scope_key = require_named_scope_key(scope_query_key(&query))?;
    let grants = state.mesh.reconcile_scope_grants_for_enabled_peers(
        TASK_SCOPE_GRANT_DOMAIN,
        scope_key,
        "http:mesh/tasks/grants/reconcile",
    );

    Ok(Json(TaskScopeGrantReconcileResponse {
        scope_key: scope_key.to_string(),
        granted_peers: grants.len(),
    }))
}

async fn mesh_task_replication_summary(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedPeerIdentity>,
) -> Result<Json<TaskReplicationSummary>, (StatusCode, String)> {
    let scope_key = resolve_peer_scope_key(&state, &identity)?;
    ensure_legacy_task_status_history_repaired(&state, Some(scope_key.as_str()));
    let tasks = state.task_store.list_scoped(Some(scope_key.as_str()));
    Ok(Json(build_task_replication_summary(
        Some(scope_key.as_str()),
        &tasks,
    )))
}

async fn mesh_task_replication_pull(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedPeerIdentity>,
    Query(query): Query<TaskReplicationPullQuery>,
) -> Result<Json<TaskReplicationPullResponse>, (StatusCode, String)> {
    let scope_key = resolve_peer_scope_key(&state, &identity)?;
    ensure_legacy_task_status_history_repaired(&state, Some(scope_key.as_str()));
    let tasks = state.task_store.list_scoped(Some(scope_key.as_str()));
    Ok(Json(build_task_replication_pull_response(
        Some(scope_key.as_str()),
        &tasks,
        query,
    )))
}

async fn mesh_export_tasks_sqlite(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedPeerIdentity>,
) -> Result<Json<TaskBackupSqlitePayload>, (StatusCode, String)> {
    let scope_key = resolve_peer_scope_key(&state, &identity)?;
    ensure_legacy_task_status_history_repaired(&state, Some(scope_key.as_str()));
    let tasks = state.task_store.list_scoped(Some(scope_key.as_str()));
    let bytes = build_task_sqlite_snapshot_bytes(Some(scope_key.as_str()), &tasks)?;

    Ok(Json(TaskBackupSqlitePayload {
        version: 1,
        file_name: "exomind-tasks.sqlite".to_string(),
        content_base64: STANDARD.encode(bytes),
        task_count: tasks.len(),
    }))
}

async fn proxy_peer_task_replication_summary(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<TaskReplicationSummary>, (StatusCode, String)> {
    let summary =
        proxy_peer_json::<TaskReplicationSummary>(&state, &peer_id, "/mesh/tasks/summary", None)
            .await?;
    Ok(Json(summary))
}

async fn proxy_peer_task_replication_pull(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<TaskReplicationPullQuery>,
) -> Result<Json<TaskReplicationPullResponse>, (StatusCode, String)> {
    let mut params = Vec::new();
    if let Some(after_updated_at) = query.after_updated_at {
        params.push(("after_updated_at", after_updated_at.to_string()));
    }
    if let Some(after_task_id) = query.after_task_id {
        params.push(("after_task_id", after_task_id));
    }
    params.push(("limit", query.limit.to_string()));

    let response = proxy_peer_json::<TaskReplicationPullResponse>(
        &state,
        &peer_id,
        "/mesh/tasks/pull",
        Some(params),
    )
    .await?;
    Ok(Json(response))
}

async fn proxy_peer_tasks_sqlite_snapshot(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<TaskBackupSqlitePayload>, (StatusCode, String)> {
    let payload = proxy_peer_json::<TaskBackupSqlitePayload>(
        &state,
        &peer_id,
        "/mesh/tasks/snapshot/sqlite",
        None,
    )
    .await?;
    Ok(Json(payload))
}

// ── Helpers ─────────────────────────────────────────────────────

fn default_task_replication_pull_limit() -> usize {
    200
}

fn scope_query_key(query: &ScopeQuery) -> Option<&str> {
    query.profile_id.as_deref().or(query.user_id.as_deref())
}

fn require_named_scope_key(scope_key: Option<&str>) -> Result<&str, (StatusCode, String)> {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "task scope grant reconciliation requires profile_id/user_id".to_string(),
        ))
}

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

const LEGACY_STATUS_HISTORY_REPAIR_META_KEY: &str = "legacy_status_history_repair";
const LEGACY_STATUS_HISTORY_REPAIR_VERSION: &str = "v1";
const LEGACY_STATUS_HISTORY_REPAIR_ACTOR_ID: &str = "system:legacy-status-history-repair";
const LEGACY_STATUS_HISTORY_REPAIR_OPERATION_PREFIX: &str = "legacy-status-history-repair:v1";

#[derive(Debug, Clone)]
enum LegacyTaskEventKind {
    Transition {
        old_status: Option<TaskStatus>,
        new_status: TaskStatus,
        reason: TaskTransitionReason,
    },
}

#[derive(Debug, Clone)]
struct LegacyTaskEvent {
    event_id: String,
    at: u64,
    source_host_id: Option<String>,
    related_time_block_id: Option<String>,
    related_time_block_transition_ref: Option<String>,
    kind: LegacyTaskEventKind,
}

fn ensure_legacy_task_status_history_repaired(state: &AppState, scope_key: Option<&str>) {
    let already_repaired = match state
        .task_store
        .get_meta_scoped(scope_key, LEGACY_STATUS_HISTORY_REPAIR_META_KEY)
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(
                error = %error,
                scope_key = %normalize_scope_key(scope_key),
                "failed to read legacy task status history repair marker"
            );
            return;
        }
    };
    if already_repaired.as_deref() == Some(LEGACY_STATUS_HISTORY_REPAIR_VERSION) {
        return;
    }

    let candidates = state.task_store.list_scoped_empty_transitions(scope_key);

    let mut can_mark_complete = true;
    let mut repaired_count = 0usize;

    if !candidates.is_empty() {
        let candidate_ids: Vec<String> = candidates.iter().map(|t| t.id.clone()).collect();
        let mut events = match state.eventlog_store.list_events_filtered(
            scope_key,
            &EventListFilter {
                task_ids: candidate_ids,
                ..Default::default()
            },
        ) {
            Ok(events) => events,
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    scope_key = %normalize_scope_key(scope_key),
                    "failed to load eventlog for legacy task status history repair"
                );
                return;
            }
        };
        events.sort_by(|left, right| {
            left.timestamp
                .cmp(&right.timestamp)
                .then_with(|| left.id.cmp(&right.id))
        });

        for task in candidates {
            let Some(repaired) =
                build_repaired_task_from_eventlog(state, scope_key, &task, &events)
            else {
                continue;
            };

            match state.task_store.upsert_scoped(scope_key, repaired.clone()) {
                Ok(stored) => {
                    repaired_count += 1;
                    publish_task_replication_signal(state, scope_key, &stored);
                }
                Err(error) => {
                    can_mark_complete = false;
                    tracing::warn!(
                        error = %error,
                        task_id = %task.id,
                        scope_key = %normalize_scope_key(scope_key),
                        "failed to persist repaired legacy task status history"
                    );
                }
            }
        }
    }

    if !can_mark_complete {
        return;
    }

    if state
        .task_store
        .list_scoped(scope_key)
        .iter()
        .any(|task| task.status_transitions.is_empty())
    {
        return;
    }

    if let Err(error) = state.task_store.set_meta_scoped(
        scope_key,
        LEGACY_STATUS_HISTORY_REPAIR_META_KEY,
        LEGACY_STATUS_HISTORY_REPAIR_VERSION,
    ) {
        tracing::warn!(
            error = %error,
            scope_key = %normalize_scope_key(scope_key),
            "failed to persist legacy task status history repair marker"
        );
        return;
    }

    if repaired_count > 0 {
        tracing::info!(
            repaired_count,
            scope_key = %normalize_scope_key(scope_key),
            "repaired legacy task status history from eventlog"
        );
    }
}

fn build_repaired_task_from_eventlog(
    state: &AppState,
    scope_key: Option<&str>,
    task: &Task,
    events: &[crate::eventlog::EventRecord],
) -> Option<Task> {
    let task_events = events
        .iter()
        .filter_map(|event| parse_legacy_task_event(&task.id, event))
        .collect::<Vec<_>>();
    if task.status != TaskStatus::Pending && task_events.is_empty() {
        return None;
    }

    let mut task_events = task_events;
    task_events.sort_by(|left, right| {
        left.at
            .cmp(&right.at)
            .then_with(|| left.event_id.cmp(&right.event_id))
    });

    let mut repaired = task.clone();
    repaired.status = TaskStatus::Pending;
    repaired.completed_at = None;
    repaired.status_transitions.clear();
    let create_at = task_events
        .first()
        .map(|first_event| task.created_at.min(first_event.at.saturating_sub(1)))
        .unwrap_or(task.created_at);
    repaired
        .status_transitions
        .push(build_repaired_create_transition(
            &task.id,
            scope_key,
            create_at,
            &state.host_id,
        ));

    let mut previous_status = TaskStatus::Pending;
    for event in task_events {
        let LegacyTaskEventKind::Transition {
            old_status,
            new_status,
            reason,
        } = event.kind;

        if old_status.is_some() && old_status != Some(previous_status) {
            return None;
        }
        if !previous_status.can_transition_to(&new_status) {
            return None;
        }

        let actual_at = append_task_status_transition(
            &mut repaired,
            previous_status,
            new_status,
            &crate::task::TaskTransitionContext {
                at: Some(event.at),
                reason: Some(reason),
                actor_id: Some(LEGACY_STATUS_HISTORY_REPAIR_ACTOR_ID.to_string()),
                source_host_id: Some(
                    event
                        .source_host_id
                        .unwrap_or_else(|| state.host_id.clone()),
                ),
                operation_id: Some(format!(
                    "{}:event:{}",
                    legacy_status_history_repair_operation_base(scope_key, &task.id),
                    event.event_id
                )),
                related_time_block_id: event.related_time_block_id,
                related_time_block_transition_ref: event.related_time_block_transition_ref,
                auto_generated: Some(true),
            },
        );
        if actual_at != event.at {
            return None;
        }

        repaired.status = new_status;
        repaired.completed_at = new_status.is_terminal().then_some(actual_at);
        previous_status = new_status;
    }

    repaired.updated_at = legacy_status_history_repair_updated_at(task.updated_at);
    prepare_task_for_storage(&mut repaired).ok()?;

    if repaired.status != task.status || repaired.completed_at != task.completed_at {
        return None;
    }

    Some(repaired)
}

fn build_repaired_create_transition(
    task_id: &str,
    scope_key: Option<&str>,
    at: u64,
    repair_host_id: &str,
) -> crate::task::TaskStatusTransition {
    let mut transition = build_initial_task_status_transition(task_id, at);
    transition.actor_id = Some(LEGACY_STATUS_HISTORY_REPAIR_ACTOR_ID.to_string());
    transition.source_host_id = Some(repair_host_id.to_string());
    transition.operation_id = Some(format!(
        "{}:bootstrap",
        legacy_status_history_repair_operation_base(scope_key, task_id)
    ));
    transition.auto_generated = Some(true);
    transition
}

fn legacy_status_history_repair_operation_base(scope_key: Option<&str>, task_id: &str) -> String {
    format!(
        "{LEGACY_STATUS_HISTORY_REPAIR_OPERATION_PREFIX}:{}:{task_id}",
        normalize_scope_key(scope_key)
    )
}

fn legacy_status_history_repair_updated_at(previous_updated_at: u64) -> u64 {
    previous_updated_at.saturating_add(1)
}

fn parse_legacy_task_event(
    task_id: &str,
    event: &crate::eventlog::EventRecord,
) -> Option<LegacyTaskEvent> {
    let metadata = event.metadata.as_ref()?;
    if metadata_string(metadata, &["record_type", "recordType"])
        == Some("task_status_change_description")
    {
        return None;
    }
    let metadata_task_id = metadata_string(metadata, &["task_id", "taskId"])?;
    if metadata_task_id != task_id {
        return None;
    }

    let tag = task_event_tag(event)?;
    let at = u64::try_from(event.timestamp).ok()?;

    if tag == "task_created" {
        return None;
    }

    let old_status = metadata_value(
        metadata,
        &["old_status", "oldStatus", "from_status", "fromStatus"],
    )
    .and_then(parse_task_status_value);
    let new_status = metadata_value(
        metadata,
        &["new_status", "newStatus", "to_status", "toStatus"],
    )
    .and_then(parse_task_status_value)
    .or_else(|| infer_task_status_from_tag(tag))?;
    let reason = metadata_value(metadata, &["transition_reason", "transitionReason"])
        .and_then(parse_task_transition_reason_value)
        .unwrap_or(TaskTransitionReason::TaskTransition);

    let kind = LegacyTaskEventKind::Transition {
        old_status,
        new_status,
        reason,
    };

    Some(LegacyTaskEvent {
        event_id: event.id.clone(),
        at,
        source_host_id: metadata_string(metadata, &["source_host_id", "sourceHostId"])
            .map(str::to_string),
        related_time_block_id: metadata_string(
            metadata,
            &["related_time_block_id", "relatedTimeBlockId"],
        )
        .map(str::to_string),
        related_time_block_transition_ref: metadata_string(
            metadata,
            &[
                "related_time_block_transition_ref",
                "relatedTimeBlockTransitionRef",
            ],
        )
        .map(str::to_string),
        kind,
    })
}

fn task_event_tag(event: &crate::eventlog::EventRecord) -> Option<&str> {
    const TASK_EVENT_TAGS: [&str; 7] = [
        "task_created",
        "task_started",
        "task_resumed",
        "task_suspended",
        "task_completed",
        "task_cancelled",
        "task_transition",
    ];

    event.tags.iter().find_map(|tag| {
        TASK_EVENT_TAGS
            .contains(&tag.as_str())
            .then_some(tag.as_str())
    })
}

fn infer_task_status_from_tag(tag: &str) -> Option<TaskStatus> {
    match tag {
        "task_started" | "task_resumed" => Some(TaskStatus::InProgress),
        "task_suspended" => Some(TaskStatus::Suspended),
        "task_completed" => Some(TaskStatus::Completed),
        "task_cancelled" => Some(TaskStatus::Cancelled),
        _ => None,
    }
}

fn metadata_value<'a>(
    metadata: &'a serde_json::Value,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    let object = metadata.as_object()?;
    for key in keys {
        if let Some(value) = object.get(*key) {
            return Some(value);
        }
    }
    None
}

fn metadata_string<'a>(metadata: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    metadata_value(metadata, keys)?.as_str()
}

fn parse_task_status_value(value: &serde_json::Value) -> Option<TaskStatus> {
    match value.as_str()? {
        "pending" | "not_started" => Some(TaskStatus::Pending),
        "in_progress" => Some(TaskStatus::InProgress),
        "suspended" => Some(TaskStatus::Suspended),
        "completed" => Some(TaskStatus::Completed),
        "cancelled" | "abandoned" => Some(TaskStatus::Cancelled),
        _ => None,
    }
}

fn parse_task_transition_reason_value(value: &serde_json::Value) -> Option<TaskTransitionReason> {
    match value.as_str()? {
        "task.create" => Some(TaskTransitionReason::TaskCreate),
        "task.transition" => Some(TaskTransitionReason::TaskTransition),
        "timeblock.pause" => Some(TaskTransitionReason::TimeblockPause),
        "timeblock.resume" => Some(TaskTransitionReason::TimeblockResume),
        "timeblock.end" => Some(TaskTransitionReason::TimeblockEnd),
        _ => None,
    }
}

fn build_task_replication_summary(
    scope_key: Option<&str>,
    tasks: &[Task],
) -> TaskReplicationSummary {
    let mut canonical = tasks.to_vec();
    canonical.sort_by(|left, right| left.id.cmp(&right.id));
    let canonical_json = canonical
        .iter()
        .map(task_replication_revision_projection)
        .collect::<Vec<_>>();
    let revision_hash = serde_json::to_vec(&canonical_json)
        .map(|bytes| {
            let digest = Sha256::digest(bytes);
            digest
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        })
        .unwrap_or_else(|_| "task-summary-hash-error".to_string());

    TaskReplicationSummary {
        schema_version: 1,
        scope_key: normalize_scope_key(scope_key),
        task_count: tasks.len(),
        max_updated_at: tasks.iter().map(|task| task.updated_at).max().unwrap_or(0),
        revision_hash,
        generated_at: chrono::Utc::now().timestamp_millis().max(0) as u64,
    }
}

fn build_task_replication_pull_response(
    scope_key: Option<&str>,
    tasks: &[Task],
    query: TaskReplicationPullQuery,
) -> TaskReplicationPullResponse {
    let limit = query.limit.clamp(1, 500);
    let after_task_id = query.after_task_id.unwrap_or_default();

    let mut filtered = tasks.to_vec();
    filtered.sort_by(|left, right| {
        left.updated_at
            .cmp(&right.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    filtered.retain(|task| {
        query.after_updated_at.map_or(true, |after_updated_at| {
            task.updated_at > after_updated_at
                || (task.updated_at == after_updated_at
                    && task.id.as_str() > after_task_id.as_str())
        })
    });

    let has_more = filtered.len() > limit;
    let items = filtered.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = if has_more {
        items.last().map(task_replication_pull_cursor_from_task)
    } else {
        None
    };

    TaskReplicationPullResponse {
        schema_version: 1,
        scope_key: normalize_scope_key(scope_key),
        items,
        next_cursor,
        has_more,
        summary: build_task_replication_summary(scope_key, tasks),
    }
}

fn task_replication_pull_cursor_from_task(task: &Task) -> TaskReplicationPullCursor {
    TaskReplicationPullCursor {
        kind: "task_watermark".to_string(),
        updated_at: task.updated_at,
        task_id: task.id.clone(),
    }
}

fn resolve_peer_scope_key(
    state: &AppState,
    identity: &AuthenticatedPeerIdentity,
) -> Result<String, (StatusCode, String)> {
    state
        .mesh
        .resolve_scope_key_for_peer_domain(&identity.peer_id, TASK_SCOPE_GRANT_DOMAIN)
        .map_err(|error| (StatusCode::FORBIDDEN, error.to_string()))?
        .ok_or((
            StatusCode::FORBIDDEN,
            format!(
                "peer scope grant missing: peer_id={} domain={}",
                identity.peer_id, TASK_SCOPE_GRANT_DOMAIN
            ),
        ))
}

async fn proxy_peer_json<T: DeserializeOwned>(
    state: &AppState,
    peer_id: &str,
    remote_path: &str,
    query: Option<Vec<(&str, String)>>,
) -> Result<T, (StatusCode, String)> {
    let peer = state.mesh.get_peer(peer_id).ok_or((
        StatusCode::NOT_FOUND,
        format!("mesh peer not found: {peer_id}"),
    ))?;
    if !peer.enabled {
        return Err((
            StatusCode::CONFLICT,
            format!("mesh peer disabled: {peer_id}"),
        ));
    }
    let auth_token = peer.auth_token.ok_or((
        StatusCode::CONFLICT,
        format!("mesh peer missing outbound auth token: {peer_id}"),
    ))?;
    let url = build_peer_proxy_url(&peer.base_url, remote_path, query)?;
    let url_text = url.to_string();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {auth_token}"))
        .send()
        .await
        .map_err(|error| {
            (
                StatusCode::BAD_GATEWAY,
                format!(
                    "peer task proxy request failed for peer {peer_id} url={url_text}: {error}"
                ),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = read_peer_proxy_error_detail(response).await;
        return Err((
            status,
            format!(
                "peer task proxy request returned status {status} for peer {peer_id} url={url_text}{}",
                detail
                    .map(|value| format!(" detail={value}"))
                    .unwrap_or_default()
            ),
        ));
    }

    response.json::<T>().await.map_err(|error| {
        (
            StatusCode::BAD_GATEWAY,
            format!("peer task proxy response decode failed: {error}"),
        )
    })
}

const MAX_PEER_PROXY_ERROR_DETAIL_LEN: usize = 320;

fn truncate_peer_proxy_error_detail(value: &str) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated = chars
        .by_ref()
        .take(MAX_PEER_PROXY_ERROR_DETAIL_LEN)
        .collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

fn summarize_peer_proxy_error_body(raw: &str) -> Option<String> {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }

    let from_json = serde_json::from_str::<serde_json::Value>(&normalized)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|field| field.as_str())
                .or_else(|| value.get("message").and_then(|field| field.as_str()))
                .or_else(|| value.get("detail").and_then(|field| field.as_str()))
                .map(truncate_peer_proxy_error_detail)
        });

    from_json.or_else(|| Some(truncate_peer_proxy_error_detail(&normalized)))
}

async fn read_peer_proxy_error_detail(response: reqwest::Response) -> Option<String> {
    let body = response.text().await.ok()?;
    summarize_peer_proxy_error_body(&body)
}

fn build_peer_proxy_url(
    base_url: &str,
    remote_path: &str,
    query: Option<Vec<(&str, String)>>,
) -> Result<reqwest::Url, (StatusCode, String)> {
    let mut url = reqwest::Url::parse(&format!(
        "{}{}",
        base_url.trim_end_matches('/'),
        remote_path
    ))
    .map_err(|error| {
        (
            StatusCode::BAD_GATEWAY,
            format!("invalid mesh peer base url: {error}"),
        )
    })?;

    if let Some(query) = query {
        {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, &value);
            }
        }
    }

    Ok(url)
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

pub(crate) fn publish_task_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    task: &Task,
) {
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
        let relay = std::sync::Arc::clone(mesh_relay);
        tokio::spawn(async move {
            relay.forward_event_to_peers(event).await;
        });
    }
}

fn notify_local_task_replication_applied(state: &AppState, scope_key: Option<&str>, task: &Task) {
    state.signal_pool.publish(SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "task.replication.upserted".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:tasks/replication".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("task:{}", task.id)),
        payload: build_task_replication_payload(state, scope_key, task),
    });
}

pub(crate) fn publish_task_signal(state: &AppState, topic: &str, task: &Task) {
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

fn should_accept_replicated_task(existing: &Task, incoming: &Task) -> bool {
    compare_task_replication_preference(existing, incoming) == std::cmp::Ordering::Greater
}

async fn replication_upsert_task(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<TaskReplicationUpsertRequest>,
) -> Result<Json<TaskReplicationUpsertResponse>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let incoming = normalize_incoming_task_snapshot(payload.task)?;
    let incoming_id = incoming.id.clone();
    let existing = state.task_store.get_scoped(scope_key, &incoming.id);

    let status = match existing {
        None => {
            state
                .task_store
                .upsert_scoped(scope_key, incoming)
                .map_err(map_task_store_error)?;
            let stored = state
                .task_store
                .get_scoped(scope_key, &incoming_id)
                .ok_or((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "task replication insert succeeded but task is unreadable".to_string(),
                ))?;
            notify_local_task_replication_applied(&state, scope_key, &stored);
            "inserted"
        }
        Some(current) => {
            let should_accept = should_accept_replicated_task(&current, &incoming);
            let history_changed =
                merge_task_status_history(&current, &incoming) != current.status_transitions;

            if should_accept {
                state
                    .task_store
                    .upsert_scoped(scope_key, merge_task_snapshot(&current, &incoming, true))
                    .map_err(map_task_store_error)?;
                let stored = state
                    .task_store
                    .get_scoped(scope_key, &incoming_id)
                    .ok_or((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "task replication update succeeded but task is unreadable".to_string(),
                    ))?;
                notify_local_task_replication_applied(&state, scope_key, &stored);
                "updated"
            } else if history_changed {
                state
                    .task_store
                    .upsert_scoped(scope_key, merge_task_snapshot(&current, &incoming, false))
                    .map_err(map_task_store_error)?;
                let stored = state
                    .task_store
                    .get_scoped(scope_key, &incoming_id)
                    .ok_or((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "task replication merge succeeded but task is unreadable".to_string(),
                    ))?;
                notify_local_task_replication_applied(&state, scope_key, &stored);
                "updated"
            } else {
                "ignored"
            }
        }
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
    let latest_transition = task
        .status_transitions
        .iter()
        .rev()
        .find(|transition| transition.to_status == task.status);
    let tag = task_transition_event_tag(old_status, task.status);
    let event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: latest_transition
            .map(|transition| transition.at as i64)
            .unwrap_or(task.updated_at as i64),
        content: format!("{}：{}", task_transition_event_content(tag), task.title),
        tags: vec![tag.to_string()],
        refs: vec![],
        metadata: Some(serde_json::json!({
            "task_id": task.id,
            "task_title": task.title,
            "old_status": old_status,
            "new_status": task.status,
            "transition_id": latest_transition.map(|transition| transition.id.clone()),
            "transition_reason": latest_transition.map(|transition| transition.reason.as_str()),
            "operation_id": latest_transition.and_then(|transition| transition.operation_id.clone()),
            "source_host_id": latest_transition.and_then(|transition| transition.source_host_id.clone()),
            "related_time_block_id": latest_transition.and_then(|transition| transition.related_time_block_id.clone()),
            "related_time_block_transition_ref": latest_transition
                .and_then(|transition| transition.related_time_block_transition_ref.clone()),
            "auto_generated": latest_transition.and_then(|transition| transition.auto_generated),
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
        TaskStoreError::MissingStatusHistory { .. }
        | TaskStoreError::InvalidStatusHistory { .. } => StatusCode::BAD_REQUEST,
        _ => StatusCode::CONFLICT,
    };
    (code, error.to_string())
}

fn normalize_incoming_task_snapshot(mut task: Task) -> Result<Task, (StatusCode, String)> {
    task.status_transitions
        .sort_by(|left, right| left.at.cmp(&right.at));
    validate_partial_task_status_history(&task).map_err(map_task_store_error)?;
    if let Some(first_transition) = task.status_transitions.first() {
        task.created_at = first_transition.at;
    }
    normalize_task_status_history(&mut task);
    Ok(task)
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
    let incoming = incoming
        .into_iter()
        .map(normalize_incoming_task_snapshot)
        .collect::<Result<Vec<_>, _>>()?;
    let existing = state.task_store.list_scoped(scope_key);
    let result = match strategy {
        TaskImportStrategy::Overwrite => {
            state
                .task_store
                .replace_all_scoped(scope_key, &incoming)
                .map_err(map_task_store_error)?;
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
                match merged.get(&task.id) {
                    Some(current) => {
                        let should_accept = should_accept_replicated_task(current, &task);
                        let history_changed =
                            merge_task_status_history(current, &task) != current.status_transitions;
                        skipped += 1;
                        if should_accept {
                            merged
                                .insert(task.id.clone(), merge_task_snapshot(current, &task, true));
                        } else if history_changed {
                            merged.insert(
                                task.id.clone(),
                                merge_task_snapshot(current, &task, false),
                            );
                        }
                    }
                    None => {
                        imported += 1;
                        merged.insert(task.id.clone(), task);
                    }
                }
            }

            let next = merged.into_values().collect::<Vec<_>>();
            state
                .task_store
                .replace_all_scoped(scope_key, &next)
                .map_err(map_task_store_error)?;

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
    let exomind_temp = std::env::temp_dir().join("exomind");
    std::fs::create_dir_all(&exomind_temp)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to create exomind temp dir: {error}")))?;
    let temp_dir = tempfile::Builder::new()
        .prefix("task-export-")
        .tempdir_in(&exomind_temp)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to create task export temp dir: {error}")))?;
    let sqlite_path = temp_dir.path().join("tasks-export.sqlite");
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
    if let Err(e) = temp_dir.close() {
        tracing::warn!(error = %e, "failed to clean exomind temp dir");
    }
    Ok(bytes)
}

fn read_tasks_from_sqlite_snapshot(
    bytes: &[u8],
    scope_key: Option<&str>,
) -> Result<Vec<Task>, (StatusCode, String)> {
    let exomind_temp = std::env::temp_dir().join("exomind");
    std::fs::create_dir_all(&exomind_temp)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to create exomind temp dir: {error}")))?;
    let temp_dir = tempfile::Builder::new()
        .prefix("task-import-")
        .tempdir_in(&exomind_temp)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, format!("failed to create task import temp dir: {error}")))?;
    let sqlite_path = temp_dir.path().join("tasks-import.sqlite");
    std::fs::write(&sqlite_path, bytes)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let store = crate::task::TaskStore::with_sqlite_path(&sqlite_path)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let tasks = store.list_scoped(scope_key);
    drop(store);
    if let Err(e) = temp_dir.close() {
        tracing::warn!(error = %e, "failed to clean exomind temp dir");
    }
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
        .route("/tasks/replication/summary", get(replication_summary_tasks))
        .route("/tasks/replication/pull", get(replication_pull_tasks))
        .route("/tasks/replication/upsert", post(replication_upsert_task))
        .route(
            "/mesh/tasks/grants/reconcile",
            post(reconcile_task_scope_grants),
        )
        .route("/mesh/tasks/summary", get(mesh_task_replication_summary))
        .route("/mesh/tasks/pull", get(mesh_task_replication_pull))
        .route("/mesh/tasks/snapshot/sqlite", get(mesh_export_tasks_sqlite))
        .route(
            "/mesh/peers/:peer_id/tasks/summary",
            get(proxy_peer_task_replication_summary),
        )
        .route(
            "/mesh/peers/:peer_id/tasks/pull",
            get(proxy_peer_task_replication_pull),
        )
        .route(
            "/mesh/peers/:peer_id/tasks/snapshot/sqlite",
            get(proxy_peer_tasks_sqlite_snapshot),
        )
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
    use axum::http::{HeaderMap, Request};
    use base64::engine::general_purpose::STANDARD;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
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
            device_id: "dev-tasks-test-host".to_string(),
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
            ret_mesh_peers: None,
            ret_mesh_connect_tx: None,
            ret_mesh_mode: std::sync::Arc::new(std::sync::atomic::AtomicU8::new(exomind_net_pairing::RetMeshMode::Active as u8)),
            ret_mesh_pairing_tx: None,
            ret_mesh_event_tx: None,
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

    fn create_task_input(title: &str) -> CreateTaskInput {
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

    fn update_title_input(title: &str) -> UpdateTaskInput {
        UpdateTaskInput {
            title: Some(title.to_string()),
            description: None,
            done_condition: None,
            priority: None,
            tags: None,
            depends_on: None,
            due_at: None,
            estimated_minutes: None,
            parent_id: None,
            time_block_ids: None,
        }
    }

    fn insert_legacy_empty_history_task(
        sqlite_path: &std::path::Path,
        scope_key: &str,
        task_id: &str,
        title: &str,
        status: &str,
        created_at: u64,
        updated_at: u64,
        completed_at: Option<u64>,
    ) {
        let connection = rusqlite::Connection::open(sqlite_path).unwrap();
        connection
            .execute(
                "UPDATE tasks
                 SET title = ?1,
                     status = ?2,
                     status_transitions_json = '[]',
                     created_at = ?3,
                     updated_at = ?4,
                     completed_at = ?5
                 WHERE scope_key = ?6 AND id = ?7",
                rusqlite::params![
                    title,
                    status,
                    created_at,
                    updated_at,
                    completed_at,
                    scope_key,
                    task_id
                ],
            )
            .unwrap();
    }

    fn make_task_eventlog_record(
        event_id: &str,
        timestamp: u64,
        tag: &str,
        metadata: serde_json::Value,
    ) -> crate::eventlog::EventRecord {
        crate::eventlog::EventRecord {
            id: event_id.to_string(),
            timestamp: timestamp as i64,
            content: format!("test event {event_id}"),
            tags: vec![tag.to_string()],
            refs: vec![],
            metadata: Some(metadata),
        }
    }

    fn make_test_peer(peer_id: &str, base_url: &str) -> crate::mesh::PeerInfo {
        crate::mesh::PeerInfo {
            id: peer_id.to_string(),
            base_url: base_url.to_string(),
            enabled: true,
            capabilities: vec![],
            status: crate::mesh::PeerStatus::Unknown,
            last_seen: None,
            last_error: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            auth_token: None,
            inbound_secret: None,
        }
    }

    fn make_scope_grant(peer_id: &str, scope_key: &str) -> crate::mesh::PeerScopeGrant {
        crate::mesh::PeerScopeGrant {
            peer_id: peer_id.to_string(),
            domain: TASK_SCOPE_GRANT_DOMAIN.to_string(),
            scope_key: scope_key.to_string(),
            granted_at: chrono::Utc::now().to_rfc3339(),
            granted_by: "test".to_string(),
        }
    }

    #[derive(Clone)]
    struct FakePeerSummaryState {
        summary: TaskReplicationSummary,
        captured_auth: Arc<Mutex<Option<String>>>,
    }

    async fn fake_peer_summary_handler(
        axum::extract::State(state): axum::extract::State<FakePeerSummaryState>,
        headers: HeaderMap,
    ) -> Json<TaskReplicationSummary> {
        let auth = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        *state.captured_auth.lock().unwrap() = auth;
        Json(state.summary)
    }

    async fn spawn_fake_peer_summary_server(
        summary: TaskReplicationSummary,
        captured_auth: Arc<Mutex<Option<String>>>,
    ) -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route("/mesh/tasks/summary", get(fake_peer_summary_handler))
            .with_state(FakePeerSummaryState {
                summary,
                captured_auth,
            });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        (format!("http://{addr}"), shutdown_tx)
    }

    async fn fake_peer_error_handler() -> (StatusCode, Json<serde_json::Value>) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "missing task status history: task-bad-1",
            })),
        )
    }

    async fn spawn_fake_peer_error_server(route: &'static str) -> (String, oneshot::Sender<()>) {
        let app = Router::new().route(route, get(fake_peer_error_handler));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        (format!("http://{addr}"), shutdown_tx)
    }

    #[test]
    fn task_replication_summary_hash_is_order_stable_and_content_sensitive() {
        let store = crate::task::TaskStore::new();
        let original = store.create(create_task_input("Hash me"));
        let summary = build_task_replication_summary(None, &store.list());

        let mut reversed = store.list();
        reversed.reverse();
        let reordered_summary = build_task_replication_summary(None, &reversed);
        assert_eq!(
            summary.revision_hash, reordered_summary.revision_hash,
            "summary hash should not depend on task list ordering"
        );

        store
            .update_scoped(None, &original.id, update_title_input("Hash me updated"))
            .unwrap();
        let changed_summary = build_task_replication_summary(None, &store.list());
        assert_ne!(
            summary.revision_hash, changed_summary.revision_hash,
            "summary hash should change when task content changes"
        );

        let mut created_at_changed = store.list();
        created_at_changed[0].created_at = created_at_changed[0].created_at.saturating_add(1);
        let created_at_changed_summary = build_task_replication_summary(None, &created_at_changed);
        assert_ne!(
            changed_summary.revision_hash, created_at_changed_summary.revision_hash,
            "summary hash should change when created_at changes"
        );
    }

    #[tokio::test]
    async fn mesh_task_replication_routes_use_granted_scope_only() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-mesh-peer-scope.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let state = test_state_with_task_store(task_store.clone());

        state
            .mesh
            .upsert_peer(make_test_peer("peer-phone", "http://peer-phone.local:1949"));
        state
            .mesh
            .upsert_scope_grant(make_scope_grant("peer-phone", "profile-a"));

        task_store.create_scoped(Some("profile-a"), create_task_input("Granted scope task"));
        task_store.create_scoped(Some("profile-b"), create_task_input("Other scope task"));

        let app = test_router(state);
        let mut request = Request::builder()
            .uri("/mesh/tasks/pull?profile_id=profile-b&limit=10")
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(AuthenticatedPeerIdentity {
            peer_id: "peer-phone".to_string(),
        });

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: TaskReplicationPullResponse = serde_json::from_slice(&body).unwrap();

        assert_eq!(payload.scope_key, "profile-a");
        assert_eq!(payload.items.len(), 1);
        assert_eq!(payload.items[0].title, "Granted scope task");
        assert_eq!(payload.summary.task_count, 1);
    }

    #[tokio::test]
    async fn reconcile_task_scope_grants_grants_only_enabled_peers() {
        let state = test_state();
        let mut enabled_peer = make_test_peer("peer-enabled", "http://peer-enabled.local:1949");
        enabled_peer.auth_token = Some("enabled-token".to_string());
        let mut disabled_peer = make_test_peer("peer-disabled", "http://peer-disabled.local:1949");
        disabled_peer.enabled = false;

        state.mesh.upsert_peer(enabled_peer);
        state.mesh.upsert_peer(disabled_peer);

        let app = test_router(state.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mesh/tasks/grants/reconcile?profile_id=profile-reconcile")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(payload["scope_key"], "profile-reconcile");
        assert_eq!(payload["granted_peers"], 1);
        assert_eq!(
            state
                .mesh
                .resolve_scope_key_for_peer_domain("peer-enabled", TASK_SCOPE_GRANT_DOMAIN)
                .unwrap(),
            Some("profile-reconcile".to_string())
        );
        assert_eq!(
            state
                .mesh
                .resolve_scope_key_for_peer_domain("peer-disabled", TASK_SCOPE_GRANT_DOMAIN)
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn proxy_peer_task_summary_uses_mesh_outbound_auth_token() {
        let captured_auth = Arc::new(Mutex::new(None));
        let summary = TaskReplicationSummary {
            schema_version: 1,
            scope_key: "profile-proxy".to_string(),
            task_count: 2,
            max_updated_at: 42,
            revision_hash: "hash-proxy".to_string(),
            generated_at: 99,
        };
        let (base_url, shutdown_tx) =
            spawn_fake_peer_summary_server(summary.clone(), Arc::clone(&captured_auth)).await;

        let state = test_state();
        let mut peer = make_test_peer("peer-proxy", &base_url);
        peer.auth_token = Some("peer-outbound-secret".to_string());
        state.mesh.upsert_peer(peer);

        let app = test_router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/mesh/peers/peer-proxy/tasks/summary")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let _ = shutdown_tx.send(());

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: TaskReplicationSummary = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload, summary);
        assert_eq!(
            captured_auth.lock().unwrap().clone(),
            Some("Bearer peer-outbound-secret".to_string())
        );
    }

    #[tokio::test]
    async fn proxy_peer_task_snapshot_forwards_upstream_error_detail() {
        let (base_url, shutdown_tx) =
            spawn_fake_peer_error_server("/mesh/tasks/snapshot/sqlite").await;

        let state = test_state();
        let mut peer = make_test_peer("peer-proxy-error", &base_url);
        peer.auth_token = Some("peer-outbound-secret".to_string());
        state.mesh.upsert_peer(peer);

        let app = test_router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/mesh/peers/peer-proxy-error/tasks/snapshot/sqlite")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let _ = shutdown_tx.send(());

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains("missing task status history: task-bad-1"));
        assert!(text.contains("peer-proxy-error"));
        assert!(text.contains("/mesh/tasks/snapshot/sqlite"));
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
        assert_eq!(
            transitioned["status_transitions"].as_array().unwrap().len(),
            2
        );
        assert_eq!(
            transitioned["status_transitions"][1]["reason"],
            "task.transition"
        );
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
        assert_eq!(
            events[0].metadata.as_ref().unwrap()["transition_reason"],
            "task.transition"
        );
        assert!(
            events[0].metadata.as_ref().unwrap()["operation_id"]
                .as_str()
                .is_some()
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
    async fn list_tasks_repairs_legacy_empty_history_from_runtime_eventlog_once() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-task-repair.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            dir.path().join("eventlog-repair-runtime"),
        ));
        let created = task_store.create_in_scope(Some("user-a"), create_task_input("Legacy task"));
        let transition_at = created.created_at.saturating_add(2_000);
        insert_legacy_empty_history_task(
            &sqlite_path,
            "user-a",
            &created.id,
            "Legacy task",
            "in_progress",
            created.created_at,
            transition_at,
            None,
        );
        eventlog_store
            .append_event(
                Some("user-a"),
                make_task_eventlog_record(
                    "evt-runtime-start",
                    transition_at,
                    "task_started",
                    serde_json::json!({
                        "task_id": created.id,
                        "task_title": "Legacy task",
                        "old_status": "pending",
                        "new_status": "in_progress",
                        "transition_reason": "task.transition"
                    }),
                ),
            )
            .unwrap();
        let app = test_router(test_state_with_task_store_and_eventlog(
            task_store.clone(),
            eventlog_store,
        ));

        let first_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/tasks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(first_response.status(), StatusCode::OK);
        let first_body = first_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let first_tasks: Vec<Task> = serde_json::from_slice(&first_body).unwrap();
        assert_eq!(first_tasks.len(), 1);
        assert_eq!(first_tasks[0].status, TaskStatus::InProgress);
        assert_eq!(first_tasks[0].status_transitions.len(), 2);
        assert_eq!(
            first_tasks[0].status_transitions[0].reason,
            TaskTransitionReason::TaskCreate
        );
        assert_eq!(
            first_tasks[0].status_transitions[1].reason,
            TaskTransitionReason::TaskTransition
        );

        let stored_after_first = task_store
            .get_scoped(Some("user-a"), &created.id)
            .expect("legacy task should remain readable");
        assert_eq!(stored_after_first.status_transitions.len(), 2);
        assert_eq!(
            stored_after_first.updated_at,
            transition_at.saturating_add(1)
        );
        assert_eq!(
            task_store
                .get_meta_scoped(Some("user-a"), LEGACY_STATUS_HISTORY_REPAIR_META_KEY)
                .unwrap()
                .as_deref(),
            Some(LEGACY_STATUS_HISTORY_REPAIR_VERSION)
        );

        let second_response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/tasks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(second_response.status(), StatusCode::OK);
        let stored_after_second = task_store
            .get_scoped(Some("user-a"), &created.id)
            .expect("legacy task should still exist");
        assert_eq!(stored_after_second.status_transitions.len(), 2);
    }

    #[tokio::test]
    async fn list_tasks_repairs_legacy_pending_task_without_eventlog_transition() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-task-repair-pending.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            dir.path().join("eventlog-repair-pending"),
        ));
        let created =
            task_store.create_in_scope(Some("user-a"), create_task_input("Legacy pending"));
        insert_legacy_empty_history_task(
            &sqlite_path,
            "user-a",
            &created.id,
            "Legacy pending",
            "pending",
            created.created_at,
            created.updated_at,
            None,
        );
        let app = test_router(test_state_with_task_store_and_eventlog(
            task_store.clone(),
            eventlog_store.clone(),
        ));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/tasks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Task> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].status, TaskStatus::Pending);
        assert_eq!(tasks[0].status_transitions.len(), 1);
        assert_eq!(
            tasks[0].status_transitions[0].reason,
            TaskTransitionReason::TaskCreate
        );
        assert_eq!(
            task_store
                .get_meta_scoped(Some("user-a"), LEGACY_STATUS_HISTORY_REPAIR_META_KEY)
                .unwrap()
                .as_deref(),
            Some(LEGACY_STATUS_HISTORY_REPAIR_VERSION)
        );
    }

    #[tokio::test]
    async fn get_task_repairs_legacy_empty_history_from_camel_case_eventlog() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-task-repair-camel.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            dir.path().join("eventlog-repair-camel"),
        ));
        let created = task_store.create_in_scope(Some("user-a"), create_task_input("Legacy camel"));
        let transition_at = created.created_at.saturating_add(1_500);
        insert_legacy_empty_history_task(
            &sqlite_path,
            "user-a",
            &created.id,
            "Legacy camel",
            "in_progress",
            created.created_at,
            transition_at,
            None,
        );
        eventlog_store
            .append_event(
                Some("user-a"),
                make_task_eventlog_record(
                    "evt-camel-start",
                    transition_at,
                    "task_started",
                    serde_json::json!({
                        "taskId": created.id,
                        "taskTitle": "Legacy camel",
                        "fromStatus": "pending",
                        "toStatus": "in_progress"
                    }),
                ),
            )
            .unwrap();
        let app = test_router(test_state_with_task_store_and_eventlog(
            task_store.clone(),
            eventlog_store.clone(),
        ));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/tasks/{}?user_id=user-a", created.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let task: Task = serde_json::from_slice(&body).unwrap();
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.status_transitions.len(), 2);
        assert_eq!(
            task.status_transitions[1].reason,
            TaskTransitionReason::TaskTransition
        );
    }

    #[tokio::test]
    async fn get_task_repairs_when_first_transition_matches_created_at() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-task-repair-same-ms.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            dir.path().join("eventlog-repair-same-ms"),
        ));
        let created =
            task_store.create_in_scope(Some("user-a"), create_task_input("Legacy same ms"));
        let transition_at = created.created_at;
        insert_legacy_empty_history_task(
            &sqlite_path,
            "user-a",
            &created.id,
            "Legacy same ms",
            "in_progress",
            created.created_at,
            transition_at,
            None,
        );
        eventlog_store
            .append_event(
                Some("user-a"),
                make_task_eventlog_record(
                    "evt-same-ms-create",
                    transition_at,
                    "task_created",
                    serde_json::json!({
                        "taskId": created.id,
                        "taskTitle": "Legacy same ms"
                    }),
                ),
            )
            .unwrap();
        eventlog_store
            .append_event(
                Some("user-a"),
                make_task_eventlog_record(
                    "evt-same-ms-start",
                    transition_at,
                    "task_started",
                    serde_json::json!({
                        "taskId": created.id,
                        "taskTitle": "Legacy same ms",
                        "fromStatus": "pending",
                        "toStatus": "in_progress"
                    }),
                ),
            )
            .unwrap();
        let app = test_router(test_state_with_task_store_and_eventlog(
            task_store,
            eventlog_store,
        ));

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/tasks/{}?user_id=user-a", created.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let task: Task = serde_json::from_slice(&body).unwrap();
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.status_transitions.len(), 2);
        assert_eq!(
            task.status_transitions[0].reason,
            TaskTransitionReason::TaskCreate
        );
        assert_eq!(
            task.status_transitions[1].reason,
            TaskTransitionReason::TaskTransition
        );
        assert!(task.status_transitions[0].at < task.status_transitions[1].at);
        assert_eq!(task.status_transitions[1].at, transition_at);
    }

    #[tokio::test]
    async fn list_tasks_leaves_scope_unmarked_until_repairable_history_exists() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("legacy-task-repair-note.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            dir.path().join("eventlog-repair-note"),
        ));
        let created = task_store.create_in_scope(Some("user-a"), create_task_input("Legacy note"));
        let transition_at = created.created_at.saturating_add(1_000);
        insert_legacy_empty_history_task(
            &sqlite_path,
            "user-a",
            &created.id,
            "Legacy note",
            "in_progress",
            created.created_at,
            transition_at,
            None,
        );
        eventlog_store
            .append_event(
                Some("user-a"),
                make_task_eventlog_record(
                    "evt-note-start",
                    transition_at,
                    "task_started",
                    serde_json::json!({
                        "taskId": created.id,
                        "taskTitle": "Legacy note",
                        "fromStatus": "pending",
                        "toStatus": "in_progress",
                        "recordType": "task_status_change_description",
                        "description": "这只是说明文本"
                    }),
                ),
            )
            .unwrap();
        let app = test_router(test_state_with_task_store_and_eventlog(
            task_store.clone(),
            eventlog_store.clone(),
        ));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/tasks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let tasks: Vec<Task> = serde_json::from_slice(&body).unwrap();
        assert_eq!(tasks.len(), 1);
        assert!(tasks[0].status_transitions.is_empty());
        assert_eq!(
            task_store
                .get_meta_scoped(Some("user-a"), LEGACY_STATUS_HISTORY_REPAIR_META_KEY)
                .unwrap()
                .as_deref(),
            None
        );

        eventlog_store
            .append_event(
                Some("user-a"),
                make_task_eventlog_record(
                    "evt-note-start-real",
                    transition_at.saturating_add(50),
                    "task_started",
                    serde_json::json!({
                        "taskId": created.id,
                        "taskTitle": "Legacy note",
                        "fromStatus": "pending",
                        "toStatus": "in_progress"
                    }),
                ),
            )
            .unwrap();

        let second_response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/tasks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(second_response.status(), StatusCode::OK);
        let second_body = second_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let repaired_tasks: Vec<Task> = serde_json::from_slice(&second_body).unwrap();
        assert_eq!(repaired_tasks.len(), 1);
        assert_eq!(repaired_tasks[0].status, TaskStatus::InProgress);
        assert_eq!(repaired_tasks[0].status_transitions.len(), 2);
        assert_eq!(
            task_store
                .get_meta_scoped(Some("user-a"), LEGACY_STATUS_HISTORY_REPAIR_META_KEY)
                .unwrap()
                .as_deref(),
            Some(LEGACY_STATUS_HISTORY_REPAIR_VERSION)
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
        let newer_updated_at = existing.updated_at + 1_000;
        let app = test_router(state.clone());
        let payload = serde_json::json!({
            "version": 1,
            "tasks": [
                {
                    "id": existing.id,
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
                    "status_transitions": [
                        crate::task::store::build_initial_task_status_transition(&existing.id, 1000)
                    ],
                    "created_at": 1000,
                    "updated_at": newer_updated_at,
                    "completed_at": null
                },
                {
                    "id": "task-import-2",
                    "title": "Imported task",
                    "description": null,
                    "done_condition": "ship",
                    "status": "pending",
                    "priority": "high",
                    "tags": ["rt"],
                    "source": "backup",
                    "parent_id": null,
                    "depends_on": [],
                    "due_at": null,
                    "estimated_minutes": 30,
                    "time_block_ids": ["block-9"],
                    "status_transitions": [
                        crate::task::store::build_initial_task_status_transition("task-import-2", 3000)
                    ],
                    "created_at": 3000,
                    "updated_at": 4000,
                    "completed_at": null
                }
            ]
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/import/json?strategy=merge")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
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
        assert!(tasks.iter().any(|task| task.title == "Existing"));
    }

    #[tokio::test]
    async fn merge_import_ignores_older_task_snapshot() {
        let state = test_state();
        let existing = state.task_store.create(CreateTaskInput {
            title: "Existing".to_string(),
            description: Some("newer local".to_string()),
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
        let existing_updated_at = existing.updated_at;
        let older_updated_at = existing_updated_at.saturating_sub(1_000);
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
                                    "title": "Existing older snapshot",
                                    "description": "older remote",
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
                                    "status_transitions": [{{
                                        "id": "{}:task.create:1000",
                                        "at": 1000,
                                        "to_status": "pending",
                                        "reason": "task.create"
                                    }}],
                                    "created_at": 1000,
                                    "updated_at": {},
                                    "completed_at": null
                                }}
                            ]
                        }}"#,
                        existing.id, existing.id, older_updated_at
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["imported"], 0);
        assert_eq!(result["skipped"], 1);
        assert_eq!(result["total"], 1);

        let merged = state
            .task_store
            .get(&existing.id)
            .expect("existing task should remain after import");
        assert_eq!(merged.title, "Existing");
        assert_eq!(merged.description.as_deref(), Some("newer local"));
        assert_eq!(merged.updated_at, existing_updated_at);
    }

    #[tokio::test]
    async fn merge_import_rejects_newer_snapshot_without_status_history() {
        let state = test_state();
        let existing = state.task_store.create(CreateTaskInput {
            title: "History authoritative".to_string(),
            description: Some("keep rich history".to_string()),
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
            .transition(&existing.id, TaskStatus::InProgress)
            .unwrap();
        let existing = state
            .task_store
            .get(&existing.id)
            .expect("existing task should still exist");
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
                                    "title": "History lost remote snapshot",
                                    "description": "should be ignored",
                                    "done_condition": null,
                                    "status": "completed",
                                    "priority": "medium",
                                    "tags": [],
                                    "source": null,
                                    "parent_id": null,
                                    "depends_on": [],
                                    "due_at": null,
                                    "estimated_minutes": null,
                                    "time_block_ids": [],
                                    "created_at": 1000,
                                    "updated_at": {},
                                    "completed_at": {}
                                }}
                            ]
                        }}"#,
                        existing.id,
                        existing.updated_at + 5_000,
                        existing.updated_at + 5_000,
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let merged = state
            .task_store
            .get(&existing.id)
            .expect("existing task should remain after merge");
        assert_eq!(merged.title, "History authoritative");
        assert_eq!(merged.status, TaskStatus::InProgress);
        assert_eq!(merged.status_transitions.len(), 2);
    }

    #[tokio::test]
    async fn merge_import_preserves_richer_local_history_when_newer_remote_history_is_sparse() {
        let state = test_state();
        let existing = state.task_store.create(CreateTaskInput {
            title: "Rich local history".to_string(),
            description: Some("local".to_string()),
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
            .transition(&existing.id, TaskStatus::InProgress)
            .unwrap();
        let existing = state
            .task_store
            .get(&existing.id)
            .expect("existing task should still exist");
        let completion_transition = crate::task::TaskStatusTransition {
            id: format!("{}:remote-completed", existing.id),
            at: existing.updated_at + 5_000,
            from_status: Some(TaskStatus::InProgress),
            to_status: TaskStatus::Completed,
            reason: TaskTransitionReason::TaskTransition,
            actor_id: Some("remote".to_string()),
            source_host_id: Some("mobile-host".to_string()),
            operation_id: Some("remote-completed".to_string()),
            related_time_block_id: None,
            related_time_block_transition_ref: None,
            auto_generated: Some(false),
        };
        let payload = serde_json::json!({
            "version": 1,
            "tasks": [{
                "id": existing.id,
                "title": "Sparse remote completion",
                "description": "remote wins fields",
                "done_condition": null,
                "status": "completed",
                "priority": "medium",
                "tags": [],
                "source": null,
                "parent_id": null,
                "depends_on": [],
                "due_at": null,
                "estimated_minutes": null,
                "time_block_ids": [],
                "status_transitions": [
                    existing.status_transitions[0].clone(),
                    completion_transition.clone()
                ],
                "created_at": existing.created_at,
                "updated_at": completion_transition.at,
                "completed_at": completion_transition.at
            }]
        });
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/import/json?strategy=merge")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["imported"], 0);
        assert_eq!(result["skipped"], 1);

        let merged = state
            .task_store
            .get(&existing.id)
            .expect("existing task should remain after merge");
        assert_eq!(merged.title, "Sparse remote completion");
        assert_eq!(merged.description.as_deref(), Some("remote wins fields"));
        assert_eq!(merged.status, TaskStatus::Completed);
        assert_eq!(merged.completed_at, Some(completion_transition.at));
        assert_eq!(merged.status_transitions.len(), 3);
        assert!(
            merged
                .status_transitions
                .iter()
                .any(|transition| transition.to_status == TaskStatus::InProgress),
            "merged history should retain local intermediate transition"
        );
        assert!(
            merged
                .status_transitions
                .iter()
                .any(|transition| transition.id == completion_transition.id),
            "merged history should include remote completion transition"
        );
    }

    #[tokio::test]
    async fn merge_import_rejects_new_task_without_status_history() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-import-empty-history.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_task_store(task_store.clone()));
        let payload = serde_json::json!({
            "version": 1,
            "tasks": [{
                "id": "import-empty-history",
                "title": "Imported legacy snapshot",
                "description": null,
                "done_condition": null,
                "status": "completed",
                "priority": "medium",
                "tags": [],
                "source": null,
                "parent_id": null,
                "depends_on": [],
                "due_at": null,
                "estimated_minutes": null,
                "time_block_ids": [],
                "status_transitions": [],
                "created_at": 1_000,
                "updated_at": 5_000,
                "completed_at": 5_000
            }]
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/import/json?strategy=merge")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(
            task_store.get("import-empty-history").is_none(),
            "invalid legacy snapshot should not be imported"
        );
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
        let state = test_state_with_task_store(task_store.clone());
        let app = test_router(state.clone());

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
                            "status_transitions": [{
                                "id": "task-rep-1:task.create:1000",
                                "at": 1000,
                                "to_status": "pending",
                                "reason": "task.create"
                            }],
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

        let replication = state
            .signal_pool
            .window()
            .recent(10)
            .into_iter()
            .find(|event| {
                event.topic == "task.replication.upserted"
                    && event.source == "http:tasks/replication"
            })
            .expect("replication upsert should publish a local task.replication.upserted wake");
        assert_eq!(replication.payload["scopeKey"], serde_json::json!("user-a"));
        assert_eq!(
            replication.payload["task"]["id"],
            serde_json::json!("task-rep-1")
        );

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
                            "status_transitions": [{
                                "id": "task-rep-1:task.create:1000",
                                "at": 1000,
                                "to_status": "pending",
                                "reason": "task.create"
                            }],
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

    #[tokio::test]
    async fn replication_upsert_rejects_newer_snapshot_without_status_history() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-replication-history.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let existing = task_store.create_in_scope(
            Some("user-a"),
            CreateTaskInput {
                title: "Rich history task".to_string(),
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
            },
        );
        task_store
            .transition_scoped(Some("user-a"), &existing.id, TaskStatus::InProgress)
            .unwrap();
        let existing = task_store
            .get_scoped(Some("user-a"), &existing.id)
            .expect("existing task should exist");
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/replication/upsert?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{
                        "task": {{
                            "id": "{}",
                            "title": "History lost remote snapshot",
                            "description": null,
                            "done_condition": null,
                            "status": "completed",
                            "priority": "medium",
                            "tags": [],
                            "source": null,
                            "parent_id": null,
                            "depends_on": [],
                            "due_at": null,
                            "estimated_minutes": null,
                            "time_block_ids": [],
                            "created_at": 1000,
                            "updated_at": {},
                            "completed_at": {}
                        }},
                        "source_host_id": "mobile-host"
                    }}"#,
                        existing.id,
                        existing.updated_at + 5_000,
                        existing.updated_at + 5_000,
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let stored = task_store
            .get_scoped(Some("user-a"), &existing.id)
            .expect("task should remain in scoped store");
        assert_eq!(stored.title, "Rich history task");
        assert_eq!(stored.status, TaskStatus::InProgress);
        assert_eq!(stored.status_transitions.len(), 2);
    }

    #[tokio::test]
    async fn replication_upsert_rejects_new_task_without_status_history() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-replication-empty-history.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let payload = serde_json::json!({
            "task": {
                "id": "task-empty-history",
                "title": "Missing history task",
                "description": "should be rejected",
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
                "status_transitions": [],
                "created_at": 1_000,
                "updated_at": 5_000,
                "completed_at": null
            },
            "source_host_id": "mobile-host"
        });
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/replication/upsert?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(
            task_store
                .get_scoped(Some("user-a"), "task-empty-history")
                .is_none(),
            "invalid replication payload should not insert a task"
        );
    }

    #[tokio::test]
    async fn replication_upsert_bumps_updated_at_when_equal_watermark_changes_revision() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-replication-watermark-bump.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let local_task = Task {
            id: "task-watermark-bump".to_string(),
            title: "Local active snapshot".to_string(),
            description: Some("local".to_string()),
            done_condition: None,
            status: TaskStatus::InProgress,
            priority: TaskPriority::Medium,
            tags: vec![],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
            status_transitions: vec![
                crate::task::store::build_initial_task_status_transition(
                    "task-watermark-bump",
                    1_000,
                ),
                crate::task::TaskStatusTransition {
                    id: "task-watermark-bump:local-in-progress".to_string(),
                    at: 4_000,
                    from_status: Some(TaskStatus::Pending),
                    to_status: TaskStatus::InProgress,
                    reason: TaskTransitionReason::TaskTransition,
                    actor_id: Some("local".to_string()),
                    source_host_id: Some("desktop-host".to_string()),
                    operation_id: Some("local-in-progress".to_string()),
                    related_time_block_id: None,
                    related_time_block_transition_ref: None,
                    auto_generated: Some(false),
                },
            ],
            created_at: 1_000,
            updated_at: 5_000,
            completed_at: None,
        };
        task_store
            .upsert_scoped(Some("user-a"), local_task)
            .expect("local task should be stored");
        let payload = serde_json::json!({
            "task": {
                "id": "task-watermark-bump",
                "title": "Remote completed snapshot",
                "description": "remote",
                "done_condition": null,
                "status": "completed",
                "priority": "medium",
                "tags": [],
                "source": null,
                "parent_id": null,
                "depends_on": [],
                "due_at": null,
                "estimated_minutes": null,
                "time_block_ids": [],
                "status_transitions": [
                    crate::task::store::build_initial_task_status_transition("task-watermark-bump", 1_000),
                    {
                        "id": "task-watermark-bump:remote-completed",
                        "at": 5_000,
                        "from_status": "in_progress",
                        "to_status": "completed",
                        "reason": "task.transition",
                        "actor_id": "remote",
                        "source_host_id": "mobile-host",
                        "operation_id": "remote-completed",
                        "related_time_block_id": null,
                        "related_time_block_transition_ref": null,
                        "auto_generated": false
                    }
                ],
                "created_at": 1_000,
                "updated_at": 5_000,
                "completed_at": 5_000
            },
            "source_host_id": "mobile-host"
        });
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/replication/upsert?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "updated");

        let stored = task_store
            .get_scoped(Some("user-a"), "task-watermark-bump")
            .expect("task should remain in scoped store");
        assert_eq!(stored.status, TaskStatus::Completed);
        assert_eq!(stored.completed_at, Some(5_000));
        assert_eq!(stored.updated_at, 5_001);
    }

    #[tokio::test]
    async fn replication_upsert_merges_sparse_newer_remote_history() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("tasks-replication-history-merge.sqlite");
        let task_store = Arc::new(crate::task::TaskStore::with_sqlite_path(&sqlite_path).unwrap());
        let existing = task_store.create_in_scope(
            Some("user-a"),
            CreateTaskInput {
                title: "Rich history task".to_string(),
                description: Some("local".to_string()),
                done_condition: None,
                priority: None,
                tags: vec![],
                source: None,
                parent_id: None,
                depends_on: vec![],
                due_at: None,
                estimated_minutes: None,
                time_block_ids: vec![],
            },
        );
        task_store
            .transition_scoped(Some("user-a"), &existing.id, TaskStatus::InProgress)
            .unwrap();
        let existing = task_store
            .get_scoped(Some("user-a"), &existing.id)
            .expect("existing task should exist");
        let completion_transition = crate::task::TaskStatusTransition {
            id: format!("{}:remote-completed", existing.id),
            at: existing.updated_at + 5_000,
            from_status: Some(TaskStatus::InProgress),
            to_status: TaskStatus::Completed,
            reason: TaskTransitionReason::TaskTransition,
            actor_id: Some("remote".to_string()),
            source_host_id: Some("mobile-host".to_string()),
            operation_id: Some("remote-completed".to_string()),
            related_time_block_id: None,
            related_time_block_transition_ref: None,
            auto_generated: Some(false),
        };
        let payload = serde_json::json!({
            "task": {
                "id": existing.id,
                "title": "Sparse remote completion",
                "description": "remote wins fields",
                "done_condition": null,
                "status": "completed",
                "priority": "medium",
                "tags": [],
                "source": null,
                "parent_id": null,
                "depends_on": [],
                "due_at": null,
                "estimated_minutes": null,
                "time_block_ids": [],
                "status_transitions": [
                    existing.status_transitions[0].clone(),
                    completion_transition.clone()
                ],
                "created_at": existing.created_at,
                "updated_at": completion_transition.at,
                "completed_at": completion_transition.at
            },
            "source_host_id": "mobile-host"
        });
        let app = test_router(test_state_with_task_store(task_store.clone()));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tasks/replication/upsert?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "updated");

        let stored = task_store
            .get_scoped(Some("user-a"), &existing.id)
            .expect("task should remain in scoped store");
        assert_eq!(stored.title, "Sparse remote completion");
        assert_eq!(stored.description.as_deref(), Some("remote wins fields"));
        assert_eq!(stored.status, TaskStatus::Completed);
        assert_eq!(stored.completed_at, Some(completion_transition.at));
        assert_eq!(stored.status_transitions.len(), 3);
        assert!(
            stored
                .status_transitions
                .iter()
                .any(|transition| transition.to_status == TaskStatus::InProgress),
            "stored history should retain local intermediate transition"
        );
        assert!(
            stored
                .status_transitions
                .iter()
                .any(|transition| transition.id == completion_transition.id),
            "stored history should include remote completion transition"
        );
    }
}
