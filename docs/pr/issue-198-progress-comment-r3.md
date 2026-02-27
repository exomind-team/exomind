# GH#252 进展追加（R3：5项导航 + /dashboard + 设置页桌面适配）

本轮按最新 Pencil 稿（`D:\project\exomind\pencil\eventlog-ui-design.pen`）完成以下更新：

## 已完成

1. **桌面 Sidebar（侧边栏）导航改为 5 项**
   - 文件：`src/routes-new.tsx`
   - 导航项：
     - `总览` → `/dashboard`
     - `当下` → `/eventlog`
     - `任务` → `/tasks`
     - `Agent` → `/agents`
     - `设置` → `/settings`
   - 新增测试标识（test ids，测试标识）：
     - `desktop-sidebar-item-dashboard`
     - `desktop-sidebar-item-now`
     - `desktop-sidebar-item-tasks`
     - `desktop-sidebar-item-agents`
     - `desktop-sidebar-item-settings`

2. **新增 `/dashboard` 路由（当前为占位映射）**
   - 文件：`src/routes-new.tsx`
   - 目的：先满足导航与路由闭环，后续再逐页桌面化内容。

3. **保持范围边界不变**
   - 仅 `/settings` 在桌面宽度启用桌面壳层（desktop shell，桌面壳层）。
   - 点击侧栏到非 `/settings` 路由时，按当前阶段设计回到移动壳层（mobile shell，移动壳层）。

## 自动化验证（fresh run）

```bash
bunx vitest run tests/unit/components/settings/DeveloperSection.test.tsx tests/unit/components/settings/DesktopAdaptiveToggle.test.tsx tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
# 结果：3 files / 14 tests passed

bun run test:e2e:issue198
# 结果：4 passed（含“点击总览后回到移动壳层”新增场景）

bun run build
# 结果：build succeeded（仅历史 warning）
```
