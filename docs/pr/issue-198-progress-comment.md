# GH#252 进展同步（Issue #198：桌面壳层 + 设置页桌面化）

## 已完成实现

- 响应式壳层（responsive shell，响应式外壳）：
  - `src/routes-new.tsx`
  - 新增 `MobileShell（移动壳层）` / `DesktopSidebar（桌面侧栏）` / `DesktopLayout（桌面布局）`
  - 新增 `isDesktopSettingsRoute（仅设置页桌面路由开关）`
  - 仅 `Desktop + /settings` 进入桌面布局，其他路由继续移动壳层（桌面宽度下为移动壳预览形态）

- 侧栏语义变量（sidebar tokens，侧栏变量）：
  - `src/index.css`
  - 新增 `--sidebar / --sidebar-foreground / --sidebar-border / --sidebar-accent` 等浅色与深色变量

- 自动化测试：
  - 单测：`tests/unit/ui/new-desktop-settings-shell.issue198.test.ts`
  - E2E：
    - `tests/e2e/playwright.issue198.config.ts`
    - `tests/e2e/settings-desktop.issue198.test.ts`
  - 脚本：`package.json` 新增 `test:e2e:issue198`

## 关键修复（评审中发现并修复）

- 修复 `icon` 类型过窄导致 `tsc` 失败（`LucideIcon` 类型对齐）
- 修复双壳层 `Outlet` 双挂载风险：
  - 从纯 CSS 显隐切换改为 JS 断点判断（`useIsDesktop`），保证任一时刻只渲染一个壳层

## 验证证据（最新实跑）

```bash
bunx vitest run tests/unit/ui/new-desktop-settings-shell.issue198.test.ts tests/unit/ui/new-layout-bottom-nav-spacing.issue175.test.ts tests/unit/ui/new-bottom-nav-fit.issue215.test.ts tests/unit/ui/new-dark-mode-palette.issue179.test.ts tests/unit/ui/new-me-routing.issue215.test.ts tests/unit/ui/new-task-routing.issue213.test.ts
# 结果：6 files / 13 tests 全通过

bun run test:e2e:issue198
# 结果：2 passed（chromium）

bun run build
# 结果：build 成功（存在历史 chunk warning，无新增构建错误）
```
