# Worker Agent Review Flow

## Blocking Inputs

下列输入都视为阻塞项：

- `REQUEST_CHANGES`
- 新的 `[Codex Reviewer]` 评论（不区分内容，包含“未发现问题/状态同步”）
- 新的人类普通评论
- `[Codex Reviewer] ❤️ 需要人类测试`
- `🙋needs-human-test`

## Priority Rules

优先级按风险排序：

1. `REQUEST_CHANGES`
2. `[Codex Reviewer]` 新意见
3. 新的人类普通评论
4. 人测阻塞与 CI 失败

## Reply-Then-Decide

工作 Agent 处理 review 的默认策略是：

1. 先引用原意见。
2. 先回复确认理解。
3. 再决定改代码、解释原因，还是明确无需改码。

这条规则同样适用于人类普通评论。

## No Silent Rule

工作 Agent 不允许对 `[Codex Reviewer]` 评论保持沉默。

- 无论评论内容是否为“未发现问题/状态同步”，都必须回复。

## No-Code-Change Response

即便这轮无需改码，也要发结构化 `[Codex Worker]` 评论，说明：

- 为什么无需改码
- 已检查了什么
- 结论是什么

## Resume Boundary

只有当前 `head SHA` 上没有未处理阻塞项时，才允许继续推进原始开发任务。

不允许一边欠 review 债，一边继续扩功能。

## Cursor Sync Rule

当当前这批 review / human comment 已经被处理并吸收后，工作 Agent 应运行一次 `cursor sync`，把当前 comment/review 集合写入 handled cursor。

否则同一批反馈会在下一轮继续被识别为“新阻塞项”。
