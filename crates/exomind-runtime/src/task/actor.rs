use std::sync::Arc;

use serde::Deserialize;
use tracing::warn;

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

use super::store::TaskStore;
use super::types::CreateTaskInput;

/// Payload shape on "task.auto-created" signals (from task_classifier_actor).
#[derive(Debug, Deserialize)]
struct AutoCreatedPayload {
    title: String,
    note: Option<String>,
}

/// Spawn the Task Store Actor as a background tokio task.
///
/// Subscribes to `task.auto-created` signals and persists them into the TaskStore,
/// then publishes `task.created` so downstream consumers (frontend SSE, other actors)
/// are notified.
pub fn spawn_task_store_actor(
    pool: Arc<SignalPool>,
    store: Arc<TaskStore>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    // Only process task.auto-created from the classifier pipeline.
                    if event.topic != "task.auto-created" {
                        continue;
                    }
                    // Skip our own output to prevent loops.
                    if event.source == "actor:task_store" {
                        continue;
                    }
                    handle_auto_created(&pool, &store, &event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "task_store_actor: broadcast receiver lagged, skipped {n} events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("task_store_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn handle_auto_created(pool: &SignalPool, store: &TaskStore, event: &SignalEvent) {
    let parsed: AutoCreatedPayload = match serde_json::from_value(event.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            warn!(
                event_id = %event.id,
                error = %e,
                "task_store_actor: failed to parse task.auto-created payload"
            );
            return;
        }
    };

    let task = store.create(CreateTaskInput {
        title: parsed.title,
        description: parsed.note,
        done_condition: None,
        priority: None,
        tags: vec![],
        source: Some("classifier".to_string()),
        parent_id: None,
        depends_on: vec![],
        due_at: None,
        estimated_minutes: None,
        time_block_ids: vec![],
    });

    let created_event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: "task.created".to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "actor:task_store".to_string(),
        origin_host_id: event.origin_host_id.clone(),
        hop: event.hop + 1,
        trace_id: event.trace_id.clone(),
        payload: serde_json::to_value(&task).unwrap_or_default(),
    };

    pool.publish(created_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_auto_created_event(title: &str, note: Option<&str>) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "task.auto-created".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "actor:task".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 1,
            trace_id: Some("trace-1".to_string()),
            payload: serde_json::json!({
                "title": title,
                "note": note,
            }),
        }
    }

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn auto_created_persists_to_store() {
        let pool = Arc::new(SignalPool::new(None));
        let store = Arc::new(TaskStore::new());

        let _handle = spawn_task_store_actor(Arc::clone(&pool), Arc::clone(&store));
        yield_for_actor().await;

        let mut rx = pool.subscribe();

        let event = make_auto_created_event("Buy milk", Some("2%"));
        pool.publish(event);

        // Receive: original event, then task.created
        let first = rx.recv().await.unwrap();
        assert_eq!(first.topic, "task.auto-created");

        let second = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            rx.recv(),
        )
        .await
        .expect("timeout")
        .expect("recv");
        assert_eq!(second.topic, "task.created");
        assert_eq!(second.source, "actor:task_store");

        // Verify store
        assert_eq!(store.len(), 1);
        let tasks = store.list();
        assert_eq!(tasks[0].title, "Buy milk");
        assert_eq!(tasks[0].description.as_deref(), Some("2%"));
        assert_eq!(tasks[0].source.as_deref(), Some("classifier"));
    }

    #[tokio::test]
    async fn ignores_non_auto_created_topics() {
        let pool = Arc::new(SignalPool::new(None));
        let store = Arc::new(TaskStore::new());

        let _handle = spawn_task_store_actor(Arc::clone(&pool), Arc::clone(&store));
        yield_for_actor().await;

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

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(store.len(), 0);
    }

    #[tokio::test]
    async fn ignores_own_output() {
        let pool = Arc::new(SignalPool::new(None));
        let store = Arc::new(TaskStore::new());

        let _handle = spawn_task_store_actor(Arc::clone(&pool), Arc::clone(&store));
        yield_for_actor().await;

        // Simulate a signal from ourselves
        let event = SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: "task.auto-created".to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "actor:task_store".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: None,
            payload: serde_json::json!({"title": "Loop", "note": null}),
        };
        pool.publish(event);

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(store.len(), 0, "should not process own signals");
    }
}
