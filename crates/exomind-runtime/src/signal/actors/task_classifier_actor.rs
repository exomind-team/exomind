use std::sync::Arc;

use serde::Deserialize;
use tracing::warn;

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

/// A single classified item of type "task".
#[derive(Debug, Deserialize)]
struct TaskItem {
    title: String,
    note: Option<String>,
}

/// The expected payload shape on "input.classified" signals (task type only).
#[derive(Debug, Deserialize)]
struct ClassifiedPayload {
    items: Vec<TaskItem>,
}

/// Spawn the Task Actor as a background tokio task.
///
/// The actor subscribes to the SignalPool broadcast channel, filters for
/// `input.classified` events with `type == "task"`, and re-publishes each
/// task item as a `task.auto-created` signal.
pub fn spawn_task_actor(pool: Arc<SignalPool>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.topic != "input.classified" {
                        continue;
                    }
                    handle_classified_event(&pool, &event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "task_actor: broadcast receiver lagged, skipped {n} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("task_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn handle_classified_event(pool: &SignalPool, event: &SignalEvent) {
    // Check type first to avoid spurious parse warnings for non-task classifications.
    let kind = match event.payload.get("type").and_then(|v| v.as_str()) {
        Some(k) => k,
        None => {
            warn!(event_id = %event.id, "task_actor: missing 'type' field in payload");
            return;
        }
    };

    if kind != "task" {
        return;
    }

    // Now safe to parse — we know type == "task" and items should be Vec<TaskItem>.
    let parsed: ClassifiedPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!(
                event_id = %event.id,
                error = %e,
                "task_actor: failed to parse task payload items"
            );
            return;
        }
    };

    // Extract the original source text for provenance, if available.
    let source_text = event
        .payload
        .get("source_text")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    for item in &parsed.items {
        let new_event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "task.auto-created".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "actor:task".to_string(),
            origin_host_id: event.origin_host_id.clone(),
            hop: event.hop + 1,
            trace_id: event.trace_id.clone(),
            payload: serde_json::json!({
                "title": item.title,
                "note": item.note,
                "source_text": source_text,
            }),
        };

        pool.publish(new_event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::SignalPool;
    use std::sync::Arc;

    fn make_classified_event(kind: &str, items: serde_json::Value) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "input.classified".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "agent:classifier".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 1,
            trace_id: Some("trace-1".to_string()),
            payload: serde_json::json!({
                "type": kind,
                "items": items,
            }),
        }
    }

    /// Yield to let the spawned actor task start and subscribe.
    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn task_type_produces_task_auto_created() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_task_actor(Arc::clone(&pool));
        yield_for_actor().await;

        // Subscribe AFTER actor so we only see events published after this point
        let mut rx = pool.subscribe();

        let event = make_classified_event(
            "task",
            serde_json::json!([
                { "title": "Buy milk", "note": "2%" },
                { "title": "Call dentist" }
            ]),
        );
        pool.publish(event);

        // We should receive:
        // 1. The original input.classified event (broadcast)
        // 2. task.auto-created for "Buy milk"
        // 3. task.auto-created for "Call dentist"

        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "input.classified");

        let second = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for first task")
            .expect("should receive first task");
        assert_eq!(second.topic, "task.auto-created");
        assert_eq!(second.source, "actor:task");
        assert_eq!(second.payload["title"], "Buy milk");
        assert_eq!(second.payload["note"], "2%");
        assert_eq!(second.trace_id, Some("trace-1".to_string()));

        let third = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for second task")
            .expect("should receive second task");
        assert_eq!(third.topic, "task.auto-created");
        assert_eq!(third.payload["title"], "Call dentist");
        assert!(third.payload["note"].is_null());
    }

    #[tokio::test]
    async fn knowledge_type_does_not_produce_task() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_task_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        let event = make_classified_event(
            "knowledge",
            serde_json::json!([{ "topic": "Rust", "content": "ownership" }]),
        );
        pool.publish(event);

        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "input.classified");

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(result.is_err(), "should not receive any more events");
    }

    #[tokio::test]
    async fn log_type_does_not_produce_task() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_task_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        let event = make_classified_event("log", serde_json::json!([{ "text": "woke up at 7am" }]));
        pool.publish(event);

        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "input.classified");

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(result.is_err(), "should not receive any more events");
    }

    #[tokio::test]
    async fn malformed_payload_does_not_panic() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_task_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        let bad_event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "input.classified".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!("this is not a valid classified payload"),
        };
        pool.publish(bad_event);

        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "input.classified");

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(result.is_err(), "should not receive any more events");
    }

    #[tokio::test]
    async fn non_classified_topic_is_ignored() {
        let pool = Arc::new(SignalPool::new(None));

        let _handle = spawn_task_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        let event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "user.input.text".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({"text": "hello"}),
        };
        pool.publish(event);

        let first = rx.recv().await.expect("should receive original event");
        assert_eq!(first.topic, "user.input.text");

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(result.is_err(), "should not receive any more events");
    }
}
