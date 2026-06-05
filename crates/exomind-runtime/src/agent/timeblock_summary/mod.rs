pub mod context;
pub mod templates;
pub mod tools;

use std::sync::{Arc, RwLock};
use std::sync::atomic::AtomicBool;

use futures_util::stream::{self, BoxStream, StreamExt};
use tokio::sync::broadcast;

use crate::agent::broker::{self, AgentTurnBroker, AgentTurnRequest, AgentTurnResult, TurnItem};
use crate::agent::session::{AgentSessionRecord, AgentSessionRuntime};
use crate::agent::tools::ToolRegistry;
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
const CONFIG_KEY_SUBSCRIPTIONS: &str = "builtin.timeblock_summary.subscriptions";
const CONFIG_KEY_ACTIVE_SCOPE: &str = "exomind:activeScopeKey";
const ENERGY_MAX: u64 = 100;
const ENERGY_WARN_THRESHOLD: u64 = 10;

/// Calculate energy cost from content blocks.
///
/// Text: ceil(len / 256), Thinking: ceil(len / 512), ToolUse: 1, others: 0.
/// Minimum cost is 1 per turn.
fn calculate_turn_cost(blocks: &[crate::agent::api::ContentBlock]) -> u64 {
    let mut cost = 0u64;
    for block in blocks {
        match block.block_type.as_str() {
            "text" => {
                let len = block.text.as_ref().map_or(0, |t| t.len() as u64);
                cost += (len + 255) / 256;
            }
            "thinking" | "redacted_thinking" => {
                let len = block.text.as_ref().map_or(0, |t| t.len() as u64);
                cost += (len + 511) / 512;
            }
            "tool_use" => cost += 1,
            _ => {} // refusal, unknown — forward-compatible, cost 0
        }
    }
    cost.max(1)
}

/// Calculate the initial energy budget for a timeblock based on its transitions.
///
/// - Has pause → 120 (interruptions need more energy)
/// - Duration > 1h → 80 (long block, conserve)
/// - Normal → 100
fn calculate_initial_energy(block: &TimeBlockData) -> u64 {
    let has_pause = block
        .transitions
        .iter()
        .any(|t| t.transition_type == crate::timeblock::BlockTransitionType::Pause);

    if has_pause {
        return 120;
    }

    // end_time and start_time are in milliseconds
    let duration_ms = block.end_time.saturating_sub(block.start_time);
    if duration_ms > 3_600_000 { // > 1 hour in milliseconds
        return 80;
    }

    100
}

/// Summary kind: start (timeblock created) or end (timeblock completed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SummaryKind {
    Start,
    End,
}

/// Configurable subscription flags for the timeblock_summary agent.
///
/// Controls which signal topics the agent responds to. Defaults preserve
/// backward-compatible behaviour (only `block_completed` enabled).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubscriptionsConfig {
    /// Listen for `timeblock.replication.completed` signals.
    pub block_completed: bool,
    /// Listen for `timeblock.replication.feedback` signals.
    pub block_feedback: bool,
}

impl Default for SubscriptionsConfig {
    fn default() -> Self {
        Self {
            block_completed: true,
            block_feedback: false, // backward-compatible: off by default
        }
    }
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
    sessions: Arc<RwLock<Vec<AgentSessionRecord>>>,
    /// Most recently completed gap block, used as context for the next active block.
    last_completed_gap: Arc<RwLock<Option<TimeBlockData>>>,
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
            sessions: Arc::new(RwLock::new(Vec::new())),
            last_completed_gap: Arc::new(RwLock::new(None)),
        }
    }

    /// Read the subscription configuration from the config store, falling
    /// back to `SubscriptionsConfig::default()` when absent or invalid.
    fn get_subscriptions(&self) -> SubscriptionsConfig {
        self.config_store
            .get("user", CONFIG_KEY_SUBSCRIPTIONS)
            .ok()
            .flatten()
            .and_then(|e| serde_json::from_str(&e.value).ok())
            .unwrap_or_default()
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

        // Scope check: skip signals from non-active profiles
        if !signal_matches_active_scope(&self.config_store, event) {
            tracing::debug!(
                topic = %event.topic,
                "timeblock_summary: skipping signal from non-active scope"
            );
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

        let block_type = block.block_type.as_deref().unwrap_or("active");

        // Gap blocks: capture data as context for next active block, don't generate summary
        // Only capture recent gaps (within 10 minutes) to avoid stale data
        if block_type == "gap" {
            let now_millis = chrono::Utc::now().timestamp_millis() as u64;
            // Validate that block.end_time is in milliseconds (sanity check)
            debug_assert!(
                block.end_time > 946684800000,
                "block.end_time should be in milliseconds, got {}",
                block.end_time
            );
            let gap_age_secs = now_millis.saturating_sub(block.end_time) / 1000;
            if gap_age_secs < 600 {
                tracing::info!(
                    block_id = %block.start_id,
                    name = %block.name,
                    age_secs = gap_age_secs,
                    "timeblock_summary: gap block completed, storing as context for next active block"
                );
                *self.last_completed_gap.write().unwrap() = Some(block);
            } else {
                tracing::debug!(
                    block_id = %block.start_id,
                    age_secs = gap_age_secs,
                    "timeblock_summary: gap block too old, ignoring"
                );
            }
            return;
        }

        // Active blocks: clear any stale gap context (this is an active end, not preceded by gap)
        // Idempotency check: query eventlog for existing END-type agent_feedback in this time block
        let filter = crate::eventlog::EventListFilter {
            since_timestamp: Some(block.start_time as i64),
            until_timestamp: Some(block.end_time as i64),
            tags: vec!["agent_feedback".to_string()],
            limit: Some(10),
            ..Default::default()
        };
        if let Ok(events) = self.eventlog_store.list_events_filtered(None, &filter) {
            // Only skip if there's an END-type agent_feedback (not start-type)
            let has_end_feedback = events.iter().any(|e| {
                e.metadata
                    .as_ref()
                    .and_then(|m| m.get("summary_kind"))
                    .and_then(|v| v.as_str())
                    == Some("end")
            });
            if has_end_feedback {
                tracing::debug!(
                    block_id = %block.start_id,
                    "timeblock_summary: already has end-type agent_feedback for this block, skipping"
                );
                return;
            }
        }

        tracing::info!(block_id = %block.start_id, name = %block.name, "timeblock_summary: processing completed active block");

        // Energy replenishment: calculate from events in this time block
        let events_filter = crate::eventlog::EventListFilter {
            since_timestamp: Some(block.start_time as i64),
            until_timestamp: Some(block.end_time as i64),
            limit: Some(1000),
            ..Default::default()
        };
        if let Ok(events) = self.eventlog_store.list_events_filtered(None, &events_filter) {
            let energy_gain = calculate_event_energy_gain(&events);
            if energy_gain > 0 {
                if let Some(energy) = self.energy_registry.get("timeblock_summary") {
                    let current = energy.snapshot("timeblock_summary").current;
                    let new_energy = (current + energy_gain).min(ENERGY_MAX);
                    energy.set_current(new_energy);
                    tracing::info!(
                        block_id = %block.start_id,
                        event_count = events.len(),
                        energy_gain,
                        new_energy,
                        "timeblock_summary: energy replenished from events"
                    );
                }
            }
        }

        if let Err(e) = self.run_summary_loop(block, SummaryKind::End, None).await {
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

        // Idempotency check: query eventlog for existing agent_feedback in this time block
        let end_time = if block.end_time > 0 {
            block.end_time as i64
        } else {
            chrono::Utc::now().timestamp_millis()
        };
        let filter = crate::eventlog::EventListFilter {
            since_timestamp: Some(block.start_time as i64),
            until_timestamp: Some(end_time),
            tags: vec!["agent_feedback".to_string()],
            limit: Some(1),
            ..Default::default()
        };
        if let Ok(events) = self.eventlog_store.list_events_filtered(None, &filter) {
            if !events.is_empty() {
                tracing::debug!(
                    block_id = %block.start_id,
                    "timeblock_summary: already has agent_feedback for this block, skipping"
                );
                return;
            }
        }

        tracing::info!(block_id = %block.start_id, name = %block.name, "timeblock_summary: processing new active block");

        // Energy replenishment: countdown mode → supplement by target_minutes
        if let Some(active_value) = event.payload.get("active") {
            if let Ok(active) = serde_json::from_value::<crate::timeblock::ActiveBlockData>(active_value.clone()) {
                if active.mode == "countdown" {
                    if let Some(target_minutes) = active.target_minutes {
                        let energy_gain = target_minutes;
                        if energy_gain > 0 {
                            if let Some(energy) = self.energy_registry.get("timeblock_summary") {
                                let current = energy.snapshot("timeblock_summary").current;
                                let new_energy = (current + energy_gain).min(ENERGY_MAX);
                                energy.set_current(new_energy);
                                tracing::info!(
                                    block_id = %block.start_id,
                                    target_minutes,
                                    energy_gain,
                                    new_energy,
                                    "timeblock_summary: energy replenished from countdown"
                                );
                            }
                        }
                    }
                }
            }
        }

        // Check for recent gap completion to inject as context
        let gap_context = self.last_completed_gap.write().unwrap().take();

        if let Err(e) = self.run_summary_loop(block, SummaryKind::Start, gap_context).await {
            tracing::error!("timeblock_summary: summary loop failed: {e}");
        }
    }

    async fn run_summary_loop(
        &self,
        block: TimeBlockData,
        kind: SummaryKind,
        gap_context: Option<TimeBlockData>,
    ) -> Result<(), String> {
        // 1. Auto-collect context

        // Set dynamic initial energy based on block transitions
        // Use max(current, calculated) to avoid reducing energy if already higher
        let initial_energy = calculate_initial_energy(&block);
        if let Some(energy) = self.energy_registry.get("timeblock_summary") {
            let current = energy.snapshot("timeblock_summary").current;
            let new_energy = current.max(initial_energy);
            energy.set_current(new_energy);
        }

        let energy_snapshot = self.energy_registry.get("timeblock_summary")
            .map(|e| e.snapshot("timeblock_summary"));
        let energy_current = energy_snapshot.as_ref().map(|s| s.current).unwrap_or(ENERGY_MAX);
        let energy_max = energy_snapshot.as_ref().map(|s| s.max).unwrap_or(ENERGY_MAX);
        let ctx = collect_context(&self.eventlog_store, &block, energy_current, energy_max).await;

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

        // 3. Build tools: submit + exploration tools
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

        // Register exploration tools
        for (explorer_def, explorer_fn) in tools::exploration_tools(block.clone(), Arc::clone(&self.eventlog_store)) {
            tool_registry.register(explorer_def, explorer_fn);
        }

        // 4. Build prompts
        let initial_prompt = match kind {
            SummaryKind::Start => build_start_prompt(&ctx, gap_context.as_ref()),
            SummaryKind::End => build_end_prompt(&ctx),
        };

        let mut history = vec![TurnItem::User {
            content: initial_prompt,
        }];
        let mut submitted = false;
        let mut total_rounds = 0usize;
        let mut first_assistant_message = String::new();
        let mut last_assistant_message = String::new();
        let mut tool_result_content = String::new(); // captures submit_timeblock_summary result
        let mut last_content_blocks: Vec<crate::agent::api::ContentBlock> = Vec::new();
        let mut all_content_blocks: Vec<crate::agent::api::ContentBlock> = Vec::new();
        let mut tool_call_history: Vec<String> = Vec::new();
        let mut action_log: Vec<crate::agent::session::ActionLogEntry> = Vec::new();

        // Record signal reception in action_log
        let initial_energy = self.energy_registry.get("timeblock_summary")
            .map(|e| e.snapshot("timeblock_summary").current)
            .unwrap_or(ENERGY_MAX);
        action_log.push(crate::agent::session::ActionLogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            tick: 0,
            action_type: "signal".to_string(),
            description: format!("收到{}信号：{}", match kind {
                SummaryKind::Start => "时间块开始",
                SummaryKind::End => "时间块结束",
            }, block.name),
            energy_before: initial_energy,
            energy_after: initial_energy,
        });

        // Create and save initial session record immediately for real-time frontend display
        let session_id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let trigger_source = format!("timeblock_summary-{:?}", kind);
        let initial_session_record = crate::agent::session::AgentSessionRecord {
            session_id: session_id.clone(),
            trigger_source,
            provider: provider.provider.clone(),
            model: provider.model.clone(),
            prompt: None,
            content: String::new(),
            assistant_turn: crate::agent::broker::AssistantTurn {
                content: String::new(),
                tool_calls: Vec::new(),
                content_blocks: Vec::new(),
            },
            tool_calls: Vec::new(),
            content_blocks: None,
            action_log: action_log.clone(),
            status: "processing".to_string(),
            error_message: None,
            created_at,
            completed_at: String::new(),
        };
        let _ = self.session_runtime.agent_api_session_store.upsert(initial_session_record.clone());
        {
            let mut sessions = self.sessions.write().unwrap();
            sessions.push(initial_session_record);
            let len = sessions.len();
            if len > 50 {
                sessions.drain(0..len - 50);
            }
        }

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
                    // Content-based energy consumption
                    let turn_cost = calculate_turn_cost(&assistant_turn.content_blocks);
                    let energy_before = current_energy;
                    if let Some(energy) = self.energy_registry.get("timeblock_summary") {
                        energy.consume(turn_cost);
                    }
                    let energy_after = self.energy_registry.get("timeblock_summary")
                        .map(|e| e.snapshot("timeblock_summary").current)
                        .unwrap_or(energy_before);

                    // Emit per-block action signals and build action_log entries
                    for content_block in &assistant_turn.content_blocks {
                        self.emit_block_action(&block.start_id, total_rounds, content_block);
                        action_log.push(build_action_log_entry(
                            total_rounds,
                            content_block,
                            energy_before,
                            energy_after,
                        ));
                    }
                    // Real-time update for frontend
                    self.update_session_action_log(&session_id, &action_log);

                    last_assistant_message = assistant_turn.content.clone();
                    last_content_blocks = assistant_turn.content_blocks.clone();
                    all_content_blocks.extend(assistant_turn.content_blocks);
                    tracing::debug!(
                        block_id = %block.start_id,
                        total_rounds,
                        turn_cost,
                        "timeblock_summary: LLM returned final without tool call"
                    );
                    break;
                }
                Ok(AgentTurnResult::NeedsToolCalls {
                    assistant_turn,
                    tool_calls,
                }) => {
                    // Content-based energy consumption
                    let turn_cost = calculate_turn_cost(&assistant_turn.content_blocks);
                    let energy_before = current_energy;
                    if let Some(energy) = self.energy_registry.get("timeblock_summary") {
                        energy.consume(turn_cost);
                    }
                    let energy_after = self.energy_registry.get("timeblock_summary")
                        .map(|e| e.snapshot("timeblock_summary").current)
                        .unwrap_or(energy_before);

                    // Emit per-block action signals and build action_log entries
                    for content_block in &assistant_turn.content_blocks {
                        self.emit_block_action(&block.start_id, total_rounds, content_block);
                        action_log.push(build_action_log_entry(
                            total_rounds,
                            content_block,
                            energy_before,
                            energy_after,
                        ));
                    }
                    // Real-time update for frontend
                    self.update_session_action_log(&session_id, &action_log);

                    if first_assistant_message.is_empty() {
                        first_assistant_message = assistant_turn.content.clone();
                    }
                    last_assistant_message = assistant_turn.content.clone();
                    last_content_blocks = assistant_turn.content_blocks.clone();
                    all_content_blocks.extend(assistant_turn.content_blocks);

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
                            // Capture tool result content for session record
                            tool_result_content = result.content.clone();

                            // Add tool_result entry to action_log
                            action_log.push(crate::agent::session::ActionLogEntry {
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                tick: total_rounds as u64,
                                action_type: "tool_result".to_string(),
                                description: format!("工具返回：{}", result.content),
                                energy_before: energy_after,
                                energy_after,
                            });
                            // Real-time update for frontend
                            self.update_session_action_log(&session_id, &action_log);

                            if result.content.starts_with("已写入") {
                                submitted = true;
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

        // 6. Update session record with final state
        // Use tool_result_content as fallback when LLM returned only tool calls (no text)
        let assistant_content_for_session = last_assistant_message.clone();
        let session_content = if last_assistant_message.is_empty() && !tool_result_content.is_empty() {
            tool_result_content
        } else {
            last_assistant_message
        };
        let status = if submitted { "completed" } else { "failed" };
        let error_message = if submitted {
            None
        } else {
            Some("Agent did not submit summary".to_string())
        };

        // Update the session record in store and memory
        let final_record = crate::agent::session::AgentSessionRecord {
            session_id: session_id.clone(),
            trigger_source: format!("timeblock_summary-{:?}", kind),
            provider: provider.provider.clone(),
            model: provider.model.clone(),
            prompt: history.iter().find_map(|item| {
                if let TurnItem::User { content } = item {
                    Some(content.clone())
                } else {
                    None
                }
            }),
            content: session_content,
            assistant_turn: crate::agent::broker::AssistantTurn {
                content: assistant_content_for_session,
                tool_calls: history.iter().filter_map(|item| {
                    if let TurnItem::Assistant { tool_calls, .. } = item {
                        Some(tool_calls.iter().cloned())
                    } else {
                        None
                    }
                }).flatten().collect(),
                content_blocks: last_content_blocks,
            },
            tool_calls: history.iter().filter_map(|item| {
                if let TurnItem::Assistant { tool_calls, .. } = item {
                    Some(tool_calls.iter().map(|tc| crate::agent::session::ToolCallRecord {
                        tool_name: tc.name.clone(),
                        input: tc.input.clone(),
                        output: None,
                    }))
                } else {
                    None
                }
            }).flatten().collect(),
            content_blocks: if all_content_blocks.is_empty() {
                None
            } else {
                Some(all_content_blocks)
            },
            action_log,
            status: status.to_string(),
            error_message,
            created_at: chrono::Utc::now().to_rfc3339(),
            completed_at: chrono::Utc::now().to_rfc3339(),
        };
        let _ = self.session_runtime.agent_api_session_store.upsert(final_record.clone());
        // Update in-memory session
        {
            let mut sessions = self.sessions.write().unwrap();
            if let Some(existing) = sessions.iter_mut().find(|s| s.session_id == session_id) {
                *existing = final_record;
            }
        }

        Ok(())
    }

    /// Emit a lifecycle signal (start / tick / end) through the signal pool.
    /// Emit a per-block tick signal describing what the agent did in this content block.
    fn emit_block_action(&self, block_id: &str, round: usize, block: &crate::agent::api::ContentBlock) {
        let (action_type, description) = match block.block_type.as_str() {
            "thinking" => {
                let text = block.text.as_deref().unwrap_or("").to_string();
                ("thinking".to_string(), format!("Agent 思考：{}", text))
            }
            "text" => {
                let text = block.text.as_deref().unwrap_or("").to_string();
                ("text".to_string(), format!("Agent 回复：{}", text))
            }
            "tool_use" => {
                let tool_name = block.tool_use.as_ref().map(|t| t.name.as_str()).unwrap_or("unknown");
                ("tool_call".to_string(), format!("Agent 调用工具：{}", tool_name))
            }
            other => {
                let text = block.text.as_deref().unwrap_or("").to_string();
                (other.to_string(), format!("Agent {}：{}", other, text))
            }
        };

        self.emit_lifecycle_signal("tick", block_id, round, serde_json::json!({
            "action_type": action_type,
            "description": description,
            "block_type": block.block_type,
        }));
    }

    /// Update session record in real-time for frontend display.
    fn update_session_action_log(&self, session_id: &str, action_log: &[crate::agent::session::ActionLogEntry]) {
        // Update in-memory session
        let mut sessions = self.sessions.write().unwrap();
        if let Some(existing) = sessions.iter_mut().find(|s| s.session_id == session_id) {
            existing.action_log = action_log.to_vec();
            // Also persist to store
            let _ = self.session_runtime.agent_api_session_store.upsert(existing.clone());
        }
    }

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
             **能量预算**: {ENERGY_MAX}（按内容消耗）\n\
             **对话轮数**: {}\n\n\
             **工具调用历史**:\n{}\n\n\
             **首条消息**: {}\n\
             **末条消息**: {}",
            block.start_id,
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

/// Check if an event is user-input (not system-generated).
fn is_user_input(event: &crate::eventlog::EventRecord) -> bool {
    // Check tags for user_input
    if event.tags.iter().any(|t| t == "user_input") {
        return true;
    }
    // Check metadata.source.app — system events are from exomind-runtime
    if let Some(metadata) = &event.metadata {
        if let Some(source) = metadata.get("source") {
            if let Some(app) = source.get("app") {
                return app.as_str() != Some("exomind-runtime");
            }
        }
    }
    false
}

/// Count effective text characters (exclude whitespace and ASCII punctuation).
fn count_effective_chars(text: &str) -> usize {
    text.chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .count()
}

/// Calculate energy gain from time block events.
fn calculate_event_energy_gain(events: &[crate::eventlog::EventRecord]) -> u64 {
    let event_count = events.len() as u64;
    let user_char_count: usize = events.iter()
        .filter(|e| is_user_input(e))
        .map(|e| count_effective_chars(&e.content))
        .sum();
    ((event_count as f64 + user_char_count as f64 / 100.0).ceil()) as u64
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
            .map(|s| {
                let tool_calls = if s.tool_calls.is_empty() {
                    None
                } else {
                    Some(s.tool_calls.clone())
                };
                let content_blocks = s.content_blocks.clone();
                let action_log = if s.action_log.is_empty() {
                    None
                } else {
                    Some(s.action_log.clone())
                };
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
                    tool_calls,
                    content_blocks,
                    action_log,
                }
            })
            .collect()
    }

    fn get_session(&self, session_id: &str) -> Option<crate::agent::SessionInfo> {
        let sessions = self.sessions.read().unwrap();
        sessions.iter().find(|s| s.session_id == session_id).map(|s| {
            let tool_calls = if s.tool_calls.is_empty() {
                None
            } else {
                Some(s.tool_calls.clone())
            };
            let content_blocks = s.content_blocks.clone();
            let action_log = if s.action_log.is_empty() {
                None
            } else {
                Some(s.action_log.clone())
            };
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
                tool_calls,
                content_blocks,
                action_log,
            }
        })
    }
}

/// Build an ActionLogEntry from a content block.
fn build_action_log_entry(
    round: usize,
    block: &crate::agent::api::ContentBlock,
    energy_before: u64,
    energy_after: u64,
) -> crate::agent::session::ActionLogEntry {
    let (action_type, description) = match block.block_type.as_str() {
        "thinking" => {
            let text = block.text.as_deref().unwrap_or("").to_string();
            ("thinking".to_string(), format!("Agent 思考：{}", text))
        }
        "text" => {
            let text = block.text.as_deref().unwrap_or("").to_string();
            ("text".to_string(), format!("Agent 回复：{}", text))
        }
        "tool_use" => {
            let tool_name = block.tool_use.as_ref().map(|t| t.name.as_str()).unwrap_or("unknown");
            ("tool_call".to_string(), format!("Agent 调用工具：{}", tool_name))
        }
        other => {
            let text = block.text.as_deref().unwrap_or("").to_string();
            (other.to_string(), format!("Agent {}：{}", other, text))
        }
    };

    crate::agent::session::ActionLogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        tick: round as u64,
        action_type,
        description,
        energy_before,
        energy_after,
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

/// Build an AgentSessionRecord from the broker loop state.
///
/// Correctly captures: content (last LLM text), tool_calls (all tool invocations),
/// content_blocks (all API response blocks including thinking, etc.),
/// and action_log (per-block action entries with energy tracking).
fn build_session_record(
    history: &[TurnItem],
    last_assistant_message: &str,
    last_content_blocks: &[crate::agent::api::ContentBlock],
    all_content_blocks: Vec<crate::agent::api::ContentBlock>,
    action_log: Vec<crate::agent::session::ActionLogEntry>,
    submitted: bool,
    provider: &crate::agent::api::ApiProviderProfile,
    kind: &SummaryKind,
) -> crate::agent::session::AgentSessionRecord {
    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let trigger_source = format!("timeblock_summary-{:?}", kind);

    // Extract prompt from first User message in history
    let prompt_text = history.iter().find_map(|item| {
        if let TurnItem::User { content } = item {
            Some(content.clone())
        } else {
            None
        }
    });

    // BUG FIX: Extract tool_calls from ALL Assistant items in history,
    // not just from a hardcoded empty vec.
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

    // Also extract the broker-level ToolCall list for assistant_turn
    let assistant_tool_calls: Vec<crate::agent::broker::ToolCall> = history
        .iter()
        .filter_map(|item| {
            if let TurnItem::Assistant { tool_calls, .. } = item {
                Some(tool_calls.iter().cloned())
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

    let content_blocks_opt = if all_content_blocks.is_empty() {
        None
    } else {
        Some(all_content_blocks)
    };

    crate::agent::session::AgentSessionRecord {
        session_id,
        trigger_source,
        provider: provider.provider.clone(),
        model: provider.model.clone(),
        prompt: prompt_text,
        // BUG FIX: Use last_assistant_message, fall back to empty string (not "N/A")
        content: last_assistant_message.to_string(),
        assistant_turn: crate::agent::broker::AssistantTurn {
            content: last_assistant_message.to_string(),
            // BUG FIX: Include actual tool calls from history, not empty vec
            tool_calls: assistant_tool_calls,
            content_blocks: last_content_blocks.to_vec(),
        },
        tool_calls: tool_call_records,
        content_blocks: content_blocks_opt,
        action_log,
        status: status.to_string(),
        error_message,
        created_at,
        completed_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// Check if a signal's scopeKey matches the currently active scope.
///
/// Returns true (allow) if:
/// - No active scope is configured (fallback: process all)
/// - No scopeKey in signal payload (legacy signal)
/// - scopeKey matches the active scope
///
/// Returns false (skip) if:
/// - Both active scope and signal scopeKey are present but don't match
fn signal_matches_active_scope(config_store: &ConfigStore, event: &SignalEvent) -> bool {
    let signal_scope = event
        .payload
        .get("scopeKey")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let active_scope = config_store
        .get("user", CONFIG_KEY_ACTIVE_SCOPE)
        .ok()
        .flatten()
        .map(|e| e.value.trim().to_string())
        .filter(|s| !s.is_empty());

    match (active_scope, signal_scope) {
        (Some(active), Some(signal)) => active == signal,
        _ => true, // No active scope configured or no scopeKey in signal — allow
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::api::{ApiProviderProfile, ContentBlock};
    use crate::agent::broker::{ToolCall, TurnItem};
    use serde_json::json;

    fn test_provider() -> ApiProviderProfile {
        ApiProviderProfile {
            provider: "openai".to_string(),
            model: "gpt-test".to_string(),
            base_url: None,
            api_key: "sk-test".to_string(),
        }
    }

    #[test]
    fn build_session_record_captures_tool_calls_from_history() {
        let history = vec![
            TurnItem::User {
                content: "请总结时间块".to_string(),
            },
            TurnItem::Assistant {
                content: String::new(), // LLM returned only tool calls, no text
                tool_calls: vec![ToolCall {
                    id: "call_1".to_string(),
                    name: "submit_timeblock_summary".to_string(),
                    input: json!({"narrative": "test"}),
                }],
            },
        ];

        let record = build_session_record(
            &history,
            "",  // last_assistant_message is empty (LLM only returned tool calls)
            &[],
            vec![],
            vec![],
            true,
            &test_provider(),
            &SummaryKind::End,
        );

        // Bug 1: content should be empty string, not "N/A"
        assert_eq!(record.content, "");

        // Bug 2: tool_calls must be captured
        assert_eq!(record.tool_calls.len(), 1);
        assert_eq!(record.tool_calls[0].tool_name, "submit_timeblock_summary");

        // assistant_turn.tool_calls must also be populated
        assert_eq!(record.assistant_turn.tool_calls.len(), 1);
        assert_eq!(record.assistant_turn.tool_calls[0].name, "submit_timeblock_summary");

        // prompt should be captured
        assert_eq!(record.prompt.as_deref(), Some("请总结时间块"));
    }

    #[test]
    fn build_session_record_captures_content_blocks() {
        let blocks = vec![
            ContentBlock {
                block_type: "thinking".to_string(),
                text: Some("让我分析...".to_string()),
                tool_use: None,
            },
            ContentBlock {
                block_type: "text".to_string(),
                text: Some("根据分析...".to_string()),
                tool_use: None,
            },
        ];

        let history = vec![
            TurnItem::User {
                content: "test".to_string(),
            },
            TurnItem::Assistant {
                content: "根据分析...".to_string(),
                tool_calls: vec![],
            },
        ];

        let record = build_session_record(
            &history,
            "根据分析...",
            &blocks,
            blocks.clone(),
            vec![],
            true,
            &test_provider(),
            &SummaryKind::Start,
        );

        // Bug 3: content_blocks must be captured
        assert!(record.content_blocks.is_some());
        assert_eq!(record.content_blocks.as_ref().unwrap().len(), 2);
        assert_eq!(
            record.content_blocks.as_ref().unwrap()[0].block_type,
            "thinking"
        );

        // assistant_turn.content_blocks must also be populated
        assert_eq!(record.assistant_turn.content_blocks.len(), 2);
    }

    #[test]
    fn build_session_record_multiple_tool_calls() {
        let history = vec![
            TurnItem::User {
                content: "test".to_string(),
            },
            TurnItem::Assistant {
                content: "先查看事件".to_string(),
                tool_calls: vec![
                    ToolCall {
                        id: "call_1".to_string(),
                        name: "get_recent_events".to_string(),
                        input: json!({"limit": 5}),
                    },
                    ToolCall {
                        id: "call_2".to_string(),
                        name: "submit_timeblock_summary".to_string(),
                        input: json!({"narrative": "done"}),
                    },
                ],
            },
        ];

        let record = build_session_record(
            &history,
            "先查看事件",
            &[],
            vec![],
            vec![],
            true,
            &test_provider(),
            &SummaryKind::End,
        );

        assert_eq!(record.tool_calls.len(), 2);
        assert_eq!(record.tool_calls[0].tool_name, "get_recent_events");
        assert_eq!(record.tool_calls[1].tool_name, "submit_timeblock_summary");
        assert_eq!(record.assistant_turn.tool_calls.len(), 2);
        assert_eq!(record.content, "先查看事件");
    }

    #[test]
    fn build_session_record_failed_status() {
        let history = vec![
            TurnItem::User {
                content: "test".to_string(),
            },
        ];

        let record = build_session_record(
            &history,
            "partial response",
            &[],
            vec![],
            vec![],
            false, // not submitted
            &test_provider(),
            &SummaryKind::End,
        );

        assert_eq!(record.status, "failed");
        assert!(record.error_message.is_some());
        assert!(record.error_message.unwrap().contains("submit"));
    }

    #[test]
    fn build_start_prompt_injects_gap_context() {
        use crate::agent::timeblock_summary::context::CollectedContext;
        use crate::timeblock::{BlockTransition, BlockTransitionType, TimeBlockData};

        let ctx = CollectedContext {
            block: TimeBlockData {
                id: "active-1".to_string(),
                name: "工作块".to_string(),
                start_id: "active-1".to_string(),
                end_id: String::new(),
                note: None,
                tags: vec![],
                start_time: 1000,
                end_time: 2000,
                block_type: Some("active".to_string()),
                task_ids: vec![],
                task_status_outcomes: None,
                task_association_log: vec![],
                source_planned_block_id: None,
                transitions: vec![],
            },
            events: vec![],
            block_feedback: None,
            recent_completed: None,
            already_has_start: false,
            already_has_end: false,
            energy_current: 100,
            energy_max: 120,
        };

        let gap = TimeBlockData {
            id: "gap-1".to_string(),
            name: "休息间隔".to_string(),
            start_id: "gap-1".to_string(),
            end_id: "gap-1-end".to_string(),
            note: None,
            tags: vec![],
            start_time: 500_000, // 500 seconds in milliseconds
            end_time: 980_000,   // 980 seconds in milliseconds = 480 seconds = 8 minutes
            block_type: Some("gap".to_string()),
            task_ids: vec![],
            task_status_outcomes: None,
            task_association_log: vec![],
            source_planned_block_id: None,
            transitions: vec![],
        };

        // With gap context
        let prompt_with_gap = super::templates::build_start_prompt(&ctx, Some(&gap));
        assert!(prompt_with_gap.contains("前一段间隔（gap）的成果与进展"));
        assert!(prompt_with_gap.contains("休息间隔"));
        assert!(prompt_with_gap.contains("8 分钟"));

        // Without gap context
        let prompt_without_gap = super::templates::build_start_prompt(&ctx, None);
        assert!(!prompt_without_gap.contains("前一段间隔"));
    }

    #[test]
    fn build_session_record_captures_action_log() {
        use crate::agent::session::ActionLogEntry;

        let action_log = vec![
            ActionLogEntry {
                timestamp: "2026-06-05T10:00:00Z".to_string(),
                tick: 1,
                action_type: "thinking".to_string(),
                description: "Agent 思考：让我分析...".to_string(),
                energy_before: 100,
                energy_after: 98,
            },
            ActionLogEntry {
                timestamp: "2026-06-05T10:00:01Z".to_string(),
                tick: 1,
                action_type: "text".to_string(),
                description: "Agent 回复：根据分析...".to_string(),
                energy_before: 98,
                energy_after: 96,
            },
            ActionLogEntry {
                timestamp: "2026-06-05T10:00:02Z".to_string(),
                tick: 1,
                action_type: "tool_call".to_string(),
                description: "调用工具：submit_timeblock_summary".to_string(),
                energy_before: 96,
                energy_after: 95,
            },
        ];

        let history = vec![
            TurnItem::User {
                content: "test".to_string(),
            },
            TurnItem::Assistant {
                content: "根据分析...".to_string(),
                tool_calls: vec![ToolCall {
                    id: "call_1".to_string(),
                    name: "submit_timeblock_summary".to_string(),
                    input: json!({"narrative": "test"}),
                }],
            },
        ];

        let record = build_session_record(
            &history,
            "根据分析...",
            &[],
            vec![],
            action_log.clone(),
            true,
            &test_provider(),
            &SummaryKind::End,
        );

        // action_log must be captured
        assert_eq!(record.action_log.len(), 3);
        assert_eq!(record.action_log[0].action_type, "thinking");
        assert_eq!(record.action_log[1].action_type, "text");
        assert_eq!(record.action_log[2].action_type, "tool_call");
        assert_eq!(record.action_log[0].energy_before, 100);
        assert_eq!(record.action_log[0].energy_after, 98);
    }

    #[test]
    fn build_action_log_entry_creates_correct_entry() {
        use crate::agent::api::ContentBlock;

        let block = ContentBlock {
            block_type: "thinking".to_string(),
            text: Some("让我分析一下当前的情况...".to_string()),
            tool_use: None,
        };

        let entry = super::build_action_log_entry(1, &block, 100, 98);

        assert_eq!(entry.action_type, "thinking");
        assert!(entry.description.contains("Agent 思考"));
        assert!(entry.description.contains("让我分析一下"));
        assert_eq!(entry.tick, 1);
        assert_eq!(entry.energy_before, 100);
        assert_eq!(entry.energy_after, 98);
    }

    #[test]
    fn build_action_log_entry_tool_use() {
        use crate::agent::api::ContentBlock;
        use crate::agent::tools::ToolUse;

        let block = ContentBlock {
            block_type: "tool_use".to_string(),
            text: None,
            tool_use: Some(ToolUse {
                id: "call_1".to_string(),
                name: "submit_timeblock_summary".to_string(),
                input: json!({"narrative": "test"}),
            }),
        };

        let entry = super::build_action_log_entry(2, &block, 98, 97);

        assert_eq!(entry.action_type, "tool_call");
        assert!(entry.description.contains("submit_timeblock_summary"));
        assert_eq!(entry.tick, 2);
    }

    #[test]
    fn count_effective_chars_excludes_whitespace_and_punctuation() {
        assert_eq!(super::count_effective_chars("Hello World!"), 10); // "HelloWorld" = 10
        assert_eq!(super::count_effective_chars("你好世界"), 4); // "你好世界" = 4
        assert_eq!(super::count_effective_chars("abc 123 !@#"), 6); // "abc123" = 6
        assert_eq!(super::count_effective_chars(""), 0);
        assert_eq!(super::count_effective_chars("   "), 0);
    }

    #[test]
    fn is_user_input_checks_metadata_source() {
        use crate::eventlog::EventRecord;
        use serde_json::json;

        // System event (exomind-runtime)
        let system_event = EventRecord {
            id: "1".to_string(),
            timestamp: 1000,
            content: "test".to_string(),
            tags: vec![],
            refs: vec![],
            metadata: Some(json!({
                "source": { "app": "exomind-runtime" }
            })),
        };
        assert!(!super::is_user_input(&system_event));

        // User event (other app)
        let user_event = EventRecord {
            id: "2".to_string(),
            timestamp: 1000,
            content: "test".to_string(),
            tags: vec![],
            refs: vec![],
            metadata: Some(json!({
                "source": { "app": "ExoMind" }
            })),
        };
        assert!(super::is_user_input(&user_event));

        // Event with user_input tag
        let tagged_event = EventRecord {
            id: "3".to_string(),
            timestamp: 1000,
            content: "test".to_string(),
            tags: vec!["user_input".to_string()],
            refs: vec![],
            metadata: None,
        };
        assert!(super::is_user_input(&tagged_event));
    }

    #[test]
    fn calculate_event_energy_gain_formula() {
        use crate::eventlog::EventRecord;
        use serde_json::json;

        let events = vec![
            EventRecord {
                id: "1".to_string(),
                timestamp: 1000,
                content: "系统事件".to_string(),
                tags: vec!["block_start".to_string()],
                refs: vec![],
                metadata: Some(json!({ "source": { "app": "exomind-runtime" } })),
            },
            EventRecord {
                id: "2".to_string(),
                timestamp: 2000,
                content: "用户输入了100个有效字符".to_string(),
                tags: vec![],
                refs: vec![],
                metadata: Some(json!({ "source": { "app": "ExoMind" } })),
            },
        ];

        // event_count = 2
        // user_char_count = count_effective_chars("用户输入了100个有效字符") = 12
        // energy_gain = ceil(2 + 12/100) = ceil(2.12) = 3
        let gain = super::calculate_event_energy_gain(&events);
        assert_eq!(gain, 3);
    }
}
