//! QuotaMonitor HTTP API endpoints.
//!
//! Routes:
//!   GET  /quota              → all models (live fetch)
//!   GET  /quota/{model}     → specific model (live)
//!   POST /quota/check        → force refresh all models
//!   POST /quota/disable      → stop polling
//!   POST /quota/enable       → resume polling

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::plugins::quota::ModelQuota;
use crate::AppState;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct QuotaStatusResponse {
    enabled: bool,
    warning_threshold: u32,
    heartbeat_interval_minutes: u32,
    /// None if no API key is configured or fetch failed.
    models: Option<Vec<ModelQuota>>,
}

#[derive(Debug, Serialize)]
struct QuotaCheckResponse {
    models: Vec<ModelQuota>,
    query_time_ms: u64,
}

#[derive(Debug, Deserialize)]
struct EnableRequest {
    #[serde(default = "default_true")]
    enabled: bool,
}

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /quota — all models current quota (live fetch).
async fn get_quota(State(state): State<AppState>) -> Json<QuotaStatusResponse> {
    let monitor_guard = state.quota_monitor.lock().await;
    let monitor = match monitor_guard.as_ref() {
        Some(m) => m,
        None => {
            return Json(QuotaStatusResponse {
                enabled: false,
                warning_threshold: 1000,
                heartbeat_interval_minutes: 5,
                models: None,
            });
        }
    };

    let enabled = monitor.is_polling_enabled().await;
    let models = match monitor.check_quota().await {
        Ok(m) => Some(m),
        Err(e) => {
            tracing::warn!("GET /quota: check_quota failed: {}", e);
            None
        }
    };

    Json(QuotaStatusResponse {
        enabled,
        warning_threshold: 1000,
        heartbeat_interval_minutes: 5,
        models,
    })
}

/// GET /quota/{model} — live quota for a specific model.
async fn get_quota_model(
    Path(model): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ModelQuota>, StatusCode> {
    let monitor_guard = state.quota_monitor.lock().await;
    let monitor = monitor_guard.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;

    let models = monitor.check_quota().await.map_err(|e| {
        tracing::warn!("GET /quota/{}: check_quota failed: {}", model, e);
        StatusCode::BAD_GATEWAY
    })?;

    models
        .into_iter()
        .find(|m| m.model_name == model)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// POST /quota/check — force-refresh all model quotas.
async fn post_quota_check(State(state): State<AppState>) -> Result<Json<QuotaCheckResponse>, StatusCode> {
    let monitor_guard = state.quota_monitor.lock().await;
    let monitor = monitor_guard.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;

    let start = std::time::Instant::now();
    let models = monitor.check_quota().await.map_err(|e| {
        tracing::warn!("POST /quota/check: check_quota failed: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    Ok(Json(QuotaCheckResponse {
        models,
        query_time_ms: start.elapsed().as_millis() as u64,
    }))
}

/// POST /quota/disable — stop polling.
async fn post_quota_disable(State(state): State<AppState>) -> Result<Json<()>, StatusCode> {
    let monitor_guard = state.quota_monitor.lock().await;
    let monitor = monitor_guard.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    monitor.set_polling_enabled(false).await;
    tracing::info!("/quota/disable: polling disabled");
    Ok(Json(()))
}

/// POST /quota/enable — resume polling.
async fn post_quota_enable(
    State(state): State<AppState>,
    Json(req): Json<EnableRequest>,
) -> Result<Json<()>, StatusCode> {
    let monitor_guard = state.quota_monitor.lock().await;
    let monitor = monitor_guard.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    monitor.set_polling_enabled(req.enabled).await;
    tracing::info!("/quota/enable: polling_enabled={}", req.enabled);
    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/quota", get(get_quota))
        .route("/quota/check", post(post_quota_check))
        .route("/quota/disable", post(post_quota_disable))
        .route("/quota/enable", post(post_quota_enable))
        .route("/quota/{model}", get(get_quota_model))
}
