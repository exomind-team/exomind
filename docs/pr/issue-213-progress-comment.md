# [GH#213] Task UI 实现进度更新（Pencil 对照 + 测试证据）

## 已完成范围
- 任务能力接入（Task Port/Adapter/Service）与 `mock-data` 开关联动：
  - `src/lib/adapters/mock/task-mock-adapter.ts`
  - `src/lib/adapters/mock/fixtures/tasks.ts`
  - `src/lib/adapters/task-web-adapter.ts`
  - `src/lib/services/task.service.ts`
  - `src/lib/environment/bootstrap.ts`（根据 flag 注入 mock/real adapter）
- 新 UI 页面与组件：
  - `src/ui/new/pages/NewTasksPage.tsx`
  - `src/ui/new/pages/NewTaskDetailPage.tsx`
  - `src/ui/new/components/NewTaskTimerCard.tsx`
- 路由与导航接线：
  - `src/routes-new.tsx` 新增任务导航项（`SquareCheckBig`）与 `/tasks`、`/tasks/$taskId`
- 设置页开发者能力：
  - `src/ui/new/pages/NewSettingsPage.tsx` 新增“使用测试数据”开关（`data-testid="new-settings-use-mock-data-switch"`）

## Pencil 设计稿复核（mcp__pencil__batch_get）
本轮再次确认需对齐页面（`D:\project\exomind\pencil\eventlog-ui-design.pen`）：
- `Task - 当下(Now)`
- `Task - 今日(Today) 时间块视图`
- `Task - 一周(Week)`
- `Task - 月(Month)`
- `Task - 长期(Goals)`
- `Focus Start Dialog - Dark Mode`
- `Focus Timer Screen - Dark Mode`

关键像素参数已对照实现：
- 任务主卡 `cornerRadius = 24px`
- 背景光晕（gradient + blur）
- 半透明卡片层（白色透明渐变）
- 计时模式切换（倒计时/正计时）
- 暂停按钮
- 输入框（事实记录 + 快速添加）

## TDD 与自动化测试证据
### 1) 单测（红转绿）
```bash
bun vitest tests/unit/ui/new-task-routing.issue213.test.ts tests/unit/settings/new-settings-mock-data-toggle.issue213.test.tsx
```
结果：`2 files, 5 tests passed`

### 2) 任务相关回归单测
```bash
bun vitest tests/unit/config/mock-data.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/services/task.service.test.ts tests/unit/ui/new-task-pages.issue213.test.tsx tests/unit/ui/new-task-routing.issue213.test.ts tests/unit/settings/new-settings-mock-data-toggle.issue213.test.tsx
```
结果：`6 files, 19 tests passed`

### 3) Playwright E2E（issue213 专项）
```bash
bun run test:e2e:issue213
```
结果：`2 passed`

### 4) 构建校验
```bash
bun run build
```
结果：成功（含既有 chunk 警告，无阻断错误）

## 本轮新增提交（按步骤提交）
- `ea4ccc7` feat(task-ui): add task routes/nav and mock-data toggle in settings
- `d403d63` test(task-ui): add issue-213 playwright e2e coverage
- `1ecea71` test(task-ui): mock router navigate in settings toggle unit test

