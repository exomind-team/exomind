use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::io::Read;

use crate::pty::{
    ClaudeSessionInfo, PtyAgentInfo, PtyError, PtyResumeRequest, PtySpawnRequest,
};
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
    Ok((StatusCode::CREATED, Json(info)))
}

/// POST /pty/resume — Resume an existing Claude session.
async fn resume_pty_agent(
    State(state): State<AppState>,
    Json(req): Json<PtyResumeRequest>,
) -> Result<(StatusCode, Json<PtyAgentInfo>), (StatusCode, String)> {
    let info = state.pty_manager.resume(req).await.map_err(map_pty_error)?;
    Ok((StatusCode::CREATED, Json(info)))
}

/// GET /pty/claude-sessions — List local Claude CLI sessions.
async fn list_claude_sessions() -> Json<Vec<ClaudeSessionInfo>> {
    Json(crate::pty::PtyManager::list_claude_sessions())
}

/// GET /pty/{id}/stream — SSE stream of PTY output (base64-encoded).
async fn stream_pty_output(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)>
{
    let reader = state
        .pty_manager
        .get_reader(&id)
        .await
        .map_err(map_pty_error)?;

    let stream = async_stream::stream! {
        let mut keep_alive_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        // Skip first immediate tick.
        keep_alive_interval.tick().await;

        loop {
            let reader_clone = reader.clone();
            let read_result = tokio::task::spawn_blocking(move || {
                let mut guard = reader_clone.blocking_lock();
                let mut local_buf = [0u8; 4096];
                match guard.read(&mut local_buf) {
                    Ok(0) => Ok(None),
                    Ok(n) => Ok(Some(local_buf[..n].to_vec())),
                    Err(e) => Err(e),
                }
            });

            tokio::select! {
                result = read_result => {
                    match result {
                        Ok(Ok(Some(data))) => {
                            let encoded = BASE64.encode(&data);
                            yield Ok(Event::default().event("output").data(encoded));
                        }
                        Ok(Ok(None)) => {
                            // EOF
                            yield Ok(Event::default().event("eof").data(""));
                            break;
                        }
                        Ok(Err(_)) => {
                            // IO error — treat as EOF.
                            yield Ok(Event::default().event("eof").data(""));
                            break;
                        }
                        Err(_) => {
                            // JoinError — task panicked or was cancelled.
                            yield Ok(Event::default().event("eof").data(""));
                            break;
                        }
                    }
                }
                _ = keep_alive_interval.tick() => {
                    yield Ok(Event::default().event("keep-alive").data(""));
                }
            }
        }
    };

    Ok(Sse::new(stream))
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
