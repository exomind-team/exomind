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
async fn put_and_get_active_timeblock() {
    let dir = tempdir().unwrap();
    let store =
        Arc::new(TimeBlockStore::with_sqlite_path(&dir.path().join("timeblocks.sqlite")).unwrap());
    let app = test_router(test_state_with_timeblock_store(store));

    let payload = json!({
        "startId": "active-1",
        "name": "Focus",
        "mode": "countdown",
        "targetMinutes": 25,
        "elapsed": 120000,
        "updatedAt": 1700000010000u64,
        "phase": "running",
        "version": 1,
        "actorId": "actor-a",
        "lastTransitionAt": 1700000010000u64,
        "lastResumedAt": 1700000010000u64,
        "accumulatedRunMs": 0,
        "startTime": 1700000000000u64,
        "pauseAccumulatedMs": 0,
        "paused": false,
        "taskIds": ["task-1", "task-2"],
        "taskAssociationLog": [
            {
                "blockId": "active-1",
                "taskId": "task-1",
                "action": "associated",
                "timestamp": 1700000000000u64,
                "source": "block_start"
            },
            {
                "blockId": "active-1",
                "taskId": "task-2",
                "action": "associated",
                "timestamp": 1700000010000u64,
                "source": "manual"
            }
        ]
    });

    let put_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/timeblocks/active")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(put_response.status(), StatusCode::NO_CONTENT);

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
    assert_eq!(parsed["startId"], "active-1");
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
