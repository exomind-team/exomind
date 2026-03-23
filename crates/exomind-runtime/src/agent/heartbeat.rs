use futures_util::future::BoxFuture;
use futures_util::stream::{self, BoxStream, StreamExt};

use super::{Agent, ChatChunk, ChatRequest};
use crate::energy::AgentEnergySnapshot;
use crate::signal::types::SignalEvent;

/// A minimal demo agent that has a heartbeat tick.
/// 用于演示：Agent 自主心跳 → 能量消耗 → 降频 → dormant。
pub struct HeartbeatAgent {
    id: String,
}

impl HeartbeatAgent {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }

    /// Generate a self-reflection message based on current energy state.
    fn reflect_on_energy(energy: &AgentEnergySnapshot) -> String {
        let percent = (energy.ratio * 100.0).round() as u64;
        match energy.phase.as_str() {
            "normal" => format!(
                "💓 我感觉充满活力。能量 {}/{} ({}%)，一切正常运转。",
                energy.current, energy.max, percent
            ),
            "slowing" => format!(
                "💛 我开始感到一点疲惫，节奏放缓了。能量 {}/{} ({}%)。",
                energy.current, energy.max, percent
            ),
            "critical" => format!(
                "🧡 能量不太够了，我得省着用。能量 {}/{} ({}%)。",
                energy.current, energy.max, percent
            ),
            "dying" => format!(
                "❤️‍🩹 我快撑不住了……能量 {}/{} ({}%)，可能要休眠了。",
                energy.current, energy.max, percent
            ),
            "dormant" => "🩶 我已进入休眠，等待外部补充能量。".to_string(),
            _ => format!(
                "心跳 — 能量 {}/{} ({}%)",
                energy.current, energy.max, percent
            ),
        }
    }
}

impl Agent for HeartbeatAgent {
    fn id(&self) -> &str {
        &self.id
    }
    fn name(&self) -> &str {
        "Heartbeat Agent"
    }
    fn description(&self) -> &str {
        "最小生命体 — 心跳、能量消耗、降频、可死亡"
    }

    fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
        stream::iter(vec![ChatChunk::content_only(
            "我是心跳 Agent，一个最小的生命体。我每隔一段时间自主心跳，消耗能量，能量耗尽就会休眠。\n请观察我的能量和 tick 信号。",
        )]).boxed()
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![]
    }

    fn publications(&self) -> Vec<String> {
        vec!["heartbeat.pulse".to_string()]
    }

    fn tick_interval_secs(&self) -> u64 {
        300
    }

    fn on_tick(&self, energy: &AgentEnergySnapshot) -> BoxFuture<'_, Vec<SignalEvent>> {
        let agent_id = self.id.clone();
        let message = Self::reflect_on_energy(energy);
        let energy_snapshot = serde_json::json!({
            "current": energy.current,
            "max": energy.max,
            "ratio": energy.ratio,
            "phase": energy.phase,
            "tick_cost": energy.tick_cost,
        });

        Box::pin(async move {
            vec![SignalEvent {
                schema_version: 1,
                id: uuid::Uuid::new_v4().to_string(),
                topic: "heartbeat.pulse".to_string(),
                ts: chrono::Utc::now().timestamp_millis() as u64,
                source: format!("agent:{agent_id}"),
                origin_host_id: String::new(),
                hop: 0,
                trace_id: None,
                payload: serde_json::json!({
                    "agent_id": agent_id,
                    "message": message,
                    "energy": energy_snapshot,
                }),
            }]
        })
    }
}
