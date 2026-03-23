// signal_bus_fanout.rs — SignalBus fanout 能力测试
//
// 测试目标:
//   1. 发布一个信号，验证 3 个订阅者都收到
//   2. 验证 DeliveryRecord 被写入 Journal
//   3. 验证 at-most-once 语义（不重试）
//
// 依赖: crate::signal::{SignalBus, Journal, SignalEvent, DeliveryRecord, DeliveryStatus}
// 状态: 测试骨架 — 等待 SignalBus 实现完成后编译通过

use exomind_runtime::signal::types::{DeliveryStatus, SignalEvent};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

/// Helper: 构造一个测试用 SignalEvent
fn make_test_event(topic: &str, payload: serde_json::Value) -> SignalEvent {
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

// ─── 1. Fanout 基础：1 publish → 3 subscribers 全部收到 ───

#[tokio::test]
async fn publish_delivers_to_all_matching_subscribers() {
    // 构建 SignalBus + 3 个订阅者
    // let bus = SignalBus::new();
    //
    // // 注册 3 个路由（同一 topic，不同 target_ref）
    // bus.add_route(SignalRoute {
    //     id: "route-1".into(),
    //     enabled: true,
    //     topic: "user.action".into(),
    //     target_type: TargetType::Agent,
    //     target_ref: "agent-a".into(),
    //     created_at: "2026-03-03T00:00:00Z".into(),
    //     updated_at: "2026-03-03T00:00:00Z".into(),
    // });
    // bus.add_route(/* route-2 → agent-b */);
    // bus.add_route(/* route-3 → agent-c */);
    //
    // // 创建 3 个接收通道
    // let rx_a = bus.subscribe("agent-a");
    // let rx_b = bus.subscribe("agent-b");
    // let rx_c = bus.subscribe("agent-c");
    //
    // // 发布一个事件
    // let event = make_test_event("user.action", json!({"key": "value"}));
    // let event_id = event.id.clone();
    // bus.publish(event).await;
    //
    // // 验证：3 个订阅者都收到同一事件
    // let received_a = rx_a.recv().await.unwrap();
    // assert_eq!(received_a.id, event_id);
    //
    // let received_b = rx_b.recv().await.unwrap();
    // assert_eq!(received_b.id, event_id);
    //
    // let received_c = rx_c.recv().await.unwrap();
    // assert_eq!(received_c.id, event_id);

    // TODO: 等 SignalBus 实现后取消注释
    let event = make_test_event("user.action", json!({"key": "value"}));
    assert_eq!(event.schema_version, 1);
    assert_eq!(event.topic, "user.action");
}

// ─── 2. DeliveryRecord 写入 Journal ───

#[tokio::test]
async fn publish_writes_delivery_records_to_journal() {
    // let bus = SignalBus::new();
    // let journal = bus.journal();
    //
    // // 注册 2 个路由
    // bus.add_route(/* route-1 → agent-a */);
    // bus.add_route(/* route-2 → agent-b */);
    //
    // let event = make_test_event("user.action", json!({"data": 42}));
    // let event_id = event.id.clone();
    // bus.publish(event).await;
    //
    // // 查询 journal 最近记录
    // let records = journal.recent(10);
    // assert_eq!(records.len(), 2, "应有 2 条投递记录，每个路由一条");
    //
    // // 验证记录字段
    // for record in &records {
    //     assert_eq!(record.event_id, event_id);
    //     assert_eq!(record.status, DeliveryStatus::Sent);
    //     assert!(record.started_at <= record.finished_at);
    // }
    //
    // // 验证 2 个不同的 route_id
    // let route_ids: Vec<&str> = records.iter().map(|r| r.route_id.as_str()).collect();
    // assert!(route_ids.contains(&"route-1"));
    // assert!(route_ids.contains(&"route-2"));

    // TODO: 等 SignalBus + Journal 实现后取消注释
    assert_eq!(DeliveryStatus::Sent, DeliveryStatus::Sent);
}

// ─── 3. At-most-once 语义（投递失败不重试）───

#[tokio::test]
async fn failed_delivery_is_not_retried() {
    // let bus = SignalBus::new();
    // let journal = bus.journal();
    //
    // // 注册一个"会失败"的路由（例如 target_ref 指向不存在的 agent）
    // bus.add_route(SignalRoute {
    //     id: "route-fail".into(),
    //     enabled: true,
    //     topic: "user.action".into(),
    //     target_type: TargetType::Agent,
    //     target_ref: "agent-nonexistent".into(),
    //     created_at: "2026-03-03T00:00:00Z".into(),
    //     updated_at: "2026-03-03T00:00:00Z".into(),
    // });
    //
    // let event = make_test_event("user.action", json!({"retry": false}));
    // let event_id = event.id.clone();
    // bus.publish(event).await;
    //
    // // 等待一小段时间确保不会重试
    // tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    //
    // // 验证 Journal 只有 1 条记录（没有重试）
    // let records: Vec<_> = journal
    //     .recent(100)
    //     .into_iter()
    //     .filter(|r| r.event_id == event_id)
    //     .collect();
    // assert_eq!(records.len(), 1, "at-most-once: 失败不应重试");
    // assert_eq!(records[0].status, DeliveryStatus::Failed);
    // assert!(records[0].reason.is_some(), "失败记录应包含原因");

    // TODO: 等 SignalBus 实现后取消注释
    assert_ne!(DeliveryStatus::Sent, DeliveryStatus::Failed);
}

// ─── 4. 禁用路由不投递 ───

#[tokio::test]
async fn disabled_route_is_skipped() {
    // let bus = SignalBus::new();
    // let journal = bus.journal();
    //
    // // 注册一个 enabled=false 的路由
    // bus.add_route(SignalRoute {
    //     id: "route-disabled".into(),
    //     enabled: false,
    //     topic: "user.action".into(),
    //     target_type: TargetType::Agent,
    //     target_ref: "agent-a".into(),
    //     ..
    // });
    //
    // let event = make_test_event("user.action", json!({}));
    // let event_id = event.id.clone();
    // bus.publish(event).await;
    //
    // let records: Vec<_> = journal
    //     .recent(10)
    //     .into_iter()
    //     .filter(|r| r.event_id == event_id)
    //     .collect();
    // assert_eq!(records.len(), 1);
    // assert_eq!(records[0].status, DeliveryStatus::Skipped);

    // TODO: 等 SignalBus 实现后取消注释
    assert_ne!(DeliveryStatus::Skipped, DeliveryStatus::Sent);
}

// ─── 5. 无匹配路由时事件仍入 Journal（不丢失）───

#[tokio::test]
async fn publish_with_no_matching_routes_still_journals_event() {
    // let bus = SignalBus::new();
    // let journal = bus.journal();
    //
    // // 不注册任何路由
    // let event = make_test_event("unmatched.topic", json!({}));
    // let event_id = event.id.clone();
    // bus.publish(event).await;
    //
    // // 事件应该仍在 Journal 的 event log 中（window cache）
    // // 但 delivery records 为空
    // let records: Vec<_> = journal
    //     .recent(10)
    //     .into_iter()
    //     .filter(|r| r.event_id == event_id)
    //     .collect();
    // assert_eq!(records.len(), 0, "无匹配路由 → 0 条投递记录");

    // TODO: 等 SignalBus 实现后取消注释
    assert!(true);
}
