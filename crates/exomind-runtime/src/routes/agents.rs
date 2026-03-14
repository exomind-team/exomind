use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use async_stream::stream;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::convert::Infallible;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::routes::sessions::{broadcast_session_created, broadcast_session_updated};
use crate::agent::{self, Agent, AgentSummary, ChatChunk, ChatRequest, RuntimeAgentEvent, SessionInfo};
use crate::session::{CreateSessionInput, InteractionMode, UpdateSessionInput, WorkContext};

#[derive(Debug, Deserialize)]
struct ChatRequestPayload {
    message: String,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct AgentStatsQuery {
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateAgentPayload {
    kind: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    provider_profile: Option<ApiProviderProfilePayload>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiProviderProfilePayload {
    provider: String,
    model: String,
    #[serde(default)]
    base_url: Option<String>,
    api_key: String,
}

#[derive(Debug, Serialize)]
struct DeleteAgentResponse {
    status: String,
    id: String,
}

/// Agent routes (Agent 相关路由).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agents", get(list_agents).post(create_agent))
        .route("/agents/:id", delete(delete_agent))
        .route("/agents/:id/chat", post(chat_with_agent))
        .route("/agents/:id/stats", get(agent_stats))
        .route("/agents/:id/sessions", get(list_sessions))
        .route(
            "/agents/:id/sessions/:sid",
            get(get_session).delete(close_session),
        )
}

async fn list_agents(State(state): State<AppState>) -> Json<Vec<crate::agent::AgentSummary>> {
    Json(state.registry.list())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn agent_summary(agent: &Arc<dyn Agent>) -> AgentSummary {
    AgentSummary {
        id: agent.id().to_string(),
        name: agent.name().to_string(),
        description: agent.description().to_string(),
        status: agent.status().to_string(),
        subscriptions: agent.subscriptions(),
        publications: agent.publications(),
        tick_interval_secs: agent.tick_interval_secs(),
    }
}

fn is_valid_runtime_agent_id(id: &str) -> bool {
    id.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn generate_runtime_agent_id(prefix: &str) -> String {
    let short = Uuid::new_v4().simple().to_string();
    format!("{prefix}-{}", &short[..8])
}

fn encode_runtime_event(event: RuntimeAgentEvent) -> Event {
    let encoded = serde_json::to_string(&event).expect("RuntimeAgentEvent serialization failed");
    Event::default().data(encoded)
}

fn map_chat_chunk_to_runtime_events(chunk: ChatChunk) -> Vec<RuntimeAgentEvent> {
    let mut events = Vec::new();

    if let Some(session_id) = chunk.session_id {
        events.push(RuntimeAgentEvent::session_started(session_id));
    }
    if !chunk.content.is_empty() {
        events.push(RuntimeAgentEvent::output_delta(chunk.content));
    }

    events
}

fn resolve_agent_session_kind(agent_id: &str) -> String {
    let normalized = agent_id.trim().to_ascii_lowercase();
    if normalized.contains("codex") {
        "codex".to_string()
    } else if normalized.contains("claude") {
        "claude".to_string()
    } else {
        "api".to_string()
    }
}

fn truncate_output_preview(preview: &str) -> String {
    const MAX_CHARS: usize = 240;
    let chars: Vec<char> = preview.chars().collect();
    if chars.len() <= MAX_CHARS {
        return preview.to_string();
    }
    chars[chars.len() - MAX_CHARS..].iter().collect()
}

fn ensure_runtime_agent_session(
    state: &AppState,
    session_id: &str,
    agent_id: &str,
    agent_name: &str,
    agent_description: &str,
) -> Result<(), String> {
    if let Some(existing) = state
        .session_store
        .get(session_id)
        .map_err(|error| error.to_string())?
    {
        let status = if existing.status != crate::session::SessionStatus::Running
            && existing
                .status
                .can_transition_to(&crate::session::SessionStatus::Running)
        {
            Some(crate::session::SessionStatus::Running)
        } else {
            None
        };
        let updated = state
            .session_store
            .update(
                session_id,
                UpdateSessionInput {
                    role: Some(agent_name.to_string()),
                    summary: (!agent_description.trim().is_empty())
                        .then(|| agent_description.trim().to_string()),
                    status,
                    inner_session_id: Some(session_id.to_string()),
                    ..Default::default()
                },
            )
            .map_err(|error| error.to_string())?;
        broadcast_session_updated(state.session_event_tx.as_ref(), &updated);
        return Ok(());
    }

    let session = state
        .session_store
        .create(CreateSessionInput {
            id: Some(session_id.to_string()),
            agent_kind: resolve_agent_session_kind(agent_id),
            role: Some(agent_name.to_string()),
            context: Some(WorkContext::default()),
            interaction: Some(InteractionMode::Structured),
            pty_id: None,
            inner_session_id: Some(session_id.to_string()),
            parent_session_id: None,
        })
        .map_err(|error| error.to_string())?;

    let session = if !agent_description.trim().is_empty() {
        state
            .session_store
            .update(
                session_id,
                UpdateSessionInput {
                    summary: Some(agent_description.trim().to_string()),
                    ..Default::default()
                },
            )
            .map_err(|error| error.to_string())?
    } else {
        session
    };

    broadcast_session_created(state.session_event_tx.as_ref(), &session);
    Ok(())
}

fn create_echo_agent(payload: CreateAgentPayload) -> Result<Arc<dyn Agent>, StatusCode> {
    let requested_id = normalize_optional_text(payload.id);
    let id = requested_id.unwrap_or_else(|| generate_runtime_agent_id("echo"));
    if !is_valid_runtime_agent_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Arc::new(agent::echo::ManagedEchoAgent::new(
        id,
        normalize_optional_text(payload.name),
        normalize_optional_text(payload.description),
    )))
}

fn create_claude_agent(payload: CreateAgentPayload, dynamic_id: bool) -> Result<Arc<dyn Agent>, StatusCode> {
    let requested_id = normalize_optional_text(payload.id);
    let id = if dynamic_id {
        requested_id.unwrap_or_else(|| generate_runtime_agent_id("claude"))
    } else {
        requested_id.unwrap_or_else(|| "claude".to_string())
    };
    if !dynamic_id && id != "claude" {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !is_valid_runtime_agent_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Arc::new(agent::claude::ClaudeAgent::managed(
        id,
        normalize_optional_text(payload.name),
        normalize_optional_text(payload.description),
    )))
}

fn create_codex_agent(payload: CreateAgentPayload, dynamic_id: bool) -> Result<Arc<dyn Agent>, StatusCode> {
    let requested_id = normalize_optional_text(payload.id);
    let id = if dynamic_id {
        requested_id.unwrap_or_else(|| generate_runtime_agent_id("codex"))
    } else {
        requested_id.unwrap_or_else(|| "codex".to_string())
    };
    if !dynamic_id && id != "codex" {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !is_valid_runtime_agent_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Arc::new(agent::codex::CodexAgent::managed(
        id,
        normalize_optional_text(payload.name),
        normalize_optional_text(payload.description),
    )))
}

fn create_api_agent(payload: CreateAgentPayload) -> Result<Arc<dyn Agent>, StatusCode> {
    let requested_id = normalize_optional_text(payload.id);
    let id = requested_id.unwrap_or_else(|| generate_runtime_agent_id("api"));
    if !is_valid_runtime_agent_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let Some(provider_profile) = payload.provider_profile else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let provider = provider_profile.provider.trim().to_ascii_lowercase();
    if provider != "openai" && provider != "anthropic" {
        return Err(StatusCode::BAD_REQUEST);
    }
    let model = provider_profile.model.trim().to_string();
    let api_key = provider_profile.api_key.trim().to_string();
    if model.is_empty() || api_key.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Arc::new(agent::api::ApiAgent::managed(
        id,
        normalize_optional_text(payload.name),
        normalize_optional_text(payload.description),
        agent::api::ApiProviderProfile {
            provider,
            model,
            base_url: normalize_optional_text(provider_profile.base_url),
            api_key,
        },
    )))
}

async fn create_agent(
    State(state): State<AppState>,
    Json(payload): Json<CreateAgentPayload>,
) -> Result<(StatusCode, Json<AgentSummary>), StatusCode> {
    let kind = payload.kind.trim().to_ascii_lowercase();
    let agent = match kind.as_str() {
        "echo" => create_echo_agent(payload)?,
        "claude" => create_claude_agent(payload, false)?,
        "claude_cli" => create_claude_agent(payload, true)?,
        "codex" => create_codex_agent(payload, false)?,
        "codex_cli" => create_codex_agent(payload, true)?,
        "api" => create_api_agent(payload)?,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    if state.registry.get(agent.id()).is_some() {
        return Err(StatusCode::CONFLICT);
    }

    let summary = agent_summary(&agent);
    state.registry.register(agent);
    Ok((StatusCode::CREATED, Json(summary)))
}

async fn delete_agent(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<DeleteAgentResponse>, StatusCode> {
    if state.registry.unregister(&id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(DeleteAgentResponse {
        status: "stopped".to_string(),
        id,
    }))
}

async fn chat_with_agent(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequestPayload>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let Some(agent) = state.registry.get(&id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    let request = ChatRequest {
        message: payload.message,
        session_id: payload
            .session_id
            .map(|session| session.trim().to_string())
            .filter(|session| !session.is_empty()),
    };
    let requested_session_id = request.session_id.clone();
    let agent_name = agent.name().to_string();
    let agent_description = agent.description().to_string();

    if let Some(session_id) = requested_session_id.as_deref() {
        ensure_runtime_agent_session(&state, session_id, &id, &agent_name, &agent_description)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let mut chat_stream = agent.chat_stream(request);
    let stream = stream! {
        let mut active_session_id = requested_session_id;
        let mut preview = String::new();

        while let Some(chunk) = chat_stream.next().await {
            if let Some(session_id) = chunk.session_id.clone() {
                if active_session_id.as_deref() != Some(session_id.as_str()) {
                    preview.clear();
                }
                active_session_id = Some(session_id.clone());
                if let Err(error) = ensure_runtime_agent_session(
                    &state,
                    &session_id,
                    &id,
                    &agent_name,
                    &agent_description,
                ) {
                    yield Ok::<Event, Infallible>(encode_runtime_event(RuntimeAgentEvent::error(
                        format!("failed to sync unified session: {error}"),
                    )));
                    yield Ok::<Event, Infallible>(encode_runtime_event(RuntimeAgentEvent::done(Some("error"))));
                    yield Ok::<Event, Infallible>(Event::default().data("[DONE]"));
                    return;
                }
            }

            if !chunk.content.is_empty() {
                preview.push_str(&chunk.content);
                if let Some(session_id) = active_session_id.as_deref() {
                    if let Ok(updated) = state.session_store.update(
                        session_id,
                        UpdateSessionInput {
                            last_output_preview: Some(truncate_output_preview(&preview)),
                            ..Default::default()
                        },
                    ) {
                        broadcast_session_updated(state.session_event_tx.as_ref(), &updated);
                    }
                }
            }

            for event in map_chat_chunk_to_runtime_events(chunk) {
                yield Ok::<Event, Infallible>(encode_runtime_event(event));
            }
        }

        yield Ok::<Event, Infallible>(encode_runtime_event(RuntimeAgentEvent::done(Some("stop"))));
        yield Ok::<Event, Infallible>(Event::default().data("[DONE]"));
    };

    Ok(Sse::new(stream))
}

#[derive(Debug, Serialize)]
struct CloseSessionResponse {
    status: String,
    session_id: String,
}

async fn agent_stats(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<AgentStatsQuery>,
) -> Result<Json<JsonValue>, StatusCode> {
    let Some(agent) = state.registry.get(&id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    let session_id = query
        .session_id
        .map(|session| session.trim().to_string())
        .filter(|session| !session.is_empty());

    let Some(stats) = agent.stats(session_id).await else {
        return Err(StatusCode::NOT_FOUND);
    };

    Ok(Json(stats))
}

async fn list_sessions(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Vec<SessionInfo>>, StatusCode> {
    let Some(agent) = state.registry.get(&id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    Ok(Json(agent.list_sessions()))
}

async fn get_session(
    Path((id, sid)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<SessionInfo>, StatusCode> {
    let Some(agent) = state.registry.get(&id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    let Some(session) = agent.get_session(&sid) else {
        return Err(StatusCode::NOT_FOUND);
    };

    Ok(Json(session))
}

async fn close_session(
    Path((id, sid)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<CloseSessionResponse>, StatusCode> {
    let Some(agent) = state.registry.get(&id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    if !agent.close_session(&sid) {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(CloseSessionResponse {
        status: "closed".to_string(),
        session_id: sid,
    }))
}
