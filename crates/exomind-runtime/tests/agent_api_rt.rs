use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::body::Body;
use axum::extract::State as AxumState;
use axum::http::{Request, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use exomind_runtime::AppState;
use exomind_runtime::agent::Agent;
use exomind_runtime::agent::api::ApiProviderProfile;
use exomind_runtime::agent::broker::{ToolDef, TurnItem};
use exomind_runtime::agent::life::{AgentApiTickTrigger, CognitiveLifeAgent};
use exomind_runtime::agent::llm_cognition::LlmCognition;
use exomind_runtime::agent::session::{
    AgentSessionRuntime, AgentSessionStore, AgentTrigger, SessionError,
    run_broker_agent_session_with_runtime,
};
use exomind_runtime::agent::tools::GET_RECENT_EVENTS_TOOL;
use exomind_runtime::agent::workspace::AgentWorkspace;
use exomind_runtime::config::types::USER_CONFIG_SCOPE;
use exomind_runtime::config::{ConfigStore, PutConfigEntryInput};
use exomind_runtime::energy::AgentEnergySnapshot;
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::routes::{agent_sessions, eventlog};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower::util::ServiceExt;

fn put_config(key: &str, value: String, sensitive: bool) -> PutConfigEntryInput {
    PutConfigEntryInput {
        scope: USER_CONFIG_SCOPE.to_string(),
        key: key.to_string(),
        value,
        sensitive,
        source: Some("test".to_string()),
        source_origin: Some("integration-test".to_string()),
    }
}

fn make_test_state(data_dir: &Path) -> AppState {
    let mut state = AppState::new_runtime(
        0,
        "agent-api-rt-test".to_string(),
        None,
        None,
        false,
        None,
    );
    let eventlog_store = Arc::new(EventLogStore::new(data_dir.join("eventlog")));
    let agent_api_session_store = Arc::new(AgentSessionStore::new());
    let config_store = Arc::new(ConfigStore::new());
    let (eventlog_watch_tx, _eventlog_watch_rx) = eventlog::eventlog_watch_channel();
    eventlog_store.set_watch_tx(eventlog_watch_tx.clone());

    state.config_store = config_store;
    state.eventlog_store = eventlog_store;
    state.agent_api_session_store = agent_api_session_store;
    state.eventlog_watch_tx = eventlog_watch_tx;
    state
}

async fn fake_openai_handler(
    AxumState(call_count): AxumState<Arc<AtomicUsize>>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let turn = call_count.fetch_add(1, Ordering::SeqCst);
    if turn == 0 {
        assert_eq!(payload["stream"], false);
        assert_eq!(payload["tools"][0]["function"]["name"], GET_RECENT_EVENTS_TOOL);
        return Json(json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "tool-1",
                        "type": "function",
                        "function": {
                            "name": GET_RECENT_EVENTS_TOOL,
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
                "content": "最近主要在推进 runtime RT Agent API 落地。",
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
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    (format!("http://{addr}"), shutdown_tx)
}

fn real_upstream_provider_profile_from_env() -> Option<ApiProviderProfile> {
    let enabled = std::env::var("EXOMIND_AGENT_API_RT_ENABLE")
        .ok()
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    if !enabled {
        return None;
    }

    let provider = std::env::var("EXOMIND_AGENT_API_PROVIDER").ok()?;
    let model = std::env::var("EXOMIND_AGENT_API_MODEL").ok()?;
    let api_key = std::env::var("EXOMIND_AGENT_API_KEY").ok()?;
    let base_url = std::env::var("EXOMIND_AGENT_API_BASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Some(ApiProviderProfile {
        provider,
        model,
        base_url,
        api_key,
    })
}

fn weather_tool() -> ToolDef {
    ToolDef {
        name: "get_weather".to_string(),
        description: "返回今天的天气与气温".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "enum": ["today"]
                }
            },
            "required": ["date"],
            "additionalProperties": false
        }),
    }
}

fn panic_if_auth_failed(error: &SessionError) {
    let message = error.to_string();
    assert!(
        !message.contains("401"),
        "real-upstream auth failed with 401; check EXOMIND_AGENT_API_* env vars or ~/.codex credentials: {message}"
    );
}

#[tokio::test]
async fn route_runs_session_with_runtime_config_fallback() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_test_state(temp.path());

    state
        .eventlog_store
        .append_event(
            Some("profile-argon"),
            EventRecord {
                id: "evt-1".to_string(),
                timestamp: 1,
                content: "梳理 agent session service".to_string(),
                tags: vec!["analysis".to_string()],
                metadata: None,
            },
        )
        .unwrap();
    state
        .eventlog_store
        .append_event(
            Some("profile-argon"),
            EventRecord {
                id: "evt-2".to_string(),
                timestamp: 2,
                content: "接入 HTTP route".to_string(),
                tags: vec!["code".to_string()],
                metadata: None,
            },
        )
        .unwrap();

    let (base_url, shutdown_tx) = spawn_fake_openai_server().await;
    state
        .config_store
        .put(put_config("exomind:agentApiProvider", "openai".to_string(), false))
        .unwrap();
    state
        .config_store
        .put(put_config("exomind:agentApiModel", "gpt-test".to_string(), false))
        .unwrap();
    state
        .config_store
        .put(put_config("exomind:agentApiBaseUrl", base_url, false))
        .unwrap();
    state
        .config_store
        .put(put_config("exomind:agentApiApiKey", "sk-test".to_string(), true))
        .unwrap();

    let app = agent_sessions::router().with_state(state);

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
                            "name": GET_RECENT_EVENTS_TOOL,
                            "description": "获取最近事件",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "limit": { "type": "integer" }
                                }
                            }
                        }],
                        "newUserMessage": "分析我最近在做什么"
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
    assert_eq!(created["assistantTurn"]["toolCalls"].as_array().unwrap().len(), 1);
    assert_eq!(created["toolCalls"].as_array().unwrap().len(), 1);
    assert_eq!(created["toolCalls"][0]["toolName"], GET_RECENT_EVENTS_TOOL);

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
async fn life_tick_persists_internal_agent_session() {
    let temp = tempfile::tempdir().unwrap();
    let config_store = Arc::new(ConfigStore::new());
    let eventlog_store = Arc::new(EventLogStore::new(temp.path().join("eventlog")));
    let agent_api_session_store = Arc::new(AgentSessionStore::new());
    let runtime = AgentSessionRuntime::new(
        Arc::clone(&config_store),
        Arc::clone(&eventlog_store),
        Arc::clone(&agent_api_session_store),
    );

    eventlog_store
        .append_event(
            None,
            EventRecord {
                id: "evt-1".to_string(),
                timestamp: 1,
                content: "梳理 session runtime context".to_string(),
                tags: vec!["analysis".to_string()],
                metadata: None,
            },
        )
        .unwrap();
    eventlog_store
        .append_event(
            None,
            EventRecord {
                id: "evt-2".to_string(),
                timestamp: 2,
                content: "接 life-agent tick".to_string(),
                tags: vec!["code".to_string()],
                metadata: None,
            },
        )
        .unwrap();

    let (base_url, shutdown_tx) = spawn_fake_openai_server().await;
    config_store
        .put(put_config("exomind:agentApiProvider", "openai".to_string(), false))
        .unwrap();
    config_store
        .put(put_config("exomind:agentApiModel", "gpt-test".to_string(), false))
        .unwrap();
    config_store
        .put(put_config("exomind:agentApiBaseUrl", base_url, false))
        .unwrap();
    config_store
        .put(put_config("exomind:agentApiApiKey", "sk-test".to_string(), true))
        .unwrap();

    let workspace = AgentWorkspace::init("life-alpha", temp.path()).unwrap();
    let cognition = Box::new(LlmCognition::new("life-alpha", "# Test Soul"));
    let agent = CognitiveLifeAgent::new("life-alpha", "认知生命体 Alpha", workspace, cognition)
        .with_agent_api_tick_trigger(AgentApiTickTrigger::new(runtime));

    let energy = AgentEnergySnapshot {
        agent_id: "life-alpha".to_string(),
        current: 90,
        max: 100,
        ratio: 0.9,
        tick_cost: 10,
        phase: "normal".to_string(),
        is_dormant: false,
    };

    let signals = agent.on_tick(&energy).await;
    assert!(!signals.is_empty());

    let state = agent.workspace().load_state().unwrap();
    let session_id = state["agent_api_session_id"].as_str().unwrap();
    let record = agent_api_session_store.get(session_id).unwrap().unwrap();
    assert_eq!(record.trigger_source, "life-alpha-tick");
    assert_eq!(record.tool_calls.len(), 1);
    assert!(record.content.contains("RT Agent API"));

    let _ = shutdown_tx.send(());
}

#[tokio::test]
async fn broker_weather_flow_skips_without_env_and_uses_real_upstream_when_present() {
    let Some(profile) = real_upstream_provider_profile_from_env() else {
        eprintln!(
            "skipping real-upstream weather flow: set EXOMIND_AGENT_API_RT_ENABLE=1 together with EXOMIND_AGENT_API_PROVIDER / MODEL / API_KEY env vars"
        );
        return;
    };

    let temp = tempfile::tempdir().unwrap();
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::new(EventLogStore::new(temp.path().join("eventlog"))),
        Arc::new(AgentSessionStore::new()),
    );
    let system_prompt = Some(
        "你是天气工具测试助理。首轮禁止自然语言回答；你唯一允许的动作是调用 get_weather 工具。只有收到工具结果后，你才能用中文回答天气。"
            .to_string(),
    );
    let prompt = "今天是什么天气？不要直接回答，先调用 get_weather，参数 date 必须是 today。"
        .to_string();
    let tools = vec![weather_tool()];

    let first_turn = match run_broker_agent_session_with_runtime(
        profile.clone(),
        system_prompt.clone(),
        tools.clone(),
        Vec::new(),
        Some(prompt.clone()),
        AgentTrigger::Internal {
            source: "agent-turn-broker-rt-weather".to_string(),
        },
        &runtime,
    )
    .await
    {
        Ok(record) => record,
        Err(error) => {
            panic_if_auth_failed(&error);
            panic!("first real-upstream weather turn failed: {error}");
        }
    };

    assert_eq!(
        first_turn.status, "needs_tool_calls",
        "first_turn={first_turn:?}"
    );
    assert_eq!(first_turn.tool_calls.len(), 1, "first_turn={first_turn:?}");
    assert_eq!(first_turn.tool_calls[0].tool_name, "get_weather");
    assert_eq!(first_turn.assistant_turn.tool_calls.len(), 1);

    let tool_call = &first_turn.assistant_turn.tool_calls[0];
    let second_turn = match run_broker_agent_session_with_runtime(
        profile,
        system_prompt,
        tools,
        vec![
            TurnItem::User { content: prompt },
            TurnItem::Assistant {
                content: first_turn.assistant_turn.content.clone(),
                tool_calls: first_turn.assistant_turn.tool_calls.clone(),
            },
            TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content: "今天是阴天，气温21.45度".to_string(),
            },
        ],
        None,
        AgentTrigger::Internal {
            source: "agent-turn-broker-rt-weather".to_string(),
        },
        &runtime,
    )
    .await
    {
        Ok(record) => record,
        Err(error) => {
            panic_if_auth_failed(&error);
            panic!("second real-upstream weather turn failed: {error}");
        }
    };

    assert_eq!(second_turn.status, "completed", "second_turn={second_turn:?}");
    assert!(
        second_turn.content.contains("今天是阴天，气温21.45度"),
        "second_turn={second_turn:?}"
    );
    assert!(second_turn.assistant_turn.tool_calls.is_empty());
}
