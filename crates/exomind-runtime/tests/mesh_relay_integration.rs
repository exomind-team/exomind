mod support;

use exomind_runtime::{RuntimePublishRequest, RuntimeStartOptions, start_with_options};
use futures_util::StreamExt;
use serde_json::json;
use std::time::Duration;
use support::{
    create_peer, create_route, runtime_base_url, set_peer_interests, start_test_runtime,
    stop_runtime, wait_until,
};

#[tokio::test]
async fn relays_remote_targeted_events_between_two_runtimes() {
    let mut rt_a = start_test_runtime("rt-a").await;
    let mut rt_b = start_test_runtime("rt-b").await;

    let client = reqwest::Client::new();
    let a_url = runtime_base_url(&rt_a);
    let b_url = runtime_base_url(&rt_b);

    create_peer(&client, &rt_a, "rt-b", &b_url).await;
    create_peer(&client, &rt_b, "rt-a", &a_url).await;
    create_route(&client, &rt_b, "mesh.test", "agent", "relay-probe").await;
    create_route(&client, &rt_a, "mesh.test", "remote", "rt-b").await;

    assert!(
        wait_until(Duration::from_secs(3), || {
            let interests = rt_a.clone_signal_pool().window().recent(0);
            interests.is_empty()
        })
        .await
    );

    let event_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "mesh.test".to_string(),
        source: Some("mesh-test".to_string()),
        payload: json!({ "value": 1 }),
        trace_id: Some("trace-mesh-1".to_string()),
        origin_host_id: None,
    });

    let delivered = wait_until(Duration::from_secs(5), || {
        rt_b.clone_signal_pool()
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

    stop_runtime(&mut rt_b, "B").await;
    stop_runtime(&mut rt_a, "A").await;
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
    let a_url = runtime_base_url(&rt_a);

    create_route(&client, &rt_a, "mesh.test", "remote", "rt-b").await;
    set_peer_interests(&client, &rt_a, "rt-b", &["mesh.test"]).await;

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
        .get(format!(
            "{a_url}/mesh/stream?peer_id=rt-b&heartbeat_interval=30"
        ))
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

#[tokio::test]
async fn eventlog_append_route_relays_replication_signal_between_two_runtimes() {
    let mut rt_a = start_test_runtime("rt-a-eventlog").await;
    let mut rt_b = start_test_runtime("rt-b-eventlog").await;

    let client = reqwest::Client::new();
    let a_url = runtime_base_url(&rt_a);
    let b_url = runtime_base_url(&rt_b);

    create_peer(&client, &rt_a, "rt-b-eventlog", &b_url).await;
    create_route(
        &client,
        &rt_a,
        "eventlog.replication.appended",
        "remote",
        "rt-b-eventlog",
    )
    .await;

    client
        .post(format!("{a_url}/eventlog"))
        .json(&json!({
            "id": "relay-rep-1",
            "timestamp": 1700000000000u64,
            "content": "hello from eventlog route",
            "tags": ["note"],
            "metadata": {
                "source": {
                    "deviceId": "desktop-a"
                }
            }
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let relayed = wait_until(Duration::from_secs(5), || {
        rt_b.clone_signal_pool()
            .window()
            .recent(20)
            .iter()
            .any(|event| {
                event.topic == "eventlog.replication.appended"
                    && event.hop == 1
                    && event.payload["event"]["id"] == json!("relay-rep-1")
            })
    })
    .await;

    if !relayed {
        panic!(
            "eventlog replication signal relay timeout\nA window: {:?}\nB window: {:?}",
            rt_a.clone_signal_pool().window().recent(20),
            rt_b.clone_signal_pool().window().recent(20)
        );
    }

    stop_runtime(&mut rt_b, "B eventlog").await;
    stop_runtime(&mut rt_a, "A eventlog").await;
}
