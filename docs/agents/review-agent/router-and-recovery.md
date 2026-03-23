# Router 与重启恢复

## 读取时机

- 本文档描述 router 与恢复规则
- 它是统一入口设计的参考文档，不要求每轮冷启动先全文阅读
- 你冷启动时应先遵循 `review-agent.prompt.md` 的最小启动契约并运行 router
- 当你需要解释 router 决策、恢复逻辑或本地状态与远端事实的裁决关系时，再回读本文

## 原则

- router 的职责是根据 GitHub 当前事实决定下一步动作
- 本地 `state/queue/backoff/cursor` 只作为恢复辅助与 continuity hint，不能充当真相缓存

## 目的

人类不应判断当前该喂 discovery 还是 review。统一入口 prompt 每轮都先运行 router 脚本，再由脚本决定下一步动作。

router 输出中的 `referencesMustRead` 只负责告诉你：当前动作必须继续阅读哪些 phase-specific 文档。
它不改变 router 的 action / reason / state 恢复逻辑。

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
- 且该 PR 的远端 `updatedAt` 仍与当前 `queue.selectedPr.updatedAt` 一致
- 则输出 `review`

这里的 `selectedPrNumber` 只是 continuity hint，不是单独的真相源。
一旦远端 `updatedAt` 已变化，就说明上一次 discovery 的队列快照已经过期，router 必须回退到 `discovery`，重新按 GitHub 当前事实判断。

### 失效目标

- 若 `state = HAS_TARGET`
- 但 `selectedPrNumber` 已关闭、已合并、不存在，或远端 `updatedAt` 已不同于队列快照
- 则回退到 `discovery`

### 当前无目标

- 若 `state = NO_TARGET`
- 则输出 `discovery`
- 原因是 `NO_TARGET` 只是“上一轮没找到目标”，不是“这一轮无需再查 GitHub”
- sleep 只能作为上一轮 discovery 产出的调度建议，不能替代下一轮的远端重查

### 审阅已结束

- 若 `state` 属于 `REVIEW_POSTED`、`NEEDS_HUMAN_TEST`、`APPROVE_READY`、`MERGE_READY` 或 `MERGE_BLOCKED`
- 则输出 `discovery`
- 因为下一轮应重新从 GitHub 当前事实发现待处理 PR，而不是盲目续接上一轮审阅上下文

### 可重试失败

- 若 `state = FAILED_RETRYABLE`
- 且 `lastPhase = REVIEW`
- 且 `selectedPrNumber` 仍有效
- 且该 PR 的远端 `updatedAt` 仍与当前队列快照一致
- 则输出 `review`

- 其他失败情况一律输出 `discovery`

## 额外约束

- 人类只输入统一 prompt
- router 是唯一阶段判断入口
- 只要本地状态与 GitHub 事实冲突，就以 GitHub 为准
- `NO_TARGET` 不得直接跳过 GitHub 重查
