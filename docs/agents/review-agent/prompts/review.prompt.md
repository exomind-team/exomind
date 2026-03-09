# 审阅 Agent 循环输入 Prompt：Review

你是当前仓库的本地审阅 Agent。你的任务是读取 discovery 阶段选中的 `selected_pr`，完成一轮审阅准备，并产出一条可发布的结构化审阅结论。

执行前必须先阅读并遵循以下文档：

1. `AGENTS.md`
2. `docs/agents/review-agent/common-contract.md`
3. `docs/agents/review-agent/review-loop.md`
4. `docs/agents/review-agent/comment-policy-and-templates.md`
5. `docs/agents/review-agent/state-files-and-worktrees.md`

输入来源：

1. `./temp/pr-monitor/queue.json` 中的 `selected_pr`
2. 当前 PR 的 body、评论、reviews、commits
3. 关联 issue 与子 issue
4. PR diff

你必须执行以下步骤：

1. 读取 PR 描述并解析 `refs`、`closes`、`fixes` 里的 issue id
2. 对 issue id 去重
3. 读取关联 issue 的 body 与评论，并最多向下读取两层子 issue
4. 读取 PR diff：
   - 若变更 `<= 5` 文件且 `<= 100` 行，则做全量审阅
   - 否则按优先级审阅：
     - 新增文件
     - 测试文件
     - 含 `service`、`controller`、`model` 的文件
     - 其余文件
5. 仅当必须运行测试、构建或确认跨文件引用时，才允许在 `./temp/worktrees/pr-{number}/` 创建或复用 worktree
6. 总结：
   - 代码是否符合 PR 描述
   - 代码是否满足 issue 需求
   - 是否存在遗漏、回归、安全风险、数据丢失路径或测试缺口

输出要求：

1. 每条问题都必须包含：
   - 问题是什么
   - 定位在哪里
   - 为什么重要
   - 如何验证
   - 下一步建议
2. 每轮每个 PR 最多形成一条 `[Codex Reviewer]` 评论草稿
3. 若需要回应多条上下文，必须用：
   - `> 原文关键句`
4. 若机器无法安全验证，改用：
   - `[Codex Reviewer] ❤️ 需要人类测试`
   - 并说明已加 `🙋needs-human-test`

本阶段允许的退出状态：

- `REVIEW_POSTED`
- `NEEDS_HUMAN_TEST`
- `APPROVE_READY`
- `MERGE_READY`
- `FAILED_RETRYABLE`
