use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::timeblock::{ActiveBlockData, TimeBlockData, TimeBlockStore};

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
struct ErrorResponse {
    error: String,
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
        Json(ErrorResponse { error: message.into() }),
    )
}

// ── #759 newBlock primitive ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewBlockRequest {
    /// Required: the blockType of the NEW block to create ("active" or "gap")
    block_type: String,
    // Fields for creating active blocks
    name: Option<String>,
    mode: Option<String>,
    target_minutes: Option<u64>,
    task_ids: Option<Vec<String>>,
    source_planned_block_id: Option<String>,
    // Fields for completing the old block (when ending active → gap)
    feedback: Option<String>,
    task_status_outcomes: Option<std::collections::HashMap<String, String>>,
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

fn default_mode() -> String { "countup".to_string() }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndBlockRequest {
    feedback: Option<String>,
    task_status_outcomes: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewBlockResponse {
    completed: Option<TimeBlockData>,
    active: ActiveBlockData,
}

/// Internal: atomic newBlock — ends old block + creates new block of specified type.
/// No state validation. Callers (start/end guards or POST /timeblocks/new) are responsible.
fn do_new_block(
    store: &TimeBlockStore,
    scope_key: Option<&str>,
    req: &NewBlockRequest,
) -> Result<NewBlockResponse, (StatusCode, Json<ErrorResponse>)> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
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
            tags: if active.block_type.as_deref() == Some("gap") { vec![] } else { vec!["block_feedback".to_string()] },
            start_time: active.start_time,
            end_time: now,
            block_type: active.block_type.clone(),
            task_ids: active.task_ids.clone(),
            task_status_outcomes: req.task_status_outcomes.clone(),
            task_association_log: active.task_association_log.clone(),
            source_planned_block_id: active.source_planned_block_id.clone(),
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
        name: if is_gap { String::new() } else { req.name.clone().unwrap_or_default() },
        mode: if is_gap { "countup".to_string() } else { req.mode.clone().unwrap_or_else(|| "countup".to_string()) },
        target_minutes: if is_gap { None } else { req.target_minutes },
        block_type: Some(req.block_type.clone()),
        elapsed: if !is_gap && req.mode.as_deref() == Some("countdown") {
            req.target_minutes.unwrap_or(25) * 60 * 1000
        } else { 0 },
        updated_at: Some(now),
        phase: if is_gap { None } else { Some("running".to_string()) },
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
        task_ids: if is_gap { vec![] } else { req.task_ids.clone().unwrap_or_default() },
        task_association_log: vec![],
        source_planned_block_id: if is_gap { None } else { req.source_planned_block_id.clone() },
        task_id: None,
    };

    store
        .put_active_scoped(scope_key, new_active.clone())
        .map_err(|e| internal_error(e.to_string()))?;

    Ok(NewBlockResponse { completed, active: new_active })
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
    if let Some(current) = state.timeblock_store.get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))? {
        if current.block_type.as_deref() != Some("gap")
            && current.feedback_submitted_at.is_none() {
            return Err(conflict("cannot start: active block in progress"));
        }
    }

    do_new_block(&state.timeblock_store, scope_key, &NewBlockRequest {
        block_type: "active".to_string(),
        name: Some(payload.name),
        mode: Some(payload.mode),
        target_minutes: payload.target_minutes,
        task_ids: Some(payload.task_ids),
        source_planned_block_id: payload.source_planned_block_id,
        feedback: None,
        task_status_outcomes: None,
    }).map(Json)
}

/// POST /timeblocks/end — guard: current must be active. Creates gap.
async fn end_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<EndBlockRequest>,
) -> Result<Json<NewBlockResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());

    // Guard: reject if current block is gap (or empty)
    let current = state.timeblock_store.get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| conflict("cannot end: no active block"))?;

    if current.block_type.as_deref() == Some("gap") {
        return Err(conflict("cannot end: current block is a gap"));
    }

    do_new_block(&state.timeblock_store, scope_key, &NewBlockRequest {
        block_type: "gap".to_string(),
        name: None,
        mode: None,
        target_minutes: None,
        task_ids: None,
        source_planned_block_id: None,
        feedback: payload.feedback,
        task_status_outcomes: payload.task_status_outcomes,
    }).map(Json)
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
    if let Some(mut active) = state.timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))? {
        if active.start_id == *block_id {
            if let Some(name) = payload.name {
                active.name = name;
            }
            // Active blocks don't have note field — skip silently
            state.timeblock_store
                .put_active_scoped(scope_key, active.clone())
                .map_err(|e| internal_error(e.to_string()))?;
            return Ok(Json(serde_json::json!({ "updated": "active", "blockId": block_id })));
        }
    }

    // Try completed blocks
    let mut blocks = state.timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?;

    let idx = blocks.iter().position(|b| b.id == *block_id);
    match idx {
        None => Err(conflict(format!("block not found: {block_id}"))),
        Some(i) => {
            let block = &blocks[i];
            // Immutability: completed active blocks cannot be modified
            if block.block_type.as_deref() != Some("gap") {
                return Err(conflict("cannot describe: completed active blocks are immutable"));
            }
            // Gap block: allow describe (retroactive naming)
            if let Some(name) = payload.name {
                blocks[i].name = name;
            }
            if let Some(note) = payload.note {
                blocks[i].note = Some(note);
            }
            state.timeblock_store
                .replace_completed_scoped(scope_key, &blocks)
                .map_err(|e| internal_error(e.to_string()))?;
            Ok(Json(serde_json::json!({ "updated": "completed_gap", "blockId": block_id })))
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
        Some(bt) => blocks.into_iter().filter(|b| b.block_type.as_deref() == Some(bt)).collect(),
        None => blocks,
    };
    Ok(Json(filtered))
}

async fn replace_timeblocks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<Vec<TimeBlockData>>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    state
        .timeblock_store
        .replace_completed_scoped(scope_key, &payload)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
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

async fn put_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<ActiveBlockData>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let normalized = payload.normalize_task_ids();
    let existing_active = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let is_new_block = existing_active
        .as_ref()
        .map(|block| block.start_id != normalized.start_id)
        .unwrap_or(true);

    state
        .timeblock_store
        .put_active_scoped(scope_key, normalized.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    if is_new_block {
        write_timeblock_eventlog(
            &state,
            scope_key,
            "block_start",
            &normalized.name,
            &normalized.start_id,
            &normalized.task_ids,
        );
    } else if let Some(existing) = existing_active.as_ref() {
        if !is_timeblock_ended(existing) && is_timeblock_ended(&normalized) {
            write_timeblock_eventlog(
                &state,
                scope_key,
                "block_end",
                &normalized.name,
                &normalized.start_id,
                &normalized.task_ids,
            );
        } else if !existing.paused && normalized.paused {
            write_timeblock_eventlog(
                &state,
                scope_key,
                "block_pause",
                &normalized.name,
                &normalized.start_id,
                &normalized.task_ids,
            );
        } else if existing.paused && !normalized.paused {
            write_timeblock_eventlog(
                &state,
                scope_key,
                "block_resume",
                &normalized.name,
                &normalized.start_id,
                &normalized.task_ids,
            );
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let active = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    state
        .timeblock_store
        .delete_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    if let Some(block) = active {
        if is_timeblock_ended(&block) {
            return Ok(StatusCode::NO_CONTENT);
        }
        write_timeblock_eventlog(
            &state,
            scope_key,
            "block_end",
            &block.name,
            &block.start_id,
            &block.task_ids,
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

fn is_timeblock_ended(block: &ActiveBlockData) -> bool {
    matches!(
        block.phase.as_deref(),
        Some("action_ended" | "feedback_in_progress" | "feedback_submitted")
    ) || block.action_ended_at.is_some()
        || block.feedback_started_at.is_some()
        || block.feedback_submitted_at.is_some()
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
        TimeBlockImportStrategy::Merge => imported_active_block.or(existing_active_block),
    };

    let active_block_updated = next_active_block.is_some();
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

fn write_timeblock_eventlog(
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

    if let Err(error) = state.eventlog_store.append_event(scope_key, event) {
        tracing::warn!(error = %error, "failed to write timeblock eventlog");
    }
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
        .route("/timeblocks", get(list_timeblocks).put(replace_timeblocks))
        .route("/timeblocks/new", post(new_block))
        .route("/timeblocks/start", post(start_block))
        .route("/timeblocks/end", post(end_block))
        .route("/timeblocks/:block_id/describe", post(describe_block))
        .route(
            "/timeblocks/active",
            get(get_active_timeblock)
                .put(put_active_timeblock)
                .delete(delete_active_timeblock),
        )
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
                std::env::temp_dir().join(format!(
                    "exomind-test-timeblocks-{}",
                    uuid::Uuid::new_v4()
                )),
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
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            session_store: Arc::new(crate::session::SessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx: {
                let (tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
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

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&vec![TimeBlockData {
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
                        }])
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&vec![TimeBlockData {
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
                            task_association_log: vec![
                                crate::timeblock::BlockTaskAssociationEvent {
                                    block_id: "tb-profile-a".to_string(),
                                    task_id: "task-profile-a".to_string(),
                                    action: "associated".to_string(),
                                    timestamp: 1_700_000_100_000,
                                    source: "block_start".to_string(),
                                },
                            ],
                            source_planned_block_id: None,
                    block_type: None,
                        }])
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active?profile_id=profile-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
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
                            task_association_log: vec![
                                crate::timeblock::BlockTaskAssociationEvent {
                                    block_id: "active-profile-a".to_string(),
                                    task_id: "task-profile-a".to_string(),
                                    action: "associated".to_string(),
                                    timestamp: 1_700_000_100_000,
                                    source: "block_start".to_string(),
                                },
                            ],
                            source_planned_block_id: None,
                    block_type: None,
                            task_id: Some("task-profile-a".to_string()),
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

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

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&vec![TimeBlockData {
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
                            task_association_log: vec![
                                crate::timeblock::BlockTaskAssociationEvent {
                                    block_id: "tb-user-a".to_string(),
                                    task_id: "task-user-a".to_string(),
                                    action: "associated".to_string(),
                                    timestamp: 1_700_000_100_000,
                                    source: "block_start".to_string(),
                                },
                            ],
                            source_planned_block_id: None,
                    block_type: None,
                        }])
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active?user_id=user-a")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
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
                            task_association_log: vec![
                                crate::timeblock::BlockTaskAssociationEvent {
                                    block_id: "active-user-a".to_string(),
                                    task_id: "task-user-a".to_string(),
                                    action: "associated".to_string(),
                                    timestamp: 1_700_000_100_000,
                                    source: "block_start".to_string(),
                                },
                            ],
                            source_planned_block_id: None,
                    block_type: None,
                            task_id: Some("task-user-a".to_string()),
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

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
    async fn put_active_writes_block_start_to_eventlog() {
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
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
                            start_id: "active-1".to_string(),
                            name: "Morning focus".to_string(),
                            mode: "countdown".to_string(),
                            target_minutes: Some(25),
                            elapsed: 0,
                            updated_at: Some(1_700_000_101_000),
                            phase: Some("running".to_string()),
                            version: Some(1),
                            actor_id: Some("actor-a".to_string()),
                            last_transition_at: Some(1_700_000_101_000),
                            last_resumed_at: Some(1_700_000_101_000),
                            accumulated_run_ms: Some(0),
                            start_time: 1_700_000_100_000,
                            action_ended_at: None,
                            feedback_started_at: None,
                            feedback_submitted_at: None,
                            pause_accumulated_ms: Some(0),
                            paused: false,
                            paused_at: None,
                            task_ids: vec!["task-a".to_string()],
                            task_association_log: vec![],
                            source_planned_block_id: None,
                    block_type: None,
                            task_id: Some("task-a".to_string()),
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tags, vec!["block_start".to_string()]);
        assert_eq!(events[0].metadata.as_ref().unwrap()["block_name"], "Morning focus");
    }

    #[tokio::test]
    async fn delete_active_writes_block_end_to_eventlog() {
        let eventlog_store = Arc::new(crate::eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!(
                "exomind-test-timeblock-end-eventlog-{}",
                uuid::Uuid::new_v4()
            )),
        ));
        let state = test_state_with_timeblock_store_and_eventlog(
            Arc::new(crate::timeblock::TimeBlockStore::new()),
            eventlog_store.clone(),
        );
        let app = test_router(state);

        let put_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
                            start_id: "active-1".to_string(),
                            name: "Morning focus".to_string(),
                            mode: "countdown".to_string(),
                            target_minutes: Some(25),
                            elapsed: 0,
                            updated_at: Some(1_700_000_101_000),
                            phase: Some("running".to_string()),
                            version: Some(1),
                            actor_id: Some("actor-a".to_string()),
                            last_transition_at: Some(1_700_000_101_000),
                            last_resumed_at: Some(1_700_000_101_000),
                            accumulated_run_ms: Some(0),
                            start_time: 1_700_000_100_000,
                            action_ended_at: None,
                            feedback_started_at: None,
                            feedback_submitted_at: None,
                            pause_accumulated_ms: Some(0),
                            paused: false,
                            paused_at: None,
                            task_ids: vec!["task-a".to_string()],
                            task_association_log: vec![],
                            source_planned_block_id: None,
                    block_type: None,
                            task_id: Some("task-a".to_string()),
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_response.status(), StatusCode::NO_CONTENT);

        let delete_response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/timeblocks/active")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().any(|event| event.tags == vec!["block_start".to_string()]));
        assert!(events.iter().any(|event| event.tags == vec!["block_end".to_string()]));
    }

    #[tokio::test]
    async fn put_active_feedback_transition_writes_block_end_once_to_eventlog() {
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

        let active = ActiveBlockData {
            start_id: "active-1".to_string(),
            name: "Morning focus".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            elapsed: 0,
            updated_at: Some(1_700_000_101_000),
            phase: Some("running".to_string()),
            version: Some(1),
            actor_id: Some("actor-a".to_string()),
            last_transition_at: Some(1_700_000_101_000),
            last_resumed_at: Some(1_700_000_101_000),
            accumulated_run_ms: Some(0),
            start_time: 1_700_000_100_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec!["task-a".to_string()],
            task_association_log: vec![],
            source_planned_block_id: None,
                    block_type: None,
            task_id: Some("task-a".to_string()),
        };

        let put_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&active).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_response.status(), StatusCode::NO_CONTENT);

        let feedback_in_progress_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
                            phase: Some("feedback_in_progress".to_string()),
                            version: Some(2),
                            action_ended_at: Some(1_700_000_130_000),
                            feedback_started_at: Some(1_700_000_130_000),
                            accumulated_run_ms: Some(1_800_000),
                            last_transition_at: Some(1_700_000_130_000),
                            last_resumed_at: None,
                            paused: false,
                            paused_at: None,
                            updated_at: Some(1_700_000_130_000),
                            ..active.clone()
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(feedback_in_progress_response.status(), StatusCode::NO_CONTENT);

        let feedback_submitted_response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
                            phase: Some("feedback_submitted".to_string()),
                            version: Some(3),
                            action_ended_at: Some(1_700_000_130_000),
                            feedback_started_at: Some(1_700_000_130_000),
                            feedback_submitted_at: Some(1_700_000_150_000),
                            accumulated_run_ms: Some(1_800_000),
                            last_transition_at: Some(1_700_000_150_000),
                            last_resumed_at: None,
                            paused: false,
                            paused_at: None,
                            updated_at: Some(1_700_000_150_000),
                            ..active
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(feedback_submitted_response.status(), StatusCode::NO_CONTENT);

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
    async fn put_active_pause_writes_block_pause_to_eventlog() {
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

        let active = ActiveBlockData {
            start_id: "active-1".to_string(),
            name: "Morning focus".to_string(),
            mode: "countdown".to_string(),
            target_minutes: Some(25),
            elapsed: 0,
            updated_at: Some(1_700_000_101_000),
            phase: Some("running".to_string()),
            version: Some(1),
            actor_id: Some("actor-a".to_string()),
            last_transition_at: Some(1_700_000_101_000),
            last_resumed_at: Some(1_700_000_101_000),
            accumulated_run_ms: Some(0),
            start_time: 1_700_000_100_000,
            action_ended_at: None,
            feedback_started_at: None,
            feedback_submitted_at: None,
            pause_accumulated_ms: Some(0),
            paused: false,
            paused_at: None,
            task_ids: vec!["task-a".to_string()],
            task_association_log: vec![],
            source_planned_block_id: None,
                    block_type: None,
            task_id: Some("task-a".to_string()),
        };

        let put_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&active).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put_response.status(), StatusCode::NO_CONTENT);

        let paused_response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/timeblocks/active")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ActiveBlockData {
                            paused: true,
                            paused_at: Some(1_700_000_102_000),
                            ..active
                        })
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(paused_response.status(), StatusCode::NO_CONTENT);

        let events = eventlog_store.list_events(None).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events.iter().any(|event| event.tags == vec!["block_pause".to_string()]));
    }
}
