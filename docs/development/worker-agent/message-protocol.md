# Worker Agent Message Protocol

## Prefix Rules

所有由 `Worker Agent` 新建或更新的以下文本，都统一以 `[Codex Worker]` 开头：

- issue body
- PR body
- issue comment
- PR comment

标题不加前缀。

## Body Template

PR / issue body 至少包含：

- `Summary`
- `Scope`
- `Verification`
- `Links/Refs`

## Comment Template

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

## Quoted Reply Rule

对 review 或人类评论回复时，必须使用：

`> 原文关键句`

不要直接丢一句“已修复”而没有引用上下文。

## Validation Rules

发布前至少检查：

- 是否有 `[Codex Worker]` 前缀
- 是否有长串问号噪音
- 是否出现未转义 `\n`
- 是否缺少必要 section
