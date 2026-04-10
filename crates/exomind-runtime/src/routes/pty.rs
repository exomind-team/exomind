use axum::extract::{
    Path, Query, State,
    ws::{Message, WebSocket, WebSocketUpgrade},
};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

use crate::AppState;
use crate::config::types::USER_CONFIG_SCOPE;
use crate::pty::{
    ClaudeSessionInfo, PtyAgentInfo, PtyAgentStatus, PtyAgentType, PtyError,
    PtyHistoricalSessionInfo, PtyHistoricalSessionPreview, PtyOutputMsg, PtyOutputReplaySnapshot,
    PtyResumeRequest, PtySpawnRequest,
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
struct PtyResizeBody {
    rows: u16,
    cols: u16,
}

#[derive(Debug, Deserialize, Default)]
struct PtyWsQuery {
    cursor: Option<u64>,
    mode: Option<PtyWsMode>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PtyWsMode {
    Duplex,
    Input,
    Output,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PtyWsClientMessage {
    Input {
        input_seq: u64,
        data: String,
    },
    Resize {
        resize_seq: u64,
        rows: u16,
        cols: u16,
    },
    Ping {
        nonce: Option<u64>,
    },
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
struct PtyWsCapabilities {
    input_ack: bool,
    resize: bool,
    resize_ack: bool,
    output_stream: bool,
    output_cursor: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PtyWsServerMessage {
    Ready {
        protocol_version: u8,
        capabilities: PtyWsCapabilities,
        read_only: bool,
    },
    OutputReset {
        offset: u64,
        truncated: bool,
    },
    Output {
        offset: u64,
        data: String,
    },
    Eof {
        offset: u64,
        code: Option<i32>,
    },
    Ack {
        input_seq: u64,
    },
    ResizeAck {
        resize_seq: u64,
    },
    Pong {
        nonce: Option<u64>,
    },
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input_seq: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resize_seq: Option<u64>,
    },
}

#[derive(Debug)]
struct PtyWsStreamSource {
    snapshot: PtyOutputReplaySnapshot,
    live_rx: Option<broadcast::Receiver<PtyOutputMsg>>,
    read_only: bool,
}

const PTY_WAITING_INPUT_IDLE_TIMEOUT_CONFIG_KEY: &str = "exomind:ptyWaitingInputIdleTimeoutSeconds";
const DEFAULT_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS: u64 = 60;
const MIN_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS: u64 = 1;
const MAX_PTY_WAITING_INPUT_IDLE_TIMEOUT_SECONDS: u64 = 600;
const PTY_REPLAY_LIMIT_KB_CONFIG_KEY: &str = "exomind:ptyTerminalReplayLimitKb";
const DEFAULT_PTY_REPLAY_LIMIT_KB: usize = 256;
const MIN_PTY_REPLAY_LIMIT_KB: usize = 128;
const MAX_PTY_REPLAY_LIMIT_KB: usize = 2048;
const PTY_LIFECYCLE_POLL_INTERVAL: Duration = Duration::from_millis(250);
const PTY_WS_PROTOCOL_VERSION: u8 = 3;
const PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS: i64 = 15_000;
const PTY_INNER_SESSION_DETECTION_INTERVAL_MS: u64 = 2_000;
const PTY_INNER_SESSION_DETECTION_CANDIDATE_WINDOW_MS: i64 = 15 * 60_000;

#[derive(Debug, Clone)]
struct PtyHistoricalSessionBackfillPlan {
    agent_type: PtyAgentType,
    baseline_session_ids: Vec<String>,
    started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HistoricalSessionBindingKind {
    Fresh,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HistoricalSessionBindingSnapshot {
    matched_session_id: Option<String>,
    matched_kind: Option<HistoricalSessionBindingKind>,
    exact_match_ids: Vec<String>,
    fresh_exact_match_ids: Vec<String>,
    baseline_exact_match_ids: Vec<String>,
    saw_mismatched_recent_candidate: bool,
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

fn fill_source_host_id(
    mut session: crate::session::AgentSession,
    host_id: &str,
) -> crate::session::AgentSession {
    if session.source_host_id.is_none() {
        session.source_host_id = Some(host_id.to_string());
    }
    session
}

fn resolve_builtin_pty_agent_type(command: &str) -> Option<PtyAgentType> {
    let normalized = command.trim().to_ascii_lowercase();
    if normalized.contains("claude") {
        Some(PtyAgentType::Claude)
    } else if normalized.contains("codex") {
        Some(PtyAgentType::Codex)
    } else {
        None
    }
}

fn normalize_comparable_path(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn encode_claude_project_path(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(['\\', '/'])
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn normalize_historical_project_path(agent_type: PtyAgentType, project_path: &str) -> String {
    if agent_type == PtyAgentType::Claude {
        project_path.trim().to_ascii_lowercase()
    } else {
        normalize_comparable_path(project_path)
    }
}

fn normalize_expected_project_path(agent_type: PtyAgentType, workdir: &str) -> String {
    if agent_type == PtyAgentType::Claude {
        encode_claude_project_path(workdir).to_ascii_lowercase()
    } else {
        normalize_comparable_path(workdir)
    }
}

fn is_absolute_path_like(value: &str) -> bool {
    let trimmed = value.trim();
    let bytes = trimmed.as_bytes();
    (bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with('/')
}

fn parse_historical_session_modified_at(
    session: &PtyHistoricalSessionInfo,
) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(session.last_modified.trim())
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn is_historical_session_within_window(
    session: &PtyHistoricalSessionInfo,
    lower_bound: DateTime<Utc>,
    upper_bound: DateTime<Utc>,
) -> bool {
    match parse_historical_session_modified_at(session) {
        Some(modified_at) => modified_at >= lower_bound && modified_at <= upper_bound,
        None => true,
    }
}

fn collect_unique_session_ids<'a, I>(sessions: I) -> Vec<String>
where
    I: IntoIterator<Item = &'a PtyHistoricalSessionInfo>,
{
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for session in sessions {
        if seen.insert(session.session_id.clone()) {
            ids.push(session.session_id.clone());
        }
    }
    ids
}

fn dedupe_historical_sessions_by_id(
    sessions: Vec<PtyHistoricalSessionInfo>,
) -> Vec<PtyHistoricalSessionInfo> {
    let mut deduped = HashMap::<String, PtyHistoricalSessionInfo>::new();
    for session in sessions {
        let replace = match deduped.get(&session.session_id) {
            Some(existing) => match (
                parse_historical_session_modified_at(existing),
                parse_historical_session_modified_at(&session),
            ) {
                (None, _) => true,
                (Some(_), Some(candidate_modified_at)) => parse_historical_session_modified_at(
                    existing,
                )
                .is_some_and(|existing_modified_at| candidate_modified_at > existing_modified_at),
                (Some(_), None) => false,
            },
            None => true,
        };
        if replace {
            deduped.insert(session.session_id.clone(), session);
        }
    }
    deduped.into_values().collect()
}

fn resolve_historical_session_binding_snapshot(
    sessions: &[PtyHistoricalSessionInfo],
    agent_type: PtyAgentType,
    baseline_session_ids: &HashSet<String>,
    expected_workdir: &str,
    lower_bound: DateTime<Utc>,
    upper_bound: DateTime<Utc>,
) -> HistoricalSessionBindingSnapshot {
    let normalized_expected_workdir = normalize_expected_project_path(agent_type, expected_workdir);
    let matches_expected_workdir = |session: &&PtyHistoricalSessionInfo| {
        normalize_historical_project_path(agent_type, session.project_path.as_str())
            == normalized_expected_workdir
    };

    let recent_candidates = sessions
        .iter()
        .filter(|session| is_historical_session_within_window(session, lower_bound, upper_bound))
        .collect::<Vec<_>>();
    let recent_exact_matches = recent_candidates
        .iter()
        .copied()
        .filter(matches_expected_workdir)
        .collect::<Vec<_>>();
    let fresh_exact_matches = recent_exact_matches
        .iter()
        .copied()
        .filter(|session| !baseline_session_ids.contains(session.session_id.as_str()))
        .collect::<Vec<_>>();
    let baseline_exact_matches = sessions
        .iter()
        .filter(|session| {
            baseline_session_ids.contains(session.session_id.as_str())
                && normalize_historical_project_path(agent_type, session.project_path.as_str())
                    == normalized_expected_workdir
        })
        .collect::<Vec<_>>();

    let fresh_exact_match_ids = collect_unique_session_ids(fresh_exact_matches.iter().copied());
    let baseline_exact_match_ids =
        collect_unique_session_ids(baseline_exact_matches.iter().copied());
    let exact_match_ids = fresh_exact_match_ids.clone();
    let matched_session_id = (exact_match_ids.len() == 1).then(|| exact_match_ids[0].clone());
    let matched_kind = matched_session_id
        .as_ref()
        .map(|_| HistoricalSessionBindingKind::Fresh);

    HistoricalSessionBindingSnapshot {
        matched_session_id,
        matched_kind,
        exact_match_ids,
        fresh_exact_match_ids,
        baseline_exact_match_ids,
        saw_mismatched_recent_candidate: recent_candidates.len() > recent_exact_matches.len(),
    }
}

async fn list_historical_sessions_for_detection(
    agent_type: PtyAgentType,
) -> Result<Vec<PtyHistoricalSessionInfo>, String> {
    tokio::task::spawn_blocking(move || {
        crate::pty::PtyManager::list_historical_sessions(agent_type)
    })
    .await
    .map(dedupe_historical_sessions_by_id)
    .map_err(|error| format!("historical session discovery task failed: {error}"))
}

async fn build_historical_session_backfill_plan(
    command: &str,
    started_at: DateTime<Utc>,
) -> Option<PtyHistoricalSessionBackfillPlan> {
    let agent_type = resolve_builtin_pty_agent_type(command)?;
    let baseline_session_ids = match list_historical_sessions_for_detection(agent_type).await {
        Ok(sessions) => collect_unique_session_ids(sessions.iter()),
        Err(error) => {
            tracing::warn!(
                ?agent_type,
                error = %error,
                "failed to capture baseline historical sessions before PTY spawn"
            );
            Vec::new()
        }
    };
    Some(PtyHistoricalSessionBackfillPlan {
        agent_type,
        baseline_session_ids,
        started_at,
    })
}

async fn sync_live_pty_inner_session_id(state: &AppState, pty_id: &str, inner_session_id: &str) {
    match state
        .pty_manager
        .attach_session_id(pty_id, inner_session_id.to_string())
        .await
    {
        Ok(_) => {}
        Err(PtyError::NotFound { .. }) => {
            tracing::debug!(
                pty_id = %pty_id,
                inner_session_id = %inner_session_id,
                "skipped live PTY session id sync because PTY no longer exists"
            );
        }
        Err(error) => {
            tracing::warn!(
                pty_id = %pty_id,
                inner_session_id = %inner_session_id,
                error = %error,
                "failed to sync live PTY session id"
            );
        }
    }
}

async fn read_persisted_pty_inner_session_id(
    state: &AppState,
    pty_id: &str,
) -> Result<Option<String>, String> {
    let session = state
        .session_store
        .get(pty_id)
        .map_err(|error| error.to_string())?;
    if let Some(session) = session {
        if let Some(inner_session_id) = session.inner_session_id {
            sync_live_pty_inner_session_id(state, pty_id, &inner_session_id).await;
            return Ok(Some(inner_session_id));
        }
    }
    Ok(None)
}

async fn persist_pty_inner_session_id(
    state: &AppState,
    pty_id: &str,
    inner_session_id: &str,
) -> Result<(), String> {
    let session = state
        .session_store
        .get(pty_id)
        .map_err(|error| error.to_string())?;

    let Some(session) = session else {
        return Ok(());
    };

    if let Some(existing_inner_session_id) = session.inner_session_id.as_deref() {
        if existing_inner_session_id != inner_session_id {
            tracing::warn!(
                pty_id = %pty_id,
                persisted_inner_session_id = %existing_inner_session_id,
                attempted_inner_session_id = %inner_session_id,
                "skipped PTY inner session backfill because a different value is already persisted"
            );
        }
        sync_live_pty_inner_session_id(state, pty_id, existing_inner_session_id).await;
        return Ok(());
    }

    let updated = state
        .session_store
        .update(
            pty_id,
            UpdateSessionInput {
                inner_session_id: Some(inner_session_id.to_string()),
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())?;
    let updated = fill_source_host_id(updated, &state.host_id);
    broadcast_session_updated(state.session_event_tx.as_ref(), &updated);
    sync_live_pty_inner_session_id(state, pty_id, inner_session_id).await;
    Ok(())
}

fn watch_spawned_pty_inner_session_backfill(
    state: AppState,
    info: PtyAgentInfo,
    plan: PtyHistoricalSessionBackfillPlan,
) {
    if info.session_id.is_some() || !is_absolute_path_like(&info.workdir) {
        return;
    }

    tokio::spawn(async move {
        let baseline_session_ids = plan
            .baseline_session_ids
            .into_iter()
            .collect::<HashSet<_>>();
        let lower_bound = plan.started_at
            - ChronoDuration::milliseconds(PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS);
        let upper_bound = plan.started_at
            + ChronoDuration::milliseconds(PTY_INNER_SESSION_DETECTION_CANDIDATE_WINDOW_MS);
        let max_attempts = ((PTY_INNER_SESSION_DETECTION_CANDIDATE_WINDOW_MS
            + PTY_INNER_SESSION_DETECTION_INTERVAL_MS as i64
            - 1)
            / PTY_INNER_SESSION_DETECTION_INTERVAL_MS as i64)
            .max(1) as usize;
        let mut last_snapshot = HistoricalSessionBindingSnapshot {
            matched_session_id: None,
            matched_kind: None,
            exact_match_ids: Vec::new(),
            fresh_exact_match_ids: Vec::new(),
            baseline_exact_match_ids: Vec::new(),
            saw_mismatched_recent_candidate: false,
        };

        for attempt in 0..max_attempts {
            match read_persisted_pty_inner_session_id(&state, &info.id).await {
                Ok(Some(existing_inner_session_id)) => {
                    tracing::debug!(
                        pty_id = %info.id,
                        inner_session_id = %existing_inner_session_id,
                        ?plan.agent_type,
                        "PTY inner session id already persisted before runtime backfill completed"
                    );
                    return;
                }
                Ok(None) => {}
                Err(error) => {
                    tracing::warn!(
                        pty_id = %info.id,
                        ?plan.agent_type,
                        error = %error,
                        "failed to inspect persisted PTY inner session id during backfill"
                    );
                    return;
                }
            }

            let sessions = match list_historical_sessions_for_detection(plan.agent_type).await {
                Ok(sessions) => sessions,
                Err(error) => {
                    if attempt + 1 == max_attempts {
                        tracing::warn!(
                            pty_id = %info.id,
                            ?plan.agent_type,
                            error = %error,
                            "failed to load historical sessions for PTY inner session backfill"
                        );
                    }
                    if attempt + 1 < max_attempts {
                        tokio::time::sleep(Duration::from_millis(
                            PTY_INNER_SESSION_DETECTION_INTERVAL_MS,
                        ))
                        .await;
                    }
                    continue;
                }
            };

            let snapshot = resolve_historical_session_binding_snapshot(
                &sessions,
                plan.agent_type,
                &baseline_session_ids,
                &info.workdir,
                lower_bound,
                upper_bound,
            );

            if let Some(matched_session_id) = snapshot.matched_session_id.clone() {
                if let Err(error) =
                    persist_pty_inner_session_id(&state, &info.id, &matched_session_id).await
                {
                    tracing::warn!(
                        pty_id = %info.id,
                        ?plan.agent_type,
                        matched_session_id = %matched_session_id,
                        error = %error,
                        "failed to persist PTY inner session id backfill"
                    );
                }
                return;
            }

            last_snapshot = snapshot;
            if attempt + 1 < max_attempts {
                tokio::time::sleep(Duration::from_millis(
                    PTY_INNER_SESSION_DETECTION_INTERVAL_MS,
                ))
                .await;
            }
        }

        tracing::warn!(
            pty_id = %info.id,
            ?plan.agent_type,
            expected_workdir = %info.workdir,
            candidate_window_ms = PTY_INNER_SESSION_DETECTION_CANDIDATE_WINDOW_MS,
            exact_match_count = last_snapshot.exact_match_ids.len(),
            exact_match_ids = ?last_snapshot.exact_match_ids,
            fresh_exact_match_count = last_snapshot.fresh_exact_match_ids.len(),
            fresh_exact_match_ids = ?last_snapshot.fresh_exact_match_ids,
            baseline_exact_match_count = last_snapshot.baseline_exact_match_ids.len(),
            baseline_exact_match_ids = ?last_snapshot.baseline_exact_match_ids,
            saw_mismatched_recent_candidate = last_snapshot.saw_mismatched_recent_candidate,
            "unable to safely detect historical session id"
        );
    });
}

fn build_pty_ws_ready_message(read_only: bool) -> PtyWsServerMessage {
    PtyWsServerMessage::Ready {
        protocol_version: PTY_WS_PROTOCOL_VERSION,
        capabilities: PtyWsCapabilities {
            input_ack: !read_only,
            resize: !read_only,
            resize_ack: !read_only,
            output_stream: true,
            output_cursor: true,
        },
        read_only,
    }
}

fn build_pty_ws_output_reset_message(snapshot: &PtyOutputReplaySnapshot) -> PtyWsServerMessage {
    PtyWsServerMessage::OutputReset {
        offset: snapshot.offset,
        truncated: snapshot.truncated,
    }
}

fn build_pty_ws_output_message(offset: u64, data: &[u8]) -> PtyWsServerMessage {
    PtyWsServerMessage::Output {
        offset,
        data: BASE64.encode(data),
    }
}

fn build_pty_ws_eof_message(offset: u64, code: Option<i32>) -> PtyWsServerMessage {
    PtyWsServerMessage::Eof { offset, code }
}

fn build_pty_ws_ack_message(input_seq: u64) -> PtyWsServerMessage {
    PtyWsServerMessage::Ack { input_seq }
}

fn build_pty_ws_resize_ack_message(resize_seq: u64) -> PtyWsServerMessage {
    PtyWsServerMessage::ResizeAck { resize_seq }
}

fn build_pty_ws_pong_message(nonce: Option<u64>) -> PtyWsServerMessage {
    PtyWsServerMessage::Pong { nonce }
}

fn map_pty_ws_error_code(status: StatusCode) -> &'static str {
    match status {
        StatusCode::BAD_REQUEST => "bad_request",
        StatusCode::UNAUTHORIZED => "unauthorized",
        StatusCode::FORBIDDEN => "forbidden",
        StatusCode::NOT_FOUND => "not_found",
        _ => "transport_error",
    }
}

fn build_pty_ws_error_message(
    status: StatusCode,
    message: impl Into<String>,
    input_seq: Option<u64>,
    resize_seq: Option<u64>,
) -> PtyWsServerMessage {
    PtyWsServerMessage::Error {
        code: map_pty_ws_error_code(status).to_string(),
        message: message.into(),
        input_seq,
        resize_seq,
    }
}

fn serialize_pty_ws_message(message: &PtyWsServerMessage) -> Message {
    let payload = serde_json::to_string(message)
        .expect("PTY WS server message serialization should not fail");
    Message::Text(payload.into())
}

async fn queue_pty_ws_message(tx: &mpsc::Sender<Message>, message: PtyWsServerMessage) -> bool {
    tx.send(serialize_pty_ws_message(&message)).await.is_ok()
}

async fn queue_pty_ws_frame(tx: &mpsc::Sender<Message>, frame: Message) -> bool {
    tx.send(frame).await.is_ok()
}

async fn queue_pty_ws_close(tx: &mpsc::Sender<Message>) -> bool {
    queue_pty_ws_frame(tx, Message::Close(None)).await
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

async fn maybe_upgrade_snapshot_from_transcript(
    state: &AppState,
    id: &str,
    cursor: Option<u64>,
    snapshot: PtyOutputReplaySnapshot,
) -> PtyOutputReplaySnapshot {
    if cursor.is_none() || !snapshot.truncated {
        return snapshot;
    }

    match state.pty_manager.load_persisted_output(id, cursor).await {
        Ok(Some(persisted)) if persisted.offset < snapshot.offset => persisted,
        _ => snapshot,
    }
}

async fn resolve_pty_ws_stream_source(
    state: &AppState,
    id: &str,
    cursor: Option<u64>,
) -> Result<PtyWsStreamSource, (StatusCode, String)> {
    match state.pty_manager.subscribe_output(id, cursor).await {
        Ok((snapshot, eof_offset, live_rx)) => {
            let snapshot =
                maybe_upgrade_snapshot_from_transcript(state, id, cursor, snapshot).await;
            let live_info = state
                .pty_manager
                .refresh_process_state(id)
                .await
                .map_err(map_pty_error)?;
            let is_running = !matches!(
                live_info,
                Some(info)
                    if matches!(info.status, PtyAgentStatus::Stopped | PtyAgentStatus::Exited { .. })
            );
            Ok(PtyWsStreamSource {
                snapshot,
                live_rx: if eof_offset.is_none() {
                    Some(live_rx)
                } else {
                    None
                },
                read_only: !is_running,
            })
        }
        Err(PtyError::NotFound { .. }) => {
            match state.pty_manager.load_completed_output(id, cursor).await {
                Ok(Some(snapshot)) => Ok(PtyWsStreamSource {
                    snapshot,
                    live_rx: None,
                    read_only: true,
                }),
                Ok(None) => Err(map_pty_error(PtyError::NotFound { id: id.to_string() })),
                Err(error) => Err(map_pty_error(error)),
            }
        }
        Err(error) => Err(map_pty_error(error)),
    }
}

async fn resolve_pty_ws_input_source(
    state: &AppState,
    id: &str,
) -> Result<PtyWsStreamSource, (StatusCode, String)> {
    let live_info = state
        .pty_manager
        .refresh_process_state(id)
        .await
        .map_err(map_pty_error)?;

    match live_info {
        Some(info)
            if matches!(
                info.status,
                PtyAgentStatus::Stopped | PtyAgentStatus::Exited { .. }
            ) =>
        {
            Err(map_pty_error(PtyError::NotFound { id: id.to_string() }))
        }
        Some(_) | None => Ok(PtyWsStreamSource {
            snapshot: PtyOutputReplaySnapshot::default(),
            live_rx: None,
            read_only: false,
        }),
    }
}

async fn queue_pty_ws_output_bytes(
    tx: &mpsc::Sender<Message>,
    offset: u64,
    data: &[u8],
    current_offset: &mut u64,
) -> bool {
    let mut chunk_offset = offset;
    let mut remaining = data;

    if chunk_offset < *current_offset {
        let skip = (*current_offset - chunk_offset) as usize;
        if skip >= remaining.len() {
            return true;
        }
        chunk_offset = chunk_offset.saturating_add(skip as u64);
        remaining = &remaining[skip..];
    }

    for chunk in remaining.chunks(4096) {
        if !queue_pty_ws_message(tx, build_pty_ws_output_message(chunk_offset, chunk)).await {
            return false;
        }
        chunk_offset = chunk_offset.saturating_add(chunk.len() as u64);
    }

    *current_offset = chunk_offset;
    true
}

async fn queue_pty_ws_output_snapshot(
    tx: &mpsc::Sender<Message>,
    snapshot: &PtyOutputReplaySnapshot,
    current_offset: &mut u64,
    force_reset: bool,
) -> bool {
    let needs_reset = force_reset || snapshot.truncated || snapshot.offset != *current_offset;
    if needs_reset {
        if !queue_pty_ws_message(tx, build_pty_ws_output_reset_message(snapshot)).await {
            return false;
        }
        *current_offset = snapshot.offset;
    }

    if snapshot.data.is_empty() {
        return true;
    }

    queue_pty_ws_output_bytes(tx, snapshot.offset, &snapshot.data, current_offset).await
}

async fn recover_pty_ws_output_stream(
    tx: &mpsc::Sender<Message>,
    state: &AppState,
    id: &str,
    current_offset: &mut u64,
) -> Option<broadcast::Receiver<PtyOutputMsg>> {
    match state
        .pty_manager
        .subscribe_output(id, Some(*current_offset))
        .await
    {
        Ok((snapshot, eof_offset, live_rx)) => {
            let snapshot =
                maybe_upgrade_snapshot_from_transcript(state, id, Some(*current_offset), snapshot)
                    .await;
            let read_only = match state.pty_manager.refresh_process_state(id).await {
                Ok(info) => info,
                Err(error) => {
                    let _ = queue_pty_ws_message(
                        tx,
                        build_pty_ws_error_message(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("failed to refresh PTY status during recovery: {error}"),
                            None,
                            None,
                        ),
                    )
                    .await;
                    let _ = queue_pty_ws_close(tx).await;
                    return None;
                }
            }
            .is_some_and(|info| {
                matches!(
                    info.status,
                    PtyAgentStatus::Stopped | PtyAgentStatus::Exited { .. }
                )
            });
            if !queue_pty_ws_output_snapshot(tx, &snapshot, current_offset, false).await {
                return None;
            }
            if eof_offset.is_none() {
                Some(live_rx)
            } else {
                let exit_code = resolve_pty_exit_code_for_eof(state, id).await;
                let final_offset = if read_only {
                    (*current_offset).max(eof_offset.unwrap_or(*current_offset))
                } else {
                    *current_offset
                };
                let _ = queue_pty_ws_message(tx, build_pty_ws_eof_message(final_offset, exit_code))
                    .await;
                let _ = queue_pty_ws_close(tx).await;
                None
            }
        }
        Err(PtyError::NotFound { .. }) => {
            if let Ok(Some(snapshot)) = state
                .pty_manager
                .load_completed_output(id, Some(*current_offset))
                .await
            {
                if !queue_pty_ws_output_snapshot(tx, &snapshot, current_offset, false).await {
                    return None;
                }
                let exit_code = resolve_pty_exit_code_for_eof(state, id).await;
                let _ =
                    queue_pty_ws_message(tx, build_pty_ws_eof_message(*current_offset, exit_code))
                        .await;
                let _ = queue_pty_ws_close(tx).await;
                return None;
            }
            let _ = queue_pty_ws_message(
                tx,
                build_pty_ws_error_message(
                    StatusCode::NOT_FOUND,
                    format!("PTY {id} was removed before output recovery completed"),
                    None,
                    None,
                ),
            )
            .await;
            let _ = queue_pty_ws_close(tx).await;
            None
        }
        Err(error) => {
            let _ = queue_pty_ws_message(
                tx,
                build_pty_ws_error_message(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to recover PTY output stream: {error}"),
                    None,
                    None,
                ),
            )
            .await;
            let _ = queue_pty_ws_close(tx).await;
            None
        }
    }
}

async fn pump_pty_ws_output(
    tx: mpsc::Sender<Message>,
    state: AppState,
    id: String,
    source: PtyWsStreamSource,
) {
    if !queue_pty_ws_message(&tx, build_pty_ws_ready_message(source.read_only)).await {
        return;
    }

    let mut current_offset = source.snapshot.offset;
    if !queue_pty_ws_output_snapshot(&tx, &source.snapshot, &mut current_offset, true).await {
        return;
    }

    let Some(mut live_rx) = source.live_rx else {
        let exit_code = resolve_pty_exit_code_for_eof(&state, &id).await;
        let _ =
            queue_pty_ws_message(&tx, build_pty_ws_eof_message(current_offset, exit_code)).await;
        let _ = queue_pty_ws_close(&tx).await;
        return;
    };

    loop {
        match live_rx.recv().await {
            Ok(PtyOutputMsg::Data { offset, data }) => {
                let chunk_end = offset.saturating_add(data.len() as u64);
                if chunk_end <= current_offset {
                    continue;
                }

                if offset > current_offset {
                    let Some(next_live_rx) =
                        recover_pty_ws_output_stream(&tx, &state, &id, &mut current_offset).await
                    else {
                        return;
                    };
                    live_rx = next_live_rx;
                    continue;
                }

                if !queue_pty_ws_output_bytes(&tx, offset, &data, &mut current_offset).await {
                    return;
                }
            }
            Ok(PtyOutputMsg::Eof { offset }) => {
                let exit_code = resolve_pty_exit_code_for_eof(&state, &id).await;
                let final_offset = offset.max(current_offset);
                let _ =
                    queue_pty_ws_message(&tx, build_pty_ws_eof_message(final_offset, exit_code))
                        .await;
                let _ = queue_pty_ws_close(&tx).await;
                return;
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                let Some(next_live_rx) =
                    recover_pty_ws_output_stream(&tx, &state, &id, &mut current_offset).await
                else {
                    return;
                };
                live_rx = next_live_rx;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                let Some(next_live_rx) =
                    recover_pty_ws_output_stream(&tx, &state, &id, &mut current_offset).await
                else {
                    return;
                };
                live_rx = next_live_rx;
            }
        }
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

async fn apply_pty_input_bytes(
    state: &AppState,
    id: &str,
    data: &[u8],
) -> Result<(), (StatusCode, String)> {
    state
        .pty_manager
        .write_input(id, data)
        .await
        .map_err(map_pty_error)?;
    let _ = restore_terminal_session_to_running_on_input(state, id)?;
    Ok(())
}

async fn apply_pty_resize_request(
    state: &AppState,
    id: &str,
    rows: u16,
    cols: u16,
) -> Result<(), (StatusCode, String)> {
    state
        .pty_manager
        .resize(id, rows, cols)
        .await
        .map_err(map_pty_error)?;
    Ok(())
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
    let backfill_plan = build_historical_session_backfill_plan(&req.command, Utc::now()).await;
    let info = state.pty_manager.spawn(req).await.map_err(map_pty_error)?;
    if let Err(error) = register_pty_session(&state, &info) {
        let _ = state.pty_manager.remove(&info.id).await;
        return Err(error);
    }
    watch_pty_lifecycle(state.clone(), info.id.clone());
    if let Some(plan) = backfill_plan {
        watch_spawned_pty_inner_session_backfill(state.clone(), info.clone(), plan);
    }
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

async fn pty_websocket(
    Path(id): Path<String>,
    Query(query): Query<PtyWsQuery>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<Response, (StatusCode, String)> {
    sync_pty_replay_limit_from_config(&state);
    let mode = query.mode.unwrap_or(PtyWsMode::Duplex);
    let stream_source = if mode == PtyWsMode::Input {
        resolve_pty_ws_input_source(&state, &id).await?
    } else {
        resolve_pty_ws_stream_source(&state, &id, query.cursor).await?
    };
    Ok(ws.on_upgrade(move |socket| handle_pty_websocket(socket, state, id, stream_source, mode)))
}

async fn handle_pty_websocket(
    socket: WebSocket,
    state: AppState,
    id: String,
    stream_source: PtyWsStreamSource,
    mode: PtyWsMode,
) {
    let read_only = stream_source.read_only;
    let (mut socket_tx, mut socket_rx) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Message>(1024);

    let writer_task = tokio::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            if socket_tx.send(message).await.is_err() {
                return;
            }
        }
    });

    let output_task = if mode == PtyWsMode::Input {
        if !queue_pty_ws_message(&outbound_tx, build_pty_ws_ready_message(read_only)).await {
            drop(outbound_tx);
            let _ = writer_task.await;
            return;
        }
        None
    } else {
        Some(tokio::spawn(pump_pty_ws_output(
            outbound_tx.clone(),
            state.clone(),
            id.clone(),
            stream_source,
        )))
    };

    while let Some(result) = socket_rx.next().await {
        let message = match result {
            Ok(message) => message,
            Err(error) => {
                tracing::debug!(pty_id = %id, error = %error, "PTY WS receive failed");
                break;
            }
        };

        let payload = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => match String::from_utf8(bytes.to_vec()) {
                Ok(text) => text,
                Err(error) => {
                    let _ = queue_pty_ws_message(
                        &outbound_tx,
                        build_pty_ws_error_message(
                            StatusCode::BAD_REQUEST,
                            format!("invalid websocket payload: {error}"),
                            None,
                            None,
                        ),
                    )
                    .await;
                    continue;
                }
            },
            Message::Ping(payload) => {
                if !queue_pty_ws_frame(&outbound_tx, Message::Pong(payload)).await {
                    break;
                }
                continue;
            }
            Message::Pong(_) => continue,
            Message::Close(_) => break,
        };

        let parsed = match serde_json::from_str::<PtyWsClientMessage>(&payload) {
            Ok(parsed) => parsed,
            Err(error) => {
                let _ = queue_pty_ws_message(
                    &outbound_tx,
                    build_pty_ws_error_message(
                        StatusCode::BAD_REQUEST,
                        format!("invalid websocket json: {error}"),
                        None,
                        None,
                    ),
                )
                .await;
                continue;
            }
        };

        match parsed {
            PtyWsClientMessage::Input { input_seq, data } => {
                if read_only {
                    let _ = queue_pty_ws_message(
                        &outbound_tx,
                        build_pty_ws_error_message(
                            StatusCode::FORBIDDEN,
                            "PTY websocket is read-only",
                            Some(input_seq),
                            None,
                        ),
                    )
                    .await;
                    continue;
                }

                let decoded = match BASE64.decode(&data) {
                    Ok(decoded) => decoded,
                    Err(error) => {
                        let _ = queue_pty_ws_message(
                            &outbound_tx,
                            build_pty_ws_error_message(
                                StatusCode::BAD_REQUEST,
                                format!("invalid base64: {error}"),
                                Some(input_seq),
                                None,
                            ),
                        )
                        .await;
                        continue;
                    }
                };

                match apply_pty_input_bytes(&state, &id, &decoded).await {
                    Ok(()) => {
                        if !queue_pty_ws_message(&outbound_tx, build_pty_ws_ack_message(input_seq))
                            .await
                        {
                            break;
                        }
                    }
                    Err((status, message)) => {
                        let _ = queue_pty_ws_message(
                            &outbound_tx,
                            build_pty_ws_error_message(status, message, Some(input_seq), None),
                        )
                        .await;
                    }
                }
            }
            PtyWsClientMessage::Resize {
                resize_seq,
                rows,
                cols,
            } => {
                if read_only {
                    let _ = queue_pty_ws_message(
                        &outbound_tx,
                        build_pty_ws_error_message(
                            StatusCode::FORBIDDEN,
                            "PTY websocket is read-only",
                            None,
                            Some(resize_seq),
                        ),
                    )
                    .await;
                    continue;
                }

                match apply_pty_resize_request(&state, &id, rows, cols).await {
                    Ok(()) => {
                        if !queue_pty_ws_message(
                            &outbound_tx,
                            build_pty_ws_resize_ack_message(resize_seq),
                        )
                        .await
                        {
                            break;
                        }
                    }
                    Err((status, message)) => {
                        let _ = queue_pty_ws_message(
                            &outbound_tx,
                            build_pty_ws_error_message(status, message, None, Some(resize_seq)),
                        )
                        .await;
                    }
                }
            }
            PtyWsClientMessage::Ping { nonce } => {
                if !queue_pty_ws_message(&outbound_tx, build_pty_ws_pong_message(nonce)).await {
                    break;
                }
            }
        }
    }

    if let Some(output_task) = output_task {
        output_task.abort();
    }
    drop(outbound_tx);
    let _ = writer_task.await;
}

/// POST /pty/{id}/resize — Resize PTY terminal.
async fn resize_pty(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<PtyResizeBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    apply_pty_resize_request(&state, &id, body.rows, body.cols).await?;
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
        .route("/pty/:id/ws", get(pty_websocket))
        .route("/pty/:id/resize", post(resize_pty))
        .route("/pty/:id/stop", post(stop_pty_agent))
        .route("/pty/:id", delete(remove_pty_agent))
}

#[cfg(test)]
mod tests {
    use super::{
        HistoricalSessionBindingKind, PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS,
        PTY_WAITING_INPUT_IDLE_TIMEOUT_CONFIG_KEY, PTY_WS_PROTOCOL_VERSION, PtyWsServerMessage,
        PtyWsStreamSource, persist_pty_inner_session_id, pump_pty_ws_output, register_pty_session,
        resolve_historical_session_binding_snapshot, resolve_pty_waiting_input_idle_timeout,
        router, watch_pty_lifecycle,
    };
    use axum::Router;
    use axum::body::Body;
    use axum::extract::ws::Message;
    use axum::http::{Request, StatusCode};
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use chrono::{DateTime, Duration as ChronoDuration, Utc};
    use futures_util::{SinkExt, StreamExt};
    use std::{net::SocketAddr, time::Duration};
    use tokio::net::TcpListener;
    use tokio::sync::{broadcast, mpsc};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
    use tower::ServiceExt;

    use crate::AppState;
    use crate::config::PutConfigEntryInput;
    use crate::config::types::USER_CONFIG_SCOPE;
    use crate::pty::{
        PtyAgentType, PtyHistoricalSessionInfo, PtyOutputMsg, PtyOutputReplaySnapshot,
    };
    use crate::session::{SessionStatus, UpdateSessionInput};

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

    async fn spawn_router_server(app: Router) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let addr = listener
            .local_addr()
            .expect("listener should expose local addr");
        let handle = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .expect("test router should serve");
        });
        (addr, handle)
    }

    async fn read_ws_json(
        stream: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> PtyWsServerMessage {
        let next = tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("websocket message should arrive promptly")
            .expect("websocket stream should stay open")
            .expect("websocket frame should decode");
        let text = next.into_text().expect("websocket frame should be text");
        serde_json::from_str(text.as_ref()).expect("websocket payload should be valid json")
    }

    async fn read_ws_json_until<F>(
        stream: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        mut predicate: F,
    ) -> PtyWsServerMessage
    where
        F: FnMut(&PtyWsServerMessage) -> bool,
    {
        loop {
            let message = read_ws_json(stream).await;
            if predicate(&message) {
                return message;
            }
        }
    }

    async fn read_queued_ws_frame(rx: &mut mpsc::Receiver<Message>) -> Message {
        tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("queued websocket frame should arrive promptly")
            .expect("queued websocket frame should exist")
    }

    fn decode_queued_ws_json(frame: Message) -> PtyWsServerMessage {
        match frame {
            Message::Text(text) => serde_json::from_str(text.as_ref())
                .expect("queued websocket payload should be valid json"),
            other => panic!("expected queued websocket text frame, got {other:?}"),
        }
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

    #[test]
    fn default_pty_waiting_input_idle_timeout_is_60_seconds() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-default-timeout-host".to_string());

        assert_eq!(
            resolve_pty_waiting_input_idle_timeout(&state),
            Duration::from_secs(60)
        );
    }

    fn historical_session(
        agent_type: PtyAgentType,
        session_id: &str,
        project_path: &str,
        last_modified: &str,
    ) -> PtyHistoricalSessionInfo {
        PtyHistoricalSessionInfo {
            agent_type,
            session_id: session_id.to_string(),
            project_path: project_path.to_string(),
            last_modified: last_modified.to_string(),
            display_title: None,
            display_path: None,
            first_user_message: None,
            last_user_message: None,
        }
    }

    #[test]
    fn historical_session_binding_prefers_unique_fresh_codex_match() {
        let started_at = DateTime::parse_from_rfc3339("2026-04-02T00:00:00.000Z")
            .expect("started_at should parse")
            .with_timezone(&Utc);
        let lower_bound =
            started_at - ChronoDuration::milliseconds(PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS);
        let upper_bound = started_at + ChronoDuration::minutes(15);
        let sessions = vec![
            historical_session(
                PtyAgentType::Codex,
                "codex-thread-existing",
                "D:/project/exomind",
                "2026-04-01T23:59:00.000Z",
            ),
            historical_session(
                PtyAgentType::Codex,
                "codex-thread-fresh",
                "D:/project/exomind",
                "2026-04-02T00:00:05.000Z",
            ),
        ];
        let baseline = ["codex-thread-existing".to_string()]
            .into_iter()
            .collect::<std::collections::HashSet<_>>();

        let snapshot = resolve_historical_session_binding_snapshot(
            &sessions,
            PtyAgentType::Codex,
            &baseline,
            "D:/project/exomind",
            lower_bound,
            upper_bound,
        );

        assert_eq!(
            snapshot.matched_session_id.as_deref(),
            Some("codex-thread-fresh")
        );
        assert_eq!(
            snapshot.matched_kind,
            Some(HistoricalSessionBindingKind::Fresh)
        );
        assert_eq!(
            snapshot.exact_match_ids,
            vec!["codex-thread-fresh".to_string()]
        );
        assert_eq!(
            snapshot.baseline_exact_match_ids,
            vec!["codex-thread-existing".to_string()]
        );
    }

    #[test]
    fn historical_session_binding_matches_encoded_claude_workdir() {
        let started_at = DateTime::parse_from_rfc3339("2026-04-02T00:00:00.000Z")
            .expect("started_at should parse")
            .with_timezone(&Utc);
        let lower_bound =
            started_at - ChronoDuration::milliseconds(PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS);
        let upper_bound = started_at + ChronoDuration::minutes(15);
        let sessions = vec![historical_session(
            PtyAgentType::Claude,
            "claude-thread-fresh",
            "H--A137442-Develop-AGI-exomind",
            "2026-04-02T00:00:05.000Z",
        )];

        let snapshot = resolve_historical_session_binding_snapshot(
            &sessions,
            PtyAgentType::Claude,
            &std::collections::HashSet::new(),
            "H:/A137442/Develop/AGI/exomind",
            lower_bound,
            upper_bound,
        );

        assert_eq!(
            snapshot.matched_session_id.as_deref(),
            Some("claude-thread-fresh")
        );
        assert_eq!(
            snapshot.matched_kind,
            Some(HistoricalSessionBindingKind::Fresh)
        );
    }

    #[test]
    fn historical_session_binding_rejects_baseline_only_matches_for_fresh_spawn() {
        let started_at = DateTime::parse_from_rfc3339("2026-04-02T00:00:00.000Z")
            .expect("started_at should parse")
            .with_timezone(&Utc);
        let lower_bound =
            started_at - ChronoDuration::milliseconds(PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS);
        let upper_bound = started_at + ChronoDuration::minutes(15);
        let sessions = vec![historical_session(
            PtyAgentType::Codex,
            "codex-thread-existing",
            "D:/project/exomind",
            "2026-04-02T00:00:05.000Z",
        )];
        let baseline = ["codex-thread-existing".to_string()]
            .into_iter()
            .collect::<std::collections::HashSet<_>>();

        let snapshot = resolve_historical_session_binding_snapshot(
            &sessions,
            PtyAgentType::Codex,
            &baseline,
            "D:/project/exomind",
            lower_bound,
            upper_bound,
        );

        assert_eq!(snapshot.matched_session_id, None);
        assert!(snapshot.exact_match_ids.is_empty());
        assert!(snapshot.fresh_exact_match_ids.is_empty());
        assert_eq!(
            snapshot.baseline_exact_match_ids,
            vec!["codex-thread-existing".to_string()]
        );
    }

    #[test]
    fn historical_session_binding_rejects_ambiguous_fresh_matches() {
        let started_at = DateTime::parse_from_rfc3339("2026-04-02T00:00:00.000Z")
            .expect("started_at should parse")
            .with_timezone(&Utc);
        let lower_bound =
            started_at - ChronoDuration::milliseconds(PTY_INNER_SESSION_DETECTION_CLOCK_SKEW_MS);
        let upper_bound = started_at + ChronoDuration::minutes(15);
        let sessions = vec![
            historical_session(
                PtyAgentType::Codex,
                "codex-thread-a",
                "D:/project/exomind",
                "2026-04-02T00:00:05.000Z",
            ),
            historical_session(
                PtyAgentType::Codex,
                "codex-thread-b",
                "D:/project/exomind",
                "2026-04-02T00:00:06.000Z",
            ),
        ];

        let snapshot = resolve_historical_session_binding_snapshot(
            &sessions,
            PtyAgentType::Codex,
            &std::collections::HashSet::new(),
            "D:/project/exomind",
            lower_bound,
            upper_bound,
        );

        assert_eq!(snapshot.matched_session_id, None);
        assert_eq!(
            snapshot.exact_match_ids,
            vec!["codex-thread-a".to_string(), "codex-thread-b".to_string()]
        );
        assert_eq!(snapshot.fresh_exact_match_ids, snapshot.exact_match_ids);
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn persist_pty_inner_session_id_updates_session_row_and_live_pty_info() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-backfill-persist-host".to_string());
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");
        register_pty_session(&state, &pty).expect("PTY-backed session should register");

        persist_pty_inner_session_id(&state, &pty.id, "codex-thread-fresh")
            .await
            .expect("inner session id should persist");

        let session = state
            .session_store
            .get(&pty.id)
            .expect("session lookup should succeed")
            .expect("session should exist");
        assert_eq!(
            session.inner_session_id.as_deref(),
            Some("codex-thread-fresh")
        );

        let live_pty = state
            .pty_manager
            .list()
            .await
            .into_iter()
            .find(|info| info.id == pty.id)
            .expect("live pty should still exist");
        assert_eq!(live_pty.session_id.as_deref(), Some("codex-thread-fresh"));

        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
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
    async fn legacy_pty_input_route_returns_not_found() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-legacy-input-host".to_string());
        let app = router().with_state(state.clone());
        let legacy_input_path = format!("/pty/missing-legacy/{}", ["in", "put"].concat());
        let payload = serde_json::json!({
            "data": BASE64.encode("\n"),
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(legacy_input_path)
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .expect("legacy input route probe should complete");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn legacy_pty_stream_route_returns_not_found() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-legacy-stream-host".to_string());
        let app = router().with_state(state);
        let legacy_stream_path = format!("/pty/missing-legacy/{}", ["str", "eam"].concat());
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(legacy_stream_path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("legacy stream route probe should complete");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn pty_websocket_route_acks_input_and_wakes_waiting_input_session() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-input-host".to_string());
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

        let (addr, server) = spawn_router_server(router().with_state(state.clone())).await;
        let url = format!("ws://{addr}/pty/{}/ws", pty.id);
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("PTY websocket should connect");

        let ready = read_ws_json(&mut socket).await;
        assert_eq!(
            ready,
            PtyWsServerMessage::Ready {
                protocol_version: PTY_WS_PROTOCOL_VERSION,
                capabilities: super::PtyWsCapabilities {
                    input_ack: true,
                    resize: true,
                    resize_ack: true,
                    output_stream: true,
                    output_cursor: true,
                },
                read_only: false,
            }
        );

        let payload = serde_json::json!({
            "type": "input",
            "input_seq": 7,
            "data": BASE64.encode("\n"),
        });
        socket
            .send(TungsteniteMessage::Text(payload.to_string().into()))
            .await
            .expect("input websocket frame should send");

        let ack = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::Ack { .. })
        })
        .await;
        assert_eq!(ack, PtyWsServerMessage::Ack { input_seq: 7 });

        let session = state
            .session_store
            .get(&pty.id)
            .expect("session lookup should succeed")
            .expect("session should exist");
        assert_eq!(session.status, SessionStatus::Running);

        let _ = socket.close(None).await;
        server.abort();
        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn pty_websocket_route_reports_invalid_base64_without_ack() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-invalid-input-host".to_string());
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");

        let (addr, server) = spawn_router_server(router().with_state(state.clone())).await;
        let url = format!("ws://{addr}/pty/{}/ws", pty.id);
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("PTY websocket should connect");

        let _ = read_ws_json(&mut socket).await;

        let payload = serde_json::json!({
            "type": "input",
            "input_seq": 9,
            "data": "@@@not-base64@@@",
        });
        socket
            .send(TungsteniteMessage::Text(payload.to_string().into()))
            .await
            .expect("invalid websocket frame should send");

        let error = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::Error { .. })
        })
        .await;
        match error {
            PtyWsServerMessage::Error {
                code,
                message,
                input_seq,
                resize_seq,
            } => {
                assert_eq!(code, "bad_request");
                assert_eq!(input_seq, Some(9));
                assert_eq!(resize_seq, None);
                assert!(message.starts_with("invalid base64:"));
            }
            other => panic!("expected websocket error frame, got {other:?}"),
        }

        let _ = socket.close(None).await;
        server.abort();
        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn pty_websocket_route_acks_resize_after_applying_geometry() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-resize-host".to_string());
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");

        let (addr, server) = spawn_router_server(router().with_state(state.clone())).await;
        let url = format!("ws://{addr}/pty/{}/ws", pty.id);
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("PTY websocket should connect");

        let ready = read_ws_json(&mut socket).await;
        assert_eq!(
            ready,
            PtyWsServerMessage::Ready {
                protocol_version: PTY_WS_PROTOCOL_VERSION,
                capabilities: super::PtyWsCapabilities {
                    input_ack: true,
                    resize: true,
                    resize_ack: true,
                    output_stream: true,
                    output_cursor: true,
                },
                read_only: false,
            }
        );

        let payload = serde_json::json!({
            "type": "resize",
            "resize_seq": 3,
            "rows": 31,
            "cols": 111,
        });
        socket
            .send(TungsteniteMessage::Text(payload.to_string().into()))
            .await
            .expect("resize websocket frame should send");

        let ack = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::ResizeAck { .. })
        })
        .await;
        assert_eq!(ack, PtyWsServerMessage::ResizeAck { resize_seq: 3 });

        let _ = socket.close(None).await;
        server.abort();
        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn pty_websocket_input_mode_suppresses_output_stream_frames() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-input-mode-host".to_string());
        let pty = state
            .pty_manager
            .spawn(interactive_shell_spawn_request())
            .await
            .expect("pty shell should spawn");

        let (addr, server) = spawn_router_server(router().with_state(state.clone())).await;
        let url = format!("ws://{addr}/pty/{}/ws?mode=input", pty.id);
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("PTY websocket should connect");

        let ready = read_ws_json(&mut socket).await;
        assert_eq!(
            ready,
            PtyWsServerMessage::Ready {
                protocol_version: PTY_WS_PROTOCOL_VERSION,
                capabilities: super::PtyWsCapabilities {
                    input_ack: true,
                    resize: true,
                    resize_ack: true,
                    output_stream: true,
                    output_cursor: true,
                },
                read_only: false,
            }
        );

        let next_frame = tokio::time::timeout(Duration::from_millis(200), socket.next()).await;
        assert!(
            next_frame.is_err(),
            "input-only websocket should not receive output frames before it sends input"
        );

        let payload = serde_json::json!({
            "type": "input",
            "input_seq": 11,
            "data": BASE64.encode("\n"),
        });
        socket
            .send(TungsteniteMessage::Text(payload.to_string().into()))
            .await
            .expect("input websocket frame should send");

        let ack = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::Ack { .. })
        })
        .await;
        assert_eq!(ack, PtyWsServerMessage::Ack { input_seq: 11 });

        let _ = socket.close(None).await;
        server.abort();
        let _ = state.pty_manager.stop(&pty.id).await;
        let _ = state.pty_manager.remove(&pty.id).await;
    }

    #[tokio::test]
    async fn pty_websocket_input_mode_returns_not_found_for_persisted_history_without_live_pty() {
        let (tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-input-missing-live-host".to_string());
        let pty_id = "persisted-pty-input-only";
        let transcript_dir = tempdir.path().join("runtime-data").join("pty-transcripts");
        std::fs::create_dir_all(&transcript_dir).expect("transcript dir should exist");
        std::fs::write(
            transcript_dir.join(format!("{pty_id}.log")),
            b"prompt\r\nhistory\r\n",
        )
        .expect("transcript should persist");
        std::fs::write(transcript_dir.join(format!("{pty_id}.eof")), b"0")
            .expect("completion marker should persist");

        let (addr, server) = spawn_router_server(router().with_state(state.clone())).await;
        let url = format!("ws://{addr}/pty/{pty_id}/ws?mode=input");
        let error = connect_async(&url)
            .await
            .expect_err("input-only websocket should reject missing live PTYs");
        match error {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), StatusCode::NOT_FOUND);
            }
            other => panic!("expected websocket handshake 404, got {other:?}"),
        }

        server.abort();
    }

    #[tokio::test]
    async fn pump_pty_ws_output_drains_read_only_tail_before_eof() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-read-only-tail-host".to_string());
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<Message>(16);
        let (live_tx, _) = broadcast::channel::<PtyOutputMsg>(16);
        let source = PtyWsStreamSource {
            snapshot: PtyOutputReplaySnapshot::default(),
            live_rx: Some(live_tx.subscribe()),
            read_only: true,
        };

        let task = tokio::spawn(pump_pty_ws_output(
            outbound_tx,
            state.clone(),
            "missing-pty".to_string(),
            source,
        ));

        assert_eq!(
            decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await),
            PtyWsServerMessage::Ready {
                protocol_version: PTY_WS_PROTOCOL_VERSION,
                capabilities: super::PtyWsCapabilities {
                    input_ack: false,
                    resize: false,
                    resize_ack: false,
                    output_stream: true,
                    output_cursor: true,
                },
                read_only: true,
            }
        );
        assert_eq!(
            decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await),
            PtyWsServerMessage::OutputReset {
                offset: 0,
                truncated: false,
            }
        );

        live_tx
            .send(PtyOutputMsg::Data {
                offset: 0,
                data: b"tail".to_vec(),
            })
            .expect("tail output should broadcast");
        live_tx
            .send(PtyOutputMsg::Eof { offset: 4 })
            .expect("EOF should broadcast");

        assert_eq!(
            decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await),
            PtyWsServerMessage::Output {
                offset: 0,
                data: BASE64.encode(b"tail"),
            }
        );
        assert_eq!(
            decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await),
            PtyWsServerMessage::Eof {
                offset: 4,
                code: None,
            }
        );

        let close_frame = read_queued_ws_frame(&mut outbound_rx).await;
        assert!(matches!(close_frame, Message::Close(_)));
        task.await.expect("pump task should finish cleanly");
    }

    #[tokio::test]
    async fn pump_pty_ws_output_reports_not_found_when_recovery_loses_unfinished_stream() {
        let (_tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-recovery-not-found-host".to_string());
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<Message>(16);
        let (live_tx, _) = broadcast::channel::<PtyOutputMsg>(16);
        let source = PtyWsStreamSource {
            snapshot: PtyOutputReplaySnapshot::default(),
            live_rx: Some(live_tx.subscribe()),
            read_only: true,
        };

        let task = tokio::spawn(pump_pty_ws_output(
            outbound_tx,
            state.clone(),
            "missing-pty".to_string(),
            source,
        ));

        let _ready = decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await);
        let _reset = decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await);

        drop(live_tx);

        let error = decode_queued_ws_json(read_queued_ws_frame(&mut outbound_rx).await);
        match error {
            PtyWsServerMessage::Error { code, message, .. } => {
                assert_eq!(code, "not_found");
                assert!(message.contains("removed before output recovery completed"));
            }
            other => panic!("expected not_found recovery error, got {other:?}"),
        }

        let close_frame = read_queued_ws_frame(&mut outbound_rx).await;
        assert!(matches!(close_frame, Message::Close(_)));
        task.await.expect("pump task should finish cleanly");
    }

    #[tokio::test]
    #[cfg(not(target_os = "android"))]
    async fn pty_websocket_reconnect_to_persisted_output_is_read_only_and_eof_terminated() {
        let (tempdir, state) =
            AppState::new_isolated_test_runtime(0, "pty-ws-stopped-host".to_string());
        let pty_id = "persisted-pty-output";
        let marker = "websocket-finished";
        let transcript_dir = tempdir.path().join("runtime-data").join("pty-transcripts");
        std::fs::create_dir_all(&transcript_dir).expect("transcript dir should exist");
        let transcript_path = transcript_dir.join(format!("{pty_id}.log"));
        let completion_path = transcript_dir.join(format!("{pty_id}.eof"));
        std::fs::write(&transcript_path, format!("prompt\r\n{marker}\r\n"))
            .expect("transcript should persist");
        std::fs::write(&completion_path, b"0").expect("completion marker should persist");

        let (addr, server) = spawn_router_server(router().with_state(state.clone())).await;
        let url = format!("ws://{addr}/pty/{pty_id}/ws?mode=output");
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("PTY websocket should connect");

        let ready = read_ws_json(&mut socket).await;
        assert_eq!(
            ready,
            PtyWsServerMessage::Ready {
                protocol_version: PTY_WS_PROTOCOL_VERSION,
                capabilities: super::PtyWsCapabilities {
                    input_ack: false,
                    resize: false,
                    resize_ack: false,
                    output_stream: true,
                    output_cursor: true,
                },
                read_only: true,
            }
        );

        let _reset = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::OutputReset { .. })
        })
        .await;
        let output = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::Output { .. })
        })
        .await;
        match output {
            PtyWsServerMessage::Output { data, .. } => {
                let decoded = BASE64
                    .decode(data)
                    .expect("persisted websocket output should decode");
                assert!(
                    String::from_utf8_lossy(&decoded).contains(marker),
                    "persisted websocket output should include transcript marker"
                );
            }
            other => panic!("expected output frame after reconnect, got {other:?}"),
        }
        let eof = read_ws_json_until(&mut socket, |message| {
            matches!(message, PtyWsServerMessage::Eof { .. })
        })
        .await;
        assert!(
            matches!(eof, PtyWsServerMessage::Eof { .. }),
            "expected EOF after reconnecting to a stopped PTY"
        );

        let close_frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("close frame should arrive")
            .expect("socket should yield close frame")
            .expect("close frame should decode");
        assert!(close_frame.is_close());

        server.abort();
    }
}
