pub mod context;
pub mod templates;
pub mod tools;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream, StreamExt};
use tokio::sync::broadcast;

use crate::agent::broker::{self, AgentTurnBroker, AgentTurnRequest, AgentTurnResult, TurnItem};
use crate::agent::session::AgentSessionRuntime;
use crate::agent::tools::{ToolDef, ToolFn, ToolRegistry};
use crate::agent::{Agent, ChatChunk, ChatRequest, SessionInfo};
use crate::config::types::PutConfigEntryInput;
use crate::config::ConfigStore;
use crate::energy::AgentEnergySnapshot;
use crate::eventlog::{EventLogStore, EventRecord};
use crate::signal::types::SignalEvent;
use crate::signal::SignalPool;
use crate::timeblock::TimeBlockData;

use context::collect_context;
use templates::{build_end_prompt, build_start_prompt, system_prompt};
use tools::{submit_timeblock_summary_tool, SUBMIT_TIMEBLOCK_SUMMARY_TOOL};

const CONFIG_KEY_ENABLED: &str = "builtin.timeblock_summary.enabled";
const MAX_TOOL_ROUNDS: usize = 30;

/// Summary kind: start (timeblock created) or end (timeblock completed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SummaryKind {
    Start,
    End,
}

/// Record of a processed timeblock summary.
#[derive(Debug, Clone)]
pub struct ProcessedRecord {
    pub event_id: String,
    pub kind: SummaryKind,
    pub timestamp: u64,
}

/// Built-in timeblock summary agent service.
///
/// Subscribes to `timeblock.replication.completed` and `timeblock.replication.active_upserted`
/// signals, automatically collects context, and generates narrative `agent_feedback` via LLM.
pub struct TimeblockSummaryAgentService {
    enabled: Arc<AtomicBool>,
    signal_pool: Arc<SignalPool>,
    config_store: Arc<ConfigStore>,
    eventlog_store: Arc<EventLogStore>,
    session_runtime: AgentSessionRuntime,
    processed: Arc<RwLock<HashMap<String, ProcessedRecord>>>,
}

impl TimeblockSummaryAgentService {
    pub fn new(
        signal_pool: Arc<SignalPool>,
        config_store: Arc<ConfigStore>,
        eventlog_store: Arc<EventLogStore>,
        session_runtime: AgentSessionRuntime,
    ) -> Self {
        // Check initial enabled state from config
        let enabled = config_store
            .get("device", CONFIG_KEY_ENABLED)
            .ok()
            .flatten()
            .and_then(|e| e.value.parse::<bool>().ok())
            .unwrap_or(false);

        Self {
            enabled: Arc::new(AtomicBool::new(enabled)),
            signal_pool,
            config_store,
            eventlog_store,
            session_runtime,
            processed: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Spawn the signal listener as a background tokio task.
    pub fn spawn(self: &Arc<Self>) {
        let service = Arc::clone(self);
        let mut rx = self.signal_pool.subscribe();

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        if let Err(e) = service.handle_signal(&event).await {
                            tracing::warn!(
                                event_id = %event.id,
                                topic = %event.topic,
                                "timeblock_summary: signal handling error: {e}"
                            );
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(
                            "timeblock_summary: broadcast receiver lagged, skipped {n} events"
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        tracing::info!("timeblock_summary: broadcast channel closed, shutting down");
                        break;
                    }
                }
            }
        });
    }

    async fn handle_signal(&self, event: &SignalEvent) -> Result<(), String> {
        // Re-read config in case it changed at runtime (must be BEFORE AtomicBool check)
        if let Ok(Some(entry)) = self.config_store.get("device", CONFIG_KEY_ENABLED) {
            let new_enabled = entry.value.parse::<bool>().unwrap_or(false);
            self.enabled
                .store(new_enabled, std::sync::atomic::Ordering::Relaxed);
        }

        // Check enabled (after config re-read)
        if !self.enabled.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(());
        }

        match event.topic.as_str() {
            "timeblock.replication.completed" => {
                self.handle_completed(event).await;
            }
            "timeblock.replication.active_upserted" => {
                self.handle_active_upserted(event).await;
            }
            _ => {}
        }

        Ok(())
    }

    async fn handle_completed(&self, event: &SignalEvent) {
        let block = match extract_block_from_signal(event) {
            Some(b) => b,
            None => {
                tracing::warn!("timeblock_summary: completed signal missing block data");
                return;
            }
        };

        // Idempotency check
        let key = format!("{}.end", block.start_id);
        if self.processed.read().unwrap().contains_key(&key) {
            tracing::debug!(block_id = %block.start_id, "timeblock_summary: already processed end, skipping");
            return;
        }

        tracing::info!(block_id = %block.start_id, name = %block.name, "timeblock_summary: processing completed block");

        if let Err(e) = self.run_summary_loop(block, SummaryKind::End).await {
            tracing::error!("timeblock_summary: summary loop failed: {e}");
        }
    }

    async fn handle_active_upserted(&self, event: &SignalEvent) {
        let block = match extract_active_block_from_signal(event) {
            Some(b) => b,
            None => {
                tracing::warn!("timeblock_summary: active_upserted signal missing block data");
                return;
            }
        };

        // Only process "active" blocks, skip "gap"
        let block_type = block.block_type.as_deref().unwrap_or("active");
        if block_type == "gap" {
            tracing::debug!(block_id = %block.start_id, "timeblock_summary: gap block, skipping start prompt");
            return;
        }

        // Idempotency check
        let key = format!("{}.start", block.start_id);
        if self.processed.read().unwrap().contains_key(&key) {
            tracing::debug!(block_id = %block.start_id, "timeblock_summary: already processed start, skipping");
            return;
        }

        tracing::info!(block_id = %block.start_id, name = %block.name, "timeblock_summary: processing new active block");

        if let Err(e) = self.run_summary_loop(block, SummaryKind::Start).await {
            tracing::error!("timeblock_summary: summary loop failed: {e}");
        }
    }

    async fn run_summary_loop(
        &self,
        block: TimeBlockData,
        kind: SummaryKind,
    ) -> Result<(), String> {
        // 1. Auto-collect context
        let processed = self.processed.read().unwrap().clone();
        let ctx = collect_context(&self.eventlog_store, &block, &processed).await;

        // 2. Load provider profile
        let provider = match crate::agent::session::resolve_provider_profile_from_runtime(
            &self.session_runtime,
        ) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("timeblock_summary: cannot resolve provider profile: {e}");
                // Write error to eventlog
                let _ = self.eventlog_store.append_event(None, EventRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: chrono::Utc::now().timestamp_millis(),
                    content: format!(
                        "⚠️ 时间块总结 Agent 无法启动：未配置 LLM provider。块ID={}",
                        block.start_id
                    ),
                    tags: vec!["agent_feedback".to_string(), "agent_error".to_string()],
                    refs: vec![],
                    metadata: Some(serde_json::json!({
                        "agent": "timeblock_summary",
                        "block_id": block.start_id,
                        "status": "missing_provider",
                    })),
                });
                return Err(format!("missing provider: {e}"));
            }
        };

        // 3. Build tools (only submit_timeblock_summary)
        let (tool_def, tool_fn) =
            submit_timeblock_summary_tool(block.clone(), kind.clone(), Arc::clone(&self.eventlog_store));
        let mut tool_registry = ToolRegistry::new();
        tool_registry.register(tool_def, tool_fn);

        // 4. Build prompts
        let initial_prompt = match kind {
            SummaryKind::Start => build_start_prompt(&ctx),
            SummaryKind::End => build_end_prompt(&ctx),
        };

        let mut history = vec![TurnItem::User {
            content: initial_prompt,
        }];
        let mut submitted = false;

        // 5. Broker loop
        for round in 0..MAX_TOOL_ROUNDS {
            let request = AgentTurnRequest {
                provider: provider.clone(),
                system_prompt: Some(system_prompt().to_string()),
                tools: tool_registry
                    .list_defs()
                    .iter()
                    .map(|d| broker::ToolDef {
                        name: d.name.clone(),
                        description: d.description.clone(),
                        input_schema: d.input_schema.clone(),
                    })
                    .collect(),
                history: history.clone(),
                new_user_message: None,
            };

            match AgentTurnBroker.run(request).await {
                Ok(AgentTurnResult::Final { assistant_turn: _ }) => {
                    // LLM returned text without calling tools
                    tracing::debug!(
                        block_id = %block.start_id,
                        round,
                        "timeblock_summary: LLM returned final without tool call"
                    );
                    break;
                }
                Ok(AgentTurnResult::NeedsToolCalls {
                    assistant_turn,
                    tool_calls,
                }) => {
                    history.push(TurnItem::Assistant {
                        content: assistant_turn.content,
                        tool_calls: tool_calls.clone(),
                    });

                    for tc in &tool_calls {
                        if tc.name == SUBMIT_TIMEBLOCK_SUMMARY_TOOL {
                            let tool_use = crate::agent::tools::ToolUse {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                input: tc.input.clone(),
                            };
                            let result = tool_registry.dispatch(&tool_use).await;
                            if result.content.starts_with("已写入") {
                                submitted = true;
                                tracing::info!(
                                    block_id = %block.start_id,
                                    round,
                                    event_result = %result.content,
                                    "timeblock_summary: summary submitted successfully"
                                );
                            } else {
                                tracing::warn!(
                                    block_id = %block.start_id,
                                    result = %result.content,
                                    "timeblock_summary: submit failed"
                                );
                            }
                            break;
                        }

                        let tool_use = crate::agent::tools::ToolUse {
                            id: tc.id.clone(),
                            name: tc.name.clone(),
                            input: tc.input.clone(),
                        };
                        let result = tool_registry.dispatch(&tool_use).await;
                        history.push(TurnItem::ToolResult {
                            tool_call_id: tc.id.clone(),
                            tool_name: tc.name.clone(),
                            content: result.content,
                        });
                    }

                    if submitted {
                        break;
                    }
                }
                Err(e) => {
                    tracing::error!(
                        block_id = %block.start_id,
                        round,
                        error = %e,
                        "timeblock_summary: broker error"
                    );
                    break;
                }
            }
        }

        // 6. Safety fallback
        if !submitted {
            tracing::warn!(
                block_id = %block.start_id,
                "timeblock_summary: LLM did not call submit after {MAX_TOOL_ROUNDS} rounds"
            );

            let _ = self.eventlog_store.append_event(None, EventRecord {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                content: format!(
                    "⚠️ 时间块总结 Agent 运行异常：{} 轮未调用 submit_timeblock_summary，块ID={}",
                    MAX_TOOL_ROUNDS, block.start_id
                ),
                tags: vec!["agent_feedback".to_string(), "agent_error".to_string()],
                refs: vec![],
                metadata: Some(serde_json::json!({
                    "agent": "timeblock_summary",
                    "block_id": block.start_id,
                    "rounds": MAX_TOOL_ROUNDS,
                    "status": "max_rounds_exceeded"
                })),
            });
        }

        // 7. Record idempotency state
        if submitted {
            let key = match kind {
                SummaryKind::Start => format!("{}.start", block.start_id),
                SummaryKind::End => format!("{}.end", block.start_id),
            };
            self.processed.write().unwrap().insert(
                key,
                ProcessedRecord {
                    event_id: uuid::Uuid::new_v4().to_string(),
                    kind,
                    timestamp: chrono::Utc::now().timestamp_millis() as u64,
                },
            );
        }

        Ok(())
    }
}

impl Agent for TimeblockSummaryAgentService {
    fn id(&self) -> &str {
        "timeblock_summary"
    }

    fn name(&self) -> &str {
        "时间块总结"
    }

    fn description(&self) -> &str {
        "内置后台 Agent：在时间块开始/结束时自动生成叙事型 agent_feedback"
    }

    fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        stream::iter(vec![ChatChunk::content_only(
            "我是时间块总结 Agent。我不提供自由聊天，我的主要入口是信号触发。请在设置页启用「内置时间块总结」后，开始/结束时间块即可触发我的工作。",
        )])
        .boxed()
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            "timeblock.replication.completed".to_string(),
            "timeblock.replication.active_upserted".to_string(),
        ]
    }

    fn publications(&self) -> Vec<String> {
        vec!["agent_feedback.timeblock_summary".to_string()]
    }
}

// ── Signal payload extraction helpers ──

fn extract_block_from_signal(event: &SignalEvent) -> Option<TimeBlockData> {
    let block_value = event.payload.get("block")?;
    serde_json::from_value(block_value.clone()).ok()
}

fn extract_active_block_from_signal(event: &SignalEvent) -> Option<TimeBlockData> {
    // active_upserted payload has "active" field with ActiveBlockData structure
    let active_value = event.payload.get("active")?;
    let active: crate::timeblock::ActiveBlockData = serde_json::from_value(active_value.clone()).ok()?;

    // Convert ActiveBlockData to TimeBlockData
    Some(TimeBlockData {
        id: active.start_id.clone(),
        name: active.name.clone(),
        start_id: active.start_id.clone(),
        end_id: String::new(), // Active block has no end_id yet
        note: None,
        tags: vec![],
        start_time: active.start_time,
        end_time: 0, // Active block has no end_time yet
        block_type: active.block_type.clone(),
        task_ids: active.task_ids.clone(),
        task_status_outcomes: None,
        task_association_log: active.task_association_log.clone(),
        source_planned_block_id: active.source_planned_block_id.clone(),
        transitions: active.transitions.clone(),
    })
}

// ── Config default initialization ──

pub fn init_config_defaults(config_store: &ConfigStore) {
    let _ = config_store.put_if_absent(PutConfigEntryInput {
        scope: "device".to_string(),
        key: CONFIG_KEY_ENABLED.to_string(),
        value: "false".to_string(),
        sensitive: false,
        source: Some("builtin".to_string()),
        source_origin: None,
    });
}
