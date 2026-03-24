mod support;

use axum::{
    Json, Router,
    extract::{Query, State},
    response::{
        IntoResponse,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use exomind_runtime::RuntimePublishRequest;
use futures_util::stream;
use serde::Deserialize;
use serde_json::json;
use std::convert::Infallible;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use support::{
    create_peer, create_route, set_peer_interests, start_test_runtime, stop_runtime, wait_until,
};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

#[tokio::test]
async fn marks_peer_error_when_remote_delivery_endpoint_is_unreachable() {
    let mut rt_a = start_test_runtime("rt-a").await;

    let client = reqwest::Client::new();
    create_peer(&client, &rt_a, "rt-b", "http://127.0.0.1:9").await;
    create_route(&client, &rt_a, "mesh.failure", "remote", "rt-b").await;

    rt_a.publish_signal(RuntimePublishRequest {
        topic: "mesh.failure".to_string(),
        source: Some("mesh-test".to_string()),
        payload: json!({ "value": 1 }),
        trace_id: Some("trace-mesh-failure".to_string()),
        origin_host_id: None,
    });

    let errored = wait_until(Duration::from_secs(5), || {
        rt_a.clone_mesh_state()
            .get_peer("rt-b")
            .and_then(|peer| peer.last_error)
            .is_some()
    })
    .await;

    assert!(errored, "peer should enter error state after failed relay");

    stop_runtime(&mut rt_a, "A").await;
}

#[derive(Clone, Default)]
struct FlakyPeerState {
    stream_calls: Arc<AtomicUsize>,
    last_event_ids: Arc<Mutex<Vec<Option<String>>>>,
}

#[derive(Debug, Deserialize)]
struct StreamQuery {
    peer_id: String,
    heartbeat_interval: Option<u64>,
}

async fn flaky_mesh_stream(
    State(state): State<FlakyPeerState>,
    Query(query): Query<StreamQuery>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let call_index = state.stream_calls.fetch_add(1, Ordering::SeqCst);
    let last_event_id = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    state
        .last_event_ids
        .lock()
        .await
        .push(last_event_id.clone());

    let event_id = if call_index == 0 {
        "evt-replay-1"
    } else {
        "evt-replay-2"
    };
    let event_value = if call_index == 0 { 1 } else { 2 };

    let payload = json!({
        "schema_version": 1,
        "id": event_id,
        "topic": "mesh.recover",
        "ts": 1 + call_index as i64,
        "source": "mock-peer",
        "origin_host_id": "peer-a",
        "hop": 0,
        "trace_id": null,
        "payload": { "value": event_value, "peer_id": query.peer_id, "heartbeat_interval": query.heartbeat_interval }
    })
    .to_string();

    let events = stream::iter(vec![Ok::<Event, Infallible>(
        Event::default().event("signal").id(event_id).data(payload),
    )]);

    Sse::new(events).keep_alive(KeepAlive::default())
}

async fn peer_interest_ok() -> impl IntoResponse {
    Json(json!({
        "peer_id": "rt-b",
        "topics": ["mesh.recover"],
        "updated_at": "2026-03-06T00:00:00Z"
    }))
}

#[tokio::test]
async fn reconnects_mesh_stream_and_replays_from_last_event_id() {
    let flaky_state = FlakyPeerState::default();

    let app = Router::new()
        .route("/mesh/stream", get(flaky_mesh_stream))
        .route("/mesh/interests/rt-b", axum::routing::put(peer_interest_ok))
        .with_state(flaky_state.clone());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("mock peer listener should bind");
    let mock_addr = listener.local_addr().expect("mock peer local addr");
    let mock_server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("mock peer server should run");
    });

    let mut rt_b = start_test_runtime("rt-b").await;

    let client = reqwest::Client::new();
    create_peer(&client, &rt_b, "peer-a", &format!("http://{}", mock_addr)).await;
    create_route(&client, &rt_b, "mesh.recover", "agent", "relay-probe").await;
    set_peer_interests(&client, &rt_b, "peer-a", &["mesh.recover"]).await;

    let recovered = wait_until(Duration::from_secs(5), || {
        let events = rt_b.clone_signal_pool().window().recent(20);
        let ids = events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>();
        ids.contains(&"evt-replay-1") && ids.contains(&"evt-replay-2")
    })
    .await;

    assert!(
        recovered,
        "runtime should reconnect and receive replayed event"
    );

    let observed_last_event_ids = flaky_state.last_event_ids.lock().await.clone();
    assert!(
        observed_last_event_ids.iter().any(|value| value.is_none()),
        "first stream request should not send Last-Event-ID"
    );
    assert!(
        observed_last_event_ids
            .iter()
            .any(|value| value.as_deref() == Some("evt-replay-1")),
        "reconnect request should resume with last delivered event id"
    );

    stop_runtime(&mut rt_b, "B").await;
    mock_server.abort();
    let _ = mock_server.await;
}
