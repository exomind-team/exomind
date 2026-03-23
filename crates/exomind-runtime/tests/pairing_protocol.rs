mod support;

use serde_json::{Value, json};
use support::{runtime_base_url, start_test_runtime, stop_runtime};

#[tokio::test]
async fn pairing_full_flow_correct_pin() {
    let mut rt = start_test_runtime("pairing-1").await;
    let client = reqwest::Client::new();
    let base = runtime_base_url(&rt);

    // 1. Initiate pairing.
    let initiate_resp = client
        .post(format!("{base}/mesh/pairing/initiate"))
        .send()
        .await
        .expect("initiate should send");
    assert_eq!(initiate_resp.status(), 200);

    let initiate_body: Value = initiate_resp.json().await.unwrap();
    let session_id = initiate_body["session_id"].as_str().unwrap();
    let pin = initiate_body["pin"].as_str().unwrap();
    assert_eq!(pin.len(), 6, "PIN should be 6 digits");
    assert!(
        pin.chars().all(|c| c.is_ascii_digit()),
        "PIN should be numeric"
    );

    // 2. Respond with correct PIN.
    let respond_resp = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": pin,
            "responder_host_id": "device-b",
            "responder_base_url": "http://192.168.1.100:1949"
        }))
        .send()
        .await
        .expect("respond should send");
    assert_eq!(respond_resp.status(), 200);

    let respond_body: Value = respond_resp.json().await.unwrap();
    assert_eq!(respond_body["paired"], json!(true));
    let peer_token = respond_body["peer_token"].as_str().unwrap();
    assert_eq!(
        peer_token.len(),
        64,
        "peer_token should be SHA-256 hex (64 chars)"
    );

    // 3. Verify peer was auto-registered.
    let peers_resp = client
        .get(format!("{base}/mesh/peers"))
        .send()
        .await
        .expect("list peers should send");
    let peers: Value = peers_resp.json().await.unwrap();
    let peer = peers
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "device-b")
        .expect("device-b should be registered as peer");
    assert_eq!(peer["enabled"], json!(true));
    assert_eq!(peer["base_url"], "http://192.168.1.100:1949");
    // Secrets must NOT be leaked in list responses (PeerInfoPublic).
    assert!(
        peer.get("auth_token").is_none() || peer["auth_token"].is_null(),
        "auth_token must not be in peer list responses"
    );
    assert!(
        peer.get("inbound_secret").is_none() || peer["inbound_secret"].is_null(),
        "inbound_secret must not be in peer list responses"
    );

    stop_runtime(&mut rt, "pairing-1").await;
}

#[tokio::test]
async fn pairing_wrong_pin_returns_403() {
    let mut rt = start_test_runtime("pairing-2").await;
    let client = reqwest::Client::new();
    let base = runtime_base_url(&rt);

    let initiate_resp = client
        .post(format!("{base}/mesh/pairing/initiate"))
        .send()
        .await
        .unwrap();
    let initiate_body: Value = initiate_resp.json().await.unwrap();
    let session_id = initiate_body["session_id"].as_str().unwrap();

    // Respond with deliberately wrong PIN.
    let respond_resp = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": "000000",
            "responder_host_id": "device-b",
            "responder_base_url": "http://192.168.1.100:1949"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(respond_resp.status(), 403, "wrong PIN should return 403");

    // Verify no peer was registered.
    let peers_resp = client
        .get(format!("{base}/mesh/peers"))
        .send()
        .await
        .unwrap();
    let peers: Value = peers_resp.json().await.unwrap();
    assert!(
        !peers
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == "device-b"),
        "no peer should be registered after wrong PIN"
    );

    stop_runtime(&mut rt, "pairing-2").await;
}

#[tokio::test]
async fn pairing_session_consumed_after_respond() {
    let mut rt = start_test_runtime("pairing-3").await;
    let client = reqwest::Client::new();
    let base = runtime_base_url(&rt);

    let initiate_resp = client
        .post(format!("{base}/mesh/pairing/initiate"))
        .send()
        .await
        .unwrap();
    let initiate_body: Value = initiate_resp.json().await.unwrap();
    let session_id = initiate_body["session_id"].as_str().unwrap();
    let pin = initiate_body["pin"].as_str().unwrap();

    // First respond succeeds.
    let first = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": pin,
            "responder_host_id": "device-b",
            "responder_base_url": "http://192.168.1.100:1949"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 200, "first respond should succeed");

    // Second respond fails (session consumed).
    let second = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": pin,
            "responder_host_id": "device-c",
            "responder_base_url": "http://192.168.1.200:1949"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(second.status(), 403, "reused session should return 403");

    stop_runtime(&mut rt, "pairing-3").await;
}

#[tokio::test]
async fn pairing_nonexistent_session_returns_403() {
    let mut rt = start_test_runtime("pairing-4").await;
    let client = reqwest::Client::new();
    let base = runtime_base_url(&rt);

    let respond_resp = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": "nonexistent-session-id",
            "pin": "123456",
            "responder_host_id": "device-b",
            "responder_base_url": "http://192.168.1.100:1949"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        respond_resp.status(),
        403,
        "nonexistent session should return 403"
    );

    stop_runtime(&mut rt, "pairing-4").await;
}

#[tokio::test]
async fn pairing_wrong_pin_destroys_session() {
    let mut rt = start_test_runtime("pairing-5").await;
    let client = reqwest::Client::new();
    let base = runtime_base_url(&rt);

    let initiate_resp = client
        .post(format!("{base}/mesh/pairing/initiate"))
        .send()
        .await
        .unwrap();
    let initiate_body: Value = initiate_resp.json().await.unwrap();
    let session_id = initiate_body["session_id"].as_str().unwrap();
    let pin = initiate_body["pin"].as_str().unwrap();

    // Respond with wrong PIN.
    let wrong = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": "000000",
            "responder_host_id": "device-b",
            "responder_base_url": "http://192.168.1.100:1949"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 403);

    // Now try with correct PIN — should also fail because session was destroyed.
    let retry = client
        .post(format!("{base}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": pin,
            "responder_host_id": "device-b",
            "responder_base_url": "http://192.168.1.100:1949"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        retry.status(),
        403,
        "session should be destroyed after wrong PIN attempt"
    );

    stop_runtime(&mut rt, "pairing-5").await;
}
