use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

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
use exomind_runtime::agent::proposal_tools::{
    ADD_EVENT_PROPOSAL_TOOL, ADD_TASK_PROPOSAL_TOOL, ADD_TIMEBLOCK_PROPOSAL_TOOL,
    execute_proposal_tool_call, is_proposal_tool_name, proposal_tool_defs,
};
use exomind_runtime::agent::session::{
    AgentSessionRuntime, AgentSessionStore, AgentTrigger, SessionError,
    TOOL_PRESET_PROPOSAL_TOOLS, TOOL_PRESET_RECENT_EVENTS,
    run_broker_agent_session_from_sources_with_runtime, run_broker_agent_session_with_runtime,
};
use exomind_runtime::agent::tools::GET_RECENT_EVENTS_TOOL;
use exomind_runtime::agent::tools::eventlog::get_recent_events_tool;
use exomind_runtime::agent::workspace::AgentWorkspace;
use exomind_runtime::config::types::USER_CONFIG_SCOPE;
use exomind_runtime::config::{ConfigStore, PutConfigEntryInput};
use exomind_runtime::energy::AgentEnergySnapshot;
use exomind_runtime::eventlog::{EventLogStore, EventRecord};
use exomind_runtime::proposal::{
    ActionType, ProposalFilter, ProposalStore, Publisher, PublisherType,
};
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
    let mut state =
        AppState::new_runtime(0, "agent-api-rt-test".to_string(), None, None, false, None);
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
        assert_eq!(
            payload["tools"][0]["function"]["name"],
            GET_RECENT_EVENTS_TOOL
        );
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

async fn fake_openai_combined_sources_handler(
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
    assert!(tool_names.contains(&GET_RECENT_EVENTS_TOOL.to_string()));
    assert!(tool_names.contains(&"get_weather".to_string()));

    Json(json!({
        "choices": [{
            "message": {
                "role": "assistant",
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

async fn fake_openai_proposal_story_handler(
    AxumState(call_count): AxumState<Arc<AtomicUsize>>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let turn = call_count.fetch_add(1, Ordering::SeqCst);

    if turn == 0 {
        let tool_names = payload["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert!(tool_names.contains(&ADD_TASK_PROPOSAL_TOOL.to_string()));
        assert!(tool_names.contains(&ADD_TIMEBLOCK_PROPOSAL_TOOL.to_string()));
        assert!(tool_names.contains(&ADD_EVENT_PROPOSAL_TOOL.to_string()));

        return Json(json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "proposal-tool-1",
                        "type": "function",
                        "function": {
                            "name": ADD_TASK_PROPOSAL_TOOL,
                            "arguments": "{\"title\":\"为任务依赖图新布局创建验收任务提案\",\"body\":\"事件日志提到明天可能要验收任务依赖图新布局，需要提前形成可执行草案。\",\"taskTitle\":\"验收任务依赖图新布局\",\"description\":\"基于最近 task-dag 改动，检查新布局与搜索交互。\",\"tags\":[\"task-dag\",\"acceptance\"],\"priority\":\"high\"}"
                        }
                    }]
                }
            }]
        }));
    }

    if turn == 1 {
        assert!(payload["messages"].as_array().is_some_and(|messages| {
            messages
                .iter()
                .any(|message| message["role"] == json!("tool"))
        }));
        return Json(json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "proposal-tool-2",
                        "type": "function",
                        "function": {
                            "name": ADD_TIMEBLOCK_PROPOSAL_TOOL,
                            "arguments": "{\"title\":\"为任务依赖图验收预留时间块\",\"body\":\"日志里已经出现明天验收意图，且 task-dag 相关功能刚落地，适合补一个聚焦验收时间块。\",\"name\":\"任务依赖图新布局验收\",\"description\":\"集中检查任务依赖图的新布局与搜索体验\",\"tags\":[\"task-dag\",\"review\"],\"mode\":\"countdown\",\"targetMinutes\":45}"
                        }
                    }]
                }
            }]
        }));
    }

    if turn == 2 {
        return Json(json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "proposal-tool-3",
                        "type": "function",
                        "function": {
                            "name": ADD_EVENT_PROPOSAL_TOOL,
                            "arguments": "{\"title\":\"补一条时间块完成总结事件提案\",\"body\":\"事件日志显示刚完成一个时间块并准备开始总结，适合补一条 Agent 总结事件草案。\",\"content\":\"Agent 总结：已完成文件搜索验证，下一步转向任务依赖图新布局验收与回填。\",\"tags\":[\"agent-summary\",\"timeblock-review\"]}"
                        }
                    }]
                }
            }]
        }));
    }

    Json(json!({
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "我已根据事件日志创建任务提案、计划时间块提案和总结事件提案，其中任务提案用于明天验收任务依赖图新布局。",
                "tool_calls": []
            }
        }]
    }))
}

async fn fake_openai_combined_story_handler(
    AxumState(call_count): AxumState<Arc<AtomicUsize>>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let turn = call_count.fetch_add(1, Ordering::SeqCst);
    let tool_names = payload["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();

    let tool_contents = payload["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|message| message["role"] == json!("tool"))
        .filter_map(|message| message["content"].as_str())
        .collect::<Vec<_>>();

    match turn {
        0 => {
            assert!(tool_names.contains(&GET_RECENT_EVENTS_TOOL.to_string()));
            assert!(tool_names.contains(&"get_weather".to_string()));
            assert!(tool_names.contains(&ADD_TASK_PROPOSAL_TOOL.to_string()));

            Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "combined-tool-1",
                            "type": "function",
                            "function": {
                                "name": GET_RECENT_EVENTS_TOOL,
                                "arguments": "{\"limit\":5}"
                            }
                        }]
                    }
                }]
            }))
        }
        1 => {
            assert!(tool_contents
                .iter()
                .any(|content| content.contains("明天要出门去银行存钱，不知天气如何")));
            assert!(tool_contents
                .iter()
                .any(|content| content.contains("家里刚找到之前不知跑哪去了的伞，原来是放衣柜里了")));

            Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{
                            "id": "combined-tool-2",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": "{\"date\":\"tomorrow\"}"
                            }
                        }]
                    }
                }]
            }))
        }
        2 => {
            assert!(tool_contents
                .iter()
                .any(|content| content.contains("明天温度24.5度，暴雨")));

            Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "combined-tool-3",
                                "type": "function",
                                "function": {
                                    "name": ADD_TASK_PROPOSAL_TOOL,
                                    "arguments": "{\"title\":\"任务提案：出门准备雨伞\",\"body\":\"近期事件显示明天要出门去银行，天气工具显示明天暴雨，而且用户已经找到了伞，因此需要提前准备并带上雨伞。\",\"taskTitle\":\"出门准备雨伞\",\"description\":\"出门前从衣柜取出雨伞并随身携带。\",\"tags\":[\"天气\",\"暴雨\",\"出门准备\"],\"priority\":\"high\"}"
                                }
                            },
                            {
                                "id": "combined-tool-4",
                                "type": "function",
                                "function": {
                                    "name": ADD_TASK_PROPOSAL_TOOL,
                                    "arguments": "{\"title\":\"任务提案：银行存钱\",\"body\":\"近期事件明确提到明天要出门去银行存钱，应单独形成明日外出事务任务。\",\"taskTitle\":\"银行存钱\",\"description\":\"明天出门去银行办理存钱事项。\",\"tags\":[\"银行\",\"外出\"],\"priority\":\"high\"}"
                                }
                            }
                        ]
                    }
                }]
            }))
        }
        3 => {
            assert!(tool_contents.iter().any(|content| content.contains("出门准备雨伞")));
            assert!(tool_contents.iter().any(|content| content.contains("银行存钱")));

            Json(json!({
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "我先读取了近期事件，再查询了明天的天气。由于明天要去银行且天气是暴雨，同时事件里提到雨伞已经找回，所以我创建了两条任务提案：出门准备雨伞、银行存钱。",
                        "tool_calls": []
                    }
                }]
            }))
        }
        other => panic!("unexpected combined story turn: {other}"),
    }
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

async fn spawn_fake_openai_combined_sources_server() -> (String, oneshot::Sender<()>) {
    let app = Router::new()
        .route("/chat/completions", post(fake_openai_combined_sources_handler))
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

async fn spawn_fake_openai_proposal_story_server() -> (String, oneshot::Sender<()>) {
    let app = Router::new()
        .route(
            "/chat/completions",
            post(fake_openai_proposal_story_handler),
        )
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

async fn spawn_fake_openai_combined_story_server() -> (String, oneshot::Sender<()>) {
    let app = Router::new()
        .route("/chat/completions", post(fake_openai_combined_story_handler))
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

fn real_upstream_fs_root_from_env() -> Option<PathBuf> {
    std::env::var("EXOMIND_AGENT_API_RT_FS_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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

fn tomorrow_weather_tool() -> ToolDef {
    ToolDef {
        name: "get_weather".to_string(),
        description: "返回明天的天气与气温".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "enum": ["tomorrow"]
                }
            },
            "required": ["date"],
            "additionalProperties": false
        }),
    }
}

async fn execute_combined_story_tool_call(
    eventlog_store: Arc<EventLogStore>,
    proposal_store: Arc<ProposalStore>,
    publisher: &Publisher,
    scope_key: &str,
    tool_call: &exomind_runtime::agent::broker::ToolCall,
) -> String {
    match tool_call.name.as_str() {
        GET_RECENT_EVENTS_TOOL => {
            let (_, tool_fn) =
                get_recent_events_tool(eventlog_store, Some(scope_key.to_string()));
            tool_fn(tool_call.input.clone())
                .await
                .unwrap_or_else(|error| panic!("recent events tool execution failed: {error}"))
        }
        "get_weather" => {
            assert_eq!(
                tool_call.input["date"].as_str(),
                Some("tomorrow"),
                "combined weather story should request tomorrow weather"
            );
            "明天温度24.5度，暴雨".to_string()
        }
        name if is_proposal_tool_name(name) => execute_proposal_tool_call(
            proposal_store,
            Some(scope_key.to_string()),
            publisher.clone(),
            tool_call,
        )
        .await
        .unwrap_or_else(|error| panic!("proposal tool execution failed: {error}")),
        other => panic!("unexpected combined story tool requested: {other}"),
    }
}

fn panic_if_auth_failed(error: &SessionError) {
    let message = error.to_string();
    assert!(
        !message.contains("401"),
        "real-upstream auth failed with 401; check EXOMIND_AGENT_API_* env vars or ~/.codex credentials: {message}"
    );
}

fn is_retryable_upstream_error_message(message: &str) -> bool {
    message.contains("429")
        || message.contains("502")
        || message.contains("503")
        || message.contains("bad_response_status_code")
        || message.contains("OpenAI SSE 响应未提供可解析的 choices")
        || message.contains("system cpu overloaded")
        || message.contains("Service temporarily unavailable")
}

async fn run_real_upstream_turn_with_retries<F, Fut>(
    label: &str,
    mut operation: F,
) -> Result<exomind_runtime::agent::session::AgentSessionRecord, SessionError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<
        Output = Result<exomind_runtime::agent::session::AgentSessionRecord, SessionError>,
    >,
{
    const MAX_ATTEMPTS: usize = 3;

    for attempt in 1..=MAX_ATTEMPTS {
        match operation().await {
            Ok(record) => return Ok(record),
            Err(error) => {
                panic_if_auth_failed(&error);
                let message = error.to_string();
                if attempt == MAX_ATTEMPTS || !is_retryable_upstream_error_message(&message) {
                    return Err(error);
                }

                eprintln!(
                    "retrying {label} after transient upstream failure (attempt {attempt}/{MAX_ATTEMPTS}): {message}"
                );
                tokio::time::sleep(Duration::from_secs(attempt as u64)).await;
            }
        }
    }

    unreachable!("real upstream retry loop should always return");
}

#[test]
fn retryable_upstream_error_detection_keeps_401_non_retryable() {
    assert!(is_retryable_upstream_error_message(
        "OpenAI HTTP 503 Service Unavailable: system cpu overloaded"
    ));
    assert!(is_retryable_upstream_error_message(
        "OpenAI HTTP 429 Too Many Requests"
    ));
    assert!(is_retryable_upstream_error_message(
        "OpenAI HTTP 502 Bad Gateway: bad_response_status_code"
    ));
    assert!(is_retryable_upstream_error_message(
        "OpenAI 响应解析失败: sse_error=OpenAI SSE 响应未提供可解析的 choices"
    ));
    assert!(!is_retryable_upstream_error_message(
        "OpenAI HTTP 401 Unauthorized"
    ));
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
        .put(put_config(
            "exomind:agentApiProvider",
            "openai".to_string(),
            false,
        ))
        .unwrap();
    state
        .config_store
        .put(put_config(
            "exomind:agentApiModel",
            "gpt-test".to_string(),
            false,
        ))
        .unwrap();
    state
        .config_store
        .put(put_config("exomind:agentApiBaseUrl", base_url, false))
        .unwrap();
    state
        .config_store
        .put(put_config(
            "exomind:agentApiApiKey",
            "sk-test".to_string(),
            true,
        ))
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
    assert_eq!(
        created["assistantTurn"]["toolCalls"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
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
async fn route_allows_combined_presets_and_explicit_tools() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_test_state(temp.path());

    let (base_url, shutdown_tx) = spawn_fake_openai_combined_sources_server().await;
    let app = agent_sessions::router().with_state(state);

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
                        "scopeKey": "profile-argon",
                        "tools": [{
                            "name": "get_weather",
                            "description": "获取天气",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "date": { "type": "string" }
                                },
                                "required": ["date"],
                                "additionalProperties": false
                            }
                        }],
                        "providerProfile": {
                            "provider": "openai",
                            "model": "gpt-test",
                            "baseUrl": base_url,
                            "apiKey": "sk-test"
                        },
                        "newUserMessage": "先看最近事件，再查今天的天气。"
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
async fn life_tick_persists_internal_agent_session() {
    let temp = tempfile::tempdir().unwrap();
    let config_store = Arc::new(ConfigStore::new());
    let eventlog_store = Arc::new(EventLogStore::new(temp.path().join("eventlog")));
    let agent_api_session_store = Arc::new(AgentSessionStore::new());
    let runtime = AgentSessionRuntime::new(
        Arc::clone(&config_store),
        Arc::clone(&eventlog_store),
        Arc::new(ProposalStore::new()),
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
        .put(put_config(
            "exomind:agentApiProvider",
            "openai".to_string(),
            false,
        ))
        .unwrap();
    config_store
        .put(put_config(
            "exomind:agentApiModel",
            "gpt-test".to_string(),
            false,
        ))
        .unwrap();
    config_store
        .put(put_config("exomind:agentApiBaseUrl", base_url, false))
        .unwrap();
    config_store
        .put(put_config(
            "exomind:agentApiApiKey",
            "sk-test".to_string(),
            true,
        ))
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
        Arc::new(ProposalStore::new()),
        Arc::new(AgentSessionStore::new()),
    );
    let system_prompt = Some(
        "你是天气工具测试助理。首轮禁止自然语言回答；你唯一允许的动作是调用 get_weather 工具。只有收到工具结果后，你才能用中文回答天气。"
            .to_string(),
    );
    let prompt =
        "今天是什么天气？不要直接回答，先调用 get_weather，参数 date 必须是 today。".to_string();
    let tools = vec![weather_tool()];

    eprintln!("=== broker_weather_flow start ===");
    eprintln!("provider={} model={}", profile.provider, profile.model);
    eprintln!("prompt={prompt}");
    eprintln!(
        "tool_def={}",
        serde_json::to_string_pretty(&tools).unwrap()
    );

    let first_turn = run_real_upstream_turn_with_retries("weather turn 1", || {
        run_broker_agent_session_with_runtime(
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
    })
    .await
    .unwrap_or_else(|error| panic!("first real-upstream weather turn failed: {error}"));

    eprintln!("--- turn 1 response ---");
    eprintln!("session_id={}", first_turn.session_id);
    eprintln!("status={}", first_turn.status);
    eprintln!(
        "content={}",
        serde_json::to_string_pretty(&first_turn.content).unwrap()
    );
    eprintln!(
        "assistant_turn={}",
        serde_json::to_string_pretty(&first_turn.assistant_turn).unwrap()
    );
    eprintln!(
        "tool_calls={}",
        serde_json::to_string_pretty(&first_turn.tool_calls).unwrap()
    );

    assert_eq!(
        first_turn.status, "needs_tool_calls",
        "first_turn={first_turn:?}"
    );
    assert_eq!(first_turn.tool_calls.len(), 1, "first_turn={first_turn:?}");
    assert_eq!(first_turn.tool_calls[0].tool_name, "get_weather");
    assert_eq!(first_turn.assistant_turn.tool_calls.len(), 1);

    let tool_call = &first_turn.assistant_turn.tool_calls[0];
    assert_eq!(tool_call.input["date"].as_str(), Some("today"));
    let tool_output = "今天是阴天，气温21.45度".to_string();
    eprintln!(
        "executed_tool_call={}",
        serde_json::to_string_pretty(tool_call).unwrap()
    );
    eprintln!("tool_output={tool_output}");
    let second_turn = run_real_upstream_turn_with_retries("weather turn 2", || {
        run_broker_agent_session_with_runtime(
            profile.clone(),
            system_prompt.clone(),
            tools.clone(),
            vec![
                TurnItem::User {
                    content: prompt.clone(),
                },
                TurnItem::Assistant {
                    content: first_turn.assistant_turn.content.clone(),
                    tool_calls: first_turn.assistant_turn.tool_calls.clone(),
                },
                TurnItem::ToolResult {
                    tool_call_id: tool_call.id.clone(),
                    tool_name: tool_call.name.clone(),
                    content: tool_output.clone(),
                },
            ],
            None,
            AgentTrigger::Internal {
                source: "agent-turn-broker-rt-weather".to_string(),
            },
            &runtime,
        )
    })
    .await
    .unwrap_or_else(|error| panic!("second real-upstream weather turn failed: {error}"));

    eprintln!("--- turn 2 response ---");
    eprintln!("session_id={}", second_turn.session_id);
    eprintln!("status={}", second_turn.status);
    eprintln!(
        "content={}",
        serde_json::to_string_pretty(&second_turn.content).unwrap()
    );
    eprintln!(
        "assistant_turn={}",
        serde_json::to_string_pretty(&second_turn.assistant_turn).unwrap()
    );
    eprintln!(
        "tool_calls={}",
        serde_json::to_string_pretty(&second_turn.tool_calls).unwrap()
    );

    assert_eq!(
        second_turn.status, "completed",
        "second_turn={second_turn:?}"
    );
    assert!(
        second_turn.content.contains("今天是阴天，气温21.45度"),
        "second_turn={second_turn:?}"
    );
    assert!(second_turn.assistant_turn.tool_calls.is_empty());
    eprintln!("=== broker_weather_flow completed ===");
    eprintln!("final_answer={}", second_turn.content);
}

#[tokio::test]
async fn broker_proposal_story_contract_creates_real_proposals() {
    let temp = tempfile::tempdir().unwrap();
    let proposal_store = Arc::new(ProposalStore::new());
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::new(EventLogStore::new(temp.path().join("eventlog"))),
        Arc::clone(&proposal_store),
        Arc::new(AgentSessionStore::new()),
    );
    let system_prompt = Some(
        "你是外心中的提案草案助手。请从事件日志中提取值得形成草案的事项，优先通过工具创建任务提案、计划时间块提案、事件提案。"
            .to_string(),
    );
    let prompt = r#"下面是最近的事件记录和开发上下文：
2026-04-04 09:10 事件：刚推送 test(rt): add broker file search validation
2026-04-04 09:35 事件：feat(task-dag): unify dag text and tag search 已在 dev
2026-04-04 10:20 事件：对了，明天可能要验收下任务依赖图新布局
2026-04-04 10:45 事件：刚完成一轮 pwd/ls/cd 文件搜索验证，准备回填 issue
2026-04-04 11:05 事件：完成一个时间块，准备开始总结

请提取其中值得形成草案的事项。至少为“明天可能要验收下任务依赖图新布局”创建一个任务提案；如果上下文表明应该安排时间块或补一条总结事件，也请创建相应草案。完成后请用中文总结你创建了哪些草案以及原因。"#.to_string();
    let publisher = Publisher {
        publisher_type: PublisherType::Agent,
        id: "api-agent".to_string(),
        name: "API Agent".to_string(),
    };

    let (base_url, shutdown_tx) = spawn_fake_openai_proposal_story_server().await;
    let profile = ApiProviderProfile {
        provider: "openai".to_string(),
        model: "gpt-test".to_string(),
        base_url: Some(base_url),
        api_key: "sk-test".to_string(),
    };

    let mut history = Vec::new();
    let mut next_user_message = Some(prompt.clone());
    let mut turn_count = 0usize;

    loop {
        turn_count += 1;
        assert!(turn_count <= 6, "proposal story exceeded turn budget");

        let record = run_broker_agent_session_with_runtime(
            profile.clone(),
            system_prompt.clone(),
            proposal_tool_defs(),
            history.clone(),
            next_user_message.take(),
            AgentTrigger::Internal {
                source: "agent-turn-broker-proposal-story".to_string(),
            },
            &runtime,
        )
        .await
        .unwrap();

        if turn_count == 1 {
            history.push(TurnItem::User {
                content: prompt.clone(),
            });
        }

        history.push(TurnItem::Assistant {
            content: record.assistant_turn.content.clone(),
            tool_calls: record.assistant_turn.tool_calls.clone(),
        });

        if record.status == "completed" {
            assert!(record.content.contains("任务提案"));
            break;
        }

        for tool_call in &record.assistant_turn.tool_calls {
            let output = execute_proposal_tool_call(
                Arc::clone(&proposal_store),
                Some("profile-alpha".to_string()),
                publisher.clone(),
                tool_call,
            )
            .await
            .unwrap();

            history.push(TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content: output,
            });
        }
    }

    let proposals = proposal_store
        .list_scoped(Some("profile-alpha"), &ProposalFilter::default())
        .unwrap();
    assert_eq!(proposals.len(), 3);
    assert!(
        proposals
            .iter()
            .any(|proposal| proposal.action_type == ActionType::CreateTask)
    );
    assert!(
        proposals
            .iter()
            .any(|proposal| proposal.action_type == ActionType::StartTimeblock)
    );
    assert!(
        proposals
            .iter()
            .any(|proposal| proposal.action_type == ActionType::AppendEvent)
    );

    let _ = shutdown_tx.send(());
}

#[tokio::test]
async fn broker_combined_story_contract_reads_events_weather_and_creates_two_task_proposals() {
    let temp = tempfile::tempdir().unwrap();
    let eventlog_store = Arc::new(EventLogStore::new(temp.path().join("eventlog")));
    let proposal_store = Arc::new(ProposalStore::new());
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::clone(&eventlog_store),
        Arc::clone(&proposal_store),
        Arc::new(AgentSessionStore::new()),
    );
    let scope_key = "profile-alpha";

    eventlog_store
        .append_event(
            Some(scope_key),
            EventRecord {
                id: "evt-bank".to_string(),
                timestamp: 2,
                content: "明天要出门去银行存钱，不知天气如何".to_string(),
                tags: vec!["life".to_string(), "bank".to_string()],
                metadata: None,
            },
        )
        .unwrap();
    eventlog_store
        .append_event(
            Some(scope_key),
            EventRecord {
                id: "evt-umbrella".to_string(),
                timestamp: 1,
                content: "家里刚找到之前不知跑哪去了的伞，原来是放衣柜里了".to_string(),
                tags: vec!["home".to_string(), "umbrella".to_string()],
                metadata: None,
            },
        )
        .unwrap();

    let system_prompt = Some(
        "你是外心中的明日准备助理。你必须先调用 get_recent_events 读取近期事件，再判断是否需要调用 get_weather(date=tomorrow) 获取明天天气。随后根据事件与天气，为用户创建明天要做的任务提案。不要只给口头建议；如果既有外出办事事项，又因暴雨需要准备雨具，就应拆成两个独立任务提案。".to_string(),
    );
    let prompt = "请根据最近事件和明天天气，为用户补全明天需要做的任务提案。先读事件，再按需要查天气，再创建任务提案。".to_string();
    let publisher = Publisher {
        publisher_type: PublisherType::Agent,
        id: "api-agent".to_string(),
        name: "API Agent".to_string(),
    };

    let (base_url, shutdown_tx) = spawn_fake_openai_combined_story_server().await;
    let profile = ApiProviderProfile {
        provider: "openai".to_string(),
        model: "gpt-test".to_string(),
        base_url: Some(base_url),
        api_key: "sk-test".to_string(),
    };

    let presets = vec![
        TOOL_PRESET_RECENT_EVENTS.to_string(),
        TOOL_PRESET_PROPOSAL_TOOLS.to_string(),
    ];
    let mut history = Vec::new();
    let mut next_user_message = Some(prompt.clone());
    let mut turn_count = 0usize;
    let mut executed_tools = Vec::new();

    loop {
        turn_count += 1;
        assert!(turn_count <= 6, "combined story exceeded turn budget");

        let record = run_broker_agent_session_from_sources_with_runtime(
            profile.clone(),
            system_prompt.clone(),
            vec![tomorrow_weather_tool()],
            &presets,
            Some(scope_key.to_string()),
            history.clone(),
            next_user_message.take(),
            AgentTrigger::Internal {
                source: "agent-turn-broker-combined-story-contract".to_string(),
            },
            &runtime,
        )
        .await
        .unwrap();

        if turn_count == 1 {
            history.push(TurnItem::User {
                content: prompt.clone(),
            });
        }

        history.push(TurnItem::Assistant {
            content: record.assistant_turn.content.clone(),
            tool_calls: record.assistant_turn.tool_calls.clone(),
        });

        if record.status == "completed" {
            assert!(record.content.contains("雨伞"));
            assert!(record.content.contains("银行"));
            break;
        }

        for tool_call in &record.assistant_turn.tool_calls {
            executed_tools.push(tool_call.name.clone());
            let output = execute_combined_story_tool_call(
                Arc::clone(&eventlog_store),
                Arc::clone(&proposal_store),
                &publisher,
                scope_key,
                tool_call,
            )
            .await;
            history.push(TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content: output,
            });
        }
    }

    assert_eq!(
        executed_tools,
        vec![
            GET_RECENT_EVENTS_TOOL.to_string(),
            "get_weather".to_string(),
            ADD_TASK_PROPOSAL_TOOL.to_string(),
            ADD_TASK_PROPOSAL_TOOL.to_string()
        ]
    );

    let proposals = proposal_store
        .list_scoped(Some(scope_key), &ProposalFilter::default())
        .unwrap();
    let task_titles = proposals
        .iter()
        .filter(|proposal| proposal.action_type == ActionType::CreateTask)
        .map(|proposal| proposal.title.clone())
        .collect::<Vec<_>>();
    assert_eq!(task_titles.len(), 2, "proposals={proposals:?}");
    assert!(task_titles.iter().any(|title| title.contains("雨伞")));
    assert!(task_titles.iter().any(|title| title.contains("银行存钱")));

    let _ = shutdown_tx.send(());
}

#[tokio::test]
async fn broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present() {
    let Some(profile) = real_upstream_provider_profile_from_env() else {
        eprintln!(
            "skipping real-upstream proposal story: set EXOMIND_AGENT_API_RT_ENABLE=1 together with EXOMIND_AGENT_API_PROVIDER / MODEL / API_KEY env vars"
        );
        return;
    };

    let temp = tempfile::tempdir().unwrap();
    let proposal_store = Arc::new(ProposalStore::new());
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::new(EventLogStore::new(temp.path().join("eventlog"))),
        Arc::clone(&proposal_store),
        Arc::new(AgentSessionStore::new()),
    );
    let system_prompt = Some(
        "你是外心中的提案草案助手。你会阅读最近事件与开发上下文，把值得后续处理的事项转成结构化草案。优先通过工具创建任务提案、计划时间块提案、事件提案，而不是只做口头建议。若上下文明确提到后续验收、需要安排专注工作时间、或者需要补一条总结事件，就应分别创建对应草案。完成必要的草案创建后，再用中文总结你创建了哪些草案以及原因。"
            .to_string(),
    );
    let prompt = r#"下面是最近的事件记录和开发上下文：
2026-04-04 09:10 事件：刚推送 test(rt): add broker file search validation
2026-04-04 09:35 事件：feat(task-dag): unify dag text and tag search 已在 dev
2026-04-04 10:20 事件：对了，明天可能要验收下任务依赖图新布局
2026-04-04 10:45 事件：刚完成一轮 pwd/ls/cd 文件搜索验证，准备回填 issue
2026-04-04 11:05 事件：完成一个时间块，准备开始总结
2026-04-04 11:20 事件：下一步希望把这轮 API Agent 实验整理成 issue 回填与简明总结

请先阅读这些内容，提取其中值得形成草案的事项。你可以按需要调用添加任务提案、添加计划时间块提案、添加事件提案这三种工具。至少应为“明天可能要验收下任务依赖图新布局”创建一个任务提案；如果上下文表明应该安排时间块或补一条总结事件，也请创建相应草案。完成后请用中文总结你创建了哪些草案以及原因。"#.to_string();
    let publisher = Publisher {
        publisher_type: PublisherType::Agent,
        id: "api-agent".to_string(),
        name: "API Agent".to_string(),
    };

    let mut history = Vec::new();
    let mut next_user_message = Some(prompt.clone());
    let mut turn_count = 0usize;

    eprintln!("=== broker_proposal_story start ===");
    eprintln!("provider={} model={}", profile.provider, profile.model);

    loop {
        turn_count += 1;
        assert!(
            turn_count <= 10,
            "proposal story exceeded turn budget; history={history:?}"
        );

        eprintln!("\n--- turn {turn_count} request ---");
        eprintln!(
            "history_len={} new_user_message_present={}",
            history.len(),
            next_user_message.is_some()
        );

        let record = match run_broker_agent_session_with_runtime(
            profile.clone(),
            system_prompt.clone(),
            proposal_tool_defs(),
            history.clone(),
            next_user_message.take(),
            AgentTrigger::Internal {
                source: "agent-turn-broker-proposal-story".to_string(),
            },
            &runtime,
        )
        .await
        {
            Ok(record) => record,
            Err(error) => {
                panic_if_auth_failed(&error);
                panic!("real-upstream proposal story turn failed: {error}");
            }
        };

        eprintln!("--- turn {turn_count} response ---");
        eprintln!("session_id={}", record.session_id);
        eprintln!("status={}", record.status);
        eprintln!(
            "content={}",
            serde_json::to_string_pretty(&record.content).unwrap()
        );
        eprintln!(
            "assistant_turn={}",
            serde_json::to_string_pretty(&record.assistant_turn).unwrap()
        );
        eprintln!(
            "tool_calls={}",
            serde_json::to_string_pretty(&record.tool_calls).unwrap()
        );

        if turn_count == 1 {
            history.push(TurnItem::User {
                content: prompt.clone(),
            });
        }

        history.push(TurnItem::Assistant {
            content: record.assistant_turn.content.clone(),
            tool_calls: record.assistant_turn.tool_calls.clone(),
        });

        if record.status == "completed" {
            let proposals = proposal_store
                .list_scoped(Some("profile-alpha"), &ProposalFilter::default())
                .unwrap();
            assert!(
                !proposals.is_empty(),
                "proposal story should create at least one proposal"
            );
            assert!(
                proposals
                    .iter()
                    .any(|proposal| proposal.action_type == ActionType::CreateTask),
                "proposal story must create at least one task proposal; proposals={proposals:?}"
            );
            assert!(
                proposals
                    .iter()
                    .any(|proposal| proposal.action_type == ActionType::StartTimeblock),
                "proposal story should create at least one timeblock proposal; proposals={proposals:?}"
            );
            assert!(
                proposals
                    .iter()
                    .any(|proposal| proposal.action_type == ActionType::AppendEvent),
                "proposal story should create at least one event proposal; proposals={proposals:?}"
            );
            assert!(
                proposals
                    .iter()
                    .all(|proposal| proposal.publisher.publisher_type == PublisherType::Agent),
                "all created proposals should be agent-published; proposals={proposals:?}"
            );
            assert!(
                proposals
                    .iter()
                    .filter(|proposal| proposal.action_type == ActionType::CreateTask)
                    .any(|proposal| proposal.status
                        == exomind_runtime::proposal::ProposalStatus::Pending),
                "created task proposals should remain pending; proposals={proposals:?}"
            );
            assert!(
                record.content.contains("任务提案") || record.content.contains("任务草案"),
                "final summary should mention the created task proposal: {record:?}"
            );
            eprintln!("=== broker_proposal_story completed ===");
            eprintln!(
                "proposals={}",
                serde_json::to_string_pretty(&proposals).unwrap()
            );
            eprintln!("final_answer={}", record.content);
            break;
        }

        assert_eq!(
            record.status, "needs_tool_calls",
            "intermediate proposal story turn should request tools: {record:?}"
        );
        assert!(
            !record.assistant_turn.tool_calls.is_empty(),
            "proposal story should return at least one tool call before completion: {record:?}"
        );

        for tool_call in &record.assistant_turn.tool_calls {
            let output = execute_proposal_tool_call(
                Arc::clone(&proposal_store),
                Some("profile-alpha".to_string()),
                publisher.clone(),
                tool_call,
            )
            .await
            .unwrap_or_else(|error| panic!("proposal tool execution failed: {error}"));

            let proposals = proposal_store
                .list_scoped(Some("profile-alpha"), &ProposalFilter::default())
                .unwrap();
            eprintln!(
                "executed_tool_call={}",
                serde_json::to_string_pretty(tool_call).unwrap()
            );
            eprintln!("tool_output={output}");
            eprintln!(
                "proposal_snapshot={}",
                serde_json::to_string_pretty(&proposals).unwrap()
            );

            history.push(TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content: output,
            });
        }
    }
}

#[tokio::test]
async fn broker_combined_story_skips_without_env_and_uses_real_upstream_when_present() {
    let Some(profile) = real_upstream_provider_profile_from_env() else {
        eprintln!(
            "skipping real-upstream combined story: set EXOMIND_AGENT_API_RT_ENABLE=1 together with EXOMIND_AGENT_API_PROVIDER / MODEL / API_KEY env vars"
        );
        return;
    };

    let temp = tempfile::tempdir().unwrap();
    let eventlog_store = Arc::new(EventLogStore::new(temp.path().join("eventlog")));
    let proposal_store = Arc::new(ProposalStore::new());
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::clone(&eventlog_store),
        Arc::clone(&proposal_store),
        Arc::new(AgentSessionStore::new()),
    );
    let scope_key = "profile-alpha";

    eventlog_store
        .append_event(
            Some(scope_key),
            EventRecord {
                id: "evt-bank".to_string(),
                timestamp: 2,
                content: "明天要出门去银行存钱，不知天气如何".to_string(),
                tags: vec!["life".to_string(), "bank".to_string()],
                metadata: None,
            },
        )
        .unwrap();
    eventlog_store
        .append_event(
            Some(scope_key),
            EventRecord {
                id: "evt-umbrella".to_string(),
                timestamp: 1,
                content: "家里刚找到之前不知跑哪去了的伞，原来是放衣柜里了".to_string(),
                tags: vec!["home".to_string(), "umbrella".to_string()],
                metadata: None,
            },
        )
        .unwrap();

    let system_prompt = Some(
        "你是外心中的明日准备助理。你必须先调用 get_recent_events 读取近期事件，再决定是否调用 get_weather(date=tomorrow) 获取明天天气。然后根据事件与天气创建明天的任务提案。不要只给口头建议；如果存在外出办事事项，且天气显示暴雨，就把外出事务和雨具准备拆成两个独立任务提案。".to_string(),
    );
    let prompt = "请根据最近事件和明天天气，为用户添加明天的任务提案。先读事件，再查天气，再创建任务提案。不要把带伞和去银行合并成同一个任务。".to_string();
    let publisher = Publisher {
        publisher_type: PublisherType::Agent,
        id: "api-agent".to_string(),
        name: "API Agent".to_string(),
    };
    let presets = vec![
        TOOL_PRESET_RECENT_EVENTS.to_string(),
        TOOL_PRESET_PROPOSAL_TOOLS.to_string(),
    ];
    let mut history = Vec::new();
    let mut next_user_message = Some(prompt.clone());
    let mut turn_count = 0usize;
    let mut executed_tools = Vec::new();

    eprintln!("=== broker_combined_story start ===");
    eprintln!("provider={} model={}", profile.provider, profile.model);

    loop {
        turn_count += 1;
        assert!(
            turn_count <= 10,
            "combined story exceeded turn budget; history={history:?}"
        );

        eprintln!("\n--- turn {turn_count} request ---");
        eprintln!(
            "history_len={} new_user_message_present={}",
            history.len(),
            next_user_message.is_some()
        );

        let user_message_for_turn = next_user_message.take();
        let record = run_real_upstream_turn_with_retries(
            &format!("combined story turn {turn_count}"),
            || {
                run_broker_agent_session_from_sources_with_runtime(
                    profile.clone(),
                    system_prompt.clone(),
                    vec![tomorrow_weather_tool()],
                    &presets,
                    Some(scope_key.to_string()),
                    history.clone(),
                    user_message_for_turn.clone(),
                    AgentTrigger::Internal {
                        source: "agent-turn-broker-combined-story".to_string(),
                    },
                    &runtime,
                )
            },
        )
        .await
        .unwrap_or_else(|error| panic!("real-upstream combined story turn failed: {error}"));

        eprintln!("--- turn {turn_count} response ---");
        eprintln!("session_id={}", record.session_id);
        eprintln!("status={}", record.status);
        eprintln!(
            "content={}",
            serde_json::to_string_pretty(&record.content).unwrap()
        );
        eprintln!(
            "assistant_turn={}",
            serde_json::to_string_pretty(&record.assistant_turn).unwrap()
        );
        eprintln!(
            "tool_calls={}",
            serde_json::to_string_pretty(&record.tool_calls).unwrap()
        );

        if turn_count == 1 {
            history.push(TurnItem::User {
                content: prompt.clone(),
            });
        }

        history.push(TurnItem::Assistant {
            content: record.assistant_turn.content.clone(),
            tool_calls: record.assistant_turn.tool_calls.clone(),
        });

        if record.status == "completed" {
            let proposals = proposal_store
                .list_scoped(Some(scope_key), &ProposalFilter::default())
                .unwrap();
            let task_proposals = proposals
                .iter()
                .filter(|proposal| proposal.action_type == ActionType::CreateTask)
                .collect::<Vec<_>>();

            assert!(
                executed_tools.iter().any(|name| name == GET_RECENT_EVENTS_TOOL),
                "combined story must read recent events first; executed_tools={executed_tools:?}"
            );
            assert!(
                executed_tools.iter().any(|name| name == "get_weather"),
                "combined story must query weather; executed_tools={executed_tools:?}"
            );
            assert!(
                task_proposals.len() >= 2,
                "combined story should create at least two task proposals; proposals={proposals:?}"
            );
            assert!(
                task_proposals.iter().any(|proposal| {
                    proposal.title.contains("雨伞")
                        || proposal.body.contains("雨伞")
                        || proposal.body.contains("雨具")
                }),
                "combined story should create an umbrella-preparation proposal; proposals={proposals:?}"
            );
            assert!(
                task_proposals.iter().any(|proposal| {
                    proposal.title.contains("银行")
                        || proposal.body.contains("银行")
                        || proposal.body.contains("存钱")
                }),
                "combined story should create a bank/deposit proposal; proposals={proposals:?}"
            );
            assert!(
                record.content.contains("雨伞") || record.content.contains("银行"),
                "final answer should summarize the created proposals: {record:?}"
            );
            eprintln!("=== broker_combined_story completed ===");
            eprintln!(
                "proposals={}",
                serde_json::to_string_pretty(&proposals).unwrap()
            );
            eprintln!("executed_tools={executed_tools:?}");
            eprintln!("final_answer={}", record.content);
            break;
        }

        assert_eq!(
            record.status, "needs_tool_calls",
            "intermediate combined story turn should request tools: {record:?}"
        );
        assert!(
            !record.assistant_turn.tool_calls.is_empty(),
            "combined story should keep using tools before completion: {record:?}"
        );

        for tool_call in &record.assistant_turn.tool_calls {
            executed_tools.push(tool_call.name.clone());
            let output = execute_combined_story_tool_call(
                Arc::clone(&eventlog_store),
                Arc::clone(&proposal_store),
                &publisher,
                scope_key,
                tool_call,
            )
            .await;
            eprintln!(
                "executed_tool_call={}",
                serde_json::to_string_pretty(tool_call).unwrap()
            );
            eprintln!("tool_output={output}");
            history.push(TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content: output,
            });
        }
    }
}

#[tokio::test]
async fn broker_ls_cd_flow_skips_without_env_and_uses_real_upstream_when_present() {
    let Some(profile) = real_upstream_provider_profile_from_env() else {
        eprintln!(
            "skipping real-upstream ls/cd flow: set EXOMIND_AGENT_API_RT_ENABLE=1 together with EXOMIND_AGENT_API_PROVIDER / MODEL / API_KEY env vars"
        );
        return;
    };

    let root = match real_upstream_fs_root_from_env() {
        Some(path) => path,
        None => {
            eprintln!(
                "skipping real-upstream ls/cd flow: set EXOMIND_AGENT_API_RT_FS_ROOT to the repository root for external tool simulation"
            );
            return;
        }
    };

    let temp = tempfile::tempdir().unwrap();
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::new(EventLogStore::new(temp.path().join("eventlog"))),
        Arc::new(ProposalStore::new()),
        Arc::new(AgentSessionStore::new()),
    );
    let system_prompt = Some(
        "你是一个仓库探索助手。起始当前目录是外心仓库根目录。你只能依赖调用者提供的 ls 与 cd 工具了解目录结构。禁止猜测文件系统内容。cd 只能进入当前目录的直接子目录，不能进入父目录，不能使用斜杠路径。用户已经给出了目标相对路径 crates/exomind-runtime/src/agent/tools。为了减少无关噪音，你应优先沿这个已知路径片段逐层调用 cd：crates -> exomind-runtime -> src -> agent -> tools。除非有必要，不要在仓库根目录调用 ls。到达每一层后如需确认可调用 ls；至少在最终目录调用一次 ls。在确认结论前不要声称某个文件存在或不存在。确认后请用中文回答是否存在 eventlog.rs，并回顾一路经过的关键目录与最终目录中的文件。"
            .to_string(),
    );
    let prompt = "请通过多步调用 ls 和 cd，检查 crates/exomind-runtime/src/agent/tools/ 目录下是否存在 eventlog.rs。不要猜测，必须依赖工具结果。最终请用中文回答是否存在，并回顾一路上看到的关键目录与最终目录中的文件。"
        .to_string();
    let tools = vec![
        ToolDef {
            name: "ls".to_string(),
            description: "列出当前所在目录下的文件和子文件夹，输出格式与普通 ls 一致。无参数。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: "cd".to_string(),
            description: "进入当前所在目录的直接子文件夹。参数 dir 只能是一个直接子目录名。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "dir": { "type": "string" }
                },
                "required": ["dir"],
                "additionalProperties": false
            }),
        },
    ];

    let expected_steps = ["crates", "exomind-runtime", "src", "agent", "tools"];
    let expected_tool_sequence = ["cd", "cd", "cd", "cd", "cd", "ls"];
    let mut current_dir = root.clone();
    let mut history = Vec::new();
    let mut next_user_message = Some(prompt.clone());
    let mut turn_count = 0usize;
    let mut executed_tools = Vec::new();

    eprintln!("=== broker_ls_cd_flow start ===");
    eprintln!("provider={} model={}", profile.provider, profile.model);
    eprintln!("root={}", root.display());
    eprintln!("prompt={prompt}");

    loop {
        turn_count += 1;
        assert!(
            turn_count <= 10,
            "ls/cd real-upstream flow exceeded expected turn budget; history={history:?}"
        );

        eprintln!("\n--- turn {turn_count} request ---");
        eprintln!(
            "history_len={} new_user_message_present={} current_dir={}",
            history.len(),
            next_user_message.is_some(),
            current_dir.display()
        );

        let record = match run_broker_agent_session_with_runtime(
            profile.clone(),
            system_prompt.clone(),
            tools.clone(),
            history.clone(),
            next_user_message.take(),
            AgentTrigger::Internal {
                source: "agent-turn-broker-rt-ls-cd".to_string(),
            },
            &runtime,
        )
        .await
        {
            Ok(record) => record,
            Err(error) => {
                panic_if_auth_failed(&error);
                panic!("real-upstream ls/cd turn failed: {error}");
            }
        };

        eprintln!("--- turn {turn_count} response ---");
        eprintln!("session_id={}", record.session_id);
        eprintln!("status={}", record.status);
        eprintln!(
            "content={}",
            serde_json::to_string_pretty(&record.content).unwrap()
        );
        eprintln!(
            "assistant_turn={}",
            serde_json::to_string_pretty(&record.assistant_turn).unwrap()
        );
        eprintln!(
            "tool_calls={}",
            serde_json::to_string_pretty(&record.tool_calls).unwrap()
        );

        if turn_count == 1 {
            history.push(TurnItem::User {
                content: prompt.clone(),
            });
        }

        history.push(TurnItem::Assistant {
            content: record.assistant_turn.content.clone(),
            tool_calls: record.assistant_turn.tool_calls.clone(),
        });

        if record.status == "completed" {
            assert_eq!(
                turn_count, 7,
                "guided ls/cd scenario must complete only after 6 tool turns plus final answer; record={record:?}"
            );
            assert_eq!(
                executed_tools, expected_tool_sequence,
                "agent must actually perform the full multi-step tool sequence before completion"
            );
            assert!(
                record.content.contains("存在"),
                "final record should confirm existence: {record:?}"
            );
            assert!(
                record.content.contains("eventlog.rs"),
                "final record should mention eventlog.rs: {record:?}"
            );
            assert!(
                record.content.contains("mod.rs"),
                "final record should mention final directory listing: {record:?}"
            );
            assert_eq!(
                current_dir,
                root.join("crates/exomind-runtime/src/agent/tools"),
                "test harness should end at target directory"
            );
            eprintln!("=== broker_ls_cd_flow completed ===");
            eprintln!("final_dir={}", current_dir.display());
            eprintln!("final_answer={}", record.content);
            break;
        }

        assert_eq!(
            record.status, "needs_tool_calls",
            "intermediate record should request tools: {record:?}"
        );
        assert_eq!(
            record.assistant_turn.tool_calls.len(),
            1,
            "guided ls/cd scenario should request one tool per turn: {record:?}"
        );

        let tool_call = &record.assistant_turn.tool_calls[0];
        let tool_output = execute_external_fs_tool_call(&root, &mut current_dir, tool_call);
        executed_tools.push(tool_call.name.clone());
        eprintln!(
            "executed_tool_call={}",
            serde_json::to_string_pretty(tool_call).unwrap()
        );
        eprintln!("tool_output={tool_output}");
        assert_eq!(
            executed_tools.last().map(String::as_str),
            expected_tool_sequence.get(turn_count - 1).copied(),
            "tool sequence deviated from the expected multi-step exploration path"
        );
        if tool_call.name == "cd" {
            let expected_dir = expected_steps
                .get(turn_count - 1)
                .expect("unexpected extra cd step requested");
            assert_eq!(
                tool_call.input["dir"].as_str(),
                Some(*expected_dir),
                "unexpected cd path requested: {tool_call:?}"
            );
        } else if tool_call.name == "ls" {
            assert_eq!(
                current_dir,
                root.join("crates/exomind-runtime/src/agent/tools")
            );
            assert!(
                tool_output.contains("eventlog.rs"),
                "final ls output should include eventlog.rs: {tool_output}"
            );
        } else {
            panic!("unexpected tool requested: {tool_call:?}");
        }

        history.push(TurnItem::ToolResult {
            tool_call_id: tool_call.id.clone(),
            tool_name: tool_call.name.clone(),
            content: tool_output,
        });
    }
}

#[tokio::test]
async fn broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present() {
    let Some(profile) = real_upstream_provider_profile_from_env() else {
        eprintln!(
            "skipping real-upstream file-search flow: set EXOMIND_AGENT_API_RT_ENABLE=1 together with EXOMIND_AGENT_API_PROVIDER / MODEL / API_KEY env vars"
        );
        return;
    };

    let root = match real_upstream_fs_root_from_env() {
        Some(path) => path,
        None => {
            eprintln!(
                "skipping real-upstream file-search flow: set EXOMIND_AGENT_API_RT_FS_ROOT to the repository root for external tool simulation"
            );
            return;
        }
    };

    let temp = tempfile::tempdir().unwrap();
    let runtime = AgentSessionRuntime::new(
        Arc::new(ConfigStore::new()),
        Arc::new(EventLogStore::new(temp.path().join("eventlog"))),
        Arc::new(ProposalStore::new()),
        Arc::new(AgentSessionStore::new()),
    );
    let system_prompt = Some(
        "你是一个仓库文件搜索助手。当前工作根目录就是仓库根目录。你只能使用调用者提供的 pwd、ls、cd 三个只读工具，不允许猜测。每一轮你只能请求一个工具调用。请先用 pwd 确认位置，然后按广度优先、逐层收窄的方式搜索：先看当前层有哪些直接子项，再优先探索更像源码/工作区的目录，避免在一个深层分支里盲目走太久；如果某条分支暂时没有线索，就用 cd .. 回到上层并继续检查尚未探索的同级目录。只有当你在 ls 输出中亲眼看到目标文件名时，才能宣布找到。找到后，请用中文给出该文件相对仓库根目录的完整路径。"
            .to_string(),
    );
    let prompt = "请找到文件 agent_api_rt.rs，并在找到后输出它相对当前仓库根目录的完整路径。禁止猜测，必须依赖工具搜索。"
        .to_string();
    let tools = vec![
        ToolDef {
            name: "pwd".to_string(),
            description: "返回当前目录相对仓库根目录的路径；仓库根目录返回 . 。无参数。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: "ls".to_string(),
            description: "列出当前目录下的直接子文件与子目录，输出按字典序排序。无参数。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: "cd".to_string(),
            description: "切换当前目录。参数 dir 只能是当前目录的一个直接子目录名，或 .. 返回父目录；不能越过仓库根目录。"
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "dir": { "type": "string" }
                },
                "required": ["dir"],
                "additionalProperties": false
            }),
        },
    ];

    let expected_relative_path = "crates/exomind-runtime/tests/agent_api_rt.rs";
    let expected_parent_dir = "crates/exomind-runtime/tests";
    let mut current_dir = root.clone();
    let mut history = Vec::new();
    let mut next_user_message = Some(prompt.clone());
    let mut turn_count = 0usize;
    let mut total_tool_calls = 0usize;
    let mut used_pwd = false;
    let mut used_ls = false;
    let mut used_cd = false;
    let mut used_cd_parent = false;
    let mut target_seen_in_ls = false;
    let mut target_seen_dir = None::<String>;
    let mut tool_names = Vec::new();

    eprintln!("=== broker_file_search_flow start ===");
    eprintln!("provider={} model={}", profile.provider, profile.model);
    eprintln!("root={}", root.display());
    eprintln!("prompt={prompt}");

    loop {
        turn_count += 1;
        assert!(
            turn_count <= 32,
            "file-search real-upstream flow exceeded turn budget; history={history:?}"
        );

        eprintln!("\n--- turn {turn_count} request ---");
        eprintln!(
            "history_len={} new_user_message_present={} current_dir={}",
            history.len(),
            next_user_message.is_some(),
            current_dir.display()
        );

        let record = match run_broker_agent_session_with_runtime(
            profile.clone(),
            system_prompt.clone(),
            tools.clone(),
            history.clone(),
            next_user_message.take(),
            AgentTrigger::Internal {
                source: "agent-turn-broker-rt-file-search".to_string(),
            },
            &runtime,
        )
        .await
        {
            Ok(record) => record,
            Err(error) => {
                panic_if_auth_failed(&error);
                panic!("real-upstream file-search turn failed: {error}");
            }
        };

        eprintln!("--- turn {turn_count} response ---");
        eprintln!("session_id={}", record.session_id);
        eprintln!("status={}", record.status);
        eprintln!(
            "content={}",
            serde_json::to_string_pretty(&record.content).unwrap()
        );
        eprintln!(
            "assistant_turn={}",
            serde_json::to_string_pretty(&record.assistant_turn).unwrap()
        );
        eprintln!(
            "tool_calls={}",
            serde_json::to_string_pretty(&record.tool_calls).unwrap()
        );

        if turn_count == 1 {
            history.push(TurnItem::User {
                content: prompt.clone(),
            });
        }

        history.push(TurnItem::Assistant {
            content: record.assistant_turn.content.clone(),
            tool_calls: record.assistant_turn.tool_calls.clone(),
        });

        if record.status == "completed" {
            assert!(
                turn_count > 2,
                "file-search flow must not complete in the first two turns; record={record:?}"
            );
            assert!(
                used_pwd && used_ls && used_cd,
                "file-search flow must use pwd + ls + cd; tool_names={tool_names:?}"
            );
            assert!(
                total_tool_calls > 1,
                "file-search flow must involve more than one tool call; tool_names={tool_names:?}"
            );
            assert!(
                target_seen_in_ls,
                "file-search flow never observed target file in ls output; tool_names={tool_names:?}"
            );
            assert_eq!(
                target_seen_dir.as_deref(),
                Some(expected_parent_dir),
                "target file should be seen from its containing directory"
            );
            assert_eq!(
                record.assistant_turn.tool_calls,
                Vec::<exomind_runtime::agent::broker::ToolCall>::new(),
                "completed turns must not expose pending tool calls"
            );
            assert!(
                record.content.contains(expected_relative_path),
                "final answer must include repo-relative full path: {record:?}"
            );
            assert!(
                root.join(expected_relative_path).exists(),
                "expected file does not exist under configured root: {}",
                root.join(expected_relative_path).display()
            );
            eprintln!("=== broker_file_search_flow completed ===");
            eprintln!("tool_names={tool_names:?}");
            eprintln!("used_cd_parent={used_cd_parent}");
            eprintln!("target_seen_dir={target_seen_dir:?}");
            eprintln!("final_answer={}", record.content);
            break;
        }

        assert_eq!(
            record.status, "needs_tool_calls",
            "intermediate record should request tools: {record:?}"
        );
        assert!(
            record.assistant_turn.tool_calls.len() == 1,
            "stateful pwd/ls/cd search must request exactly one tool call per turn: {record:?}"
        );

        for tool_call in &record.assistant_turn.tool_calls {
            let dir_before = relative_dir_from_root(&root, &current_dir);
            let tool_output = execute_external_fs_tool_call(&root, &mut current_dir, tool_call);
            total_tool_calls += 1;
            tool_names.push(tool_call.name.clone());

            match tool_call.name.as_str() {
                "pwd" => {
                    used_pwd = true;
                    assert_eq!(
                        tool_output, dir_before,
                        "pwd should return the current relative directory"
                    );
                }
                "ls" => {
                    used_ls = true;
                    if tool_output
                        .lines()
                        .any(|line| line.trim() == "agent_api_rt.rs")
                    {
                        target_seen_in_ls = true;
                        target_seen_dir = Some(dir_before.clone());
                    }
                }
                "cd" => {
                    used_cd = true;
                    if tool_call.input["dir"].as_str() == Some("..") {
                        used_cd_parent = true;
                    }
                }
                other => panic!("unexpected tool requested during file search: {other}"),
            }

            eprintln!(
                "executed_tool_call={}",
                serde_json::to_string_pretty(tool_call).unwrap()
            );
            eprintln!("tool_output={tool_output}");

            history.push(TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content: tool_output,
            });
        }
    }
}

fn execute_external_fs_tool_call(
    root: &Path,
    current_dir: &mut PathBuf,
    tool_call: &exomind_runtime::agent::broker::ToolCall,
) -> String {
    match tool_call.name.as_str() {
        "pwd" => {
            assert!(
                is_empty_object(&tool_call.input),
                "pwd requires an empty input object: {tool_call:?}"
            );
            relative_dir_from_root(root, current_dir)
        }
        "ls" => {
            assert!(
                is_empty_object(&tool_call.input),
                "ls requires an empty input object: {tool_call:?}"
            );
            let entries = std::fs::read_dir(&*current_dir)
                .unwrap_or_else(|error| panic!("failed to read {current_dir:?}: {error}"));
            let mut names = entries
                .map(|entry| {
                    entry
                        .unwrap_or_else(|error| panic!("failed to read dir entry: {error}"))
                        .file_name()
                        .to_string_lossy()
                        .to_string()
                })
                .filter(|name| !name.starts_with('.'))
                .collect::<Vec<_>>();
            names.sort();
            names.join("\n")
        }
        "cd" => {
            let dir = tool_call.input["dir"]
                .as_str()
                .unwrap_or_else(|| panic!("cd tool call missing dir: {tool_call:?}"));
            assert!(
                !dir.is_empty() && !dir.contains('/') && !dir.contains('\\') && dir != ".",
                "cd only allows a single direct child directory name or ..: {tool_call:?}"
            );
            if dir == ".." {
                if current_dir == root {
                    return "ERROR: already at root".to_string();
                }
                let target = current_dir
                    .parent()
                    .unwrap_or_else(|| {
                        panic!("current directory lost parent under root: {current_dir:?}")
                    })
                    .to_path_buf();
                assert!(
                    target.starts_with(root),
                    "cd .. escaped the configured root: {tool_call:?}"
                );
                *current_dir = target;
                return format!(
                    "OK: current_dir={}",
                    relative_dir_from_root(root, current_dir)
                );
            }

            let target = current_dir.join(dir);
            assert!(
                target.starts_with(root),
                "cd target escaped the configured root: {tool_call:?}"
            );
            assert!(target.exists(), "cd target does not exist: {tool_call:?}");
            assert!(
                target.is_dir(),
                "cd target is not a directory: {tool_call:?}"
            );
            *current_dir = target;
            format!(
                "OK: current_dir={}",
                relative_dir_from_root(root, current_dir)
            )
        }
        other => panic!("unexpected external fs tool requested: {other}"),
    }
}

fn relative_dir_from_root(root: &Path, current_dir: &Path) -> String {
    current_dir
        .strip_prefix(root)
        .ok()
        .and_then(|path| path.to_str())
        .filter(|path| !path.is_empty())
        .unwrap_or(".")
        .to_string()
}

fn is_empty_object(value: &Value) -> bool {
    value.as_object().is_some_and(|object| object.is_empty())
}
