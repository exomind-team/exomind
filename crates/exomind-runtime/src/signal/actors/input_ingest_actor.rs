use std::sync::Arc;

use tracing::warn;

use crate::signal::SignalPool;
use crate::signal::types::SignalEvent;

const VOICE_INPUT_TRANSCRIPT_TOPIC: &str = "voice.input.transcript";
const USER_INPUT_TEXT_TOPIC: &str = "user.input.text";
const USER_INPUT_NORMALIZED_TOPIC: &str = "user.input.normalized";

pub fn spawn_input_ingest_actor(pool: Arc<SignalPool>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = pool.subscribe();

        loop {
            match rx.recv().await {
                Ok(event) => {
                    if event.topic != VOICE_INPUT_TRANSCRIPT_TOPIC
                        && event.topic != USER_INPUT_TEXT_TOPIC
                    {
                        continue;
                    }
                    handle_input_event(&pool, &event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "input_ingest_actor: broadcast receiver lagged, skipped {n} events"
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    warn!("input_ingest_actor: broadcast channel closed, shutting down");
                    break;
                }
            }
        }
    })
}

fn handle_input_event(pool: &SignalPool, event: &SignalEvent) {
    let text = match event.payload.get("text").and_then(|value| value.as_str()) {
        Some(text) if !text.trim().is_empty() => text.trim(),
        _ => {
            warn!(
                event_id = %event.id,
                topic = %event.topic,
                "input_ingest_actor: payload missing 'text' field, skipping"
            );
            return;
        }
    };

    let input_mode = event
        .payload
        .get("inputMode")
        .cloned()
        .unwrap_or_else(|| {
            serde_json::Value::String(
                if event.topic == VOICE_INPUT_TRANSCRIPT_TOPIC {
                    "voice"
                } else {
                    "text"
                }
                .to_string(),
            )
        });

    let raw_text = event
        .payload
        .get("rawText")
        .cloned()
        .or_else(|| event.payload.get("transcript").cloned())
        .unwrap_or_else(|| serde_json::Value::String(text.to_string()));

    let capture_source = event
        .payload
        .get("captureSource")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::String(event.source.clone()));

    let mut payload = serde_json::Map::new();
    payload.insert("text".to_string(), serde_json::Value::String(text.to_string()));
    payload.insert("rawText".to_string(), raw_text);
    payload.insert("inputMode".to_string(), input_mode);
    payload.insert("captureSource".to_string(), capture_source);

    for key in [
        "traceId",
        "lang",
        "confidence",
        "duration",
        "durationMs",
        "targetScope",
        "window",
        "agentContext",
    ] {
        if let Some(value) = event.payload.get(key) {
            payload.insert(key.to_string(), value.clone());
        }
    }

    let normalized_event = SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: USER_INPUT_NORMALIZED_TOPIC.to_string(),
        ts: chrono::Utc::now().timestamp_millis() as u64,
        source: "actor:input_ingest".to_string(),
        origin_host_id: event.origin_host_id.clone(),
        hop: event.hop + 1,
        trace_id: event.trace_id.clone(),
        payload: serde_json::Value::Object(payload),
    };

    pool.publish(normalized_event);
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
            source: "test-source".to_string(),
            origin_host_id: "host-test".to_string(),
            hop: 0,
            trace_id: Some("trace-input-1".to_string()),
            payload,
        }
    }

    async fn yield_for_actor() {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn voice_transcript_produces_normalized_input() {
        let pool = Arc::new(SignalPool::new(None));
        let _handle = spawn_input_ingest_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_event(
            VOICE_INPUT_TRANSCRIPT_TOPIC,
            serde_json::json!({
                "text": "你好 ExoMind",
                "transcript": "你好 ExoMind",
                "inputMode": "voice",
                "captureSource": "global-shortcut",
                "targetScope": "agent-chat",
            }),
        ));

        let first = rx.recv().await.expect("should receive original voice transcript");
        assert_eq!(first.topic, VOICE_INPUT_TRANSCRIPT_TOPIC);

        let second = rx.recv().await.expect("should receive normalized input");
        assert_eq!(second.topic, USER_INPUT_NORMALIZED_TOPIC);
        assert_eq!(second.source, "actor:input_ingest");
        assert_eq!(second.trace_id, Some("trace-input-1".to_string()));
        assert_eq!(second.payload["text"], "你好 ExoMind");
        assert_eq!(second.payload["inputMode"], "voice");
        assert_eq!(second.payload["captureSource"], "global-shortcut");
        assert_eq!(second.payload["targetScope"], "agent-chat");
    }

    #[tokio::test]
    async fn text_input_defaults_to_text_mode() {
        let pool = Arc::new(SignalPool::new(None));
        let _handle = spawn_input_ingest_actor(Arc::clone(&pool));
        yield_for_actor().await;

        let mut rx = pool.subscribe();
        pool.publish(make_event(
            USER_INPUT_TEXT_TOPIC,
            serde_json::json!({
                "text": "plain input",
            }),
        ));

        let first = rx.recv().await.expect("should receive original input");
        assert_eq!(first.topic, USER_INPUT_TEXT_TOPIC);

        let second = rx.recv().await.expect("should receive normalized input");
        assert_eq!(second.topic, USER_INPUT_NORMALIZED_TOPIC);
        assert_eq!(second.payload["text"], "plain input");
        assert_eq!(second.payload["inputMode"], "text");
        assert_eq!(second.payload["captureSource"], "test-source");
    }
}
