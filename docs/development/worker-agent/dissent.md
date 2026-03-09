# Worker Agent Dissent Flow

## When To Dissent

当 `Worker Agent` 判断“脚本状态机结论与实际工作情况明显不一致”，且存在明确、可检验的逻辑链路时，必须触发执行异议。

## Required Closure

执行异议必须形成闭环：

1. 创建或复用专门 issue
2. 给当前 PR 打 `❗Worker执行异议` 标签
3. 在 PR 发 `[Codex Worker]` 评论
4. 在评论中回链该 issue

## Required Evidence

无论 issue 还是 PR 评论，都必须包含：

- 脚本结论
- 实际结论
- 复现证据
- 追踪过程
- 影响范围
- 关联链接

## Label Rule

若仓库中不存在 `❗Worker执行异议` 标签，工作 Agent 应先创建该标签，再继续执行异议闭环。
