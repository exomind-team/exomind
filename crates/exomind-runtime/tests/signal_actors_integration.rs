//! Integration tests for SignalPool Phase 2 actors.
//!
//! Tests the full signal chain: publish -> actor transform -> output signal.
//! Actors are pure signal transformers: they subscribe to input topics,
//! transform payloads, and publish output signals back to the pool.
//!
//! Signal contract (topic -> payload):
//!   user.input.text          -> { text: string }
//!   eventlog.appended        -> { text: string, ts: number }

use exomind_runtime::signal::SignalPool;
use exomind_runtime::signal::types::{SignalEvent, SignalRoute, TargetType};
use serde_json::json;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Helper: construct a test SignalEvent with the given topic and payload.
fn make_event(topic: &str, payload: serde_json::Value) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        topic: topic.to_string(),
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        source: "test".to_string(),
        origin_host_id: "test-host".to_string(),
        hop: 0,
        trace_id: None,
        payload,
    }
}

/// Helper: add a route to the pool's route table.
fn add_route(pool: &SignalPool, id: &str, topic: &str, target_type: TargetType, target_ref: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    pool.routes()
        .add(SignalRoute {
            id: id.to_string(),
            enabled: true,
            topic: topic.to_string(),
            target_type,
            target_ref: target_ref.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
        .unwrap();
}

async fn yield_for_actor() {
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
}

// ─── EventLog Actor Tests ───────────────────────────────────────

/// EventLog Actor should transform `user.input.text` into `eventlog.appended`.
///
/// Signal flow:
///   user.input.text { text: "..." }
///     -> eventlog_actor
///       -> eventlog.appended { text: "...", ts: <epoch_ms> }
#[tokio::test]
async fn eventlog_actor_transforms_user_input_to_appended() {
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-eventlog",
        "user.input.text",
        TargetType::Actor,
        "eventlog_actor",
    );

    let mut rx = pool.subscribe();

    // Publish user.input.text
    let event = make_event(
        "user.input.text",
        json!({
            "text": "今天完成了架构设计"
        }),
    );
    pool.publish(event);

    // Verify input event is received
    let received = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;
    assert!(received.is_ok());
    let received_event = received.unwrap().unwrap();
    assert_eq!(received_event.topic, "user.input.text");

    // TODO(Phase 2): When eventlog_actor is spawned, also assert:
    //   - A second event with topic "eventlog.appended" is received
    //   - payload.text == "今天完成了架构设计"
    //   - payload.ts is a valid epoch millisecond timestamp
}

/// EventLog Actor should only react to `user.input.text`, not other topics.
#[tokio::test]
async fn eventlog_actor_ignores_other_topics() {
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-eventlog",
        "user.input.text",
        TargetType::Actor,
        "eventlog_actor",
    );

    let mut rx = pool.subscribe();

    // Publish input.classified (not user.input.text)
    let event = make_event(
        "input.classified",
        json!({
            "type": "task",
            "items": [{"title": "test"}]
        }),
    );
    pool.publish(event);

    // The event is broadcast (wildcard or no route match)
    // but eventlog_actor should NOT produce eventlog.appended

    // TODO(Phase 2): When eventlog_actor is wired:
    //   - Verify no eventlog.appended signal is produced
    //   - Only the original input.classified should be in the stream
    let received = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;

    // If received, it should be the original event, not an eventlog.appended
    if let Ok(Ok(evt)) = received {
        assert_ne!(
            evt.topic, "eventlog.appended",
            "eventlog_actor should not react to input.classified"
        );
    }
}

#[tokio::test]
async fn voice_transcript_is_normalized_before_eventlog_append() {
    let pool = Arc::new(SignalPool::new(None));
    let _ingest = exomind_runtime::signal::actors::input_ingest_actor::spawn_input_ingest_actor(
        Arc::clone(&pool),
    );
    let _eventlog =
        exomind_runtime::signal::actors::eventlog_actor::spawn_eventlog_actor(Arc::clone(&pool));
    yield_for_actor().await;

    let mut rx = pool.subscribe();
    pool.publish(make_event(
        "voice.input.transcript",
        json!({
            "text": "今天继续推进 issue 511",
            "transcript": "今天继续推进 issue 511",
            "inputMode": "voice",
            "captureSource": "global-shortcut",
            "targetScope": "agent-chat",
        }),
    ));

    let mut topics = Vec::new();
    for _ in 0..3 {
        let event = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for voice ingest chain")
            .expect("should receive signal");
        topics.push(event.topic.clone());
        if event.topic == "user.input.normalized" {
            assert_eq!(event.payload["text"], "今天继续推进 issue 511");
            assert_eq!(event.payload["inputMode"], "voice");
            assert_eq!(event.payload["captureSource"], "global-shortcut");
        }
        if event.topic == "eventlog.appended" {
            assert_eq!(event.payload["text"], "今天继续推进 issue 511");
            assert_eq!(event.payload["inputMode"], "voice");
            assert_eq!(event.payload["captureSource"], "global-shortcut");
        }
    }

    assert!(topics.iter().any(|topic| topic == "voice.input.transcript"));
    assert!(topics.iter().any(|topic| topic == "user.input.normalized"));
    assert!(topics.iter().any(|topic| topic == "eventlog.appended"));
}

#[tokio::test]
async fn external_input_is_normalized_before_eventlog_append() {
    let pool = Arc::new(SignalPool::new(None));
    let _external_input =
        exomind_runtime::signal::actors::external_input_actor::spawn_external_input_actor(
            Arc::clone(&pool),
        );
    let _eventlog =
        exomind_runtime::signal::actors::eventlog_actor::spawn_eventlog_actor(Arc::clone(&pool));
    yield_for_actor().await;

    let mut rx = pool.subscribe();
    pool.publish(make_event(
        "external.input.received",
        json!({
            "source_type": "wechat",
            "sender": "wxid-test",
            "text": "外部输入进入 EventLog",
            "media_type": "text",
            "original_timestamp": 1773809500000_u64,
            "chatroom_id": "room-external",
            "dedup_key": "room-external:1:1"
        }),
    ));

    let mut topics = Vec::new();
    for _ in 0..4 {
        let event = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("timeout waiting for external ingest chain")
            .expect("should receive signal");
        topics.push(event.topic.clone());
        if event.topic == "user.input.normalized" {
            assert_eq!(event.payload["text"], "外部输入进入 EventLog");
            assert_eq!(event.payload["inputMode"], "external");
            assert_eq!(event.payload["captureSource"], "wechat:room-external");
        }
        if event.topic == "eventlog.appended" {
            assert_eq!(event.payload["text"], "外部输入进入 EventLog");
            assert_eq!(event.payload["inputMode"], "external");
            assert_eq!(event.payload["captureSource"], "wechat:room-external");
        }
    }

    assert!(
        topics
            .iter()
            .any(|topic| topic == "external.input.received")
    );
    assert!(topics.iter().any(|topic| topic == "user.input.normalized"));
    assert!(
        topics
            .iter()
            .any(|topic| topic == "external.input.ingested")
    );
    assert!(topics.iter().any(|topic| topic == "eventlog.appended"));
}

/// Verify at-most-once delivery: signals are not retried or duplicated.
#[tokio::test]
async fn at_most_once_no_duplicate_signals() {
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-eventlog",
        "user.input.text",
        TargetType::Actor,
        "eventlog_actor",
    );

    let mut rx = pool.subscribe();

    let event = make_event(
        "user.input.text",
        json!({ "text": "test" }),
    );
    let event_id = event.id.clone();
    pool.publish(event);

    // Collect all events within a short window
    let mut received_ids = Vec::new();
    loop {
        match tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await {
            Ok(Ok(evt)) => received_ids.push(evt.id),
            _ => break,
        }
    }

    // The original event should appear exactly once
    let count = received_ids.iter().filter(|id| **id == event_id).count();
    assert_eq!(count, 1, "at-most-once: event should not be duplicated");
}
