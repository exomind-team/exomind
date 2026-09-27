# Issue #776 Windows Dev Instance Isolation Implementation Plan

> **For Claude / Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or equivalent disciplined execution workflow to implement this plan task-by-task.

**Goal:** 修复 Windows 下多个 worktree / manager 启动的 Tauri dev 实例共享 `WebView2 data dir（WebView2 数据目录）`、`app data dir（应用数据目录）`、`runtime dir（运行时目录）` 导致的白屏、窗口串状态、实例互相污染问题。

**Architecture:** 本次只做 `dev-only instance isolation（仅开发态实例隔离）`，不改发布版 `identifier`，也不提前重构 `config / sqlite（配置 / SQLite）` 模块。由 `tauri-wrapper.ps1` 计算实例专属目录并注入环境变量；Tauri 主窗口和 overlay 显式落到实例级目录；Rust 侧统一从实例级 `app data / runtime` 读写；首次启动新实例目录时，从旧共享 runtime 目录做一次性 `seed / bootstrap copy（播种 / 首次复制）`。播种只复制用户数据快照，不复制 `device_id` 这类逻辑实例身份。

**Tech Stack:** PowerShell, Bun, TypeScript, Tauri v2, Rust, WebView2

---

## Scope Guardrails（范围护栏）

1. 只解决 `#776` 根因：Windows 多实例共享目录。
2. 不在本次 PR 中合入或预实现 `PR758 / issue-756` 的大规模 `config.sqlite` 迁移。
3. 允许为后续 `config.sqlite` 接入预留扩展点，但当前不依赖它。
4. 不修复与 `#776` 无关的仓库基线 `tsc` 红灯；验证以目标测试与真实实例复现为准。

---

### Task 1: 固化实例路径契约（instance path contract，实例路径约定）

**Files:**
- Create: `scripts/dev/tauri-dev-instance-paths.ts`
- Test: `tests/unit/scripts/tauri-dev-instance-paths.test.ts`
- Modify: `scripts/dev/tauri-wrapper.ps1`

**Step 1: 写失败测试**

覆盖这些行为：

1. 同一项目根目录下，不同 `EXOMIND_TAURI_INSTANCE_NAME` 得到不同目录。
2. 返回结构至少包含：
   - `instanceName`
   - `stateRootDir`
   - `webviewMainDataDir`
   - `webviewOverlayDataRoot`
   - `appDataDir`
   - `runtimeDataDir`
   - `legacySharedAppDataDir`
   - `legacySharedRuntimeDir`
   - `mcpBridgeBasePort`
3. `desktop` 与 `issue-773-node-first` 不会映射到相同路径。

**Step 2: 跑测试确认先失败**

Run: `npx vitest run tests/unit/scripts/tauri-dev-instance-paths.test.ts`

Expected: `FAIL`

**Step 3: 最小实现**

让 helper 输出稳定 JSON，目录形态建议为：

```json
{
  "instanceName": "desktop",
  "stateRootDir": "<project>/.tmp/tauri-dev-state/desktop",
  "webviewMainDataDir": "<project>/.tmp/tauri-dev-state/desktop/webview/main",
  "webviewOverlayDataRoot": "<project>/.tmp/tauri-dev-state/desktop/webview/overlay",
  "appDataDir": "<project>/.tmp/tauri-dev-state/desktop/app-data",
  "runtimeDataDir": "<project>/.tmp/tauri-dev-state/desktop/app-data/runtime",
  "legacySharedAppDataDir": "%APPDATA%/com.exomind.app",
  "legacySharedRuntimeDir": "%APPDATA%/com.exomind.app/runtime",
  "mcpBridgeBasePort": 9223
}
```

**Step 4: 测试转绿**

Run: `npx vitest run tests/unit/scripts/tauri-dev-instance-paths.test.ts`

Expected: `PASS`

**Step 5: wrapper 接线**

让 `scripts/dev/tauri-wrapper.ps1` 调用 helper 并设置：

1. `EXOMIND_DEV_INSTANCE_NAME`
2. `EXOMIND_DEV_APP_DATA_DIR`
3. `EXOMIND_DEV_RUNTIME_DATA_DIR`
4. `EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR`
5. `EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT`
6. `EXOMIND_DEV_LEGACY_SHARED_APP_DATA_DIR`
7. `EXOMIND_DEV_LEGACY_SHARED_RUNTIME_DIR`
8. `EXOMIND_MCP_BRIDGE_BASE_PORT`

---

### Task 2: 先补首次播种（seed old runtime once，旧 runtime 首次播种）

**Files:**
- Create: `src-tauri/src/dev_instance_paths.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/dev_instance_paths.rs` 内联测试

**Step 1: 写失败测试**

至少覆盖：

1. 当实例 `runtime` 目录为空、旧共享 `runtime` 存在时，会把允许复制的文件复制过去。
2. 当实例 `runtime` 已有文件时，不会被旧共享目录覆盖。
3. 当前允许复制的文件白名单至少包括：
   - `signal-pool.sqlite`
   - `eventlog.sqlite`
   - `tasks.sqlite`
   - `timeblocks.sqlite`
   - `sessions.sqlite`
   - `runtime-network-mode.json`
   - `runtime-target-mode.json`
4. 未命中白名单的文件不会被盲目整目录拷贝。

**Step 2: 跑 Rust 单测确认先失败**

Run: `cargo test dev_instance_paths --manifest-path src-tauri/Cargo.toml`

Expected: `FAIL`

**Step 3: 最小实现**

新增统一 helper，例如：

```rust
pub fn resolve_instance_app_data_dir(app: &AppHandle) -> Result<PathBuf, String>
pub fn resolve_instance_runtime_dir(app: &AppHandle) -> Result<PathBuf, String>
pub fn seed_instance_runtime_dir_if_needed(runtime_dir: &Path, legacy_runtime_dir: &Path) -> Result<(), String>
```

其中 `seed_instance_runtime_dir_if_needed` 规则：

1. 只在目标 runtime 目录不存在或为空时执行。
2. 只复制白名单文件。
3. 不覆盖目标已有文件。
4. 打日志说明是否 `seeded / skipped（已播种 / 跳过）`。

**Step 4: 单测转绿**

Run: `cargo test dev_instance_paths --manifest-path src-tauri/Cargo.toml`

Expected: `PASS`

**Step 5: Tauri setup 接线**

在 `src-tauri/src/lib.rs` setup 早期：

1. 优先解析实例级 `appDataDir / runtimeDir`
2. 先执行一次播种
3. 再设置 `EXOMIND_RT_DATA_DIR` 与各个 SQLite env path

---

### Task 3: Rust 命令层统一切到实例目录

**Files:**
- Modify: `src-tauri/src/commands/runtime_commands.rs`
- Modify: `src-tauri/src/commands/device_commands.rs`
- Modify: `src-tauri/src/commands/eventlog_commands.rs`
- Modify: `src-tauri/src/commands/file_commands.rs`

**Step 1: 写失败测试或补现有测试**

至少证明这些命令不再直接依赖 `app.path().app_data_dir()` 的共享默认路径，而是走实例级 helper。

**Step 2: 最小实现**

把现有直接调用：

```rust
app.path().app_data_dir()
```

的地方替换为统一 helper。

**Step 3: 跑定向测试**

Run: `cargo test runtime_commands --manifest-path src-tauri/Cargo.toml`

Run: `cargo test eventlog_commands --manifest-path src-tauri/Cargo.toml`

Expected: `PASS` 或无回归

---

### Task 4: 隔离主窗口 / overlay / MCP Bridge

**Files:**
- Modify: `scripts/dev/tauri-wrapper.ps1`
- Modify: `src-tauri/src/commands/shortcut_commands.rs`
- Modify: `src-tauri/src/commands/now_workbench_overlay_commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 写失败测试或脚本级验证**

至少覆盖：

1. 主窗口 `main` 有实例级 `dataDirectory`
2. `voice-overlay`
3. `now-workbench-overlay`

都显式绑定到实例级 data dir

**Step 2: 最小实现**

1. 在 wrapper 生成的临时 Tauri config 中给 `main` 注入 `dataDirectory`
2. 在 overlay builder 上显式加 `.data_directory(...)`
3. MCP Bridge 读取 `EXOMIND_MCP_BRIDGE_BASE_PORT`

**Step 3: 手动真实验证**

启动两个 worktree：

```powershell
bun run tauri:manager -- start --name desktop --web-port 1420 --hmr-port 1421
bun run tauri:manager -- start --name issue-773-node-first --web-port 1430 --hmr-port 1431
```

验证：

1. 两边都能起
2. `msedgewebview2.exe` 的 `--user-data-dir` 不再共用
3. 当前 `dev` 不会因另一边启动而白屏
4. overlay 不再因为共享状态飞到别的实例布局里

---

### Task 5: 计划内评审与验证收口

**Files:**
- Modify: `docs/plans/2026-03-30-issue-776-windows-dev-instance-isolation-plan.md`
- Optional: `docs/issues` / PR 描述草稿

**Step 1: 自查 diff**

重点检查：

1. 没有把 `PR758 / issue-756` 的大范围 config 改造带进来
2. 没有修改发布版 `identifier`
3. 没有引入对其他 worktree 进程的清理逻辑

**Step 2: 运行 fresh verification**

至少记录：

1. `npx vitest run tests/unit/scripts/tauri-dev-instance-paths.test.ts`
2. `cargo test dev_instance_paths --manifest-path src-tauri/Cargo.toml`
3. 与 `#776` 直接相关的新增 / 修改测试
4. 真实双实例复现实验的命令与结果

**Step 3: 整理提交**

提交信息建议：

```bash
git commit -m "fix(dev): isolate windows tauri instance state"
```

**Step 4: 人工评审交接**

给用户的交接信息必须包含：

1. worktree 路径
2. 分支名
3. 核心改动范围
4. 已验证命令与结果
5. 当前仍未处理的 follow-up：
   - `PR758 / issue-756` 合并后的 `config.sqlite` 接入
   - 剩余前端 settings 快照迁移
