use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::env;
use thiserror::Error;

pub mod routes;

pub const RUNTIME_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug)]
pub struct RuntimeState {
    pub port: u16,
}

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
    Router::<RuntimeState>::new()
        .route("/health", get(health))
        .merge(routes::router())
        .with_state(RuntimeState { port: runtime_port })
}

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
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::util::ServiceExt;

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
}
