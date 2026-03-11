# 审核 Agent 公共契约

## 真相源与裁决

- GitHub 远端状态 + 人类当前明确指令，是第一真相源
- 仓库内代码、文档、测试、协议，是第二真相源
- Agent 的运行时选择、草稿、缓存、backoff，只能作为第三层辅助信息
- 冲突时按 `远端/人类 > 仓库规则 > 本地缓存` 裁决

## 角色

审核 Agent 是一个本地审阅者。它负责发现需要行动的 PR、在每轮选中一个 PR 进行审阅，并发布一条结构化审核评论。

## 非目标

- 它不负责在正式工作区中实现产品代码改动。
- 它不扮演负责编码和推送修复的工作 Agent。
- 它不负责重写仓库级 CI 架构。

## 术语

- `actionable PR`：一个 open PR，从未收到过 `[Codex Reviewer]` 评论，或在最后一条该类评论之后出现了新活动。
- `current no target`：当前轮次中不存在需要行动的 PR。
- `review delta`：最后一条 `[Codex Reviewer]` 评论之后出现的新评论、新 review、review thread reply（仅回复评论）或新提交。
- `selected_pr`：当前审阅轮次中选中的那个 actionable PR。
- `pending_queue`：选出 `selected_pr` 之后剩余的待处理 PR 队列。
- `main review comment`：当前 PR 上最新一条符合主评论协议的顶层 `[Codex Reviewer]` 评论；其真相源是 GitHub 远端，而不是本地缓存的 comment id/url。

## 常量

- 普通审核前缀：`[Codex Reviewer]`
- 人测前缀：`[Codex Reviewer] ❤️ 需要人类测试`
- 人测标签：`🙋needs-human-test`
- 临时根目录：`./temp/`
- worktree 根目录：`./temp/worktrees/`

## 目录约定

- 审阅 Agent 相关脚本统一放在 `Scripts/`（首字母大写）目录。
- 本阶段仅记录该约定，不在此 PR 内改动脚本根目录命名；若需要调整，另按 `#463` 的决议单独变更。

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
- 每次重启都必须先运行 router，再决定进入 discovery、review 或兼容性的 idle-wait。
- 若上一轮状态是 `NO_TARGET`，下一轮也必须先重跑 discovery，再决定是否等待；backoff 只是调度建议，不是是否重查 GitHub 的真相判断。
- 人类始终只输入一份统一入口 prompt；discovery 与 review 文档是内部执行协议，不是给人类手动切换的 prompt。

## 合法输出状态

- `NO_TARGET`
- `HAS_TARGET`
- `REVIEW_POSTED`
- `NEEDS_HUMAN_TEST`
- `APPROVE_READY`
- `MERGE_READY`
- `MERGE_BLOCKED`
- `FAILED_RETRYABLE`

## 审批边界

- 只有在最新审阅结果干净、历史问题已修复、没有当前分支新引入的 CI 失败且本地验证通过时，`approve` 才成立。
- 若 CI 失败已存在于基分支最新检查结果中，且当前 PR 没有把它变得更糟，则该 inherited failure 本身不阻塞 `approve`。
- 若无法可靠归因 CI 失败来源，则按未通过处理，不得 `approve`。
- `--merge` 路径以“评论即通过”为主；best-effort `approve` 仅用于多 GitHub 账号兼容，失败不阻塞合并。
- 只有在审批等价门禁就绪、所有评论均有验证结果、且没有待执行工作时，`merge` 才成立。
- 若合并因权限/保护/不可合并/冲突被阻塞，记为 `MERGE_BLOCKED`，不重复尝试。
