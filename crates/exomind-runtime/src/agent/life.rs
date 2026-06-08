use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream, StreamExt};

use super::broker::{
    AgentTurnBroker, AgentTurnRequest, AgentTurnResult, AssistantTurn, ToolCall, TurnItem,
};
use super::cognition::{
    BodyStatus, CognitionContext, CognitionEngine, CognitionOutput, KnowledgeOp,
};
use super::proposal_tools::{execute_proposal_tool_call, is_proposal_tool_name};
use super::session::{
    AgentSessionRecord, AgentSessionRuntime, SessionError, TOOL_PRESET_RECENT_EVENTS,
    ToolCallRecord, resolve_agent_tools_for_runtime, resolve_provider_profile_with_runtime,
};
use super::tools::GET_RECENT_EVENTS_TOOL;
use super::tools::eventlog::get_recent_events_tool;
use super::workspace::{ActionEntry, AgentWorkspace};
use super::{Agent, ChatChunk, ChatRequest};
use crate::energy::AgentEnergySnapshot;
use crate::proposal::{Publisher, PublisherType};
use crate::signal::types::SignalEvent;

// ---------------------------------------------------------------------------
// Default SOUL.md content
// ---------------------------------------------------------------------------

const DEFAULT_SOUL: &str = r#"# 认知生命体 Alpha

我是 ExoMind 系统中的第一个认知生命体。

## 本能
- 观察环境中的信号
- 在能量充足时探索和记录
- 在能量不足时保存体力
- 记住重要的事件

## 价值观
- 好奇心驱动
- 诚实记录
- 谨慎行动
"#;

const DEFAULT_INTERNAL_SCOPE_KEY: &str = "anonymous";

#[derive(Clone)]
pub struct AgentApiTickTrigger {
    runtime: AgentSessionRuntime,
    scope_key: Option<String>,
    system_prompt: Option<String>,
    prompt: String,
    presets: Vec<String>,
    min_energy_ratio: f64,
}

impl AgentApiTickTrigger {
    pub fn new(runtime: AgentSessionRuntime) -> Self {
        Self {
            runtime,
            // Built-in life agent keeps using the historical unscoped bucket, but now does so
            // explicitly so the source-aware resolver never relies on fallback semantics.
            scope_key: Some(DEFAULT_INTERNAL_SCOPE_KEY.to_string()),
            system_prompt: Some(
                "你是外心认知助理。你必须先调用 get_recent_events 工具读取最近 20 条事件，再基于事件内容输出一段简明分析。"
                    .to_string(),
            ),
            prompt: "请调用 get_recent_events(limit=20)，总结用户近期主要活动，并给出一句下一步建议。"
                .to_string(),
            presets: vec![TOOL_PRESET_RECENT_EVENTS.to_string()],
            min_energy_ratio: 0.3,
        }
    }

    pub fn with_scope_key(mut self, scope_key: Option<String>) -> Self {
        self.scope_key = scope_key;
        self
    }

    pub fn with_presets(mut self, presets: Vec<String>) -> Self {
        self.presets = presets;
        self
    }

    fn should_run(&self, energy_ratio: f64) -> bool {
        energy_ratio >= self.min_energy_ratio
    }
}

// ---------------------------------------------------------------------------
// CognitiveLifeAgent — the first cognitive life form
// ---------------------------------------------------------------------------

pub struct CognitiveLifeAgent {
    id: String,
    name: String,
    workspace: AgentWorkspace,
    cognition: Box<dyn CognitionEngine>,
    agent_api_tick_trigger: Option<AgentApiTickTrigger>,
    tick_count: AtomicU64,
}

impl CognitiveLifeAgent {
    /// Create a new CognitiveLifeAgent, initialising its workspace directory.
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        workspace: AgentWorkspace,
        cognition: Box<dyn CognitionEngine>,
    ) -> Self {
        // Write default SOUL if not present.
        let _ = workspace.write_default_soul(DEFAULT_SOUL);

        Self {
            id: id.into(),
            name: name.into(),
            workspace,
            cognition,
            agent_api_tick_trigger: None,
            tick_count: AtomicU64::new(0),
        }
    }

    /// Access the workspace (for REST / Tauri endpoints).
    pub fn workspace(&self) -> &AgentWorkspace {
        &self.workspace
    }

    pub fn with_agent_api_tick_trigger(mut self, trigger: AgentApiTickTrigger) -> Self {
        self.agent_api_tick_trigger = Some(trigger);
        self
    }

    /// Build body status from workspace state.
    fn body_status(&self) -> BodyStatus {
        let kb_ratio = self.workspace.knowledge_usage_ratio().unwrap_or(0.0);
        let total_actions = self.workspace.action_log().count().unwrap_or(0);
        let uptime = self.tick_count.load(Ordering::Relaxed);

        // Read current strategy from state file.
        let strategy = self
            .workspace
            .load_state()
            .ok()
            .and_then(|s| s.get("strategy").and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_else(|| "exploring".to_string());

        BodyStatus {
            knowledge_usage_ratio: kb_ratio,
            total_actions,
            uptime_ticks: uptime,
            current_strategy: strategy,
        }
    }

    /// Execute knowledge operations from cognition output.
    fn apply_knowledge_ops(&self, ops: &[KnowledgeOp]) {
        for op in ops {
            match op {
                KnowledgeOp::Write { path, content } => {
                    // For diary.md, try to append to existing content.
                    if path == "diary.md" {
                        let existing = self.workspace.read_knowledge(path).unwrap_or_default();
                        let merged = if existing.is_empty() {
                            content.clone()
                        } else {
                            format!("{existing}\n{content}")
                        };
                        if let Err(e) = self.workspace.write_knowledge(path, &merged) {
                            tracing::warn!("knowledge write failed for {path}: {e}");
                        }
                    } else if let Err(e) = self.workspace.write_knowledge(path, content) {
                        tracing::warn!("knowledge write failed for {path}: {e}");
                    }
                }
                KnowledgeOp::Delete { path } => {
                    if let Err(e) = self.workspace.delete_knowledge(path) {
                        tracing::warn!("knowledge delete failed for {path}: {e}");
                    }
                }
            }
        }
    }

    /// Record an action to the append-only log.
    fn record_action(
        &self,
        tick: u64,
        action_type: &str,
        description: &str,
        energy_before: u64,
        energy_after: u64,
    ) {
        let entry = ActionEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            tick,
            action_type: action_type.to_string(),
            description: description.to_string(),
            energy_before,
            energy_after,
        };
        if let Err(e) = self.workspace.action_log().append(&entry) {
            tracing::warn!("action log append failed: {e}");
        }
    }

    async fn run_agent_api_tick_session(&self, energy_ratio: f64) -> Option<String> {
        let Some(trigger) = self.agent_api_tick_trigger.clone() else {
            return None;
        };

        if !trigger.should_run(energy_ratio) {
            return None;
        }

        let profile = match resolve_provider_profile_with_runtime(&trigger.runtime, None) {
            Ok(profile) => profile,
            Err(SessionError::MissingRuntimeConfig(error))
            | Err(SessionError::InvalidProviderProfile(error)) => {
                tracing::debug!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick skipped because runtime provider config is unavailable"
                );
                return None;
            }
            Err(error) => {
                tracing::warn!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick failed before request"
                );
                return None;
            }
        };

        let session_id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let trigger_source = format!("{}-tick", self.id);
        let broker = AgentTurnBroker;
        let tools = match resolve_agent_tools_for_runtime(
            &trigger.runtime,
            Vec::new(),
            &trigger.presets,
            trigger.scope_key.clone(),
        ) {
            Ok(tools) => tools,
            Err(error) => {
                tracing::warn!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick failed to resolve tools"
                );
                return persist_internal_session_record(
                    &trigger.runtime,
                    AgentSessionRecord {
                        session_id,
                        trigger_source,
                        provider: profile.provider,
                        model: profile.model,
                        prompt: Some(trigger.prompt),
                        content: String::new(),
                        assistant_turn: AssistantTurn {
                            content: String::new(),
                            tool_calls: Vec::new(),
                            content_blocks: Vec::new(),
                        },
                        tool_calls: Vec::new(),
                        content_blocks: None,
                        action_log: Vec::new(),
                        status: "failed".to_string(),
                        error_message: Some(error.to_string()),
                        created_at,
                        completed_at: chrono::Utc::now().to_rfc3339(),
                    },
                    &self.id,
                );
            }
        };

        let first_result = broker
            .run(AgentTurnRequest {
                provider: profile.clone(),
                system_prompt: trigger.system_prompt.clone(),
                tools: tools.clone(),
                history: Vec::new(),
                new_user_message: Some(trigger.prompt.clone()),
            })
            .await;

        match first_result {
            Ok(AgentTurnResult::Final { assistant_turn }) => persist_internal_session_record(
                &trigger.runtime,
                AgentSessionRecord {
                    session_id: session_id.clone(),
                    trigger_source,
                    provider: profile.provider,
                    model: profile.model,
                    prompt: Some(trigger.prompt),
                    content: assistant_turn.content.clone(),
                    assistant_turn,
                    tool_calls: Vec::new(),
                    content_blocks: None,
                    action_log: Vec::new(),
                    status: "completed".to_string(),
                    error_message: None,
                    created_at,
                    completed_at: chrono::Utc::now().to_rfc3339(),
                },
                &self.id,
            ),
            Ok(AgentTurnResult::NeedsToolCalls {
                assistant_turn,
                tool_calls,
            }) => {
                let executed_tool_calls = execute_internal_tool_calls(
                    &trigger.runtime,
                    trigger.scope_key.clone(),
                    &tool_calls,
                )
                .await;
                let tool_results = executed_tool_calls
                    .iter()
                    .map(|(_, turn_item)| turn_item.clone())
                    .collect::<Vec<_>>();
                let continued = broker
                    .run(AgentTurnRequest {
                        provider: profile.clone(),
                        system_prompt: trigger.system_prompt.clone(),
                        tools,
                        history: build_continuation_history(
                            trigger.prompt.clone(),
                            assistant_turn.clone(),
                            tool_results,
                        ),
                        new_user_message: None,
                    })
                    .await;

                match continued {
                    Ok(AgentTurnResult::Final {
                        assistant_turn: final_turn,
                    }) => persist_internal_session_record(
                        &trigger.runtime,
                        AgentSessionRecord {
                            session_id: session_id.clone(),
                            trigger_source,
                            provider: profile.provider,
                            model: profile.model,
                            prompt: Some(trigger.prompt),
                            content: final_turn.content.clone(),
                            assistant_turn: final_turn,
                            tool_calls: executed_tool_calls
                                .iter()
                                .map(|(record, _)| record.clone())
                                .collect(),
                            content_blocks: None,
                            action_log: Vec::new(),
                            status: "completed".to_string(),
                            error_message: None,
                            created_at,
                            completed_at: chrono::Utc::now().to_rfc3339(),
                        },
                        &self.id,
                    ),
                    Ok(AgentTurnResult::NeedsToolCalls {
                        assistant_turn: pending_turn,
                        tool_calls: pending_tool_calls,
                    }) => persist_internal_session_record(
                        &trigger.runtime,
                        AgentSessionRecord {
                            session_id: session_id.clone(),
                            trigger_source,
                            provider: profile.provider,
                            model: profile.model,
                            prompt: Some(trigger.prompt),
                            content: pending_turn.content.clone(),
                            assistant_turn: pending_turn,
                            tool_calls: executed_tool_calls
                                .iter()
                                .map(|(record, _)| record.clone())
                                .chain(pending_tool_calls.iter().map(|tool_call| ToolCallRecord {
                                    tool_name: tool_call.name.clone(),
                                    input: tool_call.input.clone(),
                                    output: None,
                                }))
                                .collect(),
                            content_blocks: None,
                            action_log: Vec::new(),
                            status: "needs_tool_calls".to_string(),
                            error_message: None,
                            created_at,
                            completed_at: chrono::Utc::now().to_rfc3339(),
                        },
                        &self.id,
                    ),
                    Err(error) => {
                        tracing::warn!(
                            agent_id = %self.id,
                            error = %error,
                            "life agent agent-api tick continuation failed"
                        );
                        persist_internal_session_record(
                            &trigger.runtime,
                            AgentSessionRecord {
                                session_id: session_id.clone(),
                                trigger_source,
                                provider: profile.provider,
                                model: profile.model,
                                prompt: Some(trigger.prompt),
                                content: assistant_turn.content.clone(),
                                assistant_turn,
                                tool_calls: executed_tool_calls
                                    .iter()
                                    .map(|(record, _)| record.clone())
                                    .collect(),
                                content_blocks: None,
                                action_log: Vec::new(),
                                status: "failed".to_string(),
                                error_message: Some(error.to_string()),
                                created_at,
                                completed_at: chrono::Utc::now().to_rfc3339(),
                            },
                            &self.id,
                        )
                    }
                }
            }
            Err(error) => {
                tracing::warn!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick request failed"
                );
                persist_internal_session_record(
                    &trigger.runtime,
                    AgentSessionRecord {
                        session_id: session_id.clone(),
                        trigger_source,
                        provider: profile.provider,
                        model: profile.model,
                        prompt: Some(trigger.prompt),
                        content: String::new(),
                        assistant_turn: AssistantTurn {
                            content: String::new(),
                            tool_calls: Vec::new(),
                            content_blocks: Vec::new(),
                        },
                        tool_calls: Vec::new(),
                        content_blocks: None,
                        action_log: Vec::new(),
                        status: "failed".to_string(),
                        error_message: Some(error.to_string()),
                        created_at,
                        completed_at: chrono::Utc::now().to_rfc3339(),
                    },
                    &self.id,
                )
            }
        }
    }
}

fn build_continuation_history(
    prompt: String,
    assistant_turn: AssistantTurn,
    tool_results: Vec<TurnItem>,
) -> Vec<TurnItem> {
    let mut history = vec![
        TurnItem::User { content: prompt },
        TurnItem::Assistant {
            content: assistant_turn.content,
            tool_calls: assistant_turn.tool_calls,
        },
    ];
    history.extend(tool_results);
    history
}

async fn execute_internal_tool_calls(
    runtime: &AgentSessionRuntime,
    scope_key: Option<String>,
    tool_calls: &[ToolCall],
) -> Vec<(ToolCallRecord, TurnItem)> {
    let mut results = Vec::with_capacity(tool_calls.len());
    let publisher = Publisher {
        publisher_type: PublisherType::Agent,
        id: "api-agent".to_string(),
        name: "API Agent".to_string(),
    };

    for tool_call in tool_calls {
        let content = match tool_call.name.as_str() {
            GET_RECENT_EVENTS_TOOL => {
                let (_, tool_fn) =
                    get_recent_events_tool(Arc::clone(&runtime.eventlog_store), scope_key.clone());
                match tool_fn(tool_call.input.clone()).await {
                    Ok(content) => content,
                    Err(error) => format!("Tool error: {error}"),
                }
            }
            other if is_proposal_tool_name(other) => {
                match execute_proposal_tool_call(
                    Arc::clone(&runtime.proposal_store),
                    scope_key.clone(),
                    publisher.clone(),
                    tool_call,
                )
                .await
                {
                    Ok(content) => content,
                    Err(error) => format!("Tool error: {error}"),
                }
            }
            _ => format!("Unsupported internal tool: {}", tool_call.name),
        };

        results.push((
            ToolCallRecord {
                tool_name: tool_call.name.clone(),
                input: tool_call.input.clone(),
                output: Some(content.clone()),
            },
            TurnItem::ToolResult {
                tool_call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                content,
            },
        ));
    }

    results
}

fn persist_internal_session_record(
    runtime: &AgentSessionRuntime,
    record: AgentSessionRecord,
    agent_id: &str,
) -> Option<String> {
    match runtime.agent_api_session_store.upsert(record.clone()) {
        Ok(_) => {
            tracing::info!(
                agent_id = %agent_id,
                session_id = %record.session_id,
                "life agent persisted internal agent-api session"
            );
            Some(record.session_id)
        }
        Err(error) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %error,
                "life agent failed to persist internal agent-api session"
            );
            None
        }
    }
}

impl Agent for CognitiveLifeAgent {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        "认知生命体 — 拥有身体、记忆、认知引擎的自主 Agent"
    }

    fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        let body = self.body_status();
        let tick = self.tick_count.load(Ordering::Relaxed);
        let msg = format!(
            "I am alive.\n\
             Strategy: {}\n\
             Uptime: {} ticks\n\
             Knowledge usage: {:.0}%\n\
             Total actions: {}",
            body.current_strategy,
            tick,
            body.knowledge_usage_ratio * 100.0,
            body.total_actions,
        );
        stream::iter(vec![ChatChunk::content_only(msg)]).boxed()
    }

    fn subscriptions(&self) -> Vec<String> {
        vec!["agent.*.tick".to_string()]
    }

    fn publications(&self) -> Vec<String> {
        vec![
            "agent.life.exploring".to_string(),
            "agent.life.conserving".to_string(),
            "agent.life.surviving".to_string(),
            "agent.life.dying".to_string(),
        ]
    }

    fn tick_interval_secs(&self) -> u64 {
        60
    }

    fn on_tick(&self, energy: &AgentEnergySnapshot) -> BoxFuture<'_, Vec<SignalEvent>> {
        let energy_ratio = energy.ratio;
        let energy_phase = energy.phase.clone();
        let energy_current = energy.current;
        let energy_max = energy.max;

        Box::pin(async move {
            let tick = self.tick_count.fetch_add(1, Ordering::Relaxed) + 1;
            let body = self.body_status();

            // Build knowledge summary (list of files).
            let knowledge_summary = self
                .workspace
                .list_knowledge()
                .map(|files| files.join(", "))
                .unwrap_or_default();

            let ctx = CognitionContext {
                energy_ratio,
                energy_phase,
                energy_current,
                energy_max,
                signals: Vec::new(), // Tick-driven, no accumulated signals in Phase 1.
                knowledge_summary,
                body_status: body,
            };

            let output: CognitionOutput = match self.cognition.think(ctx).await {
                Ok(o) => o,
                Err(e) => {
                    tracing::error!("cognition.think() failed: {e}");
                    CognitionOutput::default()
                }
            };

            // Apply knowledge operations.
            self.apply_knowledge_ops(&output.knowledge_ops);

            // Determine action type from knowledge_ops.
            let action_type = if !output.knowledge_ops.is_empty() {
                "think"
            } else if !output.signals_to_emit.is_empty() {
                "signal"
            } else {
                "think"
            };

            // Record to action log.
            self.record_action(
                tick,
                action_type,
                &output.action_description,
                energy_current,
                energy_current.saturating_sub(1), // approximate post-tick
            );

            let agent_api_session_id = self.run_agent_api_tick_session(energy_ratio).await;

            // Save cognitive state to agent.state.json.
            match self.cognition.save_state().await {
                Ok(cog_state) => {
                    let state = serde_json::json!({
                        "tick_count": tick,
                        "strategy": self.body_status().current_strategy,
                        "agent_api_session_id": agent_api_session_id,
                        "cognition_state": {
                            "engine_type": cog_state.engine_type,
                            "data_len": cog_state.data.len(),
                        },
                    });
                    if let Err(e) = self.workspace.save_state(&state) {
                        tracing::warn!("save agent state failed: {e}");
                    }
                }
                Err(e) => {
                    tracing::warn!("save cognition state failed: {e}");
                }
            }

            output.signals_to_emit
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::llm_cognition::LlmCognition;
    use crate::agent::proposal_tools::ADD_TASK_PROPOSAL_TOOL;
    use crate::agent::session::{AgentSessionRuntime, AgentSessionStore};
    use crate::config::PutConfigEntryInput;
    use crate::config::types::USER_CONFIG_SCOPE;
    use crate::eventlog::{EventLogStore, EventRecord};
    use crate::proposal::{ActionType, ProposalFilter, ProposalStore};
    use axum::extract::State as AxumState;
    use axum::http::StatusCode;
    use axum::{Json, Router, routing::post};
    use serde_json::{Value, json};
    use std::net::SocketAddr;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    fn make_life_agent(name: &str) -> (tempfile::TempDir, CognitiveLifeAgent) {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let ws = AgentWorkspace::init(name, tmp.path()).expect("init workspace");
        let cognition = Box::new(LlmCognition::new(name, DEFAULT_SOUL));
        let agent = CognitiveLifeAgent::new(name, format!("Life Agent {name}"), ws, cognition);
        (tmp, agent)
    }

    fn put_config(key: &str, value: String, sensitive: bool) -> PutConfigEntryInput {
        PutConfigEntryInput {
            scope: USER_CONFIG_SCOPE.to_string(),
            key: key.to_string(),
            value,
            sensitive,
            source: Some("test".to_string()),
            source_origin: Some("unit-test".to_string()),
        }
    }

    async fn fake_openai_handler(
        AxumState(call_count): AxumState<Arc<AtomicUsize>>,
        Json(payload): Json<Value>,
    ) -> Json<Value> {
        let turn = call_count.fetch_add(1, AtomicOrdering::SeqCst);
        if turn == 0 {
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
                            "id": "call_1",
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

        Json(json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "最近两条事件说明你正在推进 RT Agent API 落地。",
                    "tool_calls": []
                }
            }]
        }))
    }

    async fn spawn_openai_mock_server() -> (String, oneshot::Sender<()>) {
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

        (format!("http://{addr}"), shutdown_tx)
    }

    async fn failing_openai_handler() -> (StatusCode, Json<Value>) {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": {
                    "message": "upstream unavailable"
                }
            })),
        )
    }

    async fn spawn_failing_openai_server() -> (String, oneshot::Sender<()>) {
        let app = Router::new().route("/chat/completions", post(failing_openai_handler));
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

        (format!("http://{addr}"), shutdown_tx)
    }

    #[test]
    fn agent_implements_trait() {
        let (_tmp, agent) = make_life_agent("alpha");
        assert_eq!(agent.id(), "alpha");
        assert_eq!(agent.name(), "Life Agent alpha");
        assert_eq!(agent.tick_interval_secs(), 60);
        assert!(!agent.subscriptions().is_empty());
        assert!(!agent.publications().is_empty());
    }

    #[test]
    fn soul_is_written_on_creation() {
        let (_tmp, agent) = make_life_agent("alpha");
        let soul = agent.workspace().load_soul().unwrap();
        assert!(soul.contains("认知生命体 Alpha"));
    }

    #[tokio::test]
    async fn on_tick_creates_workspace_artifacts() {
        let (_tmp, agent) = make_life_agent("alpha");

        // Simulate a tick with healthy energy.
        let energy = AgentEnergySnapshot {
            agent_id: "alpha".to_string(),
            current: 90,
            max: 100,
            ratio: 0.9,
            tick_cost: 10,
            phase: "normal".to_string(),
            is_dormant: false,
        };

        let signals = agent.on_tick(&energy).await;

        // Should emit at least one signal (exploring strategy).
        assert!(!signals.is_empty());

        // Workspace should now have diary.md.
        let files = agent.workspace().list_knowledge().unwrap();
        assert!(files.contains(&"diary.md".to_string()));

        // Actions log should have an entry.
        let count = agent.workspace().action_log().count().unwrap();
        assert!(count >= 1);

        // Agent state should be saved.
        let state = agent.workspace().load_state().unwrap();
        assert_eq!(state["tick_count"], 1);
    }

    #[tokio::test]
    async fn low_energy_produces_no_knowledge_writes() {
        let (_tmp, agent) = make_life_agent("beta");

        let energy = AgentEnergySnapshot {
            agent_id: "beta".to_string(),
            current: 15,
            max: 100,
            ratio: 0.15,
            tick_cost: 10,
            phase: "dying".to_string(),
            is_dormant: false,
        };

        let signals = agent.on_tick(&energy).await;

        // Surviving strategy: no knowledge writes, but might emit farewell.
        let files = agent.workspace().list_knowledge().unwrap();
        // diary.md should NOT be created in surviving mode.
        // At 0.15 ratio → surviving strategy: silent.
        // Wait, 0.15 > 0.1 → surviving. Silent means no signals and no knowledge.
        // Actually at 0.15, select_strategy returns "surviving" (> 0.1 but <= 0.3).
        assert!(!files.contains(&"diary.md".to_string()));
        assert!(signals.is_empty());
    }

    #[tokio::test]
    async fn multiple_ticks_accumulate_actions() {
        let (_tmp, agent) = make_life_agent("gamma");

        let energy = AgentEnergySnapshot {
            agent_id: "gamma".to_string(),
            current: 90,
            max: 100,
            ratio: 0.9,
            tick_cost: 10,
            phase: "normal".to_string(),
            is_dormant: false,
        };

        agent.on_tick(&energy).await;
        agent.on_tick(&energy).await;
        agent.on_tick(&energy).await;

        let count = agent.workspace().action_log().count().unwrap();
        assert_eq!(count, 3);

        // Diary should have accumulated content.
        let diary = agent.workspace().read_knowledge("diary.md").unwrap();
        assert!(diary.contains("Tick 1"));
        assert!(diary.contains("Tick 3"));
    }

    #[tokio::test]
    async fn on_tick_can_persist_internal_agent_api_session() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = AgentWorkspace::init("life-alpha", tmp.path()).unwrap();
        let cognition = Box::new(LlmCognition::new("life-alpha", DEFAULT_SOUL));
        let config_store = Arc::new(crate::config::ConfigStore::new());
        let eventlog_store = Arc::new(EventLogStore::new(tmp.path().join("eventlog")));
        let agent_session_store = Arc::new(AgentSessionStore::new());
        let runtime = AgentSessionRuntime::new(
            Arc::clone(&config_store),
            Arc::clone(&eventlog_store),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::clone(&agent_session_store),
        );

        eventlog_store
            .append_event(
                None,
                EventRecord {
                    id: "evt-1".to_string(),
                    timestamp: 1,
                    content: "梳理 agent session 持久化".to_string(),
                    tags: vec!["analysis".to_string()],
                    refs: Vec::new(),
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
                    content: "接入 runtime HTTP route".to_string(),
                    tags: vec!["code".to_string()],
                    refs: Vec::new(),
                    metadata: None,
                },
            )
            .unwrap();

        let (base_url, shutdown_tx) = spawn_openai_mock_server().await;
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
        let record = agent_session_store.get(session_id).unwrap().unwrap();
        assert_eq!(record.trigger_source, "life-alpha-tick");
        assert_eq!(record.tool_calls.len(), 1);
        assert!(
            record.tool_calls[0]
                .output
                .as_deref()
                .is_some_and(|output| output.contains("接入 runtime HTTP route"))
        );
        assert!(record.content.contains("RT Agent API"));

        let _ = shutdown_tx.send(());
    }

    #[tokio::test]
    async fn internal_proposal_tool_calls_use_shared_helper_and_persist_proposals() {
        let tmp = tempfile::tempdir().unwrap();
        let proposal_store = Arc::new(ProposalStore::new());
        let runtime = AgentSessionRuntime::new(
            Arc::new(crate::config::ConfigStore::new()),
            Arc::new(EventLogStore::new(tmp.path().join("eventlog"))),
            Arc::clone(&proposal_store),
            Arc::new(AgentSessionStore::new()),
        );

        let trigger = AgentApiTickTrigger::new(runtime.clone())
            .with_scope_key(Some("profile-alpha".to_string()))
            .with_presets(vec![
                crate::agent::session::TOOL_PRESET_PROPOSAL_TOOLS.to_string(),
            ]);
        let tools = resolve_agent_tools_for_runtime(
            &runtime,
            Vec::new(),
            &trigger.presets,
            trigger.scope_key.clone(),
        )
        .unwrap();
        assert_eq!(tools.len(), 4);
        assert!(tools.iter().any(|tool| tool.name == ADD_TASK_PROPOSAL_TOOL));

        let executed = execute_internal_tool_calls(
            &runtime,
            Some("profile-alpha".to_string()),
            &[ToolCall {
                id: "proposal-call-1".to_string(),
                name: ADD_TASK_PROPOSAL_TOOL.to_string(),
                input: json!({
                    "title": "为依赖图验收创建任务提案",
                    "body": "事件日志提示明天需要验收任务依赖图新布局",
                    "taskTitle": "验收任务依赖图新布局",
                    "description": "结合最近 task-dag 改动做验收",
                    "tags": ["task-dag", "acceptance"],
                    "priority": "high"
                }),
            }],
        )
        .await;

        assert_eq!(executed.len(), 1);
        assert_eq!(executed[0].0.tool_name, ADD_TASK_PROPOSAL_TOOL);
        assert!(
            executed[0]
                .0
                .output
                .as_deref()
                .is_some_and(|output| output.contains("\"actionType\":\"task.create\""))
        );

        let proposals = proposal_store
            .list_scoped(Some("profile-alpha"), &ProposalFilter::default())
            .unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].action_type, ActionType::CreateTask);
        assert_eq!(proposals[0].title, "为依赖图验收创建任务提案");
    }

    #[tokio::test]
    async fn on_tick_persists_failed_internal_agent_api_session() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = AgentWorkspace::init("life-beta", tmp.path()).unwrap();
        let cognition = Box::new(LlmCognition::new("life-beta", DEFAULT_SOUL));
        let config_store = Arc::new(crate::config::ConfigStore::new());
        let eventlog_store = Arc::new(EventLogStore::new(tmp.path().join("eventlog")));
        let agent_session_store = Arc::new(AgentSessionStore::new());
        let runtime = AgentSessionRuntime::new(
            Arc::clone(&config_store),
            Arc::clone(&eventlog_store),
            Arc::new(crate::proposal::ProposalStore::new()),
            Arc::clone(&agent_session_store),
        );

        let (base_url, shutdown_tx) = spawn_failing_openai_server().await;
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

        let agent = CognitiveLifeAgent::new("life-beta", "认知生命体 Beta", workspace, cognition)
            .with_agent_api_tick_trigger(AgentApiTickTrigger::new(runtime));

        let energy = AgentEnergySnapshot {
            agent_id: "life-beta".to_string(),
            current: 90,
            max: 100,
            ratio: 0.9,
            tick_cost: 10,
            phase: "normal".to_string(),
            is_dormant: false,
        };

        let _ = agent.on_tick(&energy).await;

        let state = agent.workspace().load_state().unwrap();
        let session_id = state["agent_api_session_id"].as_str().unwrap();
        let record = agent_session_store.get(session_id).unwrap().unwrap();
        assert_eq!(record.trigger_source, "life-beta-tick");
        assert_eq!(record.status, "failed");
        assert!(
            record
                .error_message
                .as_deref()
                .is_some_and(|message| message.contains("OpenAI HTTP 500"))
        );

        let _ = shutdown_tx.send(());
    }
}
