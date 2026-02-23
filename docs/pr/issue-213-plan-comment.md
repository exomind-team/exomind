# GH#213 实施计划（待审批）

## 目标
- 按 `pencil/eventlog-ui-design.pen`（Task 相关画布）像素还原任务 UI。
- 实现 `Task` mock 架构：`src/lib/adapters/mock/task-mock-adapter.ts` + `fixtures/tasks.ts`。
- 复用并补齐 `mock-data` 开关，`bootstrap.ts` 根据 flag 注入 mock/real adapter。
- 完整走 TDD（先失败测试）+ Playwright 自动验证 + PR 评审闭环。

## 设计稿锚点（Pencil）
- `38: Task - 当下(Now)`：任务主页面结构、Tab、输入行、任务卡片基础。
- `40/42/44: Week/Month/Goals`：任务列表层级与状态表达。
- `46: Task - 今日(Today) 时间块视图`：今日时间块分组和信息层级。
- `10/12/14: Focus Start/Running`：计时模式（倒计时/正计时）、暂停按钮、卡片光晕与半透明材质。

## 实施分解（每步一个 commit）
1. 建立领域契约：`ITaskPort` + `Task` types + `mock-data` 配置与单测。  
2. 实现 `TaskWebAdapter` / `TaskMockAdapter` / fixtures，并在 `bootstrap.ts` 注入与测试。  
3. 新增 `task.service.ts`，统一页面读取、计时模式切换、暂停动作。  
4. 完成 `/tasks` 页面（列表 + tab + 输入框），并实现像素对齐测试。  
5. 完成 `/tasks/:id` 页面（渐变光晕卡片、半透明白、圆角 24、模式切换、暂停按钮）。  
6. 更新 `routes-new.tsx`：新增任务路由（懒加载）+ 底部 Tab「任务」入口。  
7. 在设置页开发者区补上「使用测试数据」toggle（仅开发者模式显示）。  
8. 新增 Playwright（issue-213 独立端口配置）验证核心交互与视觉结构。  
9. 运行 `vitest + playwright + bun run build`，发布测试证据与评审评论。

## 验收链路
- 单测：`mock-data`、bootstrap 注入、task service、任务页结构/交互、路由与设置 toggle。
- E2E：进入任务页 -> 切换模式 -> 暂停/继续 -> 输入框添加任务 -> 详情路由回跳。
- 构建：`bun run build` 通过。

## 风险与对策
- #204 开关未在当前分支落地：本次按同接口补齐，确保向后兼容。  
- 设计稿跨多个画布：按画布索引建立样式 token，避免主观发挥。  
- 任务页与当下页能力重叠：复用现有时间块服务，避免双状态源。

## 请求审批
- 你确认后我将按上述顺序开始 TDD 实施，并保证“每一阶段至少一个 commit + PR 持续评论同步”。  
- 回复：`批准执行`（或指出要调整的步骤）。
