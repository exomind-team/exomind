use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::reminder::{
    CreateReminderInput, Reminder, ReminderStatus, ReminderTransitionInput, UpdateReminderInput,
};
use crate::reminder::store::ReminderStoreError;
use crate::signal::types::SignalEvent;

#[derive(Debug, Deserialize)]
struct ScopeQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    status: Option<ReminderStatus>,
}

#[derive(Debug, Deserialize)]
struct ReminderReplicationUpsertRequest {
    reminder: Reminder,
    #[serde(default)]
    source_host_id: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct ReminderReplicationUpsertResponse {
    status: &'static str,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reminders", get(list_reminders).post(create_reminder))
        .route("/reminders/:id", get(get_reminder).put(update_reminder))
        .route("/reminders/:id/transition", post(transition_reminder))
        .route("/reminders/replication/upsert", post(reminder_replication_upsert))
}

async fn list_reminders(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Json<Vec<Reminder>> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    Json(state.reminder_store.list_scoped(scope_key, query.status))
}

async fn get_reminder(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Reminder>, StatusCode> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    state
        .reminder_store
        .get_scoped(scope_key, &id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn create_reminder(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<CreateReminderInput>,
) -> (StatusCode, Json<Reminder>) {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let reminder = state.reminder_store.create_scoped(scope_key, input);
    publish_reminder_replication_signal(&state, scope_key, &reminder).await;
    (StatusCode::CREATED, Json(reminder))
}

async fn update_reminder(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<UpdateReminderInput>,
) -> Result<Json<Reminder>, StatusCode> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let reminder = state
        .reminder_store
        .update_scoped(scope_key, &id, input)
        .map_err(map_reminder_store_error)?
        .ok_or(StatusCode::NOT_FOUND)?;
    publish_reminder_replication_signal(&state, scope_key, &reminder).await;
    Ok(Json(reminder))
}

async fn transition_reminder(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<ReminderTransitionInput>,
) -> Result<Json<Reminder>, StatusCode> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let reminder = state
        .reminder_store
        .transition_scoped(
            scope_key,
            &id,
            input.status,
            input
                .at
                .unwrap_or_else(|| chrono::Utc::now().timestamp_millis() as u64),
        )
        .map_err(map_reminder_store_error)?
        .ok_or(StatusCode::NOT_FOUND)?;
    publish_reminder_replication_signal(&state, scope_key, &reminder).await;
    Ok(Json(reminder))
}

async fn reminder_replication_upsert(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(request): Json<ReminderReplicationUpsertRequest>,
) -> Result<Json<ReminderReplicationUpsertResponse>, StatusCode> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let existing = state.reminder_store.get_scoped(scope_key, &request.reminder.id);
    let status = if let Some(existing_reminder) = existing {
        if request.reminder.updated_at < existing_reminder.updated_at {
            "ignored"
        } else if request.reminder.updated_at == existing_reminder.updated_at
            && request.source_host_id.as_deref().unwrap_or_default() <= state.host_id.as_str()
        {
            "ignored"
        } else {
            state
                .reminder_store
                .upsert_scoped(scope_key, &request.reminder)
                .map_err(map_reminder_store_error)?;
            "updated"
        }
    } else {
        state
            .reminder_store
            .upsert_scoped(scope_key, &request.reminder)
            .map_err(map_reminder_store_error)?;
        "inserted"
    };

    Ok(Json(ReminderReplicationUpsertResponse { status }))
}

fn normalize_scope_key(scope_key: Option<&str>) -> String {
    scope_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous")
        .to_string()
}

fn build_reminder_replication_payload(
    state: &AppState,
    scope_key: Option<&str>,
    reminder: &Reminder,
) -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "scopeKey": normalize_scope_key(scope_key),
        "cursor": {
            "kind": "reminder_snapshot",
            "reminderId": reminder.id,
            "updatedAt": reminder.updated_at,
            "originHostId": state.host_id,
        },
        "reminder": {
            "id": reminder.id,
            "title": reminder.title,
            "content": reminder.content,
            "dueAt": reminder.due_at,
            "status": reminder.status,
            "createdAt": reminder.created_at,
            "updatedAt": reminder.updated_at,
            "completedAt": reminder.completed_at,
        },
    })
}

async fn publish_reminder_replication_signal(
    state: &AppState,
    scope_key: Option<&str>,
    reminder: &Reminder,
) {
    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "reminder.replication.upserted".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "http:reminders".to_string(),
        origin_host_id: state.host_id.clone(),
        hop: 0,
        trace_id: Some(format!("reminder:{}", reminder.id)),
        payload: build_reminder_replication_payload(state, scope_key, reminder),
    };
    state.signal_pool.publish(event.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.forward_event_to_peers(event).await;
    }
}

fn map_reminder_store_error(error: ReminderStoreError) -> StatusCode {
    match error {
        ReminderStoreError::NotFound(_) => StatusCode::NOT_FOUND,
        ReminderStoreError::InvalidTransition { .. } => StatusCode::CONFLICT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
