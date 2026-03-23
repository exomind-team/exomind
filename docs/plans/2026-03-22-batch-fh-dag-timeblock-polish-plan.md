# 批次 FH：DAG 四期散件 + 时间块/当下打磨

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#643, #642, #663, #665, #640, #636, #650, #616, #617, #633, #634, #645
> **执行顺序**：F 组（#643 → #642 → #663 → #665 → #640 → #636 → #650）→ H 组（#616 → #617 → #633 → #634 → #645）

---

## Context

F 组（DAG 四期）和 H 组（时间块/当下打磨）改动域不重叠，合并为一个计划顺序执行。

**F 组 — DAG 散件（7 个）**：
1. **#643**（bug 极小）：执行模式下空白点击未默认取消选中
2. **#642**（bug 小）：结束时间块对话框未对齐多行文本固定回车语义
3. **#663**（bug 极小）：火山引擎 Key 保存后未关闭对话框
4. **#665**（bug 中）：竖屏窄宽度下模式切换与工具栏重叠遮挡 + 提示板折叠
5. **#640**（feat 小）：模式切换支持滚轮循环与 Ctrl+Alt+滚轮快捷切换
6. **#636**（feat 小）：工具栏增加背景展示切换，支持无/点阵/网格单选
7. **#650**（feat 中）：隐藏已结束升级为三级过滤策略

**H 组 — 时间块/当下打磨（5 个）**：
8. **#616**（bug 小）：时间块详情页面包屑固定顶部
9. **#617**（feat 小）：关联任务图标化快速导航到详情与 DAG 定位
10. **#633**（feat 中）：任务状态变化支持填写变化描述
11. **#634**（feat 中）：时间块启动前支持预选待关联任务
12. **#645**（feat 中）：专注态悬浮窗计时器整合 + 统一黑褐色玻璃风格

---

## F 组：DAG 四期散件

### 步骤 1：#643 执行模式空白点击取消选中

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

当前 `onPaneClick` 在 execute 模式下不清空 `selectedTaskId`。追加：

```tsx
onPaneClick={() => {
  if (mode === 'browse') { setSelectedTaskId(null); }
  if (mode === 'execute') { setSelectedTaskId(null); }  // ★ 新增
  if (mode === 'connect') { /* 已有逻辑 */ }
  setContextMenu(null);
  setPaneContextMenu(null);
}}
```

---

### 步骤 2：#642 结束时间块对话框回车语义对齐

**文件**：结束时间块反馈对话框（检查 `TimeBlockFeedbackDialog.tsx` 或 `MultiTaskEndDialog.tsx`）

当前多行文本区域的 Enter 行为可能不一致。统一为：
- `Enter` / `Shift+Enter`：换行
- `Ctrl/Cmd+Enter`：提交

检查 `useFeedbackSubmitControls.ts` 中的 `handleKeyDown` 逻辑，确保与 `#641 spec` 一致。如果已有 `enterToSubmit` 模式切换，确保结束时间块对话框使用 `enterToSubmit = false`（即 Ctrl+Enter 提交）。

---

### 步骤 3：#663 火山 Key 保存后关闭对话框

**文件**：设置页中火山引擎 Key 输入的弹窗组件

当前保存 API Key 后对话框未自动关闭。在保存成功回调中追加 `onOpenChange(false)` 或等效的关闭逻辑。

检查 `settings-renderers.tsx` 中 `secret` 类型设置项的保存流程。

---

### 步骤 4：#665 竖屏窄宽度工具栏折叠

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`、`src/ui/app/components/TaskDagKeyHints.tsx`、`src/ui/app/pages/TaskDagPage.tsx`

按 #665 设计方案，用 `useIsDesktop()` 判断：

| 元素 | 横屏 | 竖屏 |
|------|------|------|
| 模式切换条（左上） | 不变 | 不变 |
| 搜索+过滤（右上） | 展开 | 收起为 🔍 图标，点击展开 |
| 视图工具（右上） | 展开 | 收起为 ⚙ 图标，点击展开 |
| 按键提示板（右下） | 展开 | 收起为 ⌨ 图标，点击展开 |

**实现方式**：

```tsx
const isDesktop = useIsDesktop();
const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

// 竖屏：右上角只显示两个小按钮
{!isDesktop ? (
  <div className="pointer-events-auto absolute right-3 top-3 z-10 flex gap-1">
    <button onClick={() => setMobileSearchOpen(v => !v)}>
      <Search size={16} />
    </button>
    <button onClick={() => setMobileToolsOpen(v => !v)}>
      <Settings size={16} />
    </button>
  </div>
) : (
  <TaskDagControlPanel ... />  // 横屏不变
)}

// 竖屏展开面板（搜索/工具分别）
{!isDesktop && mobileSearchOpen ? (
  <div className="absolute right-3 top-12 z-20 ...">
    {/* 搜索框 + 搜索选项 */}
  </div>
) : null}
```

**提示板折叠同理**：竖屏默认只显示 ⌨ 图标。

---

### 步骤 5：#640 滚轮 + 快捷键切换模式

**两种触发方式**：

| 触发方式 | 修饰键要求 | 说明 |
|---------|-----------|------|
| 鼠标悬浮在模式切换条上滚轮 | **无需修饰键** | 鼠标已明确指向模式切换控件，无歧义 |
| 画布任意位置滚轮 | **Ctrl+Alt+滚轮** | 需要修饰键避免与浏览器缩放/ReactFlow 缩放冲突 |
| 键盘快捷键 | **Ctrl+Alt+←/→** | 与画布滚轮修饰键一致（原 Ctrl+←/→ 改为 Ctrl+Alt+←/→） |

**文件 1**：`src/ui/app/components/TaskDagModeSelector.tsx`

模式切换条新增 `onWheel` 监听（无需修饰键）：

```tsx
<div
  className={[...].join(' ')}
  onWheel={(event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 : -1;
    const currentIndex = MODE_OPTIONS.findIndex((o) => o.key === mode);
    const nextIndex = (currentIndex + delta + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    onChange(MODE_OPTIONS[nextIndex].key);
  }}
>
```

**文件 2**：`src/ui/app/pages/TaskDagPage.tsx`

画布 div 新增 `onWheel`（需要 Ctrl+Alt）：

```tsx
onWheel={(event) => {
  if (!event.ctrlKey || !event.altKey) return;
  event.preventDefault();
  const delta = event.deltaY > 0 ? 1 : -1;
  const currentIndex = MODE_ORDER.indexOf(mode);
  const nextIndex = (currentIndex + delta + MODE_ORDER.length) % MODE_ORDER.length;
  setMode(MODE_ORDER[nextIndex]);
}}
```

**文件 3**：`src/ui/app/hooks/useTaskDagKeyboard.ts`

将模式切换快捷键从 `Ctrl+←/→` 改为 `Ctrl+Alt+←/→`（与画布滚轮修饰键一致）：

```ts
// 原来：
// if (event.ctrlKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
// 改为：
if (event.ctrlKey && event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
```

**注意**：`Ctrl+←/→` 释放后，浏览器默认行为（光标跳词）不再被拦截，键盘输入体验更自然。

---

### 步骤 6：#636 背景展示切换

**文件**：`src/ui/app/pages/TaskDagPage.tsx`、`src/ui/app/components/TaskDagControlPanel.tsx`

新增背景模式状态：

```tsx
type DagBackgroundMode = 'none' | 'dots' | 'lines';
const [backgroundMode, setBackgroundMode] = useState<DagBackgroundMode>('dots');

// ReactFlow 内部：
{backgroundMode === 'dots' ? (
  <Background gap={20} color="#E7E5E4" variant={BackgroundVariant.Dots} />
) : backgroundMode === 'lines' ? (
  <Background gap={20} color="#E7E5E4" variant={BackgroundVariant.Lines} />
) : null}
```

在控制面板新增单选枚举（无/点阵/网格），localStorage 持久化。

---

### 步骤 7：#650 隐藏已结束三级过滤策略

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

当前 `hideTerminal` 是 boolean。升级为三级枚举：

```tsx
type TerminalFilterMode = 'show' | 'smart' | 'hide';
// show: 全部显示
// smart: 隐藏已结束但保留承载活跃下游的终态节点（当前 #607 实现）
// hide: 严格隐藏所有终态节点

const [terminalFilter, setTerminalFilter] = useState<TerminalFilterMode>('smart');
```

控制面板中的"隐藏已结束"按钮改为三态切换（文案跟随变化）：
- `显示全部` → `智能隐藏` → `严格隐藏` → 循环

---

## H 组：时间块/当下打磨

### 步骤 8：#616 时间块详情面包屑固定顶部

**文件**：`src/ui/app/pages/TimeBlockDetailPage.tsx`

将 header（含面包屑）从随内容滚动改为 `sticky top-0`：

```tsx
<header className="sticky top-0 z-10 bg-[#FAF7F5] px-5 py-4 dark:bg-[#0C0A09]">
  <TaskBreadcrumb ... />
</header>
```

---

### 步骤 9：#617 关联任务图标化快速导航

**文件**：`src/ui/app/pages/TimeBlockDetailPage.tsx`（或 `timeblock-detail-view.ts`）

在关联任务列表中，每个任务行右侧新增两个图标按钮：
- 📋 → 跳转到 `/tasks/$taskId`（任务详情）
- 🔗 → 跳转到 `/tasks/dag?focus=$taskId`（DAG 定位）

```tsx
<Link to="/tasks/$taskId" params={{ taskId: task.id }}>
  <FileText size={14} />
</Link>
<Link to="/tasks/dag" search={{ focus: task.id }}>
  <Waypoints size={14} />
</Link>
```

---

### 步骤 10：#633 任务状态变化填写描述

**文件**：`src/ui/app/components/TaskStatusSelector.tsx` 或新建包装组件

在 `transitionTask` 调用前弹出一个可选的描述输入框（类似时间块结束反馈）：

```tsx
// 用户选择状态后，弹出描述输入（可跳过）
<Dialog open={statusChangeDialogOpen}>
  <DialogContent>
    <DialogTitle>状态变更为「{toStatusLabel}」</DialogTitle>
    <textarea placeholder="补充说明（可选）..." />
    <DialogFooter>
      <button onClick={submitWithoutDescription}>跳过</button>
      <button onClick={submitWithDescription}>确认</button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

描述写入 EventLog（通过 `emitTaskTransition` 的 metadata 扩展，或单独追加一条 note 事件）。

---

### 步骤 11：#634 时间块启动前预选关联任务

**文件**：专注页启动流程相关组件（检查 `FocusTimerWidget.tsx` 或 `NowWorkbenchOverlayPage.tsx`）

在点击"开始专注"后、时间块实际启动前，弹出任务选择界面：

```tsx
// 启动流程改为两步：
// 1. 用户点击"开始专注" → 弹出任务选择
// 2. 用户选择任务 → startBlockForTasks(selectedTaskIds, config)

// 任务选择列表：显示所有 pending/in_progress 状态的任务
// 支持多选（复选框）
// 默认预选当前页面上下文相关的任务（如果有）
```

---

### 步骤 12：#645 悬浮窗计时器整合 + 统一风格

**文件**：`src/pages/NowWorkbenchOverlayPage.tsx`、`src/components/TimeBlockWidget.tsx`

将悬浮窗中的多个计时器显示区域整合为单一统一风格：
- 黑褐色玻璃背景（`bg-black/80 backdrop-blur`）
- 时间大字居中
- 关联任务列表紧凑排列
- 暂停/结束按钮底部对齐

具体视觉方案 Codex 自行参考现有悬浮窗风格和 issue 描述。

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/ui/app/pages/TaskDagPage.tsx` | 空白点击 + 背景切换 + 三级过滤 | #643 #636 #650 |
| `src/ui/app/components/TaskDagControlPanel.tsx` | 竖屏折叠 + 背景枚举 + 过滤文案 | #665 #636 #650 |
| `src/ui/app/components/TaskDagKeyHints.tsx` | 竖屏折叠 | #665 |
| `src/ui/app/hooks/useTaskDagKeyboard.ts` | 滚轮切模式（如果放在 hook 中） | #640 |
| 时间块反馈对话框 | 回车语义对齐 | #642 |
| 设置页渲染器 | Key 保存关闭 | #663 |
| `TimeBlockDetailPage.tsx` | sticky header + 任务导航 | #616 #617 |
| `TaskStatusSelector.tsx` 或包装组件 | 状态变化描述 | #633 |
| 专注页启动组件 | 预选任务 | #634 |
| 悬浮窗组件 | 计时器整合 | #645 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要改动 task-dag-graph.ts** | 图算法不变 |
| **不要改动 task-dag-layout.ts** | Sugiyama 不变 |
| **不要改动 task-event-emitter.ts** | 事件发射不变 |
| **不要改动 useTaskDagKeyboard.ts 的已有键盘逻辑** | 只追加滚轮（如果放在该 hook 中） |
| **不要删除现有的 Background 组件** | 只改 variant 参数 |

## ⚠️ 容易出错的关键点

1. **#643 execute 模式的 onPaneClick**：注意不要影响 connect 模式的空白单击建任务逻辑
2. **#665 useIsDesktop**：竖屏折叠状态是临时的（不持久化），每次进入 DAG 默认收起
3. **#640 模式切换修饰键统一**：画布滚轮和键盘快捷键都用 `Ctrl+Alt`；模式切换条上悬浮滚轮无需修饰键。同时把 useTaskDagKeyboard 中的 `Ctrl+←/→` 改为 `Ctrl+Alt+←/→`
4. **#650 三级过滤需要改 localStorage key**：原 `exomind:dag-hide-terminal` 存的是 boolean，新格式是 enum string，需要向后兼容
5. **#633 状态描述可选**：用户可以跳过不填，不应阻塞状态变更
6. **#634 预选任务列表**：只显示 pending/in_progress 的任务，不显示终态
7. **#645 悬浮窗跨平台**：Tauri 悬浮窗和 Web 版可能有不同的容器约束

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 执行空白点击 | 执行模式点击空白 | 取消选中 | #643 |
| 结束对话框回车 | Enter | 换行，不提交 | #642 |
| 结束对话框提交 | Ctrl+Enter | 提交 | #642 |
| Key 保存 | 保存火山 Key | 对话框关闭 | #663 |
| 竖屏工具栏 | 窄屏查看 DAG | 搜索+工具收起为图标 | #665 |
| 竖屏展开 | 点击 🔍 图标 | 搜索面板展开 | #665 |
| 滚轮切模式-悬浮 | 鼠标悬浮模式切换条+滚轮 | 无需修饰键，模式循环 | #640 |
| 滚轮切模式-画布 | 画布上 Ctrl+Alt+滚轮 | 模式循环切换 | #640 |
| 滚轮切模式-无修饰 | 画布上纯滚轮 | 不触发（正常缩放） | #640 |
| 背景切换 | 选择"网格" | 背景变为网格线 | #636 |
| 三级过滤-智能 | 选择"智能隐藏" | 保留承载下游的终态 | #650 |
| 三级过滤-严格 | 选择"严格隐藏" | 隐藏所有终态 | #650 |
| 面包屑固定 | 滚动时间块详情 | 面包屑不动 | #616 |
| 任务导航 | 点击 📋 图标 | 跳到任务详情 | #617 |
| DAG 定位 | 点击 🔗 图标 | 跳到 DAG 并聚焦 | #617 |
| 状态描述 | 完成任务时填写描述 | 描述记入 EventLog | #633 |
| 状态描述-跳过 | 点击跳过 | 正常变更，无描述 | #633 |
| 预选任务 | 开始专注前 | 弹出任务选择列表 | #634 |
| 悬浮窗风格 | 查看专注悬浮窗 | 统一黑褐色玻璃风格 | #645 |
| tsc | `bunx tsc --noEmit` | 零错误 | 全部 |

---

## 完成回填

已按顺序完成 F/H 两组 12 个步骤的实现，覆盖：
- DAG 执行空白点击取消选中、结束反馈快捷键语义、火山 Key 保存后自动关闭。
- 窄屏工具栏/提示板折叠、`Ctrl+Alt+滚轮` 循环切模式、背景模式切换持久化、终态节点三级过滤并兼容旧 boolean 存储值。
- 时间块详情 sticky breadcrumb、关联任务详情/DAG 快速入口、任务状态变化可选说明追加到事件记录。
- 时间块启动前预选 `pending` / `in_progress` 关联任务、悬浮窗计时器整合与黑褐色玻璃风格。

另外修复了 `NowWorkbenchOverlayPage` 相关单测在合并执行下的环境串扰：
- 在 `tests/unit/pages/NowWorkbenchOverlayPage.runtime.test.tsx` 的 `beforeEach/afterEach` 中补强 `cleanup()`、`vi.useRealTimers()`、session/listener 清理与 mock 恢复，避免其它测试遗留 fake timers 导致 overlay 用例超时或 DOM 残留。

验证结果：
- `bunx tsc --noEmit` ✅
- `bunx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/settings/settings-input-section.issue199.test.tsx tests/unit/ui/timeblock-detail-domain.issue583.test.tsx tests/unit/components/FocusTimerWidget.state-machine.issue175.test.tsx tests/unit/pages/NowWorkbenchOverlayPage.runtime.test.tsx` ✅

备注：
- 相关设置页测试仍会输出若干 `act(...)` warning，但本批相关测试已全部通过，未形成失败。
