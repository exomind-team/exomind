# ExoMind Website

## Brand Language / 品牌文案

- `ExoMind` = singular brand（单数品牌）: one person's exomind, one person's cognitive infrastructure（一个人的外心 / 认知基础设施）
- `exominds` = plural vision（复数愿景）: many exominds gradually linked into a collaborative network（更多人的外心逐步连接成协作网络）
- Current domain（当前域名）: `exo-mind.ai`

Recommended copy / 推荐文案:

- `Build your exomind.` / `先建立一个人的外心。`
- `Connect exominds.` / `再把更多人的外心连接起来。`
- `ExoMind is infrastructure for exominds.` / `ExoMind 是通向 exominds 的基础设施。`

Working naming note / 命名说明:

- Keep `exo-mind.ai` as the current domain and the home of the ExoMind brand（继续使用 `exo-mind.ai` 作为 ExoMind 核心品牌域名）
- As the product grows from personal growth into collective collaboration, use `exominds` in copy as the plural vision without forcing a domain migration first（当产品从个人成长扩展到群体协作时，在文案层使用 `exominds` 表达复数愿景，不必先迁移域名）

## Theme / 主题模式

- The website now supports a built-in dark mode toggle (`theme-toggle`) in the header.
- Theme preference is stored in `localStorage` with key `exomind-theme`.
- On first visit, the site follows `prefers-color-scheme` (system theme / 系统主题).

## Local Development / 本地开发

```bash
bun run --cwd website dev
```

## Build for Cloudflare / Cloudflare 构建

```bash
bun run website:build
```

## Local Cloudflare Preview / 本地 Cloudflare 预览

```bash
bun run website:cf:dev
```

## Dry-run Deploy / 部署演练（不真正发布）

```bash
bun run website:cf:dry-run
```

## Automated Test / 自动化测试

```bash
# Local website E2E (本地站点 E2E)
bun run test:e2e:website

# Production smoke test (线上官网冒烟测试)
bun run test:e2e:website:prod
```

If you need to test another deployment URL, set:

```bash
# EXOMIND_WEBSITE_BASE_URL (官网基准地址)
$env:EXOMIND_WEBSITE_BASE_URL="https://exo-mind.ai"
bun run test:e2e:website:prod
```
