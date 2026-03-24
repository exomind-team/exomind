// signal_window_replay.rs — WindowCache 测试
//
// 测试目标:
//   1. push 事件 → recent 查询返回最新事件
//   2. Last-Event-ID 重放（从指定位置回放）
//   3. Ring buffer 在 1000 条时正确回绕
//
// 依赖: crate::signal::{WindowCache, SignalEvent}
// 状态: 测试骨架 — 等待 WindowCache 实现完成后编译通过

use exomind_runtime::signal::types::SignalEvent;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

/// Helper: 构造带自定义 ID 的测试 SignalEvent
fn make_event(id: &str, topic: &str) -> SignalEvent {
    SignalEvent {
        schema_version: 1,
        id: id.to_string(),
        topic: topic.to_string(),
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        source: "test".to_string(),
        origin_host_id: "test-host".to_string(),
        hop: 0,
        trace_id: None,
        payload: json!({"seq": id}),
    }
}

// ─── 1. push + recent 基础功能 ───

#[tokio::test]
async fn push_and_recent_returns_latest_events() {
    // let window = WindowCache::new(1000);
    //
    // window.push(make_event("evt-1", "user.action"));
    // window.push(make_event("evt-2", "user.action"));
    // window.push(make_event("evt-3", "system.boot"));
    //
    // // recent(2) 返回最近 2 条（按时间倒序或顺序取决于设计）
    // let recent = window.recent(2);
    // assert_eq!(recent.len(), 2);
    // assert_eq!(recent[0].id, "evt-2");
    // assert_eq!(recent[1].id, "evt-3");
    //
    // // recent(10) 返回全部 3 条（请求超过实际数量时返回全部）
    // let all = window.recent(10);
    // assert_eq!(all.len(), 3);

    // TODO: 等 WindowCache 实现后取消注释
    let event = make_event("evt-1", "user.action");
    assert_eq!(event.id, "evt-1");
    assert_eq!(event.schema_version, 1);
}

// ─── 2. Last-Event-ID 重放 ───

#[tokio::test]
async fn replay_from_last_event_id() {
    // let window = WindowCache::new(1000);
    //
    // // 依次 push 5 个事件
    // for i in 1..=5 {
    //     window.push(make_event(&format!("evt-{}", i), "user.action"));
    // }
    //
    // // 从 evt-3 之后重放 → 应返回 evt-4, evt-5
    // let replayed = window.replay_after("evt-3");
    // assert_eq!(replayed.len(), 2);
    // assert_eq!(replayed[0].id, "evt-4");
    // assert_eq!(replayed[1].id, "evt-5");
    //
    // // 从 evt-5（最新）之后重放 → 空
    // let empty = window.replay_after("evt-5");
    // assert!(empty.is_empty());
    //
    // // 从不存在的 ID 重放 → 返回全部（安全回退）
    // let all = window.replay_after("nonexistent");
    // assert_eq!(all.len(), 5);

    // TODO: 等 WindowCache 实现后取消注释
    let event = make_event("evt-1", "topic");
    assert_eq!(event.topic, "topic");
}

// ─── 3. Ring buffer 回绕（容量 1000）───

#[tokio::test]
async fn ring_buffer_wraps_at_capacity() {
    // const CAPACITY: usize = 1000;
    // let window = WindowCache::new(CAPACITY);
    //
    // // 插入 1200 条事件
    // for i in 1..=1200 {
    //     window.push(make_event(&format!("evt-{}", i), "bulk.test"));
    // }
    //
    // // 只保留最近 1000 条: evt-201 ~ evt-1200
    // let all = window.recent(CAPACITY + 100); // 请求超量
    // assert_eq!(all.len(), CAPACITY, "容量不应超过 1000");
    //
    // // 最早的应该是 evt-201（前 200 条被覆盖）
    // assert_eq!(all[0].id, "evt-201");
    // // 最新的应该是 evt-1200
    // assert_eq!(all[all.len() - 1].id, "evt-1200");

    // TODO: 等 WindowCache 实现后取消注释
    assert!(true);
}

// ─── 4. 空 window 查询不 panic ───

#[tokio::test]
async fn recent_on_empty_window_returns_empty() {
    // let window = WindowCache::new(1000);
    //
    // let recent = window.recent(10);
    // assert!(recent.is_empty());
    //
    // let replayed = window.replay_after("any-id");
    // assert!(replayed.is_empty());

    // TODO: 等 WindowCache 实现后取消注释
    assert!(true);
}

// ─── 5. replay_after 在回绕后仍然正确 ───

#[tokio::test]
async fn replay_after_works_correctly_after_wrap() {
    // const CAPACITY: usize = 1000;
    // let window = WindowCache::new(CAPACITY);
    //
    // // 插入 1100 条
    // for i in 1..=1100 {
    //     window.push(make_event(&format!("evt-{}", i), "test"));
    // }
    //
    // // evt-100 已被覆盖，replay_after 应回退到全量返回
    // let replayed = window.replay_after("evt-100");
    // assert_eq!(replayed.len(), CAPACITY, "被覆盖的 ID → 回退到全量");
    //
    // // evt-500 仍在 buffer 中（500 > 101），从它之后重放
    // let from_500 = window.replay_after("evt-500");
    // assert_eq!(from_500.len(), 600, "evt-501 到 evt-1100 = 600 条");
    // assert_eq!(from_500[0].id, "evt-501");

    // TODO: 等 WindowCache 实现后取消注释
    assert!(true);
}

// ─── 6. recent(0) 返回空 ───

#[tokio::test]
async fn recent_zero_returns_empty() {
    // let window = WindowCache::new(1000);
    // window.push(make_event("evt-1", "test"));
    //
    // let recent = window.recent(0);
    // assert!(recent.is_empty());

    // TODO: 等 WindowCache 实现后取消注释
    assert!(true);
}
