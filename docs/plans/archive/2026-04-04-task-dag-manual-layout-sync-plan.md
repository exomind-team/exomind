# Task DAG Manual Layout Sync Plan

> **Status:** Draft approved for implementation reference
> **Scope:** Task DAG layout interaction only

## Goal

为任务依赖图增加一个只在 `手动布局` 下出现的 `同步` 按钮，允许用户把“当前可见节点”的手动布局坐标，一次性重写为“这些节点在当前方向配置下的自动布局坐标”。

同时修正 `自动布局 -> 手动布局` 的切换合同，确保进入手动布局时就把位置真相完整冻结，后续切换方向不会出现“部分节点沿用自动布局、部分节点停留在手动位置”的混合态。

## Summary

本计划固定以下结论：

- `同步` 按钮只在 `手动布局` 时出现。
- 点击 `同步` 后立即执行，无确认弹窗。
- `同步` 只重写坐标，不做任何其他事情。
- `同步` 只作用于当前可见卡片，不作用于当前不可见节点。
- `手动布局` 下切换方向，只改变连边/句柄/箭头方向，不改变节点位置。
- 进入 `手动布局` 时，必须一次性冻结当前可见节点的当前屏幕坐标。
- 进入 `手动布局` 时，还必须锁定一份“手动布局基线坐标表”。
- 这份“手动布局基线坐标表”在离开手动布局前保持固定不变。

## Core Contract

### 1. Auto Layout

- `自动布局` 下，节点位置始终由当前方向配置下的自动布局结果决定。
- 切换 `LR / TB / auto` 时，节点位置允许随自动布局重算。

### 2. Enter Manual Layout

当用户点击 `手动布局` 时，系统必须立即做两件事：

1. 把当前可见节点的当前屏幕坐标写入手动布局快照。
2. 生成一份“手动布局基线坐标表”。

其中：

- 当前可见节点 = 当前搜索 / 过滤 / 聚焦 / 折叠 / 区间收缩投影后屏幕上实际展示的节点。
- 当前屏幕坐标 = 用户点击 `手动布局` 那一刻这些节点所在的位置。
- 手动布局基线坐标表 = 这些节点在“进入手动布局那一刻、按当时方向配置计算得到的自动布局坐标”。

### 3. Manual Layout

在 `手动布局` 下：

- 节点位置真相优先来自 `manualPositions`。
- 若某节点没有手动坐标，但存在于 `manualBaselinePositions`，则使用基线坐标。
- 若两者都没有，才允许回退到当前自动布局坐标。

读取顺序固定为：

`manualPositions[nodeId] ?? manualBaselinePositions[nodeId] ?? autoLayoutPositions[nodeId]`

### 4. Direction Changes In Manual Layout

在 `手动布局` 下切换方向：

- 不改变节点位置
- 只改变：
  - 连边方向
  - Handle 朝向
  - 箭头/路由显示结果

也就是说，方向设置在手动布局中只影响“连边表现”，不影响“节点位置真相”。

### 5. Reappearing Nodes In Manual Layout

若某节点在进入手动布局时不可见，后续因为过滤器/聚焦/折叠变化重新出现：

- 若已有 `manualPositions[nodeId]`，使用该坐标。
- 否则若存在 `manualBaselinePositions[nodeId]`，使用该基线坐标。
- 不允许因为当前方向变化，直接把它跳到新的自动布局位置上。

这样可以避免用户在手动布局期间看到“新出现节点悄悄吃进了新的自动布局结果”。

### 6. Sync Button

`同步` 按钮的固定语义：

- 仅在 `layoutMode === 'manual'` 时显示。
- 点击后立即执行，无确认。
- 它是一个一次性动作，不改变模式本身。
- 它只重写“当前可见节点”的 `manualPositions`。
- 重写目标是：这些节点在“当前方向配置下重新计算出的自动布局坐标”。
- 不可见节点的 `manualPositions` 保持不变。
- `manualBaselinePositions` 不因点击 `同步` 而被重置。

换言之，`同步` 只是一次“把当前可见手动坐标覆盖为当前自动布局坐标”的操作。

## State Model

## Existing

- `layoutMode: 'auto' | 'manual'`
- `manualPositions`（现有手动布局快照）

## New

- `manualBaselinePositions`
  - 含义：进入手动布局时锁定的自动布局基线坐标表
  - 生命周期：进入手动布局时生成；离开手动布局前保持不变
  - 存储建议：与手动布局快照一起走本地 UI 持久化

## Recommended Structure

```ts
type TaskDagManualLayoutSnapshot = {
  manualPositions: Record<string, { x: number; y: number }>;
  manualBaselinePositions: Record<string, { x: number; y: number }>;
  updatedAt: string;
};
```

## UI Contract

入口位置：

- 放在 DAG 布局工具区
- 与 `自动布局 / 手动布局` 同一组邻近显示

可见性：

- `自动布局` 下不显示 `同步`
- `手动布局` 下显示 `同步`

执行反馈：

- 当前不新增确认弹窗
- 当前不聚焦动画层
- 如需反馈，可使用轻量 toast 或按钮短暂状态，但不是本轮重点

## Pure Actions

建议实现为三个纯动作：

### 1. `captureVisiblePositionsIntoManualSnapshot()`

- 触发时机：点击 `手动布局`
- 输入：当前渲染节点位置、当前可见节点集合、原手动快照
- 输出：新的 `manualPositions`
- 行为：把当前可见节点的当前屏幕坐标写入手动快照

### 2. `captureManualBaselinePositions()`

- 触发时机：点击 `手动布局`
- 输入：当前可见图、当前方向配置
- 输出：新的 `manualBaselinePositions`
- 行为：锁定“进入手动布局时”的自动布局基线坐标表

### 3. `syncManualLayoutToAutoPositions()`

- 触发时机：点击 `同步`
- 输入：当前可见图、当前方向配置、当前手动快照
- 输出：新的 `manualPositions`
- 行为：仅把当前可见节点的手动坐标覆盖为当前方向配置下的自动布局结果

## Non-Goals

本轮明确不做：

- 不改自动布局算法本身
- 不改节点 truth data
- 不新增复杂动画
- 不在 `自动布局` 模式下显示 `同步`
- 不在点击 `同步` 时改动不可见节点坐标
- 不让 `手动布局` 下的方向切换影响节点位置

## Tests

必须覆盖：

1. 切入手动布局时，当前可见节点坐标被整体冻结。
2. 切入手动布局时，会同时生成并锁定 `manualBaselinePositions`。
3. 手动布局下切换方向，节点位置不变，只改变连边方向。
4. 手动布局下重新出现、但没有手动坐标的节点，会落到进入手动布局时锁定的基线坐标。
5. 点击 `同步` 后，仅当前可见节点重排到当前方向下的自动布局坐标。
6. 点击 `同步` 不改不可见节点的手动坐标。
7. 从手动切回自动后，仍使用自动布局自己的位置系统，而不是复用同步后的手动坐标。

## Acceptance

- 用户进入手动布局后，节点位置立即成为稳定的手动真相。
- 手动布局下切换方向，不再出现“部分节点自动改位、部分节点停留原地”的混合态。
- 用户点击 `同步` 后，可以一键把当前可见节点重排回“当前方向配置下的自动布局位置”。
- 搜索/过滤/聚焦恢复后重新出现的节点，位置行为保持稳定且可预期。
