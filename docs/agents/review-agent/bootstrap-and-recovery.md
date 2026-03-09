# Bootstrap 与重启恢复

## 目的

审核 Agent 不能假设会话连续存在。任意时刻都可能中断，并在下一次启动时处于不同阶段。

因此，Agent 每次启动时都必须先执行 bootstrap，而不是直接假设自己应该进入 discovery 或 review。

## Bootstrap 职责

bootstrap 必须完成以下动作：

1. 读取 `./temp/pr-monitor/state.json`
2. 读取 `./temp/pr-monitor/queue.json`
3. 读取 `./temp/pr-monitor/backoff.json`
4. 基于当前 GitHub 事实校验 `selected_pr` 是否仍然有效
5. 决定下一步进入哪个 prompt

## 下一步路由

bootstrap 只允许输出以下下一步：

- `discovery`
- `review`
- `idle-wait`

## 路由规则

### 无状态

- 若 `state.json` 缺失或损坏，则进入 `discovery`

### 有目标

- 若 `state = HAS_TARGET`
- 且 `selected_pr` 仍然存在并且仍是 open PR
- 则进入 `review`

### 目标失效

- 若 `state = HAS_TARGET`
- 但 `selected_pr` 已关闭、已合并或状态缺失
- 则回退到 `discovery`

### 当前无目标

- 若 `state = NO_TARGET`
- 则进入 `idle-wait`
- 并按 `next_sleep_seconds` 执行等待

### 可重试失败

- 若 `state = FAILED_RETRYABLE`
- 且 `lastPhase = REVIEW`
- 且 `selected_pr` 仍有效
- 则重试 `review`

- 其他失败情况一律回到 `discovery`

## 状态要求

为支持恢复，`state.json` 至少要持久化：

- `state`
- `phase`
- `lastPhase`
- `nextPrompt`
- `selectedPrNumber`
- `failureStreak`
- `nextSleepSeconds`
- `updatedAt`

## 设计原则

- 本地状态只提供“恢复提示”，不是真相源
- 只要本地状态与 GitHub 事实冲突，就以 GitHub 为准
- bootstrap 负责“先判阶段，再决定 prompt”
- discovery 和 review 都不应依赖外部记忆来决定自己是否该运行
