use std::sync::Arc;

use tracing::warn;

use crate::agent::AgentRegistry;
use crate::signal::SignalPool;
use crate::signal::types::{SignalEvent, TargetType};

const MAX_SIGNAL_HOP: u8 = 5;

/// Spawn the Signal Dispatcher actor.
/// Signal Dispatcher（信号分发 Actor）负责把 Agent 目标路由真正落到 `agent.on_signal()`。
pub fn spawn_signal_dispatcher_actor(
    pool: Arc<SignalPool>,
    registry: AgentRegistry,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    dispatch_signal_event(&pool, &registry, &event).await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        skipped,
                        "signal_dispatcher_actor: broadcast receiver lagged, skipped {skipped} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("signal_dispatcher_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

async fn dispatch_signal_event(pool: &SignalPool, registry: &AgentRegistry, event: &SignalEvent) {
    if event.hop >= MAX_SIGNAL_HOP {
        return;
    }

    let matched_routes = pool
        .routes()
        .match_routes(&event.topic)
        .into_iter()
        .filter(|route| route.target_type == TargetType::Agent)
        .collect::<Vec<_>>();

    for route in matched_routes {
        let Some(agent) = registry.get(&route.target_ref) else {
            continue;
        };

        let outbound = agent.on_signal(event.clone()).await;
        let next_hop = event.hop.saturating_add(1);

        for mut response in outbound {
            if response.hop < next_hop {
                response.hop = next_hop;
            }
            if response.trace_id.is_none() {
                response.trace_id = event.trace_id.clone();
            }
            if response.origin_host_id.is_empty() {
                response.origin_host_id = event.origin_host_id.clone();
            }
            pool.publish(response);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Agent, ChatChunk, ChatRequest};
    use crate::signal::SignalRoute;
    use futures_util::future::BoxFuture;
    use futures_util::stream::{self, BoxStream, StreamExt};
    use serde_json::json;
    use tokio::sync::Mutex;

    struct EmitterAgent;

    impl Agent for EmitterAgent {
        fn id(&self) -> &str {
            "agent-a"
        }
        fn name(&self) -> &str {
            "Agent A"
        }
        fn description(&self) -> &str {
            "Emitter test agent"
        }
        fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
            stream::empty().boxed()
        }
        fn on_signal(&self, event: SignalEvent) -> BoxFuture<'_, Vec<SignalEvent>> {
            Box::pin(async move {
                vec![SignalEvent {
                    schema_version: 1,
                    id: uuid::Uuid::new_v4().to_string(),
                    topic: "signal.pong".to_string(),
                    ts: chrono::Utc::now().timestamp_millis() as u64,
                    source: "agent:agent-a".to_string(),
                    origin_host_id: event.origin_host_id.clone(),
                    hop: 0,
                    trace_id: None,
                    payload: json!({
                        "from": "agent-a",
                        "received_topic": event.topic,
                    }),
                }]
            })
        }
    }

    struct ReceiverAgent {
        received: Arc<Mutex<Vec<SignalEvent>>>,
    }

    impl Agent for ReceiverAgent {
        fn id(&self) -> &str {
            "agent-b"
        }
        fn name(&self) -> &str {
            "Agent B"
        }
        fn description(&self) -> &str {
            "Receiver test agent"
        }
        fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
            stream::empty().boxed()
        }
        fn on_signal(&self, event: SignalEvent) -> BoxFuture<'_, Vec<SignalEvent>> {
            let received = Arc::clone(&self.received);
            Box::pin(async move {
                received.lock().await.push(event);
                Vec::new()
            })
        }
    }

    fn add_agent_route(pool: &SignalPool, topic: &str, target_ref: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        pool.routes()
            .add(SignalRoute {
                id: uuid::Uuid::new_v4().to_string(),
                enabled: true,
                topic: topic.to_string(),
                target_type: TargetType::Agent,
                target_ref: target_ref.to_string(),
                created_at: now.clone(),
                updated_at: now,
            })
            .unwrap();
    }

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn dispatcher_routes_agent_output_to_next_agent() {
        let pool = Arc::new(SignalPool::new(None));
        let registry = AgentRegistry::new();
        let receiver_events = Arc::new(Mutex::new(Vec::new()));

        registry.register(Arc::new(EmitterAgent));
        registry.register(Arc::new(ReceiverAgent {
            received: Arc::clone(&receiver_events),
        }));

        add_agent_route(&pool, "signal.ping", "agent-a");
        add_agent_route(&pool, "signal.pong", "agent-b");

        let _handle = spawn_signal_dispatcher_actor(Arc::clone(&pool), registry);
        yield_for_actor().await;

        pool.publish(SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "signal.ping".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "agent:test".to_string(),
            origin_host_id: "dispatcher-test".to_string(),
            hop: 0,
            trace_id: Some("trace-dispatch".to_string()),
            payload: json!({ "text": "hello" }),
        });

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if receiver_events.lock().await.len() == 1 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("agent-b should receive forwarded signal");

        let received = receiver_events.lock().await;
        assert_eq!(received.len(), 1);
        assert_eq!(received[0].topic, "signal.pong");
        assert_eq!(received[0].hop, 1);
        assert_eq!(received[0].trace_id.as_deref(), Some("trace-dispatch"));
        assert_eq!(received[0].payload["received_topic"], "signal.ping");
    }

    #[tokio::test]
    async fn dispatcher_stops_forwarding_when_hop_reaches_limit() {
        let pool = Arc::new(SignalPool::new(None));
        let registry = AgentRegistry::new();
        let receiver_events = Arc::new(Mutex::new(Vec::new()));

        registry.register(Arc::new(EmitterAgent));
        registry.register(Arc::new(ReceiverAgent {
            received: Arc::clone(&receiver_events),
        }));

        add_agent_route(&pool, "signal.ping", "agent-a");
        add_agent_route(&pool, "signal.pong", "agent-b");

        let _handle = spawn_signal_dispatcher_actor(Arc::clone(&pool), registry);
        yield_for_actor().await;

        pool.publish(SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "signal.ping".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "agent:test".to_string(),
            origin_host_id: "dispatcher-test".to_string(),
            hop: MAX_SIGNAL_HOP,
            trace_id: Some("trace-limit".to_string()),
            payload: json!({ "text": "blocked" }),
        });

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert!(receiver_events.lock().await.is_empty());
    }
}
