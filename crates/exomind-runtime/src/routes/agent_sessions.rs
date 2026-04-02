use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::agent::api::ApiProviderProfile;
use crate::agent::session::{
    AgentSessionRecord, AgentTrigger, SessionError, build_tool_registry, load_agent_session,
    resolve_provider_profile, run_agent_session,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAgentSessionRequest {
    prompt: String,
    #[serde(default)]
    system_prompt: Option<String>,
    #[serde(default)]
    tools: Vec<String>,
    #[serde(default)]
    provider_profile: Option<ApiProviderProfile>,
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agent-sessions", post(run_session))
        .route("/agent-sessions/:id", get(get_session_result))
}

async fn run_session(
    State(state): State<AppState>,
    Json(payload): Json<RunAgentSessionRequest>,
) -> Result<(StatusCode, Json<AgentSessionRecord>), (StatusCode, String)> {
    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "prompt is required".to_string()));
    }

    let profile =
        resolve_provider_profile(&state, payload.provider_profile).map_err(map_session_error)?;

    let tools = build_tool_registry(
        &state,
        crate::agent::session::scope_key(payload.profile_id.as_deref(), payload.user_id.as_deref()),
        &payload.tools,
    )
    .map_err(map_session_error)?;

    let result = run_agent_session(
        profile,
        payload.system_prompt,
        prompt.to_string(),
        &tools,
        AgentTrigger::HttpRequest,
        &state,
    )
    .await
    .map_err(map_session_error)?;

    Ok((StatusCode::CREATED, Json(result)))
}

async fn get_session_result(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AgentSessionRecord>, (StatusCode, String)> {
    let result = load_agent_session(&state, &id)
        .map_err(map_session_error)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("agent session not found: {id}"),
            )
        })?;
    Ok(Json(result))
}

fn map_session_error(error: SessionError) -> (StatusCode, String) {
    match error {
        SessionError::UnsupportedTool(_)
        | SessionError::InvalidProviderProfile(_)
        | SessionError::MissingRuntimeConfig(_) => (StatusCode::BAD_REQUEST, error.to_string()),
        SessionError::RequestFailed(_) | SessionError::InvalidProviderResponse(_) => {
            (StatusCode::BAD_GATEWAY, error.to_string())
        }
        SessionError::Persist(_) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eventlog::{EventLogStore, EventRecord};
    use crate::mesh::MeshState;
    use crate::proposal;
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::extract::State as AxumState;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use std::net::SocketAddr;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use tower::util::ServiceExt;

    fn test_state(data_dir: &std::path::Path) -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "agent-session-route-test".to_string();
        let registry = crate::agent::AgentRegistry::new();
        let energy_registry = crate::energy::EnergyRegistry::new();
        let eventlog_store = Arc::new(EventLogStore::new(data_dir.to_path_buf()));
        let (eventlog_watch_tx, _eventlog_watch_rx) =
            crate::routes::eventlog::eventlog_watch_channel();
        eventlog_store.set_watch_tx(eventlog_watch_tx.clone());

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
            allow_lan_without_auth: false,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            config_store: Arc::new(crate::config::ConfigStore::new()),
            reminder_store: Arc::new(crate::reminder::ReminderStore::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            proposal_store: Arc::new(proposal::ProposalStore::new()),
            session_store: Arc::new(crate::session::SessionStore::new()),
            agent_api_session_store: Arc::new(crate::agent::session::AgentSessionStore::new()),
            session_event_tx: None,
            eventlog_watch_tx,
            timeblock_store: Arc::new(crate::timeblock::TimeBlockStore::new()),
            energy_registry: energy_registry.clone(),
            tick_manager: Arc::new(crate::tick::TickManager::new(
                host_id.clone(),
                registry,
                energy_registry,
                Arc::clone(&signal_pool),
            )),
            life_agents: std::collections::HashMap::new(),
            eventlog_store,
            #[cfg(not(target_os = "android"))]
            pty_manager: Arc::new(crate::pty::PtyManager::new(
                Arc::clone(&signal_pool),
                host_id,
            )),
        }
    }

    async fn fake_openai_handler(
        AxumState(call_count): AxumState<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        if turn == 0 {
            assert_eq!(payload["stream"], false);
            return Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "tool-1",
                            "type": "function",
                            "function": {
                                "name": "get_recent_events",
                                "arguments": "{\"limit\":2}"
                            }
                        }]
                    }
                }]
            }));
        }

        let has_tool_message = payload["messages"].as_array().is_some_and(|messages| {
            messages
                .iter()
                .any(|message| message["role"] == json!("tool"))
        });
        assert!(has_tool_message);

        Json(json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "最近主要在处理 runtime agent API。",
                    "tool_calls": []
                }
            }]
        }))
    }

    async fn spawn_fake_openai_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route("/chat/completions", post(fake_openai_handler))
            .with_state(Arc::new(AtomicUsize::new(0)));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: SocketAddr = listener.local_addr().unwrap();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        (format!("http://{}", addr), shutdown_tx)
    }

    #[tokio::test]
    async fn route_runs_session_with_tools_and_persists_result() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        state
            .eventlog_store
            .append_event(
                Some("profile-argon"),
                EventRecord {
                    id: "e-1".to_string(),
                    timestamp: 1_700_000_000_000,
                    content: "review runtime session design".to_string(),
                    tags: vec!["plan".to_string()],
                    metadata: None,
                },
            )
            .unwrap();
        state
            .eventlog_store
            .append_event(
                Some("profile-argon"),
                EventRecord {
                    id: "e-2".to_string(),
                    timestamp: 1_700_000_100_000,
                    content: "implement agent api route".to_string(),
                    tags: vec!["code".to_string()],
                    metadata: None,
                },
            )
            .unwrap();

        let (base_url, shutdown_tx) = spawn_fake_openai_server().await;
        let app = router().with_state(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agent-sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "prompt": "分析我最近在做什么",
                            "systemPrompt": "你是测试助手",
                            "tools": ["get_recent_events"],
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": base_url,
                                "apiKey": "sk-test"
                            },
                            "userId": "profile-argon"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let created: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(created["toolCalls"].as_array().unwrap().len(), 1);
        assert_eq!(
            created["content"],
            json!("最近主要在处理 runtime agent API。")
        );

        let session_id = created["sessionId"].as_str().unwrap();
        let fetch_response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/agent-sessions/{session_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(fetch_response.status(), StatusCode::OK);
        let fetched_body = fetch_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let fetched: Value = serde_json::from_slice(&fetched_body).unwrap();
        assert_eq!(fetched["sessionId"], created["sessionId"]);
        assert_eq!(fetched["toolCalls"], created["toolCalls"]);

        let _ = shutdown_tx.send(());
    }
}
