# 批次 C1：EventLog 多实例去重

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#575, #582

---

## Context

多实例运行时（如开 3 个 ExoMind 窗口），同一条语音输入会被每个实例各自生成不同 `event.id` 并写入 RT SQLite，导致 EventLog 中出现 N 条重复事件。

之前的两次修复尝试：
- `06a1e5d`：在 signal actor 层做 5 秒窗口文本去重 → 被评审否决（会误吞单实例合法重复）
- `fa438b4`：NowInputRow 双层去重 → 治标未治本

**根因**（#582 确认）：去重不应在 signal actor 层，应在 **RT SQLite 持久化入口**（`eventlog.rs` 的 `append_event`）做幂等。

---

## 步骤 1：RT SQLite 层幂等去重

### 1.1 改动

**文件**：`crates/exomind-runtime/src/eventlog.rs`

在 `append_event` 方法中，插入前先查询是否存在相同 content 且 timestamp 在 5 秒窗口内的事件：

```rust
// append_event 方法内，INSERT 之前新增去重逻辑：

// 幂等检查：同一 content 在 5 秒窗口内只写一次
let dedup_window_ms: i64 = 5_000;
let dedup_check = sqlx::query_scalar::<_, i64>(
    "SELECT COUNT(*) FROM events WHERE content = ? AND timestamp > ?"
)
.bind(&event.content)
.bind(event.timestamp - dedup_window_ms)
.fetch_one(&self.pool)
.await?;

if dedup_check > 0 {
    // 已存在相同内容的近期事件，跳过写入
    return Ok(());
}

// 正常写入...
```

**注意**：
- 只对 `content` 做文本匹配 + 时间窗口，不检查 `id`（因为多实例会生成不同 id）
- 5 秒窗口足够覆盖多实例并发写入的延迟，又不会误吞用户在 5 秒后的合法重复输入
- `timestamp` 字段在 EventLog 中是毫秒级 Unix 时间戳

### 1.2 移除旧的 signal actor 层去重

**文件**：`crates/exomind-runtime/src/signal/actors/eventlog_actor.rs`

检查是否有 `06a1e5d` 遗留的文本去重逻辑（5秒窗口/文本匹配）。如果有，移除——去重现在由持久化层负责。

### 1.3 前端适配

**文件**：`src/services/voice-shortcut.service.ts`

检查该文件是否有额外的客户端去重逻辑。如果有旧的去重代码（如 `fa438b4` 引入的），评估是否仍需保留：
- 如果 RT 层已做幂等，前端去重变为可选的"快速跳过"优化
- 保留不影响正确性，但可以减少无效网络请求

### 1.4 验证

```bash
cargo test -p exomind-runtime -- eventlog
npx tsc --noEmit
```

**新增测试**（`crates/exomind-runtime/src/eventlog.rs` 或对应测试文件）：

```rust
#[tokio::test]
async fn test_dedup_same_content_within_window() {
    // 同一 content 在 5 秒内写两次 → 只存一条
}

#[tokio::test]
async fn test_allow_same_content_after_window() {
    // 同一 content 间隔 >5 秒 → 两条都存
}

#[tokio::test]
async fn test_different_content_within_window() {
    // 不同 content 在 5 秒内 → 两条都存
}
```

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `crates/exomind-runtime/src/eventlog.rs` | 新增幂等检查 | #575 #582 |
| `crates/exomind-runtime/src/signal/actors/eventlog_actor.rs` | 移除旧去重（如有） | #575 |
| `src/services/voice-shortcut.service.ts` | 检查/保留前端去重 | #582 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要在 signal actor 层做去重** | #582 明确否决了这个方案 |
| **不要改动 EventLog 的读取逻辑** | 只改写入入口 |
| **不要改动事件的 id 生成策略** | 多实例仍各自生成 UUID，由持久化层幂等 |
| **不要改动 ECS replication 逻辑** | 复制逻辑不变 |

## ⚠️ 容易出错的关键点

1. **timestamp 单位**：EventLog 用毫秒，确保 5000 是毫秒不是秒
2. **SQL 查询性能**：`WHERE content = ? AND timestamp > ?` 在大量事件时可能慢。考虑为 `(content, timestamp)` 加索引，或只查最近 N 条
3. **幂等检查必须在事务内**：如果 append_event 有事务，幂等检查和写入应在同一事务中，避免竞态
4. **不要影响非语音事件**：task.* 事件、timeblock 事件也走 append_event，但它们的 content 通常不同，不会被误去重。不过需要确认 task.linked 等事件是否可能在多实例中重复触发

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 多实例去重 | 3 个实例同时收到语音输入 | EventLog 只有 1 条 | #575 |
| 单实例不误吞 | 同一实例 6 秒后输入相同内容 | 两条都写入 | #575 |
| 不同内容 | 5 秒内输入不同内容 | 两条都写入 | #575 |
| 旧去重移除 | signal actor 无文本去重逻辑 | 去重由 RT 层负责 | #582 |
| cargo test | `cargo test -p exomind-runtime -- eventlog` | 通过 | 全部 |

---

## 完成回填

（Codex 执行完毕后在此填写）
