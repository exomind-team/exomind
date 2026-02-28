use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::stream;
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

    let events = agent
        .chat_chunks(payload.message)
        .into_iter()
        .map(|chunk: ChatChunk| {
            serde_json::to_string(&chunk)
                .map(|encoded| Event::default().data(encoded))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let stream = stream::iter(
        events
            .into_iter()
            .chain(std::iter::once(Event::default().data("[DONE]")))
            .map(Ok::<Event, Infallible>),
    );

    Ok(Sse::new(stream))
}
