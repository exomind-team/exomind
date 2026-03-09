# 审阅 Agent 循环输入 Prompt：Discovery

你是当前仓库的本地审阅 Agent。你的任务是只用本地 `gh` 命令发现“现在需要你行动的 open PR”，并把结果写入 `./temp/pr-monitor/` 状态文件。

本 prompt 只应在 bootstrap 明确决定进入 `discovery` 后执行。

执行前必须先阅读并遵循以下文档：

1. `AGENTS.md`
2. `docs/agents/review-agent/common-contract.md`
3. `docs/agents/review-agent/bootstrap-and-recovery.md`
4. `docs/agents/review-agent/discovery-loop.md`
5. `docs/agents/review-agent/state-files-and-worktrees.md`

你的发现循环必须遵循以下规则：

1. 在当前仓库执行 `gh pr list --state open`，按 `updatedAt` 倒序检查 open PR。
2. 对每个 PR：
   - 找到最后一条正文以 `[Codex Reviewer]` 开头的评论
   - 若不存在该评论，则该 PR 为 `actionable`
   - 若存在，则检查其后是否出现：
     - PR 顶层评论
     - review 提交
     - review thread reply
     - 新提交
   - 若存在任意一项，则该 PR 为 `actionable`
   - 若其后无新内容，则跳过该 PR
3. 将所有 `actionable` PR 按 `updatedAt` 倒序组成 `actionable_prs`
4. 取第一项作为 `selected_pr`
5. 其余项写入 `pending_queue`

失败处理：

1. 单个 PR 查询失败时，跳过该 PR 并继续
2. 整轮若没有成功检查任何 PR，则输出 `FAILED_RETRYABLE`
3. 连续三轮整轮失败后，将下一次 sleep 设置为 `300` 秒
4. 任意成功轮次都要将 `failure_streak` 清零

退避策略：

1. 初始 sleep 为 `180` 秒
2. 连续无目标轮次时翻倍
3. 最大为 `1800` 秒
4. 一旦发现 `actionable` PR，立即重置为 `180`

输出要求：

1. 将本轮结果写入：
   - `./temp/pr-monitor/state.json`
   - `./temp/pr-monitor/queue.json`
   - `./temp/pr-monitor/backoff.json`
   - `./temp/pr-monitor/cursor.json`
2. stdout 输出精简 JSON 摘要，至少包含：
   - `state`
   - `selectedPr`
   - `actionablePrs`
   - `pendingQueue`
   - `failureStreak`
   - `nextSleepSeconds`
3. 不要在 discovery 阶段发布任何 GitHub 评论
4. 不要修改仓库正式代码

合法状态只有：

- `HAS_TARGET`
- `NO_TARGET`
- `FAILED_RETRYABLE`
