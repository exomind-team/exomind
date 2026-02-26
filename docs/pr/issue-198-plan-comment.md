# GH#198 方案与验收链路（桌面设置页先行）

## 范围（Scope，范围）
- 仅实现 `new UI` 的双响应式壳层（responsive shell，响应式外壳）。
- 仅在 `Desktop (>=md)` + `/settings` 时启用桌面布局（desktop layout，桌面布局）。
- 其他页面暂不做桌面内容重构，继续使用现有移动壳层展示。

## 设计对齐（Pencil Alignment，设计稿对齐）
- 采用 Pencil 的 `Desktop - Settings 设置` 方案：
  - 左侧 `Sidebar（侧边栏）`
  - 中间 `Settings Nav（设置导航分段）`
  - 右侧 `Detail Cards（详情大卡片）`
- 移动端保持当前底部 `Tab Bar（标签栏）`。

## TDD 链路（Test-Driven Development，测试先行）
1. 先写并运行失败单测：桌面路由开关与设置页桌面壳层。
2. 实现最小代码让单测转绿。
3. 再写并运行失败 E2E：桌面与移动双视口行为。
4. 实现并转绿，最后跑构建。

## 验收标准（Acceptance Criteria，验收标准）
- Desktop `/settings`：
  - 显示桌面 Sidebar
  - 显示设置页桌面分段导航
  - 主内容为设置大卡片
- Mobile `/settings`：
  - 保留底部 Tab 导航
- 自动化通过：
  - `vitest` 目标测试通过
  - `playwright issue198` 通过
  - `bun run build` 通过

## 风险与边界（Risk & Boundaries，风险与边界）
- 本次不重构其他页面的桌面内容，仅做壳层切换与设置页示例。
- 若后续要扩展 Dashboard/EventLog/Focus 的桌面内容，可沿用同一桌面壳层逐页推进。
