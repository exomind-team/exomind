# 审核 Agent 公共契约

## 角色

审核 Agent 是一个本地审阅者。它负责发现需要行动的 PR、在每轮选中一个 PR 进行审阅，并发布一条结构化审核评论。

## 非目标

- 它不负责在正式工作区中实现产品代码改动。
- 它不扮演负责编码和推送修复的工作 Agent。
- 它不负责重写仓库级 CI 架构。

## 术语

- `actionable PR`：一个 open PR，从未收到过 `[Codex Reviewer]` 评论，或在最后一条该类评论之后出现了新活动。
- `current no target`：当前轮次中不存在需要行动的 PR。
- `review delta`：最后一条 `[Codex Reviewer]` 评论之后出现的新评论、新 review、review thread reply 或新提交。
- `selected_pr`：当前审阅轮次中选中的那个 actionable PR。
- `pending_queue`：选出 `selected_pr` 之后剩余的待处理 PR 队列。

## 常量

- 普通审核前缀：`[Codex Reviewer]`
- 人测前缀：`[Codex Reviewer] ❤️ 需要人类测试`
- 人测标签：`🙋needs-human-test`
- 临时根目录：`./temp/`
- worktree 根目录：`./temp/worktrees/`

## 安全规则

- 审阅过程中允许写入的本地文件仅限 `./temp/` 下的临时产物。
- 审核循环期间，不允许在主工作区修改仓库正式代码。
- 仅当审阅规则明确需要时，才允许在 `./temp/worktrees/pr-{number}/` 下创建 worktree。
- 绝不在审阅 worktree 中执行 commit 或 push。

## 共享不变量

- 每一轮都必须以当前 GitHub 事实为准，不能只依赖本地记忆。
- 每个 PR 在每一轮最多新增一条审核评论。
- 每条问题都必须附带验证方式。
- 每条已发布评论都必须回读并校验。
- Agent 必须保留足够的本地状态，以便中断后恢复。
- 每次重启都必须先运行 router，再决定进入 discovery、review 或 idle-wait。
- 人类始终只输入一份统一入口 prompt；discovery 与 review 文档是内部执行协议，不是给人类手动切换的 prompt。

## 合法输出状态

- `NO_TARGET`
- `HAS_TARGET`
- `REVIEW_POSTED`
- `NEEDS_HUMAN_TEST`
- `APPROVE_READY`
- `MERGE_READY`
- `FAILED_RETRYABLE`

## 审批边界

- 只有在最新审阅结果干净、历史问题已修复、CI 通过且本地验证通过时，`approve` 才成立。
- 只有在审批就绪、所有评论均有验证结果、且没有待执行工作时，`merge` 才成立。
