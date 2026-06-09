use std::sync::RwLock;

use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::signal::types::SignalEvent;

use super::cognition::{
    BodyStatus, CognitionContext, CognitionEngine, CognitionOutput, CognitionState, KnowledgeOp,
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InternalState {
    strategy: String,
    tick_count: u64,
}

impl Default for InternalState {
    fn default() -> Self {
        Self {
            strategy: "exploring".to_string(),
            tick_count: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// LlmCognition — Phase 1 rule-based cognition engine
// ---------------------------------------------------------------------------

/// Phase 1 cognition engine: rule-based strategy selection.
///
/// Future phases will replace the rule logic with real LLM calls while
/// keeping the same `CognitionEngine` interface.
pub struct LlmCognition {
    agent_id: String,
    _soul: String,
    state: RwLock<InternalState>,
}

impl LlmCognition {
    pub fn new(agent_id: impl Into<String>, soul: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            _soul: soul.into(),
            state: RwLock::new(InternalState::default()),
        }
    }

    /// Determine strategy based on energy ratio.
    fn select_strategy(energy_ratio: f64) -> &'static str {
        if energy_ratio > 0.7 {
            "exploring"
        } else if energy_ratio > 0.3 {
            "conserving"
        } else if energy_ratio > 0.1 {
            "surviving"
        } else {
            "dying"
        }
    }

    /// Build a diary entry for the current tick.
    fn build_diary_entry(
        tick: u64,
        strategy: &str,
        body: &BodyStatus,
        signal_count: usize,
    ) -> String {
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
        format!(
            "## Tick {tick} — {now}\n\
             - Strategy: {strategy}\n\
             - Energy: {ratio:.0}%\n\
             - Knowledge usage: {kb_ratio:.0}%\n\
             - Total actions: {actions}\n\
             - Signals received: {signal_count}\n",
            ratio = body.knowledge_usage_ratio as f64 * 0.0 + // placeholder; real energy below
                    0.0, // we use body_status for kb
            kb_ratio = body.knowledge_usage_ratio * 100.0,
            actions = body.total_actions,
        )
    }

    /// Build a response signal when the agent has enough energy to respond.
    fn build_response_signal(
        agent_id: &str,
        strategy: &str,
        tick: u64,
        energy_ratio: f64,
    ) -> SignalEvent {
        let message = match strategy {
            "exploring" => format!(
                "✨ Tick {tick}: I feel alive and curious. Energy at {pct:.0}%.",
                pct = energy_ratio * 100.0
            ),
            "conserving" => format!(
                "💛 Tick {tick}: Conserving energy. At {pct:.0}%, being selective.",
                pct = energy_ratio * 100.0
            ),
            "surviving" => format!(
                "🧡 Tick {tick}: Survival mode. Energy low at {pct:.0}%.",
                pct = energy_ratio * 100.0
            ),
            "dying" => format!(
                "❤️‍🩹 Tick {tick}: Fading away... Energy at {pct:.0}%.",
                pct = energy_ratio * 100.0
            ),
            _ => format!("Tick {tick}: Energy {pct:.0}%.", pct = energy_ratio * 100.0),
        };

        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: format!("agent.life.{strategy}"),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: format!("agent:{agent_id}"),
            origin_host_id: String::new(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({
                "agent_id": agent_id,
                "tick": tick,
                "strategy": strategy,
                "message": message,
            }),
        }
    }
}

impl CognitionEngine for LlmCognition {
    fn think(&self, ctx: CognitionContext) -> BoxFuture<'_, anyhow::Result<CognitionOutput>> {
        Box::pin(async move {
            let strategy = Self::select_strategy(ctx.energy_ratio);

            let tick = {
                let mut state = self.state.write().unwrap();
                state.tick_count += 1;
                state.strategy = strategy.to_string();
                state.tick_count
            };

            let mut output = CognitionOutput::default();

            match strategy {
                "dying" => {
                    // Emit farewell signal, no knowledge writes.
                    output.action_description =
                        format!("Tick {tick}: Dying — emitting farewell signal.");
                    output.signals_to_emit.push(Self::build_response_signal(
                        &self.agent_id,
                        strategy,
                        tick,
                        ctx.energy_ratio,
                    ));
                }
                "surviving" => {
                    // Silent — conserve everything.
                    output.action_description =
                        format!("Tick {tick}: Surviving — staying silent to conserve energy.");
                }
                "conserving" => {
                    // Respond to incoming signals but don't write knowledge.
                    output.action_description = format!(
                        "Tick {tick}: Conserving — responding to {} signal(s).",
                        ctx.signals.len()
                    );
                    if !ctx.signals.is_empty() {
                        output.signals_to_emit.push(Self::build_response_signal(
                            &self.agent_id,
                            strategy,
                            tick,
                            ctx.energy_ratio,
                        ));
                    }
                }
                _ => {
                    // Full activity: write diary + emit signal.
                    let diary_entry = Self::build_diary_entry(
                        tick,
                        strategy,
                        &ctx.body_status,
                        ctx.signals.len(),
                    );

                    // Append to diary.md (or create it).
                    let existing_diary = ctx.knowledge_summary.contains("diary.md");

                    if existing_diary {
                        // We'll append by writing the full content.
                        // In practice, the life agent will read existing + append.
                        output.knowledge_ops.push(KnowledgeOp::Write {
                            path: "diary.md".to_string(),
                            content: diary_entry,
                        });
                    } else {
                        let full = format!("# Agent Diary\n\n{diary_entry}");
                        output.knowledge_ops.push(KnowledgeOp::Write {
                            path: "diary.md".to_string(),
                            content: full,
                        });
                    }

                    output.signals_to_emit.push(Self::build_response_signal(
                        &self.agent_id,
                        strategy,
                        tick,
                        ctx.energy_ratio,
                    ));

                    output.action_description =
                        format!("Tick {tick}: Exploring — wrote diary entry and emitted signal.");
                }
            }

            Ok(output)
        })
    }

    fn save_state(&self) -> BoxFuture<'_, anyhow::Result<CognitionState>> {
        Box::pin(async {
            let state = self.state.read().unwrap().clone();
            let data = serde_json::to_vec(&state)?;
            Ok(CognitionState {
                engine_type: self.engine_type().to_string(),
                data,
            })
        })
    }

    fn restore_state(&self, state: CognitionState) -> BoxFuture<'_, anyhow::Result<()>> {
        Box::pin(async move {
            anyhow::ensure!(
                state.engine_type == self.engine_type(),
                "engine type mismatch: expected {}, got {}",
                self.engine_type(),
                state.engine_type
            );
            let internal: InternalState = serde_json::from_slice(&state.data)?;
            *self.state.write().unwrap() = internal;
            Ok(())
        })
    }

    fn engine_type(&self) -> &str {
        "llm_cognition_v1"
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ctx(energy_ratio: f64, signals: Vec<SignalEvent>) -> CognitionContext {
        CognitionContext {
            energy_ratio,
            energy_phase: if energy_ratio > 0.8 {
                "normal"
            } else if energy_ratio > 0.5 {
                "slowing"
            } else if energy_ratio > 0.2 {
                "critical"
            } else {
                "dying"
            }
            .to_string(),
            energy_current: (energy_ratio * 100.0) as u64,
            energy_max: 100,
            signals,
            knowledge_summary: String::new(),
            body_status: BodyStatus {
                knowledge_usage_ratio: 0.0,
                total_actions: 0,
                uptime_ticks: 0,
                current_strategy: "exploring".to_string(),
            },
        }
    }

    fn make_signal(topic: &str) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: "test-signal".to_string(),
            topic: topic.to_string(),
            ts: 0,
            source: "test".to_string(),
            origin_host_id: "test".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::Value::Null,
        }
    }

    #[tokio::test]
    async fn exploring_strategy_writes_diary() {
        let engine = LlmCognition::new("alpha", "# Soul");
        let ctx = make_ctx(0.9, vec![]);
        let output = engine.think(ctx).await.unwrap();

        assert_eq!(output.knowledge_ops.len(), 1);
        assert!(!output.signals_to_emit.is_empty());
        assert!(output.action_description.contains("Exploring"));

        match &output.knowledge_ops[0] {
            KnowledgeOp::Write { path, content } => {
                assert_eq!(path, "diary.md");
                assert!(content.contains("Agent Diary"));
            }
            _ => panic!("expected Write op"),
        }
    }

    #[tokio::test]
    async fn conserving_strategy_responds_to_signals() {
        let engine = LlmCognition::new("alpha", "# Soul");
        let ctx = make_ctx(0.5, vec![make_signal("user.input.text")]);
        let output = engine.think(ctx).await.unwrap();

        assert!(output.knowledge_ops.is_empty());
        assert_eq!(output.signals_to_emit.len(), 1);
        assert!(output.action_description.contains("Conserving"));
    }

    #[tokio::test]
    async fn conserving_strategy_silent_without_signals() {
        let engine = LlmCognition::new("alpha", "# Soul");
        let ctx = make_ctx(0.5, vec![]);
        let output = engine.think(ctx).await.unwrap();

        assert!(output.knowledge_ops.is_empty());
        assert!(output.signals_to_emit.is_empty());
    }

    #[tokio::test]
    async fn surviving_strategy_stays_silent() {
        let engine = LlmCognition::new("alpha", "# Soul");
        let ctx = make_ctx(0.2, vec![make_signal("something")]);
        let output = engine.think(ctx).await.unwrap();

        assert!(output.knowledge_ops.is_empty());
        assert!(output.signals_to_emit.is_empty());
        assert!(output.action_description.contains("Surviving"));
    }

    #[tokio::test]
    async fn dying_strategy_emits_farewell() {
        let engine = LlmCognition::new("alpha", "# Soul");
        let ctx = make_ctx(0.05, vec![]);
        let output = engine.think(ctx).await.unwrap();

        assert!(output.knowledge_ops.is_empty());
        assert_eq!(output.signals_to_emit.len(), 1);
        assert!(output.signals_to_emit[0].topic.contains("dying"));
        assert!(output.action_description.contains("Dying"));
    }

    #[tokio::test]
    async fn save_restore_state_roundtrip() {
        let engine = LlmCognition::new("alpha", "# Soul");

        // Run a few ticks to change state.
        let ctx = make_ctx(0.9, vec![]);
        engine.think(ctx.clone()).await.unwrap();
        engine.think(ctx).await.unwrap();

        // Save.
        let saved = engine.save_state().await.unwrap();
        assert_eq!(saved.engine_type, "llm_cognition_v1");

        // Restore into a new engine.
        let engine2 = LlmCognition::new("alpha", "# Soul");
        engine2.restore_state(saved).await.unwrap();

        // Verify tick count resumed.
        let ctx = make_ctx(0.9, vec![]);
        let output = engine2.think(ctx).await.unwrap();
        assert!(output.action_description.contains("Tick 3"));
    }

    #[tokio::test]
    async fn restore_rejects_wrong_engine_type() {
        let engine = LlmCognition::new("alpha", "# Soul");
        let bad_state = CognitionState {
            engine_type: "wrong_engine".to_string(),
            data: vec![],
        };
        assert!(engine.restore_state(bad_state).await.is_err());
    }
}
