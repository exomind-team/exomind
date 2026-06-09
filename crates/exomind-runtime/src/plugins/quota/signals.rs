//! Signal payload types for QuotaMonitor plugin.
//!
//! These types are published to and consumed from the SignalPool.

use serde::{Deserialize, Serialize};

/// Per-model quota snapshot returned by the MiniMax API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelQuota {
    /// Raw model identifier, e.g. "MiniMax-M*".
    pub model_name: String,
    /// Human-readable display name, e.g. "MiniMax-M2.7-highspeed".
    pub display_name: String,
    /// Remaining calls in the current interval (e.g. hourly/daily).
    pub interval_remains: u32,
    /// Total calls allowed in the current interval.
    pub interval_total: u32,
    /// Milliseconds until the interval resets.
    pub interval_reset_in_ms: u64,
    /// Remaining calls in the current weekly window.
    pub weekly_remains: u32,
    /// Total calls allowed in the current weekly window.
    pub weekly_total: u32,
    /// Milliseconds until the weekly window resets.
    pub weekly_reset_in_ms: u64,
}

/// Periodic heartbeat published by QuotaMonitor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaHeartbeatPayload {
    pub timestamp_ms: u64,
    pub models: Vec<ModelQuota>,
}

/// Warning published when a model's interval_remains falls below the threshold.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaWarningPayload {
    pub model_name: String,
    pub remains: u32,
    pub threshold: u32,
    pub interval_reset_in_ms: u64,
}

/// Critical alert published when a model's interval_remains reaches zero.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaExhaustedPayload {
    pub model_name: String,
    pub interval_reset_in_ms: u64,
}

/// Response published after an on-demand quota check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaCheckedPayload {
    pub model_name: String,
    pub remains: u32,
    pub query_time_ms: u64,
}

/// Error published when an API call fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaErrorPayload {
    pub model_name: Option<String>,
    pub error: String,
}
