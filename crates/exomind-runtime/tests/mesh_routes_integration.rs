use axum::body::Body;
use axum::http::{Request, StatusCode};
use exomind_net_pairing::DiscoveredPeer;
use exomind_net_pairing::discovery::TrustState;
use exomind_runtime::AppState;
use futures_util::StreamExt;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::{Duration, timeout};
use tower::util::ServiceExt;

fn test_app() -> axum::Router {
    exomind_runtime::app(0)
}

fn reticulum_test_peer() -> DiscoveredPeer {
    DiscoveredPeer {
        host_id: "ret-peer-host".to_string(),
        node_name: "ret-peer-node".to_string(),
        app_version: "0.3.0".to_string(),
        port: 47388,
        identity_hex: "ret-identity-0123456789abcdef".to_string(),
        destination_hex: Some("0123456789abcdef0123456789abcdef".to_string()),
        last_seen_ms: 1_782_000_000_000,
        online: true,
        trust_state: TrustState::Discovered,
        rtt_ms: Some(12),
    }
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
async fn reticulum_pair_route_authorizes_mesh_peer_after_pin_over_reticulum() {
    let tempdir = tempfile::tempdir().unwrap();
    let mesh_persist_path = tempdir.path().join("mesh-state.json");
    let mut state = AppState::new_runtime(
        0,
        "ret-local-host".to_string(),
        Some(mesh_persist_path.clone()),
        None,
        false,
        Some("admin-secret".to_string()),
    );
    let mesh = state.mesh.clone();
    let ret_peer = reticulum_test_peer();
    let peers = Arc::new(tokio::sync::RwLock::new(HashMap::from([(
        ret_peer.identity_hex.clone(),
        ret_peer,
    )])));
    let (pairing_tx, mut pairing_rx) = tokio::sync::mpsc::channel(4);
    state.ret_mesh_peers = Some(peers.clone());
    state.ret_mesh_pairing_tx = Some(pairing_tx);
    let app = exomind_runtime::app_with_state(state);

    let discovered_before = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/discovered")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(discovered_before.status(), StatusCode::OK);
    let discovered_before_body = discovered_before
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let discovered_before_payload: Value = serde_json::from_slice(&discovered_before_body).unwrap();
    assert_eq!(discovered_before_payload[0]["trust_state"], "Discovered");

    let ret_peers_before = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/peers")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ret_peers_before.status(), StatusCode::OK);
    let ret_peers_before_body = ret_peers_before
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let ret_peers_before_payload: Value = serde_json::from_slice(&ret_peers_before_body).unwrap();
    assert_eq!(
        ret_peers_before_payload[0]["peer_id"],
        "ret-identity-0123456789abcdef"
    );
    assert_eq!(ret_peers_before_payload[0]["trust_state"], "Discovered");
    assert_eq!(
        ret_peers_before_payload[0]["connection_state"],
        "connected_unauthorized"
    );
    assert_eq!(ret_peers_before_payload[0]["authorized"], json!(false));

    let app_for_pairing = app.clone();
    let response_task = tokio::spawn(async move {
        app_for_pairing
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mesh/ret/peers/ret-identity-0123456789abcdef/pair")
                    .header("authorization", "Bearer admin-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "pin": "123456" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    });

    let command = pairing_rx.recv().await.expect("route should enqueue Reticulum pairing command");
    let (peer, pin, responder_inbound_token, responder_base_url, reply) =
        match command {
            exomind_runtime::RetMeshPairingCommand::PairWithPeer {
                peer,
                pin,
                responder_inbound_token,
                responder_base_url,
                reply,
            } => (peer, pin, responder_inbound_token, responder_base_url, reply),
            _ => panic!("expected PairWithPeer command"),
        };
    assert_eq!(peer.identity_hex, "ret-identity-0123456789abcdef");
    assert_eq!(pin, "123456");
    assert_eq!(responder_base_url, "http://127.0.0.1:0");
    assert!(!responder_inbound_token.is_empty());
    let responder_inbound_token_for_assertion = responder_inbound_token.clone();
    let _ = reply.send(Ok(exomind_runtime::RetMeshPairingSuccess {
        request_id: "ret-pairing-request-1".to_string(),
        initiator_inbound_token: "initiator-inbound-token-from-reticulum".to_string(),
    }));

    let response = response_task.await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["paired"], json!(true));
    assert_eq!(payload["peer"]["host_id"], "ret-peer-host");
    assert_eq!(payload["peer"]["trust_state"], "Paired");
    assert_eq!(
        payload["peer_state"]["peer_id"],
        "ret-identity-0123456789abcdef"
    );
    assert_eq!(payload["peer_state"]["trust_state"], "Paired");
    assert_eq!(
        payload["peer_state"]["connection_state"],
        "connected_authorized"
    );
    assert_eq!(payload["peer_state"]["authorized"], json!(true));
    assert_eq!(payload["mesh_peer"]["id"], "ret-identity-0123456789abcdef");
    assert_eq!(payload["mesh_peer"]["base_url"], "http://127.0.0.1:47388");
    assert_eq!(payload["mesh_peer"]["enabled"], json!(true));

    let map = peers.read().await;
    assert_eq!(
        map.get("ret-identity-0123456789abcdef")
            .unwrap()
            .trust_state,
        TrustState::Discovered,
        "raw Reticulum discovery remains discovery-only; Paired is derived from MeshState authorization",
    );
    drop(map);

    let mesh_peer = mesh.get_peer("ret-identity-0123456789abcdef").unwrap();
    assert!(mesh.get_peer("ret-peer-host").is_none());
    assert!(mesh_peer.enabled);
    assert_eq!(mesh_peer.base_url, "http://127.0.0.1:47388");
    assert!(
        mesh_peer
            .inbound_secret
            .as_deref()
            .is_some_and(|secret| !secret.is_empty()),
        "pairing should persist a local inbound token for peer authorization",
    );
    let inbound_secret = mesh_peer.inbound_secret.clone().unwrap();
    assert_eq!(inbound_secret, responder_inbound_token_for_assertion);
    assert_eq!(
        mesh_peer.auth_token.as_deref(),
        Some("initiator-inbound-token-from-reticulum")
    );

    let peer_token_before_unpair = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/discovered")
                .header("authorization", format!("Bearer {inbound_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(peer_token_before_unpair.status(), StatusCode::OK);

    let persisted: Value = serde_json::from_str(
        &std::fs::read_to_string(&mesh_persist_path).expect("mesh state should persist"),
    )
    .unwrap();
    let persisted_peer = persisted["peers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|peer| peer["id"] == "ret-identity-0123456789abcdef")
        .expect("authorized Reticulum peer should be persisted in MeshState");
    assert_eq!(persisted_peer["enabled"], json!(true));
    assert_eq!(
        persisted_peer["inbound_secret"],
        json!(inbound_secret.clone())
    );

    let discovered_after = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/discovered")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(discovered_after.status(), StatusCode::OK);
    let discovered_after_body = discovered_after
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let discovered_after_payload: Value = serde_json::from_slice(&discovered_after_body).unwrap();
    assert_eq!(discovered_after_payload[0]["trust_state"], "Paired");

    let ret_peers_after_pair = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/peers")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ret_peers_after_pair.status(), StatusCode::OK);
    let ret_peers_after_pair_body = ret_peers_after_pair
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let ret_peers_after_pair_payload: Value =
        serde_json::from_slice(&ret_peers_after_pair_body).unwrap();
    assert_eq!(
        ret_peers_after_pair_payload[0]["connection_state"],
        "connected_authorized"
    );
    assert_eq!(ret_peers_after_pair_payload[0]["authorized"], json!(true));
    assert_eq!(ret_peers_after_pair_payload[0]["trust_state"], "Paired");

    let unpair_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/mesh/ret/peers/ret-identity-0123456789abcdef/pair")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unpair_response.status(), StatusCode::OK);
    let unpair_body = unpair_response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let unpair_payload: Value = serde_json::from_slice(&unpair_body).unwrap();
    assert_eq!(unpair_payload["paired"], json!(false));
    assert_eq!(unpair_payload["peer"]["trust_state"], "Discovered");
    assert_eq!(
        unpair_payload["peer_state"]["connection_state"],
        "connected_unauthorized"
    );
    assert_eq!(unpair_payload["peer_state"]["authorized"], json!(false));
    assert_eq!(unpair_payload["mesh_peer"]["enabled"], json!(false));

    let revoked_peer = mesh.get_peer("ret-identity-0123456789abcdef").unwrap();
    assert!(!revoked_peer.enabled);
    assert!(revoked_peer.inbound_secret.is_none());
    assert!(revoked_peer.auth_token.is_none());

    let persisted_after_unpair: Value = serde_json::from_str(
        &std::fs::read_to_string(&mesh_persist_path).expect("mesh state should persist"),
    )
    .unwrap();
    let persisted_revoked_peer = persisted_after_unpair["peers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|peer| peer["id"] == "ret-identity-0123456789abcdef")
        .expect("revoked Reticulum peer should remain visible in MeshState");
    assert_eq!(persisted_revoked_peer["enabled"], json!(false));
    assert_eq!(persisted_revoked_peer["inbound_secret"], Value::Null);
    assert_eq!(persisted_revoked_peer["auth_token"], Value::Null);

    let peer_token_after_unpair = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/discovered")
                .header("authorization", format!("Bearer {inbound_secret}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(peer_token_after_unpair.status(), StatusCode::UNAUTHORIZED);

    let discovered_after_unpair = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/discovered")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(discovered_after_unpair.status(), StatusCode::OK);
    let discovered_after_unpair_body = discovered_after_unpair
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let discovered_after_unpair_payload: Value =
        serde_json::from_slice(&discovered_after_unpair_body).unwrap();
    assert_eq!(
        discovered_after_unpair_payload[0]["trust_state"],
        "Discovered"
    );

    let ret_peers_after_unpair = app
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/peers")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ret_peers_after_unpair.status(), StatusCode::OK);
    let ret_peers_after_unpair_body = ret_peers_after_unpair
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let ret_peers_after_unpair_payload: Value =
        serde_json::from_slice(&ret_peers_after_unpair_body).unwrap();
    assert_eq!(
        ret_peers_after_unpair_payload[0]["connection_state"],
        "connected_unauthorized"
    );
    assert_eq!(
        ret_peers_after_unpair_payload[0]["authorized"],
        json!(false)
    );
    assert_eq!(
        ret_peers_after_unpair_payload[0]["trust_state"],
        "Discovered"
    );
}

#[tokio::test]
async fn initiate_ret_pair_generates_pin_and_session() {
    let state = AppState::new(0);
    let ret_peer = reticulum_test_peer();
    let peers = Arc::new(tokio::sync::RwLock::new(HashMap::from([(
        ret_peer.identity_hex.clone(),
        ret_peer,
    )])));
    // No pairing_tx — the initiate endpoint only uses PairingManager, not ret_mesh_pairing_tx.
    let mut test_state = state;
    test_state.ret_mesh_peers = Some(peers.clone());
    let app = exomind_runtime::app_with_state(test_state);

    // 1. Initiate pairing — should return PIN + session_id
    let initiate_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/ret/peers/ret-identity-0123456789abcdef/initiate-pair")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(initiate_resp.status(), StatusCode::OK);
    let initiate_body = initiate_resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let initiate_payload: Value = serde_json::from_slice(&initiate_body).unwrap();
    let session_id = initiate_payload["session_id"]
        .as_str()
        .expect("session_id should be a non-empty string")
        .to_string();
    assert!(!session_id.is_empty(), "session_id should not be empty");
    let pin = initiate_payload["pin"]
        .as_str()
        .expect("pin should be a non-empty string")
        .to_string();
    assert_eq!(pin.len(), 6, "PIN should be 6 digits");
    assert!(
        pin.chars().all(|c| c.is_ascii_digit()),
        "PIN should contain only digits"
    );
    assert_eq!(
        initiate_payload["peer_id"],
        "ret-identity-0123456789abcdef"
    );
    assert_eq!(initiate_payload["peer_host_id"], "ret-peer-host");
}

#[tokio::test]
async fn initiate_ret_pair_pin_used_in_subsequent_pair() {
    let tempdir = tempfile::tempdir().unwrap();
    let mesh_persist_path = tempdir.path().join("mesh-state.json");
    let mut state = AppState::new_runtime(
        0,
        "ret-local-host".to_string(),
        Some(mesh_persist_path.clone()),
        None,
        false,
        Some("admin-secret".to_string()),
    );
    let ret_peer = reticulum_test_peer();
    let peers = Arc::new(tokio::sync::RwLock::new(HashMap::from([(
        ret_peer.identity_hex.clone(),
        ret_peer,
    )])));
    let (pairing_tx, mut pairing_rx) = tokio::sync::mpsc::channel(4);
    state.ret_mesh_peers = Some(peers.clone());
    state.ret_mesh_pairing_tx = Some(pairing_tx);
    let app = exomind_runtime::app_with_state(state);

    // 1. Initiate pairing — generates PIN via PairingManager
    let initiate_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/ret/peers/ret-identity-0123456789abcdef/initiate-pair")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(initiate_resp.status(), StatusCode::OK);
    let initiate_body = initiate_resp
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes();
    let initiate_payload: Value = serde_json::from_slice(&initiate_body).unwrap();
    let pin = initiate_payload["pin"].as_str().unwrap().to_string();
    assert_eq!(pin.len(), 6);

    // Drain the SendPairingOffer command that initiate-pair now sends.
    let cmd = pairing_rx.recv().await.expect("should receive SendPairingOffer");
    match cmd {
        exomind_runtime::RetMeshPairingCommand::SendPairingOffer { .. } => {}
        _ => panic!("expected SendPairingOffer from initiate-pair"),
    }

    // 2. The same PIN should work with the pair endpoint (responder flow).
    let app_for_pairing = app.clone();
    let pin_for_request = pin.clone();
    let response_task = tokio::spawn(async move {
        app_for_pairing
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mesh/ret/peers/ret-identity-0123456789abcdef/pair")
                    .header("authorization", "Bearer admin-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "pin": pin_for_request }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
    });

    let command = pairing_rx.recv().await.expect("should receive pairing command");
    let (cmd_pin, reply) = match command {
        exomind_runtime::RetMeshPairingCommand::PairWithPeer { pin, reply, .. } => (pin, reply),
        _ => panic!("expected PairWithPeer command"),
    };
    assert_eq!(cmd_pin, pin, "pair endpoint should forward the same PIN");

    let _ = reply.send(Ok(exomind_runtime::RetMeshPairingSuccess {
        request_id: "ret-initiate-pair-test".to_string(),
        initiator_inbound_token: "initiator-token".to_string(),
    }));

    let response = response_task.await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response_body = response.into_body().collect().await.unwrap().to_bytes();
    let payload: Value = serde_json::from_slice(&response_body).unwrap();
    assert_eq!(payload["paired"], serde_json::json!(true));
    assert_eq!(payload["peer_state"]["authorized"], serde_json::json!(true));

    // 3. Call initiate-pair again — should create a fresh session with a new PIN
    let pairing_result = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mesh/ret/peers/ret-identity-0123456789abcdef/initiate-pair")
                .header("authorization", "Bearer admin-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pairing_result.status(), StatusCode::OK);
    let new_body = pairing_result.into_body().collect().await.unwrap().to_bytes();
    let new_payload: Value = serde_json::from_slice(&new_body).unwrap();
    let new_pin = new_payload["pin"].as_str().unwrap().to_string();
    assert_eq!(new_pin.len(), 6);
    assert_ne!(new_pin, pin, "new session should have a different PIN");
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

#[tokio::test]
async fn reticulum_sse_events_endpoint_returns_stream() {
    let (tx, _) = tokio::sync::broadcast::channel::<String>(16);
    let mut state = AppState::new(0);
    state.ret_mesh_event_tx = Some(tx.clone());
    let app = exomind_runtime::app_with_state(state);

    // Spawn a task that sends a message after the SSE stream handler has subscribed.
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = tx.send(r#"{"source":"test","payload":"hello_sse"}"#.to_string());
    });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/mesh/ret/events")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let mut data_stream = response.into_body().into_data_stream();
    let chunk = timeout(Duration::from_secs(5), data_stream.next())
        .await
        .expect("SSE stream should produce a chunk within 5s timeout")
        .expect("SSE data stream should yield a chunk")
        .expect("SSE chunk should not be an error");

    let body_str = String::from_utf8_lossy(&chunk);
    assert!(
        body_str.contains("event: ret_mesh_snapshot"),
        "SSE event type should be 'ret_mesh_snapshot', got: {body_str}",
    );
    assert!(
        body_str.contains(r#""source":"test""#),
        "SSE data should contain the sent payload, got: {body_str}",
    );
}
