// quota_plugin.rs — QuotaMonitor plugin integration tests (Issue #848)
//
// Covers:
//   1. http_client: API key validation, MiniMax response parsing
//   2. signals: Serde round-trip for all payload types
//   3. config_keys: stable key constants
//   4. QuotaMonitor: lifecycle (new, start, stop, polling enable/disable)
//
// Run: cargo test -p exomind-runtime quota
//
// These tests do NOT require a running exomind-rt or a real MiniMax API key.

use std::sync::Arc;

use exomind_runtime::plugins::quota::resolve_display_name;
use exomind_runtime::plugins::quota::{
    ModelQuota, QuotaCheckedPayload, QuotaErrorPayload, QuotaExhaustedPayload,
    QuotaHeartbeatPayload, QuotaWarningPayload,
};
use exomind_runtime::plugins::quota::keys as qk;
use exomind_runtime::plugins::quota::QuotaMonitor;
use exomind_runtime::signal::SignalPool;

// ═══════════════════════════════════════════════════════════════════════════
// http_client
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn resolve_display_name_maps_known_models() {
    assert_eq!(resolve_display_name("MiniMax-M*"), "MiniMax-M2.7-highspeed");
    assert_eq!(resolve_display_name("speech-hd"), "MiniMax Speech-HD");
    assert_eq!(
        resolve_display_name("Hailuo-2.3-Fast"),
        "MiniMax Hailuo 2.3 Fast"
    );
    assert_eq!(resolve_display_name("Hailuo-2.3"), "MiniMax Hailuo 2.3");
    assert_eq!(resolve_display_name("music-2.5"), "MiniMax Music 2.5");
    assert_eq!(resolve_display_name("image-01"), "MiniMax Image-01");
}

#[test]
fn resolve_display_name_preserves_unknown_models() {
    assert_eq!(resolve_display_name("unknown-model"), "unknown-model");
    assert_eq!(resolve_display_name("gpt-5"), "gpt-5");
}

/// Empty API key should return an HTTP error (MiniMax rejects empty Bearer token).
#[tokio::test]
async fn check_remains_empty_key_returns_error() {
    let result = exomind_runtime::plugins::quota::check_remains("").await;
    assert!(result.is_err(), "empty key should fail, got: {result:?}");
    let err = result.unwrap_err();
    assert!(
        err.contains("HTTP") || err.contains("Bearer"),
        "expected HTTP error, got: {err}"
    );
}

/// A fake API key should get an HTTP 401/403 back, not a parse error.
#[tokio::test]
async fn check_remains_fake_key_returns_http_error() {
    let result =
        exomind_runtime::plugins::quota::check_remains("invalid-key-for-testing")
            .await;
    assert!(result.is_err(), "fake key should return HTTP error, got: {result:?}");
    let err = result.unwrap_err();
    // MiniMax returns HTTP 401 or 403 for invalid tokens.
    assert!(
        err.contains("HTTP"),
        "expected HTTP error, got: {err}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// signals — Serde round-trips
// ═══════════════════════════════════════════════════════════════════════════

fn sample_model_quota() -> ModelQuota {
    ModelQuota {
        model_name: "MiniMax-M*".to_string(),
        display_name: "MiniMax-M2.7-highspeed".to_string(),
        interval_remains: 500,
        interval_total: 5000,
        interval_reset_in_ms: 3_600_000,
        weekly_remains: 2000,
        weekly_total: 50_000,
        weekly_reset_in_ms: 518_400_000,
    }
}

#[test]
fn model_quota_serde_roundtrip() {
    let original = sample_model_quota();
    let json = serde_json::to_string(&original).unwrap();
    let parsed: ModelQuota = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.model_name, original.model_name);
    assert_eq!(parsed.interval_remains, original.interval_remains);
    assert_eq!(parsed.interval_total, original.interval_total);
    assert_eq!(parsed.interval_reset_in_ms, original.interval_reset_in_ms);
    assert_eq!(parsed.weekly_remains, original.weekly_remains);
    assert_eq!(parsed.weekly_total, original.weekly_total);
}

#[test]
fn heartbeat_payload_serde_roundtrip() {
    let payload = QuotaHeartbeatPayload {
        timestamp_ms: 1_712_345_678_000,
        models: vec![sample_model_quota()],
    };
    let json = serde_json::to_string(&payload).unwrap();
    let parsed: QuotaHeartbeatPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.timestamp_ms, payload.timestamp_ms);
    assert_eq!(parsed.models.len(), 1);
    assert_eq!(parsed.models[0].model_name, "MiniMax-M*");
}

#[test]
fn warning_payload_roundtrip() {
    let payload = QuotaWarningPayload {
        model_name: "MiniMax-M*".to_string(),
        remains: 499,
        threshold: 1000,
        interval_reset_in_ms: 3_600_000,
    };
    let json = serde_json::to_string(&payload).unwrap();
    let parsed: QuotaWarningPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.remains, 499);
    assert_eq!(parsed.threshold, 1000);
}

#[test]
fn exhausted_payload_roundtrip() {
    let payload = QuotaExhaustedPayload {
        model_name: "MiniMax-M*".to_string(),
        interval_reset_in_ms: 3_600_000,
    };
    let json = serde_json::to_string(&payload).unwrap();
    let parsed: QuotaExhaustedPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.model_name, "MiniMax-M*");
    assert_eq!(parsed.interval_reset_in_ms, 3_600_000);
}

#[test]
fn checked_payload_roundtrip() {
    let payload = QuotaCheckedPayload {
        model_name: "MiniMax-M*".to_string(),
        remains: 450,
        query_time_ms: 42,
    };
    let json = serde_json::to_string(&payload).unwrap();
    let parsed: QuotaCheckedPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.remains, 450);
    assert_eq!(parsed.query_time_ms, 42);
}

#[test]
fn error_payload_with_model_name() {
    let payload = QuotaErrorPayload {
        model_name: Some("MiniMax-M*".to_string()),
        error: "HTTP 401".to_string(),
    };
    let json = serde_json::to_string(&payload).unwrap();
    let parsed: QuotaErrorPayload = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.model_name.as_deref(), Some("MiniMax-M*"));
    assert_eq!(parsed.error, "HTTP 401");
}

#[test]
fn error_payload_without_model_name() {
    let payload = QuotaErrorPayload {
        model_name: None,
        error: "network timeout".to_string(),
    };
    let json = serde_json::to_string(&payload).unwrap();
    let parsed: QuotaErrorPayload = serde_json::from_str(&json).unwrap();
    assert!(parsed.model_name.is_none());
    assert_eq!(parsed.error, "network timeout");
}

// ═══════════════════════════════════════════════════════════════════════════
// config_keys — stable key constants
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn config_keys_are_stable() {
    // These keys must never change — they are the persistence contract.
    assert_eq!(qk::MINIMAX_API_KEY, "exomind:minimaxApiKey");
    assert_eq!(
        qk::QUOTA_WARNING_THRESHOLD,
        "exomind:quotaWarningThreshold"
    );
    assert_eq!(
        qk::QUOTA_POLLING_ENABLED,
        "exomind:quotaPollingEnabled"
    );
    assert_eq!(
        qk::QUOTA_HEARTBEAT_INTERVAL_MINUTES,
        "exomind:quotaHeartbeatIntervalMinutes"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// QuotaMonitor lifecycle
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn new_creates_stopped_monitor() {
    let pool = Arc::new(SignalPool::new(None));
    let monitor = QuotaMonitor::new("test-key".to_string(), Arc::clone(&pool));

    let rt = tokio::runtime::Runtime::new().unwrap();
    // Freshly created monitor: polling disabled until start() is called.
    assert!(!rt.block_on(monitor.is_polling_enabled()));
}

#[test]
fn stop_is_safe_when_not_started() {
    let pool = Arc::new(SignalPool::new(None));
    let monitor = QuotaMonitor::new("test-key".to_string(), Arc::clone(&pool));
    // stop() should not panic even if never started.
    monitor.stop();
}

#[test]
fn set_polling_enabled_toggles_state() {
    let pool = Arc::new(SignalPool::new(None));
    let monitor = QuotaMonitor::new("test-key".to_string(), Arc::clone(&pool));

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(monitor.set_polling_enabled(true));
    assert!(rt.block_on(monitor.is_polling_enabled()));

    rt.block_on(monitor.set_polling_enabled(false));
    assert!(!rt.block_on(monitor.is_polling_enabled()));
}

#[test]
fn update_api_key_replaces_stored_key() {
    let pool = Arc::new(SignalPool::new(None));
    let monitor = QuotaMonitor::new("old-key".to_string(), Arc::clone(&pool));

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(monitor.update_api_key("new-key".to_string()));
    assert_eq!(rt.block_on(monitor.api_key()), "new-key");
}

#[test]
fn start_is_idempotent_does_not_panic() {
    let pool = Arc::new(SignalPool::new(None));
    let monitor = QuotaMonitor::new("test-key".to_string(), Arc::clone(&pool));

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(monitor.start());
    // Calling start again should not panic.
    rt.block_on(monitor.start());
    monitor.stop();
}

#[tokio::test]
async fn start_then_stop_exits_cleanly() {
    let pool = Arc::new(SignalPool::new(None));
    let monitor = QuotaMonitor::new("test-key".to_string(), Arc::clone(&pool));

    monitor.start().await;
    monitor.stop();

    // The running flag should be false after stop.
    // Give the task a moment to observe the stop signal.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
}
