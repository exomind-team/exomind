mod support;

use support::{runtime_base_url, start_test_runtime_with_secret, stop_runtime};

#[tokio::test]
async fn auth_with_secret_no_token_returns_401() {
    let mut rt = start_test_runtime_with_secret("auth-test-1", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology", runtime_base_url(&rt)))
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        401,
        "should reject request without token when origin is missing"
    );

    stop_runtime(&mut rt, "auth-test-1").await;
}

#[tokio::test]
async fn auth_with_secret_correct_token_returns_200() {
    let mut rt = start_test_runtime_with_secret("auth-test-2", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology", runtime_base_url(&rt)))
        .header("Authorization", "Bearer s3cret")
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        200,
        "should allow request with correct token"
    );

    stop_runtime(&mut rt, "auth-test-2").await;
}

#[tokio::test]
async fn auth_with_secret_wrong_token_returns_401() {
    let mut rt = start_test_runtime_with_secret("auth-test-3", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology", runtime_base_url(&rt)))
        .header("Authorization", "Bearer wrong-token")
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        401,
        "should reject request with wrong token when origin is missing"
    );

    stop_runtime(&mut rt, "auth-test-3").await;
}

#[tokio::test]
async fn auth_without_secret_allows_all_requests() {
    let mut rt = start_test_runtime_with_secret("auth-test-4", None).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology", runtime_base_url(&rt)))
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        200,
        "should allow request when no secret configured"
    );

    stop_runtime(&mut rt, "auth-test-4").await;
}

#[tokio::test]
async fn health_endpoint_always_returns_200() {
    let mut rt = start_test_runtime_with_secret("auth-test-5", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    // Health should be accessible without any token, even when secret is set.
    let response = client
        .get(format!("{}/health", runtime_base_url(&rt)))
        .send()
        .await
        .expect("request should send");

    assert_eq!(response.status(), 200, "/health should always be public");

    stop_runtime(&mut rt, "auth-test-5").await;
}

#[tokio::test]
async fn auth_via_query_param_token() {
    let mut rt = start_test_runtime_with_secret("auth-test-6", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology?token=s3cret", runtime_base_url(&rt)))
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        200,
        "should allow request with correct query param token"
    );

    // Wrong query param token
    let response = client
        .get(format!("{}/topology?token=wrong", runtime_base_url(&rt)))
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        401,
        "should reject request with wrong query param token"
    );

    stop_runtime(&mut rt, "auth-test-6").await;
}

#[tokio::test]
async fn auth_with_secret_trusted_loopback_origin_returns_200_without_token() {
    let mut rt = start_test_runtime_with_secret("auth-test-7", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology", runtime_base_url(&rt)))
        .header("Origin", "http://tauri.localhost")
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        200,
        "trusted local UI origin should be allowed without token"
    );

    stop_runtime(&mut rt, "auth-test-7").await;
}

#[tokio::test]
async fn auth_with_secret_untrusted_origin_still_returns_401() {
    let mut rt = start_test_runtime_with_secret("auth-test-8", Some("s3cret".to_string())).await;
    let client = reqwest::Client::new();

    let response = client
        .get(format!("{}/topology", runtime_base_url(&rt)))
        .header("Origin", "https://evil.example")
        .send()
        .await
        .expect("request should send");

    assert_eq!(
        response.status(),
        401,
        "untrusted browser origin must still provide a valid token"
    );

    stop_runtime(&mut rt, "auth-test-8").await;
}
