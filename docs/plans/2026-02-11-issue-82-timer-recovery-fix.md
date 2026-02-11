# Issue #82 Timer Resume Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复时间块在切换页面或刷新后停止计时的问题（采用方案 A），并在非默认端口下完成自动化回归验证。

**Architecture:** 采用“状态驱动计时循环”方案：由 `timerState === 'running'` 触发统一的计时器生命周期管理，不再依赖仅在按钮事件中启动计时。通过新增组件级回归测试与 Playwright 非默认端口测试，确保在路由重挂和刷新场景下行为稳定。

**Tech Stack:** React 18 + TypeScript + Vitest (happy-dom) + Playwright + Vite 环境变量端口配置

---

### Task 1: 建立失败用例（TDD-RED）

**Files:**
- Create: `tests/unit/components/TimeBlockWidget.resume.test.tsx`
- Modify: `tests/setup.ts`（仅在需要补充 RAF mock 时）
- Reference: `src/components/TimeBlockWidget.tsx`

**Step 1: 写失败测试（恢复运行态后应继续计时）**

- Mock `getTimeBlockService().loadActiveBlock()` 返回：`{ paused: false, mode: 'countup', elapsed: 1000, ... }`
- 渲染 `TimeBlockWidget`
- 断言：组件完成初始化后会触发计时循环（例如 `requestAnimationFrame` 被调用）

**Step 2: 运行单测确认失败**

Run: `bun run test tests/unit/components/TimeBlockWidget.resume.test.tsx`
Expected: FAIL（当前实现恢复态未启动计时循环）

**Step 3: 提交前检查失败原因**

- 失败必须指向“恢复态未启动计时”，不是测试环境错误。

**Step 4: Commit（仅测试文件）**

```bash
git add tests/unit/components/TimeBlockWidget.resume.test.tsx tests/setup.ts
git commit -m "test: add failing regression for timeblock resume after remount"
```

### Task 2: 实现方案 A（TDD-GREEN）

**Files:**
- Modify: `src/components/TimeBlockWidget.tsx`
- Test: `tests/unit/components/TimeBlockWidget.resume.test.tsx`

**Step 1: 最小实现方案 A**

- 在 `TimeBlockWidget` 中新增 effect：当 `timerState === 'running'` 时启动计时循环。
- 在 effect cleanup 中停止循环，避免重复 `requestAnimationFrame`。
- 保留 `handlePause` / `handleEndBlock` 的停止逻辑，确保暂停态不会自动走时。

**Step 2: 运行目标测试验证通过**

Run: `bun run test tests/unit/components/TimeBlockWidget.resume.test.tsx`
Expected: PASS

**Step 3: 运行相关回归测试**

Run: `bun run test tests/unit/services/timeblock.service.test.ts`
Expected: PASS

**Step 4: Commit（实现 + 回归测试）**

```bash
git add src/components/TimeBlockWidget.tsx tests/unit/components/TimeBlockWidget.resume.test.tsx
git commit -m "fix: resume timer loop after timeblock widget remount"
```

### Task 3: 非默认端口 E2E 回归（Issue #82 场景）

**Files:**
- Create: `tests/e2e/timeblock-resume.issue82.test.ts`
- Create: `tests/e2e/playwright.issue82.config.ts`
- Modify: `package.json`（新增 issue82 e2e 脚本）

**Step 1: 新增 E2E 用例（最小验收链路）**

- 场景 A：`/eventlog` 开始计时 -> 跳转到 `/settings` -> 返回 `/eventlog` -> 计时值继续变化。
- 场景 B：开始计时 -> `page.reload()` -> 计时值继续变化。
- 场景 C：暂停后切页/刷新 -> 计时值不变化。

**Step 2: 配置非默认端口运行**

- 在 issue82 config 中固定非默认端口：例如 `WEB=1520 / HMR=1521 / POUCHDB=7084 / ASR=2049`
- `webServer.command` 使用环境变量显式启动（确保不同 worktree 互不冲突）

**Step 3: 运行 E2E**

Run: `bun run test:e2e:issue82`
Expected: PASS（在非默认端口）

**Step 4: Commit（E2E 与脚本）**

```bash
git add tests/e2e/timeblock-resume.issue82.test.ts tests/e2e/playwright.issue82.config.ts package.json
git commit -m "test: add issue82 e2e on non-default ports"
```

### Task 4: 文档与 PR 更新

**Files:**
- Modify: `AGENTS.md`
- Modify: PR #86 评论（checklist 勾选更新）

**Step 1: 校验 AGENTS 端口配置章节**

- 确保与 `docs/development/port-env-configuration.md` 一致。
- 明确环境变量优先级与 worktree 端口隔离要求。

**Step 2: 更新 PR #86 评论 checklist**

- 将已完成项逐条勾选并补充测试命令/结果。

**Step 3: 最终验证（全量最小集）**

Run:
- `bun run test tests/unit/components/TimeBlockWidget.resume.test.tsx`
- `bun run test tests/unit/services/timeblock.service.test.ts`
- `bun run test:e2e:issue82`
- `bun run build`

Expected: 全部通过

**Step 4: Push 并准备合并**

```bash
git push --force-with-lease
gh pr view 86 --repo exomind-team/exomind
```
