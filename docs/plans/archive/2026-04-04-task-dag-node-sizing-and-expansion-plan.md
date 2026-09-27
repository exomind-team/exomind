# Task DAG Node Sizing And Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把任务依赖图节点尺寸语义收敛为“中心点真相 + 自动布局边界 + 视觉临时展开”三层模型，并为后续实现提供单一参考源。

**Architecture:** 节点的几何真相固定为中心点，自动布局始终以 `160×160` 边界参与编排，手动布局允许更自由的内容尺寸，但仍可通过 `固定宽度` / `固定高度` 恢复到边界约束。悬浮与选中展开属于纯视觉层，不触发布局重排，不改变连边锚点与节点中心。

**Tech Stack:** React, TypeScript, React Flow (`@xyflow/react`), local runtime-backed preferences, Vitest

---

## Summary

本计划用于承接 2026-04-04 新确认的节点尺寸与展开交互，不直接修改任务 truth data，也不改变 DAG 自动布局算法的中心点与编排基线。

当前固定原则：

- 节点始终以中心点为真相。
- 自动布局始终以 `160×160` 为编排边界。
- `固定宽度` / `固定高度` 是两个独立的显示约束开关，而不是单一尺寸模式。
- 手动布局允许内容尺寸更自由，但这两个开关在手动布局中仍保留，并且语义不变。
- 悬浮展开 / 选中展开是临时视觉层，不参与布局，不改变边界与中心点。
- 基础态内容超出时采用截断，不滚动；完整内容只在悬浮或选中展开时显示。
- 文本优先级高于弱语义标签；标签空间不足时先压缩或隐藏低优先级标签。
- 原 `已锚定` 标签替换为紫色 `聚焦锚点` 标签，左侧使用与“聚焦已执行”一致的图标。

## Three-Layer Model

### 1. Geometry Truth Layer

- 节点唯一几何真相是中心点。
- 尺寸变化、展开收起、自动/手动布局切换都不得改变中心点位置。
- 从自动布局切到手动布局、或反向切回时，节点中心必须保持连续，不能出现“左上角锚定式”跳动。

### 2. Layout Constraint Layer

自动布局：

- 布局算法继续使用 `160×160` 占位边界。
- 布局算法只认中心点与边界，不认悬浮展开后的临时视觉大小。
- 连边路由与节点间距保持对这套边界的稳定假设。

手动布局：

- 不再要求节点视觉尺寸统一到固定方块。
- 允许节点按内容自然生长。
- 但 `固定宽度` / `固定高度` 仍然生效，因此用户可在手动布局中逐维恢复到 `160` 边界约束。

### 3. Visual Presentation Layer

基础态：

- 由 `固定宽度` / `固定高度` 两个开关控制。
- 自动布局与手动布局都共享这套开关语义。

临时交互态：

- `悬浮展开`
- `选中展开`

这些展开必须：

- 以中心点为中心向外展开
- 带动画
- 不改变布局结果
- 不触发 Dagre / flow 重排
- 不改变节点逻辑尺寸真相

## Size Policy

### Auto Layout

自动布局下，节点编排边界固定为 `160×160`，但基础视觉可由两个维度独立控制：

- `固定宽度 = 开`：基础态宽度遵循 `160`
- `固定宽度 = 关`：基础态宽度可小于 `160`
- `固定高度 = 开`：基础态高度遵循 `160`
- `固定高度 = 关`：基础态高度可小于 `160`

因此会有四种组合：

1. 都不固定
2. 仅固定宽度
3. 仅固定高度
4. 宽高都固定（恢复为统一 `160×160`）

无论视觉组合如何，自动布局计算仍基于 `160×160` 编排边界与中心点。

### Manual Layout

手动布局下：

- 节点默认允许按内容自然尺寸显示
- `固定宽度` / `固定高度` 仍然保留
- 开启某个维度后，该维度会被拉回 `160` 约束
- 两个都开时，手动布局下的视觉也可恢复到统一 `160×160`

切换 `auto <-> manual` 时：

- 节点中心必须不变
- 只允许围绕中心点改变基础视觉尺寸

## Overflow Policy

基础态内容超出时：

- 采用截断
- 不使用内部滚动
- 完整内容只在悬浮展开 / 选中展开时展示

优先级规则：

- 优先保住任务名称
- 再考虑关键状态与强语义标签
- 弱语义标签优先被压缩或隐藏

## Badge Priority

空间不足时，标签压缩优先级固定为：

### First To Hide

- `聚焦锚点`
- `已折叠上游`
- `已折叠下游`
- `+N 已折叠`

### Middle Priority

- 普通状态标签，如 `已完成`

### Last To Hide

- `专注中`
- 区间收缩起点标签
- 区间成员数标签

## Focus Anchor Badge

将当前紫色锚点标签统一替换为：

- 图标：与“聚焦已执行”一致
- 文案：`聚焦锚点`
- 配色：沿用当前紫色系

该标签属于弱语义标签，应在空间紧张时优先于任务名称被压缩或隐藏。

## Sample Tasks

当前 RT `9124` 中，已补充用于本计划手测的样例任务：

- `sample-q-long-title-boundary`
  - 超长标题样例
  - 依赖：`sample-q-diamond-d`
  - 用途：验证名称优先展示、基础态截断、悬浮/选中展开

现有复杂 DAG 样例继续作为联动验证基础：

- `sample-q-diamond-a/b/c/d`
- `sample-q-double-a` 到 `sample-q-double-g`
- `sample-q-bridge-a/b/c`

## File Map

### Preferences And State

- Modify: `src/config/task-dag-preferences.ts`
  - 新增 `固定宽度` / `固定高度` 的本地偏好存储
  - 约束：保持与现有 DAG 偏好同层级、同持久化模式

- Test: `tests/unit/config/task-dag-preferences.test.ts`
  - 覆盖默认值、读写、旧值兼容

### Control Surface

- Modify: `src/ui/app/components/TaskDagControlPanel.tsx`
  - 在“布局工具”区新增 `固定宽度` / `固定高度` 两个独立按钮
  - 保持桌面/移动端入口结构一致

### Node Rendering

- Modify: `src/ui/app/pages/TaskDagPage.tsx`
  - 在节点基础态里接入 `固定宽度` / `固定高度`
  - 悬浮展开 / 选中展开只在视觉层工作
  - 节点中心不变
  - 替换 `已锚定` 为 `聚焦锚点`
  - 实现名称优先、标签按优先级压缩

### Layout Contract

- Modify: `src/ui/app/pages/task-dag-flow.ts`
  - 若需要，仅补充注释/合同，明确 `160×160` 是编排边界
  - 不把 hover/selected 展开尺寸引入 flow 真相层

- Test: `tests/unit/ui/task-dag-flow.issue564.test.ts`
  - 锁定 `160×160` 仍是 layout slot，而不是 hover 后视觉大小

### UI Tests

- Modify: `tests/unit/ui/task-dag-page.issue394.test.tsx`
  - 覆盖固定宽度/固定高度四种基础态组合
  - 覆盖手动布局下中心点不变
  - 覆盖悬浮/选中展开不触发布局重排
  - 覆盖超长标题优先展示名称、低优先级标签先隐藏
  - 覆盖 `聚焦锚点` 标签文案与图标替换

### Docs

- Modify: `docs/testing/2026-04-04-task-dag-search-focus-samples.md`
  - 补充 `sample-q-long-title-boundary` 的验证动作

## Task 1: Preferences Contract

**Files:**

- Modify: `src/config/task-dag-preferences.ts`
- Test: `tests/unit/config/task-dag-preferences.test.ts`

- [ ] 新增 DAG 节点尺寸约束偏好：`fixedWidth` / `fixedHeight`
- [ ] 先写偏好读写测试，覆盖默认值与持久化
- [ ] 跑单测，确认在未实现前失败
- [ ] 实现最小偏好读写
- [ ] 重跑单测，确认通过

## Task 2: Control Panel Wiring

**Files:**

- Modify: `src/ui/app/components/TaskDagControlPanel.tsx`
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] 为“布局工具”增加 `固定宽度` / `固定高度` 两个独立按钮
- [ ] 明确按钮在自动布局与手动布局中都可见
- [ ] 先写 UI 测试锁定按钮可见性、切换行为与持久化
- [ ] 实现最小 wiring
- [ ] 重跑相关 UI 测试

## Task 3: Base Size Policy

**Files:**

- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] 先写失败测试，锁定四种基础态组合
- [ ] 实现基础态尺寸逻辑
- [ ] 验证自动布局下视觉变化不改变 `160×160` 编排边界
- [ ] 验证手动布局下也能通过两个开关恢复到 `160` 约束

## Task 4: Temporary Expansion Layer

**Files:**

- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] 先写失败测试，覆盖悬浮展开 / 选中展开
- [ ] 锁定“展开不改中心点、不触发布局重排”
- [ ] 实现动画与样式层展开
- [ ] 重跑测试确认只影响视觉层

## Task 5: Overflow And Badge Priority

**Files:**

- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] 先写超长标题失败测试
- [ ] 锁定“名称优先展示，低优先级标签先隐藏”
- [ ] 实现标签优先级裁剪
- [ ] 将 `已锚定` 全量替换为 `聚焦锚点`
- [ ] 替换对应图标与测试断言

## Task 6: Regression And Manual Verification

**Files:**

- Modify: `docs/testing/2026-04-04-task-dag-search-focus-samples.md`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
- Test: `tests/unit/ui/task-dag-flow.issue564.test.ts`
- Test: `tests/unit/config/task-dag-preferences.test.ts`

- [ ] 更新手测文档，加入 `sample-q-long-title-boundary`
- [ ] 跑相关 Vitest
- [ ] 跑 `npx tsc --noEmit`
- [ ] 确认 `9124` 与 `5173` 可用

## Verification Commands

```bash
npx vitest run tests/unit/config/task-dag-preferences.test.ts
npx vitest run tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/task-dag-page.issue394.test.tsx --pool forks --maxWorkers 1 --no-file-parallelism
npx tsc --noEmit
curl -sS -D - -o /dev/null http://127.0.0.1:9124/health | head -n 8
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```

## Manual Verification Focus

1. 搜索 `sample-q-long-title-boundary`
   - 预期：基础态优先保住任务名称，弱语义标签先退场

2. 在自动布局下切换 `固定宽度` / `固定高度`
   - 预期：基础态尺寸变化符合四种组合，但节点中心不变

3. 切到手动布局再切换同样按钮
   - 预期：尺寸可逐维恢复到 `160` 约束，中心不漂移

4. 悬浮或选中超长标题节点
   - 预期：卡片展开、内容变完整、带动画，但不触发布局重排

5. 观察聚焦锚点节点
   - 预期：出现紫色 `聚焦锚点` 标签，而不是旧的 `已锚定`
