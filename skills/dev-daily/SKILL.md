---
name: dev-daily
description: Generate ExoMind development daily reports, including 早报、午报、晚报、夜报、日报, issue/PR status summaries, and devlog dashboards for this repository.
---

# Dev Daily

This skill is the project-local skill entry extracted from `docs/agents/dev-daily/`.

## When To Use

Use this skill when the user asks for:

- a dev daily report such as 早报、午报、晚报、夜报、日报
- a summary of current GitHub issues and PRs
- a development status log or dashboard for ExoMind

## Load Order

1. Read `references/AGENTS.md` for the reporting workflow, data collection rules, and output structure.
2. Read `references/prompt.md` if you need the original execution prompt wording.
3. Use `assets/report-template.html` when the requested output needs the existing HTML template.

## Reading Past Reports

To extract structured data from a published report (Agent-friendly text or JSON):

```bash
bun run devlog:extract --type report              # 最新日报 → 纯文本摘要
bun run devlog:extract --type report --format json # 最新日报 → JSON
bun run devlog:extract --file <path>               # 指定 HTML 文件
bun run devlog:extract --type report --source devlog # 从 devlog 仓库读取
```

When generating a new report, read the previous report first to compare trends and fill the scorecard.

## Core Rules

- Query GitHub and git state live; do not reuse stale report data.
- Fetch the latest `dev` branch before collecting status when the workflow requires it.
- Preserve the report naming and daypart rules defined in the reference docs.
- Keep the entry skill concise; put detailed reporting logic in the reference files.
