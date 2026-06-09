use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::Engine as _;
use exomind_runtime::AppState;
use exomind_runtime::mesh::MeshState;
use exomind_runtime::routes::timeblocks;
use exomind_runtime::signal::SignalPool;
use exomind_runtime::timeblock::{TimeBlockData, TimeBlockStore};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::tempdir;
use tower::ServiceExt;

fn test_state_with_timeblock_store(timeblock_store: Arc<TimeBlockStore>) -> AppState {
    let signal_pool = Arc::new(SignalPool::new(None));
    let host_id = "timeblocks-test-host".to_string();
    let registry = exomind_runtime::agent::AgentRegistry::new();
    let energy_registry = exomind_runtime::energy::EnergyRegistry::new();
    AppState {
        port: 0,
        host_id: host_id.clone(),
        device_id: "dev-timeblocks-test-host".to_string(),
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
        agent_api_session_store: Arc::new(exomind_runtime::agent::session::AgentSessionStore::new()),
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
            std::env::temp_dir().join("exomind-test-timeblocks"),
        )),
        #[cfg(not(target_os = "android"))]
        pty_manager: Arc::new(exomind_runtime::pty::PtyManager::new(
            Arc::clone(&signal_pool),
            host_id,
        )),
    }
}

fn test_router(state: AppState) -> Router {
    timeblocks::router().with_state(state)
}

#[tokio::test]
async fn patches_and_gets_active_timeblock_task_links() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let app = test_router(test_state_with_timeblock_store(store.clone()));

    let start_payload = json!({
        "name": "Focus",
        "mode": "countdown",
        "targetMinutes": 25
    });

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/start")
                .header("content-type", "application/json")
                .body(Body::from(start_payload.to_string()))
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
    let start_parsed: Value = serde_json::from_slice(&start_body).unwrap();
    let start_id = start_parsed["active"]["startId"]
        .as_str()
        .expect("start route should return active.startId")
        .to_string();

    let patch_payload = json!({
        "taskIds": ["task-1", "task-2"],
        "taskAssociationLog": [
            {
                "blockId": start_id.as_str(),
                "taskId": "task-1",
                "action": "associated",
                "timestamp": 1700000000000u64,
                "source": "block_start"
            },
            {
                "blockId": start_id.as_str(),
                "taskId": "task-2",
                "action": "associated",
                "timestamp": 1700000010000u64,
                "source": "manual"
            }
        ]
    });

    let patch_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/timeblocks/active/tasks")
                .header("content-type", "application/json")
                .body(Body::from(patch_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(patch_response.status(), StatusCode::OK);
    let patch_body = patch_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let patch_parsed: Value = serde_json::from_slice(&patch_body).unwrap();
    assert_eq!(patch_parsed["taskIds"], json!(["task-1", "task-2"]));
    assert_eq!(
        patch_parsed["taskAssociationLog"]
            .as_array()
            .map(|items| items.len()),
        Some(2)
    );

    let get_response = app
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(get_response.status(), StatusCode::OK);
    let body = get_response.into_body().collect().await.unwrap().to_bytes();
    let parsed: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed["startId"], start_id);
    assert_eq!(parsed["mode"], "countdown");
    assert_eq!(parsed["taskIds"], json!(["task-1", "task-2"]));
    assert_eq!(
        parsed["taskAssociationLog"]
            .as_array()
            .map(|items| items.len()),
        Some(2)
    );
    assert!(
        parsed.get("taskId").is_none(),
        "legacy taskId should not be serialized"
    );
}

#[tokio::test]
async fn backfills_gap_blocks_via_route() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    store
        .replace_completed(&[
            TimeBlockData {
                id: "tb-1".to_string(),
                name: "A".to_string(),
                start_id: "s1".to_string(),
                end_id: "e1".to_string(),
                note: None,
                tags: vec![],
                start_time: 1_700_000_000_000,
                end_time: 1_700_000_600_000,
                task_ids: vec![],
                task_status_outcomes: None,
                task_association_log: vec![],
                source_planned_block_id: None,
                block_type: Some("active".to_string()),
                transitions: vec![],
            },
            TimeBlockData {
                id: "tb-2".to_string(),
                name: "B".to_string(),
                start_id: "s2".to_string(),
                end_id: "e2".to_string(),
                note: None,
                tags: vec![],
                start_time: 1_700_000_900_000,
                end_time: 1_700_001_200_000,
                task_ids: vec![],
                task_status_outcomes: None,
                task_association_log: vec![],
                source_planned_block_id: None,
                block_type: Some("active".to_string()),
                transitions: vec![],
            },
        ])
        .unwrap();
    let app = test_router(test_state_with_timeblock_store(store.clone()));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/backfill-gaps")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let parsed: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed["inserted"], 1);

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = list_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let list_parsed: Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_parsed.as_array().map(|items| items.len()), Some(3));
    let gap = list_parsed
        .as_array()
        .unwrap()
        .iter()
        .find(|block| block["blockType"] == "gap")
        .expect("gap block should be inserted");
    assert_eq!(gap["startTime"], 1_700_000_600_000u64);
    assert_eq!(gap["endTime"], 1_700_000_900_000u64);

    let second_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/backfill-gaps")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_response.status(), StatusCode::OK);
    let second_body = second_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let second_parsed: Value = serde_json::from_slice(&second_body).unwrap();
    assert_eq!(second_parsed["inserted"], 0);
}

#[tokio::test]
async fn patch_active_timeblock_tasks_returns_not_found_without_active_block() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/timeblocks/active/tasks")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "taskIds": ["task-1"],
                        "taskAssociationLog": []
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn legacy_put_timeblock_routes_return_method_not_allowed() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let put_completed = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/timeblocks")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(put_completed.status(), StatusCode::METHOD_NOT_ALLOWED);

    let put_active = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/timeblocks/active")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(put_active.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn timeblock_lifecycle_routes_cover_running_pause_feedback_and_gap() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let state = test_state_with_timeblock_store(store);
    let task = state
        .task_store
        .create(exomind_runtime::task::CreateTaskInput {
            title: "Lifecycle task".to_string(),
            description: None,
            done_condition: None,
            priority: None,
            tags: vec![],
            source: None,
            parent_id: None,
            depends_on: vec![],
            due_at: None,
            estimated_minutes: None,
            time_block_ids: vec![],
        });
    state
        .task_store
        .transition(&task.id, exomind_runtime::task::TaskStatus::InProgress)
        .unwrap();
    let app = test_router(state.clone());

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/start")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Lifecycle Focus",
                        "mode": "countdown",
                        "targetMinutes": 25,
                        "taskIds": [task.id],
                        "sourcePlannedBlockId": "plan-1"
                    })
                    .to_string(),
                ))
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
    let start_id = start_payload["active"]["startId"]
        .as_str()
        .expect("active startId should be present")
        .to_string();
    assert_eq!(start_payload["active"]["phase"], "running");
    assert_eq!(start_payload["active"]["taskIds"], json!([task.id]));
    assert_eq!(start_payload["active"]["sourcePlannedBlockId"], "plan-1");

    let pause_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/pause")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pause_response.status(), StatusCode::OK);

    let paused_active_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let paused_active_body = paused_active_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let paused_active: Value = serde_json::from_slice(&paused_active_body).unwrap();
    assert_eq!(paused_active["startId"], start_id);
    assert_eq!(paused_active["phase"], "paused");
    assert_eq!(paused_active["paused"], true);

    let resume_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/resume")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resume_response.status(), StatusCode::OK);

    let resumed_active_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let resumed_active_body = resumed_active_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let resumed_active: Value = serde_json::from_slice(&resumed_active_body).unwrap();
    assert_eq!(resumed_active["startId"], start_id);
    assert_eq!(resumed_active["phase"], "running");
    assert_eq!(resumed_active["paused"], false);

    let stop_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/stop")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stop_response.status(), StatusCode::OK);
    let stop_body = stop_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let stop_payload: Value = serde_json::from_slice(&stop_body).unwrap();
    assert_eq!(stop_payload["status"], "stopped");
    assert_eq!(stop_payload["phase"], "feedback_in_progress");

    let feedback_active_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let feedback_active_body = feedback_active_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let feedback_active: Value = serde_json::from_slice(&feedback_active_body).unwrap();
    assert_eq!(feedback_active["startId"], start_id);
    assert_eq!(feedback_active["phase"], "feedback_in_progress");
    assert!(feedback_active["feedbackStartedAt"].as_u64().is_some());

    let end_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/end")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "feedback": "done",
                        "taskStatusOutcomes": {
                            task.id.clone(): "completed"
                        }
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(end_response.status(), StatusCode::OK);
    let end_body = end_response.into_body().collect().await.unwrap().to_bytes();
    let end_payload: Value = serde_json::from_slice(&end_body).unwrap();
    assert_eq!(end_payload["completed"]["startId"], start_id);
    assert_eq!(end_payload["completed"]["note"], "done");
    assert_eq!(end_payload["completed"]["taskIds"], json!([task.id]));
    assert_eq!(
        end_payload["completed"]["taskStatusOutcomes"],
        json!({ task.id.clone(): "completed" })
    );
    assert_eq!(end_payload["completed"]["sourcePlannedBlockId"], "plan-1");
    assert_eq!(end_payload["active"]["blockType"], "gap");
    assert_eq!(end_payload["active"]["name"], "");

    let final_active_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let final_active_body = final_active_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let final_active: Value = serde_json::from_slice(&final_active_body).unwrap();
    assert_eq!(final_active["blockType"], "gap");

    let completed_blocks_response = app
        .oneshot(
            Request::builder()
                .uri("/timeblocks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let completed_blocks_body = completed_blocks_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let completed_blocks: Value = serde_json::from_slice(&completed_blocks_body).unwrap();
    let items = completed_blocks
        .as_array()
        .expect("completed timeblocks should be an array");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["startId"], start_id);
    assert_eq!(items[0]["name"], "Lifecycle Focus");
}

#[tokio::test]
async fn patch_active_tasks_returns_not_found_without_active_and_conflict_for_gap() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let missing_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/timeblocks/active/tasks")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "taskIds": ["task-1"],
                        "taskAssociationLog": []
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_response.status(), StatusCode::NOT_FOUND);

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/start")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Gap Patch Guard",
                        "mode": "countup"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(start_response.status(), StatusCode::OK);

    let stop_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/stop")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stop_response.status(), StatusCode::OK);

    let end_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/end")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "feedback": "done" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(end_response.status(), StatusCode::OK);

    let gap_patch_response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/timeblocks/active/tasks")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "taskIds": ["task-1"],
                        "taskAssociationLog": []
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(gap_patch_response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn describe_routes_update_active_and_completed_gap_but_keep_completed_active_immutable() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let app = test_router(test_state_with_timeblock_store(store.clone()));

    let start_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/start")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Describe Me",
                        "mode": "countup"
                    })
                    .to_string(),
                ))
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
    let active_id = start_payload["active"]["startId"]
        .as_str()
        .expect("active startId should be present")
        .to_string();

    let describe_current_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/describe")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "name": "Renamed Active" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(describe_current_response.status(), StatusCode::OK);

    let renamed_active_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let renamed_active_body = renamed_active_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let renamed_active: Value = serde_json::from_slice(&renamed_active_body).unwrap();
    assert_eq!(renamed_active["startId"], active_id);
    assert_eq!(renamed_active["name"], "Renamed Active");

    let stop_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/stop")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stop_response.status(), StatusCode::OK);

    let end_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/end")
                .header("content-type", "application/json")
                .body(Body::from(json!({ "feedback": "desc done" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(end_response.status(), StatusCode::OK);
    let end_body = end_response.into_body().collect().await.unwrap().to_bytes();
    let end_payload: Value = serde_json::from_slice(&end_body).unwrap();
    let gap_id = end_payload["active"]["startId"]
        .as_str()
        .expect("gap active startId should be present")
        .to_string();
    let completed_active_id = end_payload["completed"]["id"]
        .as_str()
        .expect("completed block id should be present")
        .to_string();

    let describe_gap_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/timeblocks/{gap_id}/describe"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Recovery Gap",
                        "note": "retro note"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(describe_gap_response.status(), StatusCode::OK);

    let active_gap_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let active_gap_body = active_gap_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let active_gap: Value = serde_json::from_slice(&active_gap_body).unwrap();
    assert_eq!(active_gap["startId"], gap_id);
    assert_eq!(active_gap["name"], "Recovery Gap");

    let describe_completed_active_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/timeblocks/{completed_active_id}/describe"))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "name": "Should Fail" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        describe_completed_active_response.status(),
        StatusCode::CONFLICT
    );

    let completed_gap = TimeBlockData {
        id: "gap-completed-1".to_string(),
        name: "".to_string(),
        start_id: "gap-start-1".to_string(),
        end_id: "gap-end-1".to_string(),
        note: None,
        tags: vec![],
        start_time: 10,
        end_time: 20,
        task_ids: vec![],
        task_status_outcomes: None,
        task_association_log: vec![],
        source_planned_block_id: None,
        block_type: Some("gap".to_string()),
        transitions: vec![],
    };
    store.replace_completed(&[completed_gap.clone()]).unwrap();

    let describe_completed_gap_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/gap-completed-1/describe")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Named Gap",
                        "note": "Gap note"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(describe_completed_gap_response.status(), StatusCode::OK);

    let completed_gap_response = app
        .oneshot(
            Request::builder()
                .uri("/timeblocks?block_type=gap")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(completed_gap_response.status(), StatusCode::OK);
    let completed_gap_body = completed_gap_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let completed_gap_payload: Value = serde_json::from_slice(&completed_gap_body).unwrap();
    let gap_items = completed_gap_payload
        .as_array()
        .expect("gap list should be an array");
    assert!(
        gap_items.iter().any(|item| item["id"] == "gap-completed-1"
            && item["name"] == "Named Gap"
            && item["note"] == "Gap note"),
        "completed gap should be renameable via describe route"
    );
}

#[tokio::test]
async fn exports_sqlite_snapshot_and_backend_status() {
    let dir = tempdir().unwrap();
    let sqlite_path = dir.path().join("timeblocks.sqlite");
    let store = Arc::new(TimeBlockStore::with_sqlite_path(&sqlite_path).unwrap());
    store
        .replace_completed(&[TimeBlockData {
            id: "tb-1".to_string(),
            name: "Done".to_string(),
            start_id: "start-1".to_string(),
            end_id: "end-1".to_string(),
            note: Some("ok".to_string()),
            tags: vec!["block_feedback".to_string()],
            start_time: 1700000000000,
            end_time: 1700000060000,
            task_ids: vec!["task-1".to_string()],
            task_status_outcomes: Some(std::collections::HashMap::from([(
                "task-1".to_string(),
                "completed".to_string(),
            )])),
            task_association_log: vec![exomind_runtime::timeblock::BlockTaskAssociationEvent {
                block_id: "tb-1".to_string(),
                task_id: "task-1".to_string(),
                action: "associated".to_string(),
                timestamp: 1700000000000,
                source: "block_start".to_string(),
            }],
            source_planned_block_id: None,
            block_type: None,
            transitions: vec![],
        }])
        .unwrap();
    let app = test_router(test_state_with_timeblock_store(store));

    let status_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks/backend/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(status_response.status(), StatusCode::OK);

    let export_response = app
        .oneshot(
            Request::builder()
                .uri("/timeblocks/backup/sqlite")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(export_response.status(), StatusCode::OK);
    let body = export_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let parsed: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed["version"], 1);
    assert_eq!(parsed["timeblock_count"], 1);
    assert!(
        parsed["content_base64"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(parsed["content_base64"].as_str().unwrap())
        .unwrap();
    let import_dir = tempdir().unwrap();
    let import_sqlite_path = import_dir.path().join("snapshot.sqlite");
    std::fs::write(&import_sqlite_path, bytes).unwrap();
    let imported_store = TimeBlockStore::with_sqlite_path(&import_sqlite_path).unwrap();
    assert_eq!(
        imported_store.len_completed().unwrap(),
        1,
        "sqlite snapshot should reopen with latest completed blocks"
    );
}

#[tokio::test]
async fn imports_json_backup_with_overwrite() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    store
        .replace_completed(&[TimeBlockData {
            id: "old-block".to_string(),
            name: "Old".to_string(),
            start_id: "old-start".to_string(),
            end_id: "old-end".to_string(),
            note: None,
            tags: vec!["block_feedback".to_string()],
            start_time: 1700000000000,
            end_time: 1700000060000,
            task_ids: vec![],
            task_status_outcomes: None,
            task_association_log: vec![],
            source_planned_block_id: None,
            block_type: None,
            transitions: vec![],
        }])
        .unwrap();

    let app = test_router(test_state_with_timeblock_store(store));
    let import_payload = json!({
        "version": 1,
        "time_blocks": [
            {
                "id": "new-block",
                "name": "New",
                "startId": "start-new",
                "endId": "end-new",
                "tags": ["block_feedback"],
                "startTime": 1700000100000u64,
                "endTime": 1700000160000u64,
                "taskIds": ["task-new"],
                "taskStatusOutcomes": { "task-new": "continue" },
                "taskAssociationLog": [{
                    "blockId": "new-block",
                    "taskId": "task-new",
                    "action": "associated",
                    "timestamp": 1700000100000u64,
                    "source": "block_start"
                }]
            }
        ],
        "active_block": {
            "startId": "active-new",
            "name": "Running",
            "mode": "countup",
            "elapsed": 30000,
            "paused": false,
            "startTime": 1700000200000u64,
            "taskId": "task-legacy",
            "taskIds": ["task-new"],
            "taskAssociationLog": [{
                "blockId": "active-new",
                "taskId": "task-new",
                "action": "associated",
                "timestamp": 1700000200000u64,
                "source": "block_start"
            }]
        }
    });

    let import_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/timeblocks/import/json?strategy=overwrite")
                .header("content-type", "application/json")
                .body(Body::from(import_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(import_response.status(), StatusCode::OK);

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/timeblocks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let list_body = list_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_payload.as_array().unwrap().len(), 1);
    assert_eq!(list_payload[0]["id"], "new-block");

    let active_response = app
        .oneshot(
            Request::builder()
                .uri("/timeblocks/active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let active_body = active_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let active_payload: Value = serde_json::from_slice(&active_body).unwrap();
    assert_eq!(active_payload["startId"], "active-new");
    assert_eq!(active_payload["taskIds"], json!(["task-new"]));
    assert!(active_payload.get("taskId").is_none());
}
