use super::*;
use axum::{
    Json, Router,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tokio::{net::TcpListener, task::JoinHandle};

struct Server {
    base: String,
    task: JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn serve(router: Router) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    Server { base, task }
}
fn settings(base: &str) -> SummaryProviderSettings {
    SummaryProviderSettings {
        base_url: base.into(),
        model: "synthetic-model".into(),
        api_key: Some("synthetic-key".into()),
        max_output_tokens: 2048,
        timeout_ms: 5000,
    }
}
fn input() -> ModelInput {
    ModelInput {
        system: "Summarize only the frozen evidence.".into(),
        material: r#"{"sources":[{"id":"synthetic-event","text":"Synthetic material"}]}"#.into(),
    }
}
fn response() -> Value {
    json!({"id":"synthetic-provider-request","model":"synthetic-model-v1","choices":[{"message":{"content":"Synthetic narrative"},"finish_reason":"stop"}],"usage":{"prompt_tokens":31,"completion_tokens":7}})
}

#[tokio::test]
async fn actual_http_request_uses_only_frozen_input_and_returns_real_usage() {
    let observed = Arc::new(Mutex::new(None));
    let capture = observed.clone();
    let server = serve(Router::new().route(
        "/v1/chat/completions",
        post(move |headers: HeaderMap, Json(body): Json<Value>| {
            let capture = capture.clone();
            async move {
                *capture.lock().unwrap() = Some((headers, body));
                Json(response())
            }
        }),
    ))
    .await;
    let (_keep, cancel) = watch::channel(false);
    let reply = complete(&settings(&server.base), &input(), cancel)
        .await
        .unwrap();
    let saved = observed.lock().unwrap();
    let (headers, body) = saved.as_ref().unwrap();
    assert_eq!(
        headers.get("authorization").unwrap(),
        "Bearer synthetic-key"
    );
    assert_eq!(body["model"], "synthetic-model");
    assert_eq!(body["stream"], false);
    assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    assert_eq!(body["messages"][0]["content"], input().system);
    assert_eq!(body["messages"][1]["content"], input().material);
    assert_eq!(reply.text, "Synthetic narrative");
    assert_eq!(reply.model, "synthetic-model-v1");
    assert_eq!(
        reply.request_id.as_deref(),
        Some("synthetic-provider-request")
    );
    assert_eq!(
        (reply.input_tokens, reply.output_tokens),
        (Some(31), Some(7))
    );
}

#[tokio::test]
async fn missing_usage_remains_unknown_and_truncated_generation_is_not_success() {
    let server = serve(Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            let mut value = response();
            value.as_object_mut().unwrap().remove("usage");
            Json(value)
        }),
    ))
    .await;
    let (_keep, cancel) = watch::channel(false);
    let reply = complete(&settings(&server.base), &input(), cancel)
        .await
        .unwrap();
    assert_eq!((reply.input_tokens, reply.output_tokens), (None, None));
    let truncated = serve(Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            let mut value = response();
            value["choices"][0]["finish_reason"] = json!("length");
            Json(value)
        }),
    ))
    .await;
    let (_keep, cancel) = watch::channel(false);
    assert_eq!(
        complete(&settings(&truncated.base), &input(), cancel)
            .await
            .unwrap_err(),
        ModelCallError::IncompleteResponse
    );
}

#[tokio::test]
async fn upstream_error_body_does_not_become_a_durable_or_display_error() {
    let server = serve(Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            (
                StatusCode::TOO_MANY_REQUESTS,
                "Synthetic echoed prompt / synthetic-key / private material",
            )
        }),
    ))
    .await;
    let (_keep, cancel) = watch::channel(false);
    let error = complete(&settings(&server.base), &input(), cancel)
        .await
        .unwrap_err();
    assert_eq!(error, ModelCallError::RateLimited);
    assert!(error.retryable());
    assert_eq!(serde_json::to_string(&error).unwrap(), "\"rate_limited\"");
}

#[tokio::test]
async fn cancellation_during_request_or_closed_owner_prevents_a_reply() {
    let requests = Arc::new(AtomicUsize::new(0));
    let reached = Arc::new(tokio::sync::Notify::new());
    let count = requests.clone();
    let notify = reached.clone();
    let server = serve(Router::new().route(
        "/v1/chat/completions",
        post(move || {
            let count = count.clone();
            let notify = notify.clone();
            async move {
                count.fetch_add(1, Ordering::SeqCst);
                notify.notify_one();
                tokio::time::sleep(Duration::from_secs(10)).await;
                Json(response())
            }
        }),
    ))
    .await;
    let (owner, cancel) = watch::channel(false);
    let configuration = settings(&server.base);
    let operation = tokio::spawn(async move { complete(&configuration, &input(), cancel).await });
    tokio::time::timeout(Duration::from_secs(2), reached.notified())
        .await
        .unwrap();
    owner.send(true).unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), operation)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err(),
        ModelCallError::Cancelled
    );
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    for already_cancelled in [true, false] {
        let (owner, cancel) = watch::channel(already_cancelled);
        if !already_cancelled {
            drop(owner);
        }
        assert_eq!(
            complete(&settings(&server.base), &input(), cancel)
                .await
                .unwrap_err(),
            ModelCallError::Cancelled
        );
    }
    assert_eq!(
        requests.load(Ordering::SeqCst),
        1,
        "Cancelled owner must not send another request"
    );
}

#[tokio::test]
async fn chunked_body_without_content_length_has_a_real_byte_limit() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 8192];
        socket.read(&mut buffer).await.unwrap();
        if socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.is_err(){return;}
        let chunk = vec![b'X'; 16384];
        for _ in 0..=(MAX_RESPONSE_BYTES / chunk.len()) {
            if socket
                .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                .await
                .is_err()
            {
                return;
            }
            if socket.write_all(&chunk).await.is_err() {
                return;
            }
            if socket.write_all(b"\r\n").await.is_err() {
                return;
            }
        }
        let _ = socket.write_all(b"0\r\n\r\n").await;
    });
    let server = Server { base, task };
    let (_keep, cancel) = watch::channel(false);
    assert_eq!(
        complete(&settings(&server.base), &input(), cancel)
            .await
            .unwrap_err(),
        ModelCallError::ResponseTooLarge
    );
}

#[tokio::test]
async fn redirect_does_not_send_credentials_or_material_to_another_endpoint() {
    let calls = Arc::new(AtomicUsize::new(0));
    let capture = calls.clone();
    let destination = serve(Router::new().route(
        "/v1/chat/completions",
        post(move || {
            capture.fetch_add(1, Ordering::SeqCst);
            async { Json(response()) }
        }),
    ))
    .await;
    let location = format!("{}/chat/completions", destination.base);
    let source = serve(Router::new().route(
        "/v1/chat/completions",
        post(move || {
            let location = location.clone();
            async move { (StatusCode::TEMPORARY_REDIRECT, [("location", location)]) }
        }),
    ))
    .await;
    let (_keep, cancel) = watch::channel(false);
    assert_eq!(
        complete(&settings(&source.base), &input(), cancel)
            .await
            .unwrap_err(),
        ModelCallError::Rejected
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn oversized_frozen_input_is_rejected_before_network_and_timeout_is_finite() {
    let oversized = ModelInput {
        system: String::new(),
        material: "x".repeat(MAX_MODEL_INPUT_BYTES + 1),
    };
    let (_keep, cancel) = watch::channel(false);
    assert_eq!(
        complete(&settings("http://127.0.0.1:9/v1"), &oversized, cancel)
            .await
            .unwrap_err(),
        ModelCallError::InputTooLarge
    );
    let server = serve(Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            tokio::time::sleep(Duration::from_secs(10)).await;
            Json(response())
        }),
    ))
    .await;
    let mut configuration = settings(&server.base);
    configuration.timeout_ms = 1000;
    let (_keep, cancel) = watch::channel(false);
    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(3),
            complete(&configuration, &input(), cancel)
        )
        .await
        .unwrap()
        .unwrap_err(),
        ModelCallError::Timeout
    );
}
