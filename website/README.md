# ExoMind Website

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
bun run test:e2e:website
```

