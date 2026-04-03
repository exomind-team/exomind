use std::path::{Path, PathBuf};
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
            description: "列出当前所在目录下的文件和子文件夹，输出格式与普通 ls 一致。无参数。".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDef {
            name: "cd".to_string(),
            description: "进入当前所在目录的直接子文件夹。参数 dir 只能是一个直接子目录名。".to_string(),
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
        eprintln!("content={}", serde_json::to_string_pretty(&record.content).unwrap());
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
                executed_tools,
                expected_tool_sequence,
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
        eprintln!("executed_tool_call={}", serde_json::to_string_pretty(tool_call).unwrap());
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
            assert_eq!(current_dir, root.join("crates/exomind-runtime/src/agent/tools"));
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

fn execute_external_fs_tool_call(root: &Path, current_dir: &mut PathBuf, tool_call: &exomind_runtime::agent::broker::ToolCall) -> String {
    match tool_call.name.as_str() {
        "ls" => {
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
                .collect::<Vec<_>>();
            names.sort();
            let rel = current_dir
                .strip_prefix(root)
                .ok()
                .and_then(|path| path.to_str())
                .filter(|path| !path.is_empty())
                .unwrap_or(".");
            format!("current_dir={rel}\n{}", names.join("\n"))
        }
        "cd" => {
            let dir = tool_call.input["dir"]
                .as_str()
                .unwrap_or_else(|| panic!("cd tool call missing dir: {tool_call:?}"));
            assert!(
                !dir.contains('/') && !dir.contains('\\') && dir != "." && dir != "..",
                "cd only allows a direct child directory: {tool_call:?}"
            );
            let target = current_dir.join(dir);
            assert!(
                target.starts_with(root),
                "cd target escaped the configured root: {tool_call:?}"
            );
            assert!(target.exists(), "cd target does not exist: {tool_call:?}");
            assert!(target.is_dir(), "cd target is not a directory: {tool_call:?}");
            *current_dir = target;
            let rel = current_dir
                .strip_prefix(root)
                .ok()
                .and_then(|path| path.to_str())
                .filter(|path| !path.is_empty())
                .unwrap_or(".");
            format!("OK: current_dir={rel}")
        }
        other => panic!("unexpected external fs tool requested: {other}"),
    }
}
