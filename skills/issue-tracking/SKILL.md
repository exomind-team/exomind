---
name: issue-tracking
description: Track ExoMind issues from natural-language user reports by deduplicating, checking current dev state, creating or updating issues, and linking dependencies without asking the user for structured forms.
---

# Issue Tracking

This skill is the project-local skill entry extracted into [`references/`](references/).

## When To Use

Use this skill when the user asks to:

- 追踪一个问题、需求或回归
- create or update a GitHub issue from a natural-language report
- deduplicate an issue against existing open or closed issues
- attach current dev-state evidence and dependency links to an issue

## Load Order

1. Read `references/charter.md` for the full tracking charter, SOP, template, and validation rules.
2. Read `references/boot-prompt.md` when you need the standard issue-tracking prompt contract.
3. Read `references/portable-charter.md` and `references/portable-boot-prompt.md` only when you need the portable variants.

## Core Rules

- Start from the user's natural-language description; do not ask for form-style structured inputs.
- Always deduplicate before deciding to create or update an issue.
- Always inspect current `dev` implementation state and record file-path evidence.
- Use dependency links and bidirectional references when the charter requires them.
- Normalize issue/comment link formatting before publishing: avoid bare URLs, avoid local absolute paths, and turn repository references into short-named Markdown links.

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
