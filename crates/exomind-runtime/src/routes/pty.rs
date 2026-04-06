use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::ReceiverStream;

use crate::AppState;
use crate::config::types::USER_CONFIG_SCOPE;
use crate::pty::{
    ClaudeSessionInfo, PtyAgentInfo, PtyAgentStatus, PtyAgentType, PtyError,
    PtyHistoricalSessionInfo, PtyHistoricalSessionPreview, PtyOutputMsg, PtyResumeRequest,
    PtySpawnRequest,
};
use crate::routes::sessions::{
    broadcast_session_created, broadcast_session_updated,
    restore_terminal_session_to_running_on_input,
};
use crate::session::{
    CreateSessionInput, InteractionMode, SessionStatus, UpdateSessionInput, WorkContext,
};

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

#[derive(Debug, Deserialize)]
struct HistoricalSessionsQuery {
    agent_type: PtyAgentType,
}

#[derive(Debug, Deserialize)]
struct HistoricalSessionDetailQuery {
    agent_type: PtyAgentType,
    session_id: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct PtyStreamEofPayload {
    code: Option<i32>,
}

const PTY_WAITING_INPUT_IDLE_TIMEOUT_CONFIG_KEY: &str = "exomind:ptyWaitingInputIdleTimeoutSeconds";
const DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS: u64 = 30;
const MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS: u64 = 1;
const MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS: u64 = 600;
const PTY_REPLAY_LIMIT_KB_CONFIG_KEY: &str = "exomind:ptyTerminalReplayLimitKb";
const DEFAULT_PTY_REPLAY_LIMIT_KB: usize = 256;
const MIN_PTY_REPLAY_LIMIT_KB: usize = 128;
const MAX_PTY_REPLAY_LIMIT_KB: usize = 2048;
const PTY_LIFECYCLE_POLL_INTERVAL: Duration = Duration::from_millis(250);

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

fn fill_source_host_id(
    mut session: crate::session::AgentSession,
    host_id: &str,
) -> crate::session::AgentSession {
    if session.source_host_id.is_none() {
        session.source_host_id = Some(host_id.to_string());
    }
    session
}

fn serialize_pty_eof_payload(exit_code: Option<i32>) -> Option<String> {
    exit_code.and_then(|code| serde_json::to_string(&PtyStreamEofPayload { code: Some(code) }).ok())
}

fn build_pty_eof_event(exit_code: Option<i32>) -> Event {
    let event = Event::default().event("eof");
    if let Some(payload) = serialize_pty_eof_payload(exit_code) {
        event.data(payload)
    } else {
        event.data("")
    }
}

fn build_pty_ready_event() -> Event {
    Event::default().event("ready").data("{}")
}

fn clamp_pty_waiting_input_idle_timeout_seconds(value: u64) -> u64 {
    value.clamp(
        MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
        MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS,
    )
}

fn clamp_pty_replay_limit_kb(value: usize) -> usize {
    value.clamp(MIN_PTY_REPLAY_LIMIT_KB, MAX_PTY_REPLAY_LIMIT_KB)
}

fn resolve_pty_waiting_input_idle_timeout(state: &AppState) -> Duration {
    let configured = state
        .config_store
        .get(USER_CONFIG_SCOPE, PTY_WAITING_INPUT_IDLE_TIMEOUT_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|entry| entry.value.trim().parse::<u64>().ok());

    Duration::from_secs(clamp_pty_waiting_input_idle_timeout_seconds(
        configured.unwrap_or(DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS),
    ))
}

fn resolve_pty_replay_limit_bytes(state: &AppState) -> usize {
    let configured = state
        .config_store
        .get(USER_CONFIG_SCOPE, PTY_REPLAY_LIMIT_KB_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|entry| entry.value.trim().parse::<usize>().ok());

    clamp_pty_replay_limit_kb(configured.unwrap_or(DEFAULT_PTY_REPLAY_LIMIT_KB)) * 1024
}

fn sync_pty_replay_limit_from_config(state: &AppState) {
    state
        .pty_manager
        .set_scrollback_limit_bytes(resolve_pty_replay_limit_bytes(state));
}

async fn resolve_pty_exit_code_for_eof(state: &AppState, id: &str) -> Option<i32> {
    match state.pty_manager.refresh_process_state(id).await {
        Ok(Some(info)) => match info.status {
            PtyAgentStatus::Exited { code } => Some(code),
            _ => None,
        },
        Ok(None) | Err(_) => None,
    }
}

fn register_pty_session(state: &AppState, info: &PtyAgentInfo) -> Result<(), (StatusCode, String)> {
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

fn find_terminal_session_by_pty_id(
    state: &AppState,
    pty_id: &str,
) -> Result<Option<crate::session::AgentSession>, (StatusCode, String)> {
    let sessions = state
        .session_store
        .list()
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(sessions.into_iter().find(|session| {
        session.interaction_mode == InteractionMode::Terminal
            && session.pty_id.as_deref() == Some(pty_id)
    }))
}

async fn maybe_mark_terminal_session_waiting_for_idle(
    state: &AppState,
    pty_id: &str,
) -> Result<(), (StatusCode, String)> {
    let timeout = resolve_pty_waiting_input_idle_timeout(state);
    let idle_for = state
        .pty_manager
        .activity_idle_for(pty_id)
        .await
        .map_err(map_pty_error)?;

    if idle_for < timeout {
        return Ok(());
    }

    let Some(session) = find_terminal_session_by_pty_id(state, pty_id)? else {
        return Ok(());
    };

    let should_mark_waiting = if session.status != SessionStatus::Running {
        false
    } else {
        let updated = state
            .session_store
            .update(
                &session.id,
                UpdateSessionInput {
                    status: Some(SessionStatus::WaitingInput),
                    ..Default::default()
                },
            )
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        let updated = fill_source_host_id(updated, &state.host_id);
        broadcast_session_updated(state.session_event_tx.as_ref(), &updated);
        true
    };

    if should_mark_waiting {
        tracing::debug!(pty_id = %pty_id, "auto-marked PTY session as waiting_input after idle timeout");
    }

    Ok(())
}

fn watch_pty_lifecycle(state: AppState, id: String) {
    tokio::spawn(async move {
        loop {
            match state.pty_manager.refresh_process_state(&id).await {
                Ok(Some(info)) => match info.status {
                    crate::pty::PtyAgentStatus::Exited { code } => {
                        if code != 0 {
                            tracing::warn!(
                                pty_id = %id,
                                session_id = ?info.session_id,
                                command = %info.command,
                                exit_code = code,
                                "PTY process exited with non-zero status"
                            );
                        }
                        match complete_pty_session(&state, &id) {
                            Ok(Some(updated)) => {
                                broadcast_session_updated(
                                    state.session_event_tx.as_ref(),
                                    &updated,
                                );
                            }
                            Ok(None) => {}
                            Err((status, error)) => {
                                tracing::warn!(
                                    pty_id = %id,
                                    status = %status,
                                    error = %error,
                                    "failed to complete PTY-backed session after natural exit"
                                );
                            }
                        }
                        break;
                    }
                    crate::pty::PtyAgentStatus::Stopped => break,
                    crate::pty::PtyAgentStatus::Running => {}
                },
                Ok(None) => {
                    if let Err((status, error)) =
                        maybe_mark_terminal_session_waiting_for_idle(&state, &id).await
                    {
                        tracing::warn!(
                            pty_id = %id,
                            status = %status,
                            error = %error,
                            "failed to auto-mark PTY session as waiting_input"
                        );
                    }
                }
                Err(PtyError::NotFound { .. }) => break,
                Err(error) => {
                    tracing::warn!(pty_id = %id, error = %error, "failed to refresh PTY process state");
                    break;
                }
            }
            tokio::time::sleep(PTY_LIFECYCLE_POLL_INTERVAL).await;
        }
    });
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
    sync_pty_replay_limit_from_config(&state);
    let info = state.pty_manager.spawn(req).await.map_err(map_pty_error)?;
    if let Err(error) = register_pty_session(&state, &info) {
        let _ = state.pty_manager.remove(&info.id).await;
        return Err(error);
    }
    watch_pty_lifecycle(state.clone(), info.id.clone());
    Ok((StatusCode::CREATED, Json(info)))
}

/// POST /pty/resume — Resume an existing Claude session.
async fn resume_pty_agent(
    State(state): State<AppState>,
    Json(req): Json<PtyResumeRequest>,
) -> Result<(StatusCode, Json<PtyAgentInfo>), (StatusCode, String)> {
    sync_pty_replay_limit_from_config(&state);
    let session_id = req.session_id.clone();
    let agent_type = req.agent_type;
    let info = match state.pty_manager.resume(req).await {
        Ok(info) => info,
        Err(error) => {
            tracing::warn!(
                ?agent_type,
                session_id = %session_id,
                error = %error,
                "failed to resume PTY agent"
            );
            return Err(map_pty_error(error));
        }
    };
    if let Err(error) = register_pty_session(&state, &info) {
        let _ = state.pty_manager.remove(&info.id).await;
        return Err(error);
    }
    watch_pty_lifecycle(state.clone(), info.id.clone());
    Ok((StatusCode::CREATED, Json(info)))
}

/// GET /pty/claude-sessions — List local Claude CLI sessions.
async fn list_claude_sessions() -> Json<Vec<ClaudeSessionInfo>> {
    Json(crate::pty::PtyManager::list_claude_sessions())
}

/// GET /pty/sessions?agent_type=... — List local PTY historical sessions by agent type.
async fn list_historical_sessions(
    Query(query): Query<HistoricalSessionsQuery>,
) -> Json<Vec<PtyHistoricalSessionPreview>> {
    Json(crate::pty::PtyManager::list_historical_session_previews(
        query.agent_type,
    ))
}

/// GET /pty/sessions/detail?agent_type=...&session_id=... — Fetch full historical session metadata.
async fn get_historical_session_detail(
    Query(query): Query<HistoricalSessionDetailQuery>,
) -> Result<Json<PtyHistoricalSessionInfo>, StatusCode> {
    crate::pty::PtyManager::get_historical_session(query.agent_type, query.session_id.trim())
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
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
    sync_pty_replay_limit_from_config(&state);
    let (event_tx, event_rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(1024);

    let live_subscription = match state.pty_manager.subscribe_output(&id).await {
        Ok((buffer_snapshot, rx)) => Some((buffer_snapshot, rx)),
        Err(PtyError::NotFound { .. }) => None,
        Err(error) => return Err(map_pty_error(error)),
    };
    let persisted_snapshot = if live_subscription.is_none() {
        match state.pty_manager.load_persisted_output(&id).await {
            Ok(Some(buffer_snapshot)) => Some(buffer_snapshot),
            Ok(None) => {
                return Err(map_pty_error(PtyError::NotFound { id }));
            }
            Err(error) => return Err(map_pty_error(error)),
        }
    } else {
        None
    };

    // Forward broadcast → mpsc in a spawned task.
    tokio::spawn(async move {
        let stream_state = state.clone();
        let stream_id = id.clone();
        let (buffer_snapshot, rx) = match live_subscription {
            Some((buffer_snapshot, rx)) => (buffer_snapshot, Some(rx)),
            None => (persisted_snapshot.unwrap_or_default(), None),
        };

        // 0. Emit an immediate ready event so clients can flush headers and
        // transition out of "connecting" even when the PTY is currently idle.
        if event_tx.send(Ok(build_pty_ready_event())).await.is_err() {
            return;
        }

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

        if rx.is_none() {
            let _ = event_tx.send(Ok(build_pty_eof_event(None))).await;
            return;
        }

        // 2. Stream live output from the broadcast channel.
        let mut keep_alive_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        keep_alive_interval.tick().await;
        let mut rx = rx.expect("live subscription should include broadcast receiver");

        loop {
            tokio::select! {
                result = rx.recv() => {
                    let event = match result {
                        Ok(PtyOutputMsg::Data(data)) => {
                            let encoded = BASE64.encode(&data);
                            Ok(Event::default().event("output").data(encoded))
                        }
                        Ok(PtyOutputMsg::Eof) => {
                            let exit_code =
                                resolve_pty_exit_code_for_eof(&stream_state, &stream_id).await;
                            let _ = event_tx
                                .send(Ok(build_pty_eof_event(exit_code)))
                                .await;
                            return;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            let msg = format!("skipped {skipped} messages");
                            Ok(Event::default().event("warning").data(msg))
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            let exit_code =
                                resolve_pty_exit_code_for_eof(&stream_state, &stream_id).await;
                            let _ = event_tx
                                .send(Ok(build_pty_eof_event(exit_code)))
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
    let _ = restore_terminal_session_to_running_on_input(&state, &id)?;

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
    state.pty_manager.remove(&id).await.map_err(map_pty_error)?;

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
        .route("/pty/sessions", get(list_historical_sessions))
        .route("/pty/sessions/detail", get(get_historical_session_detail))
        .route("/pty/claude-sessions", get(list_claude_sessions))
        .route("/pty/:id/stream", get(stream_pty_output))
        .route("/pty/:id/input", post(write_pty_input))
        .route("/pty/:id/resize", post(resize_pty))
        .route("/pty/:id/stop", post(stop_pty_agent))
        .route("/pty/:id", delete(remove_pty_agent))
}

#[cfg(test)]
mod tests {
    use super::{
        PTY_WAITING_INPUT_IDLE_TIMEOUT_CONFIG_KEY, register_pty_session, router,
        serialize_pty_eof_payload, stream_pty_output, watch_pty_lifecycle,
    };
    use axum::body::Body;
    use axum::extract::{Path, State};
    use axum::http::{Request, StatusCode};
    use axum::response::IntoResponse;
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use futures_util::StreamExt;
    use std::time::Duration;
    use tower::ServiceExt;

    use crate::AppState;
    use crate::config::PutConfigEntryInput;
    use crate::config::types::USER_CONFIG_SCOPE;
    use crate::session::{InteractionMode, SessionStatus, UpdateSessionInput};

    #[cfg(not(target_os = "android"))]
    fn interactive_shell_spawn_request() -> crate::pty::PtySpawnRequest {
        if cfg!(windows) {
            crate::pty::PtySpawnRequest {
                name: "ready-shell".to_string(),
                workdir: Some(".".to_string()),
                command: "cmd".to_string(),
                args: vec!["/Q".to_string(), "/K".to_string()],
                rows: 24,
                cols: 80,
            }
        } else {
            crate::pty::PtySpawnRequest {
                name: "ready-shell".to_string(),
                workdir: Some(".".to_string()),
                command: "sh".to_string(),
                args: vec![],
                rows: 24,
                cols: 80,
            }
        }
    }

    #[test]
    fn serialize_pty_eof_payload_includes_known_exit_code() {
        assert_eq!(
            serialize_pty_eof_payload(Some(1)).as_deref(),
            Some(r#"{"code":1}"#)
        );
        assert_eq!(
            serialize_pty_eof_payload(Some(0)).as_deref(),
            Some(r#"{"code":0}"#)
        );
    }

    #[test]
    fn serialize_pty_eof_payload_omits_unknown_exit_code() {
        assert_eq!(serialize_pty_eof_payload(None), None);
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn stream_pty_output_emits_ready_event_before_terminal_output() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ready-host".to_string());
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");

        let sse = stream_pty_output(Path(pty.id.clone()), State(state.clone()))
            .await
            .expect("pty stream should open");
        let response = sse.into_response();
        let mut stream = response.into_body().into_data_stream();
        let first_chunk = tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("ready chunk should arrive promptly")
            .expect("body should yield first chunk")
            .expect("first chunk should be ok");
        let first_text =
            String::from_utf8(first_chunk.to_vec()).expect("first chunk should be utf-8");

        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;

        assert!(
            first_text.contains("event: ready"),
            "expected ready event first, got: {first_text}"
        );
    }

    async fn wait_for_session_status(state: &AppState, session_id: &str, expected: SessionStatus) {
        let started = tokio::time::Instant::now();
        loop {
            let session = state
                .session_store
                .get(session_id)
                .expect("session lookup should succeed")
                .expect("session should exist");
            if session.status == expected {
                return;
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "timed out waiting for session {session_id} to reach {:?}, got {:?}",
                expected,
                session.status
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn idle_pty_session_auto_transitions_to_waiting_input() {
        let (_tempdir, state) = AppState::new_isolated_test_runtime(0, "pty-idle-host".to_string());
        state
            .config_store
            .put(PutConfigEntryInput {
                scope: USER_CONFIG_SCOPE.to_string(),
                key: PTY_WAITING_INPUT_IDLE_TIMEOUT_CONFIG_KEY.to_string(),
                value: "1".to_string(),
                sensitive: false,
                source: Some("pty-route-test".to_string()),
                source_origin: None,
            })
            .expect("idle timeout config should persist");

        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");
        register_pty_session(&state, &pty).expect("PTY-backed session should register");
        watch_pty_lifecycle(state.clone(), pty.id.clone());

        wait_for_session_status(&state, &pty.id, SessionStatus::WaitingInput).await;

        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn write_pty_input_route_wakes_waiting_input_session() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-input-host".to_string());
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");
        register_pty_session(&state, &pty).expect("PTY-backed session should register");
        state
            .session_store
            .update(
                &pty.id,
                UpdateSessionInput {
                    status: Some(SessionStatus::WaitingInput),
                    ..Default::default()
                },
            )
            .expect("session should transition to waiting_input for test setup");

        let app = router().with_state(state.clone());
        let payload = serde_json::json!({
            "data": BASE64.encode("\n"),
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/pty/{}/input", pty.id))
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .expect("write input request should succeed");

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let session = state
            .session_store
            .get(&pty.id)
            .expect("session lookup should succeed")
            .expect("session should exist");
        assert_eq!(session.interaction_mode, InteractionMode::Terminal);
        assert_eq!(session.status, SessionStatus::Running);

        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
    }
}
