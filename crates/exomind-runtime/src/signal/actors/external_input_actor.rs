use std::sync::Arc;

use tracing::warn;

use crate::signal::types::SignalEvent;
use crate::signal::SignalPool;

const EXTERNAL_INPUT_RECEIVED_TOPIC: &str = "external.input.received";
const USER_INPUT_NORMALIZED_TOPIC: &str = "user.input.normalized";
const EXTERNAL_INPUT_INGESTED_TOPIC: &str = "external.input.ingested";

pub fn spawn_external_input_actor(pool: Arc<SignalPool>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.topic != EXTERNAL_INPUT_RECEIVED_TOPIC {
                        continue;
                    }
                    handle_external_input(&pool, &event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "external_input_actor: broadcast receiver lagged, skipped {n} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("external_input_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn handle_external_input(pool: &SignalPool, event: &SignalEvent) {
    let payload = match event.payload.as_object() {
        Some(payload) => payload,
        None => {
            warn!(
                event_id = %event.id,
                "external_input_actor: payload is not an object, skipping"
            );
            return;
        }
    };

    let text = payload
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let url = payload
        .get("url")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let effective_text = match text.or(url) {
        Some(value) => value,
        None => {
            warn!(
                event_id = %event.id,
                "external_input_actor: no usable text or url, skipping"
            );
            return;
        }
    };

    let source_type = payload
        .get("source_type")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let sender = payload
        .get("sender")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let chatroom_id = payload
        .get("chatroom_id")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let dedup_key = payload
        .get("dedup_key")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    let capture_source = if let Some(chatroom_id) = chatroom_id {
        format!("{source_type}:{chatroom_id}")
    } else if let Some(sender) = sender {
        format!("{source_type}:{sender}")
    } else {
        source_type.to_string()
    };

    let now_ms = chrono::Utc::now().timestamp_millis() as u64;

    let normalized_event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: USER_INPUT_NORMALIZED_TOPIC.to_string(),
        ts: now_ms,
        source: "actor:external_input".to_string(),
        origin_host_id: event.origin_host_id.clone(),
        hop: event.hop + 1,
        trace_id: event.trace_id.clone(),
        payload: serde_json::json!({
            "text": effective_text,
            "rawText": text.unwrap_or(effective_text),
            "inputMode": "external",
            "captureSource": capture_source,
            "externalMeta": {
                "sourceType": source_type,
                "sender": sender,
                "originalTimestamp": payload.get("original_timestamp").cloned().unwrap_or(serde_json::Value::Null),
                "chatroomId": chatroom_id,
                "mediaType": payload.get("media_type").cloned().unwrap_or(serde_json::Value::Null),
                "url": url,
                "dedupKey": dedup_key,
            }
        }),
    };
    pool.publish(normalized_event);

    let ingested_event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: EXTERNAL_INPUT_INGESTED_TOPIC.to_string(),
        ts: now_ms,
        source: "actor:external_input".to_string(),
        origin_host_id: event.origin_host_id.clone(),
        hop: event.hop + 1,
        trace_id: event.trace_id.clone(),
        payload: serde_json::json!({
            "dedupKey": dedup_key,
            "sourceType": source_type,
            "ts": now_ms,
        }),
    };
    pool.publish(ingested_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(topic: &str, payload: serde_json::Value) -> SignalEvent {
        SignalEvent {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            topic: topic.to_string(),
            ts: chrono::Utc::now().timestamp_millis() as u64,
            source: "test:external".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 2,
            trace_id: Some("trace-external-1".to_string()),
            payload,
        }
    }

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    async fn recv_next(
        rx: &mut tokio::sync::broadcast::Receiver<SignalEvent>,
    ) -> SignalEvent {
        tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for signal")
            .expect("should receive signal")
    }

    #[tokio::test]
    async fn text_external_input_produces_normalized_and_ingested_signals() {
        let pool = Arc::new(SignalPool::new(None));
        let _handle = spawn_external_input_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_event(
            EXTERNAL_INPUT_RECEIVED_TOPIC,
            serde_json::json!({
                "source_type": "wechat",
                "sender": "Alice",
                "text": "来自微信群的新消息",
                "media_type": "text",
                "original_timestamp": 1234567890000_u64,
                "chatroom_id": "room-1",
                "dedup_key": "wechat-room-1-1",
            }),
        ));

        let first = recv_next(&mut rx).await;
        assert_eq!(first.topic, EXTERNAL_INPUT_RECEIVED_TOPIC);

        let second = recv_next(&mut rx).await;
        assert_eq!(second.topic, USER_INPUT_NORMALIZED_TOPIC);
        assert_eq!(second.source, "actor:external_input");
        assert_eq!(second.trace_id, Some("trace-external-1".to_string()));
        assert_eq!(second.hop, 3);
        assert_eq!(second.payload["text"], "来自微信群的新消息");
        assert_eq!(second.payload["rawText"], "来自微信群的新消息");
        assert_eq!(second.payload["inputMode"], "external");
        assert_eq!(second.payload["captureSource"], "wechat:room-1");
        assert_eq!(second.payload["externalMeta"]["sourceType"], "wechat");
        assert_eq!(second.payload["externalMeta"]["sender"], "Alice");
        assert_eq!(
            second.payload["externalMeta"]["originalTimestamp"],
            serde_json::json!(1234567890000_u64)
        );
        assert_eq!(second.payload["externalMeta"]["chatroomId"], "room-1");
        assert_eq!(second.payload["externalMeta"]["mediaType"], "text");
        assert_eq!(second.payload["externalMeta"]["dedupKey"], "wechat-room-1-1");

        let third = recv_next(&mut rx).await;
        assert_eq!(third.topic, EXTERNAL_INPUT_INGESTED_TOPIC);
        assert_eq!(third.source, "actor:external_input");
        assert_eq!(third.trace_id, Some("trace-external-1".to_string()));
        assert_eq!(third.hop, 3);
        assert_eq!(third.payload["dedupKey"], "wechat-room-1-1");
        assert_eq!(third.payload["sourceType"], "wechat");
        assert!(third.payload["ts"].is_number());
    }

    #[tokio::test]
    async fn link_external_input_uses_url_as_text_when_text_missing() {
        let pool = Arc::new(SignalPool::new(None));
        let _handle = spawn_external_input_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_event(
            EXTERNAL_INPUT_RECEIVED_TOPIC,
            serde_json::json!({
                "source_type": "telegram",
                "sender": "Bob",
                "url": "https://example.com/hello",
                "media_type": "link",
                "original_timestamp": 1234567890001_u64,
                "dedup_key": "telegram-bob-1",
            }),
        ));

        let _first = recv_next(&mut rx).await;
        let second = recv_next(&mut rx).await;
        assert_eq!(second.topic, USER_INPUT_NORMALIZED_TOPIC);
        assert_eq!(second.payload["text"], "https://example.com/hello");
        assert_eq!(second.payload["rawText"], "https://example.com/hello");
        assert_eq!(second.payload["captureSource"], "telegram:Bob");
        assert_eq!(second.payload["externalMeta"]["url"], "https://example.com/hello");
    }

    #[tokio::test]
    async fn missing_text_and_url_skips_output_signals() {
        let pool = Arc::new(SignalPool::new(None));
        let _handle = spawn_external_input_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_event(
            EXTERNAL_INPUT_RECEIVED_TOPIC,
            serde_json::json!({
                "source_type": "clipboard",
                "sender": "self",
                "media_type": "text",
                "dedup_key": "clipboard-1",
            }),
        ));

        let first = recv_next(&mut rx).await;
        assert_eq!(first.topic, EXTERNAL_INPUT_RECEIVED_TOPIC);

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(result.is_err(), "missing text/url should not publish any derived signal");
    }

    #[tokio::test]
    async fn other_topics_are_ignored() {
        let pool = Arc::new(SignalPool::new(None));
        let _handle = spawn_external_input_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_event(
            "user.input.text",
            serde_json::json!({
                "text": "plain input"
            }),
        ));

        let first = recv_next(&mut rx).await;
        assert_eq!(first.topic, "user.input.text");

        let result = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(result.is_err(), "non external topic should not publish any derived signal");
    }
}
