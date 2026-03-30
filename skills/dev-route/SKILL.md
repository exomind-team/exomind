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

1. Read `references/AGENTS.md` for the route-planning workflow, issue clustering rules, and output requirements.
2. Read `references/prompt.md` if you need the original execution prompt wording.
3. Use `assets/route-template.html` when the requested output needs the existing HTML route template.

## Reading Past Routes

To extract structured data from a published route (Agent-friendly text or JSON):

```bash
bun run devlog:extract --type route              # 最新航线 → 纯文本摘要
bun run devlog:extract --type route --format json # 最新航线 → JSON
bun run devlog:extract --file <path>              # 指定 HTML 文件
bun run devlog:extract --type route --source devlog # 从 devlog 仓库读取
```

When generating a new route, read the previous route first to compare batch status changes and detect triggers.

## Core Rules

- Query open issues live with the required `gh` limits and priority checks.
- Keep issue clustering and batching logic aligned with the reference rules.
- Treat this file as the entry point; detailed heuristics stay in the copied reference docs.
