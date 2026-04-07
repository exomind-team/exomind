use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::agent::api::ApiProviderProfile;
use crate::agent::broker::{ToolDef, TurnItem};
use crate::agent::session::{
    AgentSessionRecord, AgentTrigger, SessionError, load_agent_session, resolve_provider_profile,
    run_broker_agent_session_from_sources,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAgentSessionRequest {
    #[serde(default)]
    provider_profile: Option<ApiProviderProfile>,
    #[serde(default)]
    system_prompt: Option<String>,
    #[serde(default)]
    tools: Vec<ToolDef>,
    #[serde(default, alias = "toolGroups")]
    presets: Vec<String>,
    #[serde(default)]
    scope_key: Option<String>,
    #[serde(default)]
    history: Vec<TurnItem>,
    #[serde(default)]
    new_user_message: Option<String>,
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
    let profile =
        resolve_provider_profile(&state, payload.provider_profile).map_err(map_session_error)?;
    let result = run_broker_agent_session_from_sources(
        profile,
        payload.system_prompt,
        payload.tools,
        &payload.presets,
        payload.scope_key,
        payload.history,
        payload.new_user_message,
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
        SessionError::InvalidRequest(_)
        | SessionError::UnsupportedTool(_)
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
    use crate::agent::session::TOOL_PRESET_RECENT_EVENTS;
    use crate::eventlog::EventLogStore;
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

    async fn fake_openai_tool_call_handler(
        AxumState(call_count): AxumState<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(turn, 0);
        assert_eq!(payload["stream"], false);

        Json(json!({
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "tool-1",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"date\":\"today\"}"
                        }
                    }]
                }
            }]
        }))
    }

    async fn fake_openai_continue_handler(
        AxumState(call_count): AxumState<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(turn, 0);
        let messages = payload["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(
            messages[2]["tool_calls"][0]["function"]["name"],
            "get_weather"
        );
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["content"], "今天是阴天，气温21.45度");

        Json(json!({
            "choices": [{
                "message": {
                    "content": "今天是阴天，气温21.45度。",
                    "tool_calls": []
                }
            }]
        }))
    }

    async fn fake_openai_recent_events_preset_handler(
        AxumState(call_count): AxumState<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(turn, 0);
        assert_eq!(payload["tools"][0]["function"]["name"], "get_recent_events");

        Json(json!({
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "tool-recent-1",
                        "type": "function",
                        "function": {
                            "name": "get_recent_events",
                            "arguments": "{\"limit\":10}"
                        }
                    }]
                }
            }]
        }))
    }

    async fn fake_openai_combined_presets_and_tools_handler(
        AxumState(call_count): AxumState<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(turn, 0);
        let tool_names = payload["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert!(tool_names.contains(&"get_weather".to_string()));
        assert!(tool_names.contains(&"get_recent_events".to_string()));

        Json(json!({
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "tool-weather-1",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"date\":\"today\"}"
                        }
                    }]
                }
            }]
        }))
    }

    async fn spawn_fake_openai_tool_call_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route("/chat/completions", post(fake_openai_tool_call_handler))
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

    async fn spawn_fake_openai_continue_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route("/chat/completions", post(fake_openai_continue_handler))
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

    async fn spawn_fake_openai_recent_events_preset_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route(
                "/chat/completions",
                post(fake_openai_recent_events_preset_handler),
            )
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

    async fn spawn_fake_openai_combined_presets_and_tools_server() -> (String, oneshot::Sender<()>)
    {
        let app = Router::new()
            .route(
                "/chat/completions",
                post(fake_openai_combined_presets_and_tools_handler),
            )
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
    async fn route_returns_session_wrapper_with_tool_calls_and_persists_result() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        let (base_url, shutdown_tx) = spawn_fake_openai_tool_call_server().await;
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
                            "systemPrompt": "你是测试助手",
                            "tools": [{
                                "name": "get_weather",
                                "description": "获取天气",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "date": { "type": "string" }
                                    }
                                }
                            }],
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": base_url,
                                "apiKey": "sk-test"
                            },
                            "newUserMessage": "今天是什么天气"
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
        assert_eq!(created["status"], "needs_tool_calls");
        assert_eq!(created["content"], "");
        assert_eq!(
            created["assistantTurn"]["toolCalls"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(created["toolCalls"].as_array().unwrap().len(), 1);
        assert_eq!(created["toolCalls"][0]["toolName"], "get_weather");

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
        assert_eq!(fetched["status"], "needs_tool_calls");

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn route_returns_completed_wrapper_after_tool_result_history() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        let (base_url, shutdown_tx) = spawn_fake_openai_continue_server().await;
        let app = router().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agent-sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "systemPrompt": "你是测试助手",
                            "tools": [{
                                "name": "get_weather",
                                "description": "获取天气",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "date": { "type": "string" }
                                    }
                                }
                            }],
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": base_url,
                                "apiKey": "sk-test"
                            },
                            "history": [
                                { "role": "user", "content": "今天是什么天气" },
                                {
                                    "role": "assistant",
                                    "content": "",
                                    "toolCalls": [{
                                        "id": "tool-1",
                                        "name": "get_weather",
                                        "input": { "date": "today" }
                                    }]
                                },
                                {
                                    "role": "tool",
                                    "toolCallId": "tool-1",
                                    "toolName": "get_weather",
                                    "content": "今天是阴天，气温21.45度"
                                }
                            ]
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
        assert_eq!(created["status"], "completed");
        assert_eq!(created["content"], "今天是阴天，气温21.45度。");
        assert_eq!(
            created["assistantTurn"]["content"],
            "今天是阴天，气温21.45度。"
        );
        assert_eq!(created["toolCalls"], json!([]));

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn route_expands_recent_events_preset_via_rust_session_layer() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        let (base_url, shutdown_tx) = spawn_fake_openai_recent_events_preset_server().await;
        let app = router().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agent-sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "systemPrompt": "你是测试助手",
                            "presets": [TOOL_PRESET_RECENT_EVENTS],
                            "scopeKey": "profile-alpha",
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": base_url,
                                "apiKey": "sk-test"
                            },
                            "newUserMessage": "读取最近事件"
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
        assert_eq!(created["status"], "needs_tool_calls");
        assert_eq!(created["toolCalls"][0]["toolName"], "get_recent_events");

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn route_accepts_legacy_tool_groups_alias_as_presets() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        let (base_url, shutdown_tx) = spawn_fake_openai_recent_events_preset_server().await;
        let app = router().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agent-sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "systemPrompt": "你是测试助手",
                            "toolGroups": [TOOL_PRESET_RECENT_EVENTS],
                            "scopeKey": "profile-alpha",
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": base_url,
                                "apiKey": "sk-test"
                            },
                            "newUserMessage": "读取最近事件"
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
        assert_eq!(created["status"], "needs_tool_calls");
        assert_eq!(created["toolCalls"][0]["toolName"], "get_recent_events");

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn route_merges_explicit_tools_with_presets() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        let (base_url, shutdown_tx) = spawn_fake_openai_combined_presets_and_tools_server().await;
        let app = router().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agent-sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "tools": [{
                                "name": "get_weather",
                                "description": "获取天气",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "date": { "type": "string" }
                                    }
                                }
                            }],
                            "presets": [TOOL_PRESET_RECENT_EVENTS],
                            "scopeKey": "profile-alpha",
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": base_url,
                                "apiKey": "sk-test"
                            },
                            "newUserMessage": "测试"
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
        assert_eq!(created["status"], "needs_tool_calls");
        assert_eq!(created["toolCalls"][0]["toolName"], "get_weather");

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn route_rejects_missing_scope_key_for_runtime_preset() {
        let temp = tempfile::tempdir().unwrap();
        let state = test_state(temp.path());
        let app = router().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agent-sessions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "presets": [TOOL_PRESET_RECENT_EVENTS],
                            "providerProfile": {
                                "provider": "openai",
                                "model": "gpt-4o-mini",
                                "baseUrl": "http://127.0.0.1:9",
                                "apiKey": "sk-test"
                            },
                            "newUserMessage": "测试"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
