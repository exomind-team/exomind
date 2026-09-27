# Single Tag GitHub Pages Release Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把发布契约统一为单一 `v0.x.y` tag，并把官网下载与应用更新从 Cloudflare/R2 切到 GitHub Pages 静态元数据 + GitHub Release assets。

**Architecture:** 发布时只认一个 Git tag `v0.x.y`，GitHub Release 先以 `prerelease=true` 创建，后续 promotion（晋升）只修改同一 release 的 prerelease 状态。GitHub Pages 承接 `preview/release` 两套静态 JSON 元数据，官网与应用更新都直接消费这些 JSON，安装包本体全部走 GitHub Release assets。

**Tech Stack:** GitHub Actions, GitHub Release API, GitHub Pages, Astro static build, Bun, Vitest, Tauri updater helper

---

### Task 1: 计划与契约落盘

**Files:**
- Create: `docs/plans/2026-04-08-single-tag-github-pages-release-flow-implementation-plan.md`
- Modify: `AGENTS.md`

- [x] **Step 1: 固化单 tag / 单版本 / promotion 契约**

目标口径：

```text
唯一 tag: v0.x.y
唯一版本号: 0.x.y
preview/release: GitHub Release prerelease 状态 + GitHub Pages 元数据视图
release promotion: 同一 tag + 同一 commit，不重新打 tag
下载产物: GitHub Release assets
官网 / 更新检查: GitHub Pages 静态 JSON
```

- [x] **Step 2: 更新仓库内发布说明**

Run:

```powershell
rg -n "build/v|release/v|Cloudflare|R2|GitHub Pages" AGENTS.md website/README.md .github/workflows/release.yml
```

Expected:

```text
找到旧契约位置，后续统一替换为 v* + Pages + Release assets
```

### Task 2: 先写失败测试，锁定新契约

**Files:**
- Modify: `tests/unit/services/update.service.test.ts`
- Modify: `tests/ci/release-workflow-bun-install.test.ts`
- Modify: `tests/unit/website-download-api.test.ts`
- Modify: `tests/unit/website-update-api-utils.test.ts`
- Create: `tests/unit/scripts/release-pages-metadata.test.ts`

- [x] **Step 1: 改更新服务测试到 Pages 静态 JSON**

关键断言：

```ts
expect(url).toContain('/releases/preview/latest.json');
expect(url).toContain('/releases/release/versions.json');
expect(result.downloadUrl).toBe('https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe');
expect(compareVersions('0.4.1', '0.4.0')).toBe(1);
```

- [x] **Step 2: 改官网/下载测试到静态 metadata**

关键断言：

```ts
expect(versions.channel).toBe('preview');
expect(versions.latest?.tag).toBe('v0.4.0');
expect(versions.latest?.assets['windows-x64-setup'].url).toContain('/releases/download/v0.4.0/');
```

- [x] **Step 3: 改 CI 测试到单 tag + Pages 部署**

关键断言：

```ts
expect(workflowContent).toContain("- 'v*'");
expect(workflowContent).toContain('softprops/action-gh-release');
expect(workflowContent).toContain('actions/deploy-pages@v4');
expect(workflowContent).not.toContain('wrangler r2 object put');
expect(workflowContent).not.toContain("refs/tags/release/");
expect(workflowContent).not.toContain("refs/tags/build/");
```

- [x] **Step 4: 为 Pages metadata 生成逻辑补纯函数测试**

关键断言：

```ts
expect(result.preview.latest?.tag).toBe('v0.4.1');
expect(result.release.latest?.tag).toBe('v0.4.0');
expect(result.preview.versions[0].assets['android-arm64'].sha256).toHaveLength(64);
```

- [x] **Step 5: 运行失败测试，确认是“合同不符”而不是测试写坏**

Run:

```powershell
bun x vitest run tests/unit/services/update.service.test.ts tests/unit/website-download-api.test.ts tests/unit/website-update-api-utils.test.ts tests/unit/scripts/release-pages-metadata.test.ts tests/ci/release-workflow-bun-install.test.ts
```

Expected:

```text
FAIL，且失败点集中在 /api/versions、Cloudflare/R2、build/* / release/*、旧 metadata 结构
```

### Task 3: 实现静态 Pages metadata 与官网/更新切换

**Files:**
- Create: `scripts/dev/release-pages-metadata.ts`
- Create: `website/public/releases/release/latest.json`
- Create: `website/public/releases/release/versions.json`
- Create: `website/public/releases/preview/latest.json`
- Create: `website/public/releases/preview/versions.json`
- Modify: `src/lib/services/update.service.ts`
- Modify: `website/src/pages/download.astro`
- Modify: `website/src/pages/en/download.astro`
- Modify: `package.json`
- Delete: `website/src/pages/api/versions.ts`
- Delete: `website/src/pages/api/update/check.ts`
- Delete: `website/src/pages/api/download/[channel]/[version]/[platform].ts`
- Delete: `website/src/lib/update-api-utils.ts`
- Delete: `website/src/env.d.ts`

- [x] **Step 1: 写 metadata 生成脚本**

脚本职责：

```ts
// 输入: GitHub releases + release-manifest asset
// 输出:
// website/public/releases/release/latest.json
// website/public/releases/release/versions.json
// website/public/releases/preview/latest.json
// website/public/releases/preview/versions.json
```

- [x] **Step 2: 更新应用更新服务**

目标 URL：

```ts
new URL(`/releases/${channel}/latest.json`, API_BASE)
new URL(`/releases/${channel}/versions.json`, API_BASE)
```

- [x] **Step 3: 更新官网下载页为直接消费静态 JSON**

目标行为：

```text
下载按钮直接跳 GitHub Release asset URL
历史版本按钮直接跳 GitHub Release 页面
不再依赖 /api/versions 或 /api/download
```

- [x] **Step 4: 运行针对性测试直到转绿**

Run:

```powershell
bun x vitest run tests/unit/scripts/release-pages-metadata.test.ts
bun x vitest run tests/unit/services/update.service.test.ts
bun x vitest run tests/unit/website-download-api.test.ts
bun x vitest run tests/unit/website-update-api-utils.test.ts
```

Expected:

```text
PASS
```

### Task 4: 改发布脚本与 GitHub Actions

**Files:**
- Modify: `scripts/dev/build-tag.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `website/astro.config.mjs`
- Modify: `website/package.json`
- Modify: `website/README.md`
- Delete: `wrangler.toml`
- Create: `website/public/CNAME`

- [x] **Step 1: 改本地 tag 生成脚本为单 tag**

目标行为：

```text
bun run build:tag
=> 读取 package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json
=> 校验三处版本一致
=> 创建 tag v0.x.y
=> 已存在则失败，不再生成 build 序号 / 时间戳 tag
```

- [x] **Step 2: 改 release workflow**

目标行为：

```text
push tag v*:
  构建多平台产物
  归一化命名
  计算 sha256
  上传 GitHub Release assets
  上传 exomind-release-manifest.json
  生成 GitHub Pages metadata
  部署 Pages

workflow_dispatch:
  输入 tag=v0.x.y
  把已有 release 从 prerelease=true 改成 false
  重新生成 metadata
  重新部署 Pages
```

- [x] **Step 3: 改 Astro 为纯静态 GitHub Pages 构建**

目标配置：

```ts
export default defineConfig({
  site: 'https://exo-mind.ai',
  output: 'static',
  integrations: [tailwindcss()],
});
```

- [x] **Step 4: 运行 CI 结构测试**

Run:

```powershell
bun x vitest run tests/ci/release-workflow-bun-install.test.ts
```

Expected:

```text
PASS
```

### Task 5: 完整验证与交付

**Files:**
- Verify only

- [x] **Step 1: 跑类型检查**

Run:

```powershell
bunx tsc --noEmit
```

- [x] **Step 2: 跑本任务相关单测**

Run:

```powershell
bun x vitest run tests/unit/services/update.service.test.ts tests/unit/website-download-api.test.ts tests/unit/website-update-api-utils.test.ts tests/unit/scripts/release-pages-metadata.test.ts tests/ci/release-workflow-bun-install.test.ts
```

- [x] **Step 3: 跑官网构建**

Run:

```powershell
bun run website:build
```

- [x] **Step 4: 跑官网 E2E 冒烟**

Run:

```powershell
bun run test:e2e:website
```

- [x] **Step 5: 汇报剩余人工验收项**

人工验收保留给用户：

```text
1. 部署后的下载页展示与链接是否符合预期
2. 新 tag v0.x.y 触发的 GitHub Release assets 是否齐全
3. promotion 后 preview/release 页面是否完成切换
```
