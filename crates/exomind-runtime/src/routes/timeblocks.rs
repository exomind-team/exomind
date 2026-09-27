use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::TimeZone;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

use crate::timeblock::BlockPhase;

use super::tasks::transition_task_in_scope_with_context;
use crate::AppState;
use crate::auth::AuthenticatedPeerIdentity;
use crate::config::types::USER_CONFIG_SCOPE;
use crate::eventlog::PERF_LOGGING_ENABLED_CONFIG_KEY;
use crate::signal::types::SignalEvent;
use crate::task::{TaskStatus, TaskTransitionContext, TaskTransitionReason};
use crate::timeblock::{
    ActiveBlockData, BlockTaskAssociationEvent, BlockTransition, BlockTransitionType,
    TimeBlockData, TimeBlockStore,
};

const TIMEBLOCK_SCOPE_GRANT_DOMAIN: &str = "timeblocks";

fn is_perf_logging_enabled(state: &AppState) -> bool {
    match state
        .config_store
        .get(USER_CONFIG_SCOPE, PERF_LOGGING_ENABLED_CONFIG_KEY)
    {
        Ok(Some(entry)) => entry.value.trim() == "true",
        Ok(None) => false,
        Err(_) => false,
    }
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
    /// #759: filter by blockType ("active" or "gap"). Omit to return all.
    #[serde(default)]
    block_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TimeBlockBackupJsonPayload {
    version: u32,
    time_blocks: Vec<TimeBlockData>,
    active_block: Option<ActiveBlockData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TimeBlockBackupSqlitePayload {
    version: u32,
    file_name: String,
    content_base64: String,
    timeblock_count: usize,
    active_block_present: bool,
}

#[derive(Debug, Deserialize)]
struct TimeBlockBackupSqliteImportPayload {
    content_base64: String,
}

#[derive(Debug, Serialize)]
struct TimeBlockImportResult {
    imported: usize,
    skipped: usize,
    total: usize,
    active_block_updated: bool,
}

#[derive(Debug, Serialize)]
struct TimeBlockBackendStatusResponse {
    backend: &'static str,
    supports_json_backup: bool,
    supports_sqlite_snapshot: bool,
}

#[derive(Debug, Serialize)]
struct TimeBlockScopeGrantReconcileResponse {
    scope_key: String,
    granted_peers: usize,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

enum TimeBlockImportStrategy {
    Merge,
    Overwrite,
}

fn internal_error(message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: message }),
    )
}

fn conflict(message: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::CONFLICT,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

fn not_found(message: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

fn current_timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock error")
        .as_millis() as u64
}

fn block_transition_type_key(transition_type: BlockTransitionType) -> &'static str {
    match transition_type {
        BlockTransitionType::Start => "start",
        BlockTransitionType::Pause => "pause",
        BlockTransitionType::Resume => "resume",
        BlockTransitionType::FeedbackStart => "feedback_start",
        BlockTransitionType::FeedbackSubmit => "feedback_submit",
        BlockTransitionType::End => "end",
    }
}

fn build_timeblock_transition_ref(
    block_start_id: &str,
    transition_type: BlockTransitionType,
    at: u64,
    actor_id: Option<&str>,
) -> String {
    let actor = actor_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("system");
    format!(
        "{}:{}:{}:{}",
        block_start_id,
        block_transition_type_key(transition_type),
        at,
        actor
    )
}

fn map_task_route_error_to_timeblock(
    error: (StatusCode, String),
) -> (StatusCode, Json<ErrorResponse>) {
    let (status, message) = error;
    (status, Json(ErrorResponse { error: message }))
}

fn parse_task_status_outcome(
    outcome: &str,
) -> Result<Option<TaskStatus>, (StatusCode, Json<ErrorResponse>)> {
    match outcome {
        "continue" => Ok(None),
        "suspended" => Ok(Some(TaskStatus::Suspended)),
        "completed" => Ok(Some(TaskStatus::Completed)),
        "cancelled" => Ok(Some(TaskStatus::Cancelled)),
        value => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unsupported task outcome: {value}"),
            }),
        )),
    }
}

fn build_completed_timeblock_replication_payload(
    state: &AppState,
    scope_key: Option<&str>,
    block: &TimeBlockData,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "timeblock_completed",
            "blockId": block.start_id,
            "completedAt": block.end_time,
            "originHostId": state.host_id,
        },
        "block": block,
    })
}

fn publish_timeblock_replication_signal(state: &AppState, signal: SignalEvent) {
    state.signal_pool.publish(signal.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        let relay = std::sync::Arc::clone(mesh_relay);
        tokio::spawn(async move {
            relay.forward_event_to_peers(signal).await;
        });
    }
}

fn build_completed_timeblock_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    block: &TimeBlockData,
) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "timeblock.replication.completed".to_string(),
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock error")
            .as_millis() as u64,
        source: "http:timeblocks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("timeblock:{}", block.start_id)),
        payload: build_completed_timeblock_replication_payload(state, scope_key, block),
    }
}

fn notify_local_completed_timeblock_replication_applied(
    state: &AppState,
    scope_key: Option<&str>,
    block: &TimeBlockData,
) {
    state.signal_pool.publish(SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "timeblock.replication.completed".to_string(),
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock error")
            .as_millis() as u64,
        source: "http:timeblocks/replication".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("timeblock:{}", block.start_id)),
        payload: build_completed_timeblock_replication_payload(state, scope_key, block),
    });
}

fn build_active_timeblock_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    active: &ActiveBlockData,
) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "timeblock.replication.active_upserted".to_string(),
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock error")
            .as_millis() as u64,
        source: "http:timeblocks".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("timeblock-active:{}", active.start_id)),
        payload: serde_json::json!({
            "schemaVersion": 1,
            "scopeKey": normalize_scope_key(scope_key),
            "cursor": {
                "kind": "timeblock_active",
                "startId": active.start_id,
                "updatedAt": active
                    .resolve_last_transition_at()
                    .unwrap_or(active.updated_at.unwrap_or(active.resolve_start_time())),
                "originHostId": state.host_id.clone(),
            },
            "active": active,
        }),
    }
}

fn publish_active_timeblock_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    active: &ActiveBlockData,
) {
    publish_timeblock_replication_signal(
        state,
        build_active_timeblock_replication_signal(state, scope_key, active),
    );
}

pub(crate) fn publish_new_block_replication_signals(
    state: &AppState,
    scope_key: Option<&str>,
    result: &NewBlockResponse,
) {
    let completed_signal = result
        .completed
        .as_ref()
        .map(|completed| build_completed_timeblock_replication_signal(state, scope_key, completed));
    let active_signal = build_active_timeblock_replication_signal(state, scope_key, &result.active);

    if let Some(signal) = &completed_signal {
        state.signal_pool.publish(signal.clone());
    }
    state.signal_pool.publish(active_signal.clone());

    if let Some(mesh_relay) = &state.mesh_relay {
        let relay = std::sync::Arc::clone(mesh_relay);
        tokio::spawn(async move {
            if let Some(signal) = completed_signal {
                relay.forward_event_to_peers(signal).await;
            }
            relay.forward_event_to_peers(active_signal).await;
        });
    }
}

async fn apply_task_status_outcomes_for_block_end(
    state: &AppState,
    scope_key: Option<&str>,
    current: &ActiveBlockData,
    task_status_outcomes: Option<&std::collections::HashMap<String, String>>,
    now: u64,
    actor_id: &str,
    trigger: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    let Some(task_status_outcomes) = task_status_outcomes else {
        return Ok(());
    };

    let operation_id = uuid::Uuid::new_v4().to_string();
    let end_transition_ref = build_timeblock_transition_ref(
        &current.start_id,
        BlockTransitionType::End,
        now,
        Some(actor_id),
    );

    for (task_id, outcome) in task_status_outcomes {
        let Some(target_status) = parse_task_status_outcome(outcome)? else {
            continue;
        };

        let task = state
            .task_store
            .get_scoped(scope_key, task_id)
            .ok_or_else(|| conflict(format!("cannot end: task not found: {task_id}")))?;

        if task.status == target_status {
            continue;
        }

        transition_task_in_scope_with_context(
            state,
            scope_key,
            task_id,
            target_status,
            false,
            TaskTransitionContext {
                at: Some(now),
                reason: Some(TaskTransitionReason::TimeblockEnd),
                actor_id: Some(actor_id.to_string()),
                source_host_id: Some(state.host_id.clone()),
                operation_id: Some(operation_id.clone()),
                related_time_block_id: Some(current.start_id.clone()),
                related_time_block_transition_ref: Some(end_transition_ref.clone()),
                auto_generated: Some(true),
            },
            trigger,
        )
        .await
        .map_err(map_task_route_error_to_timeblock)?;
    }

    Ok(())
}

// ── #759 newBlock primitive ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBlockRequest {
    /// Required: the blockType of the NEW block to create ("active" or "gap")
    pub block_type: String,
    // Fields for creating active blocks
    pub name: Option<String>,
    pub mode: Option<String>,
    pub target_minutes: Option<u64>,
    pub task_ids: Option<Vec<String>>,
    pub source_planned_block_id: Option<String>,
    // Fields for completing the old block (when ending active → gap)
    pub feedback: Option<String>,
    pub task_status_outcomes: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartBlockRequest {
    name: String,
    #[serde(default = "default_mode")]
    mode: String,
    target_minutes: Option<u64>,
    #[serde(default)]
    task_ids: Vec<String>,
    source_planned_block_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchActiveBlockTasksRequest {
    #[serde(default)]
    task_ids: Vec<String>,
    #[serde(default)]
    task_association_log: Vec<BlockTaskAssociationEvent>,
}

fn default_mode() -> String {
    "countup".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndBlockRequest {
    feedback: Option<String>,
    task_status_outcomes: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletedReplicationRequest {
    block: TimeBlockData,
}

#[derive(Debug, Serialize)]
struct CompletedReplicationResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackfillGapBlocksResponse {
    inserted: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBlockResponse {
    pub completed: Option<TimeBlockData>,
    pub active: ActiveBlockData,
}

/// Atomic newBlock — ends old block + creates new block of specified type.
/// No state validation. Callers (start/end guards) are responsible.
pub fn do_new_block(
    store: &TimeBlockStore,
    scope_key: Option<&str>,
    req: &NewBlockRequest,
) -> Result<NewBlockResponse, (StatusCode, Json<ErrorResponse>)> {
    do_new_block_at(store, scope_key, req, current_timestamp_millis(), false)
}

pub fn do_new_block_with_perf_logging(
    store: &TimeBlockStore,
    scope_key: Option<&str>,
    req: &NewBlockRequest,
    perf_logging_enabled: bool,
) -> Result<NewBlockResponse, (StatusCode, Json<ErrorResponse>)> {
    do_new_block_at(
        store,
        scope_key,
        req,
        current_timestamp_millis(),
        perf_logging_enabled,
    )
}

fn do_new_block_at(
    store: &TimeBlockStore,
    scope_key: Option<&str>,
    req: &NewBlockRequest,
    now: u64,
    perf_logging_enabled: bool,
) -> Result<NewBlockResponse, (StatusCode, Json<ErrorResponse>)> {
    let current = store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?;

    // Complete current block (if any)
    let completed = if let Some(ref active) = current {
        let completed_block = TimeBlockData {
            id: active.start_id.clone(),
            name: active.name.clone(),
            start_id: active.start_id.clone(),
            end_id: format!("end-{}", uuid::Uuid::new_v4()),
            note: req.feedback.clone(),
            tags: if active.block_type.as_deref() == Some("gap") {
                vec![]
            } else {
                vec!["block_feedback".to_string()]
            },
            start_time: active.start_time,
            end_time: now,
            block_type: active.block_type.clone(),
            task_ids: active.task_ids.clone(),
            task_status_outcomes: req.task_status_outcomes.clone(),
            task_association_log: active.task_association_log.clone(),
            source_planned_block_id: active.source_planned_block_id.clone(),
            transitions: {
                let mut t = active.transitions.clone();
                if req.feedback.is_some() {
                    t.push(BlockTransition {
                        transition_type: BlockTransitionType::FeedbackSubmit,
                        at: now,
                        actor_id: Some("rt:newblock".to_string()),
                    });
                }
                t.push(BlockTransition {
                    transition_type: BlockTransitionType::End,
                    at: now,
                    actor_id: Some("rt:newblock".to_string()),
                });
                t
            },
        };

        let completed_write_started_at = Instant::now();
        store
            .put_completed_scoped(scope_key, completed_block.clone())
            .map_err(|e| internal_error(e.to_string()))?;
        let completed_write_ms = completed_write_started_at.elapsed().as_millis();
        if perf_logging_enabled {
            tracing::info!(
                scope_key = %normalize_scope_key(scope_key),
                block_id = %completed_block.id,
                start_id = %completed_block.start_id,
                "[PERF] ({}ms) runtime.timeblocks.completed_upsert",
                completed_write_ms
            );
        }

        Some(completed_block)
    } else {
        None
    };

    // Create new block of the specified type
    let is_gap = req.block_type == "gap";
    let new_active = ActiveBlockData {
        start_id: if is_gap {
            format!("gap-{}", uuid::Uuid::new_v4())
        } else {
            format!("tb-{}", uuid::Uuid::new_v4())
        },
        name: if is_gap {
            String::new()
        } else {
            req.name.clone().unwrap_or_default()
        },
        mode: if is_gap {
            "countup".to_string()
        } else {
            req.mode.clone().unwrap_or_else(|| "countup".to_string())
        },
        target_minutes: if is_gap { None } else { req.target_minutes },
        block_type: Some(req.block_type.clone()),
        transitions: vec![BlockTransition {
            transition_type: BlockTransitionType::Start,
            at: now,
            actor_id: Some("rt:newblock".to_string()),
        }],
        elapsed: if !is_gap && req.mode.as_deref() == Some("countdown") {
            req.target_minutes.unwrap_or(25) * 60 * 1000
        } else {
            0
        },
        updated_at: Some(now),
        phase: if is_gap {
            None
        } else {
            Some(BlockPhase::Running)
        },
        version: Some(1),
        actor_id: Some("rt:newblock".to_string()),
        last_transition_at: Some(now),
        last_resumed_at: if is_gap { None } else { Some(now) },
        accumulated_run_ms: if is_gap { None } else { Some(0) },
        start_time: now,
        action_ended_at: None,
        feedback_started_at: None,
        feedback_submitted_at: None,
        pause_accumulated_ms: if is_gap { None } else { Some(0) },
        paused: false,
        paused_at: None,
        task_ids: if is_gap {
            vec![]
        } else {
            req.task_ids.clone().unwrap_or_default()
        },
        task_association_log: vec![],
        source_planned_block_id: if is_gap {
            None
        } else {
            req.source_planned_block_id.clone()
        },
        task_id: None,
    };

    store
        .put_active_scoped(scope_key, new_active.clone())
        .map_err(|e| internal_error(e.to_string()))?;

    Ok(NewBlockResponse {
        completed,
        active: new_active,
    })
}

fn generate_gap_blocks(blocks: &[TimeBlockData]) -> Vec<TimeBlockData> {
    if blocks.len() < 2 {
        return Vec::new();
    }

    let mut sorted = blocks.to_vec();
    sorted.sort_by_key(|block| block.start_time);

    let active_blocks = sorted
        .iter()
        .filter(|block| block.block_type.as_deref() != Some("gap"))
        .collect::<Vec<_>>();

    let existing_gaps = sorted
        .iter()
        .filter(|block| block.block_type.as_deref() == Some("gap"))
        .map(|block| (block.start_time, block.end_time))
        .collect::<std::collections::HashSet<_>>();

    let mut gaps = Vec::new();
    for pair in active_blocks.windows(2) {
        let current = pair[0];
        let next = pair[1];
        if current.end_time == 0 {
            continue;
        }

        let gap_start = current.end_time;
        let gap_end = next.start_time;
        if existing_gaps.contains(&(gap_start, gap_end)) {
            continue;
        }

        gaps.push(TimeBlockData {
            id: format!("gap-{}-{}", current.resolve_id(), next.resolve_id()),
            name: String::new(),
            start_id: format!("gap-start-{}-{}", current.resolve_id(), next.resolve_id()),
            end_id: format!("gap-end-{}-{}", current.resolve_id(), next.resolve_id()),
            note: None,
            tags: Vec::new(),
            start_time: gap_start,
            end_time: gap_end,
            task_ids: Vec::new(),
            task_status_outcomes: None,
            task_association_log: Vec::new(),
            source_planned_block_id: None,
            block_type: Some("gap".to_string()),
            transitions: vec![
                BlockTransition {
                    transition_type: BlockTransitionType::Start,
                    at: gap_start,
                    actor_id: None,
                },
                BlockTransition {
                    transition_type: BlockTransitionType::End,
                    at: gap_end,
                    actor_id: None,
                },
            ],
        });
    }

    gaps
}

/// POST /timeblocks/new — raw primitive, no guard. For Agent/script use.
async fn new_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<NewBlockRequest>,
) -> Result<Json<NewBlockResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let current = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let now = current_timestamp_millis();
    if let Some(ref current) = current {
        apply_task_status_outcomes_for_block_end(
            &state,
            scope_key,
            current,
            payload.task_status_outcomes.as_ref(),
            now,
            "rt:newblock",
            "http:timeblocks/new",
        )
        .await?;
    }
    let result = do_new_block_at(
        &state.timeblock_store,
        scope_key,
        &payload,
        now,
        is_perf_logging_enabled(&state),
    )?;
    publish_new_block_replication_signals(&state, scope_key, &result);
    Ok(Json(result))
}

/// POST /timeblocks/start — guard: current must be gap (or empty). Creates active.
async fn start_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<StartBlockRequest>,
) -> Result<Json<NewBlockResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());

    // Guard: reject if current block is active (not gap, not completed)
    if let Some(current) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        if !current.is_gap() && !current.is_completed() {
            return Err(conflict("cannot start: active block in progress"));
        }
    }

    let result = do_new_block_with_perf_logging(
        &state.timeblock_store,
        scope_key,
        &NewBlockRequest {
            block_type: "active".to_string(),
            name: Some(payload.name),
            mode: Some(payload.mode),
            target_minutes: payload.target_minutes,
            task_ids: Some(payload.task_ids),
            source_planned_block_id: payload.source_planned_block_id,
            feedback: None,
            task_status_outcomes: None,
        },
        is_perf_logging_enabled(&state),
    )?;

    publish_new_block_replication_signals(&state, scope_key, &result);
    // Transition → EventLog linkage (active blocks only, gap skipped)
    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_start",
        &result.active.name,
        &result.active.start_id,
        &result.active.task_ids,
    )
    .await;

    Ok(Json(result))
}

/// POST /timeblocks/end — guard: current must be active. Creates gap.
async fn end_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<EndBlockRequest>,
) -> Result<Json<NewBlockResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());

    // Guard: reject if current block is gap (or empty)
    let current = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| conflict("cannot end: no active block"))?;

    if current.is_gap() {
        return Err(conflict("cannot end: current block is a gap"));
    }
    if current.is_completed() {
        return Err(conflict("cannot end: current block already ended"));
    }

    // Guard: must have stopped first (feedback phase required for active blocks)
    if !current.is_feedback_in_progress() {
        return Err(conflict(
            "cannot end: must stop first (use POST /timeblocks/stop)",
        ));
    }

    let now = current_timestamp_millis();
    apply_task_status_outcomes_for_block_end(
        &state,
        scope_key,
        &current,
        payload.task_status_outcomes.as_ref(),
        now,
        "rt:end",
        "http:timeblocks/end",
    )
    .await?;

    let result = do_new_block_at(
        &state.timeblock_store,
        scope_key,
        &NewBlockRequest {
            block_type: "gap".to_string(),
            name: None,
            mode: None,
            target_minutes: None,
            task_ids: None,
            source_planned_block_id: None,
            feedback: payload.feedback,
            task_status_outcomes: payload.task_status_outcomes,
        },
        now,
        is_perf_logging_enabled(&state),
    )?;

    // Transition → EventLog linkage: RT owns the full feedback report generation.
    // Gap block creation does NOT write EventLog (per #759 design)
    publish_new_block_replication_signals(&state, scope_key, &result);
    if let Some(ref completed) = result.completed {
        write_timeblock_feedback_eventlog(&state, scope_key, &current, completed).await;
    }

    Ok(Json(result))
}

async fn backfill_gap_blocks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<BackfillGapBlocksResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    let gaps = generate_gap_blocks(&blocks);
    if gaps.is_empty() {
        return Ok(Json(BackfillGapBlocksResponse { inserted: 0 }));
    }

    for gap in &gaps {
        state
            .timeblock_store
            .put_completed_scoped(scope_key, gap.clone())
            .map_err(|error| internal_error(error.to_string()))?;
    }

    Ok(Json(BackfillGapBlocksResponse {
        inserted: gaps.len(),
    }))
}

async fn replication_completed_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<CompletedReplicationRequest>,
) -> Result<Json<CompletedReplicationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let existing = state
        .timeblock_store
        .get_completed_by_start_id_scoped(scope_key, &payload.block.start_id)
        .map_err(|e| internal_error(e.to_string()))?;

    if existing.is_some() {
        return Ok(Json(CompletedReplicationResponse { status: "ignored" }));
    }

    let block = payload.block;
    let completed_write_started_at = Instant::now();
    state
        .timeblock_store
        .put_completed_scoped(scope_key, block.clone())
        .map_err(|e| internal_error(e.to_string()))?;
    let completed_write_ms = completed_write_started_at.elapsed().as_millis();
    if is_perf_logging_enabled(&state) {
        tracing::info!(
            scope_key = %normalize_scope_key(scope_key),
            block_id = %block.id,
            start_id = %block.start_id,
            "[PERF] ({}ms) runtime.timeblocks.replication_completed_upsert",
            completed_write_ms
        );
    }
    notify_local_completed_timeblock_replication_applied(&state, scope_key, &block);

    Ok(Json(CompletedReplicationResponse { status: "inserted" }))
}

// ── #780 stop/pause/resume ──────────────────────────────────────────

/// POST /timeblocks/stop — end focus, enter feedback phase (no gap created)
async fn stop_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock error")
        .as_millis() as u64;

    let current = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| conflict("cannot stop: no active block"))?;

    if current.is_gap() {
        return Err(conflict("cannot stop: current block is a gap"));
    }
    if current.is_feedback_in_progress() || current.is_completed() {
        return Err(conflict("cannot stop: already in feedback phase"));
    }

    let mut updated = current;
    updated.action_ended_at = Some(now);
    updated.feedback_started_at = Some(now);
    updated.phase = Some(BlockPhase::FeedbackInProgress);
    updated.paused = false;
    updated.version = Some(updated.version.unwrap_or(0) + 1);
    updated.last_transition_at = Some(now);
    updated.updated_at = Some(now);
    updated.transitions.push(BlockTransition {
        transition_type: BlockTransitionType::FeedbackStart,
        at: now,
        actor_id: Some("rt:stop".to_string()),
    });

    let name = updated.name.clone();
    let start_id = updated.start_id.clone();
    let task_ids = updated.task_ids.clone();

    state
        .timeblock_store
        .put_active_scoped(scope_key, updated)
        .map_err(|e| internal_error(e.to_string()))?;

    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        // Publish active signal — this creates a gap block for the "stopped" state
        // The completed signal will be published when feedback is submitted (end API)
        publish_active_timeblock_replication_signal(&state, scope_key, &active);
    }
    write_timeblock_eventlog(&state, scope_key, "block_end", &name, &start_id, &task_ids).await;

    Ok(Json(
        serde_json::json!({ "status": "stopped", "phase": "feedback_in_progress" }),
    ))
}

/// POST /timeblocks/pause — pause the current active block
async fn pause_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let now = current_timestamp_millis();

    let current = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| conflict("cannot pause: no active block"))?;

    if current.is_gap() {
        return Err(conflict("cannot pause: current block is a gap"));
    }
    if current.is_paused_state() {
        return Err(conflict("cannot pause: already paused"));
    }
    if current.is_feedback_in_progress() || current.is_completed() {
        return Err(conflict("cannot pause: block is in feedback phase"));
    }

    let operation_id = uuid::Uuid::new_v4().to_string();
    let actor_id = "rt:pause";
    let pause_transition_ref = build_timeblock_transition_ref(
        &current.start_id,
        BlockTransitionType::Pause,
        now,
        Some(actor_id),
    );

    for task_id in &current.task_ids {
        let Some(task) = state.task_store.get_scoped(scope_key, task_id) else {
            continue;
        };
        if task.status != TaskStatus::InProgress {
            continue;
        }

        transition_task_in_scope_with_context(
            &state,
            scope_key,
            task_id,
            TaskStatus::Suspended,
            false,
            TaskTransitionContext {
                at: Some(now),
                reason: Some(TaskTransitionReason::TimeblockPause),
                actor_id: Some(actor_id.to_string()),
                source_host_id: Some(state.host_id.clone()),
                operation_id: Some(operation_id.clone()),
                related_time_block_id: Some(current.start_id.clone()),
                related_time_block_transition_ref: Some(pause_transition_ref.clone()),
                auto_generated: Some(true),
            },
            "http:timeblocks/pause",
        )
        .await
        .map_err(map_task_route_error_to_timeblock)?;
    }

    // Calculate accumulated run time
    let run_since = current
        .last_resumed_at
        .unwrap_or(current.resolve_start_time());
    let new_run_ms = now.saturating_sub(run_since);
    let accumulated = current.accumulated_run_ms.unwrap_or(0) + new_run_ms;

    let mut updated = current;
    updated.paused = true;
    updated.paused_at = Some(now);
    updated.accumulated_run_ms = Some(accumulated);
    updated.phase = Some(BlockPhase::Paused);
    updated.version = Some(updated.version.unwrap_or(0) + 1);
    updated.last_transition_at = Some(now);
    updated.updated_at = Some(now);
    updated.transitions.push(BlockTransition {
        transition_type: BlockTransitionType::Pause,
        at: now,
        actor_id: Some("rt:pause".to_string()),
    });

    let name = updated.name.clone();
    let start_id = updated.start_id.clone();
    let task_ids = updated.task_ids.clone();

    state
        .timeblock_store
        .put_active_scoped(scope_key, updated)
        .map_err(|e| internal_error(e.to_string()))?;

    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        publish_active_timeblock_replication_signal(&state, scope_key, &active);
    }
    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_pause",
        &name,
        &start_id,
        &task_ids,
    )
    .await;

    Ok(Json(serde_json::json!({ "status": "paused" })))
}

/// POST /timeblocks/resume — resume the current paused block
async fn resume_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let now = current_timestamp_millis();

    let current = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| conflict("cannot resume: no active block"))?;

    if current.is_gap() {
        return Err(conflict("cannot resume: current block is a gap"));
    }
    if !current.is_paused_state() {
        return Err(conflict("cannot resume: not paused"));
    }

    let Some(last_pause_transition_ref) = current
        .transitions
        .iter()
        .rev()
        .find(|transition| transition.transition_type == BlockTransitionType::Pause)
        .map(|transition| {
            build_timeblock_transition_ref(
                &current.start_id,
                BlockTransitionType::Pause,
                transition.at,
                transition.actor_id.as_deref(),
            )
        })
        .or_else(|| {
            current.paused_at.map(|paused_at| {
                build_timeblock_transition_ref(
                    &current.start_id,
                    BlockTransitionType::Pause,
                    paused_at,
                    Some("rt:pause"),
                )
            })
        })
    else {
        return Err(conflict(
            "cannot resume: pause transition reference missing",
        ));
    };

    let operation_id = uuid::Uuid::new_v4().to_string();
    let actor_id = "rt:resume";

    for task_id in &current.task_ids {
        let Some(task) = state.task_store.get_scoped(scope_key, task_id) else {
            continue;
        };
        if task.status != TaskStatus::Suspended {
            continue;
        }
        let Some(last_transition) = task.status_transitions.last() else {
            continue;
        };
        if last_transition.reason != TaskTransitionReason::TimeblockPause {
            continue;
        }
        if last_transition.related_time_block_transition_ref.as_deref()
            != Some(last_pause_transition_ref.as_str())
        {
            continue;
        }

        transition_task_in_scope_with_context(
            &state,
            scope_key,
            task_id,
            TaskStatus::InProgress,
            false,
            TaskTransitionContext {
                at: Some(now),
                reason: Some(TaskTransitionReason::TimeblockResume),
                actor_id: Some(actor_id.to_string()),
                source_host_id: Some(state.host_id.clone()),
                operation_id: Some(operation_id.clone()),
                related_time_block_id: Some(current.start_id.clone()),
                related_time_block_transition_ref: Some(last_pause_transition_ref.clone()),
                auto_generated: Some(true),
            },
            "http:timeblocks/resume",
        )
        .await
        .map_err(map_task_route_error_to_timeblock)?;
    }

    // Calculate accumulated pause time
    let pause_since = current
        .paused_at
        .or(current.resolve_last_transition_at())
        .unwrap_or(now);
    let new_pause_ms = now.saturating_sub(pause_since);
    let pause_accumulated = current.pause_accumulated_ms.unwrap_or(0) + new_pause_ms;

    let mut updated = current;
    updated.paused = false;
    updated.paused_at = None;
    updated.last_resumed_at = Some(now);
    updated.pause_accumulated_ms = Some(pause_accumulated);
    updated.phase = Some(BlockPhase::Running);
    updated.version = Some(updated.version.unwrap_or(0) + 1);
    updated.last_transition_at = Some(now);
    updated.updated_at = Some(now);
    updated.transitions.push(BlockTransition {
        transition_type: BlockTransitionType::Resume,
        at: now,
        actor_id: Some("rt:resume".to_string()),
    });

    let name = updated.name.clone();
    let start_id = updated.start_id.clone();
    let task_ids = updated.task_ids.clone();

    state
        .timeblock_store
        .put_active_scoped(scope_key, updated)
        .map_err(|e| internal_error(e.to_string()))?;

    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        publish_active_timeblock_replication_signal(&state, scope_key, &active);
    }
    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_resume",
        &name,
        &start_id,
        &task_ids,
    )
    .await;

    Ok(Json(serde_json::json!({ "status": "resumed" })))
}

async fn patch_active_block_tasks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<PatchActiveBlockTasksRequest>,
) -> Result<Json<ActiveBlockData>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock error")
        .as_millis() as u64;

    let current = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| not_found("active timeblock not found"))?;

    if current.is_gap() {
        return Err(conflict("cannot patch tasks: current block is a gap"));
    }
    if current.is_completed() {
        return Err(conflict("cannot patch tasks: current block already ended"));
    }

    let mut updated = current;
    updated.task_ids = payload.task_ids;
    updated.task_association_log = payload.task_association_log;
    updated.version = Some(updated.version.unwrap_or(0) + 1);
    updated.updated_at = Some(now);
    updated.actor_id = Some("rt:active-task-links".to_string());

    state
        .timeblock_store
        .put_active_scoped(scope_key, updated.clone())
        .map_err(|error| internal_error(error.to_string()))?;
    publish_active_timeblock_replication_signal(&state, scope_key, &updated);

    Ok(Json(updated))
}

/// POST /timeblocks/describe — modify name of the current active block (no id needed)
async fn describe_current_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<DescribeBlockRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());

    let mut active = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "no active block".into(),
                }),
            )
        })?;

    if let Some(name) = payload.name {
        active.name = name;
    }
    // note field not yet on ActiveBlockData (#780 follow-up)

    let block_id = active.start_id.clone();

    state
        .timeblock_store
        .put_active_scoped(scope_key, active)
        .map_err(|e| internal_error(e.to_string()))?;
    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        publish_active_timeblock_replication_signal(&state, scope_key, &active);
    }

    Ok(Json(
        serde_json::json!({ "updated": "current", "blockId": block_id }),
    ))
}

// ── #759 describe: modify name/note of a timeblock by ID ────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DescribeBlockRequest {
    name: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BlockIdPath {
    block_id: String,
}

/// POST /timeblocks/:block_id/describe — modify name/note of a timeblock.
///
/// Rules (aligned with ExoMind immutability principle):
/// - Current active block (active or gap): allowed
/// - Completed gap block: allowed (retroactive naming, ① → ②)
/// - Completed active block: forbidden (immutable history)
async fn describe_block(
    State(state): State<AppState>,
    axum::extract::Path(path): axum::extract::Path<BlockIdPath>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<DescribeBlockRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let block_id = &path.block_id;

    // Try active block first
    if let Some(mut active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        if active.start_id == *block_id {
            if let Some(name) = payload.name {
                active.name = name;
            }
            // Active blocks don't have note field — skip silently
            state
                .timeblock_store
                .put_active_scoped(scope_key, active.clone())
                .map_err(|e| internal_error(e.to_string()))?;
            publish_active_timeblock_replication_signal(&state, scope_key, &active);
            return Ok(Json(
                serde_json::json!({ "updated": "active", "blockId": block_id }),
            ));
        }
    }

    let Some(mut block) = state
        .timeblock_store
        .get_completed_scoped(scope_key, block_id)
        .map_err(|e| internal_error(e.to_string()))?
    else {
        return Err(conflict(format!("block not found: {block_id}")));
    };

    if block.block_type.as_deref() != Some("gap") {
        return Err(conflict(
            "cannot describe: completed active blocks are immutable",
        ));
    }

    if let Some(name) = payload.name {
        block.name = name;
    }
    if let Some(note) = payload.note {
        block.note = Some(note);
    }
    let completed_write_started_at = Instant::now();
    state
        .timeblock_store
        .put_completed_scoped(scope_key, block)
        .map_err(|e| internal_error(e.to_string()))?;
    let completed_write_ms = completed_write_started_at.elapsed().as_millis();
    if is_perf_logging_enabled(&state) {
        tracing::info!(
            scope_key = %normalize_scope_key(scope_key),
            block_id = %block_id,
            "[PERF] ({}ms) runtime.timeblocks.describe_completed_gap_upsert",
            completed_write_ms
        );
    }
    Ok(Json(
        serde_json::json!({ "updated": "completed_gap", "blockId": block_id }),
    ))
}

async fn list_timeblocks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Vec<TimeBlockData>>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    // #759: filter by blockType if specified
    let filtered = match query.block_type.as_deref() {
        Some(bt) => blocks
            .into_iter()
            .filter(|b| b.block_type.as_deref() == Some(bt))
            .collect(),
        None => blocks,
    };
    Ok(Json(filtered))
}

async fn get_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<ActiveBlockData>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    match state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
    {
        Some(block) => Ok(Json(block.normalize_task_ids())),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "active timeblock not found".to_string(),
            }),
        )),
    }
}

async fn timeblock_backend_status(
    State(state): State<AppState>,
) -> Json<TimeBlockBackendStatusResponse> {
    let supports_sqlite_snapshot = matches!(
        state.timeblock_store.backend_kind(),
        crate::timeblock::TimeBlockStoreBackendKind::Sqlite
    );
    Json(TimeBlockBackendStatusResponse {
        backend: if supports_sqlite_snapshot {
            "rt-sqlite"
        } else {
            "memory"
        },
        supports_json_backup: true,
        supports_sqlite_snapshot,
    })
}

async fn reconcile_timeblock_scope_grants(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TimeBlockScopeGrantReconcileResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = require_named_scope_key(scope_query_key(&query))?;
    let granted_scope_key = scope_key.to_string();
    let grants = state.mesh.reconcile_scope_grants_for_enabled_peers(
        TIMEBLOCK_SCOPE_GRANT_DOMAIN,
        &granted_scope_key,
        "http:mesh/timeblocks/grants/reconcile",
    );

    Ok(Json(TimeBlockScopeGrantReconcileResponse {
        scope_key: granted_scope_key,
        granted_peers: grants.len(),
    }))
}

async fn export_timeblocks_json(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TimeBlockBackupJsonPayload>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let time_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(Json(TimeBlockBackupJsonPayload {
        version: 1,
        time_blocks,
        active_block,
    }))
}

async fn export_timeblocks_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<TimeBlockBackupSqlitePayload>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let time_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let bytes = build_timeblocks_sqlite_snapshot_bytes(&state, scope_key, &time_blocks)
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block_present = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
        .is_some();

    Ok(Json(TimeBlockBackupSqlitePayload {
        version: 1,
        file_name: "exomind-timeblocks.sqlite".to_string(),
        content_base64: STANDARD.encode(bytes),
        timeblock_count: time_blocks.len(),
        active_block_present,
    }))
}

async fn import_timeblocks_json(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<TimeBlockBackupJsonPayload>,
) -> Result<Json<TimeBlockImportResult>, (StatusCode, Json<ErrorResponse>)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let result = apply_timeblock_import(
        &state,
        scope_key,
        payload.time_blocks,
        payload.active_block,
        strategy,
    )?;
    Ok(Json(result))
}

async fn import_timeblocks_sqlite(
    State(state): State<AppState>,
    Query(query): Query<ImportQuery>,
    Json(payload): Json<TimeBlockBackupSqliteImportPayload>,
) -> Result<Json<TimeBlockImportResult>, (StatusCode, Json<ErrorResponse>)> {
    let strategy = parse_import_strategy(query.strategy.as_deref())?;
    let bytes = STANDARD.decode(payload.content_base64).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("invalid sqlite snapshot: {error}"),
            }),
        )
    })?;
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let (time_blocks, active_block) = read_timeblocks_from_sqlite_snapshot(&bytes, scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let result = apply_timeblock_import(&state, scope_key, time_blocks, active_block, strategy)?;
    Ok(Json(result))
}

async fn mesh_export_timeblocks_sqlite(
    State(state): State<AppState>,
    Extension(identity): Extension<AuthenticatedPeerIdentity>,
) -> Result<Json<TimeBlockBackupSqlitePayload>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = resolve_peer_scope_key(&state, &identity)?;
    let time_blocks = state
        .timeblock_store
        .list_completed_scoped(Some(scope_key.as_str()))
        .map_err(|error| internal_error(error.to_string()))?;
    let bytes =
        build_timeblocks_sqlite_snapshot_bytes(&state, Some(scope_key.as_str()), &time_blocks)
            .map_err(|error| internal_error(error.to_string()))?;
    let active_block_present = state
        .timeblock_store
        .get_active_scoped(Some(scope_key.as_str()))
        .map_err(|error| internal_error(error.to_string()))?
        .is_some();

    Ok(Json(TimeBlockBackupSqlitePayload {
        version: 1,
        file_name: "exomind-timeblocks.sqlite".to_string(),
        content_base64: STANDARD.encode(bytes),
        timeblock_count: time_blocks.len(),
        active_block_present,
    }))
}

async fn proxy_peer_timeblocks_sqlite_snapshot(
    Path(peer_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<TimeBlockBackupSqlitePayload>, (StatusCode, Json<ErrorResponse>)> {
    let payload = proxy_peer_json::<TimeBlockBackupSqlitePayload>(
        &state,
        &peer_id,
        "/mesh/timeblocks/snapshot/sqlite",
        None,
    )
    .await?;
    Ok(Json(payload))
}

fn parse_import_strategy(
    raw: Option<&str>,
) -> Result<TimeBlockImportStrategy, (StatusCode, Json<ErrorResponse>)> {
    match raw.unwrap_or("merge") {
        "merge" => Ok(TimeBlockImportStrategy::Merge),
        "overwrite" => Ok(TimeBlockImportStrategy::Overwrite),
        other => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unsupported import strategy: {other}"),
            }),
        )),
    }
}

fn active_block_phase_rank(block: &ActiveBlockData) -> u8 {
    match block.resolve_phase() {
        Some("feedback_submitted") => 2,
        Some("feedback_in_progress") => 1,
        _ => 0,
    }
}

fn active_block_order_time(block: &ActiveBlockData) -> u64 {
    block
        .resolve_last_transition_at()
        .unwrap_or(block.updated_at.unwrap_or(block.resolve_start_time()))
}

fn should_accept_imported_active_block(
    existing: &ActiveBlockData,
    incoming: &ActiveBlockData,
) -> bool {
    if existing.start_id != incoming.start_id {
        let incoming_start = incoming.resolve_start_time();
        let existing_start = existing.resolve_start_time();
        if incoming_start > existing_start {
            return true;
        }
        if incoming_start < existing_start {
            return false;
        }

        let incoming_order = active_block_order_time(incoming);
        let existing_order = active_block_order_time(existing);
        if incoming_order > existing_order {
            return true;
        }
        if incoming_order < existing_order {
            return false;
        }
    }

    let incoming_phase = active_block_phase_rank(incoming);
    let existing_phase = active_block_phase_rank(existing);
    if incoming_phase > existing_phase {
        return true;
    }
    if incoming_phase < existing_phase {
        return false;
    }

    let incoming_version = incoming.version.unwrap_or(0);
    let existing_version = existing.version.unwrap_or(0);
    if incoming_version > existing_version {
        return true;
    }
    if incoming_version < existing_version {
        return false;
    }

    let incoming_order = active_block_order_time(incoming);
    let existing_order = active_block_order_time(existing);
    if incoming_order > existing_order {
        return true;
    }
    if incoming_order < existing_order {
        return false;
    }

    let incoming_actor = incoming.actor_id.as_deref().unwrap_or("");
    let existing_actor = existing.actor_id.as_deref().unwrap_or("");
    incoming_actor > existing_actor
}

fn merge_active_block_import(
    existing: Option<ActiveBlockData>,
    imported: Option<ActiveBlockData>,
) -> Option<ActiveBlockData> {
    match (existing, imported) {
        (Some(existing), Some(imported)) => {
            if should_accept_imported_active_block(&existing, &imported) {
                Some(imported)
            } else {
                Some(existing)
            }
        }
        (Some(existing), None) => Some(existing),
        (None, Some(imported)) => Some(imported),
        (None, None) => None,
    }
}

fn apply_timeblock_import(
    state: &AppState,
    scope_key: Option<&str>,
    imported_blocks: Vec<TimeBlockData>,
    imported_active_block: Option<ActiveBlockData>,
    strategy: TimeBlockImportStrategy,
) -> Result<TimeBlockImportResult, (StatusCode, Json<ErrorResponse>)> {
    let existing_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let existing_active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    let (next_blocks, imported, skipped) = match strategy {
        TimeBlockImportStrategy::Overwrite => {
            let imported = imported_blocks.len();
            (imported_blocks, imported, 0)
        }
        TimeBlockImportStrategy::Merge => {
            let existing_by_id = existing_blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<std::collections::HashSet<_>>();
            let imported = imported_blocks
                .iter()
                .filter(|block| !existing_by_id.contains(block.id.as_str()))
                .count();
            let skipped = imported_blocks.len().saturating_sub(imported);
            let mut merged = existing_blocks;
            for block in imported_blocks {
                if let Some(index) = merged.iter().position(|existing| existing.id == block.id) {
                    merged[index] = block;
                } else {
                    merged.push(block);
                }
            }
            merged.sort_by(|left, right| {
                right
                    .end_time
                    .cmp(&left.end_time)
                    .then_with(|| right.id.cmp(&left.id))
            });
            (merged, imported, skipped)
        }
    };

    state
        .timeblock_store
        .replace_completed_scoped(scope_key, &next_blocks)
        .map_err(|error| internal_error(error.to_string()))?;

    let next_active_block = match strategy {
        TimeBlockImportStrategy::Overwrite => imported_active_block,
        TimeBlockImportStrategy::Merge => {
            merge_active_block_import(existing_active_block.clone(), imported_active_block)
        }
    };

    let active_block_updated = next_active_block != existing_active_block;
    match next_active_block {
        Some(block) => state
            .timeblock_store
            .put_active_scoped(scope_key, block)
            .map_err(|error| internal_error(error.to_string()))?,
        None => state
            .timeblock_store
            .delete_active_scoped(scope_key)
            .map_err(|error| internal_error(error.to_string()))?,
    }

    Ok(TimeBlockImportResult {
        imported,
        skipped,
        total: next_blocks.len(),
        active_block_updated,
    })
}

async fn write_timeblock_eventlog(
    state: &AppState,
    scope_key: Option<&str>,
    event_type: &str,
    block_name: &str,
    start_id: &str,
    task_ids: &[String],
) {
    let content = match event_type {
        "block_start" => format!("时间块开始: {block_name}"),
        "block_end" => format!("时间块停止: {block_name}"),
        "block_pause" => format!("时间块暂停: {block_name}"),
        "block_resume" => format!("时间块恢复: {block_name}"),
        _ => format!("时间块事件: {block_name}"),
    };
    let event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        content,
        tags: vec![event_type.to_string()],
        refs: vec![],
        metadata: Some(serde_json::json!({
            "block_name": block_name,
            "start_id": start_id,
            "task_ids": task_ids,
            "source": {
                "app": "exomind-runtime",
                "trigger": format!("http:timeblocks/{event_type}"),
            }
        })),
    };

    if let Err(error) = state
        .eventlog_appender()
        .append_event(scope_key, event.clone())
        .await
    {
        tracing::warn!(error = %error, "failed to write timeblock eventlog");
    }
}

fn format_feedback_duration(ms: u64) -> String {
    let total_seconds = (ms.saturating_add(500)) / 1000;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    if hours > 0 {
        return format!("{hours}:{minutes:02}:{seconds:02}");
    }

    format!("{minutes:02}:{seconds:02}")
}

fn format_feedback_clock(ts: u64) -> String {
    chrono::Local
        .timestamp_millis_opt(ts as i64)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

fn resolve_transition_at(
    transitions: &[BlockTransition],
    kind: BlockTransitionType,
) -> Option<u64> {
    transitions
        .iter()
        .rev()
        .find(|transition| transition.transition_type == kind)
        .map(|transition| transition.at)
}

fn build_timeblock_feedback_report(
    current: &ActiveBlockData,
    completed: &TimeBlockData,
    task_titles: &std::collections::HashMap<String, String>,
) -> String {
    let submitted_at = completed.resolve_end_time();
    let action_start_at = current.resolve_start_time();
    let action_ended_at = current
        .action_ended_at
        .or_else(|| resolve_transition_at(&current.transitions, BlockTransitionType::FeedbackStart))
        .unwrap_or(submitted_at);
    let feedback_started_at = current
        .feedback_started_at
        .or_else(|| resolve_transition_at(&current.transitions, BlockTransitionType::FeedbackStart))
        .unwrap_or(action_ended_at);

    let paused_duration_ms = current.pause_accumulated_ms.unwrap_or(0);
    let action_duration_ms = action_ended_at.saturating_sub(action_start_at);
    let feedback_duration_ms = submitted_at.saturating_sub(feedback_started_at);
    let total_duration_ms = submitted_at.saturating_sub(action_start_at);
    let work_duration_ms = action_duration_ms.saturating_sub(paused_duration_ms);
    let expected_duration_ms = if current.mode == "countdown" {
        Some(current.target_minutes.unwrap_or(25) * 60 * 1000)
    } else {
        None
    };
    let expected_end_at =
        expected_duration_ms.map(|duration| action_start_at.saturating_add(duration));

    let has_expected_duration = expected_duration_ms.is_some();
    let expected_duration_value = expected_duration_ms.unwrap_or(0);
    let expected_end_value = expected_end_at.unwrap_or(0);
    let expected_diff = if !has_expected_duration {
        "无预期（正计时）".to_string()
    } else if action_ended_at < expected_end_value {
        format!(
            "🚀提前{}完成",
            format_feedback_duration(expected_end_value - action_ended_at)
        )
    } else if action_ended_at > expected_end_value && work_duration_ms < expected_duration_value {
        format!(
            "✨时间块已完成，超出预期结束时间{}",
            format_feedback_duration(action_ended_at - expected_end_value)
        )
    } else if work_duration_ms > expected_duration_value {
        format!(
            "🕒工作超时{}",
            format_feedback_duration(work_duration_ms - expected_duration_value)
        )
    } else {
        "与预期一致".to_string()
    };
    let focus_rhythm = if paused_duration_ms > 0 {
        format!("有暂停 {}", format_feedback_duration(paused_duration_ms))
    } else {
        "连续专注".to_string()
    };
    let feedback_text = completed.note.as_deref().unwrap_or("").trim();
    let has_feedback = !feedback_text.is_empty();
    let feedback_status = if has_feedback {
        "已填写"
    } else {
        "未填写"
    };

    let mut result = String::new();
    let mut print = |line: &str| {
        result.push_str(line);
        result.push('\n');
    };

    print(&format!("## {}", completed.name));
    print("");
    print("### 时刻信息");
    print("");
    print(&format!(
        "- 时间开始于：`{}`",
        format_feedback_clock(action_start_at)
    ));
    print(&format!(
        "- 预期结束于：`{}`",
        expected_end_at
            .map(format_feedback_clock)
            .unwrap_or_else(|| "∞".to_string())
    ));
    print(&format!(
        "- 时间结束于：`{}`",
        format_feedback_clock(action_ended_at)
    ));
    print(&format!(
        "- 反馈提交于：`{}`",
        format_feedback_clock(submitted_at)
    ));
    print("");

    print("### 统计信息");
    print("");
    print(&format!(
        "- 总共时长：**`{}`**",
        format_feedback_duration(total_duration_ms)
    ));
    if let Some(expected_duration_ms) = expected_duration_ms {
        print(&format!(
            "- 预期时长：**`{}`**",
            format_feedback_duration(expected_duration_ms)
        ));
    } else {
        print("- 预期时长：**`∞`**");
    }
    if work_duration_ms > 0 {
        print(&format!(
            "- 实际工作：**`{}`**",
            format_feedback_duration(work_duration_ms)
        ));
    }
    if paused_duration_ms > 0 {
        print(&format!(
            "- 暂停时长：**`{}`**",
            format_feedback_duration(paused_duration_ms)
        ));
    }
    if feedback_duration_ms > 0 {
        print(&format!(
            "- 反馈用时：**`{}`**",
            format_feedback_duration(feedback_duration_ms)
        ));
    }
    if let Some(expected_duration_ms) = expected_duration_ms {
        let overtime_ms = work_duration_ms.saturating_sub(expected_duration_ms);
        if overtime_ms > 0 {
            print(&format!(
                "- 超时投入：**`{}`**",
                format_feedback_duration(overtime_ms)
            ));
        }
    }
    print("");

    print("### 快速反馈");
    print("");
    print(&format!("- 预期差异：**`{expected_diff}`**"));
    print(&format!("- 专注节奏：**`{focus_rhythm}`**"));
    print(&format!("- 反馈状态：**`{feedback_status}`**"));

    if has_feedback {
        print("");
        print("---");
        print("");
        print(feedback_text);
    }

    if let Some(task_status_outcomes) = completed.task_status_outcomes.as_ref() {
        if !task_status_outcomes.is_empty() {
            print("");
            print("### 任务状态");
            for (task_id, status) in task_status_outcomes {
                let title = task_titles
                    .get(task_id)
                    .map(String::as_str)
                    .unwrap_or(task_id);
                let label = match status.as_str() {
                    "continue" => "将继续",
                    "suspended" => "已挂起",
                    "completed" => "已完成",
                    "cancelled" => "已取消",
                    _ => status.as_str(),
                };
                print(&format!("- {title}：{label}"));
            }
        }
    }

    result.trim_end().to_string()
}

async fn write_timeblock_feedback_eventlog(
    state: &AppState,
    scope_key: Option<&str>,
    current: &ActiveBlockData,
    completed: &TimeBlockData,
) {
    let submitted_at = completed.resolve_end_time();
    let action_start_at = current.resolve_start_time();
    let action_ended_at = current
        .action_ended_at
        .or_else(|| resolve_transition_at(&current.transitions, BlockTransitionType::FeedbackStart))
        .unwrap_or(submitted_at);
    let feedback_started_at = current
        .feedback_started_at
        .or_else(|| resolve_transition_at(&current.transitions, BlockTransitionType::FeedbackStart))
        .unwrap_or(action_ended_at);
    let paused_duration_ms = current.pause_accumulated_ms.unwrap_or(0);
    let action_duration_ms = action_ended_at.saturating_sub(action_start_at);
    let feedback_duration_ms = submitted_at.saturating_sub(feedback_started_at);
    let total_duration_ms = submitted_at.saturating_sub(action_start_at);
    let work_duration_ms = action_duration_ms.saturating_sub(paused_duration_ms);
    let expected_duration_ms = if current.mode == "countdown" {
        Some(current.target_minutes.unwrap_or(25) * 60 * 1000)
    } else {
        None
    };
    let expected_end_at =
        expected_duration_ms.map(|duration| action_start_at.saturating_add(duration));

    let task_titles = completed
        .task_status_outcomes
        .as_ref()
        .map(|outcomes| outcomes.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_else(|| completed.task_ids.clone())
        .into_iter()
        .map(|task_id| {
            let title = state
                .task_store
                .get_scoped(scope_key, &task_id)
                .map(|task| task.title)
                .unwrap_or_else(|| task_id.clone());
            (task_id, title)
        })
        .collect::<std::collections::HashMap<_, _>>();
    let content = build_timeblock_feedback_report(current, completed, &task_titles);
    let content_for_signal = content.clone();
    let event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: submitted_at as i64,
        content,
        tags: vec!["block_feedback".to_string()],
        refs: vec![],
        metadata: Some(serde_json::json!({
            "block_name": completed.name,
            "start_id": completed.start_id,
            "task_ids": completed.task_ids,
            "task_titles": task_titles,
            "task_status_outcomes": completed.task_status_outcomes,
            "action_start_at": action_start_at,
            "action_ended_at": action_ended_at,
            "feedback_started_at": feedback_started_at,
            "submitted_at": submitted_at,
            "action_duration_ms": action_duration_ms,
            "feedback_duration_ms": feedback_duration_ms,
            "paused_duration_ms": paused_duration_ms,
            "work_duration_ms": work_duration_ms,
            "total_duration_ms": total_duration_ms,
            "expected_duration_ms": expected_duration_ms,
            "expected_end_at": expected_end_at,
            "source": {
                "app": "exomind-runtime",
                "trigger": "http:timeblocks/block_feedback",
                "report_template": "rt-default-v1",
            }
        })),
    };

    if let Err(error) = state
        .eventlog_appender()
        .append_event(scope_key, event.clone())
        .await
    {
        tracing::warn!(error = %error, "failed to write timeblock feedback eventlog");
        return;
    }

    // Publish block_feedback.created signal so downstream agents (e.g. timeblock_summary)
    // can react to user feedback submission without waiting for replication.completed.
    state.signal_pool.publish(SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "timeblock.block_feedback.created".to_string(),
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock error")
            .as_millis() as u64,
        source: "timeblock_summary".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 1,
        trace_id: None,
        payload: serde_json::json!({
            "scopeKey": normalize_scope_key(scope_key),
            "block": completed,
            "feedback": content_for_signal,
        }),
    });
}

fn build_timeblocks_sqlite_snapshot_bytes(
    state: &AppState,
    scope_key: Option<&str>,
    time_blocks: &[TimeBlockData],
) -> Result<Vec<u8>, crate::timeblock::TimeBlockStoreError> {
    let exomind_temp = std::env::temp_dir().join("exomind");
    let _ = std::fs::create_dir_all(&exomind_temp);
    let temp_dir = tempfile::Builder::new()
        .prefix("timeblocks-export-")
        .tempdir_in(&exomind_temp)?;
    let sqlite_path = temp_dir.path().join("timeblocks-export.sqlite");
    let store = crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path)?;
    store.replace_completed_scoped(scope_key, time_blocks)?;
    if let Some(active_block) = state.timeblock_store.get_active_scoped(scope_key)? {
        store.put_active_scoped(scope_key, active_block)?;
    }
    let bytes = store.sqlite_snapshot_bytes()?.ok_or_else(|| {
        crate::timeblock::TimeBlockStoreError::Io(std::io::Error::other(
            "failed to produce scoped timeblock snapshot",
        ))
    })?;
    drop(store);
    if let Err(e) = temp_dir.close() {
        tracing::warn!(error = %e, "failed to clean exomind temp dir");
    }
    Ok(bytes)
}

fn read_timeblocks_from_sqlite_snapshot(
    bytes: &[u8],
    scope_key: Option<&str>,
) -> Result<(Vec<TimeBlockData>, Option<ActiveBlockData>), crate::timeblock::TimeBlockStoreError> {
    let exomind_temp = std::env::temp_dir().join("exomind");
    let _ = std::fs::create_dir_all(&exomind_temp);
    let temp_dir = tempfile::Builder::new()
        .prefix("timeblocks-import-")
        .tempdir_in(&exomind_temp)?;
    let sqlite_path = temp_dir.path().join("timeblocks-import.sqlite");
    std::fs::write(&sqlite_path, bytes)?;
    let store = crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path)?;
    let time_blocks = store.list_completed_scoped(scope_key)?;
    let active_block = store.get_active_scoped(scope_key)?;
    drop(store);
    if let Err(e) = temp_dir.close() {
        tracing::warn!(error = %e, "failed to clean exomind temp dir");
    }
    Ok((time_blocks, active_block))
}

fn scope_query_key(query: &ScopeQuery) -> Option<&str> {
    query.profile_id.as_deref().or(query.user_id.as_deref())
}

fn require_named_scope_key(
    scope_key: Option<&str>,
) -> Result<&str, (StatusCode, Json<ErrorResponse>)> {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "timeblock scope grant reconciliation requires profile_id/user_id"
                    .to_string(),
            }),
        ))
}

fn resolve_peer_scope_key(
    state: &AppState,
    identity: &AuthenticatedPeerIdentity,
) -> Result<String, (StatusCode, Json<ErrorResponse>)> {
    state
        .mesh
        .resolve_scope_key_for_peer_domain(&identity.peer_id, TIMEBLOCK_SCOPE_GRANT_DOMAIN)
        .map_err(|error| {
            internal_error(format!("timeblock peer scope grant lookup failed: {error}"))
        })?
        .ok_or((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: format!(
                    "peer scope grant missing: peer_id={} domain={}",
                    identity.peer_id, TIMEBLOCK_SCOPE_GRANT_DOMAIN
                ),
            }),
        ))
}

async fn proxy_peer_json<T: DeserializeOwned>(
    state: &AppState,
    peer_id: &str,
    remote_path: &str,
    query: Option<Vec<(&str, String)>>,
) -> Result<T, (StatusCode, Json<ErrorResponse>)> {
    let peer = state.mesh.get_peer(peer_id).ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: format!("mesh peer not found: {peer_id}"),
        }),
    ))?;
    if !peer.enabled {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: format!("mesh peer disabled: {peer_id}"),
            }),
        ));
    }
    let auth_token = peer.auth_token.ok_or((
        StatusCode::CONFLICT,
        Json(ErrorResponse {
            error: format!("mesh peer missing outbound auth token: {peer_id}"),
        }),
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
            internal_error(format!(
                "peer timeblock proxy request failed for peer {peer_id} url={url_text}: {error}"
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = read_peer_proxy_error_detail(response).await;
        return Err((
            status,
            Json(ErrorResponse {
                error: format!(
                    "peer timeblock proxy request returned status {status} for peer {peer_id} url={url_text}{}",
                    detail
                        .map(|value| format!(" detail={value}"))
                        .unwrap_or_default()
                ),
            }),
        ));
    }

    response.json::<T>().await.map_err(|error| {
        internal_error(format!(
            "peer timeblock proxy response decode failed: {error}"
        ))
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
) -> Result<reqwest::Url, (StatusCode, Json<ErrorResponse>)> {
    let mut url = reqwest::Url::parse(&format!(
        "{}{}",
        base_url.trim_end_matches('/'),
        remote_path
    ))
    .map_err(|error| internal_error(format!("invalid mesh peer base url: {error}")))?;

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

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/timeblocks", get(list_timeblocks))
        .route("/timeblocks/new", post(new_block))
        .route("/timeblocks/backfill-gaps", post(backfill_gap_blocks))
        .route("/timeblocks/start", post(start_block))
        .route("/timeblocks/end", post(end_block))
        .route(
            "/timeblocks/replication/completed",
            post(replication_completed_block),
        )
        .route("/timeblocks/stop", post(stop_block))
        .route("/timeblocks/pause", post(pause_block))
        .route("/timeblocks/resume", post(resume_block))
        .route("/timeblocks/active/tasks", patch(patch_active_block_tasks))
        .route("/timeblocks/describe", post(describe_current_block))
        .route("/timeblocks/:block_id/describe", post(describe_block))
        .route("/timeblocks/active", get(get_active_timeblock))
        .route("/timeblocks/backend/status", get(timeblock_backend_status))
        .route("/timeblocks/backup/json", get(export_timeblocks_json))
        .route("/timeblocks/backup/sqlite", get(export_timeblocks_sqlite))
        .route("/timeblocks/import/json", post(import_timeblocks_json))
        .route("/timeblocks/import/sqlite", post(import_timeblocks_sqlite))
        .route(
            "/mesh/timeblocks/grants/reconcile",
            post(reconcile_timeblock_scope_grants),
        )
        .route(
            "/mesh/timeblocks/snapshot/sqlite",
            get(mesh_export_timeblocks_sqlite),
        )
        .route(
            "/mesh/peers/:peer_id/timeblocks/snapshot/sqlite",
            get(proxy_peer_timeblocks_sqlite_snapshot),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthenticatedPeerIdentity;
    use crate::signal::SignalPool;
    use crate::timeblock::{ActiveBlockData, BlockTransition, BlockTransitionType};
    use axum::body::Body;
    use axum::http::{HeaderMap, Request};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use tower::util::ServiceExt;

    fn test_state_with_timeblock_store(
        timeblock_store: Arc<crate::timeblock::TimeBlockStore>,
    ) -> AppState {
        test_state_with_timeblock_store_and_eventlog(
            timeblock_store,
            Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir()
                    .join(format!("exomind-test-timeblocks-{}", uuid::Uuid::new_v4())),
            )),
        )
    }

    fn test_state_with_timeblock_store_and_eventlog(
        timeblock_store: Arc<crate::timeblock::TimeBlockStore>,
        eventlog_store: Arc<crate::eventlog::EventLogStore>,
    ) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "timeblocks-test-host".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            device_id: "dev-timeblocks-test-host".to_string(),
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
            task_store: Arc::new(crate::task::TaskStore::new()),
            proposal_store: Arc::new(crate::proposal::ProposalStore::new()),
            session_store: Arc::new(crate::session::SessionStore::new()),
            agent_api_session_store: Arc::new(crate::agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx: {
                let (tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
                eventlog_store.set_watch_tx(tx.clone());
                tx
            },
            timeblock_store,
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

    fn make_test_peer(id: &str, base_url: &str) -> crate::mesh::PeerInfo {
        crate::mesh::PeerInfo {
            id: id.to_string(),
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
            domain: TIMEBLOCK_SCOPE_GRANT_DOMAIN.to_string(),
            scope_key: scope_key.to_string(),
            granted_at: chrono::Utc::now().to_rfc3339(),
            granted_by: "test".to_string(),
        }
    }

    #[derive(Clone)]
    struct FakePeerSnapshotState {
        payload: TimeBlockBackupSqlitePayload,
        captured_auth: Arc<Mutex<Option<String>>>,
    }

    async fn fake_peer_timeblocks_snapshot_handler(
        axum::extract::State(state): axum::extract::State<FakePeerSnapshotState>,
        headers: HeaderMap,
    ) -> Json<TimeBlockBackupSqlitePayload> {
        let auth = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        *state.captured_auth.lock().unwrap() = auth;
        Json(TimeBlockBackupSqlitePayload {
            version: state.payload.version,
            file_name: state.payload.file_name.clone(),
            content_base64: state.payload.content_base64.clone(),
            timeblock_count: state.payload.timeblock_count,
            active_block_present: state.payload.active_block_present,
        })
    }

    async fn spawn_fake_peer_timeblocks_snapshot_server(
        payload: TimeBlockBackupSqlitePayload,
        captured_auth: Arc<Mutex<Option<String>>>,
    ) -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route(
                "/mesh/timeblocks/snapshot/sqlite",
                get(fake_peer_timeblocks_snapshot_handler),
            )
            .with_state(FakePeerSnapshotState {
                payload,
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

    async fn fake_peer_timeblocks_error_handler() -> (StatusCode, Json<serde_json::Value>) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "timeblock sqlite snapshot export failed: invalid active block",
            })),
        )
    }

    async fn spawn_fake_peer_timeblocks_error_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new().route(
            "/mesh/timeblocks/snapshot/sqlite",
            get(fake_peer_timeblocks_error_handler),
        );
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

    #[tokio::test]
    async fn mesh_timeblocks_snapshot_route_uses_granted_scope_only() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks-mesh-peer-scope.sqlite");
        let timeblock_store =
            Arc::new(crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
        timeblock_store
            .replace_completed_scoped(
                Some("profile-a"),
                &[TimeBlockData {
                    id: "tb-a-1".to_string(),
                    name: "Granted scope block".to_string(),
                    start_id: "start-a-1".to_string(),
                    end_id: "end-a-1".to_string(),
                    note: None,
                    tags: vec!["focus".to_string()],
                    start_time: 1000,
                    end_time: 2000,
                    task_ids: vec![],
                    task_status_outcomes: None,
                    task_association_log: vec![],
                    source_planned_block_id: None,
                    block_type: Some("active".to_string()),
                    transitions: vec![],
                }],
            )
            .unwrap();
        timeblock_store
            .replace_completed_scoped(
                Some("profile-b"),
                &[TimeBlockData {
                    id: "tb-b-1".to_string(),
                    name: "Other scope block".to_string(),
                    start_id: "start-b-1".to_string(),
                    end_id: "end-b-1".to_string(),
                    note: None,
                    tags: vec!["focus".to_string()],
                    start_time: 3000,
                    end_time: 4000,
                    task_ids: vec![],
                    task_status_outcomes: None,
                    task_association_log: vec![],
                    source_planned_block_id: None,
                    block_type: Some("active".to_string()),
                    transitions: vec![],
                }],
            )
            .unwrap();
        timeblock_store
            .put_active_scoped(
                Some("profile-a"),
                ActiveBlockData {
                    start_id: "active-a-1".to_string(),
                    name: "Granted active".to_string(),
                    mode: "countup".to_string(),
                    target_minutes: None,
                    elapsed: 0,
                    updated_at: Some(2100),
                    phase: Some(BlockPhase::Running),
                    version: Some(1),
                    actor_id: Some("actor-a".to_string()),
                    last_transition_at: Some(2100),
                    last_resumed_at: Some(2000),
                    accumulated_run_ms: Some(100),
                    start_time: 2000,
                    action_ended_at: None,
                    feedback_started_at: None,
                    feedback_submitted_at: None,
                    pause_accumulated_ms: Some(0),
                    paused: false,
                    paused_at: None,
                    task_ids: vec![],
                    task_association_log: vec![],
                    source_planned_block_id: None,
                    block_type: Some("active".to_string()),
                    transitions: vec![],
                    task_id: None,
                },
            )
            .unwrap();
        let state = test_state_with_timeblock_store(timeblock_store);
        state
            .mesh
            .upsert_peer(make_test_peer("peer-phone", "http://peer-phone.local:1949"));
        state
            .mesh
            .upsert_scope_grant(make_scope_grant("peer-phone", "profile-a"));
        let app = test_router(state.clone());

        let mut request = Request::builder()
            .uri("/mesh/timeblocks/snapshot/sqlite?user_id=profile-b")
            .body(Body::empty())
            .unwrap();
        request.extensions_mut().insert(AuthenticatedPeerIdentity {
            peer_id: "peer-phone".to_string(),
        });

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: TimeBlockBackupSqlitePayload = serde_json::from_slice(&body).unwrap();
        let bytes = STANDARD.decode(payload.content_base64).unwrap();
        let (granted_blocks, granted_active) =
            read_timeblocks_from_sqlite_snapshot(&bytes, Some("profile-a")).unwrap();
        let (other_blocks, other_active) =
            read_timeblocks_from_sqlite_snapshot(&bytes, Some("profile-b")).unwrap();

        assert_eq!(payload.timeblock_count, 1);
        assert!(payload.active_block_present);
        assert_eq!(granted_blocks.len(), 1);
        assert_eq!(granted_blocks[0].id, "tb-a-1");
        assert_eq!(
            granted_active.expect("granted active block").start_id,
            "active-a-1"
        );
        assert!(other_blocks.is_empty());
        assert!(other_active.is_none());
    }

    #[tokio::test]
    async fn reconcile_timeblock_scope_grants_grants_only_enabled_peers() {
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        let state = test_state_with_timeblock_store(timeblock_store);
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
                    .uri("/mesh/timeblocks/grants/reconcile?user_id=profile-reconcile")
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
                .resolve_scope_key_for_peer_domain("peer-enabled", TIMEBLOCK_SCOPE_GRANT_DOMAIN)
                .unwrap(),
            Some("profile-reconcile".to_string())
        );
        assert_eq!(
            state
                .mesh
                .resolve_scope_key_for_peer_domain("peer-disabled", TIMEBLOCK_SCOPE_GRANT_DOMAIN)
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn proxy_peer_timeblocks_snapshot_uses_mesh_outbound_auth_token() {
        let captured_auth = Arc::new(Mutex::new(None));
        let payload = TimeBlockBackupSqlitePayload {
            version: 1,
            file_name: "peer-timeblocks.sqlite".to_string(),
            content_base64: STANDARD.encode([4u8, 5, 6]),
            timeblock_count: 3,
            active_block_present: true,
        };
        let (base_url, shutdown_tx) = spawn_fake_peer_timeblocks_snapshot_server(
            TimeBlockBackupSqlitePayload {
                version: payload.version,
                file_name: payload.file_name.clone(),
                content_base64: payload.content_base64.clone(),
                timeblock_count: payload.timeblock_count,
                active_block_present: payload.active_block_present,
            },
            Arc::clone(&captured_auth),
        )
        .await;

        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        let state = test_state_with_timeblock_store(timeblock_store);
        let mut peer = make_test_peer("peer-proxy", &base_url);
        peer.auth_token = Some("peer-outbound-secret".to_string());
        state.mesh.upsert_peer(peer);

        let app = test_router(state.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/mesh/peers/peer-proxy/timeblocks/snapshot/sqlite")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let _ = shutdown_tx.send(());

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let proxied: TimeBlockBackupSqlitePayload = serde_json::from_slice(&body).unwrap();
        assert_eq!(proxied.file_name, "peer-timeblocks.sqlite");
        assert_eq!(proxied.timeblock_count, 3);
        assert!(proxied.active_block_present);
        assert_eq!(
            *captured_auth.lock().unwrap(),
            Some("Bearer peer-outbound-secret".to_string())
        );
    }

    #[tokio::test]
    async fn proxy_peer_timeblocks_snapshot_forwards_upstream_error_detail() {
        let (base_url, shutdown_tx) = spawn_fake_peer_timeblocks_error_server().await;

        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        let state = test_state_with_timeblock_store(timeblock_store);
        let mut peer = make_test_peer("peer-proxy-error", &base_url);
        peer.auth_token = Some("peer-outbound-secret".to_string());
        state.mesh.upsert_peer(peer);

        let app = test_router(state.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/mesh/peers/peer-proxy-error/timeblocks/snapshot/sqlite")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let _ = shutdown_tx.send(());

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let error = payload["error"].as_str().unwrap();
        assert!(error.contains("timeblock sqlite snapshot export failed: invalid active block"));
        assert!(error.contains("peer-proxy-error"));
        assert!(error.contains("/mesh/timeblocks/snapshot/sqlite"));
    }

    #[tokio::test]
    async fn timeblock_routes_isolate_profile_id_scope_and_keep_default_anonymous() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks-scoped.sqlite");
        let timeblock_store =
            Arc::new(crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_timeblock_store(timeblock_store.clone()));
        timeblock_store
            .replace_completed(&[TimeBlockData {
                id: "tb-anonymous".to_string(),
                name: "Anonymous block".to_string(),
                start_id: "start-anonymous".to_string(),
                end_id: "end-anonymous".to_string(),
                note: None,
                tags: vec!["focus".to_string()],
                start_time: 1_700_000_000_000,
                end_time: 1_700_000_060_000,
                task_ids: vec![],
                task_status_outcomes: None,
                task_association_log: vec![],
                source_planned_block_id: None,
                block_type: None,
                transitions: vec![],
            }])
            .unwrap();
        timeblock_store
            .replace_completed_scoped(
                Some("profile-a"),
                &[TimeBlockData {
                    id: "tb-profile-a".to_string(),
                    name: "Profile A block".to_string(),
                    start_id: "start-profile-a".to_string(),
                    end_id: "end-profile-a".to_string(),
                    note: Some("scoped".to_string()),
                    tags: vec!["focus".to_string()],
                    start_time: 1_700_000_100_000,
                    end_time: 1_700_000_160_000,
                    task_ids: vec!["task-profile-a".to_string()],
                    task_status_outcomes: Some(std::collections::HashMap::from([(
                        "task-profile-a".to_string(),
                        "continue".to_string(),
                    )])),
                    task_association_log: vec![crate::timeblock::BlockTaskAssociationEvent {
                        block_id: "tb-profile-a".to_string(),
                        task_id: "task-profile-a".to_string(),
                        action: "associated".to_string(),
                        timestamp: 1_700_000_100_000,
                        source: "block_start".to_string(),
                    }],
                    source_planned_block_id: None,
                    block_type: None,
                    transitions: vec![],
                }],
            )
            .unwrap();
        timeblock_store
            .put_active_scoped(
                Some("profile-a"),
                ActiveBlockData {
                    start_id: "active-profile-a".to_string(),
                    name: "Scoped active".to_string(),
                    mode: "countdown".to_string(),
                    target_minutes: Some(25),
                    elapsed: 30_000,
                    updated_at: Some(1_700_000_101_000),
                    phase: Some(BlockPhase::Running),
                    version: Some(1),
                    actor_id: Some("actor-a".to_string()),
                    last_transition_at: Some(1_700_000_101_000),
                    last_resumed_at: Some(1_700_000_101_000),
                    accumulated_run_ms: Some(30_000),
                    start_time: 1_700_000_100_000,
                    action_ended_at: None,
                    feedback_started_at: None,
                    feedback_submitted_at: None,
                    pause_accumulated_ms: Some(0),
                    paused: false,
                    paused_at: None,
                    task_ids: vec!["task-profile-a".to_string()],
                    task_association_log: vec![crate::timeblock::BlockTaskAssociationEvent {
                        block_id: "active-profile-a".to_string(),
                        task_id: "task-profile-a".to_string(),
                        action: "associated".to_string(),
                        timestamp: 1_700_000_100_000,
                        source: "block_start".to_string(),
                    }],
                    source_planned_block_id: None,
                    block_type: None,
                    transitions: vec![],
                    task_id: Some("task-profile-a".to_string()),
                },
            )
            .unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/timeblocks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let anonymous_blocks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/timeblocks?profile_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let profile_a_blocks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/timeblocks/active?profile_id=profile-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let profile_a_active: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(anonymous_blocks.len(), 1);
        assert_eq!(anonymous_blocks[0]["id"], "tb-anonymous");
        assert_eq!(profile_a_blocks.len(), 1);
        assert_eq!(profile_a_blocks[0]["id"], "tb-profile-a");
        assert_eq!(
            profile_a_blocks[0]["taskIds"],
            serde_json::json!(["task-profile-a"])
        );
        assert_eq!(
            profile_a_active["taskIds"],
            serde_json::json!(["task-profile-a"])
        );
        assert!(profile_a_active.get("taskId").is_none());
        assert_eq!(timeblock_store.list_completed().unwrap().len(), 1);
        assert_eq!(
            timeblock_store
                .list_completed_in_scope(Some("profile-a"))
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn timeblock_routes_accept_user_id_alias_for_scoped_queries() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks-user-id-scoped.sqlite");
        let timeblock_store =
            Arc::new(crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_timeblock_store(timeblock_store.clone()));
        timeblock_store
            .replace_completed_scoped(
                Some("user-a"),
                &[TimeBlockData {
                    id: "tb-user-a".to_string(),
                    name: "User A block".to_string(),
                    start_id: "start-user-a".to_string(),
                    end_id: "end-user-a".to_string(),
                    note: None,
                    tags: vec!["focus".to_string()],
                    start_time: 1_700_000_100_000,
                    end_time: 1_700_000_160_000,
                    task_ids: vec!["task-user-a".to_string()],
                    task_status_outcomes: Some(std::collections::HashMap::from([(
                        "task-user-a".to_string(),
                        "continue".to_string(),
                    )])),
                    task_association_log: vec![crate::timeblock::BlockTaskAssociationEvent {
                        block_id: "tb-user-a".to_string(),
                        task_id: "task-user-a".to_string(),
                        action: "associated".to_string(),
                        timestamp: 1_700_000_100_000,
                        source: "block_start".to_string(),
                    }],
                    source_planned_block_id: None,
                    block_type: None,
                    transitions: vec![],
                }],
            )
            .unwrap();
        timeblock_store
            .put_active_scoped(
                Some("user-a"),
                ActiveBlockData {
                    start_id: "active-user-a".to_string(),
                    name: "Scoped active".to_string(),
                    mode: "countdown".to_string(),
                    target_minutes: Some(25),
                    elapsed: 30_000,
                    updated_at: Some(1_700_000_101_000),
                    phase: Some(BlockPhase::Running),
                    version: Some(1),
                    actor_id: Some("actor-a".to_string()),
                    last_transition_at: Some(1_700_000_101_000),
                    last_resumed_at: Some(1_700_000_101_000),
                    accumulated_run_ms: Some(30_000),
                    start_time: 1_700_000_100_000,
                    action_ended_at: None,
                    feedback_started_at: None,
                    feedback_submitted_at: None,
                    pause_accumulated_ms: Some(0),
                    paused: false,
                    paused_at: None,
                    task_ids: vec!["task-user-a".to_string()],
                    task_association_log: vec![crate::timeblock::BlockTaskAssociationEvent {
                        block_id: "active-user-a".to_string(),
                        task_id: "task-user-a".to_string(),
                        action: "associated".to_string(),
                        timestamp: 1_700_000_100_000,
                        source: "block_start".to_string(),
                    }],
                    source_planned_block_id: None,
                    block_type: None,
                    transitions: vec![],
                    task_id: Some("task-user-a".to_string()),
                },
            )
            .unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/timeblocks?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let scoped_blocks: Vec<Value> = serde_json::from_slice(&body).unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/timeblocks/active?user_id=user-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let scoped_active: Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(scoped_blocks.len(), 1);
        assert_eq!(scoped_blocks[0]["id"], "tb-user-a");
        assert_eq!(
            scoped_blocks[0]["taskIds"],
            serde_json::json!(["task-user-a"])
        );
        assert_eq!(scoped_active["taskIds"], serde_json::json!(["task-user-a"]));
        assert!(scoped_active.get("taskId").is_none());
        assert!(
            timeblock_store.list_completed().unwrap().is_empty(),
            "default anonymous scope should stay isolated"
        );
        assert_eq!(
            timeblock_store
                .list_completed_in_scope(Some("user-a"))
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn start_route_writes_block_start_to_eventlog() {
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!(
                "exomind-test-timeblock-start-eventlog-{}",
                uuid::Uuid::new_v4()
            )),
        ));
        let state = test_state_with_timeblock_store_and_eventlog(
            Arc::new(crate::timeblock::TimeBlockStore::new()),
            eventlog_store.clone(),
        );
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/start")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "name": "Morning focus",
                            "mode": "countdown",
                            "targetMinutes": 25,
                            "taskIds": ["task-a"],
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tags, vec!["block_start".to_string()]);
        assert_eq!(
            events[0].metadata.as_ref().unwrap()["block_name"],
            "Morning focus"
        );
        let replication = state
            .signal_pool
            .window()
            .recent(10)
            .into_iter()
            .find(|event| event.topic == "eventlog.replication.appended")
            .expect("timeblock start should publish eventlog.replication.appended");
        assert_eq!(
            replication.payload["scopeKey"],
            serde_json::json!("anonymous")
        );
        assert_eq!(
            replication.payload["record"]["tags"],
            serde_json::json!(["block_start"])
        );
    }

    #[tokio::test]
    async fn stop_then_end_writes_block_end_once_to_eventlog() {
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!(
                "exomind-test-timeblock-put-end-eventlog-{}",
                uuid::Uuid::new_v4()
            )),
        ));
        let state = test_state_with_timeblock_store_and_eventlog(
            Arc::new(crate::timeblock::TimeBlockStore::new()),
            eventlog_store.clone(),
        );
        let task = state.task_store.create(crate::task::CreateTaskInput {
            title: "写周报".to_string(),
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
            .transition(&task.id, crate::task::TaskStatus::InProgress)
            .unwrap();
        let app = test_router(state.clone());

        let start_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/start")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "name": "Morning focus",
                            "mode": "countdown",
                            "targetMinutes": 25,
                            "taskIds": [task.id],
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start_response.status(), StatusCode::OK);

        let stop_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/stop")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stop_response.status(), StatusCode::OK);

        let task_status_outcomes =
            std::collections::HashMap::from([(task.id.clone(), "completed".to_string())]);
        let end_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/end")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "feedback": "done",
                            "taskStatusOutcomes": task_status_outcomes,
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(end_response.status(), StatusCode::OK);

        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event.tags == vec!["block_end".to_string()])
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| event.tags == vec!["block_feedback".to_string()])
                .count(),
            1
        );
        let feedback_event = events
            .iter()
            .find(|event| event.tags == vec!["block_feedback".to_string()])
            .expect("completed block should write block_feedback");
        assert!(feedback_event.content.contains("## Morning focus"));
        assert!(feedback_event.content.contains("### 时刻信息"));
        assert!(feedback_event.content.contains("### 统计信息"));
        assert!(feedback_event.content.contains("### 快速反馈"));
        assert!(feedback_event.content.contains("done"));
        assert!(feedback_event.content.contains("### 任务状态"));
        assert!(feedback_event.content.contains("写周报：已完成"));
        assert!(!feedback_event.content.contains("时间块事件:"));
        let updated_task = state
            .task_store
            .get(&task.id)
            .expect("task should still exist after block end");
        assert_eq!(updated_task.status, crate::task::TaskStatus::Completed);
        let latest_transition = updated_task
            .status_transitions
            .last()
            .expect("block end should append task transition");
        assert_eq!(
            latest_transition.reason,
            crate::task::TaskTransitionReason::TimeblockEnd
        );
        let completed_block = state
            .timeblock_store
            .list_completed()
            .unwrap()
            .into_iter()
            .find(|block| block.task_ids.contains(&task.id))
            .expect("completed block should be stored");
        assert_eq!(
            latest_transition.related_time_block_id.as_deref(),
            Some(completed_block.start_id.as_str())
        );
    }

    #[tokio::test]
    async fn pause_route_writes_block_pause_to_eventlog() {
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!(
                "exomind-test-timeblock-pause-eventlog-{}",
                uuid::Uuid::new_v4()
            )),
        ));
        let state = test_state_with_timeblock_store_and_eventlog(
            Arc::new(crate::timeblock::TimeBlockStore::new()),
            eventlog_store.clone(),
        );
        let task = state.task_store.create(crate::task::CreateTaskInput {
            title: "暂停中的任务".to_string(),
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
            .transition(&task.id, crate::task::TaskStatus::InProgress)
            .unwrap();
        let app = test_router(state.clone());

        let start_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/start")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "name": "Morning focus",
                            "mode": "countdown",
                            "targetMinutes": 25,
                            "taskIds": [task.id],
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start_response.status(), StatusCode::OK);

        let paused_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/pause")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(paused_response.status(), StatusCode::OK);

        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 3);
        assert!(
            events
                .iter()
                .any(|event| event.tags == vec!["block_pause".to_string()])
        );
        assert!(
            events
                .iter()
                .any(|event| event.tags == vec!["task_suspended".to_string()])
        );
        let paused_task = state
            .task_store
            .get(&task.id)
            .expect("pause should keep linked task");
        assert_eq!(paused_task.status, crate::task::TaskStatus::Suspended);
        let latest_transition = paused_task
            .status_transitions
            .last()
            .expect("pause should append task transition");
        assert_eq!(
            latest_transition.reason,
            crate::task::TaskTransitionReason::TimeblockPause
        );
        let active_block = state
            .timeblock_store
            .get_active()
            .unwrap()
            .expect("pause should keep active block");
        assert_eq!(
            latest_transition.related_time_block_id.as_deref(),
            Some(active_block.start_id.as_str())
        );
    }

    #[tokio::test]
    async fn resume_route_only_restores_tasks_auto_suspended_by_last_pause() {
        let state =
            test_state_with_timeblock_store(Arc::new(crate::timeblock::TimeBlockStore::new()));
        let resume_target = state.task_store.create(crate::task::CreateTaskInput {
            title: "自动挂起后恢复".to_string(),
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
            .transition(&resume_target.id, crate::task::TaskStatus::InProgress)
            .unwrap();

        let manual_suspended = state.task_store.create(crate::task::CreateTaskInput {
            title: "手动挂起".to_string(),
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
            .transition(&manual_suspended.id, crate::task::TaskStatus::InProgress)
            .unwrap();
        state
            .task_store
            .transition(&manual_suspended.id, crate::task::TaskStatus::Suspended)
            .unwrap();

        let app = test_router(state.clone());
        let start_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/start")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "name": "Resume focus",
                            "mode": "countup",
                            "taskIds": [resume_target.id, manual_suspended.id],
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start_response.status(), StatusCode::OK);

        let pause_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/pause")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(pause_response.status(), StatusCode::OK);

        let paused_resume_target = state
            .task_store
            .get(&resume_target.id)
            .expect("pause should update in-progress task");
        assert_eq!(
            paused_resume_target.status,
            crate::task::TaskStatus::Suspended
        );
        let pause_ref = paused_resume_target
            .status_transitions
            .last()
            .and_then(|transition| transition.related_time_block_transition_ref.clone())
            .expect("auto-suspended task should keep pause ref");

        let resume_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/resume")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resume_response.status(), StatusCode::OK);

        let resumed_task = state
            .task_store
            .get(&resume_target.id)
            .expect("resume target should still exist");
        assert_eq!(resumed_task.status, crate::task::TaskStatus::InProgress);
        let resumed_transition = resumed_task
            .status_transitions
            .last()
            .expect("resume should append task transition");
        assert_eq!(
            resumed_transition.reason,
            crate::task::TaskTransitionReason::TimeblockResume
        );
        assert_eq!(
            resumed_transition
                .related_time_block_transition_ref
                .as_deref(),
            Some(pause_ref.as_str())
        );

        let still_manual = state
            .task_store
            .get(&manual_suspended.id)
            .expect("manual suspended task should remain");
        assert_eq!(still_manual.status, crate::task::TaskStatus::Suspended);
        assert_eq!(
            still_manual.status_transitions.last().unwrap().reason,
            crate::task::TaskTransitionReason::TaskTransition
        );
    }

    #[tokio::test]
    async fn scoped_completed_timeblock_replication_payload_includes_scope_key() {
        let state =
            test_state_with_timeblock_store(Arc::new(crate::timeblock::TimeBlockStore::new()));
        state
            .timeblock_store
            .put_active_scoped(
                Some("profile-argon"),
                ActiveBlockData {
                    start_id: "active-scoped-1".to_string(),
                    name: "Scoped focus".to_string(),
                    mode: "countdown".to_string(),
                    target_minutes: Some(25),
                    elapsed: 0,
                    updated_at: Some(1_700_000_101_000),
                    phase: Some(BlockPhase::FeedbackInProgress),
                    version: Some(2),
                    actor_id: Some("actor-a".to_string()),
                    last_transition_at: Some(1_700_000_130_000),
                    last_resumed_at: Some(1_700_000_101_000),
                    accumulated_run_ms: Some(1_800_000),
                    start_time: 1_700_000_100_000,
                    action_ended_at: Some(1_700_000_130_000),
                    feedback_started_at: Some(1_700_000_130_000),
                    feedback_submitted_at: None,
                    pause_accumulated_ms: Some(0),
                    paused: false,
                    paused_at: None,
                    task_ids: vec!["task-a".to_string()],
                    task_association_log: vec![],
                    source_planned_block_id: None,
                    block_type: Some("active".to_string()),
                    transitions: vec![],
                    task_id: Some("task-a".to_string()),
                },
            )
            .unwrap();
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/end?user_id=profile-argon")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"feedback":"done"}"#))
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
            .find(|event| event.topic == "timeblock.replication.completed")
            .expect("timeblock end should publish timeblock.replication.completed");

        assert_eq!(
            replication.payload["scopeKey"],
            serde_json::json!("profile-argon")
        );
        assert_eq!(
            replication.payload["cursor"]["kind"],
            serde_json::json!("timeblock_completed")
        );
    }

    #[tokio::test]
    async fn scoped_start_block_publishes_completed_gap_replication_when_replacing_gap() {
        let state =
            test_state_with_timeblock_store(Arc::new(crate::timeblock::TimeBlockStore::new()));
        state
            .timeblock_store
            .put_active_scoped(
                Some("profile-argon"),
                ActiveBlockData {
                    start_id: "gap-scoped-1".to_string(),
                    name: String::new(),
                    mode: "countup".to_string(),
                    target_minutes: None,
                    elapsed: 0,
                    updated_at: Some(1_700_000_101_000),
                    phase: None,
                    version: Some(1),
                    actor_id: Some("actor-gap".to_string()),
                    last_transition_at: Some(1_700_000_101_000),
                    last_resumed_at: None,
                    accumulated_run_ms: None,
                    start_time: 1_700_000_100_000,
                    action_ended_at: None,
                    feedback_started_at: None,
                    feedback_submitted_at: None,
                    pause_accumulated_ms: None,
                    paused: false,
                    paused_at: None,
                    task_ids: vec![],
                    task_association_log: vec![],
                    source_planned_block_id: None,
                    block_type: Some("gap".to_string()),
                    transitions: vec![BlockTransition {
                        transition_type: BlockTransitionType::Start,
                        at: 1_700_000_100_000,
                        actor_id: Some("actor-gap".to_string()),
                    }],
                    task_id: None,
                },
            )
            .unwrap();
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/start?user_id=profile-argon")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"Scoped focus","mode":"countup"}"#))
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
            .find(|event| event.topic == "timeblock.replication.completed")
            .expect("timeblock start should publish completed gap replication");

        assert_eq!(
            replication.payload["scopeKey"],
            serde_json::json!("profile-argon")
        );
        assert_eq!(
            replication.payload["block"]["blockType"],
            serde_json::json!("gap")
        );
        assert_eq!(
            replication.payload["block"]["startId"],
            serde_json::json!("gap-scoped-1")
        );
    }

    #[tokio::test]
    async fn replication_completed_upsert_inserts_scoped_block_and_ignores_duplicate() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks-replication.sqlite");
        let timeblock_store =
            Arc::new(crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
        let state = test_state_with_timeblock_store(timeblock_store.clone());
        let app = test_router(state.clone());

        let payload = serde_json::json!({
            "block": {
                "id": "tb-rep-1",
                "name": "Replicated block",
                "startId": "tb-rep-1",
                "endId": "end-rep-1",
                "note": "done",
                "tags": ["block_feedback"],
                "startTime": 1000,
                "endTime": 2000,
                "blockType": "active",
                "taskIds": [],
                "taskAssociationLog": [],
                "sourcePlannedBlockId": null,
                "transitions": []
            }
        })
        .to_string();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/replication/completed?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.clone()))
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
                event.topic == "timeblock.replication.completed"
                    && event.source == "http:timeblocks/replication"
            })
            .expect("completed replication upsert should publish a local wake");
        assert_eq!(replication.payload["scopeKey"], serde_json::json!("user-a"));
        assert_eq!(
            replication.payload["block"]["startId"],
            serde_json::json!("tb-rep-1")
        );

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/replication/completed?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "ignored");

        let scoped_blocks = timeblock_store
            .list_completed_in_scope(Some("user-a"))
            .unwrap();
        assert_eq!(scoped_blocks.len(), 1);
        assert_eq!(scoped_blocks[0].id, "tb-rep-1");
        assert!(
            timeblock_store.list_completed().unwrap().is_empty(),
            "anonymous scope should remain isolated from replicated scoped timeblocks"
        );
    }

    #[tokio::test]
    async fn describe_route_updates_completed_gap_without_replacing_other_scoped_blocks() {
        let dir = tempdir().unwrap();
        let sqlite_path = dir.path().join("timeblocks-describe-gap.sqlite");
        let timeblock_store =
            Arc::new(crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
        let app = test_router(test_state_with_timeblock_store(timeblock_store.clone()));

        timeblock_store
            .replace_completed_scoped(
                Some("user-a"),
                &[
                    TimeBlockData {
                        id: "gap-1".to_string(),
                        name: String::new(),
                        start_id: "gap-1".to_string(),
                        end_id: "gap-1-end".to_string(),
                        note: None,
                        tags: vec![],
                        start_time: 100,
                        end_time: 200,
                        task_ids: vec![],
                        task_status_outcomes: None,
                        task_association_log: vec![],
                        source_planned_block_id: None,
                        block_type: Some("gap".to_string()),
                        transitions: vec![],
                    },
                    TimeBlockData {
                        id: "tb-1".to_string(),
                        name: "Existing".to_string(),
                        start_id: "tb-1".to_string(),
                        end_id: "tb-1-end".to_string(),
                        note: Some("keep".to_string()),
                        tags: vec!["focus".to_string()],
                        start_time: 300,
                        end_time: 400,
                        task_ids: vec![],
                        task_status_outcomes: None,
                        task_association_log: vec![],
                        source_planned_block_id: None,
                        block_type: Some("active".to_string()),
                        transitions: vec![],
                    },
                ],
            )
            .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/gap-1/describe?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"name":"Recovered gap","note":"retro note"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let updated_gap = timeblock_store
            .get_completed_scoped(Some("user-a"), "gap-1")
            .unwrap()
            .expect("updated gap should exist");
        assert_eq!(updated_gap.name, "Recovered gap");
        assert_eq!(updated_gap.note.as_deref(), Some("retro note"));

        let untouched = timeblock_store
            .get_completed_scoped(Some("user-a"), "tb-1")
            .unwrap()
            .expect("existing completed block should remain");
        assert_eq!(untouched.name, "Existing");
        assert_eq!(untouched.note.as_deref(), Some("keep"));
    }

    #[tokio::test]
    async fn new_route_publishes_timeblock_replication_signals() {
        let state =
            test_state_with_timeblock_store(Arc::new(crate::timeblock::TimeBlockStore::new()));
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/new?user_id=profile-argon")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"blockType":"active","name":"Raw block","mode":"countup"}"#,
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
                event.topic == "timeblock.replication.active_upserted"
                    && event.source == "http:timeblocks"
            })
            .expect("raw new route should publish active replication wake");
        assert_eq!(
            replication.payload["scopeKey"],
            serde_json::json!("profile-argon")
        );
        assert_eq!(
            replication.payload["active"]["name"],
            serde_json::json!("Raw block")
        );
    }

    #[tokio::test]
    async fn new_route_applies_task_status_outcomes_when_ending_current_block() {
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        let state = test_state_with_timeblock_store(timeblock_store.clone());
        let task = state.task_store.create_scoped(
            Some("profile-argon"),
            crate::task::CreateTaskInput {
                title: "block task".to_string(),
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
        state
            .task_store
            .transition_scoped(
                Some("profile-argon"),
                &task.id,
                crate::task::TaskStatus::InProgress,
            )
            .unwrap();
        timeblock_store
            .put_active_scoped(
                Some("profile-argon"),
                ActiveBlockData {
                    start_id: "tb-live-1".to_string(),
                    name: "Live block".to_string(),
                    mode: "countup".to_string(),
                    target_minutes: None,
                    block_type: Some("active".to_string()),
                    elapsed: 0,
                    updated_at: Some(100),
                    phase: Some(BlockPhase::Running),
                    version: Some(1),
                    actor_id: Some("actor-a".to_string()),
                    last_transition_at: Some(100),
                    last_resumed_at: Some(100),
                    accumulated_run_ms: Some(0),
                    start_time: 100,
                    action_ended_at: None,
                    feedback_started_at: None,
                    feedback_submitted_at: None,
                    pause_accumulated_ms: Some(0),
                    paused: false,
                    paused_at: None,
                    task_ids: vec![task.id.clone()],
                    task_association_log: vec![],
                    source_planned_block_id: None,
                    transitions: vec![BlockTransition {
                        transition_type: BlockTransitionType::Start,
                        at: 100,
                        actor_id: Some("actor-a".to_string()),
                    }],
                    task_id: None,
                },
            )
            .unwrap();
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/new?user_id=profile-argon")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"blockType":"gap","taskStatusOutcomes":{{"{}":"completed"}}}}"#,
                        task.id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let stored = state
            .task_store
            .get_scoped(Some("profile-argon"), &task.id)
            .expect("task should exist");
        assert_eq!(stored.status, crate::task::TaskStatus::Completed);
    }

    #[tokio::test]
    async fn start_route_replaces_transition_completed_active_without_legacy_feedback_fields() {
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        timeblock_store
            .put_active(ActiveBlockData {
                start_id: "completed-active-1".to_string(),
                name: "Finished by transitions".to_string(),
                mode: "countdown".to_string(),
                target_minutes: Some(25),
                block_type: Some("active".to_string()),
                elapsed: 0,
                updated_at: Some(1_700_000_003_000),
                phase: None,
                version: Some(3),
                actor_id: Some("actor-a".to_string()),
                last_transition_at: Some(1_700_000_003_000),
                last_resumed_at: Some(1_700_000_000_000),
                accumulated_run_ms: Some(1_800_000),
                start_time: 1_700_000_000_000,
                action_ended_at: None,
                feedback_started_at: None,
                feedback_submitted_at: None,
                pause_accumulated_ms: Some(0),
                paused: false,
                paused_at: None,
                task_ids: vec![],
                task_association_log: vec![],
                source_planned_block_id: None,
                transitions: vec![
                    BlockTransition {
                        transition_type: BlockTransitionType::Start,
                        at: 1_700_000_000_000,
                        actor_id: Some("actor-a".to_string()),
                    },
                    BlockTransition {
                        transition_type: BlockTransitionType::FeedbackStart,
                        at: 1_700_000_001_000,
                        actor_id: Some("actor-a".to_string()),
                    },
                    BlockTransition {
                        transition_type: BlockTransitionType::End,
                        at: 1_700_000_003_000,
                        actor_id: Some("actor-a".to_string()),
                    },
                ],
                task_id: None,
            })
            .unwrap();
        let app = test_router(test_state_with_timeblock_store(timeblock_store.clone()));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/start")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"name":"Next block","mode":"countdown","targetMinutes":25,"taskIds":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let completed = timeblock_store.list_completed().unwrap();
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].start_id, "completed-active-1");
        let active = timeblock_store
            .get_active()
            .unwrap()
            .expect("replacement active");
        assert_ne!(active.start_id, "completed-active-1");
        assert_eq!(active.name, "Next block");
    }

    #[tokio::test]
    async fn pause_route_rejects_transition_feedback_phase_without_legacy_feedback_fields() {
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        timeblock_store
            .put_active(ActiveBlockData {
                start_id: "feedback-active-1".to_string(),
                name: "Feedback only transitions".to_string(),
                mode: "countdown".to_string(),
                target_minutes: Some(25),
                block_type: Some("active".to_string()),
                elapsed: 0,
                updated_at: Some(1_700_000_002_000),
                phase: None,
                version: Some(2),
                actor_id: Some("actor-a".to_string()),
                last_transition_at: Some(1_700_000_002_000),
                last_resumed_at: Some(1_700_000_000_000),
                accumulated_run_ms: Some(1_200_000),
                start_time: 1_700_000_000_000,
                action_ended_at: None,
                feedback_started_at: None,
                feedback_submitted_at: None,
                pause_accumulated_ms: Some(0),
                paused: false,
                paused_at: None,
                task_ids: vec![],
                task_association_log: vec![],
                source_planned_block_id: None,
                transitions: vec![
                    BlockTransition {
                        transition_type: BlockTransitionType::Start,
                        at: 1_700_000_000_000,
                        actor_id: Some("actor-a".to_string()),
                    },
                    BlockTransition {
                        transition_type: BlockTransitionType::FeedbackStart,
                        at: 1_700_000_002_000,
                        actor_id: Some("actor-a".to_string()),
                    },
                ],
                task_id: None,
            })
            .unwrap();
        let app = test_router(test_state_with_timeblock_store(timeblock_store));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/pause")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let error: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(error["error"], "cannot pause: block is in feedback phase");
    }

    #[test]
    fn merge_import_keeps_newer_existing_active_block() {
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        let existing = ActiveBlockData {
            start_id: "active-existing".to_string(),
            name: "Existing active".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            block_type: Some("active".to_string()),
            elapsed: 0,
            updated_at: Some(3_000),
            phase: Some(BlockPhase::Running),
            version: Some(3),
            actor_id: Some("actor-b".to_string()),
            last_transition_at: Some(3_000),
            last_resumed_at: Some(1_000),
            accumulated_run_ms: Some(2_000),
            start_time: 1_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec![],
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![BlockTransition {
                transition_type: BlockTransitionType::Start,
                at: 1_000,
                actor_id: Some("actor-b".to_string()),
            }],
            task_id: None,
        };
        let imported = ActiveBlockData {
            start_id: "active-existing".to_string(),
            name: "Imported older active".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            block_type: Some("active".to_string()),
            elapsed: 0,
            updated_at: Some(2_000),
            phase: Some(BlockPhase::Running),
            version: Some(2),
            actor_id: Some("actor-a".to_string()),
            last_transition_at: Some(2_000),
            last_resumed_at: Some(1_000),
            accumulated_run_ms: Some(1_000),
            start_time: 1_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec![],
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![BlockTransition {
                transition_type: BlockTransitionType::Start,
                at: 1_000,
                actor_id: Some("actor-a".to_string()),
            }],
            task_id: None,
        };
        timeblock_store.put_active(existing.clone()).unwrap();
        let state = test_state_with_timeblock_store(timeblock_store.clone());

        let result = apply_timeblock_import(
            &state,
            None,
            vec![],
            Some(imported),
            TimeBlockImportStrategy::Merge,
        )
        .unwrap();

        assert!(!result.active_block_updated);
        let active = timeblock_store.get_active().unwrap().expect("active block");
        assert_eq!(active.name, existing.name);
        assert_eq!(active.version, existing.version);
        assert_eq!(active.actor_id, existing.actor_id);
    }

    #[test]
    fn merge_import_prefers_higher_phase_active_block() {
        let timeblock_store = Arc::new(crate::timeblock::TimeBlockStore::new());
        let existing = ActiveBlockData {
            start_id: "active-phase".to_string(),
            name: "Running active".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            block_type: Some("active".to_string()),
            elapsed: 0,
            updated_at: Some(3_000),
            phase: Some(BlockPhase::Running),
            version: Some(3),
            actor_id: Some("actor-a".to_string()),
            last_transition_at: Some(3_000),
            last_resumed_at: Some(1_000),
            accumulated_run_ms: Some(2_000),
            start_time: 1_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec![],
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![BlockTransition {
                transition_type: BlockTransitionType::Start,
                at: 1_000,
                actor_id: Some("actor-a".to_string()),
            }],
            task_id: None,
        };
        let imported = ActiveBlockData {
            start_id: "active-phase".to_string(),
            name: "Feedback active".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            block_type: Some("active".to_string()),
            elapsed: 0,
            updated_at: Some(3_000),
            phase: Some(BlockPhase::FeedbackInProgress),
            version: Some(3),
            actor_id: Some("actor-b".to_string()),
            last_transition_at: Some(3_500),
            last_resumed_at: Some(1_000),
            accumulated_run_ms: Some(2_000),
            start_time: 1_000,
            action_ended_at: Some(3_500),
            feedback_started_at: Some(3_500),
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec![],
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![
                BlockTransition {
                    transition_type: BlockTransitionType::Start,
                    at: 1_000,
                    actor_id: Some("actor-b".to_string()),
                },
                BlockTransition {
                    transition_type: BlockTransitionType::FeedbackStart,
                    at: 3_500,
                    actor_id: Some("actor-b".to_string()),
                },
            ],
            task_id: None,
        };
        timeblock_store.put_active(existing).unwrap();
        let state = test_state_with_timeblock_store(timeblock_store.clone());

        let result = apply_timeblock_import(
            &state,
            None,
            vec![],
            Some(imported.clone()),
            TimeBlockImportStrategy::Merge,
        )
        .unwrap();

        assert!(result.active_block_updated);
        let active = timeblock_store.get_active().unwrap().expect("active block");
        assert_eq!(active.name, imported.name);
        assert_eq!(active.version, imported.version);
        assert_eq!(active.feedback_started_at, imported.feedback_started_at);
    }
}
