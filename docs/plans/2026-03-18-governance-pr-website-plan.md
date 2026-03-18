# Governance PR Website Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在治理 PR `#565` 中补齐官网对外宣传内容，使首页、下载页、文档页、更新日志和公开入口达到可对外发布状态。

**Architecture:** 以 `docs/governance/README-draft.md` 为文案基线，先用测试锁定下载页与站点公开行为，再更新 Astro 页面与 i18n 文案，最后运行本地构建和网站 E2E 验证。

**Tech Stack:** Astro, TypeScript, Vitest, Playwright, Bun

---

### Task 1: 建立失败测试基线

**Files:**
- Modify: `tests/unit/website-download-api.test.ts`
- Modify: `tests/e2e/website.smoke.test.ts`

**Step 1: Write the failing test**

- 单测新增“runtime tarball 不应被官网视为正式桌面下载”的语义覆盖。
- E2E 新增以下断言：
  - 首页出现新文案关键词
  - 文档页不再出现 `coming soon`
  - 更新日志页出现 `v0.3.6`
  - 下载页显示 `Windows`、`Android` 可下载，`macOS`、`Linux` 为即将推出

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/website-download-api.test.ts`

Run: `bun run test:e2e:website`

Expected: 至少一个断言失败，证明当前官网仍未满足新要求。

### Task 2: 收敛官网文案与公开入口

**Files:**
- Modify: `website/src/i18n/index.ts`
- Modify: `website/src/pages/index.astro`
- Modify: `website/src/pages/en/index.astro`
- Modify: `website/src/pages/about.astro`
- Modify: `website/src/pages/en/about.astro`
- Modify: `website/src/components/Footer.astro`

**Step 1: Write minimal implementation**

- 将首页 hero、价值主张、CTA 改为治理草稿口径。
- 删除或替换私有 GitHub 主入口。
- Footer 社区入口改为公开站内入口。

**Step 2: Run targeted tests**

Run: `bun run test:e2e:website`

Expected: 首页与公开入口相关断言通过，其他新断言可能仍失败。

### Task 3: 补齐下载页、文档页、更新日志页

**Files:**
- Modify: `website/src/pages/download.astro`
- Modify: `website/src/pages/en/download.astro`
- Modify: `website/src/pages/docs.astro`
- Modify: `website/src/pages/en/docs.astro`
- Modify: `website/src/pages/changelog.astro`
- Modify: `website/src/pages/en/changelog.astro`

**Step 1: Write minimal implementation**

- 下载页只把真实可下载平台展示为下载态。
- 文档页改为非空公开资料页。
- 更新日志页更新到 `v0.3.6` 并补最近里程碑。

**Step 2: Run tests**

Run: `bun run test:e2e:website`

Expected: 站点行为断言全部通过。

### Task 4: 收尾与文档同步

**Files:**
- Modify: `README.md`

**Step 1: Write minimal implementation**

- 将根 README 至少更新为不明显落后官网定位与当前版本。

**Step 2: Run tests**

Run: `bun run website:build`

Expected: build 成功。

### Task 5: 完整验证与提交

**Files:**
- Review only: `git diff`

**Step 1: Run verification**

Run: `npx vitest run tests/unit/website-download-api.test.ts`

Run: `bun run test:e2e:website`

Run: `bun run website:build`

Expected: 全部通过。

**Step 2: Commit**

```bash
git add docs/plans/2026-03-18-governance-pr-website-design.md docs/plans/2026-03-18-governance-pr-website-plan.md README.md website/src tests
git commit -m "docs: refresh public website content for governance PR"
git push origin ex/govn-governance-docs
```
