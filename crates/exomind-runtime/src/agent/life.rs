use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream, StreamExt};

use super::cognition::{
    BodyStatus, CognitionContext, CognitionEngine, CognitionOutput, KnowledgeOp,
};
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

// ---------------------------------------------------------------------------
// CognitiveLifeAgent — the first cognitive life form
// ---------------------------------------------------------------------------

pub struct CognitiveLifeAgent {
    id: String,
    name: String,
    workspace: AgentWorkspace,
    cognition: Box<dyn CognitionEngine>,
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
            tick_count: AtomicU64::new(0),
        }
    }

    /// Access the workspace (for REST / Tauri endpoints).
    pub fn workspace(&self) -> &AgentWorkspace {
        &self.workspace
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

            // Save cognitive state to agent.state.json.
            match self.cognition.save_state().await {
                Ok(cog_state) => {
                    let state = serde_json::json!({
                        "tick_count": tick,
                        "strategy": self.body_status().current_strategy,
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

    fn make_life_agent(name: &str) -> (tempfile::TempDir, CognitiveLifeAgent) {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let ws = AgentWorkspace::init(name, tmp.path()).expect("init workspace");
        let cognition = Box::new(LlmCognition::new(name, DEFAULT_SOUL));
        let agent = CognitiveLifeAgent::new(name, format!("Life Agent {name}"), ws, cognition);
        (tmp, agent)
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
}
