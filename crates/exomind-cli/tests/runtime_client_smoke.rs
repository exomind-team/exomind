use std::collections::HashMap;
use std::net::SocketAddr;

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::routing::get;
use axum::{Json, Router};
use exomind_cli::error::CliError;
use exomind_cli::profile_scope::ProfileScope;
use exomind_cli::runtime_client::RuntimeClient;
use serde_json::{Value, json};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct TestState;

#[tokio::test]
async fn runtime_client_health_and_scope_helpers_attach_token() {
    let base_url = spawn_test_server().await;
    let client = RuntimeClient::new("127.0.0.1:0", base_url.clone(), Some("secret-token".into()))
        .expect("runtime client");
    let scope = ProfileScope::from_flags(Some("argon"), None).expect("profile scope");

    let health = client.health().await.expect("health");
    assert_eq!(health["status"], "ok");

    let task_value: Value = client
        .get_json(&client.with_scope("/tasks", &scope.task_query_pairs()))
        .await
        .expect("task query");
    assert_eq!(task_value["query"]["profile_id"], "profile-argon");
    assert_eq!(task_value["auth"], "Bearer secret-token");

    let eventlog_value: Value = client
        .get_json(&client.with_scope("/eventlog", &scope.eventlog_query_pairs()))
        .await
        .expect("eventlog query");
    assert_eq!(eventlog_value["query"]["user_id"], "profile-argon");
    assert_eq!(eventlog_value["auth"], "Bearer secret-token");
}

#[tokio::test]
async fn runtime_client_returns_status_and_body_preview() {
    let base_url = spawn_test_server().await;
    let client = RuntimeClient::new("127.0.0.1:0", base_url, None).expect("runtime client");

    let error = client
        .get_json::<Value>("/error")
        .await
        .expect_err("error response should bubble up");

    match error {
        CliError::HttpResponse {
            status,
            body_preview,
        } => {
            assert_eq!(status.as_u16(), 409);
            assert!(body_preview.contains("rt conflict"));
        }
        other => panic!("expected http response error, got {other:?}"),
    }
}

async fn spawn_test_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let address = listener.local_addr().expect("listener addr");
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/tasks", get(echo_handler))
        .route("/eventlog", get(echo_handler))
        .route("/error", get(error_handler))
        .with_state(TestState);

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve test app");
    });

    format!("http://{}", socket_to_string(address))
}

fn socket_to_string(address: SocketAddr) -> String {
    address.to_string()
}

async fn health_handler() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "version": "test"
    }))
}

async fn echo_handler(
    State(_state): State<TestState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    Json(json!({
        "query": query,
        "auth": headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
    }))
}

async fn error_handler() -> (axum::http::StatusCode, &'static str) {
    (axum::http::StatusCode::CONFLICT, "rt conflict")
}
