# 发现循环

## 读取时机

- 只有当 `router.action = discovery`，或上一步输出的 `referencesMustRead` 包含本文档时，才读取并遵循本文
- discovery 规则不再要求冷启动时预先加载 review / comment / state-worktree 文档

## 输入

- 来自 `gh pr list --state open` 的当前仓库 open PR 列表
- 每个 PR 上已有的审核评论
- 每个 PR 上的新评论、新 review、新提交
- 来自 `./temp/` 的本地发现状态（仅作恢复辅助与 sleep 建议，不能压过 GitHub 当前事实）

## 扫描算法

1. 拉取 open PR，并按 `updatedAt` 倒序排列。
2. 对每个 PR，找到正文以 `[Codex Reviewer]` 开头的最后一条评论。
3. 若不存在这样的评论，则将该 PR 标记为待处理。
4. 若存在，则比较该评论时间戳与其后的 PR 活动。
5. 若其后存在任意新评论、新 review 活动、review thread 回复或新提交，则将该 PR 标记为待处理。
6. 否则跳过该 PR。

## 增量规则

最后一条 `[Codex Reviewer]` 评论之后的新活动包括：

- PR 顶层评论
- review 提交
- review thread 回复（仅统计 review comment 的回复，`in_reply_to_id` 非空）
- 新提交

说明与假设：
- `new-review` 依赖 review submission 事件（例如 “Start review → Submit review (COMMENTED)”）。
- 仅有顶层 review comment 且未产生 review submission 的场景不会触发 `new-review`，且不会被当作 thread reply 计入；除非未来需要覆盖该场景，否则保持这一取舍。
- 若后续观察到 review submission 事件缺失，可回退为“顶层 review comments 作为补充信号”，避免漏报。

其中 review thread 回复属于可选增强信号：

- 若 review thread 回复读取成功，则纳入判定（使用 GET 语义分页读取，避免 `gh api -F ...` 退化成 POST 后触发 `422`）
- 若 thread reply 读取失败，则退化为“没有 thread replies”，继续使用 comments / reviews / commits 判定
- 退化必须在 discovery 结果中留下 warning，便于排查

服务类噪音评论也可能触发一次重新检查，但若没有代码增量，不应强制进入重度复审。

## 选择规则

- 构建一个按 PR `updatedAt` 排序的 `actionable_prs` 队列。
- 选择队列中的第一个 PR 作为 `selected_pr`。
- 将剩余项持久化为 `pending_queue`。
- 若队列为空，则输出 `NO_TARGET`，并附带 sleep 建议；下一轮仍需先重新跑 discovery，再判断是否继续等待。

## 失败处理

- 如果单个 PR 查询失败，则跳过该 PR 并继续。
- 如果整轮都无法有效检查任何 PR，则将 `failure_streak` 加一。
- 连续三轮整轮失败后，sleep 300 秒，并保留失败记录。
- 任意成功轮次都应将 `failure_streak` 重置为零。

## 退避策略

- 基础 sleep：180 秒
- 若连续多轮都没有变化，则将 sleep 时长翻倍
- 最大 sleep：1800 秒
- 一旦出现新的待处理 PR，立即将 sleep 重置回 180 秒

## 输出状态

每一轮发现阶段都应产出：

- `state`：`HAS_TARGET`、`NO_TARGET` 或 `FAILED_RETRYABLE`
- `actionable_prs`
- `selected_pr`
- `pending_queue`
- `warnings`
- `failure_streak`
- `next_sleep_seconds`

## 示例

### 示例 1

- PR 没有 `[Codex Reviewer]` 评论
- 结果：待处理

### 示例 2

- PR 昨天有一条 `[Codex Reviewer]` 评论
- PR 今天收到一个新提交
- 结果：待处理

### 示例 3

- PR 有一条 `[Codex Reviewer]` 评论
- 其后没有新评论、review 或提交
- 结果：跳过
