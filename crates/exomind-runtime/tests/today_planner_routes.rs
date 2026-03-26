use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use exomind_runtime::AppState;
use exomind_runtime::mesh::MeshState;
use exomind_runtime::routes;
use exomind_runtime::signal::SignalPool;
use exomind_runtime::timeblock::TimeBlockStore;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::tempdir;
use tower::ServiceExt;

fn test_state_with_timeblock_store(timeblock_store: Arc<TimeBlockStore>) -> AppState {
    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "today-planner-test-host".to_string();
    let registry = exomind_runtime::agent::AgentRegistry::new();
    let energy_registry = exomind_runtime::energy::EnergyRegistry::new();
    AppState {
        port: 0,
        host_id: host_id.clone(),
        registry: registry.clone(),
        signal_pool: Arc::clone(&signal_pool),
        mesh: Arc::new(MeshState::new(
            host_id.clone(),
            Arc::clone(&signal_pool),
            None,
        )),
        mesh_relay: None,
        auth_secret: None,
        mdns: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        session_store: Arc::new(exomind_runtime::session::SessionStore::new()),
        session_event_tx: None,
        eventlog_watch_tx: {
            let (tx, _rx) = exomind_runtime::routes::eventlog::eventlog_watch_channel();
            tx
        },
        timeblock_store,
        energy_registry: energy_registry.clone(),
        tick_manager: Arc::new(exomind_runtime::tick::TickManager::new(
            host_id.clone(),
            registry,
            energy_registry,
            Arc::clone(&signal_pool),
        )),
        life_agents: std::collections::HashMap::new(),
        eventlog_store: Arc::new(exomind_runtime::eventlog::EventLogStore::new(
            std::env::temp_dir().join("exomind-test-today-planner"),
        )),
        #[cfg(not(target_os = "android"))]
        pty_manager: Arc::new(exomind_runtime::pty::PtyManager::new(
            Arc::clone(&signal_pool),
            host_id,
        )),
    }
}

fn test_router(state: AppState) -> Router {
    routes::router().with_state(state)
}

#[tokio::test]
async fn today_planner_routes_create_reorder_and_start_blocks() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("today-planner.sqlite");
    let store = Arc::new(TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let create_work_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/act/today-planner/blocks?user_id=user-a")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "date": "2026-03-26",
                        "type": "work",
                        "title": "Deep Work",
                        "plannedStartAt": 1774490400000u64,
                        "plannedDurationMinutes": 50,
                        "note": "ship vertical slice",
                        "linkedTaskIds": ["task-a"],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_work_response.status(), StatusCode::CREATED);
    let work_body = create_work_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let work_payload: Value = serde_json::from_slice(&work_body).unwrap();
    let work_id = work_payload["id"].as_str().unwrap().to_string();
    assert_eq!(work_payload["type"], "work");
    assert_eq!(work_payload["status"], "pending");

    let create_rest_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/act/today-planner/blocks?user_id=user-a")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "date": "2026-03-26",
                        "type": "rest",
                        "title": "Lunch Reset",
                        "plannedStartAt": 1774494000000u64,
                        "plannedDurationMinutes": 30,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_rest_response.status(), StatusCode::CREATED);
    let rest_body = create_rest_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let rest_payload: Value = serde_json::from_slice(&rest_body).unwrap();
    let rest_id = rest_payload["id"].as_str().unwrap().to_string();

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/act/today-planner?date=2026-03-26&user_id=user-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = list_response.into_body().collect().await.unwrap().to_bytes();
    let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_payload["date"], "2026-03-26");
    assert_eq!(list_payload["blocks"][0]["id"], work_id);
    assert_eq!(list_payload["blocks"][1]["id"], rest_id);

    let reorder_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/act/today-planner/blocks/reorder?user_id=user-a")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "date": "2026-03-26",
                        "orderedIds": [rest_id, work_id],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reorder_response.status(), StatusCode::OK);

    let update_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(&format!(
                    "/act/today-planner/blocks/{rest_id}?user_id=user-a"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Lunch + Walk",
                        "plannedDurationMinutes": 40,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update_response.status(), StatusCode::OK);
    let update_body = update_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let update_payload: Value = serde_json::from_slice(&update_body).unwrap();
    assert_eq!(update_payload["title"], "Lunch + Walk");
    assert_eq!(update_payload["plannedDurationMinutes"], 40);

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!(
                    "/act/today-planner/blocks/{rest_id}/start?user_id=user-a"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(start_response.status(), StatusCode::OK);
    let start_body = start_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let start_payload: Value = serde_json::from_slice(&start_body).unwrap();
    assert_eq!(start_payload["sourcePlannedBlockId"], rest_id);
    assert_eq!(start_payload["targetMinutes"], 40);

    let after_start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/act/today-planner?date=2026-03-26&user_id=user-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(after_start_response.status(), StatusCode::OK);
    let after_start_body = after_start_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let after_start_payload: Value = serde_json::from_slice(&after_start_body).unwrap();
    assert_eq!(after_start_payload["blocks"][0]["id"], rest_id);
    assert_eq!(after_start_payload["blocks"][0]["status"], "active");

    let delete_response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&format!(
                    "/act/today-planner/blocks/{work_id}?user_id=user-a"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
}
