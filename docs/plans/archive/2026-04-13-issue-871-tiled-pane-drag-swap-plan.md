# Issue #871：网络 / 平铺窗格会话拖拽换位临时计划

> **状态**：第二阶段执行中  
> **分支**：直接在 `dev` 上开发  
> **关联 Issue**：#871  
> **执行顺序**：失败测试补齐 → 槽位 move/swap helper → `AgentsPage` 拖拽动作 → `TiledGrid` 树模式头部拖拽 → 第二阶段拖拽跟手 / 禁选中改造 → 自动化与手动验收

---

## Context

- 当前公开航线仍把 `#871` 放在 `T'：Agent / CLI shell 网络会话与平铺工作台` 批次内，属于“应继续收尾的平铺工作台尾项”。
- 最近 `dev` 提交仍以 docs 与平铺工作台周边修复为主；当前本地核查基线是 `dev@0f0afc67`。
- `#871` 的交互决策已收口：
  - `occupied -> empty = move`
  - `occupied -> occupied = swap`
  - 只改槽位绑定，不改树结构、分割比例或布局层级
- 现状代码：
  - `src/ui/app/pages/agents/TiledGrid.tsx:457` 的 `PaneTreeGrid(...)` 是当前 `网络 / 平铺` 主路径，但它渲染 `SessionPane` / `DisconnectedPane` 时没有接通树模式拖拽。
  - `src/ui/app/pages/agents/TiledGrid.tsx:860` 的 `SortablePane(...)` 仍保留旧网格路径的 `dnd-kit sortable` 头部拖拽基础，但那条逻辑不是当前树模式的真实入口。
  - `src/ui/app/pages/agents/tiled-pane-tree.ts:635` 的 `bindSessionToTiledPaneSlot(...)` 已覆盖“移动到新槽位并清空旧槽位”的基础 rebind 语义，但没有显式 occupied -> occupied swap helper。
  - `src/ui/app/pages/AgentsPage.tsx:3423` 的 `bindSessionToTiledSlot(...)`、`src/ui/app/pages/AgentsPage.tsx:3539` 的 `clearTiledSlot(...)`、`src/ui/app/pages/AgentsPage.tsx:3571` 的 `closeTiledSlot(...)` 已经是当前树模式槽位状态的核心动作入口。
  - `src/ui/app/pages/AgentsPage.tsx:1392` 的 `buildCurrentTiledLayoutSnapshot(...)` 与 `src/ui/app/pages/AgentsPage.tsx:3912` 的持久化写回，说明只要正确改动 `tiledPaneSlots` / `tiledFocusedSlotId`，现有布局持久化就会自动承接拖拽结果。
- 现有测试：
  - `tests/unit/ui/agent-hub/tiled-pane-tree.test.ts:60` 只验证 occupied -> empty move。
  - `tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx:32` 只验证空窗格绑定/新建，不验证拖拽。
  - `tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx:368` 已覆盖树模式骨架与回池语义，但未覆盖会话拖拽换位。

---

## 步骤 1：先把 #871 的 move / swap 契约补成失败测试

### 1.1 改动

- 修改 `tests/unit/ui/agent-hub/tiled-pane-tree.test.ts`
  - 在现有“move 到空槽位”用例旁新增 occupied -> occupied swap 失败测试。
  - 覆盖 `slot-1(session-a, recovery-a)` 与 `slot-2(session-b, recovery-b)` 的交换语义：
    - `slotId` 不变
    - `sessionId` 对调
    - `terminalRecovery` 跟随各自绑定一起移动，不能留在旧槽位形成脏恢复快照
  - 增加至少一个 no-op 约束：
    - source / target 相同
    - source 为空槽位
    - target 不存在
    - 以上场景返回原值
- 修改 `tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx`
  - 为树模式 session pane 增加“无独立拖拽把手按钮”的约束断言。
  - 增加“从 PTY 顶栏文本外背景区域拖动时可触发 move”的失败测试。
  - 增加“从顶栏文本或按钮发起手势不应触发拖拽”的保护测试。
  - 空窗格仍保持点击式“绑定 / 新建”入口，不要求把未分配池一起拖拽化。
- 如 jsdom 无法可信覆盖真实 pointer drag，提前创建浏览器级拖拽用例骨架：
  - `tests/e2e/agents-page.tiled-drag.issue871.test.ts`
  - `tests/e2e/playwright.issue871.config.ts`

### 1.2 验证

```powershell
npx vitest run tests/unit/ui/agent-hub/tiled-pane-tree.test.ts tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx
```

若已补浏览器级骨架，再跑：

```powershell
npx playwright test tests/e2e/agents-page.tiled-drag.issue871.test.ts -c tests/e2e/playwright.issue871.config.ts
```

---

## 步骤 2：把槽位 move / swap 语义收口成显式 helper

### 2.1 改动

- 修改 `src/ui/app/pages/agents/tiled-pane-tree.ts`
  - 在 `getTiledPaneSlotBinding(...)`、`bindSessionToTiledPaneSlot(...)` 旁新增显式 helper（名称可定为 `moveOrSwapTiledPaneSlotBinding(...)`，也可用更贴近语义的名字，但必须单独暴露，不要把 swap 塞回 `bindSessionToTiledPaneSlot(...)` 的隐式分支里）。
  - helper 输入建议至少包含：
    - `tree`
    - `slots`
    - `sourceSlotId`
    - `targetSlotId`
  - helper 规则：
    1. 先 `normalizeTiledPaneSlotBindings(...)`
    2. source 没有 `sessionId` → 原样返回
    3. source / target 相同 → 原样返回
    4. target 不存在 → 原样返回
    5. target 有 `sessionId` → 交换两个槽位的 `{sessionId, terminalRecovery}`
    6. target 为空 → 把 source 的 `{sessionId, terminalRecovery}` 移到 target，source 清空
  - 保持 tree 结构零改动，不碰 slot 增删，不碰 ratio。
- 保留 `bindSessionToTiledPaneSlot(...)` 现有职责：
  - 点击式“绑定到空窗格”
  - 异步新建 / 恢复回填
  - 不把“拖拽换位”的双槽位语义硬塞进去

### 2.2 验证

```powershell
npx vitest run tests/unit/ui/agent-hub/tiled-pane-tree.test.ts
```

---

## 步骤 3：在 `AgentsPage` 加一条树模式专用拖拽动作

### 3.1 改动

- 修改 `src/ui/app/pages/AgentsPage.tsx`
  - 在 `bindSessionToTiledSlot(...)` 附近新增拖拽专用动作，例如：
    - `moveSessionBetweenTiledSlots(sourceSlotId, targetSlotId)`
    - 或 `reorderTiledSessionBindings(...)`
  - 该动作只负责“当前活动布局内两个既有槽位之间”的 move / swap：
    - `setTiledPaneSlots(prev => helper(...))`
    - `setTiledFocusedSlotId(targetSlotId)`
  - 不要对拖拽路径复用 `setTiledPaneOrder(...)`，因为那条路径对应旧网格 `paneOrder`，而当前树模式的真实 source of truth 是 `tiledPaneSlots + tiledPaneTree`。
  - 拖拽 guard：
    - target 不是当前布局槽位 → 忽略
    - source 不是 live session 槽位 → 忽略
    - target 槽位处于 `creating` → 忽略
    - target 是 disconnected / recoverable placeholder → 第一轮按无效目标处理
  - 不把 move / swap 结果写进 `tiledUnassignedSessionIds`：
    - 槽位间移动或交换不是“解绑回池”
    - 回池仍只属于 `clearTiledSlot(...)` / `closeTiledSlot(...)`
  - 不额外新增一条“手工持久化”路径，依赖现有 `buildCurrentTiledLayoutSnapshot(...)` + `writeAgentsTiledWorkbenchPersistState(...)` 副作用链路承接结果即可。

### 3.2 验证

```powershell
npx vitest run tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx
```

最少补一个场景：

- `slot-1(session-a)` 拖到 `slot-2(empty)` → `slot-1` 变空、`slot-2` 变 `session-a`
- `slot-1(session-a)` 拖到 `slot-2(session-b)` → 两者换位

---

## 步骤 4：把树模式头部拖拽真正接到 `TiledGrid`

### 4.1 改动

- 修改 `src/ui/app/pages/agents/TiledGrid.tsx`
  - `PaneTreeGrid(...)` 自己建立一套树模式 DnD context，不要硬套旧的 `SortableContext`。
  - 树模式建议使用：
    - `DndContext`
    - `PointerSensor`
    - `useDraggable`
    - `useDroppable`
  - 不建议沿用 `useSortable`：
    - 树模式不是线性 list reorder
    - drop 结果是 `sourceSlotId -> targetSlotId` 的显式 move / swap，而不是 array index 交换
- source / target 约束：
  - source：只允许 `entry.kind === 'session'` 的 live pane 头部发起拖拽
  - target：
    - `entry.kind === 'session'` → 合法，触发 swap
    - `entry.kind === 'empty'` 且 `slotState` 不为 `creating` → 合法，触发 move
    - `entry.kind === 'disconnected'` / recoverable → 第一轮不作为 drop target
- UI 细节：
  - 不引入新的可见拖拽把手 UI。
  - 拖拽起点限定为 PTY 会话顶栏里“文本与按钮之外的背景区域”，即类似 `Codex … 23m` 这一整条栏的空白 chrome 区域。
  - 允许为了测试给现有顶栏容器补 `data-testid` 或属性标记，但不能新增用户可见控件。
  - 新增 `data-testid`：
    - `tiled-slot-header-${slotId}`（现有顶栏容器）
    - `tiled-slot-drop-target-${slotId}`（或等价状态标记）
  - drop target 高亮只出现在合法目标上
  - 拖拽中不改变 split handle、pane body、terminal content 区的交互语义
  - activation constraint 继续使用“至少 8px 再算拖拽”，避免与点击聚焦冲突
- 空窗格继续保留现有按钮式入口：
  - `新建终端`
  - `绑定 xxx`
  - 这批不把 `unassignedSessions` 池也做成拖拽源

### 4.2 验证

```powershell
npx vitest run tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx
```

如补浏览器级测试，再跑：

```powershell
npx playwright test tests/e2e/agents-page.tiled-drag.issue871.test.ts -c tests/e2e/playwright.issue871.config.ts
```

---

## 步骤 5：收验证闭环，确认持久化与非目标边界

### 5.1 改动

- 自动化验证至少覆盖 4 类场景：
  1. occupied -> empty move
  2. occupied -> occupied swap
  3. 非法目标无效（source 空、target creating、target disconnected）
  4. reload / remount 后布局保持
- 优先新增浏览器级验证：
  - `tests/e2e/agents-page.tiled-drag.issue871.test.ts`
  - 本地通过 `localStorage` 预置 tiled state，沿用 Agent Hub 的 mock runtime 思路
  - 验证 drag 后 UI 可见顺序与 reload 后的持久化结果
- 需要单独 Playwright 配置时，新增：
  - `tests/e2e/playwright.issue871.config.ts`
  - 端口策略参照已有 `playwright.issue777.config.ts`

### 5.2 验证

```powershell
npx tsc --noEmit
npx vitest run tests/unit/ui/agent-hub/tiled-pane-tree.test.ts tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx
npx playwright test tests/e2e/agents-page.tiled-drag.issue871.test.ts -c tests/e2e/playwright.issue871.config.ts
```

手动烟雾验收：

1. `网络 / 平铺` 打开至少两个 live PTY 窗格和一个空窗格
2. 从 `slot-A` 头部拖到空窗格 → A 被移动，原位变空
3. 从 `slot-A` 头部拖到 `slot-B` → A / B 换位
4. reload 页面 → 布局仍保持
5. split ratio、slotId 数量、未分配会话池内容不因拖拽而异常变化

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
| --- | --- | --- |
| `src/ui/app/pages/agents/tiled-pane-tree.ts` | 新增槽位 move / swap helper，保持 tree 结构不变 | #871 |
| `src/ui/app/pages/AgentsPage.tsx` | 新增树模式拖拽动作与 target guard，复用现有持久化链路 | #871 |
| `src/ui/app/pages/agents/TiledGrid.tsx` | 在 `PaneTreeGrid` 接通头部拖拽、合法 drop target 与高亮反馈 | #871 |
| `tests/unit/ui/agent-hub/tiled-pane-tree.test.ts` | 新增 swap / no-op 契约测试 | #871 |
| `tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx` | 新增树模式头部拖拽 affordance 与合法目标渲染断言 | #871 |
| `tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx` | 新增树模式 move / swap 状态与持久化回归验证 | #871 |
| `tests/e2e/agents-page.tiled-drag.issue871.test.ts` | 浏览器级真实拖拽 smoke / persistence 验证 | #871 |
| `tests/e2e/playwright.issue871.config.ts` | Issue 专用 Playwright 端口与 webServer 配置 | #871 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
| --- | --- |
| 不要修改 `src/ui/app/pages/agents/agents-tiled-persistence.ts` 的 schema / version | 当前拖拽只改现有 `slots` 绑定，没必要扩 schema，避免把简单交互问题升级成持久化迁移 |
| 不要复用 `setTiledPaneOrder(...)` 或旧 `SortableContext` 去硬套树模式 | 旧网格是线性 pane 顺序；树模式真实语义是 slot-to-slot move / swap |
| 不要在同一 patch 中改 `splitTiledSlot(...)`、`resizeTiledSplit(...)` 的行为 | #871 只处理会话位置重排，不处理树结构编辑 |
| 不要把 `unassignedSessions` 池也做成拖拽来源 | 这会把 issue 扩成“会话池 <-> 窗格”双向 DnD，超出本轮范围 |
| 不要修改 `PtyTerminal`、PTY transport、runtime client 协议 | #871 是 UI / workbench binding 语义问题，不是终端传输问题 |
| 不要让拖拽改变 slot 数量、slotId、split ratio 或 layoutId | issue 已明确“只改绑定，不改树结构” |
| 不要在第一轮支持 disconnected / recoverable placeholder 的拖拽 | 先把 live PTY 会话卡片拖拽打通，避免恢复态语义进一步扩散 |

---

## ⚠️ 容易出错的关键点

1. **树模式拖拽的 identity 必须是 `slotId`，不是 `sessionId`。**  
   session 会换位，但 slot 是布局稳定锚点；如果把 drag id 直接设成 sessionId，很容易把 tree mode 错做成旧 grid reorder。

2. **swap 时要连同 `terminalRecovery` 一起交换。**  
   只交换 `sessionId` 而不交换 recovery snapshot，会在 reload 或恢复链路里留下“会话和历史终端身份错位”的脏状态。

3. **树模式拖拽不应该触发“回池”。**  
   `tiledUnassignedSessionIds` 只属于清空 / 关闭语义；move / swap 仍然是“窗格内重排”，不是解绑。

4. **不要重复手写 persistence。**  
   `AgentsPage` 已有基于当前状态快照的持久化副作用；如果拖拽动作再手写一套落盘逻辑，容易出现双写和时序不一致。

5. **`creating` 槽位必须是非法 drop target。**  
   该槽位已经承载“异步新建终端将自动回填到这里”的语义；允许 drop 会导致 pending spawn 与 live session 争抢同一槽位。

6. **拖拽热区是顶栏背景，不是文本节点也不是按钮。**  
   用户说的就是类似 `Codex / 横分 / 纵分 / 清空 / 关闭 / 23m` 这一条栏的空白背景区域；若把文本或按钮也做成拖拽起点，会和选择、点击动作冲突。

7. **旧网格路径不要顺手重构。**  
   当前目标是把树模式接通；旧 `SortablePane` 还能工作，不要把这次修复升级成双路径统一大重构。

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
| --- | --- | --- | --- |
| move 到空窗格 | 从 live session pane 头部拖到 steady empty slot | source 变空、target 绑定该 session、focus 落到 target | #871 |
| swap 到已占用窗格 | 从 `slot-A` 拖到 `slot-B` | `slot-A` / `slot-B` 的 session 对调，树结构不变 | #871 |
| 非法目标保护 | 拖到 `creating` slot 或 disconnected / recoverable pane | 不发生 drop，高亮不出现或 drop 后无状态变化 | #871 |
| reload 保持 | 完成 move / swap 后刷新页面 | `slots` 绑定顺序保持，未分配池不被污染 | #871 |
| 旧操作不回归 | 点击“新建终端”“绑定 xxx”“清空窗格”“关闭窗格” | 现有按钮式语义继续正常 | #871 |

---

## 完成回填

- 当前进度：
  - 已完成第二阶段实现：
    - `src/ui/app/pages/agents/TiledGrid.tsx`
      - 增加 tree-mode pointer capture / release / cleanup 生命周期
      - 增加 hover target 显式状态与坐标命中兜底
      - 增加固定定位 drag preview，按鼠标相对卡片偏移跟随
      - 增加 `pointercancel` / `window blur` 清理，避免全局 no-select 残留
    - `src/index.css`
      - 增加 `body.exomind-tree-pane-dragging` 的 `user-select: none` / `cursor: grabbing`
    - `tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx`
      - 补充失败测试并转绿：
        - activation threshold 前不出现 preview
        - preview 跟手且保持固定偏移
        - hover target 高亮
        - `document.body` no-select class 与 selection 清理
        - `pointercancel` 与 `window blur` 的 cleanup
  - 第二阶段计划已回填到本文档的“步骤 6”
- 已通过验证：
  - `npx vitest run tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx tests/unit/ui/agent-hub/tiled-pane-tree.test.ts`
  - `npx tsc --noEmit`
- 当前未完成项 / 限制：
  - 本回合未完成真实 Tauri 桌面操作复测
  - 原因：当前会话未暴露可用的 Tauri MCP / 桌面自动化入口，无法在代理内执行真实桌面拖拽
- 执行完成后回填：
  - 实际修改文件
  - 通过的验证命令
  - 仍未覆盖的边界
  - 若 E2E 改为手动验证，写明原因与人工证据

---

## 步骤 6：补齐第二阶段体验缺口（鼠标跟随预览 / 固定偏移 / 文本选择屏蔽）

### 6.1 背景与目标

- 第一阶段已经打通：
  - `occupied -> empty = move`
  - `occupied -> occupied = swap`
  - 拖拽起点限定在 PTY 顶栏的非文本、非按钮背景区域
- 最新桌面实测暴露出两个真实缺口：
  - 拖拽中没有跟随鼠标的浮层，用户只能看到源卡片变半透明，不够直观
  - 一旦进入拖拽，仍可能触发顶栏文本选择，和系统桌面图标/窗口拖拽体验不一致
- 第二阶段目标：
  - 浮层跟随鼠标移动
  - 鼠标在浮层中的相对位置保持恒定
  - 拖拽一旦激活，就屏蔽文本选择并在收尾时清理
  - 合法目标继续保留 hover 高亮，且不引入新的可见拖拽把手 UI

### 6.2 失败测试约束

- 修改 `tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx`
  - 新增“未超过 activation distance 时不出现 drag preview，也不加 body dragging class”的保护测试
  - 新增“超过 activation distance 后出现 drag preview，且 preview 的位置按 `clientX - offsetX` / `clientY - offsetY` 计算”的失败测试
  - 新增“拖拽激活后给 `document.body` 加 no-select class，并调用 `window.getSelection()?.removeAllRanges()`；结束或 cancel 后清理”的失败测试
  - 新增“合法目标 hover 时出现高亮；pointercancel 时不触发 move 且清理 preview / class / hover”的失败测试
- 这些测试必须在当前实现下失败，确保后续实现不是只保留 move/swap 语义，而是真正满足交互约束

### 6.3 实现策略

- 继续聚焦 `src/ui/app/pages/agents/TiledGrid.tsx`
  - 将树模式拖拽状态从“只有 `dragSourceSlotId`”扩成“拖拽会话 ref + 渲染态 state”双层模型：
    - ref 负责 pointerId、sourceSlotId、sourceRect、pointerOffset、sourceElement、hoverTarget
    - state 负责 preview 可视位置、hover 高亮和源卡片视觉状态
  - `pointerdown` 时记录 source pane rect，而不是只记 header 起点
  - 激活拖拽后：
    - `previewLeft = clientX - pointerOffsetX`
    - `previewTop = clientY - pointerOffsetY`
    - 渲染固定定位 preview 浮层
    - 给 `document.body` 加统一 dragging class
    - 调用 `window.getSelection()?.removeAllRanges()`
    - 在后续 `pointermove` 上 `preventDefault()`，阻断文本选择继续发生
  - hover target 命中改成：
    - 优先 `document.elementFromPoint(clientX, clientY)`
    - 测试环境 / 兜底退回 `event.target`
    - 再经过“source 不能是自己 / disconnected 不合法 / creating empty 不合法”的语义过滤
  - `pointerup` / `pointercancel` 收尾：
    - release pointer capture
    - 清 preview / hover / body class
    - 仅在非 cancel 且有合法 target 时触发现有 `onMoveSessionBetweenSlots`
- 修改 `src/index.css`
  - 新增树模式拖拽中的 body 级 `user-select: none` / `cursor: grabbing` 规则

### 6.4 验证

```powershell
npx vitest run tests/unit/ui/agent-hub/tiled-grid.tree-mode.test.tsx tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx
```

桌面复测重点：

1. 从 PTY 顶栏空白 chrome 拖动时，预览卡片立即跟手
2. 鼠标相对卡片的位置在整个拖拽过程中保持不变
3. 拖拽开始后不会选中标题、元信息或 badge 文本
4. 拖到空窗格仍是 move，拖到已占用窗格仍是 swap
5. `pointercancel`、拖回原槽位、非法目标等场景不会留下 hover / no-select 脏状态
