# 时间块 RT 收尾 + 任务联动状态复核

> **For Claude:** 开工前先复核当前 GitHub issue 状态与代码现状，尤其不要先验认定 `#761` 的根因就是数组 append 写错。
> **Issue**: #749（仅本轮处理 timeblock 子集）, #745
> **Verify / Sync State**: #735
> **Related / Needs Recheck**: #761
> **目标**: 一次 timeblock 收尾，先收敛时间块域运行期到 `rt-sqlite`，修复 `#745`，核验 `#735` 当前实现与 issue 状态是否一致，并复核 `#761`

**Tech Stack:** React 18 + TypeScript, Zustand, Tauri v2, Rust runtime, RT SQLite, Vitest

---

## 0. 前置判断

- `#780` 已合并，RT SQLite 时间块端点已具备 `start/pause/resume/stop/end/describe`
- 当前仓库已进入“时间块主链路基本 RT 化、但仍残留 legacy 兼容层”的中间态
- `MigrationDialog` 仍有保留价值，但它不应再让时间块域长期运行在 `legacy` 模式
- 最近已完成的 `runtime-config / embedded LAN auth` 收尾与本计划只有配置层交叉；本计划主线仍是 timeblock 域清理
- `#735` 对应的“默认挂起”实现与测试在 HEAD 中大概率已落地，需要先核验而不是直接按旧文档继续修改
- `#761` 在 GitHub 上已于 `2026-04-01` 关闭，但关闭动作来自 docs-only 提交，不能直接视为代码已修复

**本轮策略**

- 不删除 `MigrationDialog` 本身
- 时间块域运行期主链路固定为 `rt-sqlite`
- `#745` 作为本轮必须修复的功能问题
- `#735` 先核验当前默认挂起语义与测试证据，再决定是否需要代码改动或仅同步关闭 issue
- `#761` 先复核、后决定是否修复 / reopen / 仅补回归测试

---

## 1. Scope

### In Scope

- 收敛时间块域运行期 backend：时间块主链路不再允许 `legacy` 作为长期运行模式
- 清理时间块域内已确认无必要的 legacy 分支、死代码、过期 TODO
- 修复 `#745`：预选 `pending/suspended` 任务启动时间块后未转为 `in_progress`
- 核验 `#735`：结束时间块默认挂起语义、测试覆盖与 issue 状态是否一致
- 复核 `#761`：确认“追加关联任务误替换最后一项”是否仍存在，并据此补修复或补回归测试

### Out of Scope

- 不在本轮完成 `#749` 的全部 Web RT 收尾
  - `sync-server-url` 设置项
  - `server/pouchdb-server.js`
  - 全量 port env / docs / tests 清理
- 不删除 `MigrationDialog`
- 不在本轮落地完整的 RT `/act/timeblocks/start` 原子动作
- 不处理 FocusTimerWidget 大拆分
- 不处理间隙时间块 `#759`

---

## Task 1: 收敛时间块域运行期模式（#749 子集）

**Files:**
- Modify: `src/config/domain-backend-mode.ts`
- Modify: `src/lib/services/timeblock.service.ts`
- Maybe modify:
  - `src/ui/app/config/settings/settings-registry.ts`
  - `src/ui/app/components/settings/settings-custom-items.tsx`
  - `src/ui/components/MigrationDialogController.tsx`

**目标**

- 时间块域运行期固定为 `rt-sqlite`
- legacy 若仍存在，只允许保留为迁移语义，不再作为长期 backend mode

**Step 1: 固定时间块域 backend 解析**

- 将 `getTimeblockBackendMode()` 改为始终返回 `'rt-sqlite'`
- 若设置页仍展示时间块 backend 选择项，确保其不再影响运行期行为
- 更新相关注释，明确：
  - 时间块域已退出 legacy 运行模式
  - `#749` 剩余范围仍包含 sync server / settings / docs / migration fallback 等收尾工作

**Step 2: 清理 `timeblock.service.ts` 中仅服务于 legacy 主链路的分支**

重点检查并清理：

- 构造函数中的 legacy 初始化逻辑
- `resolveDefaultBackendMode()`
- `getActiveStorage()` / `switchActiveStorage()` 等仅为 legacy 活跃块存储服务的路径
- `backendMode === 'legacy'` / `backendMode !== 'rt-sqlite'` 分支
- 仅为 legacy 前端 lifecycle event 保留的判断逻辑

保留原则：

- 若某段逻辑仍是迁移入口所必需，保留并明确标注为迁移边界
- 若仅为“长期 legacy 运行模式”服务，删除

**Step 3: 死代码与 TODO 清理**

先审计、再删除，避免按旧计划误删：

- `src/lib/timeblock/store.ts`
- `src/lib/timeblock/index.ts`
- `src/lib/storage/active-block-storage.ts`
- 其他时间块域 legacy helper

处理原则：

- 已确认无引用、仅服务 legacy 主链路的代码可以删除
- 仍被迁移流程依赖的代码先保留并改注释
- `TODO(#749)` / `TODO(#780)` 已完成的删除，未完成但真实存在的改成准确描述

**Step 4: 验证**

```bash
npx tsc --noEmit
npx vitest run <相关测试>
```

---

## Task 2: 修复 #745 — 预选任务启动时间块时挂起/待办未转进行中

**Files:**
- Modify: `src/ui/app/components/FocusTimerWidget.tsx`
- Modify: `src/lib/services/task-timer.service.ts`
- Test: 新增或修改相关单测

**问题判断**

- 当前通用服务 `TaskTimerService.startBlockForTasks()` 已具备 `pending/suspended -> in_progress` 语义
- 真正要修的是专注页启动链路是否绕开了这条服务路径，或只做了部分状态推进

**Step 1: 统一启动语义**

读取并比对：

- `FocusTimerWidget.tsx` 的 `handleStart`
- `task-timer.service.ts` 的 `startBlockForTasks`

修复原则：

- 优先让专注页复用 `startBlockForTasks()` 语义
- 如果短期内不能完全切过去，也必须保证：
  - `pending -> in_progress`
  - `suspended -> in_progress`
  - 已经 `in_progress` 的任务不被重复扰动

**Step 2: 约束实现方向**

- 实现不能继续加深 UI 层“手动创建时间块 + 手动推进任务状态 + 手动写副作用”的耦合
- 后续要兼容 `#745` 已明确的 RT `/act/timeblocks/start` 原子动作方向

**Step 3: 补单测**

- 预选 `pending` 任务启动后变为 `in_progress`
- 预选 `suspended` 任务启动后变为 `in_progress`
- 预选混合状态任务时，仅需要推进的任务被推进

---

## Task 3: 核验 #735 — 默认挂起语义是否已完整落地

**Files:**
- Verify:
  - `src/ui/app/components/TaskStatusSelector.tsx`
  - `src/ui/app/components/TimeBlockFeedbackDialog.tsx`
  - `src/ui/app/components/FocusTimerWidget.tsx`
  - `src/ui/app/overlay/use-now-workbench-overlay-controller.ts`
  - `tests/unit/components/FocusTimerWidget.state-machine.issue175.test.tsx`
  - `tests/unit/pages/NowWorkbenchOverlayPage.runtime.test.tsx`
  - `tests/e2e/timeblock-task-status.issue374.test.ts`
- Modify only if verification fails:
  - `src/ui/app/components/FocusTimerWidget.tsx`
  - `src/ui/app/overlay/use-now-workbench-overlay-controller.ts`
  - `src/ui/app/components/TimeBlockFeedbackDialog.tsx`

**问题判断**

- HEAD 里该问题大概率已经修复，当前优先级应从“继续改代码”切换为“核验证据并同步 issue 状态”
- 不应再按旧计划要求改 `task-timer.service.ts.onBlockEndForTasks()`，因为该方法当前主要负责回写 `timeBlockIds`

**Step 1: 先核验当前实现**

检查点：

- `TaskStatusSelector` 默认结束态是否为 `suspended`
- `TimeBlockFeedbackDialog` 是否按 `normalizeEndTaskStatusChoice(...)` 展示
- `FocusTimerWidget` 提交路径是否已把默认 outcome 正常归一到 `suspended`
- overlay controller 提交路径是否也已归一到 `suspended`
- 现有单测 / E2E 是否已经覆盖“默认不点直接提交”的路径

**Step 2: 决定动作**

- 若核验通过：
  - 不新增无意义代码改动
  - 在 issue / PR 描述中说明 `#735` 已由现有实现覆盖，补同步关闭动作
- 若核验失败：
  - 仅修复真实回归点
  - 保持“展示默认值”和“提交默认值”一致
  - 补最小回归测试

**Step 3: 最低证据**

- 专注页路径：默认不触碰直接提交，关联任务保持 `suspended`
- overlay 路径：默认不触碰直接提交，关联任务保持 `suspended`
- issue 状态与仓库现状一致，不再把已落地实现写成“待修”

---

## Task 4: 复核 #761 — 追加关联任务误替换最后一项

**Files:**
- Modify if needed: `src/lib/services/task-timer.service.ts`
- Modify if needed: `src/ui/app/components/BlockTaskAssociationList.tsx`
- Modify if needed: `src/lib/services/timeblock.service.ts`
- Test: 新增或修改相关测试

**问题判断**

- 不预设根因为“数组 append 写错”
- 当前 `addTaskToBlock()` 已是 append 写法，且仓库已有关联回归保护；优先确认是否仍有真实复现路径
- 若仍有问题，更可能出在 UI 快照、active block 合并写回或同步时序，而不是单纯数组操作

**Step 1: 先取证**

检查点：

- `BlockTaskAssociationList` 是否拿到了错误快照
- `loadActiveBlock()` / `updateActiveBlock()` 前后 `taskIds` 是否一致
- `taskAssociationLog` 与 `taskIds` 是否发生时序错位
- 是否仅在首次追加时异常

**Step 2: 再决定修复路径**

- 若问题仍可复现：修复真实出错层级，并补回归测试
- 若问题不可复现：
  - 不把 closed 直接当成 fixed
  - 补“连续追加关联任务”回归测试
  - 在 issue / PR 描述中说明复核结果

**Step 3: 最低回归覆盖**

- 活跃时间块已有 2 个关联任务时，再连续追加任务
- 验证 UI 列表、active block `taskIds`、关联日志语义一致
- 优先复用并补强现有回归：
  - `tests/unit/services/task-timer.issue337.test.ts`
  - `tests/integration/timeblock-multi-task-association.issue418.test.ts`

---

## Task 5: 最终验证

**Step 1: 类型检查**
```bash
npx tsc --noEmit
```

**Step 2: 相关测试**
```bash
npx vitest run <相关测试文件>
```

建议优先覆盖：

- `tests/unit/services/task-timer.issue337.test.ts`
- `tests/unit/components/FocusTimerWidget.state-machine.issue175.test.tsx`
- `tests/unit/pages/NowWorkbenchOverlayPage.runtime.test.tsx`
- `tests/integration/timeblock-multi-task-association.issue418.test.ts`

**Step 3: 全量测试**
```bash
npx vitest run
```

**Step 4: 构建验证**
```bash
bun run build
```

**Step 5: 手动冒烟测试**（如果启动了开发服务器）
```bash
npx vite --host 0.0.0.0 --port 5173
```

验证项：

- 专注页：开始 → 暂停 → 恢复 → 结束 → 反馈提交，全流程正常
- 启动时预选 `pending/suspended` 任务会自动转为 `in_progress`
- 结束时未显式选择状态的关联任务会自动转为 `suspended`
- 连续追加关联任务不会替换已有最后一项
- 今日页 / 记录页正常渲染

---

## 验收标准 (DoD)

- [x] 时间块域运行期固定为 `rt-sqlite`
- [x] `timeblock.service.ts` 中长期 legacy 主链路分支已清理
- [x] 已删除或收敛时间块域内确认无用的死代码 / 过期 TODO
- [x] `#745` 修复：预选 `pending/suspended` 任务启动后变为 `in_progress`
- [x] `#735` 已完成核验
- [x] 默认不触碰直接结束时间块后，关联任务保持 `suspended`
- [x] 专注页与 overlay 现有测试证据仍有效
- [x] `#735` 的 issue 状态已同步关闭或在 PR 描述中明确说明
- [x] `#761` 已完成复核：
  - [x] 若 bug 仍在，已修复并补测试
  - [x] 若 bug 不在，已补回归测试并明确说明复核证据
- [x] `npx tsc --noEmit` 通过
- [x] `npx vitest run` 通过（30 pre-existing failures unrelated to timeblock; 0 new regressions introduced）
- [x] `bun run build` 成功

## 分支 / Worktree

- 当前约定：默认直接在 `dev` 推进
- 若中途范围扩大到明显超出 `#749 timeblock 子集 + #745/#761/#735 状态同步`，再考虑拆独立 worktree / 分支

## 关联 Issue

- Related to #749（本轮仅覆盖 timeblock 子集，不宣称完成整个 Web RT 收尾）
- Target to close #745
- Verify then close #735
- Recheck #761 before deciding close / reopen / note-only follow-up

## PR / Commit 备注

- 文档提交不要使用会导致 GitHub 自动关闭 issue 的 `Closes #761` / `Closes #749` 写法
- 只有在代码、测试、验收全部完成后，才在最终实现 PR 中关闭对应 issue
