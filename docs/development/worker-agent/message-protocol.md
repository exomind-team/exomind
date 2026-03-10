# Worker Agent Message Protocol

## Prefix Rules

所有由 `Worker Agent` 新建或更新的以下文本，都统一以 `[Codex Worker]` 开头：

- issue body
- PR body
- issue comment
- PR comment

标题不加前缀。

## Language Rule

所有由 `Worker Agent` 发出的对外文本，都必须跟随关联 issue 的主语言。

- 真相源优先取 `next-action` / `restore` 输出里的 `context.targetLanguage`
- 当前支持值为 `zh` / `en`
- 若使用 `render-*` 命令生成草稿，需显式传入 `--language <targetLanguage>`
- 不再把固定英文 section 名视为协议真相

## Per-Round Progress Comment Rule

工作 Agent 现在按“单动作循环机”推进，因此每完成一轮关键动作，都要更新一条 `[Codex Worker]` 评论。

至少以下情况必须评论：

- 代码发生变化
- 完成一轮验证
- 完成提交/推送
- 进入等待边界
- `🙋needs-human-test` 状态发生变化
- 触发 Worker 执行异议
- 处理 reviewer / human comment（包含“未发现问题/状态同步”，不得沉默）

## Standard Comment Template

```text
[Codex Worker]
> 原文关键句

变更 / Change
...

验证 / Verification
...

结果 / Result
...
```

## Body Template

PR / issue body 至少包含：

- 摘要语义
- 范围语义
- 验证语义
- 关联/引用语义

section 标题语言跟随 `targetLanguage`，例如：

- `zh`：`摘要` / `范围` / `验证` / `关联/引用`
- `en`：`Summary` / `Scope` / `Verification` / `Links/Refs`

## Worker Dissent Templates

### PR Comment

```text
[Codex Worker]

结论 / Conclusion
脚本 / Script: ...
实际 / Actual: ...

复现证据 / Repro Evidence
...

追踪过程 / Trace Process
...

影响 / Impact
...

关联议题 / Linked Issue
...
```

### Issue Body

```text
[Codex Worker]

## 脚本结论 / Script Conclusion
...

## 实际结论 / Actual Conclusion
...

## 复现证据 / Repro Evidence
...

## 追踪过程 / Trace Process
...

## 影响 / Impact
...

## 关联 PR / Linked PR
...
```

允许在 issue body 末尾通过 `---` 分隔后追加自由说明。

## Validation Rules

发布前至少检查：

- 是否有 `[Codex Worker]` 前缀
- 是否有长串问号噪音
- 是否出现未转义 `\n`
- 文本语言是否与 `targetLanguage` 一致
