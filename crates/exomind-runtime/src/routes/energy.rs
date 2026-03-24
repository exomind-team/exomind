use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::energy::AgentEnergySnapshot;
use crate::signal::types::SignalEvent;

#[derive(Debug, Deserialize)]
struct RefillEnergyRequest {
    amount: Option<u64>,
}

#[derive(Debug, Serialize)]
struct RefillEnergyResponse {
    energy: AgentEnergySnapshot,
    revived: bool,
    tick_spawned: bool,
}

/// GET /agents/:id/energy
async fn get_agent_energy(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<AgentEnergySnapshot>, StatusCode> {
    let energy = state
        .energy_registry
        .get(&id)
        .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(energy.snapshot(&id)))
}

/// GET /energy — all agent energy snapshots
async fn list_energy(State(state): State<AppState>) -> Json<Vec<AgentEnergySnapshot>> {
    Json(state.energy_registry.all_snapshots())
}

/// POST /agents/:id/energy/refill
async fn refill_agent_energy(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(request): Json<RefillEnergyRequest>,
) -> Result<Json<RefillEnergyResponse>, StatusCode> {
    let energy = state
        .energy_registry
        .get(&id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let was_dormant = energy.is_dormant();
    let refill_amount = request.amount.unwrap_or_else(|| energy.max());
    energy.refill(refill_amount);
    let snapshot = energy.snapshot(&id);

    let revived = was_dormant && !snapshot.is_dormant;
    let tick_spawned = if revived {
        let spawned = state.tick_manager.spawn_tick_for_agent(&id);
        state.signal_pool.publish(SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "agent.revived".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "rt:energy-refill".to_string(),
            origin_host_id: state.host_id.clone(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({
                "agent_id": id,
                "amount": refill_amount,
                "energy": {
                    "current": snapshot.current,
                    "max": snapshot.max,
                    "ratio": snapshot.ratio,
                    "phase": snapshot.phase,
                },
                "tick_spawned": spawned,
            }),
        });
        spawned
    } else {
        false
    };

    Ok(Json(RefillEnergyResponse {
        energy: snapshot,
        revived,
        tick_spawned,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/energy", get(list_energy))
        .route("/agents/:id/energy", get(get_agent_energy))
        .route("/agents/:id/energy/refill", post(refill_agent_energy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Agent, ChatChunk, ChatRequest};
    use crate::energy::{AgentEnergy, EnergyRegistry};
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use futures_util::future::BoxFuture;
    use futures_util::stream::{self, BoxStream, StreamExt};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tower::util::ServiceExt;

    struct ReviveTickAgent;

    impl Agent for ReviveTickAgent {
        fn id(&self) -> &str {
            "revive-test"
        }
        fn name(&self) -> &str {
            "Revive Test"
        }
        fn description(&self) -> &str {
            "Route refill revive test agent"
        }
        fn chat_stream(&self, _request: ChatRequest) -> BoxStream<'static, ChatChunk> {
            stream::empty().boxed()
        }
        fn tick_interval_secs(&self) -> u64 {
            1
        }
        fn on_tick(
            &self,
            _energy: &crate::energy::AgentEnergySnapshot,
        ) -> BoxFuture<'_, Vec<SignalEvent>> {
            Box::pin(async { Vec::new() })
        }
    }

    fn test_state() -> AppState {
        let mut state =
            AppState::new_runtime(0, "energy-test".to_string(), None, None, false, None);
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "energy-test".to_string();
        let energy_registry = EnergyRegistry::new();
        energy_registry.register("heartbeat", AgentEnergy::new(1000, 10));
        state.host_id = host_id.clone();
        state.registry = crate::agent::AgentRegistry::new();
        state.signal_pool = Arc::clone(&signal_pool);
        state.mesh = Arc::new(crate::mesh::MeshState::new(
            host_id.clone(),
            Arc::clone(&signal_pool),
            None,
        ));
        state.energy_registry = energy_registry;
        state.tick_manager = Arc::new(crate::tick::TickManager::new(
            host_id,
            state.registry.clone(),
            state.energy_registry.clone(),
            Arc::clone(&signal_pool),
        ));
        state
    }

    #[tokio::test]
    async fn get_agent_energy_returns_snapshot() {
        let state = test_state();
        let app = router().with_state(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/agents/heartbeat/energy")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let snap: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snap["agent_id"], "heartbeat");
        assert_eq!(snap["current"], 1000);
        assert_eq!(snap["max"], 1000);
        assert_eq!(snap["phase"], "normal");
        assert_eq!(snap["is_dormant"], false);
    }

    #[tokio::test]
    async fn get_unknown_agent_returns_404() {
        let state = test_state();
        let app = router().with_state(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/agents/unknown/energy")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn list_energy_returns_all_snapshots() {
        let state = test_state();
        let app = router().with_state(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/energy")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let snapshots: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0]["agent_id"], "heartbeat");
    }

    #[tokio::test]
    async fn refill_unknown_agent_returns_404() {
        let state = test_state();
        let app = router().with_state(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/unknown/energy/refill")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({ "amount": 10 }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn refill_revives_dormant_agent_and_restarts_tick() {
        let state = test_state();
        state.registry.register(Arc::new(ReviveTickAgent));
        state
            .energy_registry
            .register("revive-test", AgentEnergy::new(10, 10));

        let mut rx = state.signal_pool.subscribe();
        assert_eq!(state.tick_manager.start_all_ticks(), 1);

        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let event = rx.recv().await.expect("should receive dormant signal");
                if event.topic == "agent.dormant" && event.payload["agent_id"] == "revive-test" {
                    break;
                }
            }
        })
        .await
        .expect("agent should become dormant before refill");

        assert!(
            state
                .energy_registry
                .get("revive-test")
                .unwrap()
                .is_dormant(),
            "agent should be dormant before refill"
        );

        let app = router().with_state(state.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/revive-test/energy/refill")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::json!({ "amount": 10 }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["revived"], true);
        assert_eq!(payload["tick_spawned"], true);
        assert_eq!(payload["energy"]["phase"], "normal");

        let mut saw_revived = false;
        let mut saw_tick_after_refill = false;
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !saw_revived || !saw_tick_after_refill {
                let event = rx.recv().await.expect("should receive revive/tick signals");
                if event.topic == "agent.revived" && event.payload["agent_id"] == "revive-test" {
                    saw_revived = true;
                }
                if event.topic == "agent.tick" && event.payload["agent_id"] == "revive-test" {
                    saw_tick_after_refill = true;
                }
            }
        })
        .await
        .expect("refill should publish revived and restart tick");

        state.tick_manager.stop_all().await;
    }
}
