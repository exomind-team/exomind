# GH#252 方案更新（R3）：设置页桌面适配按最新 Pencil 稿

## 设计基准（Design Source，设计源）
- 以 `D:\project\exomind\pencil\eventlog-ui-design.pen` 为唯一基准（single source of truth，唯一真源）。
- 通过 `Pencil MCP` 读取并对齐：
  - `Desktop - Settings 设置`
  - `Settings V-C 分段大卡片式`

## 范围（Scope，范围）
- 仅实现 `Desktop` 端 `/settings` 的桌面壳层（desktop shell，桌面外壳）与布局对齐。
- 非 `/settings` 路由在桌面宽度下继续使用当前移动壳层（mobile shell，移动外壳）。
- 保留 `desktop adaptive toggle（桌面适配开关）` 行为。

## 导航决策（Navigation Decision，导航决策）
- 桌面侧栏导航改为 5 项：
  1. `总览` → `/dashboard`
  2. `当下` → `/eventlog`
  3. `任务` → `/tasks`
  4. `Agent` → `/agents`
  5. `设置` → `/settings`

## TDD 执行链路（Test-Driven Development，测试先行）
1. **RED**：先补失败单测  
   - 断言侧栏 5 项与顺序  
   - 断言存在 `/dashboard` 路由  
   - 断言仍仅 `/settings` 使用桌面壳层
2. **GREEN**：最小实现通过单测  
   - 更新 `src/routes-new.tsx`
3. **E2E**：补充桌面/移动行为验证  
   - 桌面 `/settings` 展示侧栏与设置导航  
   - 点击非设置项后回到移动壳层（当前阶段边界）
4. **Verification**：运行并记录证据  
   - `vitest` / `playwright(issue198)` / `bun run build`

## 验收标准（Acceptance Criteria，验收标准）
- `/settings` 在桌面宽度下符合 Pencil 的三栏结构：
  - Sidebar（侧栏）/ Settings Nav（中栏）/ Detail Area（右栏）
- 侧栏为上述 5 项映射，`设置` 高亮。
- 自动化测试通过并写入 PR 评论（progress + review）。
