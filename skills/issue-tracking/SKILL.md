---
name: issue-tracking
description: Track ExoMind issues from natural-language user reports by deduplicating, checking current dev state, creating or updating issues, and linking dependencies without asking the user for structured forms.
---

# Issue Tracking

本技能是从 `references/` 提取出来的项目本地 skill 入口文档。

## When To Use

当用户提出以下请求时使用本技能：

- 追踪一个问题、需求或回归
- 根据自然语言报告创建或更新 GitHub issue
- 对比现有 open/closed issues 进行查重
- 在 issue 中附上当前 dev 实现状态的证据和依赖链接

## Load Order

1. 阅读 `references/charter.md`，获取完整追踪章程、SOP、模板和验证规则。
2. 需要标准 issue-tracking 提示词契约时，阅读 `references/boot-prompt.md`。
3. 仅在需要便携版时阅读 `references/portable-charter.md` 和 `references/portable-boot-prompt.md`。

## Core Rules

- 从用户的自然语言描述出发；不要求用户提供结构化表单信息。
- 在决定创建还是更新 issue 前，必须先查重。
- 必须核查当前 `dev` 实现状态，并记录文件路径证据。
- 按章程要求使用依赖链接和双向引用。
- 发布前规范化 issue/comment 的链接格式：避免裸 URL、避免本地绝对路径，将仓库引用转为简短命名的 Markdown 链接。

## Utility Scripts

### check-issue-newlines.ts

检测 GitHub issue 正文和评论是否存在新行符问题。

**问题本质**：正文内容量大（>200字符）但真换行极少（<3），说明写入时新行被吞成了空格或有损压缩，渲染出来全挤在一行。

**用法**：
```bash
bun run .claude/skills/issue-tracking/check-issue-newlines.ts [issue-numbers...]
bun run .claude/skills/issue-tracking/check-issue-newlines.ts --verbose 900 892 890
bun run .claude/skills/issue-tracking/check-issue-newlines.ts --json
```

- 不带 issue 数字：扫描全库 open issues
- 带数字：只检查指定 issue
- `--verbose`：打印每个检查结果
- `--json`：输出 JSON 格式结果

**重要**：检测只能发现问题，修复必须靠 Agent 理解内容结构后重建。有损压缩的压缩文本无法用脚本自动恢复正确 Markdown 格式。
