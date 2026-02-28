use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::env;
use std::sync::Arc;
use thiserror::Error;

pub mod agent;
pub mod routes;

pub const RUNTIME_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Error)]
pub enum PortConfigError {
    #[error("EXOMIND_RT_PORT must be a valid u16 number, got: {raw}")]
    InvalidPort { raw: String },
}

/// Read EXOMIND_RT_PORT from env (从环境变量读取运行端口).
/// Missing value means `0` (缺省时用 0，让系统分配随机可用端口).
pub fn configured_port_from_env() -> Result<u16, PortConfigError> {
    match env::var("EXOMIND_RT_PORT") {
        Ok(raw) => raw
            .parse::<u16>()
            .map_err(|_| PortConfigError::InvalidPort { raw }),
        Err(env::VarError::NotPresent) => Ok(0),
        Err(env::VarError::NotUnicode(_)) => Err(PortConfigError::InvalidPort {
            raw: "<non-unicode>".to_string(),
        }),
    }
}

/// Build HTTP router (HTTP 路由构建入口).
pub fn app(runtime_port: u16) -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(routes::router())
        .with_state(AppState::new(runtime_port))
}

#[derive(Clone, Debug)]
pub struct AppState {
    pub port: u16,
    pub registry: agent::AgentRegistry,
}

impl AppState {
    fn new(port: u16) -> Self {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(agent::echo::EchoAgent::new()));
        Self { port, registry }
    }
}

pub type RuntimeState = AppState;

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: RUNTIME_VERSION,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use futures_util::stream::{self, BoxStream, StreamExt};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Arc;
    use tower::util::ServiceExt;

    struct TempRouteAgent;

    impl agent::Agent for TempRouteAgent {
        fn id(&self) -> &'static str {
            "temp-route"
        }

        fn name(&self) -> &'static str {
            "Temp Route Agent"
        }

        fn description(&self) -> &'static str {
            "用于路由注册/注销可见性测试"
        }

        fn chat_stream(&self, message: String) -> BoxStream<'static, agent::ChatChunk> {
            stream::iter(vec![agent::ChatChunk { content: message }]).boxed()
        }
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok_with_version() {
        const TEST_PORT: u16 = 3001;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "status": "ok",
                "version": RUNTIME_VERSION
            })
        );
    }

    #[tokio::test]
    async fn topology_endpoint_returns_runtime_topology() {
        const TEST_PORT: u16 = 3002;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/topology")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

        assert!(!payload["hostname"].as_str().unwrap_or_default().is_empty());
        assert!(!payload["os"].as_str().unwrap_or_default().is_empty());
        assert!(!payload["arch"].as_str().unwrap_or_default().is_empty());
        assert!(payload["uptime_secs"].is_u64());
        assert_eq!(payload["version"], RUNTIME_VERSION);
        assert_eq!(payload["port"], serde_json::json!(TEST_PORT));
    }

    #[tokio::test]
    async fn agents_endpoint_returns_echo_agent() {
        const TEST_PORT: u16 = 3003;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(
            payload,
            serde_json::json!([
                {
                    "id": "echo",
                    "name": "Echo Agent",
                    "description": "回显输入内容",
                    "status": "available"
                }
            ])
        );
    }

    #[tokio::test]
    async fn echo_chat_stream_returns_data_and_done() {
        const TEST_PORT: u16 = 3003;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/echo/chat")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"message":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body_text = String::from_utf8(body_bytes.to_vec()).unwrap();

        let data_marker = r#"data: {"content":"Echo: hello"}"#;
        let done_marker = "data: [DONE]";
        let data_index = body_text.find(data_marker).unwrap();
        let done_index = body_text.find(done_marker).unwrap();

        assert!(data_index < done_index);
    }

    #[tokio::test]
    async fn unknown_agent_chat_returns_not_found() {
        let response = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/not-found/chat")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"message":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn agents_endpoint_reflects_runtime_register_and_unregister() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempRouteAgent));

        let router = routes::router().with_state(AppState {
            registry: registry.clone(),
        });

        let first_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, first_response.status());
        let first_body = first_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let first_payload: Value = serde_json::from_slice(&first_body).unwrap();
        assert_eq!(
            first_payload,
            serde_json::json!([
                {
                    "id": "temp-route",
                    "name": "Temp Route Agent",
                    "description": "用于路由注册/注销可见性测试",
                    "status": "available"
                }
            ])
        );

        registry.unregister("temp-route");

        let second_response = router
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, second_response.status());
        let second_body = second_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let second_payload: Value = serde_json::from_slice(&second_body).unwrap();
        assert_eq!(second_payload, serde_json::json!([]));
    }
}
