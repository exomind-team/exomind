//! EventLog HTTP routes for the standalone runtime.
//!
//! Mirrors the Tauri commands from `eventlog_commands.rs` as REST endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::eventlog::{EventRecord, MirrorStatus};

// ── Request / query types ───────────────────────────────────────

#[derive(Debug, Deserialize)]
struct EventLogQuery {
    user_id: Option<String>,
    limit: Option<usize>,
    since_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

fn internal_error(msg: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse { error: msg }),
    )
}

// ── Handlers ────────────────────────────────────────────────────

/// GET /eventlog — list all events (optionally filtered by user_id, limit, since_id).
async fn list_events(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<Vec<EventRecord>>, (StatusCode, Json<ErrorResponse>)> {
    let mut events = state
        .eventlog_store
        .list_events(query.user_id.as_deref())
        .map_err(internal_error)?;

    // Filter by since_id: keep only events that come *after* the given ID
    // (i.e., newer events — list is sorted desc by timestamp).
    if let Some(ref since_id) = query.since_id {
        if let Some(pos) = events.iter().position(|e| e.id == *since_id) {
            // Events before `pos` are newer (desc order).
            events.truncate(pos);
        }
        // If since_id not found, return all events.
    }

    if let Some(limit) = query.limit {
        events.truncate(limit);
    }

    Ok(Json(events))
}

/// POST /eventlog — append (or upsert) a single event.
async fn append_event(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
    Json(event): Json<EventRecord>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .eventlog_store
        .append_event(query.user_id.as_deref(), event)
        .map_err(internal_error)?;
    Ok(StatusCode::CREATED)
}

/// GET /eventlog/:id — get a single event by ID.
async fn get_event(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<EventRecord>, (StatusCode, Json<ErrorResponse>)> {
    let event = state
        .eventlog_store
        .get_event(query.user_id.as_deref(), &id)
        .map_err(internal_error)?;

    match event {
        Some(e) => Ok(Json(e)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("event not found: {id}"),
            }),
        )),
    }
}

/// DELETE /eventlog — clear all events for the given user.
async fn clear_events(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    state
        .eventlog_store
        .clear_events(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /eventlog/mirror-status — return mirror synchronisation status.
async fn mirror_status_handler(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<MirrorStatus>, (StatusCode, Json<ErrorResponse>)> {
    let status = state
        .eventlog_store
        .mirror_status(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(Json(status))
}

/// POST /eventlog/rebuild — rebuild the markdown mirror and return status.
async fn rebuild_handler(
    State(state): State<AppState>,
    Query(query): Query<EventLogQuery>,
) -> Result<Json<MirrorStatus>, (StatusCode, Json<ErrorResponse>)> {
    let status = state
        .eventlog_store
        .rebuild_markdown(query.user_id.as_deref())
        .map_err(internal_error)?;
    Ok(Json(status))
}

// ── Router assembly ─────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/eventlog",
            get(list_events).post(append_event).delete(clear_events),
        )
        // Mirror sub-routes use a distinct prefix to avoid conflict with
        // the dynamic `:id` capture below.
        .route("/eventlog/mirror/status", get(mirror_status_handler))
        .route("/eventlog/mirror/rebuild", post(rebuild_handler))
        .route("/eventlog/events/:id", get(get_event))
}

// ── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eventlog::EventLogStore;
    use crate::mesh::MeshState;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    fn test_state_with_eventlog(store: Arc<EventLogStore>) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "eventlog-test".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(crate::tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store: store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn append_and_list() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append an event.
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"e1","timestamp":1700000000000,"content":"hello","tags":["note"]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);

        // List events.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let events: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["id"], "e1");
        assert_eq!(events[0]["content"], "hello");
    }

    #[tokio::test]
    async fn get_by_id() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append.
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"g1","timestamp":1000,"content":"get-me","tags":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Get by ID.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/events/g1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let event: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(event["id"], "g1");
        assert_eq!(event["content"], "get-me");
    }

    #[tokio::test]
    async fn get_nonexistent_returns_404() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/events/no-such-id")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn clear_removes_all() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append two events.
        for id in &["c1", "c2"] {
            let _ = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/eventlog")
                        .header("content-type", "application/json")
                        .body(Body::from(format!(
                            r#"{{"id":"{id}","timestamp":1,"content":"x","tags":[]}}"#
                        )))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        // Clear.
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/eventlog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);

        // Verify empty.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let events: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn list_with_limit() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append 5 events.
        for i in 0..5 {
            let _ = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/eventlog")
                        .header("content-type", "application/json")
                        .body(Body::from(format!(
                            r#"{{"id":"l{i}","timestamp":{ts},"content":"event {i}","tags":[]}}"#,
                            ts = 1000 + i
                        )))
                        .unwrap(),
                )
                .await
                .unwrap();
        }

        // List with limit=2.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog?limit=2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let events: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(events.len(), 2);
    }

    #[tokio::test]
    async fn mirror_status_route() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append an event first.
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"ms1","timestamp":5000,"content":"mirror test","tags":["note"]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/eventlog/mirror/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let status: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status["totalEvents"], 1);
    }

    #[tokio::test]
    async fn rebuild_route() {
        let dir = tempdir().unwrap();
        let store = Arc::new(EventLogStore::new(dir.path().to_path_buf()));
        let state = test_state_with_eventlog(store);
        let app = test_router(state);

        // Append.
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"id":"rb1","timestamp":9000,"content":"rebuild test","tags":[]}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/eventlog/mirror/rebuild")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let status: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status["totalEvents"], 1);
        assert_eq!(status["needsRebuild"], false);
    }
}
