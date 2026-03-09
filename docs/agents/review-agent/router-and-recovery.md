# Router 与重启恢复

## 目的

人类不应判断当前该喂 discovery 还是 review。统一入口 prompt 每轮都先运行 router 脚本，再由脚本决定下一步动作。

## Router 职责

router 必须：

1. 读取 `./temp/pr-monitor/state.json`
2. 读取 `./temp/pr-monitor/queue.json`
3. 拉取当前 open PR 列表
4. 基于本地状态和 GitHub 当前事实输出下一步动作

## Router 输出

router 只允许输出以下 `action`：

- `discovery`
- `review`
- `idle-wait`

同时输出：

- `reason`
- `selectedPrNumber`
- `sleepSeconds`

## 路由规则

### 缺失状态

- 若 `state.json` 缺失或损坏，则输出 `discovery`

### 有效目标

- 若 `state = HAS_TARGET`
- 且 `selectedPrNumber` 仍然属于当前 open PR
- 则输出 `review`

### 失效目标

- 若 `state = HAS_TARGET`
- 但 `selectedPrNumber` 已关闭、已合并或不存在
- 则回退到 `discovery`

### 当前无目标

- 若 `state = NO_TARGET`
- 则输出 `idle-wait`
- 并使用 `nextSleepSeconds`

### 审阅已结束

- 若 `state` 属于 `REVIEW_POSTED`、`NEEDS_HUMAN_TEST`、`APPROVE_READY` 或 `MERGE_READY`
- 则输出 `discovery`
- 因为下一轮应重新从 GitHub 当前事实发现待处理 PR，而不是盲目续接上一轮审阅上下文

### 可重试失败

- 若 `state = FAILED_RETRYABLE`
- 且 `lastPhase = REVIEW`
- 且 `selectedPrNumber` 仍有效
- 则输出 `review`

- 其他失败情况一律输出 `discovery`

## 原则

- 人类只输入统一 prompt
- router 是唯一阶段判断入口
- 只要本地状态与 GitHub 事实冲突，就以 GitHub 为准
