# timeblock_summary Agent 信号订阅配置化设计

> 日期：2026-06-05
> 状态：已实现
> 关联：timeblock_summary Agent、信号网络、配置系统

---

## 背景

当前 timeblock_summary Agent 只订阅 `timeblock.replication.completed` 信号（时间块结束时触发）。用户希望 Agent 能同时接收 `block_feedback` 事件（用户提交反馈时触发），以便结合用户自己写的反馈做更综合的分析。

---

## 需求

1. **信号类型**：
   - `timeblock.replication.completed` — 时间块结束信号（当前已实现）
   - `timeblock.block_feedback.created` — block_feedback 生成信号（新增）

2. **配置项**：多选枚举，Agent 选择要订阅哪些信号
   - 存储在 ConfigStore 中
   - 跟「启用时间块总结Agent」在同一设置分组
   - 运行时可配置

3. **信号队列**：FIFO，立即处理，其他信号等待

4. **内容差异**：
   - 只有 `block_completed`：完整时间块总结
   - 只有 `block_feedback`：完整时间块总结（承担全部职责）
   - 同时有两种：`block_completed` → 完整总结；`block_feedback` → 只做核验和启发

5. **幂等性**：两种信号都不做幂等判断

6. **能量补充**：收到 `block_feedback` 信号时，`ceil(用户反馈有效字符数 / 5)` 点能量

---

## 设计

### 1. 信号类型

| 信号 | 触发时机 | 载荷 |
|------|---------|------|
| `timeblock.replication.completed` | 时间块结束 | `TimeBlockData` |
| `timeblock.block_feedback.created` | 用户提交反馈 | `TimeBlockData` + `block_feedback` 内容 |

### 2. 配置项

**配置 key**：`builtin.timeblock_summary.subscriptions`

**配置值**：多选枚举
```json
{
  "block_completed": true,
  "block_feedback": true
}
```

**默认值**：`{"block_completed": true, "block_feedback": false}`（向后兼容）

**设置 UI**：在「启用时间块总结Agent」同一分组下，新增「订阅信号」多选枚举

### 3. 信号队列

**队列类型**：FIFO

**处理策略**：
- 收到信号后立即处理
- 其他信号在处理中进来时，停留在队列中等待
- 当前信号处理完成后，FIFO 出队做下一个处理

**实现位置**：`TimeblockSummaryAgentService` 中新增 `signal_queue: Arc<Mutex<VecDeque<SignalEvent>>>`

### 4. 内容差异

**场景 A：只有 `block_completed` 信号**
- 生成完整的时间块总结（当前行为）

**场景 B：只有 `block_feedback` 信号**
- 生成完整的时间块总结（承担全部职责）

**场景 C：同时有两种信号**
- `block_completed` → 生成完整的时间块总结
- `block_feedback` → 只做「用户反馈核验、下一步启发」（避免重复）

### 5. 幂等性

- `block_completed`：不做幂等判断
- `block_feedback`：不做幂等判断

### 6. 能量补充

**触发**：收到 `block_feedback` 信号时

**公式**：`ceil(用户反馈有效字符数 / 5)` 点能量

**有效字符**：与普通事件日志相同（排除空白和标点）

---

## 实施步骤

### 阶段 1：后端信号发布

1. 在 `block_feedback` 生成后发布 `timeblock.block_feedback.created` 信号
2. 修改 `routes/timeblocks.rs` 或相关 handler

### 阶段 2：Agent 订阅配置

1. 新增 ConfigStore key：`builtin.timeblock_summary.subscriptions`
2. 在 `TimeblockSummaryAgentService` 中读取配置
3. 根据配置决定订阅哪些信号

### 阶段 3：信号队列

1. 新增 `signal_queue: Arc<Mutex<VecDeque<SignalEvent>>>`
2. 修改 `handle_signal` 方法，将信号入队
3. 新增 `process_queue` 方法，依次处理队列中的信号

### 阶段 4：内容差异处理

1. 在 `run_summary_loop` 中添加 `signal_type` 参数
2. 根据 `signal_type` 和当前队列状态决定生成哪种总结

### 阶段 5：能量补充

1. 在处理 `block_feedback` 信号时，计算用户反馈有效字符数
2. 补充 `ceil(有效字符数 / 5)` 点能量

### 阶段 6：前端配置 UI

1. 在设置页面新增「订阅信号」多选枚举
2. 与「启用时间块总结Agent」在同一分组

---

## 文件清单

| 文件 | 改动 |
|------|------|
| `crates/exomind-runtime/src/agent/timeblock_summary/mod.rs` | 信号队列、配置读取、内容差异处理 |
| `crates/exomind-runtime/src/routes/timeblocks.rs` | 发布 `block_feedback` 信号 |
| `crates/exomind-runtime/src/config/types.rs` | 新增配置 key |
| `src/ui/app/config/settings/...` | 前端配置 UI |

---

## 测试计划

1. 单元测试：信号队列 FIFO 行为
2. 单元测试：内容差异处理逻辑
3. 集成测试：端到端信号发布和处理
4. Tauri MCP 实测：验证配置 UI 和信号处理
