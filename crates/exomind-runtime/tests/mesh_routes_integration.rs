use axum::body::Body;
use axum::http::{Request, StatusCode};
use exomind_runtime::mesh::{PeerInfo, PeerStatus};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::util::ServiceExt;

fn test_app() -> axum::Router {
    exomind_runtime::app(0)
}

fn auth_test_app() -> (axum::Router, exomind_runtime::AppState) {
    let mut state = exomind_runtime::AppState::new(0);
    state.auth_secret = Some("admin-secret".to_string());
    upsert_auth_peer(&state, "peer-a", "peer-a-secret");
    upsert_auth_peer(&state, "peer-b", "peer-b-secret");

    (exomind_runtime::app_with_state(state.clone()), state)
}

fn upsert_auth_peer(state: &exomind_runtime::AppState, peer_id: &str, inbound_secret: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    state.mesh.upsert_peer(PeerInfo {
        id: peer_id.to_string(),
        base_url: format!("http://{peer_id}.local:1949"),
        enabled: true,
        capabilities: vec!["eventlog.replication".to_string()],
        status: PeerStatus::Unknown,
        last_seen: None,
        last_error: None,
        created_at: now.clone(),
        updated_at: now,
        auth_token: Some(format!("{peer_id}-outbound")),
        inbound_secret: Some(inbound_secret.to_string()),
    });
}

fn mesh_signal_event(id: &str, origin_host_id: &str) -> Value {
    json!({
        "schema_version": 1,
        "id": id,
        "topic": "mesh.route.test",
        "ts": 1710000000000u64,
        "source": "mesh-routes-test",
        "origin_host_id": origin_host_id,
        "hop": 0,
        "trace_id": null,
        "payload": {
            "ok": true
        }
    })
}

#[tokio::test]
async fn topology_exposes_host_id() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/topology")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert!(
        payload["host_id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "topology should expose host_id"
    );
}

#[tokio::test]
async fn topology_exposes_runtime_host_and_device_contract() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/topology")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();

    assert!(
        payload["runtime_host"]["host_id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "topology should expose runtime_host.host_id"
    );
    assert!(
        payload["device"]["id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "topology should expose device.id"
    );
    assert!(
        payload["host_id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "topology should still keep legacy host_id"
    );
    assert_ne!(
        payload["device"]["id"], payload["host_id"],
        "device.id should no longer alias host_id"
    );
    assert_eq!(
        payload["device"]["primary_runtime_host_id"], payload["host_id"],
        "device should still point back to the runtime host"
    );

    let device_components = payload["device_components"]
        .as_array()
        .expect("device_components should be an array");
    assert!(
        !device_components.is_empty(),
        "topology should expose at least one device component"
    );
    assert_eq!(device_components[0]["kind"], "runtime_host");
    assert_eq!(
        device_components[0]["runtime_host_id"], payload["host_id"],
        "runtime_host component should point to host_id"
    );

    let device_links = payload["device_links"]
        .as_array()
        .expect("device_links should be an array");
    assert!(
        !device_links.is_empty(),
        "topology should expose at least one device link"
    );
    assert_eq!(device_links[0]["source_kind"], "device");
    assert_eq!(device_links[0]["target_kind"], "device_component");
}

#[tokio::test]
async fn mesh_peers_crud_roundtrip() {
    let app = test_app();

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/peers")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "id": "rt-b",
                        "base_url": "http://127.0.0.1:3002",
                        "enabled": true,
                        "capabilities": ["relay"]
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create.status(), StatusCode::CREATED);
    let create_body = create.into_body().collect().await.unwrap().to_bytes();
    let created: Value = serde_json::from_slice(&create_body).unwrap();
    assert_eq!(created["id"], "rt-b");
    assert_eq!(created["base_url"], "http://127.0.0.1:3002");

    let list = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/peers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let list_body = list.into_body().collect().await.unwrap().to_bytes();
    let peers: Value = serde_json::from_slice(&list_body).unwrap();
    assert!(
        peers
            .as_array()
            .unwrap()
            .iter()
            .any(|peer| peer["id"] == "rt-b")
    );

    let update = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/mesh/peers/rt-b")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "base_url": "http://127.0.0.1:3200",
                        "enabled": false
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update.status(), StatusCode::OK);
    let update_body = update.into_body().collect().await.unwrap().to_bytes();
    let updated: Value = serde_json::from_slice(&update_body).unwrap();
    assert_eq!(updated["base_url"], "http://127.0.0.1:3200");
    assert_eq!(updated["enabled"], json!(false));

    let delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/mesh/peers/rt-b")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    let list_after = app
        .oneshot(
            Request::builder()
                .uri("/mesh/peers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let list_after_body = list_after.into_body().collect().await.unwrap().to_bytes();
    let peers_after: Value = serde_json::from_slice(&list_after_body).unwrap();
    assert!(
        !peers_after
            .as_array()
            .unwrap()
            .iter()
            .any(|peer| peer["id"] == "rt-b")
    );
}

#[tokio::test]
async fn mesh_events_reject_peer_token_claiming_different_from_peer_id() {
    let (app, state) = auth_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/events")
                .header("authorization", "Bearer peer-a-secret")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "from_peer_id": "peer-b",
                        "event": mesh_signal_event("spoofed-event", "peer-a")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        state.mesh.get_peer("peer-b").expect("peer-b").status,
        PeerStatus::Unknown,
        "spoofed body must not mark the claimed peer online"
    );
}

#[tokio::test]
async fn mesh_events_accept_peer_token_matching_from_peer_id() {
    let (app, state) = auth_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/events")
                .header("authorization", "Bearer peer-a-secret")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "from_peer_id": "peer-a",
                        "event": mesh_signal_event("valid-event", "peer-a")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let peer = state.mesh.get_peer("peer-a").expect("peer-a");
    assert_eq!(peer.status, PeerStatus::Online);
    assert!(
        peer.last_seen.is_some(),
        "accepted peer event should update real sender status"
    );
}

#[tokio::test]
async fn signal_routes_accept_remote_target_type() {
    let app = test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/signal-routes")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "topic": "mesh.test",
                        "target_type": "remote",
                        "target_ref": "rt-b"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["target_type"], "remote");
    assert_eq!(payload["target_ref"], "rt-b");
}
