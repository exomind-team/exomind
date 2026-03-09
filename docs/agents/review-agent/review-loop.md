# 审阅循环

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

1. 读取 PR 描述。
2. 解析 `refs`、`closes`、`fixes` 中引用的 issue id。
3. 读取每个关联 issue 的 body 与评论。
4. 读取最多两层的子 issue。
5. 在读取前先对重复 issue id 去重。

## Diff 分流

- 若 diff 满足 `<= 5` 文件且 `<= 100` 变更行，则进行全量审阅。
- 否则按以下优先级审阅：
  - 新增文件
  - 测试文件
  - 文件名或路径含 `service`、`controller`、`model` 的文件
  - 其余文件

对于大 PR，审核评论必须显式说明本轮使用的是优先级审阅，而不是全量审阅。

## 审阅深度规则

审阅必须同时对照：

- PR 描述
- issue 需求
- 实际代码变更

必须回答：

- 代码是否实现了 PR 声称的范围？
- 代码是否满足 issue 需求？
- 是否存在明显遗漏、回归或不匹配？

## 对齐检查

审阅时应明确指出：

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

仅在以下场景才创建或复用 `./temp/worktrees/pr-{number}/`：

- 必须运行本地测试或构建
- 必须可靠地检查跨文件引用关系

在 worktree 内：

- 允许读取文件
- 允许运行测试和构建
- 允许为本地验证而修改代码
- 不允许 commit 或 push

## 退出状态

- `REVIEW_POSTED`：审核评论已成功发布
- `NEEDS_HUMAN_TEST`：需要人类验证
- `APPROVE_READY`：本地审核结论干净，且门禁全部通过
- `MERGE_READY`：所有合并条件满足
- `FAILED_RETRYABLE`：暂时性失败，可重试

## 终态落盘

review 阶段在真正完成 GitHub 动作后，不能只停留在内存结论，必须立即把终态写回 `state.json`。

推荐做法：

1. 先完成实际动作：
   - 发布评论
   - 或标记 `request-changes`
   - 或 `approve`
   - 或 `merge`
2. 再执行：
   - `npx tsx Scripts/review-agent/review-loop.ts --mark-result review-posted`
   - `npx tsx Scripts/review-agent/review-loop.ts --mark-result needs-human-test`
   - `npx tsx Scripts/review-agent/review-loop.ts --mark-result approve-ready`
   - `npx tsx Scripts/review-agent/review-loop.ts --mark-result merge-ready`
3. 下一轮统一入口 prompt 重启时，router 会据此回到 `discovery`，而不是误续接上一轮 `review`

约束：

- `--mark-result` 只应在对应 GitHub 动作已经成功后调用
- 若动作未真正完成，不要提前写终态
- 若动作失败，应保留或写成可重试失败状态，而不是伪造成功终态
