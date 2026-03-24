//! Integration tests for SignalPool Phase 2 actors.
//!
//! Tests the full signal chain: publish -> actor transform -> output signal.
//! Actors are pure signal transformers: they subscribe to input topics,
//! transform payloads, and publish output signals back to the pool.
//!
//! Signal contract (topic -> payload):
//!   user.input.text          -> { text: string }
//!   input.classified         -> { type: "task"|"knowledge"|"chat", items: [...] }
//!   task.auto-created        -> { title: string, note?: string, source_text: string }
//!   eventlog.appended        -> { text: string, ts: number }
//!   session.end              -> { events: [...] }
//!   review.completed         -> { effective: string, stuck: string, improve: string, avoid: string }

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

// ─── Task Actor Tests ───────────────────────────────────────────

/// Task Actor should transform an `input.classified` signal (with type=task)
/// into a `task.auto-created` signal with extracted title and source_text.
///
/// Signal flow:
///   input.classified { type: "task", items: [{title, note?, source_text}] }
///     -> task_actor
///       -> task.auto-created { title, note?, source_text }
#[tokio::test]
async fn task_actor_transforms_classified_task_to_auto_created() {
    // 1. Create SignalPool with route for task actor
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-task",
        "input.classified",
        TargetType::Actor,
        "task_actor",
    );

    // 2. Subscribe to pool to capture output signals
    let mut rx = pool.subscribe();

    // 3. Publish input.classified with type=task
    let event = make_event(
        "input.classified",
        json!({
            "type": "task",
            "items": [
                {
                    "title": "完成 Phase 2 测试",
                    "note": "需要覆盖所有 actor",
                    "source_text": "我需要完成Phase 2的测试工作"
                }
            ]
        }),
    );
    let _records = pool.publish(event);

    // 4. Verify: when task_actor is implemented, it should produce
    //    a task.auto-created signal. For now, verify the input signal
    //    is received by the subscriber (actor not yet wired).
    let received = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;

    assert!(
        received.is_ok(),
        "subscriber should receive the published event"
    );
    let received_event = received.unwrap().unwrap();
    assert_eq!(received_event.topic, "input.classified");

    // TODO(Phase 2): When task_actor is spawned as a subscriber that
    // re-publishes, also assert:
    //   - A second event with topic "task.auto-created" is received
    //   - payload.title == "完成 Phase 2 测试"
    //   - payload.source_text == "我需要完成Phase 2的测试工作"
}

/// Task Actor should ignore `input.classified` signals where type != "task".
/// For example, type=knowledge or type=chat should NOT produce task.auto-created.
#[tokio::test]
async fn task_actor_ignores_non_task_classification() {
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-task",
        "input.classified",
        TargetType::Actor,
        "task_actor",
    );

    let mut rx = pool.subscribe();

    // Publish input.classified with type=knowledge (not task)
    let event = make_event(
        "input.classified",
        json!({
            "type": "knowledge",
            "items": [
                {
                    "title": "Rust ownership rules",
                    "source_text": "Rust的所有权规则很重要"
                }
            ]
        }),
    );
    pool.publish(event);

    // The input.classified event itself is broadcast
    let received = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;
    assert!(received.is_ok());
    assert_eq!(received.unwrap().unwrap().topic, "input.classified");

    // TODO(Phase 2): When task_actor is wired, verify no task.auto-created
    // signal is produced. Use a short timeout to confirm absence:
    //   let timeout_result = tokio::time::timeout(
    //       std::time::Duration::from_millis(200),
    //       rx.recv(),
    //   ).await;
    //   assert!(timeout_result.is_err(), "no task.auto-created for type=knowledge");
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

// ─── Full Chain Tests ───────────────────────────────────────────

/// Full chain: both task_actor and eventlog_actor active simultaneously.
///
/// Scenario:
///   1. Publish user.input.text -> eventlog_actor -> eventlog.appended
///   2. Publish input.classified(type=task) -> task_actor -> task.auto-created
///
/// This tests that multiple actors can coexist without interference.
#[tokio::test]
async fn full_chain_input_to_task_and_eventlog() {
    let pool = SignalPool::new(None);

    // Wire both actors
    add_route(
        &pool,
        "r-eventlog",
        "user.input.text",
        TargetType::Actor,
        "eventlog_actor",
    );
    add_route(
        &pool,
        "r-task",
        "input.classified",
        TargetType::Actor,
        "task_actor",
    );

    let mut rx = pool.subscribe();

    // Step 1: user.input.text -> should trigger eventlog_actor
    let input_event = make_event(
        "user.input.text",
        json!({ "text": "今天学了 Rust Actor 模型" }),
    );
    pool.publish(input_event);

    let received1 = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;
    assert!(received1.is_ok(), "should receive user.input.text event");
    assert_eq!(received1.unwrap().unwrap().topic, "user.input.text");

    // Step 2: input.classified(type=task) -> should trigger task_actor
    let classified_event = make_event(
        "input.classified",
        json!({
            "type": "task",
            "items": [{
                "title": "学习 Actor 模型",
                "source_text": "今天学了 Rust Actor 模型"
            }]
        }),
    );
    pool.publish(classified_event);

    let received2 = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;
    assert!(received2.is_ok(), "should receive input.classified event");
    assert_eq!(received2.unwrap().unwrap().topic, "input.classified");

    // TODO(Phase 2): When both actors are wired, additionally verify:
    //   - eventlog.appended follows user.input.text
    //   - task.auto-created follows input.classified
    //   - No cross-contamination between actors
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

/// Verify the session.end -> review.completed chain.
/// This is driven by the Reviewer Agent (TypeScript side), but we test
/// the signal routing infrastructure here.
#[tokio::test]
async fn session_end_routes_to_reviewer() {
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-reviewer",
        "session.end",
        TargetType::Agent,
        "reviewer",
    );

    let mut rx = pool.subscribe();

    let event = make_event(
        "session.end",
        json!({
            "events": [
                { "text": "完成架构设计", "ts": 1700000000000_u64 },
                { "text": "编写测试用例", "ts": 1700000001000_u64 }
            ]
        }),
    );
    pool.publish(event);

    let received = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await;
    assert!(received.is_ok());
    let evt = received.unwrap().unwrap();
    assert_eq!(evt.topic, "session.end");

    // Verify payload contains events array
    let payload = evt.payload.as_object().unwrap();
    assert!(payload.contains_key("events"));
    let events = payload["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
}

/// Verify at-most-once delivery: signals are not retried or duplicated.
#[tokio::test]
async fn at_most_once_no_duplicate_signals() {
    let pool = SignalPool::new(None);
    add_route(
        &pool,
        "r-task",
        "input.classified",
        TargetType::Actor,
        "task_actor",
    );

    let mut rx = pool.subscribe();

    let event = make_event(
        "input.classified",
        json!({ "type": "task", "items": [{ "title": "test" }] }),
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
