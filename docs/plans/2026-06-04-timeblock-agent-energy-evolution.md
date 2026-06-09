# timeblock_summary Agent 能量系统演进计划

> 基于 2026-06-04 讨论，记录能量系统的演进方向。

## 当前状态（Phase 1 MVP）

- 能量 100 点，每轮 broker 消耗 1，成功 +10，10% 警告，0% 诊断摘要
- 纯信号驱动，无 tick

## 演进方向

### 1. 能量消耗多元化

| 场景 | 消耗公式 | 说明 |
|------|---------|------|
| 普通思考（文本生成） | `ceil(字符数 / 256)` | 更真实，从 `assistant_turn.content.len()` 获取 |
| 调用工具 | 1 | 确定性操作，1 点/次 |
| 进一步细分（后续） | 读事件 vs 写事件 vs submit | MVP 先保持简单 |

**实施要点**：在 broker 循环中，检查 `AgentTurnResult` 类型：
- `Final { assistant_turn }` → 消耗 `ceil(content.len() / 256)`
- `NeedsToolCalls { tool_calls }` → 消耗 `tool_calls.len()` + 文本消耗

### 2. 能量补充时机调整

**当前**：成功 submit 后 +10
**演进**：Agent 被激活时充满，结束时不补充。能量是一次性预算。

```
时间块信号到达 → 根据时间块状况决定初始能量：
  - 正常结束 → 100 点
  - 超时 → 80 点（更少预算）
  - 手动提前结束 → 120 点（更多预算）
```

**判断依据**：`TimeBlockData.transitions` 中是否有 `pause` / `timeout` 等非正常结束标记。

### 3. 能量信息注入 Agent Prompt

在 `collect_context` 或 `build_start_prompt` / `build_end_prompt` 中注入：

```markdown
## 系统状态
- 你的当前能量：{current}/{max}
- 已消耗：{consumed}
- 每轮消耗：约 {chars/256}（文本）+ 1（工具调用）
- 能量耗尽时将自动停止
```

Agent 可据此调整行为，在 narrative 中自然提及能量状态。

### 4. 实时 Broker 会话订阅（后续）

在 broker 循环中，每轮 `AgentTurnBroker.run()` 返回后，通过 SSE/WebSocket 将 `AssistantTurn` 和 `ToolCall` 实时推送到前端。让用户看到：
- "Agent 正在思考..."
- "Agent 调用了 submit_timeblock_summary → 校验失败"
- "Agent 重新思考..."
- "Agent 已完成总结"

需要前端对应的订阅机制（类似 `useSignalStream`）。

## 实施优先级

| 优先级 | 任务 | 复杂度 |
|--------|------|--------|
| P0 | 能量消耗多元化（文本+工具） | 低 |
| P0 | 能量补充时机调整（一次性预算） | 低 |
| P1 | 能量信息注入 Agent Prompt | 低 |
| P1 | 动态初始能量（按时间块状况） | 中 |
| P2 | 实时 Broker 会话订阅 | 高 |
