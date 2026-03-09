use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};

use crate::energy::AgentEnergySnapshot;
use crate::AppState;

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
async fn list_energy(
    State(state): State<AppState>,
) -> Json<Vec<AgentEnergySnapshot>> {
    Json(state.energy_registry.all_snapshots())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/energy", get(list_energy))
        .route("/agents/:id/energy", get(get_agent_energy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::energy::{AgentEnergy, EnergyRegistry};
    use crate::signal::SignalPool;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tower::util::ServiceExt;

    fn test_state() -> AppState {
        let signal_pool = Arc::new(SignalPool::new(None));
        let host_id = "energy-test".to_string();
        let energy_registry = EnergyRegistry::new();
        energy_registry.register("heartbeat", AgentEnergy::new(1000, 10));
        AppState {
            port: 0,
            host_id: host_id.clone(),
            registry: crate::agent::AgentRegistry::new(),
            signal_pool: Arc::clone(&signal_pool),
            mesh: Arc::new(crate::mesh::MeshState::new(
                host_id,
                Arc::clone(&signal_pool),
                None,
            )),
            mesh_relay: None,
            auth_secret: None,
            mdns: None,
            pairing: Arc::new(crate::pairing::PairingManager::new()),
            task_store: Arc::new(crate::task::TaskStore::new()),
            energy_registry,
            eventlog_store: Arc::new(crate::eventlog::EventLogStore::new(
                std::env::temp_dir().join("exomind-test-energy"),
            )),
        }
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
}
