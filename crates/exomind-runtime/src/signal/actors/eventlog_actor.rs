use std::sync::Arc;

use tracing::warn;

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// Spawn the EventLog Actor as a background tokio task.
///
/// The actor subscribes to the SignalPool broadcast channel, filters for
/// `user.input.normalized` events, and re-publishes each as an `eventlog.appended`
/// signal containing the extracted text and a timestamp.
pub fn spawn_eventlog_actor(pool: Arc<SignalPool>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.topic != "user.input.normalized" {
                        continue;
                    }
                    handle_user_input(&pool, &event);
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

fn handle_user_input(pool: &SignalPool, event: &SignalEvent) {
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
}
