use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::task::JoinHandle;

use crate::agent::AgentRegistry;
use crate::energy::{AgentEnergy, EnergyRegistry};
use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// Spawn a tick loop for a single agent.
///
/// The loop:
/// 1. Sleep for adjusted interval (based on energy ratio)
/// 2. Consume tick_cost energy
/// 3. Call agent.on_tick()
/// 4. Publish returned signals + agent.tick meta-signal
/// 5. If energy == 0, publish agent.dormant and stop
pub fn spawn_agent_tick(
    agent_id: String,
    base_interval_secs: u64,
    energy: Arc<AgentEnergy>,
    signal_pool: Arc<SignalPool>,
    registry: AgentRegistry,
    host_id: String,
    cancel: Arc<AtomicBool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick_count: u64 = 0;

        loop {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // 1. Sleep with adjusted interval
            let interval = energy.adjusted_tick_interval(base_interval_secs);
            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // 2. Consume energy
            if !energy.consume(energy.tick_cost()) {
                // Already dormant — publish and stop
                publish_dormant(&agent_id, tick_count, &signal_pool, &host_id);
                break;
            }

            tick_count += 1;

            // 3. Snapshot energy state and call agent.on_tick(energy)
            let snapshot = energy.snapshot(&agent_id);
            let tick_signals = if let Some(agent) = registry.get(&agent_id) {
                agent.on_tick(&snapshot).await
            } else {
                break;
            };

            // 4. Publish agent's signals
            for signal in tick_signals {
                signal_pool.publish(signal);
            }

            // 5. Publish agent.tick meta-signal
            let tick_event = SignalEvent {
                schema_version: 1,
                id: uuid::Uuid::new_v4().to_string(),
                topic: "agent.tick".to_string(),
                ts: chrono::Utc::now().timestamp_millis() as u64,
                source: "rt:tick-scheduler".to_string(),
                origin_host_id: host_id.clone(),
                hop: 0,
                trace_id: None,
                payload: serde_json::json!({
                    "agent_id": agent_id,
                    "tick_count": tick_count,
                    "energy": {
                        "current": snapshot.current,
                        "max": snapshot.max,
                        "ratio": snapshot.ratio,
                    },
                    "tick_interval_secs": interval,
                    "phase": snapshot.phase,
                }),
            };
            signal_pool.publish(tick_event);

            // 6. Check dormant
            if energy.is_dormant() {
                publish_dormant(&agent_id, tick_count, &signal_pool, &host_id);
                break;
            }
        }
    })
}

fn publish_dormant(
    agent_id: &str,
    total_ticks: u64,
    signal_pool: &SignalPool,
    host_id: &str,
) {
    let event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "agent.dormant".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "rt:tick-scheduler".to_string(),
        origin_host_id: host_id.to_string(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({
            "agent_id": agent_id,
            "total_ticks": total_ticks,
            "cause": "energy_depleted",
        }),
    };
    signal_pool.publish(event);
}

/// Start tick loops for all agents with tick_interval_secs > 0.
pub fn start_all_ticks(
    registry: &AgentRegistry,
    energy_registry: &EnergyRegistry,
    signal_pool: &Arc<SignalPool>,
    host_id: &str,
    cancel: Arc<AtomicBool>,
) -> Vec<JoinHandle<()>> {
    let mut handles = Vec::new();

    for summary in registry.list() {
        if summary.tick_interval_secs == 0 {
            continue;
        }

        let Some(energy) = energy_registry.get(&summary.id) else {
            continue;
        };

        let handle = spawn_agent_tick(
            summary.id.clone(),
            summary.tick_interval_secs,
            energy,
            Arc::clone(signal_pool),
            registry.clone(),
            host_id.to_string(),
            Arc::clone(&cancel),
        );

        handles.push(handle);
    }

    handles
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Agent, AgentRegistry, ChatChunk, ChatRequest};
    use crate::energy::{AgentEnergy, AgentEnergySnapshot};
    use futures_util::stream::{self, BoxStream, StreamExt};
    use futures_util::future::BoxFuture;

    struct TickTestAgent;

    impl Agent for TickTestAgent {
        fn id(&self) -> &str { "tick-test" }
        fn name(&self) -> &str { "Tick Test" }
        fn description(&self) -> &str { "Test agent for tick" }
        fn chat_stream(&self, _req: ChatRequest) -> BoxStream<'static, ChatChunk> {
            stream::empty().boxed()
        }
        fn tick_interval_secs(&self) -> u64 { 1 }
        fn on_tick(&self, _energy: &AgentEnergySnapshot) -> BoxFuture<'_, Vec<SignalEvent>> {
            Box::pin(async { Vec::new() })
        }
    }

    #[tokio::test]
    async fn tick_loop_publishes_signals_and_stops_on_energy_depletion() {
        let registry = AgentRegistry::new();
        registry.register(Arc::new(TickTestAgent));

        let energy_registry = EnergyRegistry::new();
        // 30 energy, 10 per tick → 3 ticks then dormant
        energy_registry.register("tick-test", AgentEnergy::new(30, 10));

        let signal_pool = Arc::new(SignalPool::new(None));
        let mut rx = signal_pool.subscribe();
        let cancel = Arc::new(AtomicBool::new(false));

        let handles = start_all_ticks(
            &registry,
            &energy_registry,
            &signal_pool,
            "test-host",
            cancel,
        );
        assert_eq!(handles.len(), 1);

        // Collect signals with timeout
        let mut tick_signals = Vec::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);

        loop {
            let timeout = tokio::time::timeout_at(deadline, rx.recv()).await;
            match timeout {
                Ok(Ok(event)) => {
                    tick_signals.push(event);
                    if tick_signals.iter().any(|e: &SignalEvent| e.topic == "agent.dormant") {
                        break;
                    }
                }
                _ => break,
            }
        }

        let tick_count = tick_signals.iter().filter(|e| e.topic == "agent.tick").count();
        let dormant_count = tick_signals.iter().filter(|e| e.topic == "agent.dormant").count();

        assert_eq!(tick_count, 3, "should have 3 tick signals");
        assert_eq!(dormant_count, 1, "should have 1 dormant signal");

        let energy = energy_registry.get("tick-test").unwrap();
        assert!(energy.is_dormant());
    }
}
