use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::stream::{self, Stream};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::sync::broadcast;
use tokio::time::{Duration, Instant, Interval};
use tokio_stream::wrappers::{errors::BroadcastStreamRecvError, BroadcastStream};

use crate::signal::types::{SignalEvent, SignalRoute, TargetType};
use crate::AppState;

// ── Request / Response types ────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PublishRequest {
    topic: String,
    source: Option<String>,
    payload: serde_json::Value,
    trace_id: Option<String>,
    origin_host_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct PublishResponse {
    accepted: bool,
    event_id: String,
}

#[derive(Debug, Deserialize)]
struct StreamQuery {
    agent_id: String,
    #[serde(default = "default_heartbeat_interval")]
    heartbeat_interval: u64,
}

fn default_heartbeat_interval() -> u64 {
    30
}

#[derive(Debug, Deserialize)]
struct HistoryQuery {
    #[serde(default = "default_history_limit")]
    limit: usize,
}

fn default_history_limit() -> usize {
    50
}

#[derive(Debug, Deserialize)]
struct CreateRouteRequest {
    topic: String,
    target_type: TargetType,
    target_ref: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct UpdateRouteRequest {
    topic: Option<String>,
    target_type: Option<TargetType>,
    target_ref: Option<String>,
    enabled: Option<bool>,
}

// ── Handlers ────────────────────────────────────────────────────

/// POST /signals/publish
async fn publish_handler(
    State(state): State<AppState>,
    Json(req): Json<PublishRequest>,
) -> Json<PublishResponse> {
    let event_id = uuid::Uuid::new_v4().to_string();
    let event = SignalEvent {
        schema_version: 1,
        id: event_id.clone(),
        topic: req.topic,
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: req.source.unwrap_or_else(|| "unknown".to_string()),
        origin_host_id: req
            .origin_host_id
            .unwrap_or_else(|| state.host_id.clone()),
        hop: 0,
        trace_id: req.trace_id,
        payload: req.payload,
    };

    // publish() internally pushes to window cache via bus.publish
    state.signal_pool.publish(event.clone());
    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.forward_event_to_peers(event).await;
    }

    Json(PublishResponse {
        accepted: true,
        event_id,
    })
}

/// GET /signals/stream — SSE endpoint
async fn stream_handler(
    State(state): State<AppState>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.signal_pool.subscribe();
    let agent_id = query.agent_id;
    let heartbeat_secs = query.heartbeat_interval;

    // Replay from Last-Event-ID if provided.
    let replay_events: Vec<SignalEvent> = headers
        .get("Last-Event-ID")
        .and_then(|v| v.to_str().ok())
        .map(|last_id| state.signal_pool.window().since(last_id))
        .unwrap_or_default();

    // Filter replay events by agent route matching.
    let route_table = state.signal_pool.routes();
    let replay: Vec<Event> = replay_events
        .into_iter()
        .filter(|evt| routes_target_stream_subscriber(route_table, &evt.topic, &agent_id))
        .filter_map(|evt| {
            serde_json::to_string(&evt).ok().map(|json| {
                Event::default()
                    .event("signal")
                    .id(evt.id.clone())
                    .data(json)
            })
        })
        .collect();

    let replay_stream = stream::iter(replay.into_iter().map(Ok));

    let live_stream = SignalSseStream::new(rx, agent_id, heartbeat_secs, state);

    let combined = replay_stream.chain(live_stream);

    Sse::new(combined)
}

/// GET /signals/history
async fn history_handler(
    State(state): State<AppState>,
    Query(query): Query<HistoryQuery>,
) -> Json<Vec<SignalEvent>> {
    let events = state.signal_pool.window().recent(query.limit);
    Json(events)
}

/// GET /signal-routes
async fn list_routes(State(state): State<AppState>) -> Json<Vec<SignalRoute>> {
    Json(state.signal_pool.routes().get_all())
}

/// POST /signal-routes
async fn create_route(
    State(state): State<AppState>,
    Json(req): Json<CreateRouteRequest>,
) -> (StatusCode, Json<SignalRoute>) {
    let now = chrono::Utc::now().to_rfc3339();
    let route = SignalRoute {
        id: uuid::Uuid::new_v4().to_string(),
        enabled: req.enabled,
        topic: req.topic,
        target_type: req.target_type,
        target_ref: req.target_ref,
        created_at: now.clone(),
        updated_at: now,
    };

    let response = route.clone();
    state.signal_pool.routes().add(route);
    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.sync_local_interests_to_all_peers().await;
    }

    (StatusCode::CREATED, Json(response))
}

/// PUT /signal-routes/{id}
async fn update_route(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(req): Json<UpdateRouteRequest>,
) -> Result<Json<SignalRoute>, StatusCode> {
    let updated = state.signal_pool.routes().update(&id, |route| {
        if let Some(topic) = &req.topic {
            route.topic = topic.clone();
        }
        if let Some(target_type) = &req.target_type {
            route.target_type = target_type.clone();
        }
        if let Some(target_ref) = &req.target_ref {
            route.target_ref = target_ref.clone();
        }
        if let Some(enabled) = req.enabled {
            route.enabled = enabled;
        }
    });

    if !updated {
        return Err(StatusCode::NOT_FOUND);
    }

    if let Some(mesh_relay) = &state.mesh_relay {
        mesh_relay.sync_local_interests_to_all_peers().await;
    }

    state
        .signal_pool
        .routes()
        .get_by_id(&id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// DELETE /signal-routes/{id}
async fn delete_route(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> StatusCode {
    if state.signal_pool.routes().delete(&id) {
        if let Some(mesh_relay) = &state.mesh_relay {
            mesh_relay.sync_local_interests_to_all_peers().await;
        }
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}

// ── Router assembly ─────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/signals/publish", post(publish_handler))
        .route("/signals/stream", get(stream_handler))
        .route("/signals/history", get(history_handler))
        .route("/signal-routes", get(list_routes).post(create_route))
        .route(
            "/signal-routes/:id",
            put(update_route).delete(delete_route),
        )
}

// ── SSE stream implementation ───────────────────────────────────

/// Check whether any route for the given topic targets the current SSE subscriber.
///
/// `frontend:ui` and `agent:ui` intentionally share the same `agent_id=ui`
/// subscription contract so the existing frontend SSE client can project UI-targeted
/// signals without inventing a second stream endpoint.
fn routes_target_stream_subscriber(
    route_table: &crate::signal::RouteTable,
    topic: &str,
    subscriber_id: &str,
) -> bool {
    let matched = route_table.match_routes(topic);
    matched.iter().any(|route| {
        matches!(route.target_type, TargetType::Agent | TargetType::Frontend)
            && route.target_ref == subscriber_id
    })
}

/// A custom stream that merges broadcast events with periodic heartbeats.
struct SignalSseStream {
    rx: BroadcastStream<SignalEvent>,
    agent_id: String,
    heartbeat: Interval,
    state: AppState,
}

impl SignalSseStream {
    fn new(
        rx: broadcast::Receiver<SignalEvent>,
        agent_id: String,
        heartbeat_secs: u64,
        state: AppState,
    ) -> Self {
        let interval = tokio::time::interval_at(
            Instant::now() + Duration::from_secs(heartbeat_secs),
            Duration::from_secs(heartbeat_secs),
        );
        Self {
            rx: BroadcastStream::new(rx),
            agent_id,
            heartbeat: interval,
            state,
        }
    }
}

impl Stream for SignalSseStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();

        match Pin::new(&mut this.rx).poll_next(cx) {
            Poll::Ready(Some(Ok(event))) => {
                if routes_target_stream_subscriber(
                    this.state.signal_pool.routes(),
                    &event.topic,
                    &this.agent_id,
                ) && let Ok(json) = serde_json::to_string(&event)
                {
                    return Poll::Ready(Some(Ok(Event::default()
                        .event("signal")
                        .id(event.id)
                        .data(json))));
                }
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
            Poll::Ready(Some(Err(BroadcastStreamRecvError::Lagged(n)))) => {
                let msg = format!("{{\"warning\":\"lagged\",\"missed\":{n}}}");
                return Poll::Ready(Some(Ok(Event::default().event("warning").data(msg))));
            }
            Poll::Ready(None) => return Poll::Ready(None),
            Poll::Pending => {}
        }

        // Check heartbeat timer.
        if this.heartbeat.poll_tick(cx).is_ready() {
            let ts = chrono::Utc::now().timestamp_millis();
            let data = format!("{{\"ts\":{ts}}}");
            return Poll::Ready(Some(Ok(Event::default().event("heartbeat").data(data))));
        }

        Poll::Pending
    }
}

// ── Tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::MeshState;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "signals-test-host".to_string();
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: crate::agent::AgentRegistry::new(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(MeshState::new(host_id, Arc::clone(&signal_pool), None)),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            energy_registry: crate::energy::EnergyRegistry::new(),
            eventlog_store: Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir().join("exomind-test-signals"),
            )),
        }
    }

    fn test_router(state: AppState) -> Router {
        router().with_state(state)
    }

    #[tokio::test]
    async fn publish_returns_accepted_with_event_id() {
        let state = test_state();
        // Need a subscriber so broadcast doesn't fail.
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/signals/publish")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"topic":"user.input.text","payload":{"text":"hello"}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["accepted"], true);
        assert!(payload["event_id"].is_string());
    }

    #[tokio::test]
    async fn publish_stores_event_in_window() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state.clone());

        let _ = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/signals/publish")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"topic":"test","payload":{}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(state.signal_pool.window().len(), 1);
    }

    #[tokio::test]
    async fn history_returns_recent_events() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();

        // Publish 3 events directly.
        for i in 0..3 {
            let event = SignalEvent {
                schema_version: 1,
                id: format!("evt-{i}"),
                topic: "test".to_string(),
                ts: 1700000000000 + i,
                source: "test".to_string(),
                origin_host_id: "local".to_string(),
                hop: 0,
                trace_id: None,
                payload: serde_json::json!({"n": i}),
            };
            state.signal_pool.publish(event);
        }

        let app = test_router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/signals/history?limit=2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload.len(), 2);
        assert_eq!(payload[0]["id"], "evt-1");
        assert_eq!(payload[1]["id"], "evt-2");
    }

    #[tokio::test]
    async fn history_default_limit() {
        let state = test_state();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/signals/history")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(payload.is_empty());
    }

    #[tokio::test]
    async fn route_crud_lifecycle() {
        let state = test_state();
        let app = test_router(state);

        // 1. List routes — should be empty.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/signal-routes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let routes: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(routes.is_empty());

        // 2. Create a route.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/signal-routes")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"topic":"user.input.text","target_type":"agent","target_ref":"classifier"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        let route_id = created["id"].as_str().unwrap().to_string();
        assert_eq!(created["topic"], "user.input.text");
        assert_eq!(created["target_type"], "agent");
        assert_eq!(created["target_ref"], "classifier");
        assert_eq!(created["enabled"], true);

        // 3. List routes — should have one.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/signal-routes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let routes: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(routes.len(), 1);

        // 4. Update the route.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/signal-routes/{route_id}"))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"enabled":false}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let updated: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(updated["enabled"], false);
        assert_eq!(updated["topic"], "user.input.text");

        // 5. Delete the route.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/signal-routes/{route_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        // 6. List routes — should be empty again.
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/signal-routes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let routes: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(routes.is_empty());
    }

    #[tokio::test]
    async fn update_nonexistent_route_returns_not_found() {
        let state = test_state();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/signal-routes/nonexistent")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"enabled":false}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_nonexistent_route_returns_not_found() {
        let state = test_state();
        let app = test_router(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/signal-routes/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn publish_with_all_optional_fields() {
        let state = test_state();
        let _rx = state.signal_pool.subscribe();
        let app = test_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/signals/publish")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{
                            "topic": "test.topic",
                            "source": "my-source",
                            "payload": {"key": "value"},
                            "trace_id": "trace-123",
                            "origin_host_id": "host-remote"
                        }"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let events = state.signal_pool.window().recent(1);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].source, "my-source");
        assert_eq!(events[0].origin_host_id, "host-remote");
        assert_eq!(events[0].trace_id.as_deref(), Some("trace-123"));
        assert_eq!(events[0].hop, 0);
        assert_eq!(events[0].schema_version, 1);
    }

    #[test]
    fn stream_route_matching_accepts_frontend_ui_targets() {
        let signal_pool = SignalPool::new(None);
        let now = chrono::Utc::now().to_rfc3339();
        signal_pool.routes().add(SignalRoute {
            id: "route-ui".to_string(),
            enabled: true,
            topic: "eventlog.replication.appended".to_string(),
            target_type: TargetType::Frontend,
            target_ref: "ui".to_string(),
            created_at: now.clone(),
            updated_at: now,
        });

        assert!(
            routes_target_stream_subscriber(
                signal_pool.routes(),
                "eventlog.replication.appended",
                "ui",
            ),
            "frontend:ui routes should be deliverable to the UI SSE subscriber"
        );
    }

    #[test]
    fn stream_route_matching_keeps_actor_targets_out_of_sse_subscriber() {
        let signal_pool = SignalPool::new(None);
        let now = chrono::Utc::now().to_rfc3339();
        signal_pool.routes().add(SignalRoute {
            id: "route-actor".to_string(),
            enabled: true,
            topic: "eventlog.replication.appended".to_string(),
            target_type: TargetType::Actor,
            target_ref: "eventlog".to_string(),
            created_at: now.clone(),
            updated_at: now,
        });

        assert!(
            !routes_target_stream_subscriber(
                signal_pool.routes(),
                "eventlog.replication.appended",
                "ui",
            ),
            "actor routes should not leak into the SSE subscriber stream"
        );
    }
}
