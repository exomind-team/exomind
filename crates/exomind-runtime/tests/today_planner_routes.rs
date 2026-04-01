use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use exomind_runtime::AppState;
use exomind_runtime::mesh::MeshState;
use exomind_runtime::routes;
use exomind_runtime::signal::SignalPool;
use exomind_runtime::timeblock::{ActiveBlockData, TimeBlockStore};
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
        allow_lan_without_auth: false,
        mdns: None,
        pairing: Arc::new(exomind_runtime::pairing::PairingManager::new()),
        config_store: Arc::new(exomind_runtime::config::ConfigStore::new()),
        reminder_store: Arc::new(exomind_runtime::reminder::ReminderStore::new()),
        task_store: Arc::new(exomind_runtime::task::TaskStore::new()),
        proposal_store: Arc::new(exomind_runtime::proposal::ProposalStore::new()),
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
async fn today_planner_windows_create_start_and_reflow() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("today-planner.sqlite");
    let store = Arc::new(TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/act/today-planner/windows?user_id=user-a")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "date": "2026-03-27",
                        "title": "Morning Focus",
                        "plannedStartAt": 1_774_573_600_000u64,
                        "plannedEndAt": 1_774_577_200_000u64,
                        "rhythmPresetKey": "pomodoro_25_5",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let create_body_text = String::from_utf8(create_body.to_vec()).unwrap();
    assert_eq!(create_body_text.matches("\"segments\"").count(), 1);
    let create_payload: Value = serde_json::from_str(&create_body_text).unwrap();
    let window_id = create_payload["id"].as_str().unwrap().to_string();
    assert_eq!(create_payload["date"], "2026-03-27");
    assert_eq!(create_payload["segments"].as_array().unwrap().len(), 3);

    let work_segment_id = create_payload["segments"][0]["id"].as_str().unwrap().to_string();
    let break_segment_id = create_payload["segments"][1]["id"].as_str().unwrap().to_string();

    let update_segment_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(&format!(
                    "/act/today-planner/segments/{work_segment_id}?user_id=user-a"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Deep Work A",
                        "linkedTaskIds": ["task-a", "task-b"],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update_segment_response.status(), StatusCode::OK);
    let update_segment_body = update_segment_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let update_segment_payload: Value = serde_json::from_slice(&update_segment_body).unwrap();
    assert_eq!(update_segment_payload["title"], "Deep Work A");
    assert_eq!(update_segment_payload["linkedTaskIds"], json!(["task-a", "task-b"]));

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!(
                    "/act/today-planner/segments/{work_segment_id}/start?user_id=user-a"
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
    assert_eq!(start_payload["sourcePlannedBlockId"], work_segment_id);
    assert_eq!(start_payload["taskIds"], json!(["task-a", "task-b"]));

    let reflow_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!(
                    "/act/today-planner/windows/{window_id}/reflow?user_id=user-a"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "anchorSegmentId": work_segment_id,
                        "actualEndAt": 1_774_575_300_000u64,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reflow_response.status(), StatusCode::OK);
    let reflow_body = reflow_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let reflow_payload: Value = serde_json::from_slice(&reflow_body).unwrap();
    assert_eq!(reflow_payload["id"], window_id);
    assert_eq!(reflow_payload["segments"][0]["plannedEndAt"], json!(1_774_575_300_000u64));
    assert_eq!(reflow_payload["segments"][1]["id"], break_segment_id);
    assert_eq!(reflow_payload["segments"][1]["plannedStartAt"], json!(1_774_575_300_000u64));

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/act/today-planner?date=2026-03-27&user_id=user-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = list_response.into_body().collect().await.unwrap().to_bytes();
    let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_payload["date"], "2026-03-27");
    assert_eq!(list_payload["windows"][0]["id"], window_id);
    assert_eq!(list_payload["windows"][0]["segments"][0]["status"], "active");
}

#[tokio::test]
async fn today_planner_work_segment_inherits_window_title_before_edit() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("today-planner-title.sqlite");
    let store = Arc::new(TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/act/today-planner/windows?user_id=user-a")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "date": "2026-03-27",
                        "title": "Morning Focus",
                        "plannedStartAt": 1_774_573_600_000u64,
                        "plannedEndAt": 1_774_577_200_000u64,
                        "rhythmPresetKey": "pomodoro_25_5",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let create_payload: Value = serde_json::from_slice(&create_body).unwrap();
    let work_segment_id = create_payload["segments"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(create_payload["segments"][0]["title"], "Morning Focus");

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!(
                    "/act/today-planner/segments/{work_segment_id}/start?user_id=user-a"
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
    assert_eq!(start_payload["name"], "Morning Focus");
}

#[tokio::test]
async fn today_planner_start_conflicts_while_feedback_is_still_in_progress() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("today-planner-feedback-conflict.sqlite");
    let store = Arc::new(TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
    let app = test_router(test_state_with_timeblock_store(Arc::clone(&store)));

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/act/today-planner/windows?user_id=user-a")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "date": "2026-03-27",
                        "title": "Evening Focus",
                        "plannedStartAt": 1_774_624_000_000u64,
                        "plannedEndAt": 1_774_627_600_000u64,
                        "rhythmPresetKey": "pomodoro_25_5",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let create_payload: Value = serde_json::from_slice(&create_body).unwrap();
    let work_segment_id = create_payload["segments"][0]["id"].as_str().unwrap().to_string();

    store
        .put_active_scoped(
            Some("user-a"),
            ActiveBlockData {
                start_id: "active-feedback-pending".to_string(),
                name: "Pending Feedback".to_string(),
                mode: "countdown".to_string(),
                target_minutes: Some(25),
                elapsed: 25 * 60 * 1000,
                updated_at: Some(1_774_624_600_000u64),
                phase: Some("feedback_in_progress".to_string()),
                version: Some(3),
                actor_id: Some("test".to_string()),
                last_transition_at: Some(1_774_624_600_000u64),
                last_resumed_at: Some(1_774_624_000_000u64),
                accumulated_run_ms: Some(25 * 60 * 1000),
                start_time: 1_774_624_000_000u64,
                action_ended_at: Some(1_774_624_600_000u64),
                feedback_started_at: Some(1_774_624_600_000u64),
                feedback_submitted_at: None,
                pause_accumulated_ms: Some(0),
                paused: false,
                paused_at: None,
                task_ids: vec![],
                task_association_log: vec![],
                source_planned_block_id: Some("finished-segment".to_string()),
                task_id: None,
                    block_type: None,
                    transitions: vec![],
            },
        )
        .unwrap();

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!(
                    "/act/today-planner/segments/{work_segment_id}/start?user_id=user-a"
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(start_response.status(), StatusCode::CONFLICT);
}
