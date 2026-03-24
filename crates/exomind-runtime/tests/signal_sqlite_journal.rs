use exomind_runtime::signal::{
    DeliveryStatus, SignalEvent, SignalPool, SignalPoolSnapshot, SignalRoute, TargetType,
};
use std::path::PathBuf;

fn temp_signal_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("exomind-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir should be created");
    dir
}

fn make_route(topic: &str, target_ref: &str) -> SignalRoute {
    let now = chrono::Utc::now().to_rfc3339();
    SignalRoute {
        id: uuid::Uuid::new_v4().to_string(),
        enabled: true,
        topic: topic.to_string(),
        target_type: TargetType::Agent,
        target_ref: target_ref.to_string(),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn make_event(topic: &str) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "test".to_string(),
        origin_host_id: "rt-test".to_string(),
        hop: 0,
        trace_id: None,
        payload: serde_json::json!({"message": "hello sqlite"}),
    }
}

#[test]
fn persists_delivery_records_in_sqlite_after_publish() {
    let dir = temp_signal_dir("signal-sqlite-journal");
    let sqlite_path = dir.join("signal-pool.sqlite");

    let pool = SignalPool::with_sqlite_path(None, &sqlite_path)
        .expect("sqlite-backed signal pool should initialize");
    pool.routes()
        .add(make_route("user.input.text", "classifier"))
        .expect("route should persist");
    let _rx = pool.subscribe();

    let event = make_event("user.input.text");
    let event_id = event.id.clone();
    let records = pool.publish(event);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].status, DeliveryStatus::Sent);
    drop(pool);

    let reopened = SignalPool::with_sqlite_path(None, &sqlite_path)
        .expect("sqlite-backed signal pool should reopen");
    let journal = reopened.journal().recent(10);
    assert_eq!(journal.len(), 1);
    assert_eq!(journal[0].event_id, event_id);
    assert_eq!(journal[0].route_id, records[0].route_id);
    drop(reopened);

    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}

#[test]
fn exports_and_imports_signal_pool_snapshot() {
    let source_dir = temp_signal_dir("signal-sqlite-export-source");
    let source_sqlite = source_dir.join("signal-pool.sqlite");
    let source_pool = SignalPool::with_sqlite_path(None, &source_sqlite)
        .expect("source sqlite-backed signal pool should initialize");
    source_pool
        .routes()
        .add(make_route("knowledge.item.captured", "journal-agent"))
        .expect("source route should persist");
    let _rx = source_pool.subscribe();
    source_pool.publish(make_event("knowledge.item.captured"));

    let snapshot = source_pool
        .export_snapshot()
        .expect("sqlite-backed pool should export a snapshot");
    let serialized = serde_json::to_string_pretty(&snapshot).expect("snapshot should serialize");
    let round_tripped: SignalPoolSnapshot =
        serde_json::from_str(&serialized).expect("snapshot should deserialize");

    let target_dir = temp_signal_dir("signal-sqlite-export-target");
    let target_sqlite = target_dir.join("signal-pool.sqlite");
    let target_pool = SignalPool::with_sqlite_path(None, &target_sqlite)
        .expect("target sqlite-backed signal pool should initialize");
    target_pool
        .import_snapshot(round_tripped)
        .expect("sqlite-backed pool should import a snapshot");
    drop(target_pool);

    let reopened = SignalPool::with_sqlite_path(None, &target_sqlite)
        .expect("target sqlite-backed signal pool should reopen");
    assert_eq!(reopened.routes().get_all().len(), 1);
    assert_eq!(reopened.journal().recent(10).len(), 1);
    drop(reopened);
    drop(source_pool);

    std::fs::remove_dir_all(source_dir).expect("source temp dir should be removed");
    std::fs::remove_dir_all(target_dir).expect("target temp dir should be removed");
}
