use std::convert::Infallible;

use axum::extract::{Query, State, rejection::JsonRejection};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::post;
use axum::{Json, Router};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::agent_await::{AwaitRequest, AwaitSetupError, start_await_stream};

#[derive(Debug, Deserialize)]
struct ScopeQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/act/await", post(await_handler))
}

async fn await_handler(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    body: Result<Json<AwaitRequest>, JsonRejection>,
) -> Result<
    Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>,
    (StatusCode, Json<ErrorResponse>),
> {
    let Json(request) = body.map_err(map_json_rejection)?;
    let scope_key = query.profile_id.or(query.user_id);
    let stream = start_await_stream(state, scope_key, request).map_err(map_setup_error)?;

    let sse_stream = stream.map(|item| {
        Ok(Event::default()
            .event(item.event_name())
            .data(item.data_json()))
    });

    Ok(Sse::new(sse_stream))
}

fn map_json_rejection(error: JsonRejection) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: format!("invalid await request: {}", error.body_text()),
        }),
    )
}

fn map_setup_error(error: AwaitSetupError) -> (StatusCode, Json<ErrorResponse>) {
    (
        error.status(),
        Json(ErrorResponse {
            error: error.payload().message.clone(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;
    use crate::agent;
    use crate::config;
    use crate::energy;
    use crate::eventlog;
    use crate::mesh;
    use crate::pairing;
    use crate::proposal;
    #[cfg(not(target_os = "android"))]
    use crate::pty;
    use crate::reminder;
    use crate::session;
    use crate::signal;
    use crate::task;
    use crate::tick;
    use crate::timeblock;

    fn test_app_state(port: u16) -> AppState {
        let registry = agent::AgentRegistry::new();
        let signal_pool = Arc::new(signal::SignalPool::new(None));
        let host_id = format!("await-route-test-{port}");
        let energy_registry = energy::EnergyRegistry::new();
        let (eventlog_watch_tx, _rx) = crate::routes::eventlog::eventlog_watch_channel();
        let eventlog_store = Arc::new(eventlog::EventLogStore::new(
            std::env::temp_dir().join(format!("exomind-await-route-test-{port}")),
        ));
        eventlog_store.set_watch_tx(eventlog_watch_tx.clone());

        AppState {
            port,
            host_id: host_id.clone(),
            device_id: format!("await-route-dev-{port}"),
            registry: registry.clone(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(mesh::MeshState::new(
                host_id.clone(),
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            allow_lan_without_auth: false,
            mdns: None,
            ret_mesh_peers: None,
            ret_mesh_connect_tx: None,
            ret_mesh_announce_enabled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
                true,
            )),
            ret_mesh_pairing_tx: None,
            ret_mesh_event_tx: None,
            pairing: Arc::new(pairing::PairingManager::new()),
            config_store: Arc::new(config::ConfigStore::new()),
            reminder_store: Arc::new(reminder::ReminderStore::new()),
            task_store: Arc::new(task::TaskStore::new()),
            proposal_store: Arc::new(proposal::ProposalStore::new()),
            session_store: Arc::new(session::SessionStore::new()),
            agent_api_session_store: Arc::new(agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx,
            timeblock_store: Arc::new(timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(pty::PtyManager::new(Arc::clone(&signal_pool), host_id)),
        }
    }

    #[tokio::test]
    async fn await_route_returns_404_for_missing_task() {
        let app = router().with_state(test_app_state(4601));
        let request = axum::http::Request::builder()
            .method("POST")
            .uri("/act/await?user_id=profile-argon")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"condition":{"type":"task_completed","taskId":"missing-task"}}"#,
            ))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"], "task not found: missing-task");
    }

    #[tokio::test]
    async fn await_route_streams_ready_and_fulfilled_events() {
        let state = test_app_state(4602);
        let task = state.task_store.create_scoped(
            Some("profile-argon"),
            task::CreateTaskInput {
                title: "done".to_string(),
                description: None,
                done_condition: None,
                priority: None,
                tags: vec![],
                source: None,
                parent_id: None,
                depends_on: vec![],
                due_at: None,
                estimated_minutes: None,
                time_block_ids: vec![],
            },
        );
        state
            .task_store
            .transition_scoped(
                Some("profile-argon"),
                &task.id,
                task::TaskStatus::InProgress,
            )
            .unwrap();
        let completed = state
            .task_store
            .transition_scoped(Some("profile-argon"), &task.id, task::TaskStatus::Completed)
            .unwrap();

        let app = router().with_state(state);
        let request = axum::http::Request::builder()
            .method("POST")
            .uri("/act/await?user_id=profile-argon")
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"condition":{{"type":"task_completed","taskId":"{}"}}}}"#,
                completed.1.id
            )))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        assert!(
            content_type.contains("text/event-stream"),
            "unexpected content type: {content_type}"
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("event: ready"));
        assert!(text.contains("event: fulfilled"));
        assert!(text.contains("\"taskId\":\""));
    }
}
