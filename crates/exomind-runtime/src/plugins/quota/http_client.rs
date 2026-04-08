//! Minimal HTTP client for the MiniMax quota/remain API.

use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Deserialize;

use super::signals::ModelQuota;

const API_URL: &str =
    "https://www.minimax.io/v1/api/openplatform/coding_plan/remains";

/// Convert raw MiniMax model name to a human-readable display name.
pub fn resolve_display_name(model_name: &str) -> String {
    match model_name {
        "MiniMax-M*" => "MiniMax-M2.7-highspeed".to_string(),
        "speech-hd" => "MiniMax Speech-HD".to_string(),
        n if n.contains("Hailuo-2.3-Fast") => "MiniMax Hailuo 2.3 Fast".to_string(),
        n if n.contains("Hailuo") => "MiniMax Hailuo 2.3".to_string(),
        "music-2.5" => "MiniMax Music 2.5".to_string(),
        "image-01" => "MiniMax Image-01".to_string(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// MiniMax API response shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct MiniMaxResponse {
    model_remains: Vec<MiniMaxModelRemain>,
    #[allow(dead_code)]
    base_resp: BaseResp,
}

#[derive(Debug, Deserialize)]
struct MiniMaxModelRemain {
    model_name: String,
    current_interval_total_count: u32,
    /// ⚠️  MiniMax actually returns the *remaining* count here, not usage.
    current_interval_usage_count: u32,
    remains_time: u64,
    current_weekly_total_count: u32,
    /// ⚠️  MiniMax actually returns the *remaining* count here, not usage.
    current_weekly_usage_count: u32,
    #[serde(rename = "weekly_remains_time")]
    weekly_remains_time: u64,
}

#[derive(Debug, Deserialize)]
struct BaseResp {
    #[allow(dead_code)]
    status_code: i32,
    #[allow(dead_code)]
    status_msg: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Fetch quota data for all models. Returns `Err` on network or parse failure.
pub async fn check_remains(api_key: &str) -> Result<Vec<ModelQuota>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    let resp = client
        .get(API_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header("Accept", "application/json")
        .header("Referer", "https://www.minimax.io/")
        .header("Origin", "https://www.minimax.io")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let elapsed_ms = start.elapsed().as_millis() as u64;
    tracing::trace!("MiniMax quota API returned in {elapsed_ms}ms");

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status} (body: {body})"));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let data: MiniMaxResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    let quotas = data
        .model_remains
        .into_iter()
        .map(|m| ModelQuota {
            model_name: m.model_name.clone(),
            display_name: resolve_display_name(&m.model_name),
            // current_interval_usage_count is actually the remaining count
            interval_remains: m.current_interval_usage_count,
            interval_total: m.current_interval_total_count,
            interval_reset_in_ms: m.remains_time,
            // current_weekly_usage_count is actually the remaining count
            weekly_remains: m.current_weekly_usage_count,
            weekly_total: m.current_weekly_total_count,
            weekly_reset_in_ms: m.weekly_remains_time,
        })
        .collect();

    Ok(quotas)
}
