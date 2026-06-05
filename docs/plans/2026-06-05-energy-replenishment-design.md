# 能量补充机制设计

> 日期：2026-06-05
> 状态：已实现
> 关联：timeblock_summary Agent

---

## 背景

当前 timeblock_summary Agent 的能量系统是一次性预算（初始 80/100/120，按内容消耗），没有补充机制。用户希望 Agent 更有「生命感」——能量与用户活动相关联。

---

## 设计方案

### 机制 1：时间块开始时补充（专注时长）

**触发**：时间块开始信号（`handle_active_upserted`）

**规则**：
- 倒计时模式（countdown）：`补充 = 专注时长（分钟）` 点能量
- 正计时模式（countup）：不补充

**示例**：
- 用户启动 25 分钟倒计时 → 补充 25 点
- 用户启动正计时 → 不补充

**实现位置**：`mod.rs` 的 `handle_active_upserted` 或 `run_summary_loop` 开始处

```rust
// 伪代码
let energy_gain = if block.is_countdown() {
    let duration_min = (block.expected_duration_ms.unwrap_or(0)) / 60_000;
    duration_min as u64
} else {
    0
};

if energy_gain > 0 {
    if let Some(energy) = self.energy_registry.get("timeblock_summary") {
        let current = energy.snapshot("timeblock_summary").current;
        let new_energy = (current + energy_gain).min(ENERGY_MAX);
        energy.set_current(new_energy);
    }
}
```

### 机制 2：时间块结束时补充（事件统计）

**触发**：时间块结束信号（`handle_completed`）

**公式**：
```
补充 = ceil(事件条数 + 总有效文本字符数 / 100)
```

**事件条数**：
- 包含系统事件（block_start、block_end、agent_feedback 等）
- 包含用户事件
- 统计时间块范围内的所有事件

**总有效文本字符数**：
- 只统计「用户亲自输入」的事件（非系统自动生成）
- 只算有效文本字符：数字、字母、中文等（Unicode 字符，排除空白和标点）
- 判断「用户亲自输入」：检查 event.tags 或 event.metadata.source

**示例**：
- 时间块内有 5 个事件，用户输入了 300 个有效字符
- 补充 = ceil(5 + 300/100) = ceil(5 + 3) = 8 点

**实现位置**：`mod.rs` 的 `handle_completed` 或 `run_summary_loop` 结束处

```rust
// 伪代码
let events = eventlog_store.list_events_filtered(None, &EventListFilter {
    since_timestamp: Some(block.start_time as i64),
    until_timestamp: Some(block.end_time as i64),
    limit: Some(1000),
    ..Default::default()
}).unwrap_or_default();

let event_count = events.len() as u64;

let user_char_count: usize = events.iter()
    .filter(|e| is_user_input(e))  // 判断是否用户亲自输入
    .map(|e| count_effective_chars(&e.content))  // 统计有效字符
    .sum();

let energy_gain = ((event_count as f64 + user_char_count as f64 / 100.0).ceil()) as u64;

if energy_gain > 0 {
    if let Some(energy) = self.energy_registry.get("timeblock_summary") {
        let current = energy.snapshot("timeblock_summary").current;
        let new_energy = (current + energy_gain).min(ENERGY_MAX);
        energy.set_current(new_energy);
    }
}
```

### 辅助函数

```rust
/// 判断事件是否为用户亲自输入（非系统自动生成）
fn is_user_input(event: &EventRecord) -> bool {
    // 方案 1：检查 tags
    if event.tags.contains(&"user_input".to_string()) {
        return true;
    }
    // 方案 2：检查 metadata.source
    if let Some(metadata) = &event.metadata {
        if let Some(source) = metadata.get("source") {
            if let Some(app) = source.get("app") {
                // 系统事件通常是 exomind-runtime，用户事件是其他
                return app.as_str() != Some("exomind-runtime");
            }
        }
    }
    false
}

/// 统计有效文本字符数（排除空白和标点）
fn count_effective_chars(text: &str) -> usize {
    text.chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .count()
}
```

---

## 能量上限

- 建议 `ENERGY_MAX = 150`（当前是 120）
- 或者保持 120，让补充更有价值感

---

## 与其他机制的关系

1. **初始能量**：`max(current, calculate_initial_energy)` 保持不变
2. **内容消耗**：`calculate_turn_cost` 保持不变
3. **补充时机**：开始时 + 结束时（两次补充）

---

## 待确认

1. 能量上限是多少？（120 或 150）
2. 「用户亲自输入」的判断标准：tags 还是 metadata.source？
3. 有效字符的定义：排除空白和标点？还是只保留字母数字中文？
4. 正计时模式是否也应该补充（比如根据实际专注时长）？

---

## 上下文交接

**本次会话完成的工作**：
- action_log 实时化（Session record 在 broker loop 开始时就创建）
- 幂等性基于 eventlog（不再依赖内存 HashMap）
- 探索工具（get_recent_events, get_block_feedback）
- 能量系统修复（max(current, calculated)）
- 时间戳单位修复（毫秒 vs 秒）
- 系统提示词矛盾修复
- 路由统一
- 前端展开/收起功能

**留给下一个 Agent 的工作**：
1. 实现本设计文档中的能量补充机制
2. 测试能量补充是否按预期工作
3. 根据测试结果调整公式参数
