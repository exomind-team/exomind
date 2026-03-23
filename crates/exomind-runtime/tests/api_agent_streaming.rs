use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use axum::{Json, Router};
use exomind_runtime::agent::api::{ApiAgent, ApiProviderProfile};
use exomind_runtime::agent::{Agent, ChatRequest};
use futures_util::StreamExt;
use serde_json::Value;
use std::net::SocketAddr;
use tokio::net::TcpListener;

async fn openai_handler(Json(payload): Json<Value>) -> Response {
    let model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let body = format!(
        "data: {{\"choices\":[{{\"delta\":{{\"content\":\"hello from {model}\"}}}}]}}\n\n\
         data: [DONE]\n\n"
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .body(Body::from(body))
        .unwrap()
}

async fn anthropic_handler(Json(payload): Json<Value>) -> Response {
    let model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let body = format!(
        "event: content_block_delta\n\
         data: {{\"type\":\"content_block_delta\",\"delta\":{{\"text\":\"hello from {model}\"}}}}\n\n\
         event: message_stop\n\
         data: {{\"type\":\"message_stop\"}}\n\n"
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .body(Body::from(body))
        .unwrap()
}

async fn spawn_api_test_server() -> SocketAddr {
    let app = Router::new()
        .route("/chat/completions", post(openai_handler))
        .route("/v1/messages", post(anthropic_handler));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    address
}

#[tokio::test]
async fn openai_api_agent_streams_text_and_assigns_session() {
    let address = spawn_api_test_server().await;
    let agent = ApiAgent::managed(
        "api-openai",
        None,
        None,
        ApiProviderProfile {
            provider: "openai".to_string(),
            model: "gpt-5".to_string(),
            base_url: Some(format!("http://{address}")),
            api_key: "sk-test".to_string(),
        },
    );

    let chunks = agent
        .chat_stream(ChatRequest {
            message: "hello".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        chunks
            .iter()
            .any(|chunk| chunk.content.contains("hello from gpt-5")),
        "chunks={chunks:?}"
    );
    assert!(
        chunks.iter().any(|chunk| chunk.session_id.is_some()),
        "new API session should expose session_id: {chunks:?}"
    );
}

#[tokio::test]
async fn anthropic_api_agent_streams_text() {
    let address = spawn_api_test_server().await;
    let agent = ApiAgent::managed(
        "api-anthropic",
        None,
        None,
        ApiProviderProfile {
            provider: "anthropic".to_string(),
            model: "claude-sonnet-4-5".to_string(),
            base_url: Some(format!("http://{address}")),
            api_key: "sk-ant-test".to_string(),
        },
    );

    let chunks = agent
        .chat_stream(ChatRequest {
            message: "hello".to_string(),
            session_id: None,
        })
        .collect::<Vec<_>>()
        .await;

    assert!(
        chunks
            .iter()
            .any(|chunk| chunk.content.contains("hello from claude-sonnet-4-5")),
        "chunks={chunks:?}"
    );
}
