use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;

use crate::AppState;
use crate::agent::{ChatChunk, ChatRequest, SessionInfo};

#[derive(Debug, Deserialize)]
struct ChatRequestPayload {
    message: String,
    #[serde(default)]
    session_id: Option<String>,
}

/// Agent routes (Agent 相关路由).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agents", get(list_agents))
        .route("/agents/:id/chat", post(chat_with_agent))
        .route("/agents/:id/sessions", get(list_sessions))
        .route(
            "/agents/:id/sessions/:sid",
            get(get_session).delete(close_session),
        )
}

async fn list_agents(State(state): State<AppState>) -> Json<Vec<crate::agent::AgentSummary>> {
    Json(state.registry.list())
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
