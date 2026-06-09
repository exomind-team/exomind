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

1. **Read MAINTENANCE.md first** if you are modifying this skill. It contains critical lessons from past failures and a checklist to avoid repeating mistakes.
2. **Read the previous report first**: run `bun run devlog:extract --type report` to get the latest published report as Agent-friendly text. This is required for trend comparison, coverage interval calculation, and scorecard evaluation.
3. Read `references/AGENTS.md` for the reporting workflow, data collection rules, and output structure.
4. Read `references/prompt.md` if you need the original execution prompt wording.
5. Use `assets/report-template.html` when the requested output needs the existing HTML template.

## Reading Past Reports

To extract structured data from a published report (Agent-friendly text or JSON):

```bash
bun run devlog:extract --type report              # 最新日报 → 纯文本摘要
bun run devlog:extract --type report --format json # 最新日报 → JSON
bun run devlog:extract --file <path>               # 指定 HTML 文件
bun run devlog:extract --type report --source pages # 强制从 GitHub Pages 读取
```

When generating a new report, read the previous report first to compare trends and fill the scorecard.

`devlog:extract` 默认按 `GitHub Pages reports/manifest.json -> data JSON -> latest.json` 读取，并在输出顶部返回 `[devlog-source]` 或 `_devlogSource`。
已发布归档现在要求 `dataFile` 必须存在；HTML 解析仅保留给显式 `--file` 或本地 `temp/` 兜底。
必须检查该来源块，确认：
- 来源是否为 `pages-json`
- `trust` 是否为 `high`
- `consistency` 是否为 `ok`

如果来源块显示 fallback、本地来源、HTML 兼容解析或一致性不完整，必须在后续输出中明确说明，不得把它表述为“最新已发布状态”。

## Writing Principles

日报必须同时满足三件事：

- **人话可读**：先服务看不见 GitHub 的读者。正文优先使用“待处理问题 / 待合入改动 / 同步恢复问题 / 官网下载链路”这类自然语言，而不是 `open issue / PR / inflow / batch / noPriority` 一类平台或内部黑话。
- **事实可证**：每个关键判断都必须能追到时间窗、指标、issue/PR 编号、commit、测试结果或已发布 JSON/manifest。简化表述可以，不能简化证据标准。
- **来源易达**：不仅要能溯源，还要方便溯源。只要存在直达链接，就必须在参考层给出，并用人话标签渲染成超链接；默认不要把裸 URL 直接堆进正文。
- **渐进披露**：首屏只披露完成判断所必需的复杂度；编号、commit、文件路径、原始术语映射和更细参考放到展开区或后层说明中。

写作时默认采用双层结构：

- **主文本**：先写“发生了什么、意味着什么、下一步做什么”。
- **参考展开**：再附编号、时间窗、提交、路径、数据源和验证证据；凡有直达链接的来源，优先写成人话标签的超链接，而不是直接贴网址。

默认表达顺序：

1. 先写结论，再写依据。
2. 先写主题，再写编号。
3. 先写影响，再写机制。
4. 明确区分“止跌”和“推进”、“事实”和“推断”。

## Core Rules

- Query GitHub and git state live; do not reuse stale report data.
- Fetch the latest `dev` branch before collecting status when the workflow requires it.
- Preserve the report naming and daypart rules defined in the reference docs.
- Keep the entry skill concise; put detailed reporting logic in the reference files.
- 发布链只认正式命令 `bun run devlog:publish`；不再使用或宣传 `v1/v2` 区分。
