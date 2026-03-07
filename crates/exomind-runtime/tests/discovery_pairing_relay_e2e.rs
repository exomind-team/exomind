mod support;

use exomind_runtime::RuntimePublishRequest;
use serde_json::{Value, json};
use std::time::Duration;
use support::{
    create_route, runtime_base_url, set_peer_interests, start_test_runtime,
    start_test_runtime_with_mdns, start_test_runtime_with_secret, stop_runtime, wait_until,
};

// ---------------------------------------------------------------------------
// Helper: run the pairing handshake on RT-A and return (session_id, pin, peer_token).
// ---------------------------------------------------------------------------

async fn do_pairing(
    client: &reqwest::Client,
    base_a: &str,
    responder_host_id: &str,
    responder_base_url: &str,
) -> (String, String, String) {
    // 1. Initiate on RT-A.
    let initiate: Value = client
        .post(format!("{base_a}/mesh/pairing/initiate"))
        .send()
        .await
        .expect("initiate should send")
        .json()
        .await
        .unwrap();
    let session_id = initiate["session_id"].as_str().unwrap().to_string();
    let pin = initiate["pin"].as_str().unwrap().to_string();

    // 2. Respond with the PIN + responder info.
    let respond: Value = client
        .post(format!("{base_a}/mesh/pairing/respond"))
        .json(&json!({
            "session_id": session_id,
            "pin": pin,
            "responder_host_id": responder_host_id,
            "responder_base_url": responder_base_url,
        }))
        .send()
        .await
        .expect("respond should send")
        .error_for_status()
        .expect("respond should return 200")
        .json()
        .await
        .unwrap();
    assert_eq!(respond["paired"], json!(true));
    let peer_token = respond["peer_token"].as_str().unwrap().to_string();

    (session_id, pin, peer_token)
}

// ---------------------------------------------------------------------------
// Helper: run the pairing handshake with Bearer auth on RT-A.
// ---------------------------------------------------------------------------

async fn do_pairing_with_auth(
    client: &reqwest::Client,
    base_a: &str,
    secret_a: &str,
    responder_host_id: &str,
    responder_base_url: &str,
    responder_secret: Option<&str>,
) -> (String, String, String, Option<String>) {
    // 1. Initiate with auth.
    let initiate: Value = client
        .post(format!("{base_a}/mesh/pairing/initiate"))
        .header("Authorization", format!("Bearer {secret_a}"))
        .send()
        .await
        .expect("initiate should send")
        .error_for_status()
        .expect("initiate should return 200")
        .json()
        .await
        .unwrap();
    let session_id = initiate["session_id"].as_str().unwrap().to_string();
    let pin = initiate["pin"].as_str().unwrap().to_string();

    // 2. Respond with auth + optional responder_auth_secret for secret exchange.
    let mut body = json!({
        "session_id": session_id,
        "pin": pin,
        "responder_host_id": responder_host_id,
        "responder_base_url": responder_base_url,
    });
    if let Some(rs) = responder_secret {
        body["responder_auth_secret"] = json!(rs);
    }
    let respond: Value = client
        .post(format!("{base_a}/mesh/pairing/respond"))
        .header("Authorization", format!("Bearer {secret_a}"))
        .json(&body)
        .send()
        .await
        .expect("respond should send")
        .error_for_status()
        .expect("respond should return 200")
        .json()
        .await
        .unwrap();
    assert_eq!(respond["paired"], json!(true));
    let peer_token = respond["peer_token"].as_str().unwrap().to_string();
    let initiator_secret = respond["initiator_auth_secret"].as_str().map(|s| s.to_string());

    (session_id, pin, peer_token, initiator_secret)
}

// =========================================================================
// Test 1: pairing_then_relay (no mDNS, no auth — pure HTTP pairing + relay)
// =========================================================================

#[tokio::test]
async fn pairing_then_relay() {
    let mut rt_a = start_test_runtime("e2e-pair-a").await;
    let mut rt_b = start_test_runtime("e2e-pair-b").await;
    let client = reqwest::Client::new();
    let a_url = runtime_base_url(&rt_a);
    let b_url = runtime_base_url(&rt_b);

    // ---- Step 1-4: Pair RT-A with RT-B --------------------------------
    let (_session_id, _pin, _peer_token) =
        do_pairing(&client, &a_url, "e2e-pair-b", &b_url).await;

    // Verify RT-A's peers list contains RT-B.
    let peers: Value = client
        .get(format!("{a_url}/mesh/peers"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        peers
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == "e2e-pair-b"),
        "RT-A should have RT-B as a peer after pairing, got: {peers}"
    );

    // ---- Step 5: RT-B route for "test.ping" ---------------------------
    // On RT-B, create a route so it knows topic "test.ping" is locally
    // relevant (frontend:ui target).
    create_route(&client, &rt_b, "test.ping", "frontend", "ui").await;

    // Also register RT-A as a peer on RT-B so RT-B can accept ingested events.
    client
        .post(format!("{b_url}/mesh/peers"))
        .json(&json!({
            "id": "e2e-pair-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"],
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    // ---- Step 6: RT-A interests for RT-B on "test.ping" ---------------
    // Tell RT-A that peer "e2e-pair-b" is interested in "test.ping".
    set_peer_interests(&client, &rt_a, "e2e-pair-b", &["test.ping"]).await;

    // ---- Step 7: Wait for mesh relay to connect -----------------------
    tokio::time::sleep(Duration::from_secs(2)).await;

    // ---- Step 8: Publish signal on RT-A -------------------------------
    let event_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "test.ping".to_string(),
        source: Some("e2e-test".to_string()),
        payload: json!({ "msg": "hello from A" }),
        trace_id: Some("trace-e2e-1".to_string()),
        origin_host_id: None,
    });

    // ---- Step 9-10: Check RT-B received the signal --------------------
    let delivered = wait_until(Duration::from_secs(5), || {
        rt_b.clone_signal_pool()
            .window()
            .recent(50)
            .iter()
            .any(|e| e.topic == "test.ping" && e.id == event_id)
    })
    .await;

    assert!(
        delivered,
        "RT-B should have received 'test.ping' signal from RT-A via mesh relay.\n\
         RT-B window: {:?}",
        rt_b.clone_signal_pool().window().recent(50)
    );

    // ---- Step 11: Stop ------------------------------------------------
    stop_runtime(&mut rt_b, "e2e-pair-b").await;
    stop_runtime(&mut rt_a, "e2e-pair-a").await;
}

// =========================================================================
// Test 2: auth_pairing_relay (with auth secrets on both sides)
// =========================================================================

#[tokio::test]
async fn auth_pairing_relay() {
    let mut rt_a =
        start_test_runtime_with_secret("e2e-auth-a", Some("secret-a".to_string())).await;
    let mut rt_b =
        start_test_runtime_with_secret("e2e-auth-b", Some("secret-b".to_string())).await;
    let client = reqwest::Client::new();
    let a_url = runtime_base_url(&rt_a);
    let b_url = runtime_base_url(&rt_b);

    // ---- Step 1: Verify unauthenticated requests are rejected ---------
    let no_auth_resp = client
        .get(format!("{a_url}/mesh/peers"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        no_auth_resp.status(),
        401,
        "request without token should return 401"
    );

    // ---- Step 2-3: Pair RT-A with RT-B, exchanging auth secrets --------
    let (_session_id, _pin, _peer_token, initiator_secret) =
        do_pairing_with_auth(&client, &a_url, "secret-a", "e2e-auth-b", &b_url, Some("secret-b")).await;

    // Verify secret exchange: initiator returns its auth_secret.
    assert_eq!(
        initiator_secret.as_deref(),
        Some("secret-a"),
        "pairing response should include initiator's auth_secret"
    );

    // ---- Step 4: Verify peer was created (auth_token must NOT leak in response) ---
    let peers: Value = client
        .get(format!("{a_url}/mesh/peers"))
        .header("Authorization", "Bearer secret-a")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let peer_b = peers
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "e2e-auth-b")
        .expect("RT-A should have RT-B as a peer after pairing");
    assert!(
        peer_b.get("auth_token").is_none() || peer_b["auth_token"].is_null(),
        "auth_token must not be serialized in peer list responses (security)"
    );

    // ---- Step 5: Setup routes and bidirectional peering ----------------
    // On RT-B: route for "test.ping" so it's locally relevant.
    client
        .post(format!("{b_url}/signal-routes"))
        .header("Authorization", "Bearer secret-b")
        .json(&json!({
            "topic": "test.ping",
            "target_type": "frontend",
            "target_ref": "ui",
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    // Register RT-A as a peer on RT-B using the exchanged initiator_secret.
    client
        .post(format!("{b_url}/mesh/peers"))
        .header("Authorization", "Bearer secret-b")
        .json(&json!({
            "id": "e2e-auth-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"],
            "auth_token": initiator_secret.as_deref().unwrap_or(""),
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    // No manual auth_token patch needed — pairing exchanged responder_auth_secret directly.

    // Tell RT-A that peer "e2e-auth-b" is interested in "test.ping".
    client
        .put(format!("{a_url}/mesh/interests/e2e-auth-b"))
        .header("Authorization", "Bearer secret-a")
        .json(&json!({ "topics": ["test.ping"] }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    // ---- Step 6: Wait for relay ----------------------------------------
    tokio::time::sleep(Duration::from_secs(2)).await;

    // ---- Step 7: Publish signal ----------------------------------------
    let event_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "test.ping".to_string(),
        source: Some("e2e-auth-test".to_string()),
        payload: json!({ "msg": "hello auth" }),
        trace_id: Some("trace-auth-1".to_string()),
        origin_host_id: None,
    });

    // ---- Step 8: Verify relay delivered to RT-B -----------------------
    let delivered = wait_until(Duration::from_secs(5), || {
        rt_b.clone_signal_pool()
            .window()
            .recent(50)
            .iter()
            .any(|e| e.topic == "test.ping" && e.id == event_id)
    })
    .await;

    assert!(
        delivered,
        "RT-B should have received 'test.ping' signal from RT-A via authenticated mesh relay.\n\
         RT-B window: {:?}",
        rt_b.clone_signal_pool().window().recent(50)
    );

    // ---- Step 9: Extra — verify that history endpoint also requires auth
    let no_auth_history = client
        .get(format!("{b_url}/signals/history"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        no_auth_history.status(),
        401,
        "history without token on RT-B should return 401"
    );

    // ---- Cleanup ------------------------------------------------------
    stop_runtime(&mut rt_b, "e2e-auth-b").await;
    stop_runtime(&mut rt_a, "e2e-auth-a").await;
}

// =========================================================================
// Test 3: discover_pair_relay (mDNS discovery + pairing + relay)
// =========================================================================

#[tokio::test]
#[ignore] // mDNS requires multicast networking — not available in CI.
async fn discover_pair_relay() {
    let mut rt_a = start_test_runtime_with_mdns("e2e-mdns-a").await;
    let mut rt_b = start_test_runtime_with_mdns("e2e-mdns-b").await;
    let client = reqwest::Client::new();
    let a_url = runtime_base_url(&rt_a);
    let b_url = runtime_base_url(&rt_b);

    // ---- Step 1-2: Wait for mDNS discovery ----------------------------
    tokio::time::sleep(Duration::from_secs(3)).await;

    // ---- Step 3: Verify RT-A discovered RT-B --------------------------
    let discovered_by_a: Vec<Value> = client
        .get(format!("{a_url}/mesh/discovered"))
        .send()
        .await
        .expect("GET /mesh/discovered on RT-A should succeed")
        .json()
        .await
        .unwrap();
    let discovered_b = discovered_by_a
        .iter()
        .find(|p| p["host_id"] == "e2e-mdns-b")
        .expect("RT-A should have discovered RT-B via mDNS");

    // Build the discovered peer's base_url from mDNS info.
    let discovered_host = discovered_b["host"].as_str().unwrap();
    let discovered_port = discovered_b["port"].as_u64().unwrap();
    let discovered_base_url = format!("http://{discovered_host}:{discovered_port}");

    // ---- Step 4: Pair using the discovered info -----------------------
    let (_session_id, _pin, _peer_token) =
        do_pairing(&client, &a_url, "e2e-mdns-b", &discovered_base_url).await;

    // Verify pairing created the peer.
    let peers: Value = client
        .get(format!("{a_url}/mesh/peers"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        peers
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == "e2e-mdns-b"),
        "RT-A should have RT-B as a peer after mDNS-assisted pairing"
    );

    // ---- Step 5: Setup relay ------------------------------------------
    create_route(&client, &rt_b, "test.ping", "frontend", "ui").await;

    // Register RT-A as peer on RT-B.
    client
        .post(format!("{b_url}/mesh/peers"))
        .json(&json!({
            "id": "e2e-mdns-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"],
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    set_peer_interests(&client, &rt_a, "e2e-mdns-b", &["test.ping"]).await;

    tokio::time::sleep(Duration::from_secs(2)).await;

    // ---- Step 6: Publish and verify relay -----------------------------
    let event_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "test.ping".to_string(),
        source: Some("e2e-mdns-test".to_string()),
        payload: json!({ "msg": "hello via mDNS" }),
        trace_id: Some("trace-mdns-1".to_string()),
        origin_host_id: None,
    });

    let delivered = wait_until(Duration::from_secs(5), || {
        rt_b.clone_signal_pool()
            .window()
            .recent(50)
            .iter()
            .any(|e| e.topic == "test.ping" && e.id == event_id)
    })
    .await;

    assert!(
        delivered,
        "RT-B should have received 'test.ping' signal via mDNS-discovered mesh relay.\n\
         RT-B window: {:?}",
        rt_b.clone_signal_pool().window().recent(50)
    );

    // ---- Cleanup ------------------------------------------------------
    stop_runtime(&mut rt_b, "e2e-mdns-b").await;
    stop_runtime(&mut rt_a, "e2e-mdns-a").await;
}
