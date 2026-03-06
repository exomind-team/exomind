use exomind_runtime::{RuntimePublishRequest, RuntimeStartOptions, start_with_options};
use futures_util::StreamExt;
use serde_json::json;
use std::time::Duration;

async fn wait_until<F>(timeout: Duration, mut predicate: F)
-> bool
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

#[tokio::test]
async fn relays_remote_targeted_events_between_two_runtimes() {
    let mut rt_a = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "rt-a".to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: None,
        ..Default::default()
    })
    .await
    .expect("runtime A should start");

    let mut rt_b = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "rt-b".to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: None,
        ..Default::default()
    })
    .await
    .expect("runtime B should start");

    let client = reqwest::Client::new();
    let a_url = format!("http://127.0.0.1:{}", rt_a.port());
    let b_url = format!("http://127.0.0.1:{}", rt_b.port());

    client
        .post(format!("{a_url}/mesh/peers"))
        .json(&json!({
            "id": "rt-b",
            "base_url": b_url,
            "enabled": true,
            "capabilities": ["relay"]
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{b_url}/mesh/peers"))
        .json(&json!({
            "id": "rt-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"]
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{b_url}/signal-routes"))
        .json(&json!({
            "topic": "mesh.test",
            "target_type": "agent",
            "target_ref": "relay-probe"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{a_url}/signal-routes"))
        .json(&json!({
            "topic": "mesh.test",
            "target_type": "remote",
            "target_ref": "rt-b"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    assert!(wait_until(Duration::from_secs(3), || {
        let interests = rt_a
            .clone_signal_pool()
            .window()
            .recent(0);
        interests.is_empty()
    })
    .await);

    let event_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "mesh.test".to_string(),
        source: Some("mesh-test".to_string()),
        payload: json!({ "value": 1 }),
        trace_id: Some("trace-mesh-1".to_string()),
        origin_host_id: None,
    });

    let delivered = wait_until(Duration::from_secs(5), || {
        rt_b
            .clone_signal_pool()
            .window()
            .recent(20)
            .iter()
            .any(|event| event.id == event_id && event.hop == 1)
    })
    .await;

    if !delivered {
        let a_peers = client
            .get(format!("{a_url}/mesh/peers"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let b_peers = client
            .get(format!("{b_url}/mesh/peers"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        panic!(
            "relay timeout\nA peers: {a_peers}\nB peers: {b_peers}\nA window: {:?}\nB window: {:?}",
            rt_a.clone_signal_pool().window().recent(20),
            rt_b.clone_signal_pool().window().recent(20)
        );
    }

    tokio::time::timeout(Duration::from_secs(5), rt_b.stop())
        .await
        .expect("runtime B stop should not hang")
        .expect("runtime B should stop");
    tokio::time::timeout(Duration::from_secs(5), rt_a.stop())
        .await
        .expect("runtime A stop should not hang")
        .expect("runtime A should stop");
}

#[tokio::test]
async fn mesh_stream_replays_remote_routed_events_from_last_event_id() {
    let mut rt_a = start_with_options(RuntimeStartOptions {
        bind_host: "127.0.0.1".to_string(),
        port: 0,
        host_id: "rt-a".to_string(),
        spawn_builtin_actors: false,
        spawn_ts_agents: false,
        mesh_state_path: None,
        ..Default::default()
    })
    .await
    .expect("runtime A should start");

    let client = reqwest::Client::new();
    let a_url = format!("http://127.0.0.1:{}", rt_a.port());

    client
        .post(format!("{a_url}/signal-routes"))
        .json(&json!({
            "topic": "mesh.test",
            "target_type": "remote",
            "target_ref": "rt-b"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .put(format!("{a_url}/mesh/interests/rt-b"))
        .json(&json!({
            "topics": ["mesh.test"]
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let first_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "mesh.test".to_string(),
        source: Some("mesh-test".to_string()),
        payload: json!({ "value": 1 }),
        trace_id: None,
        origin_host_id: None,
    });
    let second_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "mesh.test".to_string(),
        source: Some("mesh-test".to_string()),
        payload: json!({ "value": 2 }),
        trace_id: None,
        origin_host_id: None,
    });

    let response = client
        .get(format!("{a_url}/mesh/stream?peer_id=rt-b&heartbeat_interval=30"))
        .header("Last-Event-ID", first_id)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let mut stream = response.bytes_stream();
    let expected_second_id = second_id.clone();
    let replay_payload = tokio::time::timeout(Duration::from_secs(2), async move {
        let mut payload = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.unwrap();
            payload.push_str(&String::from_utf8_lossy(&chunk));
            if payload.contains(&expected_second_id) {
                break;
            }
        }
        payload
    })
    .await
    .expect("replay stream should emit quickly");

    assert!(replay_payload.contains(&second_id));

    rt_a.stop().await.expect("runtime A should stop");
}
