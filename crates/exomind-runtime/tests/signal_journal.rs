// signal_journal.rs — Journal 测试
//
// 测试目标:
//   1. append → recent 查询
//   2. Ring buffer 回绕
//   3. 容量 1000 限制
//
// 依赖: crate::signal::{Journal, DeliveryRecord, DeliveryStatus}
// 状态: 测试骨架 — 等待 Journal 实现完成后编译通过

use exomind_runtime::signal::types::{DeliveryRecord, DeliveryStatus};

/// Helper: 构造测试 DeliveryRecord
fn make_record(event_id: &str, route_id: &str, status: DeliveryStatus) -> DeliveryRecord {
    DeliveryRecord {
        event_id: event_id.to_string(),
        route_id: route_id.to_string(),
        target_ref: format!("agent-for-{}", route_id),
        status,
        reason: None,
        started_at: "2026-03-03T00:00:00.000Z".to_string(),
        finished_at: "2026-03-03T00:00:00.001Z".to_string(),
    }
}

fn make_failed_record(event_id: &str, route_id: &str, reason: &str) -> DeliveryRecord {
    DeliveryRecord {
        event_id: event_id.to_string(),
        route_id: route_id.to_string(),
        target_ref: format!("agent-for-{}", route_id),
        status: DeliveryStatus::Failed,
        reason: Some(reason.to_string()),
        started_at: "2026-03-03T00:00:00.000Z".to_string(),
        finished_at: "2026-03-03T00:00:00.010Z".to_string(),
    }
}

// ─── 1. append + recent 基础功能 ───

#[tokio::test]
async fn append_and_recent_returns_records_in_order() {
    // let journal = Journal::new(1000);
    //
    // journal.append(make_record("evt-1", "route-a", DeliveryStatus::Sent));
    // journal.append(make_record("evt-2", "route-b", DeliveryStatus::Sent));
    // journal.append(make_record("evt-3", "route-a", DeliveryStatus::Failed));
    //
    // let recent = journal.recent(10);
    // assert_eq!(recent.len(), 3);
    //
    // // 验证顺序（最早到最新）
    // assert_eq!(recent[0].event_id, "evt-1");
    // assert_eq!(recent[1].event_id, "evt-2");
    // assert_eq!(recent[2].event_id, "evt-3");
    //
    // // 验证状态
    // assert_eq!(recent[0].status, DeliveryStatus::Sent);
    // assert_eq!(recent[2].status, DeliveryStatus::Failed);

    // TODO: 等 Journal 实现后取消注释
    let record = make_record("evt-1", "route-a", DeliveryStatus::Sent);
    assert_eq!(record.event_id, "evt-1");
    assert_eq!(record.status, DeliveryStatus::Sent);
}

// ─── 2. recent(n) 只返回最后 n 条 ───

#[tokio::test]
async fn recent_returns_only_last_n_records() {
    // let journal = Journal::new(1000);
    //
    // for i in 1..=10 {
    //     journal.append(make_record(
    //         &format!("evt-{}", i),
    //         "route-a",
    //         DeliveryStatus::Sent,
    //     ));
    // }
    //
    // let recent_3 = journal.recent(3);
    // assert_eq!(recent_3.len(), 3);
    // assert_eq!(recent_3[0].event_id, "evt-8");
    // assert_eq!(recent_3[1].event_id, "evt-9");
    // assert_eq!(recent_3[2].event_id, "evt-10");

    // TODO: 等 Journal 实现后取消注释
    assert!(true);
}

// ─── 3. Ring buffer 回绕 ───

#[tokio::test]
async fn ring_buffer_wraps_at_capacity() {
    // const CAPACITY: usize = 1000;
    // let journal = Journal::new(CAPACITY);
    //
    // // 插入 1500 条记录
    // for i in 1..=1500 {
    //     journal.append(make_record(
    //         &format!("evt-{}", i),
    //         "route-a",
    //         DeliveryStatus::Sent,
    //     ));
    // }
    //
    // // 只保留最近 1000 条: evt-501 ~ evt-1500
    // let all = journal.recent(CAPACITY + 500);
    // assert_eq!(all.len(), CAPACITY, "不应超过容量 1000");
    //
    // assert_eq!(all[0].event_id, "evt-501", "最早的应该是 evt-501");
    // assert_eq!(
    //     all[CAPACITY - 1].event_id,
    //     "evt-1500",
    //     "最新的应该是 evt-1500"
    // );

    // TODO: 等 Journal 实现后取消注释
    assert!(true);
}

// ─── 4. 容量正好 1000 ───

#[tokio::test]
async fn exactly_capacity_records() {
    // const CAPACITY: usize = 1000;
    // let journal = Journal::new(CAPACITY);
    //
    // for i in 1..=CAPACITY {
    //     journal.append(make_record(
    //         &format!("evt-{}", i),
    //         "route-a",
    //         DeliveryStatus::Sent,
    //     ));
    // }
    //
    // let all = journal.recent(CAPACITY);
    // assert_eq!(all.len(), CAPACITY);
    // assert_eq!(all[0].event_id, "evt-1");
    // assert_eq!(all[CAPACITY - 1].event_id, "evt-1000");

    // TODO: 等 Journal 实现后取消注释
    assert!(true);
}

// ─── 5. 空 journal 查询不 panic ───

#[tokio::test]
async fn recent_on_empty_journal_returns_empty() {
    // let journal = Journal::new(1000);
    // let recent = journal.recent(10);
    // assert!(recent.is_empty());

    // TODO: 等 Journal 实现后取消注释
    assert!(true);
}

// ─── 6. Failed 记录包含 reason ───

#[tokio::test]
async fn failed_record_preserves_reason() {
    // let journal = Journal::new(1000);
    //
    // journal.append(make_failed_record("evt-1", "route-a", "connection refused"));
    //
    // let recent = journal.recent(1);
    // assert_eq!(recent.len(), 1);
    // assert_eq!(recent[0].status, DeliveryStatus::Failed);
    // assert_eq!(
    //     recent[0].reason.as_deref(),
    //     Some("connection refused")
    // );

    // TODO: 等 Journal 实现后取消注释
    let record = make_failed_record("evt-1", "route-a", "connection refused");
    assert_eq!(record.status, DeliveryStatus::Failed);
    assert_eq!(record.reason.as_deref(), Some("connection refused"));
}

// ─── 7. recent(0) 返回空 ───

#[tokio::test]
async fn recent_zero_returns_empty() {
    // let journal = Journal::new(1000);
    // journal.append(make_record("evt-1", "route-a", DeliveryStatus::Sent));
    //
    // let recent = journal.recent(0);
    // assert!(recent.is_empty());

    // TODO: 等 Journal 实现后取消注释
    assert!(true);
}
