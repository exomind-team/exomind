use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::AppState;
use crate::pty::PtyError;
use crate::session::{
    AgentSession, CreateSessionInput, Participant, QuickActionResponse,
    SendMessageInput, SessionMessage, SessionStatus, UpdateSessionInput,
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

pub(crate) fn broadcast_session_created(
    tx: Option<&broadcast::Sender<SessionEvent>>,
    session: &AgentSession,
) {
    if let Some(tx) = tx {
        let _ = tx.send(SessionEvent::Created {
            session: session.clone(),
        });
    }
}

pub(crate) fn broadcast_session_updated(
    tx: Option<&broadcast::Sender<SessionEvent>>,
    session: &AgentSession,
) {
    if let Some(tx) = tx {
        let _ = tx.send(SessionEvent::Updated {
            session: session.clone(),
        });
    }
}

pub(crate) fn broadcast_session_deleted(
    tx: Option<&broadcast::Sender<SessionEvent>>,
    session_id: &str,
) {
    if let Some(tx) = tx {
        let _ = tx.send(SessionEvent::Deleted {
            session_id: session_id.to_string(),
        });
    }
}

fn fill_source_host_id(mut session: AgentSession, host_id: &str) -> AgentSession {
    // 补齐 source_host_id（默认本机 host id）
    if session.source_host_id.is_none() {
        session.source_host_id = Some(host_id.to_string());
    }
    session
}

fn map_pty_delivery_error(pty_id: &str, error: PtyError) -> (StatusCode, String) {
    let status = match error {
        PtyError::NotFound { .. } | PtyError::IoError(_) => StatusCode::CONFLICT,
        PtyError::SpawnFailed { .. } => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        format!("failed to deliver message to PTY {pty_id}: {error}"),
    )
}

// ── Handlers ────────────────────────────────────────────────────

async fn create_session(
    State(state): State<AppState>,
    Json(input): Json<CreateSessionInput>,
) -> Result<(StatusCode, Json<AgentSession>), (StatusCode, String)> {
    let mut input = input;
    if input.source_host_id.is_none() {
        input.source_host_id = Some(state.host_id.clone());
    }
    let session = state
        .session_store
        .create(input)
        .map_err(|e| {
            let status = match e {
                crate::session::SessionStoreError::AlreadyExists(_) => StatusCode::CONFLICT,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (status, e.to_string())
        })?;
    let session = fill_source_host_id(session, &state.host_id);

    // Broadcast creation event
    broadcast_session_created(state.session_event_tx.as_ref(), &session);

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

    let host_id = &state.host_id;
    let sessions = sessions
        .into_iter()
        .map(|session| fill_source_host_id(session, host_id))
        .collect();
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

    Ok(Json(fill_source_host_id(session, &state.host_id)))
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
    let session = fill_source_host_id(session, &state.host_id);

    // Broadcast update event
    broadcast_session_updated(state.session_event_tx.as_ref(), &session);

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
    let session = fill_source_host_id(session, &state.host_id);

    // Broadcast deletion event
    broadcast_session_deleted(state.session_event_tx.as_ref(), &id);

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
    let updated = fill_source_host_id(updated, &state.host_id);

    // Broadcast update event
    broadcast_session_updated(state.session_event_tx.as_ref(), &updated);

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
    let updated = fill_source_host_id(updated, &state.host_id);

    // Broadcast update event
    broadcast_session_updated(state.session_event_tx.as_ref(), &updated);

    Ok(Json(updated))
}

/// GET /sessions/:id/children — List child sessions of a parent session
async fn list_children(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentSession>>, (StatusCode, String)> {
    // Verify parent exists
    state
        .session_store
        .get(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("session not found: {id}")))?;

    // List all sessions and filter children
    let all = state
        .session_store
        .list()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let children: Vec<AgentSession> = all
        .into_iter()
        .map(|session| fill_source_host_id(session, &state.host_id))
        .filter(|s| s.parent_session_id.as_deref() == Some(&id))
        .collect();

    Ok(Json(children))
}

/// POST /sessions/:id/messages — Send a message to a session
///
/// Creates a cross-session message. The message is stored in-memory
/// (V6 foundation — can be persisted to SQLite later).
async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<SendMessageInput>,
) -> Result<(StatusCode, Json<SessionMessage>), (StatusCode, String)> {
    // Verify target session exists
    let session = state
        .session_store
        .get(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("session not found: {id}")))?;

    let message = SessionMessage {
        id: uuid::Uuid::new_v4().to_string(),
        from: input.from.unwrap_or(Participant::User),
        to_session_id: id,
        content: input.content,
        created_at: chrono::Utc::now().to_rfc3339(),
        reply_to: input.reply_to,
    };

    // Note: In V6 foundation, messages are fire-and-forget.
    // A proper message queue/store can be added when cross-session
    // communication becomes a core feature.

    // Bridge to PTY stdin（桥接到 PTY 标准输入）when this session owns a terminal.
    if let Some(pty_id) = session.pty_id.as_deref() {
        let input = format!("{}\n", message.content);
        state
            .pty_manager
            .write_input(pty_id, input.as_bytes())
            .await
            .map_err(|error| map_pty_delivery_error(pty_id, error))?;
    }

    Ok((StatusCode::CREATED, Json(message)))
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
        .route("/sessions/{id}/children", get(list_children))
        .route("/sessions/{id}/messages", post(send_message))
        .route("/sessions/stream", get(session_stream))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use std::time::Duration;
    use tower::ServiceExt;

    fn test_state(host_id: &str) -> AppState {
        AppState::new_runtime(0, host_id.to_string(), None, None, false, None)
    }

    fn interactive_shell_spawn_request() -> crate::pty::PtySpawnRequest {
        if cfg!(windows) {
            crate::pty::PtySpawnRequest {
                name: "bridge-shell".to_string(),
                workdir: Some(".".to_string()),
                command: "cmd".to_string(),
                args: vec!["/Q".to_string(), "/K".to_string()],
                rows: 24,
                cols: 80,
            }
        } else {
            crate::pty::PtySpawnRequest {
                name: "bridge-shell".to_string(),
                workdir: Some(".".to_string()),
                command: "sh".to_string(),
                args: vec![],
                rows: 24,
                cols: 80,
            }
        }
    }

    #[tokio::test]
    async fn create_session_defaults_source_host_id() {
        let state = test_state("session-host-1");
        let app = router().with_state(state);
        let payload = serde_json::json!({
            "agent_kind": "claude",
        });

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let session: AgentSession = serde_json::from_slice(&body).unwrap();
        assert_eq!(session.source_host_id.as_deref(), Some("session-host-1"));
    }

    #[tokio::test]
    async fn list_sessions_fills_missing_source_host_id() {
        let state = test_state("session-host-2");
        state
            .session_store
            .create(CreateSessionInput {
                id: Some("sid-123".to_string()),
                agent_kind: "claude".to_string(),
                agent_id: None,
                source_host_id: None,
                role: Some("test".to_string()),
                context: None,
                interaction: None,
                pty_id: None,
                inner_session_id: None,
                parent_session_id: None,
            })
            .unwrap();

        let app = router().with_state(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let sessions: Vec<AgentSession> = serde_json::from_slice(&body).unwrap();
        let found = sessions
            .into_iter()
            .find(|session| session.id == "sid-123")
            .expect("session should exist");
        assert_eq!(found.source_host_id.as_deref(), Some("session-host-2"));
    }

    #[tokio::test]
    async fn send_message_returns_created_for_non_pty_session() {
        let state = test_state("session-host-3");
        state
            .session_store
            .create(CreateSessionInput {
                id: Some("sid-message-only".to_string()),
                agent_kind: "codex".to_string(),
                agent_id: None,
                source_host_id: Some("session-host-3".to_string()),
                role: Some("message-only".to_string()),
                context: None,
                interaction: Some(crate::session::InteractionMode::Structured),
                pty_id: None,
                inner_session_id: None,
                parent_session_id: None,
            })
            .unwrap();

        let (status, Json(message)) = send_message(
            State(state),
            Path("sid-message-only".to_string()),
            Json(SendMessageInput {
                content: "hello-from-user".to_string(),
                from: Some(Participant::User),
                reply_to: None,
            }),
        )
        .await
        .expect("send_message should succeed");

        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(message.to_session_id, "sid-message-only");
        assert_eq!(message.content, "hello-from-user");
    }

    #[tokio::test]
    async fn send_message_bridges_content_to_pty_stdin() {
        let state = test_state("session-host-4");
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");

        state
            .session_store
            .create(CreateSessionInput {
                id: Some("sid-pty-bridge".to_string()),
                agent_kind: "codex".to_string(),
                agent_id: None,
                source_host_id: Some("session-host-4".to_string()),
                role: Some("pty-bridge".to_string()),
                context: None,
                interaction: Some(crate::session::InteractionMode::Terminal),
                pty_id: Some(pty.id.clone()),
                inner_session_id: None,
                parent_session_id: None,
            })
            .unwrap();

        let (_buffer, mut rx) = state
            .pty_manager
            .subscribe_output(&pty.id)
            .await
            .expect("pty output subscription should succeed");

        let marker = "exomind-pty-bridge-ok";
        let payload = format!("echo {marker}");

        let (status, Json(message)) = send_message(
            State(state.clone()),
            Path("sid-pty-bridge".to_string()),
            Json(SendMessageInput {
                content: payload,
                from: Some(Participant::User),
                reply_to: None,
            }),
        )
        .await
        .expect("send_message should succeed");

        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(message.to_session_id, "sid-pty-bridge");

        let bridged = tokio::time::timeout(Duration::from_secs(5), async move {
            loop {
                match rx.recv().await {
                    Ok(crate::pty::PtyOutputMsg::Data(data)) => {
                        let text = String::from_utf8_lossy(&data);
                        if text.contains(marker) {
                            return true;
                        }
                    }
                    Ok(crate::pty::PtyOutputMsg::Eof) => return false,
                    Err(_) => return false,
                }
            }
        })
        .await
        .unwrap_or(false);

        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;

        assert!(bridged, "session message should be forwarded into PTY stdin");
    }

    #[tokio::test]
    async fn send_message_returns_conflict_when_pty_delivery_fails() {
        let state = test_state("session-host-5");
        state
            .session_store
            .create(CreateSessionInput {
                id: Some("sid-pty-missing".to_string()),
                agent_kind: "codex".to_string(),
                agent_id: None,
                source_host_id: Some("session-host-5".to_string()),
                role: Some("pty-missing".to_string()),
                context: None,
                interaction: Some(crate::session::InteractionMode::Terminal),
                pty_id: Some("missing-pty".to_string()),
                inner_session_id: None,
                parent_session_id: None,
            })
            .unwrap();

        let error = send_message(
            State(state),
            Path("sid-pty-missing".to_string()),
            Json(SendMessageInput {
                content: "deliver-this".to_string(),
                from: Some(Participant::User),
                reply_to: None,
            }),
        )
        .await
        .expect_err("send_message should fail when PTY delivery fails");

        assert_eq!(error.0, StatusCode::CONFLICT);
        assert!(error.1.contains("missing-pty"));
    }
}
