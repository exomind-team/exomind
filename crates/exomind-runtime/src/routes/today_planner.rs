use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::timeblock::{
    ActiveBlockData, BreakWindowKind, PlannedSegmentData, PlannedSegmentKind, RhythmPresetData,
    SchedulingWindowData,
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
struct CreateSchedulingWindowPayload {
    date: String,
    #[serde(default)]
    title: Option<String>,
    planned_start_at: u64,
    planned_end_at: u64,
    rhythm_preset_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePlannedSegmentPayload {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    linked_task_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReflowWindowPayload {
    anchor_segment_id: String,
    actual_end_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodayPlannerSnapshotResponse {
    date: String,
    windows: Vec<SchedulingWindowResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SchedulingWindowResponse {
    id: String,
    date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    planned_start_at: u64,
    planned_end_at: u64,
    rhythm_preset: RhythmPresetData,
    segments: Vec<PlannedSegmentResponse>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlannedSegmentResponse {
    #[serde(flatten)]
    segment: PlannedSegmentData,
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

fn resolve_rhythm_preset(key: &str) -> Option<RhythmPresetData> {
    match key.trim() {
        "pomodoro_25_5" => Some(RhythmPresetData {
            key: "pomodoro_25_5".to_string(),
            label: "25 / 5".to_string(),
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 20,
            long_break_after_work_segments: 4,
        }),
        "focus_45_10" => Some(RhythmPresetData {
            key: "focus_45_10".to_string(),
            label: "45 / 10".to_string(),
            work_minutes: 45,
            short_break_minutes: 10,
            long_break_minutes: 20,
            long_break_after_work_segments: 3,
        }),
        "focus_45_15" => Some(RhythmPresetData {
            key: "focus_45_15".to_string(),
            label: "45 / 15".to_string(),
            work_minutes: 45,
            short_break_minutes: 15,
            long_break_minutes: 25,
            long_break_after_work_segments: 3,
        }),
        _ => None,
    }
}

fn duration_minutes_from_segment(segment: &PlannedSegmentData) -> u64 {
    let duration_ms = segment
        .planned_end_at
        .saturating_sub(segment.planned_start_at);
    let rounded = duration_ms.div_ceil(60_000);
    rounded.max(1)
}

fn generate_segments_for_window(
    window_id: &str,
    window_title: Option<&str>,
    window_start_at: u64,
    window_end_at: u64,
    preset: &RhythmPresetData,
    now: u64,
) -> Vec<PlannedSegmentData> {
    let mut cursor = window_start_at;
    let mut order = 0i64;
    let mut work_count = 0u32;
    let mut segments = Vec::new();
    let normalized_window_title = window_title
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);

    while cursor < window_end_at {
        let remaining_minutes = window_end_at.saturating_sub(cursor).div_ceil(60_000);
        if remaining_minutes == 0 {
            break;
        }

        let work_minutes = preset.work_minutes.min(remaining_minutes);
        let work_end = (cursor + work_minutes * 60_000).min(window_end_at);
        work_count += 1;
        segments.push(PlannedSegmentData {
            id: uuid::Uuid::new_v4().to_string(),
            window_id: window_id.to_string(),
            kind: PlannedSegmentKind::Work,
            break_kind: None,
            title: normalized_window_title
                .clone()
                .unwrap_or_else(|| format!("Work {work_count}")),
            planned_start_at: cursor,
            planned_end_at: work_end,
            linked_task_ids: Vec::new(),
            order,
            created_at: now,
            updated_at: now,
        });
        order += 1;
        cursor = work_end;

        if cursor >= window_end_at {
            break;
        }

        let remaining_after_work = window_end_at.saturating_sub(cursor).div_ceil(60_000);
        if remaining_after_work == 0 {
            break;
        }
        if remaining_after_work <= preset.short_break_minutes {
            if let Some(last_work_segment) = segments.last_mut() {
                last_work_segment.planned_end_at = window_end_at;
                last_work_segment.updated_at = now;
            }
            break;
        }

        let use_long_break = preset.long_break_after_work_segments > 0
            && work_count % preset.long_break_after_work_segments == 0
            && remaining_after_work > preset.short_break_minutes;
        let break_minutes = if use_long_break {
            preset.long_break_minutes
        } else {
            preset.short_break_minutes
        }
        .min(remaining_after_work);
        let break_end = (cursor + break_minutes * 60_000).min(window_end_at);

        segments.push(PlannedSegmentData {
            id: uuid::Uuid::new_v4().to_string(),
            window_id: window_id.to_string(),
            kind: PlannedSegmentKind::Break,
            break_kind: Some(if use_long_break {
                BreakWindowKind::Long
            } else {
                BreakWindowKind::Short
            }),
            title: if use_long_break {
                "Long Break".to_string()
            } else {
                "Short Break".to_string()
            },
            planned_start_at: cursor,
            planned_end_at: break_end,
            linked_task_ids: Vec::new(),
            order,
            created_at: now,
            updated_at: now,
        });
        order += 1;
        cursor = break_end;
    }

    segments
}

fn build_segment_response(
    segment: PlannedSegmentData,
    active_block: Option<&ActiveBlockData>,
    completed_blocks: &[crate::timeblock::TimeBlockData],
) -> PlannedSegmentResponse {
    if let Some(active) = active_block {
        if active.source_planned_block_id.as_deref() == Some(segment.id.as_str()) {
            return PlannedSegmentResponse {
                segment,
                status: "active".to_string(),
                source_timeblock_id: Some(active.start_id.clone()),
            };
        }
    }

    if let Some(completed) = completed_blocks
        .iter()
        .find(|completed| completed.source_planned_block_id.as_deref() == Some(segment.id.as_str()))
    {
        return PlannedSegmentResponse {
            segment,
            status: "completed".to_string(),
            source_timeblock_id: Some(completed.id.clone()),
        };
    }

    PlannedSegmentResponse {
        segment,
        status: "pending".to_string(),
        source_timeblock_id: None,
    }
}

fn build_window_response(
    window: SchedulingWindowData,
    active_block: Option<&ActiveBlockData>,
    completed_blocks: &[crate::timeblock::TimeBlockData],
) -> SchedulingWindowResponse {
    let segments = window
        .segments
        .clone()
        .into_iter()
        .map(|segment| build_segment_response(segment, active_block, completed_blocks))
        .collect();

    SchedulingWindowResponse {
        id: window.id,
        date: window.date,
        title: window.title,
        planned_start_at: window.planned_start_at,
        planned_end_at: window.planned_end_at,
        rhythm_preset: window.rhythm_preset,
        segments,
        created_at: window.created_at,
        updated_at: window.updated_at,
    }
}

fn build_snapshot_response(
    state: &AppState,
    scope_key: Option<&str>,
    date: &str,
) -> Result<TodayPlannerSnapshotResponse, (StatusCode, Json<ErrorResponse>)> {
    let windows = state
        .timeblock_store
        .list_windows_for_date_scoped(scope_key, date)
        .map_err(|error| internal_error(error.to_string()))?;
    let active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let completed_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    Ok(TodayPlannerSnapshotResponse {
        date: date.to_string(),
        windows: windows
            .into_iter()
            .map(|window| build_window_response(window, active_block.as_ref(), &completed_blocks))
            .collect(),
    })
}

async fn get_today_planner(
    State(state): State<AppState>,
    Query(query): Query<TodayPlannerQuery>,
) -> Result<Json<TodayPlannerSnapshotResponse>, (StatusCode, Json<ErrorResponse>)> {
    let snapshot =
        build_snapshot_response(&state, scope_key_from_today_query(&query), &query.date)?;
    Ok(Json(snapshot))
}

async fn create_window(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<CreateSchedulingWindowPayload>,
) -> Result<(StatusCode, Json<SchedulingWindowResponse>), (StatusCode, Json<ErrorResponse>)> {
    if payload.date.trim().is_empty() {
        return Err(bad_request("date is required"));
    }
    if payload.planned_end_at <= payload.planned_start_at {
        return Err(bad_request(
            "plannedEndAt must be greater than plannedStartAt",
        ));
    }
    let preset = resolve_rhythm_preset(&payload.rhythm_preset_key)
        .ok_or_else(|| bad_request("unknown rhythmPresetKey"))?;

    let scope_key = scope_key_from_query(&query);
    let now = chrono::Utc::now().timestamp_millis() as u64;
    let window_id = uuid::Uuid::new_v4().to_string();
    let window_title = payload
        .title
        .map(|title| title.trim().to_string())
        .filter(|title| !title.is_empty());
    let window = SchedulingWindowData {
        id: window_id.clone(),
        date: payload.date.trim().to_string(),
        title: window_title.clone(),
        planned_start_at: payload.planned_start_at,
        planned_end_at: payload.planned_end_at,
        rhythm_preset: preset.clone(),
        segments: generate_segments_for_window(
            &window_id,
            window_title.as_deref(),
            payload.planned_start_at,
            payload.planned_end_at,
            &preset,
            now,
        ),
        created_at: now,
        updated_at: now,
    };

    state
        .timeblock_store
        .put_window_scoped(scope_key, window.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(build_window_response(window, None, &[])),
    ))
}

async fn update_segment(
    State(state): State<AppState>,
    Path(segment_id): Path<String>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<UpdatePlannedSegmentPayload>,
) -> Result<Json<PlannedSegmentResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(&query);
    let mut window = state
        .timeblock_store
        .get_window_by_segment_scoped(scope_key, &segment_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| not_found("planned segment not found"))?;

    let segment = window
        .segments
        .iter_mut()
        .find(|segment| segment.id == segment_id)
        .ok_or_else(|| not_found("planned segment not found"))?;
    if segment.kind != PlannedSegmentKind::Work {
        return Err(bad_request("only work segments can be updated"));
    }

    if let Some(title) = payload.title {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            segment.title = trimmed.to_string();
        }
    }
    if let Some(linked_task_ids) = payload.linked_task_ids {
        segment.linked_task_ids = normalize_linked_task_ids(linked_task_ids);
    }
    segment.updated_at = chrono::Utc::now().timestamp_millis() as u64;
    window.updated_at = segment.updated_at;

    state
        .timeblock_store
        .put_window_scoped(scope_key, window.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    let active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let completed_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let updated_segment = window
        .segments
        .into_iter()
        .find(|segment| segment.id == segment_id)
        .ok_or_else(|| internal_error("updated segment missing from window".to_string()))?;

    Ok(Json(build_segment_response(
        updated_segment,
        active_block.as_ref(),
        &completed_blocks,
    )))
}

fn can_replace_active_block_for_planner_start(active: &ActiveBlockData) -> bool {
    active.block_type.as_deref() == Some("gap")
        || matches!(active.phase.as_deref(), Some("feedback_submitted"))
        || active.feedback_submitted_at.is_some()
}

async fn start_segment(
    State(state): State<AppState>,
    Path(segment_id): Path<String>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<ActiveBlockData>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(&query);
    let segment = state
        .timeblock_store
        .get_segment_scoped(scope_key, &segment_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| not_found("planned segment not found"))?;
    if segment.kind != PlannedSegmentKind::Work {
        return Err(bad_request("only work segments can be started"));
    }

    // Guard: check if current block can be replaced
    if let Some(active) = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?
    {
        if !can_replace_active_block_for_planner_start(&active) {
            return Err(conflict("active timeblock already exists"));
        }
    }

    // Use do_new_block to atomically truncate gap + create active block
    let result = super::timeblocks::do_new_block(
        &state.timeblock_store,
        scope_key,
        &super::timeblocks::NewBlockRequest {
            block_type: "active".to_string(),
            name: Some(segment.title.clone()),
            mode: Some("countdown".to_string()),
            target_minutes: Some(duration_minutes_from_segment(&segment)),
            task_ids: Some(segment.linked_task_ids.clone()),
            source_planned_block_id: Some(segment.id.clone()),
            feedback: None,
            task_status_outcomes: None,
        },
    )
    .map_err(|(status, _)| {
        let err: ErrorResponse = ErrorResponse {
            error: "failed to create timeblock via newBlock".into(),
        };
        (status, Json(err))
    })?;

    write_timeblock_eventlog(
        &state,
        scope_key,
        "block_start",
        &result.active.name,
        &result.active.start_id,
        &result.active.task_ids,
    );

    Ok(Json(result.active))
}

async fn reflow_window(
    State(state): State<AppState>,
    Path(window_id): Path<String>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<ReflowWindowPayload>,
) -> Result<Json<SchedulingWindowResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = scope_key_from_query(&query);
    let mut window = state
        .timeblock_store
        .get_window_scoped(scope_key, &window_id)
        .map_err(|error| internal_error(error.to_string()))?
        .ok_or_else(|| not_found("planner window not found"))?;

    let anchor_index = window
        .segments
        .iter()
        .position(|segment| segment.id == payload.anchor_segment_id)
        .ok_or_else(|| not_found("anchor segment not found"))?;
    let anchor = window.segments[anchor_index].clone();
    if payload.actual_end_at <= anchor.planned_start_at {
        return Err(bad_request(
            "actualEndAt must be after anchor segment start",
        ));
    }

    let delta = payload.actual_end_at as i128 - anchor.planned_end_at as i128;
    let updated_at = chrono::Utc::now().timestamp_millis() as u64;
    if let Some(anchor_segment) = window.segments.get_mut(anchor_index) {
        anchor_segment.planned_end_at = payload.actual_end_at;
        anchor_segment.updated_at = updated_at;
    }
    if delta != 0 {
        for segment in window.segments.iter_mut().skip(anchor_index + 1) {
            segment.planned_start_at = segment.planned_start_at.saturating_add_signed(delta as i64);
            segment.planned_end_at = segment.planned_end_at.saturating_add_signed(delta as i64);
            segment.updated_at = updated_at;
        }
        window.planned_end_at = window.planned_end_at.saturating_add_signed(delta as i64);
    }
    window.updated_at = updated_at;

    state
        .timeblock_store
        .put_window_scoped(scope_key, window.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    let active_block = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;
    let completed_blocks = state
        .timeblock_store
        .list_completed_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    Ok(Json(build_window_response(
        window,
        active_block.as_ref(),
        &completed_blocks,
    )))
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
        .route("/act/today-planner/windows", post(create_window))
        .route(
            "/act/today-planner/windows/:window_id/reflow",
            post(reflow_window),
        )
        .route(
            "/act/today-planner/segments/:segment_id",
            patch(update_segment),
        )
        .route(
            "/act/today-planner/segments/:segment_id/start",
            post(start_segment),
        )
}
