# timeblock_summary Agent 信号订阅配置化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 timeblock_summary Agent 能订阅多种信号（时间块结束、block_feedback 生成），并根据配置决定生成哪种总结

**Architecture:** 扩展 SignalPool 新增 block_feedback 信号，Agent 通过 ConfigStore 配置订阅哪些信号，使用 FIFO 队列依次处理

**Tech Stack:** Rust (Axum, SignalPool, ConfigStore), TypeScript (React Settings UI)

---

## Task 1: 发布 block_feedback 信号

**Files:**
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Test: 在 Tauri MCP 实测中验证

**Step 1: 找到 block_feedback 生成位置**

在 `routes/timeblocks.rs` 中搜索 `block_feedback` 相关代码，找到生成 block_feedback 的位置。

Run: `grep -n "block_feedback" crates/exomind-runtime/src/routes/timeblocks.rs`

**Step 2: 在 block_feedback 生成后发布信号**

在 block_feedback 写入 eventlog 后，发布 `timeblock.block_feedback.created` 信号：

```rust
// 在 block_feedback 写入后添加
state.signal_pool.publish(crate::signal::types::SignalEvent {
    schema_version: 1,
    id: uuid::Uuid::new_v4().to_string(),
    topic: "timeblock.block_feedback.created".to_string(),
    ts: chrono::Utc::now().timestamp_millis() as u64,
    source: "timeblock_summary".to_string(),
    origin_host_id: String::new(),
    hop: 1,
    trace_id: None,
    payload: serde_json::json!({
        "scopeKey": scope_key,
        "block": block_data,
        "feedback": feedback_content,
    }),
});
```

**Step 3: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 4: Commit**

```bash
git add crates/exomind-runtime/src/routes/timeblocks.rs
git commit -m "feat: publish block_feedback.created signal after feedback submission"
```

---

## Task 2: 新增 ConfigStore 配置 key

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/mod.rs`
- Test: 单元测试

**Step 1: 定义配置 key 常量**

在 `mod.rs` 中添加：

```rust
const CONFIG_KEY_SUBSCRIPTIONS: &str = "builtin.timeblock_summary.subscriptions";
```

**Step 2: 定义默认订阅配置**

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubscriptionsConfig {
    pub block_completed: bool,
    pub block_feedback: bool,
}

impl Default for SubscriptionsConfig {
    fn default() -> Self {
        Self {
            block_completed: true,
            block_feedback: false, // 向后兼容
        }
    }
}
```

**Step 3: 实现配置读取方法**

```rust
fn get_subscriptions(&self) -> SubscriptionsConfig {
    self.config_store
        .get("user", CONFIG_KEY_SUBSCRIPTIONS)
        .ok()
        .flatten()
        .and_then(|e| serde_json::from_str(&e.value).ok())
        .unwrap_or_default()
}
```

**Step 4: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/mod.rs
git commit -m "feat: add subscriptions config for timeblock_summary agent"
```

---

## Task 3: 实现信号队列

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/mod.rs`
- Test: 单元测试

**Step 1: 添加队列字段到 TimeblockSummaryAgentService**

```rust
use std::collections::VecDeque;
use tokio::sync::Mutex;

pub struct TimeblockSummaryAgentService {
    // ... 现有字段 ...
    signal_queue: Arc<Mutex<VecDeque<SignalEvent>>>,
    processing: Arc<AtomicBool>,
}
```

**Step 2: 在 new() 中初始化队列**

```rust
Self {
    // ... 现有初始化 ...
    signal_queue: Arc::new(Mutex::new(VecDeque::new())),
    processing: Arc::new(AtomicBool::new(false)),
}
```

**Step 3: 修改 handle_signal 方法，将信号入队**

```rust
async fn handle_signal(&self, event: &SignalEvent) -> Result<(), String> {
    // ... 现有检查逻辑 ...

    // 检查是否订阅了该信号
    let subscriptions = self.get_subscriptions();
    let should_process = match event.topic.as_str() {
        "timeblock.replication.completed" => subscriptions.block_completed,
        "timeblock.block_feedback.created" => subscriptions.block_feedback,
        _ => false,
    };

    if !should_process {
        return Ok(());
    }

    // 入队
    self.signal_queue.lock().await.push_back(event.clone());

    // 如果没有正在处理的信号，开始处理
    if !self.processing.load(Ordering::Relaxed) {
        self.process_queue().await;
    }

    Ok(())
}
```

**Step 4: 实现 process_queue 方法**

```rust
async fn process_queue(&self) {
    self.processing.store(true, Ordering::Relaxed);

    while let Some(event) = self.signal_queue.lock().await.pop_front() {
        if let Err(e) = self.process_signal(&event).await {
            tracing::error!("timeblock_summary: signal processing error: {e}");
        }
    }

    self.processing.store(false, Ordering::Relaxed);
}
```

**Step 5: 将现有 handle_completed 和 handle_active_upserted 逻辑移到 process_signal**

```rust
async fn process_signal(&self, event: &SignalEvent) -> Result<(), String> {
    match event.topic.as_str() {
        "timeblock.replication.completed" => {
            self.handle_completed(event).await;
        }
        "timeblock.block_feedback.created" => {
            self.handle_block_feedback(event).await;
        }
        _ => {}
    }
    Ok(())
}
```

**Step 6: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 7: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/mod.rs
git commit -m "feat: implement FIFO signal queue for timeblock_summary agent"
```

---

## Task 4: 实现 block_feedback 信号处理

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/mod.rs`
- Test: 单元测试

**Step 1: 实现 handle_block_feedback 方法**

```rust
async fn handle_block_feedback(&self, event: &SignalEvent) {
    let block = match extract_block_from_signal(event) {
        Some(b) => b,
        None => {
            tracing::warn!("timeblock_summary: block_feedback signal missing block data");
            return;
        }
    };

    // 提取 feedback 内容
    let feedback_content = event.payload
        .get("feedback")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // 检查是否同时有 block_completed 信号在队列中
    let has_block_completed = self.signal_queue.lock().await
        .iter()
        .any(|e| e.topic == "timeblock.replication.completed"
            && e.payload.get("block").and_then(|b| b.get("startId"))
                == event.payload.get("block").and_then(|b| b.get("startId")));

    // 根据场景决定生成哪种总结
    let summary_kind = if has_block_completed {
        // 场景 C：已有 block_completed，只做核验和启发
        SummaryKind::FeedbackReview
    } else {
        // 场景 B：只有 block_feedback，承担全部职责
        SummaryKind::End
    };

    // 能量补充
    let energy_gain = (count_effective_chars(feedback_content) as f64 / 5.0).ceil() as u64;
    if energy_gain > 0 {
        if let Some(energy) = self.energy_registry.get("timeblock_summary") {
            let current = energy.snapshot("timeblock_summary").current;
            let new_energy = (current + energy_gain).min(ENERGY_MAX);
            energy.set_current(new_energy);
        }
    }

    // 运行总结循环
    if let Err(e) = self.run_summary_loop(block, summary_kind, None).await {
        tracing::error!("timeblock_summary: block_feedback summary failed: {e}");
    }
}
```

**Step 2: 添加 FeedbackReview 到 SummaryKind 枚举**

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SummaryKind {
    Start,
    End,
    FeedbackReview, // 新增：用户反馈核验
}
```

**Step 3: 在 build_end_prompt 中处理 FeedbackReview**

```rust
pub fn build_end_prompt(ctx: &CollectedContext, kind: &SummaryKind) -> String {
    match kind {
        SummaryKind::End => {
            // 现有的完整总结逻辑
        }
        SummaryKind::FeedbackReview => {
            // 只做核验和启发的逻辑
            format!(
                r#"用户已提交时间块反馈。请核验用户反馈与实际事件的差异，并提供下一步启发。

## 用户反馈
{feedback}

## 实际事件
{events}

## 核验要点
1. 用户反馈中提到的事项是否在事件中有对应记录？
2. 事件中有哪些重要事项用户没有提到？
3. 基于核验结果，提供 1-3 条下一步建议。"#
            )
        }
        _ => unreachable!(),
    }
}
```

**Step 4: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/mod.rs
git commit -m "feat: implement block_feedback signal handler with content differentiation"
```

---

## Task 5: 移除幂等性判断

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/mod.rs`
- Test: 单元测试

**Step 1: 移除 handle_completed 中的幂等性检查**

删除以下代码：

```rust
// Idempotency check: query eventlog for existing END-type agent_feedback in this time block
let filter = crate::eventlog::EventListFilter {
    since_timestamp: Some(block.start_time as i64),
    until_timestamp: Some(block.end_time as i64),
    tags: vec!["agent_feedback".to_string()],
    limit: Some(10),
    ..Default::default()
};
if let Ok(events) = self.eventlog_store.list_events_filtered(None, &filter) {
    let has_end_feedback = events.iter().any(|e| {
        e.metadata
            .as_ref()
            .and_then(|m| m.get("summary_kind"))
            .and_then(|v| v.as_str())
            == Some("end")
    });
    if has_end_feedback {
        tracing::debug!(
            block_id = %block.start_id,
            "timeblock_summary: already has end-type agent_feedback for this block, skipping"
        );
        return;
    }
}
```

**Step 2: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 3: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/mod.rs
git commit -m "refactor: remove idempotency check for block_completed and block_feedback signals"
```

---

## Task 6: 更新系统提示词

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/templates.rs`
- Test: 单元测试

**Step 1: 添加 FeedbackReview 提示词模板**

```rust
pub fn build_feedback_review_prompt(
    feedback_content: &str,
    events: &[String],
) -> String {
    format!(
        r#"用户已提交时间块反馈。请核验用户反馈与实际事件的差异，并提供下一步启发。

## 用户反馈
{feedback_content}

## 实际事件
{}

## 核验要点
1. 用户反馈中提到的事项是否在事件中有对应记录？
2. 事件中有哪些重要事项用户没有提到？
3. 基于核验结果，提供 1-3 条下一步建议。

## 提交要求
通过 submit_timeblock_summary 工具提交，summaryKind 使用 "feedback_review"。"#
    , events.join("\n"))
}
```

**Step 2: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 3: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/templates.rs
git commit -m "feat: add feedback review prompt template"
```

---

## Task 7: 更新 tools.rs 支持 feedback_review

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/tools.rs`
- Test: 单元测试

**Step 1: 在 submit_timeblock_summary 工具中添加 feedback_review 类型**

```rust
let expected_kind_str = match kind_expected {
    SummaryKind::Start => "start",
    SummaryKind::End => "end",
    SummaryKind::FeedbackReview => "feedback_review",
};
```

**Step 2: 在事件 metadata 中添加 summary_kind**

```rust
metadata: Some(json!({
    "agent": "timeblock_summary",
    "block_id": block_id,
    "summary_kind": summary_kind,
    // ... 其他字段
})),
```

**Step 3: 编译验证**

Run: `cargo check -p exomind-runtime`
Expected: 零错误

**Step 4: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/tools.rs
git commit -m "feat: support feedback_review summary kind in submit tool"
```

---

## Task 8: 添加单元测试

**Files:**
- Modify: `crates/exomind-runtime/src/agent/timeblock_summary/mod.rs`
- Test: 单元测试

**Step 1: 添加信号队列测试**

```rust
#[tokio::test]
async fn signal_queue_fifo_order() {
    let service = TimeblockSummaryAgentService::new(...);
    
    // 添加多个信号
    let event1 = create_test_signal("timeblock.replication.completed");
    let event2 = create_test_signal("timeblock.block_feedback.created");
    
    service.handle_signal(&event1).await.unwrap();
    service.handle_signal(&event2).await.unwrap();
    
    // 验证队列顺序
    let queue = service.signal_queue.lock().await;
    assert_eq!(queue.len(), 2);
    assert_eq!(queue[0].topic, "timeblock.replication.completed");
    assert_eq!(queue[1].topic, "timeblock.block_feedback.created");
}
```

**Step 2: 添加配置读取测试**

```rust
#[test]
fn get_subscriptions_default() {
    let service = create_test_service();
    let config = service.get_subscriptions();
    assert!(config.block_completed);
    assert!(!config.block_feedback);
}
```

**Step 3: 运行测试**

Run: `cargo test -p exomind-runtime --lib -- agent::timeblock_summary::tests`
Expected: 所有测试通过

**Step 4: Commit**

```bash
git add crates/exomind-runtime/src/agent/timeblock_summary/mod.rs
git commit -m "test: add unit tests for signal queue and subscriptions config"
```

---

## Task 9: Tauri MCP 实测

**Files:**
- 无代码改动，纯测试

**Step 1: 重启 Tauri 实例**

Run: `bun run tauri:manager stop --name dev-debug && bun run tauri:manager start --name dev-debug --target desktop`

**Step 2: 验证信号发布**

启动一个时间块，结束时检查是否发布了 `timeblock.block_feedback.created` 信号。

**Step 3: 验证配置 UI**

在设置页面检查是否新增了「订阅信号」多选枚举。

**Step 4: 验证端到端流程**

1. 启用 `block_completed` 和 `block_feedback` 订阅
2. 启动时间块 → 结束 → 验证生成完整总结
3. 提交反馈 → 验证生成核验总结

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify block_feedback signal subscription via Tauri MCP"
```

---

## Task 10: 更新设计文档状态

**Files:**
- Modify: `docs/plans/2026-06-05-block-feedback-signal-design.md`

**Step 1: 更新状态为「已实现」**

```markdown
> 状态：已实现
```

**Step 2: Commit**

```bash
git add docs/plans/2026-06-05-block-feedback-signal-design.md
git commit -m "docs: mark block-feedback-signal design as implemented"
```

---

## 执行顺序

1. Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10

## 依赖关系

- Task 1 依赖：无
- Task 2 依赖：无
- Task 3 依赖：Task 2
- Task 4 依赖：Task 1, Task 3
- Task 5 依赖：Task 4
- Task 6 依赖：Task 4
- Task 7 依赖：Task 6
- Task 8 依赖：Task 7
- Task 9 依赖：Task 8
- Task 10 依赖：Task 9

## 并行机会

- Task 1 和 Task 2 可以并行（无依赖）
- Task 6 和 Task 7 可以并行（无依赖）
