use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::signal::types::SignalEvent;
use crate::timeblock::{
    ActiveBlockData, BlockTaskAssociationEvent, BlockTransition, BlockTransitionType,
    TimeBlockData, TimeBlockStore,
};

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

#[derive(Debug, Serialize)]
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

async fn publish_completed_timeblock_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    block: &TimeBlockData,
) {
    let signal = SignalEvent {
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
    };

    state.signal_pool.publish(signal.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.forward_event_to_peers(signal).await;
    }
}

async fn publish_active_timeblock_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    active: &ActiveBlockData,
) {
    let signal = SignalEvent {
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
    };

    state.signal_pool.publish(signal.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.forward_event_to_peers(signal).await;
    }
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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock error")
        .as_millis() as u64;

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

        let mut blocks = store
            .list_completed_scoped(scope_key)
            .map_err(|e| internal_error(e.to_string()))?;
        blocks.push(completed_block.clone());
        store
            .replace_completed_scoped(scope_key, &blocks)
            .map_err(|e| internal_error(e.to_string()))?;

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
            Some("running".to_string())
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
    do_new_block(&state.timeblock_store, scope_key, &payload).map(Json)
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

    let result = do_new_block(
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
    )?;

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
    if let Some(ref completed) = result.completed {
        publish_completed_timeblock_replication_signal(&state, scope_key, completed).await;
    }
    publish_active_timeblock_replication_signal(&state, scope_key, &result.active).await;

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

    let result = do_new_block(
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
    )?;

    // Transition → EventLog linkage: write block_feedback for the completed active block
    // Gap block creation does NOT write EventLog (per #759 design)
    if let Some(ref completed) = result.completed {
        write_timeblock_eventlog(
            &state,
            scope_key,
            "block_feedback",
            &completed.name,
            &completed.start_id,
            &completed.task_ids,
        )
        .await;
        publish_completed_timeblock_replication_signal(&state, scope_key, completed).await;
    }
    publish_active_timeblock_replication_signal(&state, scope_key, &result.active).await;

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

    let mut merged = blocks;
    merged.extend(gaps.iter().cloned());
    merged.sort_by_key(|block| block.start_time);

    state
        .timeblock_store
        .replace_completed_scoped(scope_key, &merged)
        .map_err(|error| internal_error(error.to_string()))?;

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
    let mut blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?;

    if blocks
        .iter()
        .any(|existing| existing.start_id == payload.block.start_id)
    {
        return Ok(Json(CompletedReplicationResponse { status: "ignored" }));
    }

    blocks.push(payload.block);
    state
        .timeblock_store
        .replace_completed_scoped(scope_key, &blocks)
        .map_err(|e| internal_error(e.to_string()))?;

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
    updated.phase = Some("feedback_in_progress".to_string());
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

    write_timeblock_eventlog(&state, scope_key, "block_end", &name, &start_id, &task_ids).await;
    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        publish_active_timeblock_replication_signal(&state, scope_key, &active).await;
    }

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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock error")
        .as_millis() as u64;

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
    updated.phase = Some("paused".to_string());
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

    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_pause",
        &name,
        &start_id,
        &task_ids,
    )
    .await;
    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        publish_active_timeblock_replication_signal(&state, scope_key, &active).await;
    }

    Ok(Json(serde_json::json!({ "status": "paused" })))
}

/// POST /timeblocks/resume — resume the current paused block
async fn resume_block(
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
        .ok_or_else(|| conflict("cannot resume: no active block"))?;

    if current.is_gap() {
        return Err(conflict("cannot resume: current block is a gap"));
    }
    if !current.is_paused_state() {
        return Err(conflict("cannot resume: not paused"));
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
    updated.phase = Some("running".to_string());
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

    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_resume",
        &name,
        &start_id,
        &task_ids,
    )
    .await;
    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
    {
        publish_active_timeblock_replication_signal(&state, scope_key, &active).await;
    }

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
    publish_active_timeblock_replication_signal(&state, scope_key, &updated).await;

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
        publish_active_timeblock_replication_signal(&state, scope_key, &active).await;
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
            publish_active_timeblock_replication_signal(&state, scope_key, &active).await;
            return Ok(Json(
                serde_json::json!({ "updated": "active", "blockId": block_id }),
            ));
        }
    }

    // Try completed blocks
    let mut blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?;

    let idx = blocks.iter().position(|b| b.id == *block_id);
    match idx {
        None => Err(conflict(format!("block not found: {block_id}"))),
        Some(i) => {
            let block = &blocks[i];
            // Immutability: completed active blocks cannot be modified
            if block.block_type.as_deref() != Some("gap") {
                return Err(conflict(
                    "cannot describe: completed active blocks are immutable",
                ));
            }
            // Gap block: allow describe (retroactive naming)
            if let Some(name) = payload.name {
                blocks[i].name = name;
            }
            if let Some(note) = payload.note {
                blocks[i].note = Some(note);
            }
            state
                .timeblock_store
                .replace_completed_scoped(scope_key, &blocks)
                .map_err(|e| internal_error(e.to_string()))?;
            Ok(Json(
                serde_json::json!({ "updated": "completed_gap", "blockId": block_id }),
            ))
        }
    }
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

fn should_accept_imported_active_block(existing: &ActiveBlockData, incoming: &ActiveBlockData) -> bool {
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
        "block_end" => format!("时间块结束: {block_name}"),
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

    if let Err(error) = state.eventlog_store.append_event(scope_key, event.clone()) {
        tracing::warn!(error = %error, "failed to write timeblock eventlog");
        return;
    }

    crate::routes::eventlog::publish_eventlog_replication_append(state, scope_key, &event).await;
}

fn build_timeblocks_sqlite_snapshot_bytes(
    state: &AppState,
    scope_key: Option<&str>,
    time_blocks: &[TimeBlockData],
) -> Result<Vec<u8>, crate::timeblock::TimeBlockStoreError> {
    let temp_root = std::env::temp_dir().join(format!(
        "exomind-timeblocks-export-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_root)?;
    let sqlite_path = temp_root.join("timeblocks-export.sqlite");
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
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok(bytes)
}

fn read_timeblocks_from_sqlite_snapshot(
    bytes: &[u8],
    scope_key: Option<&str>,
) -> Result<(Vec<TimeBlockData>, Option<ActiveBlockData>), crate::timeblock::TimeBlockStoreError> {
    let temp_root = std::env::temp_dir().join(format!(
        "exomind-timeblocks-import-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_root)?;
    let sqlite_path = temp_root.join("timeblocks-import.sqlite");
    std::fs::write(&sqlite_path, bytes)?;
    let store = crate::timeblock::TimeBlockStore::with_sqlite_path(&sqlite_path)?;
    let time_blocks = store.list_completed_scoped(scope_key)?;
    let active_block = store.get_active_scoped(scope_key)?;
    let _ = std::fs::remove_file(&sqlite_path);
    let _ = std::fs::remove_dir_all(&temp_root);
    Ok((time_blocks, active_block))
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use crate::timeblock::{ActiveBlockData, BlockTransition, BlockTransitionType};
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
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
                    phase: Some("running".to_string()),
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
                    phase: Some("running".to_string()),
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
        let app = test_router(state);

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
                            "taskIds": ["task-a"],
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

        let end_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/timeblocks/end")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "feedback": "done",
                            "taskStatusOutcomes": {
                                "task-a": "completed"
                            }
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
        let app = test_router(state);

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
                            "taskIds": ["task-a"],
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
        assert_eq!(events.len(), 2);
        assert!(
            events
                .iter()
                .any(|event| event.tags == vec!["block_pause".to_string()])
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
                    phase: Some("feedback_in_progress".to_string()),
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
        let app = test_router(test_state_with_timeblock_store(timeblock_store.clone()));

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
            phase: Some("running".to_string()),
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
            phase: Some("running".to_string()),
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

        let result =
            apply_timeblock_import(&state, None, vec![], Some(imported), TimeBlockImportStrategy::Merge)
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
            phase: Some("running".to_string()),
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
            phase: Some("feedback_in_progress".to_string()),
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

        let result =
            apply_timeblock_import(&state, None, vec![], Some(imported.clone()), TimeBlockImportStrategy::Merge)
                .unwrap();

        assert!(result.active_block_updated);
        let active = timeblock_store.get_active().unwrap().expect("active block");
        assert_eq!(active.name, imported.name);
        assert_eq!(active.version, imported.version);
        assert_eq!(active.feedback_started_at, imported.feedback_started_at);
    }
}
