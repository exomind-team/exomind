use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::timeblock::{
    ActiveBlockData, BlockTaskAssociationEvent, PlannedTimeBlockData, PlannedTimeBlockType,
};

#[derive(Debug, Deserialize)]
struct ScopeQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TodayPlannerQuery {
    date: String,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePlannedTimeBlockPayload {
    date: String,
    #[serde(rename = "type")]
    block_type: PlannedTimeBlockType,
    title: String,
    planned_start_at: u64,
    planned_duration_minutes: u64,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    linked_task_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePlannedTimeBlockPayload {
    #[serde(default)]
    date: Option<String>,
    #[serde(rename = "type", default)]
    block_type: Option<PlannedTimeBlockType>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    planned_start_at: Option<u64>,
    #[serde(default)]
    planned_duration_minutes: Option<u64>,
    #[serde(default)]
    note: Option<Option<String>>,
    #[serde(default)]
    linked_task_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderPlannedTimeBlocksPayload {
    date: String,
    ordered_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodayPlannerSnapshotResponse {
    date: String,
    blocks: Vec<TodayPlannerBlockResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodayPlannerBlockResponse {
    #[serde(flatten)]
    block: PlannedTimeBlockData,
    status: String,
    #[serde(rename = "sourceTimeBlockId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    source_timeblock_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

fn scope_key_from_query(query: &ScopeQuery) -> Option<&str> {
    query.profile_id.as_deref().or(query.user_id.as_deref())
}

fn scope_key_from_today_query(query: &TodayPlannerQuery) -> Option<&str> {
    query.profile_id.as_deref().or(query.user_id.as_deref())
}

fn internal_error(message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: message }),
    )
}

fn bad_request(message: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: message.into(),
        }),
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

fn normalize_linked_task_ids(task_ids: Vec<String>) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for task_id in task_ids {
        let trimmed = task_id.trim();
        if trimmed.is_empty() || normalized.iter().any(|value| value == trimmed) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}

fn build_snapshot_response(
    state: &AppState,
    scope_key: Option<&str>,
    date: &str,
) -> Result<TodayPlannerSnapshotResponse, (StatusCode, Json<ErrorResponse>)> {
    let blocks = state
        .timeblock_store
        .list_planned_for_date_scoped(scope_key, date)
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let completed_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    let block_responses = blocks
        .into_iter()
        .map(|block| {
            if let Some(active) = active_block.as_ref() {
                if active.source_planned_block_id.as_deref() == Some(block.id.as_str()) {
                    return TodayPlannerBlockResponse {
                        block,
                        status: "active".to_string(),
                        source_timeblock_id: Some(active.start_id.clone()),
                    };
                }
            }

            if let Some(completed) = completed_blocks
                .iter()
                .find(|completed| completed.source_planned_block_id.as_deref() == Some(block.id.as_str()))
            {
                return TodayPlannerBlockResponse {
                    block,
                    status: "completed".to_string(),
                    source_timeblock_id: Some(completed.id.clone()),
                };
            }

            TodayPlannerBlockResponse {
                block,
                status: "pending".to_string(),
                source_timeblock_id: None,
            }
        })
        .collect();

    Ok(TodayPlannerSnapshotResponse {
        date: date.to_string(),
        blocks: block_responses,
    })
}

async fn get_today_planner(
    State(state): State<AppState>,
    Query(query): Query<TodayPlannerQuery>,
) -> Result<Json<TodayPlannerSnapshotResponse>, (StatusCode, Json<ErrorResponse>)> {
    let snapshot = build_snapshot_response(&state, scope_key_from_today_query(&query), &query.date)?;
    Ok(Json(snapshot))
}

async fn create_planned_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<CreatePlannedTimeBlockPayload>,
) -> Result<(StatusCode, Json<TodayPlannerBlockResponse>), (StatusCode, Json<ErrorResponse>)> {
    if payload.date.trim().is_empty() {
        return Err(bad_request("date is required"));
    }
    if payload.title.trim().is_empty() {
        return Err(bad_request("title is required"));
    }
    if payload.planned_duration_minutes == 0 {
        return Err(bad_request("plannedDurationMinutes must be greater than 0"));
    }

    let scope_key = scope_key_from_query(&query);
    let existing = state
        .timeblock_store
        .list_planned_for_date_scoped(scope_key, &payload.date)
        .map_err(|error| internal_error(error.to_string()))?;
    let next_order = existing.iter().map(|block| block.order).max().unwrap_or(-1) + 1;
    let now = chrono::Utc::now().timestamp_millis() as u64;
    let block = PlannedTimeBlockData {
        id: uuid::Uuid::new_v4().to_string(),
        date: payload.date.trim().to_string(),
        block_type: payload.block_type,
        title: payload.title.trim().to_string(),
        planned_start_at: payload.planned_start_at,
        planned_duration_minutes: payload.planned_duration_minutes,
        note: payload.note.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        linked_task_ids: normalize_linked_task_ids(payload.linked_task_ids),
        order: next_order,
        created_at: now,
        updated_at: now,
    };

    state
        .timeblock_store
        .put_planned_scoped(scope_key, block.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(TodayPlannerBlockResponse {
            block,
            status: "pending".to_string(),
            source_timeblock_id: None,
        }),
    ))
}

async fn update_planned_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<UpdatePlannedTimeBlockPayload>,
) -> Result<Json<TodayPlannerBlockResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(&query);
    let existing = state
        .timeblock_store
        .get_planned_scoped(scope_key, &block_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| not_found("planned block not found"))?;

    let next_title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(existing.title.clone());
    let next_date = payload
        .date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(existing.date.clone());
    let next_duration = payload
        .planned_duration_minutes
        .unwrap_or(existing.planned_duration_minutes);
    if next_duration == 0 {
        return Err(bad_request("plannedDurationMinutes must be greater than 0"));
    }

    let updated = PlannedTimeBlockData {
        id: existing.id.clone(),
        date: next_date,
        block_type: payload.block_type.unwrap_or(existing.block_type),
        title: next_title,
        planned_start_at: payload.planned_start_at.unwrap_or(existing.planned_start_at),
        planned_duration_minutes: next_duration,
        note: payload
            .note
            .map(|value| {
                value.and_then(|inner| {
                    let trimmed = inner.trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
                    }
                })
            })
            .unwrap_or(existing.note.clone()),
        linked_task_ids: payload
            .linked_task_ids
            .map(normalize_linked_task_ids)
            .unwrap_or(existing.linked_task_ids.clone()),
        order: existing.order,
        created_at: existing.created_at,
        updated_at: chrono::Utc::now().timestamp_millis() as u64,
    };

    state
        .timeblock_store
        .put_planned_scoped(scope_key, updated.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    let snapshot = build_snapshot_response(&state, scope_key, &updated.date)?;
    let response = snapshot
        .blocks
        .into_iter()
        .find(|block| block.block.id == updated.id)
        .ok_or_else(|| internal_error("updated planned block missing from snapshot".to_string()))?;
    Ok(Json(response))
}

async fn reorder_planned_blocks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<ReorderPlannedTimeBlocksPayload>,
) -> Result<Json<TodayPlannerSnapshotResponse>, (StatusCode, Json<ErrorResponse>)> {
    if payload.date.trim().is_empty() {
        return Err(bad_request("date is required"));
    }

    let scope_key = scope_key_from_query(&query);
    let mut all_blocks = state
        .timeblock_store
        .list_planned_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    let ordered_ids = payload
        .ordered_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if ordered_ids.is_empty() {
        return Err(bad_request("orderedIds is required"));
    }

    let mut next_order = 0i64;
    for ordered_id in ordered_ids {
        if let Some(block) = all_blocks
            .iter_mut()
            .find(|block| block.date == payload.date && block.id == ordered_id)
        {
            block.order = next_order;
            block.updated_at = chrono::Utc::now().timestamp_millis() as u64;
            next_order += 1;
        }
    }

    for block in all_blocks
        .iter_mut()
        .filter(|block| block.date == payload.date && !payload.ordered_ids.iter().any(|id| id == &block.id))
    {
        block.order = next_order;
        block.updated_at = chrono::Utc::now().timestamp_millis() as u64;
        next_order += 1;
    }

    state
        .timeblock_store
        .replace_planned_scoped(scope_key, &all_blocks)
        .map_err(|error| internal_error(error.to_string()))?;

    Ok(Json(build_snapshot_response(
        &state,
        scope_key,
        payload.date.trim(),
    )?))
}

async fn start_planned_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<ActiveBlockData>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(&query);
    let planned_block = state
        .timeblock_store
        .get_planned_scoped(scope_key, &block_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| not_found("planned block not found"))?;

    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
    {
        if !matches!(
            active.phase.as_deref(),
            Some("feedback_in_progress" | "feedback_submitted")
        ) && active.action_ended_at.is_none()
            && active.feedback_started_at.is_none()
            && active.feedback_submitted_at.is_none()
        {
            return Err(conflict("active timeblock already exists"));
        }
    }

    let now = chrono::Utc::now().timestamp_millis() as u64;
    let start_id = uuid::Uuid::new_v4().to_string();
    let task_association_log = planned_block
        .linked_task_ids
        .iter()
        .map(|task_id| BlockTaskAssociationEvent {
            block_id: start_id.clone(),
            task_id: task_id.clone(),
            action: "associated".to_string(),
            timestamp: now,
            source: "block_start".to_string(),
        })
        .collect::<Vec<_>>();
    let active_block = ActiveBlockData {
        start_id: start_id.clone(),
        name: planned_block.title.clone(),
        mode: "countdown".to_string(),
        target_minutes: Some(planned_block.planned_duration_minutes),
        elapsed: planned_block.planned_duration_minutes * 60 * 1000,
        updated_at: Some(now),
        phase: Some("running".to_string()),
        version: Some(1),
        actor_id: Some("rt:today-planner".to_string()),
        last_transition_at: Some(now),
        last_resumed_at: Some(now),
        accumulated_run_ms: Some(0),
        start_time: now,
        action_ended_at: None,
        feedback_started_at: None,
        feedback_submitted_at: None,
        pause_accumulated_ms: Some(0),
        paused: false,
        paused_at: None,
        task_ids: planned_block.linked_task_ids.clone(),
        task_association_log,
        source_planned_block_id: Some(planned_block.id.clone()),
        task_id: None,
    };

    state
        .timeblock_store
        .put_active_scoped(scope_key, active_block.clone())
        .map_err(|error| internal_error(error.to_string()))?;
    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_start",
        &active_block.name,
        &active_block.start_id,
        &active_block.task_ids,
    );

    Ok(Json(active_block))
}

async fn delete_planned_block(
    State(state): State<AppState>,
    Path(block_id): Path<String>,
    Query(query): Query<ScopeQuery>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(&query);
    let existing = state
        .timeblock_store
        .get_planned_scoped(scope_key, &block_id)
        .map_err(|error| internal_error(error.to_string()))?;
    if existing.is_none() {
        return Err(not_found("planned block not found"));
    }

    state
        .timeblock_store
        .delete_planned_scoped(scope_key, &block_id)
        .map_err(|error| internal_error(error.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
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
                "trigger": "http:today-planner/start",
            }
        })),
    };

    if let Err(error) = state.eventlog_store.append_event(scope_key, event) {
        tracing::warn!(error = %error, "failed to write today planner eventlog");
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/act/today-planner", get(get_today_planner))
        .route("/act/today-planner/blocks", post(create_planned_block))
        .route(
            "/act/today-planner/blocks/reorder",
            post(reorder_planned_blocks),
        )
        .route(
            "/act/today-planner/blocks/:block_id",
            patch(update_planned_block).delete(delete_planned_block),
        )
        .route(
            "/act/today-planner/blocks/:block_id/start",
            post(start_planned_block),
        )
}
