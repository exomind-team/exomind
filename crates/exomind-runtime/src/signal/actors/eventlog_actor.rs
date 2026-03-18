use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use std::sync::Arc;

use tracing::{debug, warn};

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// Sliding-window deduplication for eventlog writes.
///
/// When multiple ExoMind instances run simultaneously, each instance's
/// eventlog_actor independently receives the same voice input signal and
/// would write N duplicates for N instances. This window checks whether
/// identical content was already seen within the last [`DEDUP_WINDOW_SECS`]
/// seconds, and skips the duplicate publish.
const DEDUP_WINDOW_SECS: u64 = 5;
const DEDUP_WINDOW_MAX: usize = 100;

struct DedupWindow {
    entries: VecDeque<(u64, u64)>, // (timestamp_ms, content_hash)
}

impl DedupWindow {
    fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(DEDUP_WINDOW_MAX),
        }
    }

    /// Returns `true` if `text` at `ts_ms` is a duplicate of a recent entry.
    /// If not a duplicate, records it for future checks.
    fn is_duplicate(&mut self, ts_ms: u64, text: &str) -> bool {
        let hash = {
            let mut hasher = DefaultHasher::new();
            text.hash(&mut hasher);
            hasher.finish()
        };

        // Evict entries older than the dedup window
        while let Some(&(old_ts, _)) = self.entries.front() {
            if ts_ms.saturating_sub(old_ts) > DEDUP_WINDOW_SECS * 1000 {
                self.entries.pop_front();
            } else {
                break;
            }
        }

        // Check for duplicate
        let found = self.entries.iter().any(|&(_, h)| h == hash);

        if !found {
            if self.entries.len() >= DEDUP_WINDOW_MAX {
                self.entries.pop_front();
            }
            self.entries.push_back((ts_ms, hash));
        }

        found
    }
}

/// Spawn the EventLog Actor as a background tokio task.
///
/// The actor subscribes to the SignalPool broadcast channel, filters for
/// `user.input.normalized` events, and re-publishes each as an `eventlog.appended`
/// signal containing the extracted text and a timestamp.
///
/// A [`DedupWindow`] is used to skip duplicate content within a 5-second
/// sliding window, preventing multi-instance duplicate writes.
pub fn spawn_eventlog_actor(pool: Arc<SignalPool>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();
        let mut dedup = DedupWindow::new();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.topic != "user.input.normalized" {
                        continue;
                    }
                    handle_user_input(&pool, &event, &mut dedup);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "eventlog_actor: broadcast receiver lagged, skipped {n} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("eventlog_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn handle_user_input(pool: &SignalPool, event: &SignalEvent, dedup: &mut DedupWindow) {
    let text = match event.payload.get("text").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            warn!(
                event_id = %event.id,
                "eventlog_actor: payload missing 'text' field, skipping"
            );
            return;
        }
    };

    let now_ms = chrono::Utc::now().timestamp_millis() as u64;

    // Multi-instance dedup: skip if identical content was seen within the window
    if dedup.is_duplicate(now_ms, text) {
        debug!(
            event_id = %event.id,
            "eventlog_actor: duplicate content within dedup window, skipping"
        );
        return;
    }

    let new_event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "eventlog.appended".to_string(),
        ts: now_ms,
        source: "actor:eventlog".to_string(),
        origin_host_id: event.origin_host_id.clone(),
        hop: event.hop + 1,
        trace_id: event.trace_id.clone(),
        payload: serde_json::json!({
            "text": text,
            "ts": now_ms,
            "inputMode": event.payload.get("inputMode").cloned().unwrap_or(serde_json::Value::Null),
            "captureSource": event.payload.get("captureSource").cloned().unwrap_or(serde_json::Value::Null),
            "targetScope": event.payload.get("targetScope").cloned().unwrap_or(serde_json::Value::Null),
            "window": event.payload.get("window").cloned().unwrap_or(serde_json::Value::Null),
            "agentContext": event.payload.get("agentContext").cloned().unwrap_or(serde_json::Value::Null),
        }),
    };

    pool.publish(new_event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn make_user_input_event(text: &str) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "user.input.normalized".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: Some("trace-el-1".to_string()),
            payload: serde_json::json!({
                "text": text,
                "inputMode": "voice",
                "captureSource": "global-shortcut",
                "targetScope": "agent-chat",
            }),
        }
    }

    /// Yield to let the spawned actor task start and subscribe.
    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn user_input_text_produces_eventlog_appended() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_eventlog_actor(Arc::clone(&pool));
        yield_for_actor().await;

        // Subscribe AFTER actor so we only see events published after this point
        let mut rx = pool.subscribe();

        let event = make_user_input_event("hello world");
        pool.publish(event);

        // 1. The original user.input.normalized event (broadcast)
        let first = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            rx.recv(),
        )
        .await
        .expect("timeout waiting for original event")
        .expect("should receive original event");
        assert_eq!(first.topic, "user.input.normalized");

        // 2. eventlog.appended
        let second = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            rx.recv(),
        )
        .await
        .expect("timeout waiting for eventlog.appended")
        .expect("should receive eventlog.appended");
        assert_eq!(second.topic, "eventlog.appended");
        assert_eq!(second.source, "actor:eventlog");
        assert_eq!(second.payload["text"], "hello world");
        assert!(second.payload["ts"].is_number());
        assert_eq!(second.payload["inputMode"], "voice");
        assert_eq!(second.payload["captureSource"], "global-shortcut");
        assert_eq!(second.payload["targetScope"], "agent-chat");
        assert_eq!(second.trace_id, Some("trace-el-1".to_string()));
    }

    #[tokio::test]
    async fn other_topic_does_not_produce_eventlog() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_eventlog_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        let event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "input.classified".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({ "type": "task", "items": [] }),
        };
        pool.publish(event);

        // Should receive the original event only
        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "input.classified");

        // No more events
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            rx.recv(),
        )
        .await;
        assert!(result.is_err(), "should not receive any more events");
    }

    #[tokio::test]
    async fn payload_without_text_field_does_not_panic() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_eventlog_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        // Publish a user.input.normalized event but with no "text" field
        let bad_event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "user.input.normalized".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({ "audio": "base64data" }),
        };
        pool.publish(bad_event);

        // Should receive the original event, no panic, no extra events
        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "user.input.normalized");

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            rx.recv(),
        )
        .await;
        assert!(result.is_err(), "should not receive any more events");
    }

    // --- DedupWindow unit tests ---

    #[test]
    fn dedup_window_detects_duplicate_within_window() {
        let mut w = DedupWindow::new();
        let ts = 1000_u64;
        assert!(!w.is_duplicate(ts, "hello"), "first should not be dup");
        assert!(w.is_duplicate(ts + 100, "hello"), "same text within window should be dup");
    }

    #[test]
    fn dedup_window_allows_after_expiry() {
        let mut w = DedupWindow::new();
        let ts = 1000_u64;
        assert!(!w.is_duplicate(ts, "hello"));
        // 6 seconds later — outside the 5-second window
        assert!(!w.is_duplicate(ts + 6000, "hello"), "same text after window should not be dup");
    }

    #[test]
    fn dedup_window_different_content_not_dup() {
        let mut w = DedupWindow::new();
        let ts = 1000_u64;
        assert!(!w.is_duplicate(ts, "hello"));
        assert!(!w.is_duplicate(ts + 100, "world"), "different text should not be dup");
    }

    #[test]
    fn dedup_window_evicts_when_full() {
        let mut w = DedupWindow::new();
        // Fill the window to capacity
        for i in 0..DEDUP_WINDOW_MAX {
            assert!(!w.is_duplicate(1000, &format!("msg-{i}")));
        }
        assert_eq!(w.entries.len(), DEDUP_WINDOW_MAX);
        // One more should evict the oldest
        assert!(!w.is_duplicate(1000, "overflow"));
        assert_eq!(w.entries.len(), DEDUP_WINDOW_MAX);
    }

    #[tokio::test]
    async fn duplicate_input_within_window_is_skipped() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_eventlog_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        // Publish the same text twice in quick succession
        let event1 = make_user_input_event("duplicate text");
        let event2 = make_user_input_event("duplicate text");
        pool.publish(event1);
        pool.publish(event2);

        // We should see: user.input.normalized, eventlog.appended,
        //                user.input.normalized, (NO second eventlog.appended)
        let mut appended_count = 0;
        let mut total = 0;
        loop {
            let result = tokio::time::timeout(
                std::time::Duration::from_millis(500),
                rx.recv(),
            )
            .await;
            match result {
                Ok(Ok(ev)) => {
                    total += 1;
                    if ev.topic == "eventlog.appended" {
                        appended_count += 1;
                    }
                }
                _ => break,
            }
        }
        assert_eq!(appended_count, 1, "should only produce one eventlog.appended, got {appended_count} (total events: {total})");
    }
}
