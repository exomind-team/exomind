# 时间块功能清理 + Bug 修复

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Issue**: #749 (Tauri migration), #761, #745, #735
> **目标**: 一个 PR，三件事——强制 rt-sqlite、修三个 bug、清除死代码

**Tech Stack:** React 18 + TypeScript, Zustand, Tauri v2, Rust runtime, RT SQLite, Vitest

---

## 0. 前置判断

#780 已合并，RT SQLite 时间块端点全部就绪（start/pause/resume/stop/end/describe）。
Tauri 桌面端已经默认走 rt-sqlite。legacy 路径只在 MigrationDialog 跳过时触发。

**本轮策略**: 不删除 MigrationDialog（它仍保护有旧数据的用户），但一旦迁移完成就**锁死 rt-sqlite**，不再允许 `backendMode = 'legacy'` 在时间块域生效。

---

## 1. Scope

### In Scope

- 强制时间块域 `backendMode = 'rt-sqlite'`，移除 legacy 分支代码
- 修复 #761（追加关联任务误替换）
- 修复 #745（预选任务启动时挂起未转进行中）
- 修复 #735（结束时未挂起关联任务）
- 删除死代码（Zustand store、deleteActiveBlock stubs）
- 清理 TODO(#749) / TODO(#780) 标记

### Out of Scope

- PouchDB 全域移除（eventlog、reminder 仍用 PouchDB，那是同步计划的范围）
- MigrationDialog 删除（保留，但迁移后时间块强制 rt-sqlite）
- FocusTimerWidget 拆分（单独 PR）
- 间隙时间块 #759（设计尚未定稿）

---

## Task 1: 强制时间块域 rt-sqlite 模式

**Files:**
- Modify: `src/config/domain-backend-mode.ts`
- Modify: `src/lib/services/timeblock.service.ts`

**Step 1: 修改 `domain-backend-mode.ts`**

新增函数（或修改已有函数）使时间块域始终返回 `'rt-sqlite'`：

```typescript
// 时间块域不再支持 legacy 模式
// MigrationDialog 仍可能暂时将全局设为 legacy，
// 但时间块域忽略该设置，始终用 rt-sqlite
export function getTimeblockBackendMode(): DomainBackendMode {
  return 'rt-sqlite';
}
```

如果 `getTimeblockBackendMode` 已存在且读配置，改为直接返回 `'rt-sqlite'`。

更新 TODO 注释，标注 #749 时间块部分已完成，剩余域（eventlog/task/reminder）待后续清理。

**Step 2: 清理 `timeblock.service.ts` 的 legacy 分支**

逐一处理文件中所有 `if (this.backendMode...)` 分支（约 17 处）：

策略：
- `if (this.backendMode === 'rt-sqlite' && this.rtAdapter)` → 移除条件，保留 body（因为始终为 true）
- `if (this.backendMode !== 'rt-sqlite')` → 移除整个 if block（legacy 路径）
- `if (this.backendMode === 'legacy')` → 移除整个 if block

具体：
- 构造函数中移除 `switchActiveStorage()` 调用（legacy 初始化）
- `startBlock()` 方法移除 legacy 手动构建 ActiveBlockData 的路径
- `pauseBlock()` / `resumeBlock()` 移除 legacy 路径
- `markEnding()` 移除 legacy 路径
- `endBlock()` 移除 legacy 路径
- `loadCompletedBlocks()` 移除 legacy 查询路径
- `applyReplicatedActiveBlock()` 移除 legacy 存储路径
- `resolveDefaultBackendMode()` 简化为始终返回 `'rt-sqlite'`

**预期效果**: timeblock.service.ts 减少约 200-300 行。

**Step 3: 验证**

```bash
npx tsc --noEmit
npx vitest run --reporter=verbose 2>&1 | head -100
```

确保无类型错误，现有测试通过。

---

## Task 2: 删除死代码

**Files:**
- Delete: `src/lib/timeblock/store.ts`
- Modify: `src/lib/services/timeblock.service.ts` (deleteActiveBlock)
- Modify: `src/lib/adapters/timeblock-rt-adapter.ts` (deleteActiveBlock)

**Step 1: 删除 Zustand store**

```bash
rm src/lib/timeblock/store.ts
```

搜索确认无残留导入：
```bash
grep -r "timeblock/store\|timeblockStore\|useTimeBlockStore" src/
```
如果有导入，一并删除。

**Step 2: 移除 deleteActiveBlock 方法**

从 `TimeBlockService` 接口和 `TimeBlockServiceImpl` 类中删除 `deleteActiveBlock()` 方法声明和实现。
从 `TimeBlockRtAdapter` 中删除 `deleteActiveBlock()` 方法。

搜索确认无调用：
```bash
grep -r "deleteActiveBlock" src/
```

**Step 3: 清理 TODO 注释**

搜索所有 `TODO(#780)` 和 `TODO(#749)` 注释：
- 已完成的 TODO → 删除注释
- 未完成但本轮处理的 → 删除注释
- 不在本轮范围内的 → 更新注释说明剩余工作

**Step 4: 验证**

```bash
npx tsc --noEmit
npx vitest run
```

---

## Task 3: 修复 #761 — 追加关联任务误替换最后一项

**Files:**
- Modify: `src/lib/services/task-timer.service.ts`
- Modify: `src/ui/app/components/BlockTaskAssociationList.tsx`
- Test: 新增或修改相关单测

**分析**: Bug 的根因是追加任务到正在运行的时间块时，`taskIds` 数组操作有问题——不是 push 而是替换了最后一项。

**Step 1: 定位 bug**

读取 `task-timer.service.ts` 中 `addTaskToBlock()` 方法：
- 检查 `taskIds` 数组是否正确使用 `[...existing, newId]` 而非 `existing[existing.length - 1] = newId`
- 检查 `BlockTaskAssociationList.tsx` 中的 `handleAddTask` 是否正确传递

**Step 2: 修复**

确保 `addTaskToBlock()` 使用扩展运算符追加：
```typescript
const updatedTaskIds = [...currentBlock.taskIds, taskId];
```

而非任何形式的替换。

**Step 3: 补单测**

在对应测试文件中新增用例：
- 时间块有 2 个关联任务 → 追加第 3 个 → 验证 taskIds 长度为 3
- 验证 taskAssociationLog 正确记录 association 事件

---

## Task 4: 修复 #745 — 预选任务启动时挂起任务未转为进行中

**Files:**
- Modify: `src/ui/app/components/FocusTimerWidget.tsx` (handleStart 方法)
- Modify: `src/lib/services/task-timer.service.ts` (startBlockForTasks 方法)
- Test: 新增单测

**分析**: 用户在启动时间块前预选了几个任务（状态为 suspended/pending），点击"开始"后任务应自动转为 in_progress，但没有。

**Step 1: 定位 bug**

读取 `FocusTimerWidget.tsx` 的 `handleStart` 方法（约 line 473-516）：
- 检查 `filteredTaskIds` 筛选逻辑
- 检查是否调用了任务状态转换

读取 `task-timer.service.ts` 的 `startBlockForTasks` 方法（约 line 64-107）：
- 检查启动时是否对每个预选任务调用 `transitionTask(taskId, 'in_progress')`

**Step 2: 修复**

在 `startBlockForTasks()` 中，启动时间块后，对所有预选任务调用状态转换：

```typescript
for (const taskId of taskIds) {
  const task = await taskAdapter.getTask(taskId);
  if (task && ['pending', 'suspended'].includes(task.status)) {
    await taskAdapter.transitionTask(taskId, 'in_progress');
  }
}
```

**Step 3: 补单测**

- 预选 2 个 suspended 任务 → 启动时间块 → 验证两个任务状态为 in_progress
- 预选 1 个 in_progress + 1 个 pending → 启动 → 验证 pending 变为 in_progress，in_progress 不变

---

## Task 5: 修复 #735 — 结束时间块时未挂起关联任务

**Files:**
- Modify: `src/ui/app/components/TimeBlockFeedbackDialog.tsx`
- Modify: `src/lib/services/task-timer.service.ts` (onBlockEndForTasks 方法)
- Test: 新增单测

**分析**: 用户结束时间块时，反馈对话框让用户选择每个任务的最终状态（完成/取消/挂起）。但如果用户不做选择就提交，in_progress 任务会保持进行中——成为"幽灵任务"。

**Step 1: 定位 bug**

读取 `TimeBlockFeedbackDialog.tsx` 的提交逻辑：
- 检查 `taskStatusOutcomes` 的默认值
- 检查未选择时是否有兜底

读取 `task-timer.service.ts` 的 `onBlockEndForTasks` 方法：
- 检查未在 outcomes 中出现的任务如何处理

**Step 2: 修复**

在 `onBlockEndForTasks()` 中，对所有关联任务但未出现在 `taskStatusOutcomes` 中的 in_progress 任务，默认执行 `transitionTask(taskId, 'suspended')`：

```typescript
for (const taskId of associatedTaskIds) {
  const outcome = taskStatusOutcomes?.[taskId];
  if (outcome) {
    // 用户明确选择了状态
    await taskAdapter.transitionTask(taskId, outcome);
  } else {
    // 用户未选择 → 默认挂起（而非保持进行中）
    const task = await taskAdapter.getTask(taskId);
    if (task?.status === 'in_progress') {
      await taskAdapter.transitionTask(taskId, 'suspended');
    }
  }
}
```

**Step 3: 补单测**

- 时间块关联 3 个 in_progress 任务 → 提交反馈（只选了 1 个为 completed）→ 验证另外 2 个变为 suspended
- 时间块关联 1 个 completed 任务 → 提交 → 验证 completed 任务不受影响

---

## Task 6: 最终验证

**Step 1: 全量类型检查**
```bash
npx tsc --noEmit
```

**Step 2: 全量测试**
```bash
npx vitest run
```

**Step 3: 构建验证**
```bash
bun build
```

**Step 4: 手动冒烟测试**（如果启动了开发服务器）
```bash
npx vite --host 0.0.0.0 --port 5173
```

验证项：
- 专注 tab：开始 → 暂停 → 恢复 → 结束 → 反馈提交，全流程正常
- 任务关联：启动时预选任务自动变 in_progress
- 结束时未选状态的任务自动 suspended
- 追加任务不会替换已有任务
- 今日 tab 和记录 tab 正常渲染

---

## 验收标准 (DoD)

- [ ] `npx tsc --noEmit` 通过
- [ ] `npx vitest run` 全部通过（含新增单测）
- [ ] `bun build` 成功
- [ ] `src/lib/timeblock/store.ts` 已删除
- [ ] `deleteActiveBlock()` 已从接口和实现中移除
- [ ] `timeblock.service.ts` 中无 `backendMode === 'legacy'` 分支
- [ ] #761 修复：追加第 N 个任务不影响前 N-1 个
- [ ] #745 修复：预选 pending/suspended 任务启动后变 in_progress
- [ ] #735 修复：结束时间块后无幽灵 in_progress 任务
- [ ] 无新增 lint 警告

## 分支

```
feature/issue-749-timeblock-cleanup
```

目标合并到 `dev`。

## 关联 Issue

- Closes #749 (时间块域部分)
- Closes #761
- Closes #745
- Closes #735
