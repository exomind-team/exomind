use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream, StreamExt};

use super::cognition::{
    BodyStatus, CognitionContext, CognitionEngine, CognitionOutput, KnowledgeOp,
};
use super::session::{
    AgentSessionRuntime, AgentTrigger, SessionError, build_tool_registry_for_runtime,
    resolve_provider_profile_with_runtime, run_agent_session_with_runtime,
};
use super::tools::GET_RECENT_EVENTS_TOOL;
use super::workspace::{ActionEntry, AgentWorkspace};
use super::{Agent, ChatChunk, ChatRequest};
use crate::energy::AgentEnergySnapshot;
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

#[derive(Clone)]
pub struct AgentApiTickTrigger {
    runtime: AgentSessionRuntime,
    scope_key: Option<String>,
    system_prompt: Option<String>,
    prompt: String,
    requested_tools: Vec<String>,
    min_energy_ratio: f64,
}

impl AgentApiTickTrigger {
    pub fn new(runtime: AgentSessionRuntime) -> Self {
        Self {
            runtime,
            scope_key: None,
            system_prompt: Some(
                "你是外心认知助理。你必须先调用 get_recent_events 工具读取最近 20 条事件，再基于事件内容输出一段简明分析。"
                    .to_string(),
            ),
            prompt: "请调用 get_recent_events(limit=20)，总结用户近期主要活动，并给出一句下一步建议。"
                .to_string(),
            requested_tools: vec![GET_RECENT_EVENTS_TOOL.to_string()],
            min_energy_ratio: 0.3,
        }
    }

    pub fn with_scope_key(mut self, scope_key: Option<String>) -> Self {
        self.scope_key = scope_key;
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

        let tools = match build_tool_registry_for_runtime(
            &trigger.runtime,
            trigger.scope_key.clone(),
            &trigger.requested_tools,
        ) {
            Ok(tools) => tools,
            Err(error) => {
                tracing::warn!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick tool registry build failed"
                );
                return None;
            }
        };

        match run_agent_session_with_runtime(
            profile,
            trigger.system_prompt.clone(),
            trigger.prompt.clone(),
            &tools,
            AgentTrigger::Internal {
                source: format!("{}-tick", self.id),
            },
            &trigger.runtime,
        )
        .await
        {
            Ok(record) => {
                tracing::info!(
                    agent_id = %self.id,
                    session_id = %record.session_id,
                    "life agent persisted internal agent-api session"
                );
                Some(record.session_id)
            }
            Err(SessionError::MissingRuntimeConfig(error))
            | Err(SessionError::InvalidProviderProfile(error)) => {
                tracing::debug!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick skipped because runtime provider config became unavailable"
                );
                None
            }
            Err(error) => {
                tracing::warn!(
                    agent_id = %self.id,
                    error = %error,
                    "life agent agent-api tick request failed"
                );
                None
            }
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
    use crate::agent::session::{AgentSessionRuntime, AgentSessionStore};
    use crate::config::PutConfigEntryInput;
    use crate::config::types::USER_CONFIG_SCOPE;
    use crate::eventlog::{EventLogStore, EventRecord};
    use axum::extract::State as AxumState;
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
        assert!(record.content.contains("RT Agent API"));

        let _ = shutdown_tx.send(());
    }
}
