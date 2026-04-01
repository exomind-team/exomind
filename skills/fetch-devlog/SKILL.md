---
name: fetch-devlog
description: Fetch and parse the latest ExoMind development report or route data from GitHub Pages manifests with provenance and trust metadata. Use when the user asks about project status, latest report, latest route, or development progress.
---

# Fetch Devlog

获取并解析 ExoMind 最新的开发日报或开发航线数据。

## When To Use

当用户询问以下内容时使用此 skill：

- “最新日报”“最近开发情况”“项目状态”
- “最新航线”“开发路线图”“下一个批次”
- “P0/P1 有多少”“天气如何”“航况如何”

## Standard Entry

唯一标准入口是 GitHub Pages 子 manifest：

- 日报：`https://exomind-team.github.io/exomind-devlog/reports/manifest.json`
- 航线：`https://exomind-team.github.io/exomind-devlog/routes/manifest.json`

默认读取链：

1. 子 `manifest.json`
2. manifest 指向的 `dataFile` JSON
3. 同目录 `latest.json` 一致性校验

`raw.githubusercontent.com`、本地 `temp/`、本地 `exomind-devlog` 只作为 fallback，不是默认入口。
已发布归档必须通过 `dataFile` JSON 读取；HTML 解析仅保留给显式 `--file` 或本地 `temp/`。

## Commands

优先使用统一读取器：

```bash
bun run devlog:extract --type report
bun run devlog:extract --type route
bun run devlog:extract --type report --format json
bun run devlog:extract --type route --format json
```

如果只想拿日报摘要，也可以用薄包装：

```bash
bun scripts/dev/fetch-latest-devlog.ts
bun scripts/dev/fetch-latest-devlog.ts --headlines
bun scripts/dev/fetch-latest-devlog.ts --actions
bun scripts/dev/fetch-latest-devlog.ts --full
```

## Provenance Rule

`devlog:extract` 与 `fetch-latest-devlog.ts` 都会输出来源信息：

- 纯文本：顶部 `[devlog-source] ... [/devlog-source]`
- JSON：顶层 `_devlogSource`

调用后必须检查：

- `resolved` 是否为 `pages-json`
- `trust` 是否为 `high`
- `consistency` 是否为 `ok`

如果不是以上组合，只能表述为“fallback 结果”或“部分可信”，不能说是“最新已发布状态”。

## Examples

### 最新日报摘要

```bash
bun run devlog:extract --type report
```

### 最新航线 JSON

```bash
bun run devlog:extract --type route --format json
```

### 强制检查 GitHub Pages 而不接受本地 fallback

```bash
bun run devlog:extract --type report --source pages
```

如果这里失败，说明线上标准入口本身有问题；不要静默改读本地并冒充“最新线上状态”。
