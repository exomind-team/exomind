# Agent Hub Topology Layout Design

**日期**: 2026-03-06

**目标**

为 Agent Hub 拓扑图建立第一阶段布局系统：默认使用 `manual layout（手动布局）`，允许用户直接拖拽节点并自动保存；同时提供 `auto:flow（自动流式布局）` 作为临时分析视图，但自动布局不能覆盖手动布局成果。

## 背景

当前 [AgentsPage.tsx](D:/project/exomind/src/ui/app/pages/AgentsPage.tsx) 中的 `TopologyView` 只消费 [agents-signal-topology.ts](D:/project/exomind/src/ui/app/pages/agents-signal-topology.ts) 生成的基础节点坐标。页面刷新、切换筛选组合、切换视图后都不会记住用户手工摆放的位置，也不会记住视口和缩放。

这会带来两个明显问题：

1. 拓扑图不是“工作区（workspace，工作空间）”，用户无法长期维护自己的布局。
2. 自动布局和手动布局没有隔离层，后续一旦引入自动布局，容易覆盖用户辛苦摆好的节点位置。

## 设计目标

1. 默认进入拓扑页时就是 `manual` 模式。
2. 用户拖拽节点后自动持久化保存节点位置。
3. 页面刷新后恢复节点位置、视口和缩放。
4. 不同筛选条件组合各自拥有独立布局工作区。
5. `auto:flow` 只作为临时分析视图，不写回手动布局。
6. 节点或边集合未变化时，状态变化不应导致布局丢失。

## Phase 1 边界

### 做

- 只支持 `global scope（全局视图）`
- 持久化 `manualPositions（手动位置）`
- 持久化 `viewport（视口）`
- 提供 `manual / auto:flow` 模式切换
- 提供 `Fit View（适配视口）`
- 提供 `Reset Current Layout（重置当前布局）`
- 提供 `Clear Saved Layouts（清空已保存布局）`

### 不做

- 不做 `host:<id>` / `subnet:<id>` 的真实视图接线
- 不持久化自动布局结果
- 不做“把自动布局应用为手动基线”
- 不做复杂的跨筛选布局继承

## 方案比较

### 方案 A：手动布局为唯一真源，自动布局完全临时

- 手动位置与手动视口是唯一持久化真源。
- 自动布局只在当前内存态生效。
- 切回手动时恢复已保存的手动工作区。

优点：

- 模型清晰，最不容易把用户布局覆盖掉。
- Phase 1 实现复杂度最低。
- 后续支持 `host/subnet` 作用域时结构可自然扩展。

缺点：

- 自动布局无法“半永久”保存结果。

### 方案 B：手动和自动都持久化

- 为每个模式分别持久化坐标和视口。

优点：

- 自动布局切换回来可完全复原。

缺点：

- 数据结构更复杂，产品语义变重。
- 容易被误解成自动布局也是长期真源。

### 方案 C：自动布局可以改写手动布局

优点：

- 操作最少。

缺点：

- 直接违背“自动布局不覆盖手动布局”的核心要求。
- 风险最高。

**结论**：采用方案 A。

## 数据模型

```ts
type TopologyLayoutMode = 'manual' | 'auto:flow';

type TopologyViewport = {
  x: number;
  y: number;
  zoom: number;
};

type TopologyNodePosition = {
  x: number;
  y: number;
};

type TopologyLayoutSnapshot = {
  manualPositions: Record<string, TopologyNodePosition>;
  viewport?: TopologyViewport;
  updatedAt: string;
};

type TopologyLayoutStore = Record<
  string,
  Record<string, Record<string, TopologyLayoutSnapshot>>
>;
```

键空间：

- `datasetKey`: 只基于节点集合与边集合生成稳定指纹
- `scopeKey`: Phase 1 固定为 `global`
- `filterKey`: 只包含影响节点/边可见性的筛选条件

## 关键规则

### datasetKey

- 仅当节点集合或边集合真的变化时才变化。
- 节点状态、在线状态、subtitle、颜色方案变化不产生新 `datasetKey`。

### filterKey

- 只纳入会改变可见节点或边集合的筛选条件。
- 不把纯 UI 样式项放进 `filterKey`。

### 初始化

- 当前组合没有已保存布局时，直接使用系统基础布局初始化。
- 已保存布局里缺失的新节点，回退到基础布局默认坐标。
- 已删除节点的旧位置记录在保存时清理。

### manual / auto:flow

- `manual` 模式渲染基础布局 + 已保存手动位置。
- `auto:flow` 模式渲染自动计算坐标，不写回 `manualPositions`。
- 从 `auto:flow` 切回 `manual` 时恢复该组合的已保存节点位置和视口。

## 交互草案

拓扑图右上角新增布局操作区，保持轻量，不再走之前那种重设置面板。

- 模式切换：`手动布局` / `自动布局`
- 操作按钮：`适配视口`
- 下拉菜单：
  - `重置当前布局`
  - `清空当前视图已保存布局`

文案明确区分两类心智：

- `manual layout（手动布局）`: “拖拽即保存”
- `auto:flow（自动布局）`: “仅当前分析视图”

## 测试策略

1. 纯函数单测：
   - `datasetKey`
   - `filterKey`
   - 布局快照合并/清理
2. 组件测试：
   - 拖拽后保存位置
   - 刷新后恢复位置
   - 切到自动布局再切回手动恢复原布局
   - 不同筛选组合各自记住布局
3. 回归测试：
   - 现有信号拓扑与右侧详情交互不回退

## 风险与控制

### React Flow 事件接线复杂

通过提取 `topology-layout.ts` 纯函数，把复杂度压到可测层，再在组件内只保留事件接线和状态切换。

### 轮询刷新可能覆盖用户拖拽态

采用“基础布局 + 手动覆盖”的重建策略。只要 `datasetKey` 不变，手动位置就稳定覆盖基础布局。

### localStorage 结构持续膨胀

Phase 1 仅保存当前拓扑工作区；提供“清空已保存布局”作为用户可见清理口。
