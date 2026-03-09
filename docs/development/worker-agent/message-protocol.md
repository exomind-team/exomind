# Worker Agent Message Protocol

## Prefix Rules

所有由 `Worker Agent` 新建或更新的以下文本，都统一以 `[Codex Worker]` 开头：

- issue body
- PR body
- issue comment
- PR comment

标题不加前缀。

## Per-Round Progress Comment Rule

工作 Agent 现在按“单动作循环机”推进，因此每完成一轮关键动作，都要更新一条 `[Codex Worker]` 评论。

至少以下情况必须评论：

- 代码发生变化
- 完成一轮验证
- 完成提交/推送
- 进入等待边界
- `🙋needs-human-test` 状态发生变化
- 触发 Worker 执行异议
- 处理 reviewer / human comment

## Standard Comment Template

```text
[Codex Worker]
> 原文关键句

Change
...

Verification
...

Result
...
```

## Body Template

PR / issue body 至少包含：

- `Summary`
- `Scope`
- `Verification`
- `Links/Refs`

## Worker Dissent Templates

### PR Comment

```text
[Codex Worker]

Conclusion
Script: ...
Actual: ...

Repro Evidence
...

Trace Process
...

Impact
...

Linked Issue
...
```

### Issue Body

```text
[Codex Worker]

## Script Conclusion
...

## Actual Conclusion
...

## Repro Evidence
...

## Trace Process
...

## Impact
...

## Linked PR
...
```

允许在 issue body 末尾通过 `---` 分隔后追加自由说明。

## Validation Rules

发布前至少检查：

- 是否有 `[Codex Worker]` 前缀
- 是否有长串问号噪音
- 是否出现未转义 `\n`
- 是否缺少必要 section
