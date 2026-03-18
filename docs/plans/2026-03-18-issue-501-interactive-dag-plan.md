# #501 交互式 DAG 实施计划

> **状态**：待执行
> **分支**：从 dev 新建 `feature/issue-501-interactive-dag`
> **PR 目标**：dev
> **关联 Issue**：#501 (epic), #557, #558, #559, #560, #563, #573

---

## 背景

PR #552 已合并到 dev，完成了 DAG 的基础能力：
- 自定义控制面板（TaskDagControlPanel）
- 折叠上下游（安全算法 + 递归 + 下游对称）
- 右键上下文菜单
- 深色模式 + React Flow 角标隐藏
- 节点详情面板（卡片式，固定在画布右侧流式布局中）

当前 DAG 是固定高度 `h-[560px]` 的卡片布局，需升级为全画布交互式主视图。

---

## 参考

- **网络页面**（`src/ui/app/pages/agents/TopologyView.tsx`）：全画布布局、浮动控件、节点选中交互的参考实现
- **#501 Issue body**：三模式设计原文、连接 Toggle 规则表、执行模式视觉状态表
- **FocusTimerWidget**（`src/ui/app/components/FocusTimerWidget.tsx`）：时间块结束反馈对话框的参考实现

---

## 分 3 个 Wave 实施

### Wave 1：全画布 + 浮动控件 + 节点增强

**目标**：DAG 从卡片升级为全画布主视图，参考「网络」界面。

#### 1.1 画布全屏化

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

- 移除包裹 ReactFlow 的 `<section>` 卡片容器（`rounded-2xl border ... h-[560px]`）
- ReactFlow 容器改为 `flex-1 min-h-0` 占满面包屑下方所有空间
- 页面根容器改为 `flex flex-col h-full`
- 面包屑保留在画布上方作为固定 header

**参考**：TopologyView.tsx 的布局结构：
```
<div className="flex h-full flex-col">
  <header>面包屑</header>
  <div className="relative flex-1 min-h-0">
    <ReactFlow>...</ReactFlow>
  </div>
</div>
```

#### 1.2 浮动控件重新布局

**文件**：`src/ui/app/pages/TaskDagPage.tsx`, `src/ui/app/components/TaskDagControlPanel.tsx`

- 移除现有图例说明区（硬依赖/软依赖文字说明 section）
- 图例改为浮动 tooltip 或紧凑图标（hover 显示说明）
- TaskDagControlPanel 保持右上角浮动
- 新增模式切换器（浮动在左上角或右上角，Wave 3 激活前为占位 UI）

#### 1.3 节点详情面板移除

- 移除现有的 `task-dag-selected-panel` 固定卡片
- Wave 2 将用侧栏/抽屉替代

#### 1.4 #558 选中节点高亮

**文件**：`src/ui/app/pages/TaskDagPage.tsx`, `src/ui/app/pages/task-dag-flow.ts`

- 选中节点添加高亮样式：`ring-2 ring-[#C75B3A] shadow-lg` 或发光效果
- 通过 `selectedTaskId` 状态驱动，在 `TaskDagNode` 组件中条件渲染
- 非选中节点保持默认样式

#### 1.5 #559 过滤已结束节点

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

- 新增状态 `hideTerminal: boolean`（默认 false）
- 浮动控件中增加「隐藏已结束」toggle 按钮
- 启用时过滤 `status === 'completed' || status === 'cancelled'` 的节点及其相关边
- 过滤后重新计算可见图（复用 `projectVisibleTaskGraph` 或直接过滤 flowGraph）

#### 1.6 #573 节点搜索过滤

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

- 浮动控件中增加搜索输入框（参考 TasksPage 的模糊搜索实现）
- 输入时 debounce 300ms，匹配节点标题
- 匹配的节点高亮（不同于选中高亮，用柔和的背景色）
- 不匹配的节点降低透明度（opacity-30）
- 清空搜索恢复全部节点

#### 验收标准

- [ ] DAG 画布占满面包屑下方全部空间
- [ ] 无固定高度卡片，无图例说明区，无节点详情卡片
- [ ] 选中节点有明确的高亮/发光效果
- [ ] 「隐藏已结束」toggle 可用
- [ ] 搜索框输入后匹配节点高亮，不匹配降透明度
- [ ] 控件浮动在画布上方，不占布局流

---

### Wave 2：详情侧栏/抽屉

**目标**：选中节点后展示详情面板，横屏为右侧栏，竖屏为底部抽屉。

#### 2.1 响应式详情面板

**文件**：新建 `src/ui/app/components/TaskDagDetailPanel.tsx`

**横屏（桌面）**：
- 右侧固定宽度面板（340px），从右侧滑入
- 面板内容：任务标题、状态标签、执行提示、依赖列表、估时、操作按钮
- 关闭按钮或点击画布空白处关闭

**竖屏（移动端）**：
- 底部抽屉（从下方滑出），可拖拽调整高度
- 内容与横屏相同
- 下拉关闭

**检测方式**：使用现有的 `useIsDesktop()` hook 或 `@media` 查询

#### 2.2 双击进入任务详情

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

- `onNodeDoubleClick` 事件：导航到 `/tasks/:taskId?from=dag`
- 面包屑自动显示 `← 任务 / DAG / 任务详情`（已有 `from=dag` 支持）

#### 2.3 面板内容

面板应展示：
- 任务标题 + 状态标签（中文）
- 执行提示（可执行 / 受阻 / 已完成等）
- 依赖关系列表（硬/软依赖的前置和后继）
- 估时信息
- 操作按钮：「查看详情」（跳转）、「开始计时」（Wave 3 激活）

#### 验收标准

- [ ] 单击节点：横屏右侧栏滑出，竖屏底部抽屉滑出
- [ ] 双击节点：导航到任务详情页
- [ ] 面板显示完整的节点信息
- [ ] 点击画布空白处或关闭按钮关闭面板
- [ ] 面板打开时画布仍可缩放/平移

---

### Wave 3：三模式（浏览/连接/执行）

**目标**：实现完整的三模式交互体系。

#### 3.1 模式切换器

**文件**：新建 `src/ui/app/components/TaskDagModeSelector.tsx`

- 三个按钮：浏览 / 连接 / 执行
- 浮动在画布上方（与 TaskDagControlPanel 并列或独立行）
- 模式状态缓存到 `localStorage`（`exomind:dag-mode`）
- 当前模式高亮显示

#### 3.2 浏览模式（默认）

- 现有行为不变
- 单击选中 → 显示详情面板
- 双击 → 进入任务详情页
- 右键 → 折叠上下游菜单
- 节点不可拖拽、不可连接

#### 3.3 连接模式

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**拖拽连线**：
- 启用 ReactFlow 的 `nodesConnectable={true}`（仅连接模式下）
- `onConnect` / `onConnectStart` 事件处理：
  - 默认拖拽 → 建立硬依赖
  - **Shift + 拖拽** → 建立软依赖（通过 `event.shiftKey` 检测）
  - 拖拽时边线样式动态变化提示（实线=硬，虚线=软）
- 右键菜单在连接模式下保留（内容可与浏览模式不同）

**点击连线**：
- 单击节点 A → A 边框变实线高亮（预览硬依赖）
- 再单击 A → 边框变虚线高亮（预览软依赖）
- 点击节点 B → 建立 A→B 依赖（硬或软取决于 A 的高亮状态）
- 点击空白处 → 取消选择

**Toggle 规则**（来自 #501 Issue body）：

| 已有关系 | 操作 | 结果 |
|---------|------|------|
| A→B 硬依赖 | 再设硬依赖 | **删除**（同类型 toggle） |
| A→B 硬依赖 | 再设软依赖 | **覆盖**为软依赖 |
| A→B 软依赖 | 再设软依赖 | **删除**（同类型 toggle） |
| A→B 软依赖 | 再设硬依赖 | **覆盖**为硬依赖 |

**后端调用**：
- 建立/修改依赖：`taskService.updateTask(targetId, { dependsOn: [...] })`
- 删除依赖：从 `dependsOn` 数组中移除对应项
- 循环依赖已有后端拒绝（commit `120a9d7`）

#### 3.4 执行模式

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**视觉状态**：

| 节点类型 | 样式 | 交互 |
|---------|------|------|
| 当前专注任务（关联到活跃块） | 展开卡片 + 脉动边框 | 单击取消关联 |
| 可执行任务（未被阻塞） | 正常卡片 | 单击启动/关联 |
| 阻塞任务 | opacity-50 + disabled 样式 | 不可点击，hover 显示原因 |
| 终态任务 | 灰色 | 不可交互 |

**单击可执行节点**：
1. 若**无活跃时间块**：
   - 用「剩余时间」（`estimatedMinutes - spentMinutes`）启动倒计时，无估时则正计时
   - 调用 `getTaskTimerService().startBlockForTask(taskId, config)`
   - 任务状态自动转为 `in_progress`
2. 若**已有活跃时间块**：
   - 将该任务关联到当前活跃块（追加 `timeBlockIds`）
   - 任务状态转为 `in_progress`

**单击已关联节点（取消关联）**：
1. 从活跃块移除该任务关联
2. 任务状态转为 `suspended`
3. 若是最后一个取消关联的任务：
   - 弹出结束反馈对话框（复用 FocusTimerWidget 的模式）
   - 对话框中逐个任务选择结束后状态

**右键「结束」**：
- 弹出结束反馈对话框
- 对话框内容：
  - 反馈文本框
  - 关联任务列表，每个任务独立的状态选择器（复用 TaskStatusSelector）
  - 提交按钮
- 提交后调用 `timeBlockService.endBlock(feedback)` + 逐个 `taskService.transitionTask(taskId, status)`

**双击**：在执行模式下**保留**，双击进入任务详情页（与浏览模式一致）

**右键菜单**（执行模式专属）：
- 「结束时间块」→ 弹出多任务反馈对话框
- 其他选项可保留（折叠等）

#### 验收标准

- [ ] 模式切换器三按钮可用，状态持久化到 localStorage
- [ ] 浏览模式：与当前行为一致
- [ ] 连接模式：拖拽 + 点击两种方式建立依赖
- [ ] 连接模式：Toggle 规则正确（同类删除、异类覆盖）
- [ ] 连接模式：循环依赖被后端拒绝并前端提示
- [ ] 执行模式：单击可执行节点启动/关联时间块
- [ ] 执行模式：单击已关联节点取消关联
- [ ] 执行模式：最后一个取消关联弹出结束对话框
- [ ] 执行模式：右键「结束」弹出多任务反馈对话框
- [ ] 执行模式：阻塞节点不可点击 + hover 提示

---

## 关键文件索引

| 文件 | 用途 | Wave |
|------|------|------|
| `src/ui/app/pages/TaskDagPage.tsx` | DAG 主页面 | 1,2,3 |
| `src/ui/app/pages/task-dag-flow.ts` | Flow 节点/边构建 | 1 |
| `src/ui/app/components/TaskDagControlPanel.tsx` | 浮动控件 | 1 |
| `src/ui/app/components/TaskDagDetailPanel.tsx` | **新建** 详情侧栏/抽屉 | 2 |
| `src/ui/app/components/TaskDagModeSelector.tsx` | **新建** 模式切换器 | 3 |
| `src/lib/task/task-dag-visibility.ts` | 折叠算法 | 1（过滤） |
| `src/lib/task/task-dag-graph.ts` | 图构建 | 1 |
| `src/ui/app/pages/agents/TopologyView.tsx` | 全画布参考 | 1 |
| `src/ui/app/components/FocusTimerWidget.tsx` | 反馈对话框参考 | 3 |
| `src/ui/app/components/TaskStatusSelector.tsx` | 状态选择器（复用） | 3 |
| `src/lib/services/task-timer.service.ts` | 时间块启动 | 3 |
| `src/lib/services/task.service.ts` | 依赖更新 | 3 |
| `src/ui/app/hooks/useIsDesktop.ts` | 横竖屏检测 | 2 |

---

## 数据模型（已就位，无需 RT 改动）

### 一个时间块多个任务

**已实现**。RT 和前端都已支持：

- RT：`ActiveBlockData.task_ids: Vec<String>` + `task_association_log: Vec<BlockTaskAssociationEvent>`
- RT：`task_id: Option<String>` 已标记 `#[serde(skip_serializing)]` deprecated
- 前端：`ActiveBlockData.taskIds: UUID[]` + `normalizeTaskIdList()` 去重
- 前端：`TimeBlockService.startBlock()` 已支持 `taskBinding: { taskIds: string[] }` 参数
- 前端：`TimeBlockService.patchActiveTaskAssociation()` 可增量修改 taskIds

**执行模式应操作 `taskIds` 数组**，不使用 deprecated 的 `taskId`。增删时用 `Set` 去重。

### 依赖操作

前端通过 `updateTask(taskId, { dependsOn: [...] })` 整体 PUT。连接模式在前端计算 diff 后整体提交。无需新 RT 端点。

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要改动 TasksPage.tsx** | 任务列表页已稳定，本次只改 DAG 页 |
| **不要改动 TaskDetailPage.tsx** | 任务详情页已稳定，双击导航用现有路由 |
| **不要改动 FocusTimerWidget.tsx** | 只复用其反馈对话框模式，不修改组件本身 |
| **不要重写 task-dag-visibility.ts** | 折叠算法已稳定且有测试，只调用不改 |
| **不要改动 Rust RT 结构体** | `ActiveBlockData` 已有 `task_ids` 支持，前端直接用 |
| **不要改动 RT 端点** | `PUT /timeblocks/active` 已支持完整的 ActiveBlockData |
| **不要引入新依赖** | 只用现有的 ReactFlow + lucide-react + Tailwind |
| **不要改动路由结构** | `/tasks/dag` 路由保持不变 |
| **不要改动导航栏** | 左侧导航栏不在本次范围 |

## ⚠️ 容易出错的关键点

### 连接模式

1. **拖拽连线**：默认 = 硬依赖，**Shift 按住** = 软依赖（不是右键！）
2. **右键菜单**：连接模式下**保留**（不禁用），但菜单内容可能不同于浏览模式
3. **Toggle 规则必须严格遵守**：同类型 = 删除，异类型 = 覆盖。不是「提示已存在」

### 执行模式

4. **单击 = 启动/关联**，**双击 = 进入详情页**。不要混淆
5. **取消关联的最后一个任务时**：必须弹出结束对话框，不能静默结束
6. **反馈对话框**：逐个任务选择状态（复用 TaskStatusSelector），不是统一选择
7. **阻塞节点**：`opacity-50` + 不可点击 + hover 提示阻塞原因。不是隐藏

### 全画布

8. **面包屑保留在画布上方**，不是浮动在画布内部
9. **浮动控件在画布内部**（absolute 定位），不在面包屑行

---

## 需要涉及 RT 的改动清单

| 改动 | 涉及 RT？ | 说明 |
|------|-----------|------|
| 全画布布局 | ❌ | 纯前端 CSS |
| 节点高亮 | ❌ | 纯前端样式 |
| 过滤终态节点 | ❌ | 前端过滤 |
| 搜索节点 | ❌ | 前端过滤 |
| 详情侧栏/抽屉 | ❌ | 纯前端组件 |
| 模式切换器 | ❌ | 纯前端状态 |
| 连接模式建立依赖 | ❌ | 用现有 `updateTask({ dependsOn })` |
| 连接模式删除依赖 | ❌ | 用现有 `updateTask({ dependsOn })` |
| 执行模式启动时间块 | ❌ | 用现有 `startBlock({ taskIds })` |
| 执行模式关联任务 | ❌ | 用现有 `patchActiveTaskAssociation()` |
| 执行模式结束时间块 | ❌ | 用现有 `endBlock()` + `transitionTask()` |

**结论：本次实施无需任何 RT 改动。**

---

## 测试策略

- 每个 Wave 完成后运行 `bunx tsc --noEmit` + `bunx vitest run`
- Wave 1：验证画布占满、过滤/搜索功能、高亮效果
- Wave 2：验证横竖屏切换、双击导航、面板打开/关闭
- Wave 3：验证三模式切换、连接 Toggle 规则、执行模式时间块操作
- **不需要跑 `cargo test`**（无 RT 改动）

---

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 执行模式状态机复杂 | 高 | 画状态机图，用 switch-case 而非嵌套 if |
| 连接模式 Shift+拖拽检测 | 中 | ReactFlow `onConnectStart` 可读 event.shiftKey |
| 竖屏抽屉交互 | 中 | 先做固定高度抽屉，后续加拖拽 |
| 多任务反馈对话框 | 中 | 复用 TaskStatusSelector 组件，逐个任务渲染 |
