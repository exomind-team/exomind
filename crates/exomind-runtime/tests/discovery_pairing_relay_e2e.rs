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
// Helper: run the pairing handshake with per-peer token exchange.
// Returns (session_id, pin, peer_token, initiator_inbound_token).
// ---------------------------------------------------------------------------

async fn do_pairing_with_tokens(
    client: &reqwest::Client,
    base_a: &str,
    secret_a: &str,
    responder_host_id: &str,
    responder_base_url: &str,
    responder_inbound_token: Option<&str>,
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

    // 2. Respond with per-peer inbound token for bidirectional auth.
    let mut body = json!({
        "session_id": session_id,
        "pin": pin,
        "responder_host_id": responder_host_id,
        "responder_base_url": responder_base_url,
    });
    if let Some(token) = responder_inbound_token {
        body["responder_inbound_token"] = json!(token);
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
    let initiator_inbound_token = respond["initiator_inbound_token"]
        .as_str()
        .map(|s| s.to_string());

    (session_id, pin, peer_token, initiator_inbound_token)
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
    let (_session_id, _pin, _peer_token) = do_pairing(&client, &a_url, "e2e-pair-b", &b_url).await;

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
// Test 2: auth_pairing_relay (with per-peer token exchange on both sides)
// =========================================================================

#[tokio::test]
async fn auth_pairing_relay() {
    let mut rt_a = start_test_runtime_with_secret("e2e-auth-a", Some("secret-a".to_string())).await;
    let mut rt_b = start_test_runtime_with_secret("e2e-auth-b", Some("secret-b".to_string())).await;
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

    // ---- Step 2-3: Pair RT-A with RT-B, exchanging per-peer tokens ----
    // Responder (RT-B) generates an inbound token for the initiator (RT-A).
    let responder_inbound_token = "responder-token-for-a";
    let (_session_id, _pin, _peer_token, initiator_inbound_token) = do_pairing_with_tokens(
        &client,
        &a_url,
        "secret-a",
        "e2e-auth-b",
        &b_url,
        Some(responder_inbound_token),
    )
    .await;

    // Verify per-peer token exchange: initiator returns its inbound_token (NOT global secret).
    assert!(
        initiator_inbound_token.is_some(),
        "pairing response should include initiator_inbound_token"
    );
    let initiator_inbound_token = initiator_inbound_token.unwrap();
    assert_ne!(
        initiator_inbound_token, "secret-a",
        "initiator_inbound_token must NOT be the global auth_secret"
    );

    // ---- Step 4: Verify peer was created, secrets not in API response --
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
    assert_eq!(peer_b["host_id"], "e2e-auth-b");
    // PeerInfoPublic must not contain auth_token or inbound_secret.
    assert!(
        peer_b.get("auth_token").is_none() || peer_b["auth_token"].is_null(),
        "auth_token must not be in peer list responses (security)"
    );
    assert!(
        peer_b.get("inbound_secret").is_none() || peer_b["inbound_secret"].is_null(),
        "inbound_secret must not be in peer list responses (security)"
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

    // Register RT-A as a peer on RT-B with the exchanged tokens.
    // auth_token = initiator_inbound_token (what RT-B sends TO RT-A)
    // inbound_secret = responder_inbound_token (what RT-A sends TO RT-B)
    client
        .post(format!("{b_url}/mesh/peers"))
        .header("Authorization", "Bearer secret-b")
        .json(&json!({
            "id": "e2e-auth-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"],
            "auth_token": initiator_inbound_token,
            "inbound_secret": responder_inbound_token,
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

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

    // ---- Step 9: Verify per-peer token accepted by auth middleware -----
    // RT-A's relay worker uses responder_inbound_token to call RT-B.
    // RT-B's auth middleware should accept it because it's registered as inbound_secret.
    // This is already proven by the successful relay above.

    // ---- Step 10: Verify that history endpoint also requires auth -----
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

#[tokio::test]
async fn auth_pairing_relay_survives_peer_replay_without_secrets() {
    let mut rt_a =
        start_test_runtime_with_secret("e2e-auth-replay-a", Some("secret-a".to_string())).await;
    let mut rt_b =
        start_test_runtime_with_secret("e2e-auth-replay-b", Some("secret-b".to_string())).await;
    let client = reqwest::Client::new();
    let a_url = runtime_base_url(&rt_a);
    let b_url = runtime_base_url(&rt_b);

    let responder_inbound_token = "responder-token-for-a";
    let (_session_id, _pin, _peer_token, initiator_inbound_token) = do_pairing_with_tokens(
        &client,
        &a_url,
        "secret-a",
        "e2e-auth-replay-b",
        &b_url,
        Some(responder_inbound_token),
    )
    .await;
    let initiator_inbound_token =
        initiator_inbound_token.expect("pairing response should include initiator token");

    client
        .post(format!("{b_url}/mesh/peers"))
        .header("Authorization", "Bearer secret-b")
        .json(&json!({
            "id": "e2e-auth-replay-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"],
            "auth_token": initiator_inbound_token,
            "inbound_secret": responder_inbound_token,
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{a_url}/mesh/peers"))
        .header("Authorization", "Bearer secret-a")
        .json(&json!({
            "id": "e2e-auth-replay-b",
            "base_url": b_url,
            "enabled": true,
            "capabilities": ["relay"],
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{b_url}/mesh/peers"))
        .header("Authorization", "Bearer secret-b")
        .json(&json!({
            "id": "e2e-auth-replay-a",
            "base_url": a_url,
            "enabled": true,
            "capabilities": ["relay"],
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .post(format!("{b_url}/signal-routes"))
        .header("Authorization", "Bearer secret-b")
        .json(&json!({
            "topic": "test.replay",
            "target_type": "frontend",
            "target_ref": "ui",
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    client
        .put(format!("{a_url}/mesh/interests/e2e-auth-replay-b"))
        .header("Authorization", "Bearer secret-a")
        .json(&json!({ "topics": ["test.replay"] }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    tokio::time::sleep(Duration::from_secs(2)).await;

    let event_id = rt_a.publish_signal(RuntimePublishRequest {
        topic: "test.replay".to_string(),
        source: Some("e2e-auth-replay-test".to_string()),
        payload: json!({ "msg": "hello after replay" }),
        trace_id: Some("trace-auth-replay-1".to_string()),
        origin_host_id: None,
    });

    let delivered = wait_until(Duration::from_secs(5), || {
        rt_b.clone_signal_pool()
            .window()
            .recent(50)
            .iter()
            .any(|e| e.topic == "test.replay" && e.id == event_id)
    })
    .await;

    assert!(
        delivered,
        "RT-B should still receive relay traffic after peer replay omitted secrets.\n\
         RT-B window: {:?}",
        rt_b.clone_signal_pool().window().recent(50)
    );

    stop_runtime(&mut rt_b, "e2e-auth-replay-b").await;
    stop_runtime(&mut rt_a, "e2e-auth-replay-a").await;
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
