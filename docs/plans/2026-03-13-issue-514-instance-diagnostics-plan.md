# Issue 514 Instance Diagnostics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为开发态多实例提供“窗口标题快速辨认 + 设置内详细实例诊断信息”，支持显示 branch、Web/RT/MCP 端口、worktree 名、PID，以及关键环境变量是否已配置。

**Architecture:** 前端新增一个 `dev-instance-diagnostics` 配置模块，统一组装 branch、worktree、端口、环境变量状态等实例元数据；Tauri 端补一个只返回安全白名单诊断信息的命令用于 PID 和运行时环境变量存在性；App 层新增开发态标题同步，设置页开发者分组新增一个自定义条目，点击后用桌面对话框 / 移动端抽屉展示详细诊断信息。

**Tech Stack:** React 18, TypeScript, Vitest, Vite, Tauri v2, Rust commands, localStorage-backed developer mode

---

### Task 1: 建立开发态实例诊断模型

**Files:**
- Create: `src/config/dev-instance-diagnostics.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `vite.config.ts`
- Test: `tests/unit/config/dev-instance-diagnostics.test.ts`

**Step 1: Write the failing test**

- 覆盖：
  - branch / worktree / Web / RT / MCP 端口的组合与默认值
  - 敏感环境变量只输出 `configured / missing`
  - 标题格式为 `ExoMind [branch] [Web:x RT:y]`

**Step 2: Run test to verify it fails**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/config/dev-instance-diagnostics.test.ts`

Expected: FAIL because the diagnostics module does not exist yet.

**Step 3: Write minimal implementation**

- 在 `vite.config.ts` 注入开发态实例元数据：
  - 当前 branch
  - worktree 名 / 目录名
  - Web / HMR / RT / MCP 端口
  - 非敏感环境变量值
  - 敏感 key 的存在性布尔值

**Step 4: Run test to verify it passes**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/config/dev-instance-diagnostics.test.ts`

Expected: PASS

### Task 2: 增加 Tauri 运行时实例诊断命令

**Files:**
- Create: `src-tauri/src/commands/dev_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/unit/tauri/dev-instance-diagnostics-command.test.ts`

**Step 1: Write the failing test**

- 覆盖：
  - 前端通过 `invoke` 读取运行时诊断
  - 只返回白名单字段，不返回敏感值
  - 可读到 `PID`

**Step 2: Run test to verify it fails**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/tauri/dev-instance-diagnostics-command.test.ts`

Expected: FAIL because the command does not exist yet.

**Step 3: Write minimal implementation**

- Rust 命令返回：
  - `pid`
  - 运行时 secrets / config env 的 `configured` 布尔值

**Step 4: Run test to verify it passes**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/tauri/dev-instance-diagnostics-command.test.ts`

Expected: PASS

### Task 3: 开发态窗口标题快速辨认

**Files:**
- Create: `src/ui/app/components/DevInstanceTitleSync.tsx`
- Modify: `src/App.tsx`
- Test: `tests/unit/app/dev-instance-title-sync.test.tsx`

**Step 1: Write the failing test**

- 覆盖：
  - dev 模式下生成 `ExoMind [branch] [Web:x RT:y]`
  - Tauri 下调用当前窗口 `setTitle`
  - Web 下同步 `document.title`
  - production 下不污染普通用户标题

**Step 2: Run test to verify it fails**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/app/dev-instance-title-sync.test.tsx`

Expected: FAIL because title sync component does not exist yet.

**Step 3: Write minimal implementation**

- App 挂载标题同步组件
- 仅在开发态启用

**Step 4: Run test to verify it passes**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/app/dev-instance-title-sync.test.tsx`

Expected: PASS

### Task 4: 设置页开发者分组新增实例诊断入口

**Files:**
- Modify: `src/ui/app/components/settings/settings-custom-items.tsx`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `tests/unit/components/settings/setup-settings-mocks.tsx`
- Create: `tests/unit/settings/settings-instance-diagnostics.issue514.test.tsx`

**Step 1: Write the failing test**

- 覆盖：
  - 开发者模式下出现 `实例诊断信息` 条目
  - 点击后打开桌面 `Dialog` / 移动 `Drawer`
  - 可见 `branch / Web / RT / MCP / worktree / PID`
  - 环境变量只显示“已配置 / 未配置”

**Step 2: Run test to verify it fails**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/settings/settings-instance-diagnostics.issue514.test.tsx`

Expected: FAIL because the diagnostics entry does not exist yet.

**Step 3: Write minimal implementation**

- 新增 `DevInstanceDiagnosticsSetting`
- 归入 `developer` 分类
- 桌面大弹窗 / 移动抽屉展示详细信息

**Step 4: Run test to verify it passes**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/settings/settings-instance-diagnostics.issue514.test.tsx`

Expected: PASS

### Task 5: 回归验证

**Files:**
- Test: `tests/unit/config/dev-instance-diagnostics.test.ts`
- Test: `tests/unit/tauri/dev-instance-diagnostics-command.test.ts`
- Test: `tests/unit/app/dev-instance-title-sync.test.tsx`
- Test: `tests/unit/settings/settings-instance-diagnostics.issue514.test.tsx`

**Step 1: Run targeted verification**

Run: `& '..\\..\\node_modules\\.bin\\vitest.exe' run tests/unit/config/dev-instance-diagnostics.test.ts tests/unit/tauri/dev-instance-diagnostics-command.test.ts tests/unit/app/dev-instance-title-sync.test.tsx tests/unit/settings/settings-instance-diagnostics.issue514.test.tsx`

Expected: PASS

**Step 2: Run typecheck**

Run: `& '..\\..\\node_modules\\.bin\\tsc.exe' --noEmit`

Expected: PASS

**Step 3: Run Rust check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS
