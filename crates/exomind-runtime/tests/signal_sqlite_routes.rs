use exomind_runtime::signal::{SignalPool, SignalRoute, TargetType};
use exomind_runtime::{RuntimeStartOptions, start_with_options};
use reqwest::Client;
use serde_json::json;
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
fn persists_user_routes_in_sqlite_after_restart() {
    let dir = temp_signal_dir("signal-sqlite-routes");
    let sqlite_path = dir.join("signal-pool.sqlite");

    let pool = SignalPool::with_sqlite_path(None, &sqlite_path);
    let route = make_route("user.input.text", "classifier");
    let route_id = route.id.clone();
    pool.routes().add(route);
    drop(pool);

    let reopened = SignalPool::with_sqlite_path(None, &sqlite_path);
    let persisted = reopened
        .routes()
        .get_by_id(&route_id)
        .expect("route should persist in sqlite after restart");
    assert_eq!(persisted.target_ref, "classifier");
    drop(reopened);

    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}

#[tokio::test]
async fn runtime_reuses_signal_sqlite_path_between_restarts() {
    let dir = temp_signal_dir("runtime-signal-sqlite-routes");
    let sqlite_path = dir.join("runtime-signal-pool.sqlite");
    let host_id = format!("rt-sqlite-{}", uuid::Uuid::new_v4());
    let options = RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id,
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        signal_storage_path: Some(sqlite_path.clone()),
        ..Default::default()
    };

    let client = Client::new();
    let mut runtime = start_with_options(options.clone())
        .await
        .expect("runtime should start with sqlite storage");
    let base_url = format!("http://127.0.0.1:{}", runtime.port());

    let created = client
        .post(format!("{base_url}/signal-routes"))
        .json(&json!({
            "topic": "runtime.route.created",
            "target_type": "agent",
            "target_ref": "runtime-agent"
        }))
        .send()
        .await
        .expect("create route request should succeed")
        .error_for_status()
        .expect("create route response should be successful")
        .json::<SignalRoute>()
        .await
        .expect("created route payload should parse");

    runtime.stop().await.expect("runtime should stop cleanly");
    drop(runtime);

    let mut restarted = start_with_options(options)
        .await
        .expect("runtime should restart with same sqlite storage");
    let restarted_base_url = format!("http://127.0.0.1:{}", restarted.port());
    let routes = client
        .get(format!("{restarted_base_url}/signal-routes"))
        .send()
        .await
        .expect("list routes request should succeed")
        .error_for_status()
        .expect("list routes response should be successful")
        .json::<Vec<SignalRoute>>()
        .await
        .expect("routes payload should parse");

    assert!(routes.iter().any(|route| route.id == created.id));

    restarted
        .stop()
        .await
        .expect("restarted runtime should stop cleanly");
    drop(restarted);
    std::fs::remove_dir_all(dir).expect("temp dir should be removed");
}
