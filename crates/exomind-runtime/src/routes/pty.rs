use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio_stream::wrappers::ReceiverStream;

use crate::routes::sessions::{
    broadcast_session_created, broadcast_session_updated,
};
use crate::pty::{
    ClaudeSessionInfo, PtyAgentInfo, PtyError, PtyOutputMsg, PtyResumeRequest, PtySpawnRequest,
};
use crate::session::{CreateSessionInput, InteractionMode, SessionStatus, UpdateSessionInput, WorkContext};
use crate::AppState;

// ── Request / Response types ────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PtyInputBody {
    data: String, // base64-encoded
}

#[derive(Debug, Deserialize)]
struct PtyResizeBody {
    rows: u16,
    cols: u16,
}

#[derive(Debug, Serialize)]
struct PtyRemoveResponse {
    status: String,
    id: String,
}

// ── Error mapping ───────────────────────────────────────────────

fn map_pty_error(err: PtyError) -> (StatusCode, String) {
    match err {
        PtyError::NotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

fn resolve_session_agent_kind(command: &str) -> String {
    let normalized = command.trim().to_ascii_lowercase();
    if normalized.contains("codex") {
        "codex".to_string()
    } else if normalized.contains("claude") {
        "claude".to_string()
    } else {
        "api".to_string()
    }
}

fn build_pty_context(info: &PtyAgentInfo) -> WorkContext {
    WorkContext {
        worktree_path: Some(info.workdir.clone()),
        work_dir: Some(info.workdir.clone()),
        ..Default::default()
    }
}

fn register_pty_session(
    state: &AppState,
    info: &PtyAgentInfo,
) -> Result<(), (StatusCode, String)> {
    let session = state
        .session_store
        .create(CreateSessionInput {
            id: Some(info.id.clone()),
            agent_kind: resolve_session_agent_kind(&info.command),
            // PTY unified session tracks the terminal process via `pty_id`;
            // `agent_id` is reserved for runtime agents such as codex/claude.
            agent_id: None,
            source_host_id: Some(state.host_id.clone()),
            role: Some(info.name.clone()),
            context: Some(build_pty_context(info)),
            interaction: Some(InteractionMode::Terminal),
            pty_id: Some(info.id.clone()),
            inner_session_id: info.session_id.clone(),
            parent_session_id: None,
        })
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    broadcast_session_created(state.session_event_tx.as_ref(), &session);
    Ok(())
}

fn complete_pty_session(
    state: &AppState,
    id: &str,
) -> Result<Option<crate::session::AgentSession>, (StatusCode, String)> {
    let mut session = match state
        .session_store
        .get(id)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    {
        Some(session) => session,
        None => return Ok(None),
    };

    loop {
        match session.status {
            SessionStatus::Completed | SessionStatus::Archived => return Ok(Some(session)),
            SessionStatus::Running => {
                session = state
                    .session_store
                    .update(
                        id,
                        UpdateSessionInput {
                            status: Some(SessionStatus::Completed),
                            ..Default::default()
                        },
                    )
                    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            }
            SessionStatus::WaitingInput | SessionStatus::Paused | SessionStatus::Error => {
                session = state
                    .session_store
                    .update(
                        id,
                        UpdateSessionInput {
                            status: Some(SessionStatus::Running),
                            ..Default::default()
                        },
                    )
                    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            }
        }
    }
}

// ── Handlers ────────────────────────────────────────────────────

/// GET /pty — List all PTY agents.
async fn list_pty_agents(State(state): State<AppState>) -> Json<Vec<PtyAgentInfo>> {
    Json(state.pty_manager.list().await)
}

/// POST /pty/spawn — Spawn a new PTY process.
async fn spawn_pty_agent(
    State(state): State<AppState>,
    Json(req): Json<PtySpawnRequest>,
) -> Result<(StatusCode, Json<PtyAgentInfo>), (StatusCode, String)> {
    let info = state.pty_manager.spawn(req).await.map_err(map_pty_error)?;
    if let Err(error) = register_pty_session(&state, &info) {
        let _ = state.pty_manager.remove(&info.id).await;
        return Err(error);
    }
    Ok((StatusCode::CREATED, Json(info)))
}

/// POST /pty/resume — Resume an existing Claude session.
async fn resume_pty_agent(
    State(state): State<AppState>,
    Json(req): Json<PtyResumeRequest>,
) -> Result<(StatusCode, Json<PtyAgentInfo>), (StatusCode, String)> {
    let info = state.pty_manager.resume(req).await.map_err(map_pty_error)?;
    if let Err(error) = register_pty_session(&state, &info) {
        let _ = state.pty_manager.remove(&info.id).await;
        return Err(error);
    }
    Ok((StatusCode::CREATED, Json(info)))
}

/// GET /pty/claude-sessions — List local Claude CLI sessions.
async fn list_claude_sessions() -> Json<Vec<ClaudeSessionInfo>> {
    Json(crate::pty::PtyManager::list_claude_sessions())
}

/// GET /pty/{id}/stream — SSE stream of PTY output (base64-encoded).
///
/// On connect, replays the scrollback buffer first, then streams live output.
/// This ensures terminal content survives component remounts (fullscreen toggle,
/// tab switches, SSE reconnects).
async fn stream_pty_output(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Sse<ReceiverStream<Result<Event, Infallible>>>, (StatusCode, String)> {
    let (event_tx, event_rx) =
        tokio::sync::mpsc::channel::<Result<Event, Infallible>>(1024);

    let (buffer_snapshot, mut rx) = state
        .pty_manager
        .subscribe_output(&id)
        .await
        .map_err(map_pty_error)?;

    // Forward broadcast → mpsc in a spawned task.
    tokio::spawn(async move {
        // 1. Replay scrollback buffer.
        if !buffer_snapshot.is_empty() {
            for chunk in buffer_snapshot.chunks(4096) {
                let encoded = BASE64.encode(chunk);
                let event = Ok(Event::default().event("output").data(encoded));
                if event_tx.send(event).await.is_err() {
                    return;
                }
            }
        }

        // 2. Stream live output from the broadcast channel.
        let mut keep_alive_interval =
            tokio::time::interval(std::time::Duration::from_secs(15));
        keep_alive_interval.tick().await;

        loop {
            tokio::select! {
                result = rx.recv() => {
                    let event = match result {
                        Ok(PtyOutputMsg::Data(data)) => {
                            let encoded = BASE64.encode(&data);
                            Ok(Event::default().event("output").data(encoded))
                        }
                        Ok(PtyOutputMsg::Eof) => {
                            let _ = event_tx
                                .send(Ok(Event::default().event("eof").data("")))
                                .await;
                            return;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            let msg = format!("skipped {skipped} messages");
                            Ok(Event::default().event("warning").data(msg))
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            let _ = event_tx
                                .send(Ok(Event::default().event("eof").data("")))
                                .await;
                            return;
                        }
                    };
                    if event_tx.send(event).await.is_err() {
                        return;
                    }
                }
                _ = keep_alive_interval.tick() => {
                    if event_tx
                        .send(Ok(Event::default().event("keep-alive").data("")))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }
    });

    Ok(Sse::new(ReceiverStream::new(event_rx)))
}

/// POST /pty/{id}/input — Write to PTY stdin (base64-encoded body).
async fn write_pty_input(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<PtyInputBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let data = BASE64
        .decode(&body.data)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid base64: {e}")))?;

    state
        .pty_manager
        .write_input(&id, &data)
        .await
        .map_err(map_pty_error)?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /pty/{id}/resize — Resize PTY terminal.
async fn resize_pty(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<PtyResizeBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .pty_manager
        .resize(&id, body.rows, body.cols)
        .await
        .map_err(map_pty_error)?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /pty/{id}/stop — Stop PTY process.
async fn stop_pty_agent(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<PtyAgentInfo>, (StatusCode, String)> {
    let info = state.pty_manager.stop(&id).await.map_err(map_pty_error)?;

    if let Some(updated) = complete_pty_session(&state, &id)? {
        broadcast_session_updated(state.session_event_tx.as_ref(), &updated);
    }

    Ok(Json(info))
}

/// DELETE /pty/{id} — Remove PTY record.
async fn remove_pty_agent(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<PtyRemoveResponse>, (StatusCode, String)> {
    state
        .pty_manager
        .remove(&id)
        .await
        .map_err(map_pty_error)?;

    if let Some(updated) = complete_pty_session(&state, &id)? {
        broadcast_session_updated(state.session_event_tx.as_ref(), &updated);
    }

    Ok(Json(PtyRemoveResponse {
        status: "removed".to_string(),
        id,
    }))
}

// ── Router assembly ─────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pty", get(list_pty_agents))
        .route("/pty/spawn", post(spawn_pty_agent))
        .route("/pty/resume", post(resume_pty_agent))
        .route("/pty/claude-sessions", get(list_claude_sessions))
        .route("/pty/:id/stream", get(stream_pty_output))
        .route("/pty/:id/input", post(write_pty_input))
        .route("/pty/:id/resize", post(resize_pty))
        .route("/pty/:id/stop", post(stop_pty_agent))
        .route("/pty/:id", delete(remove_pty_agent))
}
