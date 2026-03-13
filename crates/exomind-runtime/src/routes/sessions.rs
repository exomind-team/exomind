use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::AppState;
use crate::session::{
    AgentSession, CreateSessionInput, QuickActionResponse, SessionStatus, UpdateSessionInput,
};

// ── Query types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    sort: Option<String>,
}

// ── SSE event types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SessionEvent {
    #[serde(rename = "session.created")]
    Created { session: AgentSession },
    #[serde(rename = "session.updated")]
    Updated { session: AgentSession },
    #[serde(rename = "session.deleted")]
    Deleted { session_id: String },
}

// ── Shared broadcast channel ────────────────────────────────────

/// Broadcast channel for session SSE events.
/// Capacity 256 should be enough — events are small and infrequent.
pub fn session_event_channel() -> (broadcast::Sender<SessionEvent>, broadcast::Receiver<SessionEvent>) {
    broadcast::channel(256)
}

// ── Handlers ────────────────────────────────────────────────────

async fn create_session(
    State(state): State<AppState>,
    Json(input): Json<CreateSessionInput>,
) -> Result<(StatusCode, Json<AgentSession>), (StatusCode, String)> {
    let session = state
        .session_store
        .create(input)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Broadcast creation event
    if let Some(tx) = &state.session_event_tx {
        let _ = tx.send(SessionEvent::Created {
            session: session.clone(),
        });
    }

    Ok((StatusCode::CREATED, Json(session)))
}

async fn list_sessions(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<AgentSession>>, (StatusCode, String)> {
    let sessions = if let Some(status_str) = query.status {
        let status = SessionStatus::from_str(&status_str)
            .ok_or_else(|| (StatusCode::BAD_REQUEST, format!("invalid status: {status_str}")))?;
        state
            .session_store
            .list_by_status(&status)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        state
            .session_store
            .list()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    Ok(Json(sessions))
}

async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AgentSession>, (StatusCode, String)> {
    let session = state
        .session_store
        .get(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("session not found: {id}")))?;

    Ok(Json(session))
}

async fn update_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateSessionInput>,
) -> Result<Json<AgentSession>, (StatusCode, String)> {
    let session = state
        .session_store
        .update(&id, input)
        .map_err(|e| {
            let status = if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else if e.to_string().contains("invalid transition") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, e.to_string())
        })?;

    // Broadcast update event
    if let Some(tx) = &state.session_event_tx {
        let _ = tx.send(SessionEvent::Updated {
            session: session.clone(),
        });
    }

    Ok(Json(session))
}

async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AgentSession>, (StatusCode, String)> {
    let session = state
        .session_store
        .delete(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("session not found: {id}")))?;

    // Broadcast deletion event
    if let Some(tx) = &state.session_event_tx {
        let _ = tx.send(SessionEvent::Deleted {
            session_id: id,
        });
    }

    Ok(Json(session))
}

async fn session_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state
        .session_event_tx
        .as_ref()
        .map(|tx| tx.subscribe())
        .unwrap_or_else(|| {
            let (tx, rx) = broadcast::channel(1);
            drop(tx);
            rx
        });

    let stream = BroadcastStream::new(rx)
        .filter_map(|result| match result {
            Ok(event) => {
                let json = serde_json::to_string(&event).ok()?;
                let event_type = match &event {
                    SessionEvent::Created { .. } => "session.created",
                    SessionEvent::Updated { .. } => "session.updated",
                    SessionEvent::Deleted { .. } => "session.deleted",
                };
                Some(Ok(Event::default().event(event_type).data(json)))
            }
            Err(_) => None,
        });

    Sse::new(stream)
}

/// POST /sessions/:id/quick-action — Submit a quick action response
///
/// Validates the session is in WaitingInput state and the action_id matches
/// an available quick action, then transitions the session back to Running.
async fn submit_quick_action(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(response): Json<QuickActionResponse>,
) -> Result<Json<AgentSession>, (StatusCode, String)> {
    // Get current session
    let session = state
        .session_store
        .get(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("session not found: {id}")))?;

    // Validate session is in WaitingInput
    if session.status != SessionStatus::WaitingInput {
        return Err((
            StatusCode::CONFLICT,
            format!("session is not waiting for input (current status: {})", session.status.as_str()),
        ));
    }

    // Validate action_id exists (if quick_actions are defined)
    if !session.quick_actions.is_empty() {
        let action_exists = session.quick_actions.iter().any(|a| a.id == response.action_id);
        if !action_exists {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown quick action: {}", response.action_id),
            ));
        }
    }

    // Transition to Running and clear quick_actions
    let update = UpdateSessionInput {
        status: Some(SessionStatus::Running),
        quick_actions: Some(vec![]),
        ..Default::default()
    };

    let updated = state
        .session_store
        .update(&id, update)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Broadcast update event
    if let Some(tx) = &state.session_event_tx {
        let _ = tx.send(SessionEvent::Updated {
            session: updated.clone(),
        });
    }

    Ok(Json(updated))
}

/// POST /sessions/:id/mark-waiting — Manually mark a PTY session as waiting for input
///
/// For terminal mode sessions where we can't auto-detect WaitingInput.
/// The user clicks a "等待决策" button to manually mark the session.
async fn mark_waiting(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AgentSession>, (StatusCode, String)> {
    let update = UpdateSessionInput {
        status: Some(SessionStatus::WaitingInput),
        ..Default::default()
    };

    let updated = state
        .session_store
        .update(&id, update)
        .map_err(|e| {
            let status = if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else if e.to_string().contains("invalid transition") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, e.to_string())
        })?;

    // Broadcast update event
    if let Some(tx) = &state.session_event_tx {
        let _ = tx.send(SessionEvent::Updated {
            session: updated.clone(),
        });
    }

    Ok(Json(updated))
}

// ── Router ──────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sessions", post(create_session).get(list_sessions))
        .route(
            "/sessions/{id}",
            get(get_session).patch(update_session).delete(delete_session),
        )
        .route("/sessions/{id}/quick-action", post(submit_quick_action))
        .route("/sessions/{id}/mark-waiting", post(mark_waiting))
        .route("/sessions/stream", get(session_stream))
}
