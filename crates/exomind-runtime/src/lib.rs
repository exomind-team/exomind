use axum::http::Method;
use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::env;
use std::sync::Arc;
use thiserror::Error;
use tower_http::cors::{Any, CorsLayer};

use signal::SignalPool;

pub mod agent;
pub mod routes;
pub mod signal;

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
    // Enable CORS for browser-side host aggregation (允许浏览器跨端口访问 runtime).
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .merge(routes::router())
        .layer(cors)
        .with_state(AppState::new(runtime_port))
}

#[derive(Clone)]
pub struct AppState {
    pub port: u16,
    pub registry: agent::AgentRegistry,
    pub signal_pool: Arc<SignalPool>,
}

impl AppState {
    fn new(port: u16) -> Self {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(agent::claude::ClaudeAgent::new()));
        registry.register(Arc::new(agent::echo::EchoAgent::new()));

        let signal_pool = Arc::new(SignalPool::new(Some("config/signal-routes.default.json")));

        Self {
            port,
            registry,
            signal_pool,
        }
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
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;
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

        fn chat_stream(&self, request: agent::ChatRequest) -> BoxStream<'static, agent::ChatChunk> {
            stream::iter(vec![agent::ChatChunk::content_only(request.message)]).boxed()
        }
    }

    #[derive(Default)]
    struct TempSessionAgent {
        sessions: Arc<StdMutex<HashMap<String, agent::SessionInfo>>>,
    }

    impl TempSessionAgent {
        fn new_with_one_session() -> Self {
            let session = agent::SessionInfo {
                session_id: "temp-session-1".to_string(),
                status: "idle".to_string(),
                created_at: "2026-02-28T10:30:00Z".to_string(),
                last_active: "2026-02-28T10:35:00Z".to_string(),
                message_count: 3,
                uptime_secs: 300,
            };

            let mut sessions = HashMap::new();
            sessions.insert(session.session_id.clone(), session);
            Self {
                sessions: Arc::new(StdMutex::new(sessions)),
            }
        }

        fn lock_sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, agent::SessionInfo>> {
            match self.sessions.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            }
        }
    }

    impl agent::Agent for TempSessionAgent {
        fn id(&self) -> &'static str {
            "temp-session"
        }

        fn name(&self) -> &'static str {
            "Temp Session Agent"
        }

        fn description(&self) -> &'static str {
            "用于会话端点 JSON 结构测试"
        }

        fn chat_stream(&self, request: agent::ChatRequest) -> BoxStream<'static, agent::ChatChunk> {
            stream::iter(vec![agent::ChatChunk::content_only(request.message)]).boxed()
        }

        fn list_sessions(&self) -> Vec<agent::SessionInfo> {
            let mut sessions = self.lock_sessions().values().cloned().collect::<Vec<_>>();
            sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
            sessions
        }

        fn get_session(&self, session_id: &str) -> Option<agent::SessionInfo> {
            self.lock_sessions().get(session_id).cloned()
        }

        fn close_session(&self, session_id: &str) -> bool {
            self.lock_sessions().remove(session_id).is_some()
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
        assert!(payload["total_memory_mb"].is_u64());
        assert!(payload["used_memory_mb"].is_u64());
    }

    #[tokio::test]
    async fn agents_endpoint_returns_builtin_agents() {
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
                    "id": "claude",
                    "name": "Claude Agent",
                    "description": "通过 Claude Code CLI 提供流式对话",
                    "status": "available"
                },
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
    async fn agents_endpoint_sets_cors_header_for_browser_fetch() {
        const TEST_PORT: u16 = 3004;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .header("origin", "http://127.0.0.1:1420")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .and_then(|value| value.to_str().ok()),
            Some("*")
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
        const TEST_PORT: u16 = 3003;
        let response = app(TEST_PORT)
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
    async fn sessions_endpoint_returns_empty_array_for_echo_agent() {
        const TEST_PORT: u16 = 3005;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/echo/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::OK, response.status());
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(payload, serde_json::json!([]));
    }

    #[tokio::test]
    async fn claude_stats_endpoint_returns_default_zero_snapshot() {
        const TEST_PORT: u16 = 3005;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/claude/stats")
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
                "session_id": null,
                "session_count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "message_count": 0,
                "uptime_secs": 0,
                "total_cost_usd": 0.0
            })
        );
    }

    #[tokio::test]
    async fn claude_stats_endpoint_returns_not_found_for_unknown_session_id() {
        const TEST_PORT: u16 = 3006;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/claude/stats?session_id=session-404")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn unknown_agent_sessions_returns_not_found() {
        const TEST_PORT: u16 = 3006;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/not-found/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn unknown_session_detail_returns_not_found() {
        const TEST_PORT: u16 = 3007;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .uri("/agents/echo/sessions/missing-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn close_unknown_session_returns_not_found() {
        const TEST_PORT: u16 = 3008;
        let response = app(TEST_PORT)
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/agents/echo/sessions/missing-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(StatusCode::NOT_FOUND, response.status());
    }

    #[tokio::test]
    async fn session_endpoints_return_expected_json_payloads() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempSessionAgent::new_with_one_session()));

        let router = routes::router().with_state(AppState {
            port: 3009,
            registry: registry.clone(),
            signal_pool: Arc::new(signal::SignalPool::new(None)),
        });

        let list_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, list_response.status());
        let list_body = list_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let list_payload: Value = serde_json::from_slice(&list_body).unwrap();
        assert_eq!(
            list_payload,
            serde_json::json!([
                {
                    "session_id": "temp-session-1",
                    "status": "idle",
                    "created_at": "2026-02-28T10:30:00Z",
                    "last_active": "2026-02-28T10:35:00Z",
                    "message_count": 3,
                    "uptime_secs": 300
                }
            ])
        );

        let get_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions/temp-session-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, get_response.status());
        let get_body = get_response.into_body().collect().await.unwrap().to_bytes();
        let get_payload: Value = serde_json::from_slice(&get_body).unwrap();
        assert_eq!(
            get_payload,
            serde_json::json!({
                "session_id": "temp-session-1",
                "status": "idle",
                "created_at": "2026-02-28T10:30:00Z",
                "last_active": "2026-02-28T10:35:00Z",
                "message_count": 3,
                "uptime_secs": 300
            })
        );

        let delete_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/agents/temp-session/sessions/temp-session-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::OK, delete_response.status());
        let delete_body = delete_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let delete_payload: Value = serde_json::from_slice(&delete_body).unwrap();
        assert_eq!(
            delete_payload,
            serde_json::json!({
                "status": "closed",
                "session_id": "temp-session-1"
            })
        );

        let after_close_response = router
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions/temp-session-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::NOT_FOUND, after_close_response.status());
    }

    #[tokio::test]
    async fn unknown_session_on_existing_agent_returns_not_found() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempSessionAgent::new_with_one_session()));

        let router = routes::router().with_state(AppState {
            port: 3010,
            registry,
            signal_pool: Arc::new(signal::SignalPool::new(None)),
        });

        let get_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/agents/temp-session/sessions/not-found")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::NOT_FOUND, get_response.status());

        let delete_response = router
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/agents/temp-session/sessions/not-found")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(StatusCode::NOT_FOUND, delete_response.status());
    }

    #[tokio::test]
    async fn agents_endpoint_reflects_runtime_register_and_unregister() {
        let registry = agent::AgentRegistry::new();
        registry.register(Arc::new(TempRouteAgent));

        let router = routes::router().with_state(AppState {
            port: 3003,
            registry: registry.clone(),
            signal_pool: Arc::new(signal::SignalPool::new(None)),
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
