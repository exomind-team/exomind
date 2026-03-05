use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::convert::Infallible;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;
use crate::agent::{self, Agent, AgentSummary, ChatChunk, ChatRequest, SessionInfo};

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
    }
}

fn create_echo_agent(payload: CreateAgentPayload) -> Result<Arc<dyn Agent>, StatusCode> {
    let requested_id = normalize_optional_text(payload.id);
    let id = requested_id.unwrap_or_else(|| {
        let short = Uuid::new_v4().simple().to_string();
        format!("echo-{}", &short[..8])
    });
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Arc::new(agent::echo::ManagedEchoAgent::new(
        id,
        normalize_optional_text(payload.name),
        normalize_optional_text(payload.description),
    )))
}

fn create_claude_agent(payload: CreateAgentPayload) -> Result<Arc<dyn Agent>, StatusCode> {
    let requested_id = normalize_optional_text(payload.id);
    if let Some(id) = requested_id
        && id != "claude"
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Arc::new(agent::claude::ClaudeAgent::new()))
}

async fn create_agent(
    State(state): State<AppState>,
    Json(payload): Json<CreateAgentPayload>,
) -> Result<(StatusCode, Json<AgentSummary>), StatusCode> {
    let kind = payload.kind.trim().to_ascii_lowercase();
    let agent = match kind.as_str() {
        "echo" => create_echo_agent(payload)?,
        "claude" => create_claude_agent(payload)?,
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

    let data_stream = agent.chat_stream(request).map(|chunk: ChatChunk| {
        // ChatChunk currently only contains strings, JSON serialization is expected infallible.
        let encoded = serde_json::to_string(&chunk).expect("ChatChunk serialization failed");
        Ok::<Event, Infallible>(Event::default().data(encoded))
    });

    let done_stream =
        stream::once(async { Ok::<Event, Infallible>(Event::default().data("[DONE]")) });

    let stream = data_stream.chain(done_stream);

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
