//! QuotaMonitor plugin — MiniMax API quota polling and signalling.
//!
//! Runs as a background task inside the runtime process. Publishes quota state
//! to the SignalPool so other actors/agents can react to quota pressure.
//!
//! ## Signal contract
//!
//! **Outbound** (QuotaMonitor → SignalPool):
//!   - `quota.heartbeat`  → [`QuotaHeartbeatPayload`]  (periodic, all models)
//!   - `quota.warning`    → [`QuotaWarningPayload`]    (threshold breached)
//!   - `quota.exhausted`  → [`QuotaExhaustedPayload`] (interval_remains == 0)
//!   - `quota.checked`    → [`QuotaCheckedPayload`]    (on-demand check response)
//!   - `quota.error`      → [`QuotaErrorPayload`]     (API call failed)
//!
//! **Inbound** (SignalPool → QuotaMonitor):
//!   - `quota.check`   → trigger an on-demand check
//!   - `quota.disable` → stop polling

mod config_keys;
mod http_client;
mod signals;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc as StdArc;
use std::time::{Duration, Instant};

use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

pub use config_keys::config_keys as keys;
pub use http_client::{check_remains, resolve_display_name};
pub use signals::*;

// ---------------------------------------------------------------------------
// QuotaMonitor
// ---------------------------------------------------------------------------

pub struct QuotaMonitor {
    /// MiniMax API key (can be updated at runtime).
    api_key: RwLock<String>,
    signal_pool: StdArc<SignalPool>,
    /// Guard flag written by `stop()` and read by the background loop.
    running: StdArc<AtomicBool>,
    warning_threshold: RwLock<u32>,
    heartbeat_interval_minutes: RwLock<u32>,
    /// Atomic so the signal handler can flip it without needing async.
    polling_enabled: StdArc<AtomicBool>,
    /// Handle to the background task; written once by `start()`.
    task_handle: StdArc<Mutex<Option<JoinHandle<()>>>>,
}

impl QuotaMonitor {
    /// Construct a new monitor. Does **not** start the background loop —
    /// call `start()` afterwards.
    pub fn new(api_key: String, signal_pool: StdArc<SignalPool>) -> Self {
        Self {
            api_key: RwLock::new(api_key),
            signal_pool,
            running: StdArc::new(AtomicBool::new(false)),
            warning_threshold: RwLock::new(1000),
            heartbeat_interval_minutes: RwLock::new(5),
            polling_enabled: StdArc::new(AtomicBool::new(false)),
            task_handle: StdArc::new(Mutex::new(None)),
        }
    }

    /// Replace the API key at runtime.
    pub async fn update_api_key(&self, key: String) {
        *self.api_key.write().await = key;
    }

    pub async fn api_key(&self) -> String {
        self.api_key.read().await.clone()
    }

    /// Set the warning threshold (default: 1000).
    pub async fn set_warning_threshold(&self, threshold: u32) {
        *self.warning_threshold.write().await = threshold;
    }

    /// Set the heartbeat interval in minutes (default: 5).
    pub async fn set_heartbeat_interval(&self, minutes: u32) {
        *self.heartbeat_interval_minutes.write().await = minutes;
    }

    /// Enable or disable polling.
    pub async fn set_polling_enabled(&self, enabled: bool) {
        self.polling_enabled.store(enabled, Ordering::SeqCst);
    }

    pub async fn is_polling_enabled(&self) -> bool {
        self.polling_enabled.load(Ordering::SeqCst)
    }

    /// Check quota for all models and return the raw [`ModelQuota`] list.
    /// Does **not** publish signals.
    pub async fn check_quota(&self) -> Result<Vec<signals::ModelQuota>, String> {
        let key = self.api_key.read().await.clone();
        http_client::check_remains(&key).await
    }

    /// Start the background polling + signal subscription loop.
    /// Idempotent: calling `start()` twice will not spawn two tasks.
    pub async fn start(&self) {
        if self.running.load(Ordering::SeqCst) {
            warn!("QuotaMonitor: already running");
            return;
        }
        self.running.store(true, Ordering::SeqCst);
        self.polling_enabled.store(true, Ordering::SeqCst);

        // Snapshot config values before entering the spawned task.
        let api_key = StdArc::new(self.api_key.read().await.clone());
        let warning_threshold = *self.warning_threshold.read().await;
        let heartbeat_interval_minutes = *self.heartbeat_interval_minutes.read().await;
        let polling_enabled = StdArc::clone(&self.polling_enabled);
        let running = StdArc::clone(&self.running);
        let signal_pool = StdArc::clone(&self.signal_pool);
        let task_handle = StdArc::clone(&self.task_handle);

        let handle = tokio::spawn(async move {
            loop {
                if !running.load(Ordering::SeqCst) {
                    info!("QuotaMonitor: background loop stopping");
                    break;
                }

                // Fresh subscription each cycle (handles SignalPool recreation).
                let mut rx = signal_pool.subscribe();

                // Refresh interval from the live RwLock every outer-loop iteration.
                let check_interval_secs = {
                    let mins = heartbeat_interval_minutes;
                    (mins as u64).saturating_mul(60)
                };
                let check_interval = Duration::from_secs(check_interval_secs);
                let mut heartbeat_ticker = tokio::time::interval(check_interval);
                // Prime so the first tick fires immediately.
                let _ = heartbeat_ticker.tick().await;

                // Guard ticker: check the exit flag every 5 s.
                let mut guard_ticker = tokio::time::interval(Duration::from_secs(5));
                let _ = guard_ticker.tick().await;

                loop {
                    tokio::select! {
                        // ── Heartbeat tick ────────────────────────────────────
                        _ = heartbeat_ticker.tick() => {
                            if !running.load(Ordering::SeqCst) { break; }
                            if !polling_enabled.load(Ordering::SeqCst) { continue; }

                            let start = Instant::now();
                            match http_client::check_remains(&api_key).await {
                                Ok(models) => {
                                    let elapsed = start.elapsed().as_millis() as u64;

                                    for model in &models {
                                        if model.interval_remains == 0 {
                                            Self::publish_exhausted(&signal_pool, model);
                                        } else if model.interval_remains < warning_threshold {
                                            Self::publish_warning(
                                                &signal_pool,
                                                model,
                                                warning_threshold,
                                            );
                                        }
                                    }

                                    let payload = signals::QuotaHeartbeatPayload {
                                        timestamp_ms: Self::now_ms(),
                                        models,
                                    };
                                    Self::publish_heartbeat(&signal_pool, payload);
                                    tracing::trace!(
                                        "QuotaMonitor: heartbeat published (took {:?})",
                                        elapsed
                                    );
                                }
                                Err(e) => {
                                    error!("QuotaMonitor: heartbeat failed: {}", e);
                                    Self::publish_error(&signal_pool, None, e);
                                }
                            }
                        }

                        // ── Inbound signal ───────────────────────────────────
                        event = rx.recv() => {
                            match event {
                                Ok(evt) => {
                                    Self::handle_inbound_signal(
                                        &evt,
                                        &api_key,
                                        warning_threshold,
                                        &polling_enabled,
                                        &signal_pool,
                                    );
                                }
                                Err(broadcast::error::RecvError::Lagged(n)) => {
                                    warn!(
                                        "QuotaMonitor: rx lagged {} events, resubscribing",
                                        n
                                    );
                                    break;
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    info!("QuotaMonitor: SignalPool closed, stopping");
                                    running.store(false, Ordering::SeqCst);
                                    return;
                                }
                            }
                        }

                        // ── Guard ticker (exit check) ─────────────────────────
                        _ = guard_ticker.tick() => {
                            if !running.load(Ordering::SeqCst) { break; }
                        }
                    }
                }
                // Fell through lag/guard break → re-subscribe.
            }
        });

        *task_handle.lock().await = Some(handle);
        info!("QuotaMonitor: started");
    }

    /// Stop the background loop gracefully.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        info!("QuotaMonitor: stop signal sent");
    }

    // ---------------------------------------------------------------------------
    // Signal helpers
    // ---------------------------------------------------------------------------

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    fn origin_host_id() -> String {
        std::env::var("EXOMIND_RT_HOST_ID")
            .unwrap_or_else(|_| format!("rt-{}", uuid::Uuid::new_v4().to_string()))
    }

    fn make_event(topic: &str, payload: serde_json::Value) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: Self::now_ms(),
            source: "quota-monitor".to_string(),
            origin_host_id: Self::origin_host_id(),
            hop: 0,
            trace_id: None,
            payload,
        }
    }

    fn publish_heartbeat(
        pool: &StdArc<SignalPool>,
        payload: signals::QuotaHeartbeatPayload,
    ) {
        let evt =
            Self::make_event("quota.heartbeat", serde_json::to_value(payload).unwrap_or_default());
        pool.publish(evt);
    }

    fn publish_warning(
        pool: &StdArc<SignalPool>,
        model: &signals::ModelQuota,
        threshold: u32,
    ) {
        let payload = signals::QuotaWarningPayload {
            model_name: model.model_name.clone(),
            remains: model.interval_remains,
            threshold,
            interval_reset_in_ms: model.interval_reset_in_ms,
        };
        let evt =
            Self::make_event("quota.warning", serde_json::to_value(payload).unwrap_or_default());
        pool.publish(evt);
    }

    fn publish_exhausted(pool: &StdArc<SignalPool>, model: &signals::ModelQuota) {
        let payload = signals::QuotaExhaustedPayload {
            model_name: model.model_name.clone(),
            interval_reset_in_ms: model.interval_reset_in_ms,
        };
        let evt = Self::make_event(
            "quota.exhausted",
            serde_json::to_value(payload).unwrap_or_default(),
        );
        pool.publish(evt);
    }

    fn publish_checked(
        pool: &StdArc<SignalPool>,
        model: &signals::ModelQuota,
        query_time_ms: u64,
    ) {
        let payload = signals::QuotaCheckedPayload {
            model_name: model.model_name.clone(),
            remains: model.interval_remains,
            query_time_ms,
        };
        let evt =
            Self::make_event("quota.checked", serde_json::to_value(payload).unwrap_or_default());
        pool.publish(evt);
    }

    fn publish_error(pool: &StdArc<SignalPool>, model_name: Option<String>, error: String) {
        let payload = signals::QuotaErrorPayload { model_name, error };
        let evt =
            Self::make_event("quota.error", serde_json::to_value(payload).unwrap_or_default());
        pool.publish(evt);
    }

    fn handle_inbound_signal(
        evt: &SignalEvent,
        api_key: &StdArc<String>,
        warning_threshold: u32,
        polling_enabled: &StdArc<AtomicBool>,
        signal_pool: &StdArc<SignalPool>,
    ) {
        match evt.topic.as_str() {
            "quota.check" => {
                let start = Instant::now();
                let key = api_key.as_ref().clone();

                match tokio::runtime::Handle::current()
                    .block_on(http_client::check_remains(&key))
                {
                    Ok(models) => {
                        let elapsed_ms = start.elapsed().as_millis() as u64;
                        for model in &models {
                            Self::publish_checked(signal_pool, model, elapsed_ms);
                            if model.interval_remains == 0 {
                                Self::publish_exhausted(signal_pool, model);
                            } else if model.interval_remains < warning_threshold {
                                Self::publish_warning(signal_pool, model, warning_threshold);
                            }
                        }
                        tracing::trace!(
                            "QuotaMonitor: processed quota.check ({} models)",
                            models.len()
                        );
                    }
                    Err(e) => {
                        error!("QuotaMonitor: quota.check failed: {}", e);
                        Self::publish_error(signal_pool, None, e);
                    }
                }
            }
            "quota.disable" => {
                polling_enabled.store(false, Ordering::SeqCst);
                info!("QuotaMonitor: polling disabled via signal");
            }
            _ => {}
        }
    }
}

impl Drop for QuotaMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}
