use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use std::convert::Infallible;

use crate::agent::ChatChunk;
use crate::AppState;

#[derive(Debug, Deserialize)]
struct ChatRequest {
    message: String,
}

/// Agent routes (Agent 相关路由).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agents", get(list_agents))
        .route("/agents/:id/chat", post(chat_with_agent))
}

async fn list_agents(State(state): State<AppState>) -> Json<Vec<crate::agent::AgentSummary>> {
    Json(state.registry.list())
}

async fn chat_with_agent(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let Some(agent) = state.registry.get(&id) else {
        return Err(StatusCode::NOT_FOUND);
    };

    let data_stream = agent.chat_stream(payload.message).map(|chunk: ChatChunk| {
        // ChatChunk currently only contains strings, JSON serialization is expected infallible.
        let encoded = serde_json::to_string(&chunk).expect("ChatChunk serialization failed");
        Ok::<Event, Infallible>(Event::default().data(encoded))
    });

    let done_stream =
        stream::once(async { Ok::<Event, Infallible>(Event::default().data("[DONE]")) });

    let stream = data_stream.chain(done_stream);

    Ok(Sse::new(stream))
}
