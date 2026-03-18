# 工作 Agent 主提示词来源

`工作 Agent` 的用户入口是固定主提示词，而不是可变步骤提示词。

## 核心规则

用户永远只复制：

- `docs/worker-agent/prompts/main.md`

## 主提示词必须负责的事项

主提示词必须明确要求 Agent：

1. 先运行 `next-action`
2. 以脚本状态机结果为准
3. 每轮只做一个最高优先级动作
4. 若当前反馈批次已处理，先运行 `cursor sync`
5. 动作完成后显式续锁
6. 需要时发 `[Codex Worker]` 评论
7. 再次运行 `next-action`
8. 若结果是等待，则调用 `wait-for-update`

## 硬门槛

- 当前 PR 真相源优先取 `PR 锁系统`
- 只处理自己当前持锁 PR
- 人类普通评论也算阻塞项
- `[Codex Reviewer]` 评论不区分内容，必须回复，不允许沉默
- 所有 body/comment 使用 `[Codex Worker]` 前缀
- 提交前必须同步 PR 正文
- 每轮动作后必须显式续锁

## 禁止事项

- 不要使用 `[Codex Reviewer]`
- 不要执行 `gh pr review`
- 不要执行 `gh pr merge`
