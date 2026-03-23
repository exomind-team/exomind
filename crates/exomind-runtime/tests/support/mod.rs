use exomind_runtime::{RuntimeHandle, RuntimeStartOptions, start_with_options};
use serde_json::json;
use std::time::Duration;

pub async fn wait_until<F>(timeout: Duration, mut predicate: F) -> bool
where
    F: FnMut() -> bool,
{
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if predicate() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

pub async fn start_test_runtime(host_id: &str) -> RuntimeHandle {
    start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: host_id.to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: None,
        auth_secret: None,
        ..Default::default()
    })
    .await
    .unwrap_or_else(|error| panic!("runtime {host_id} should start: {error}"))
}

pub async fn start_test_runtime_with_secret(
    host_id: &str,
    secret: Option<String>,
) -> RuntimeHandle {
    start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: host_id.to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: None,
        auth_secret: secret,
        ..Default::default()
    })
    .await
    .unwrap_or_else(|error| panic!("runtime {host_id} should start: {error}"))
}

pub async fn start_test_runtime_with_mdns(host_id: &str) -> RuntimeHandle {
    start_with_options(RuntimeStartOptions {
        bind_host: "0.0.0.0".to_string(),
        port: 0,
        host_id: host_id.to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: None,
        auth_secret: None,
        enable_mdns: true,
        ..Default::default()
    })
    .await
    .unwrap_or_else(|error| panic!("runtime {host_id} with mDNS should start: {error}"))
}

pub fn runtime_base_url(runtime: &RuntimeHandle) -> String {
    format!("http://127.0.0.1:{}", runtime.port())
}

pub async fn create_peer(
    client: &reqwest::Client,
    runtime: &RuntimeHandle,
    peer_id: &str,
    base_url: &str,
) {
    client
        .post(format!("{}/mesh/peers", runtime_base_url(runtime)))
        .json(&json!({
            "id": peer_id,
            "base_url": base_url,
            "enabled": true,
            "capabilities": ["relay"]
        }))
        .send()
        .await
        .unwrap_or_else(|error| panic!("peer {peer_id} should be created: {error}"))
        .error_for_status()
        .unwrap_or_else(|error| panic!("peer {peer_id} create should succeed: {error}"));
}

pub async fn create_route(
    client: &reqwest::Client,
    runtime: &RuntimeHandle,
    topic: &str,
    target_type: &str,
    target_ref: &str,
) {
    client
        .post(format!("{}/signal-routes", runtime_base_url(runtime)))
        .json(&json!({
            "topic": topic,
            "target_type": target_type,
            "target_ref": target_ref
        }))
        .send()
        .await
        .unwrap_or_else(|error| {
            panic!("route {topic} -> {target_type}:{target_ref} should be created: {error}")
        })
        .error_for_status()
        .unwrap_or_else(|error| {
            panic!("route {topic} -> {target_type}:{target_ref} should succeed: {error}")
        });
}

pub async fn set_peer_interests(
    client: &reqwest::Client,
    runtime: &RuntimeHandle,
    peer_id: &str,
    topics: &[&str],
) {
    client
        .put(format!(
            "{}/mesh/interests/{}",
            runtime_base_url(runtime),
            peer_id
        ))
        .json(&json!({ "topics": topics }))
        .send()
        .await
        .unwrap_or_else(|error| panic!("peer interests for {peer_id} should be updated: {error}"))
        .error_for_status()
        .unwrap_or_else(|error| panic!("peer interests for {peer_id} should succeed: {error}"));
}

pub async fn stop_runtime(runtime: &mut RuntimeHandle, name: &str) {
    tokio::time::timeout(Duration::from_secs(5), runtime.stop())
        .await
        .unwrap_or_else(|_| panic!("runtime {name} stop should not hang"))
        .unwrap_or_else(|error| panic!("runtime {name} should stop: {error}"));
}
