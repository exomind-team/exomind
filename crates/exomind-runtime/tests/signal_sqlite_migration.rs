use exomind_runtime::signal::{SignalPool, SignalRoute, TargetType};
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

#[test]
fn migrates_legacy_route_json_into_sqlite() {
    let dir = temp_signal_dir("signal-sqlite-migration");
    let sqlite_path = dir.join("signal-pool.sqlite");
    let legacy_path = dir.join("routes.json");
    let legacy_route = make_route("legacy.topic", "legacy-agent");
    let legacy_route_id = legacy_route.id.clone();

    std::fs::write(
        &legacy_path,
        serde_json::to_string_pretty(&vec![legacy_route]).expect("legacy json should serialize"),
    )
    .expect("legacy route json should be written");

    let migrated = SignalPool::with_sqlite_path(None, &sqlite_path)
        .expect("sqlite-backed signal pool should initialize");
    assert!(migrated.routes().get_by_id(&legacy_route_id).is_some());
    drop(migrated);

    std::fs::remove_file(&legacy_path).expect("legacy json should be removed after migration test");
    let reopened = SignalPool::with_sqlite_path(None, &sqlite_path)
        .expect("sqlite-backed signal pool should reopen");
    let routes = reopened.routes().get_all();
    assert_eq!(
        routes
            .iter()
            .filter(|route| route.id == legacy_route_id)
            .count(),
        1
    );
    drop(reopened);

    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}
