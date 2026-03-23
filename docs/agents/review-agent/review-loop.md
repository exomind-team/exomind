# 审阅循环

## 读取时机

- 只有当 `router.action = review`，或上一步输出的 `referencesMustRead` 包含本文档时，你才读取并遵循本文
- review 规则不再要求你在冷启动时预先加载 comment / state-worktree 文档
- 当 review 动作需要发布/更新评论时，你再继续读取 `comment-policy-and-templates.md`
- 当 review 需要状态恢复或 worktree 验证时，你再继续读取 `state-files-and-worktrees.md`

## 输入

- 来自 discovery 阶段的 `selected_pr`
- PR body 与元数据
- 关联 issue 与子 issue
- PR diff
- 在规则允许时可选使用本地 worktree

## 前置条件

- discovery 阶段必须先产出 `HAS_TARGET`
- `selected_pr` 必须来自 `./temp/pr-monitor/queue.json`
- review 阶段不重新负责 PR 选择

## Issue 上下文收集

1. 你读取 PR 描述。
2. 你解析 `refs`、`closes`、`fixes` 中引用的 issue id。
3. 你读取每个关联 issue 的 body 与评论。
4. 你读取最多两层的子 issue。
5. 你在读取前先对重复 issue id 去重。

## Diff 分流

- 若 diff 满足 `<= 5` 文件且 `<= 100` 变更行，你进行全量审阅。
- 否则你按以下优先级审阅：
  - 新增文件
  - 测试文件
  - 文件名或路径含 `service`、`controller`、`model` 的文件
  - 其余文件

对于大 PR，你的审核评论必须显式说明本轮使用的是优先级审阅，而不是全量审阅。

优先级审阅建立在完整文件列表之上：

- review-loop 必须拉全分页后的 PR 文件列表
- 若分页中途失败，当前 review 结果不可信，你必须停止本轮并写成可重试失败
- 分页失败属于阻塞当前 review，而不是回退到 discovery

## 审阅深度规则

你必须同时对照：

- PR 描述
- issue 需求
- 实际代码变更

你必须回答：

- 代码是否实现了 PR 声称的范围？
- 代码是否满足 issue 需求？
- 是否存在明显遗漏、回归或不匹配？

## CI 归因规则

- review-loop 在决定 `approve` / `merge-ready` 前，必须把当前 PR 的失败检查与基分支最新检查结果对比。
- 基分支已经同名失败的检查属于 inherited failure，本身不构成阻塞。
- 当前 PR 新引入的失败检查、或归因不明的失败检查，属于 blocking failure。
- 若当前 PR 直接修改了 CI workflow、构建链、依赖安装、类型检查基线或测试入口，你的 CI 归因必须更保守；无法证明”不是本分支引入”时，你按 blocking failure 处理。

## 对齐检查

你在审阅时应明确指出：

- 范围不匹配
- 测试缺失
- 风险假设
- 安全或数据丢失路径
- 在真实使用中可能回归的行为

## 问题格式

每条问题都应包含：

- 问题是什么
- 定位在哪里
- 为什么重要
- 如何验证
- 下一步建议是什么

## 何时使用工作树（Worktree）

你仅在以下场景才创建或复用 `./temp/worktrees/pr-{number}/`：

- 必须运行本地测试或构建
- 必须可靠地检查跨文件引用关系

在 worktree 内：

- 你允许读取文件
- 你允许运行测试和构建
- 你允许为本地验证而修改代码
- 你不允许 commit 或 push

当前 review summary 不再输出 `needsWorktree` 这种布尔结论字段。

原因：

- 现阶段尚未有足够可靠的自动判定规则
- 输出硬编码 `false` 比不输出更危险
- 是否需要 worktree，暂时由你的 review 执行逻辑和评论内容显式表达

## GitHub 动作层

当前 `review-loop.ts` 已承担 review 阶段的真实 GitHub 动作执行。

当门禁满足时你允许通过 `--merge` 自动执行 `gh pr merge --squash`。

支持的动作入口：

- `--body-file <path>`：发布或更新一条主审核评论
- `--comment-id <id>`：显式覆盖默认目标，强制编辑指定评论
- `--needs-human-test`：添加 `🙋needs-human-test` 标签，并发布人测评论
- `--request-changes`：发布主审核评论后，再执行 `request changes`
- `--approve`：发布主审核评论后，再执行 `approve`
- `--merge`：发布“评论即通过”评论后执行 `merge`；评论本身即为审批等价门禁，脚本只会 best-effort 尝试一次 `approve` 以兼容多 GitHub 账号场景，失败不阻塞合并
- `--ci-status <passed|failed|missing|inherited-failure>`：为 `--approve` / `--merge` 显式提供 CI 门禁结果
- `--local-verification-status <passed|failed|missing>`：为 `--approve` / `--merge` 显式提供本地验证门禁结果

约束：

- 你每次 review round 只维护一条主审核评论作为当前机器审阅真相源
- 默认目标评论 = GitHub 远端最新一条符合协议的顶层 `[Codex Reviewer]` 主评论；若不存在，才创建新评论
- 你不再在本地状态保存主评论 id；失败恢复与正常续写都必须重新按远端识别当前主评论
- 若评论发布后校验失败，你的后续重试必须编辑同一条评论，而不是新发第二条
- `needs-human-test` 路径先加标签，再发评论，因为标签才是真相源
- 只要 `🙋needs-human-test` 标签仍在，`approve` 必须被阻断并写成可重试失败
- `approve` 只有在显式传入 `--ci-status passed|inherited-failure` 与 `--local-verification-status passed` 时才允许执行
- 若任一门禁参数缺失，脚本必须按 `missing` 处理，并阻断 `approve`
- 若任一门禁为 `failed`，脚本必须阻断 `approve`，不得写出 `APPROVE_READY`
- 你自动收口时默认直接走 `merge`；`approve` 只保留给显式兼容场景，你不应用作等待外部 reviewer 的中间站
- `merge` 只有在 `CI = passed|inherited-failure` 且 `local verification = passed` 时才允许执行
- `merge` 会在发布/更新通过评论后直接执行真实 `gh pr merge --squash`；你不得依赖额外的本地预检字段代替 GitHub merge 结果
- 合并失败若属于权限/保护/不可合并/冲突，落盘为 `MERGE_BLOCKED`，且你在评论中需写明阻塞原因；冲突你必须提示”请同步目标分支后重试”
- `merge` 门禁缺失或失败同样视为 `MERGE_BLOCKED`，记录原因后回到 discovery，不重复尝试
- 其他合并失败按可重试失败处理，但仅交由后续恢复流程处理，不在当前轮内重复尝试
- merge 输出中的 `reviewDecision` 表示 formal GitHub review 是否真的落地；`reviewDecisionAttempted` 仅表示是否做过兼容性尝试，你不能拿来替代真实审批结果
- 同账号的 Worker/Reviewer 仍视为不同执行主体；当”评论即通过”门禁满足时，你不应仅因账号相同就推断需要其他用户介入

## 退出状态

- `REVIEW_POSTED`：审核评论已成功发布
- `NEEDS_HUMAN_TEST`：需要人类验证
- `APPROVE_READY`：仅显式 `--approve` 路径成功后使用；它代表 formal GitHub approve 已落地
- `MERGE_READY`：`gh pr merge --squash` 已真实成功
- `MERGE_BLOCKED`：合并被阻塞且不重试
- `FAILED_RETRYABLE`：暂时性失败，可重试

## 终态落盘

你在 review 阶段真正完成 GitHub 动作后，不能只停留在内存结论，必须立即把终态写回 `state.json`。

推荐做法：

1. 你优先通过 `review-loop.ts` 的动作参数直接执行真实 GitHub 动作
2. 脚本在动作成功后自动把终态写回 `state.json`
3. 下一轮统一入口 prompt 重启时，router 会据此回到 `discovery`，而不是误续接上一轮 `review`

`--mark-result` 仍保留，但只作为手动恢复或补记终态的兜底入口，你不应将其作为正常路径。

约束：

- 正常动作路径必须由脚本自动完成终态落盘
- 你只应在对应 GitHub 动作已经成功后调用 `--mark-result`
- 若动作未真正完成，你不要提前写终态
- 若动作失败，你应保留当前 PR 上下文，并写成可重试失败状态，而不是伪造成功终态
- 若失败发生在评论已发布之后，你必须保留该评论 id，以便下一轮继续编辑同一条评论
