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
use crate::agent::session::{AgentSessionRecord, AgentSessionRuntime};
use crate::agent::tools::{ToolDef, ToolFn, ToolRegistry};
use crate::agent::{Agent, ChatChunk, ChatRequest, SessionInfo};
use crate::config::types::PutConfigEntryInput;
use crate::config::ConfigStore;
use crate::energy::{AgentEnergySnapshot, EnergyRegistry};
use crate::eventlog::{EventLogStore, EventRecord};
use crate::signal::types::SignalEvent;
use crate::signal::SignalPool;
use crate::timeblock::TimeBlockData;

use context::collect_context;
use templates::{build_end_prompt, build_start_prompt, system_prompt};
use tools::{submit_timeblock_summary_tool, AgentSourceMetadata, SUBMIT_TIMEBLOCK_SUMMARY_TOOL};

const CONFIG_KEY_ENABLED: &str = "builtin.timeblock_summary.enabled";
const ENERGY_MAX: u64 = 100;
const ENERGY_COST_PER_ROUND: u64 = 1;
const ENERGY_WARN_THRESHOLD: u64 = 10;

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
    energy_registry: Arc<EnergyRegistry>,
    processed: Arc<RwLock<HashMap<String, ProcessedRecord>>>,
    sessions: Arc<RwLock<Vec<AgentSessionRecord>>>,
}

impl TimeblockSummaryAgentService {
    pub fn new(
        signal_pool: Arc<SignalPool>,
        config_store: Arc<ConfigStore>,
        eventlog_store: Arc<EventLogStore>,
        session_runtime: AgentSessionRuntime,
        energy_registry: Arc<EnergyRegistry>,
    ) -> Self {
        // Check initial enabled state from config
        let enabled = config_store
            .get("user", CONFIG_KEY_ENABLED)
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
            energy_registry,
            processed: Arc::new(RwLock::new(HashMap::new())),
            sessions: Arc::new(RwLock::new(Vec::new())),
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
        if let Ok(Some(entry)) = self.config_store.get("user", CONFIG_KEY_ENABLED) {
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
                        "source": {
                            "deviceName": crate::routes::topology::read_hostname_export(),
                            "platform": crate::routes::topology::read_os_export(),
                            "app": "ExoMind",
                        },
                    })),
                });
                return Err(format!("missing provider: {e}"));
            }
        };

        // 3. Build tools (only submit_timeblock_summary)
        let source_meta = Arc::new(AgentSourceMetadata {
            device_name: crate::routes::topology::read_hostname_export(),
            platform: crate::routes::topology::read_os_export(),
            provider: provider.provider.clone(),
            model: provider.model.clone(),
        });
        let (tool_def, tool_fn) =
            submit_timeblock_summary_tool(block.clone(), kind.clone(), Arc::clone(&self.eventlog_store), Arc::clone(&source_meta));
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
        let mut total_rounds = 0usize;
        let mut first_assistant_message = String::new();
        let mut last_assistant_message = String::new();
        let mut tool_call_history: Vec<String> = Vec::new();

        // Emit start signal
        self.emit_lifecycle_signal("start", &block.start_id, 0, serde_json::json!({
            "kind": format!("{:?}", kind),
            "provider": provider.provider,
            "model": provider.model,
        }));

        // 5. Energy-driven broker loop
        loop {
            // Check energy
            let current_energy = self.energy_registry.get("timeblock_summary")
                .map(|e| e.snapshot("timeblock_summary").current)
                .unwrap_or(ENERGY_MAX);

            if current_energy == 0 {
                tracing::warn!(
                    block_id = %block.start_id,
                    total_rounds,
                    "timeblock_summary: energy depleted"
                );
                self.write_energy_depleted_event(
                    &block, total_rounds, &first_assistant_message,
                    &last_assistant_message, &tool_call_history, &source_meta,
                ).await;
                break;
            }

            // Warn at threshold
            if current_energy <= ENERGY_WARN_THRESHOLD && current_energy > 0 {
                history.push(TurnItem::User {
                    content: "你的能量即将耗尽，请尽快完成总结并调用 submit_timeblock_summary。".to_string(),
                });
            }

            // Consume energy
            if let Some(energy) = self.energy_registry.get("timeblock_summary") {
                energy.consume(ENERGY_COST_PER_ROUND);
            }

            total_rounds += 1;

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
                Ok(AgentTurnResult::Final { assistant_turn }) => {
                    last_assistant_message = assistant_turn.content.clone();
                    tracing::debug!(
                        block_id = %block.start_id,
                        total_rounds,
                        "timeblock_summary: LLM returned final without tool call"
                    );
                    break;
                }
                Ok(AgentTurnResult::NeedsToolCalls {
                    assistant_turn,
                    tool_calls,
                }) => {
                    if first_assistant_message.is_empty() {
                        first_assistant_message = assistant_turn.content.clone();
                    }
                    last_assistant_message = assistant_turn.content.clone();

                    history.push(TurnItem::Assistant {
                        content: assistant_turn.content,
                        tool_calls: tool_calls.clone(),
                    });

                    for tc in &tool_calls {
                        tool_call_history.push(format!("round {}: {}", total_rounds, tc.name));

                        if tc.name == SUBMIT_TIMEBLOCK_SUMMARY_TOOL {
                            let tool_use = crate::agent::tools::ToolUse {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                input: tc.input.clone(),
                            };
                            let result = tool_registry.dispatch(&tool_use).await;
                            if result.content.starts_with("已写入") {
                                submitted = true;
                                // Replenish energy on success
                                if let Some(energy) = self.energy_registry.get("timeblock_summary") {
                                    energy.refill(10);
                                }
                                tracing::info!(
                                    block_id = %block.start_id,
                                    total_rounds,
                                    event_result = %result.content,
                                    "timeblock_summary: summary submitted successfully"
                                );
                            } else {
                                tracing::warn!(
                                    block_id = %block.start_id,
                                    total_rounds,
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
                        total_rounds,
                        error = %e,
                        "timeblock_summary: broker error"
                    );
                    break;
                }
            }

            // Emit tick signal for each LLM round
            self.emit_lifecycle_signal("tick", &block.start_id, total_rounds, serde_json::json!({
                "submitted": submitted,
                "tool_calls": tool_call_history.len(),
            }));
        }

        // Emit end signal
        self.emit_lifecycle_signal("end", &block.start_id, total_rounds, serde_json::json!({
            "submitted": submitted,
            "tool_calls": tool_call_history,
        }));

        // Note: energy depleted event is written inside the loop when energy == 0
        // Error/broker failures also break out above

        // 6. Record session for frontend display
        let session_id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let trigger_source = format!("timeblock_summary-{:?}", kind);
        let prompt_text = history.iter().find_map(|item| {
            if let TurnItem::User { content } = item {
                Some(content.clone())
            } else {
                None
            }
        });
        let tool_call_records: Vec<crate::agent::session::ToolCallRecord> = history
            .iter()
            .filter_map(|item| {
                if let TurnItem::Assistant { tool_calls, .. } = item {
                    Some(tool_calls.iter().map(|tc| {
                        crate::agent::session::ToolCallRecord {
                            tool_name: tc.name.clone(),
                            input: tc.input.clone(),
                            output: None,
                        }
                    }))
                } else {
                    None
                }
            })
            .flatten()
            .collect();
        let status = if submitted { "completed" } else { "failed" };
        let error_message = if submitted {
            None
        } else {
            Some("Agent did not submit summary".to_string())
        };

        let session_record = crate::agent::session::AgentSessionRecord {
            session_id,
            trigger_source,
            provider: provider.provider.clone(),
            model: provider.model.clone(),
            prompt: prompt_text,
            content: last_assistant_message.clone(),
            assistant_turn: crate::agent::broker::AssistantTurn {
                content: last_assistant_message.clone(),
                tool_calls: Vec::new(),
            },
            tool_calls: tool_call_records,
            status: status.to_string(),
            error_message,
            created_at,
            completed_at: chrono::Utc::now().to_rfc3339(),
        };
        let _ = self.session_runtime.agent_api_session_store.upsert(session_record.clone());
        // Also store in memory for list_sessions()
        {
            let mut sessions = self.sessions.write().unwrap();
            sessions.push(session_record);
            // Keep only last 50 sessions
            let len = sessions.len();
            if len > 50 {
                sessions.drain(0..len - 50);
            }
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

    /// Emit a lifecycle signal (start / tick / end) through the signal pool.
    fn emit_lifecycle_signal(&self, phase: &str, block_id: &str, round: usize, extra: serde_json::Value) {
        let payload = serde_json::json!({
            "phase": phase,
            "block_id": block_id,
            "round": round,
            "energy": self.energy_registry.get("timeblock_summary")
                .map(|e| e.snapshot("timeblock_summary").current)
                .unwrap_or(0),
            "extra": extra,
        });
        self.signal_pool.publish(crate::signal::types::SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: format!("timeblock_summary.{}", phase),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "timeblock_summary".to_string(),
            origin_host_id: String::new(),
            hop: 1,
            trace_id: None,
            payload,
        });
    }

    /// Write a diagnostic summary event when the agent's energy is depleted.
    async fn write_energy_depleted_event(
        &self,
        block: &TimeBlockData,
        total_rounds: usize,
        first_message: &str,
        last_message: &str,
        tool_call_history: &[String],
        source_meta: &AgentSourceMetadata,
    ) {
        fn truncate(s: &str, max_chars: usize) -> String {
            if s.len() <= max_chars {
                s.to_string()
            } else {
                format!("{}…", &s[..max_chars])
            }
        }

        let tool_history_text = if tool_call_history.is_empty() {
            "无".to_string()
        } else {
            tool_call_history
                .iter()
                .map(|line| format!("- {}", line))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let content = format!(
            "## ⚠️ 时间块总结 Agent 能量耗尽\n\n\
             **块 ID**: {}\n\
             **能量消耗**: {ENERGY_MAX}/{}（每轮 -{ENERGY_COST_PER_ROUND}）\n\
             **对话轮数**: {}\n\n\
             **工具调用历史**:\n{}\n\n\
             **首条消息**: {}\n\
             **末条消息**: {}",
            block.start_id,
            ENERGY_MAX,
            total_rounds,
            tool_history_text,
            truncate(first_message, 100),
            truncate(last_message, 100),
        );

        let _ = self.eventlog_store.append_event(None, EventRecord {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            content,
            tags: vec!["agent_feedback".to_string(), "agent_error".to_string()],
            refs: vec![],
            metadata: Some(serde_json::json!({
                "agent": "timeblock_summary",
                "block_id": block.start_id,
                "total_rounds": total_rounds,
                "status": "energy_depleted",
                "source": {
                    "deviceName": source_meta.device_name,
                    "platform": source_meta.platform,
                    "provider": source_meta.provider,
                    "model": source_meta.model,
                    "app": "ExoMind",
                },
            })),
        });
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

    fn soul(&self) -> String {
        system_prompt().to_string()
    }

    fn list_sessions(&self) -> Vec<crate::agent::SessionInfo> {
        let sessions = self.sessions.read().unwrap();
        sessions
            .iter()
            .rev()
            .map(|s| crate::agent::SessionInfo {
                session_id: s.session_id.clone(),
                status: s.status.clone(),
                created_at: s.created_at.clone(),
                last_active: s.completed_at.clone(),
                message_count: (s.tool_calls.len() as u64) + 1,
                uptime_secs: 0,
                content: Some(s.content.clone()),
                trigger_source: Some(s.trigger_source.clone()),
                prompt: s.prompt.clone(),
                provider: Some(s.provider.clone()),
                model: Some(s.model.clone()),
            })
            .collect()
    }

    fn get_session(&self, session_id: &str) -> Option<crate::agent::SessionInfo> {
        let sessions = self.sessions.read().unwrap();
        sessions.iter().find(|s| s.session_id == session_id).map(|s| {
            crate::agent::SessionInfo {
                session_id: s.session_id.clone(),
                status: s.status.clone(),
                created_at: s.created_at.clone(),
                last_active: s.completed_at.clone(),
                message_count: (s.tool_calls.len() as u64) + 1,
                uptime_secs: 0,
                content: Some(s.content.clone()),
                trigger_source: Some(s.trigger_source.clone()),
                prompt: s.prompt.clone(),
                provider: Some(s.provider.clone()),
                model: Some(s.model.clone()),
            }
        })
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
        scope: "user".to_string(),
        key: CONFIG_KEY_ENABLED.to_string(),
        value: "false".to_string(),
        sensitive: false,
        source: Some("builtin".to_string()),
        source_origin: None,
    });
}
