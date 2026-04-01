---
name: dev-route
description: Generate ExoMind development route maps, batch planning overviews, issue clustering, and next-step implementation route analyses for this repository.
---

# Dev Route

This skill is the project-local skill entry extracted from `docs/agents/dev-route/`.

## When To Use

Use this skill when the user asks for:

- a 航线 report
- batch planning or issue clustering
- an implementation route overview
- which issues can be done together or what the next batch should be

## Load Order

1. **Read the previous route first**: run `bun run devlog:extract --type route` to get the latest published route as Agent-friendly text. This is required for batch status comparison, trigger detection, and batch letter continuation.
2. Read `references/AGENTS.md` for the route-planning workflow, issue clustering rules, and output requirements.
3. Read `references/prompt.md` if you need the original execution prompt wording.
4. Use `assets/route-template.html` when the requested output needs the existing HTML route template.

## Reading Past Routes

To extract structured data from a published route (Agent-friendly text or JSON):

```bash
bun run devlog:extract --type route              # 最新航线 → 纯文本摘要
bun run devlog:extract --type route --format json # 最新航线 → JSON
bun run devlog:extract --file <path>              # 指定 HTML 文件
bun run devlog:extract --type route --source pages # 强制从 GitHub Pages 读取
```

When generating a new route, read the previous route first to compare batch status changes and detect triggers.

`devlog:extract` 默认按 `GitHub Pages routes/manifest.json -> data JSON -> latest.json` 读取，并在输出顶部返回 `[devlog-source]` 或 `_devlogSource`。
已发布归档现在要求 `dataFile` 必须存在；HTML 解析仅保留给显式 `--file` 或本地 `temp/` 兜底。
必须检查该来源块，确认：
- 来源是否为 `pages-json`
- `trust` 是否为 `high`
- `consistency` 是否为 `ok`

如果来源块显示 fallback、本地来源、HTML 兼容解析或一致性不完整，必须在后续输出中明确说明，不得把它表述为“最新已发布状态”。

## Core Rules

- Query open issues live with the required `gh` limits and priority checks.
- Keep issue clustering and batching logic aligned with the reference rules.
- Treat this file as the entry point; detailed heuristics stay in the copied reference docs.
- 发布链只认正式命令 `bun run route:publish`；不再引入 `v1/v2` 心智。
