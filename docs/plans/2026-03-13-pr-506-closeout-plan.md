# PR 506 Closeout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 收口 `PR 506`，修完 review blocker（评审阻塞）、整理 scope WIP（作用域未提交改动）、完成冲突处理、真实联调、E2E 与多轮评审，直到可人工验收。

**Architecture:** 这次不是重做整条迁移链，而是在现有主体实现上做 closeout（收尾）。优先顺序是：先用 TDD 修 blocker，再验证 `user_id / profile scope` 在 TS 与 Rust 端都闭环，然后只启动一个 Tauri 后台完成真实联调，最后处理 `dev` 冲突、CI、PR 评论与 review loop（评审回路）。

**Tech Stack:** TypeScript, React, Vitest, Rust, Cargo, Tauri v2, Playwright, GitHub CLI.

---

### Task 1: Fix blocker 1 for TimeBlock fallback outside Tauri

**Files:**
- Modify: `src/lib/services/timeblock.service.ts`
- Test: `tests/unit/services/timeblock.service.issue104-sync.test.ts`
- Verify: `tests/unit/services/timeblock.service.rt-sqlite.test.ts`

**Status:** completed

### Task 2: Fix blocker 2 for unified import/export in legacy backend

**Files:**
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Create: `tests/unit/settings/data-transfer-legacy-guard.issue506.test.tsx`
- Verify: `tests/unit/settings/eventlog-import-export.issue484.test.tsx`
- Verify: `tests/unit/settings/task-import-export.issue481.test.tsx`
- Verify: `tests/unit/settings/timeblock-import-export.issue485.test.tsx`

**Status:** completed

### Task 3: Validate and keep the profile-scope patch set

**Files:**
- Create: `src/lib/adapters/runtime-profile-scope.ts`
- Create: `tests/unit/adapters/runtime-profile-scope.test.ts`
- Modify: `src/lib/adapters/eventlog-rt-adapter.ts`
- Modify: `src/lib/adapters/task-rt-adapter.ts`
- Modify: `src/lib/adapters/timeblock-rt-adapter.ts`
- Modify: `src/lib/services/eventlog-backup.service.ts`
- Modify: `src/lib/services/task-backup.service.ts`
- Modify: `src/lib/services/timeblock-backup.service.ts`
- Modify: `crates/exomind-runtime/src/routes/eventlog.rs`
- Modify: `crates/exomind-runtime/src/routes/tasks.rs`
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Modify: `crates/exomind-runtime/src/task/sqlite_store.rs`
- Modify: `crates/exomind-runtime/src/task/store.rs`
- Modify: `crates/exomind-runtime/src/timeblock.rs`
- Modify: `crates/exomind-runtime/src/timeblock_sqlite.rs`
- Modify: `crates/exomind-runtime/tests/task_runtime_sqlite_persistence.rs`
- Modify: `crates/exomind-runtime/tests/timeblock_runtime_sqlite_persistence.rs`

**Status:** in_progress

**Notes:**
- TS scope matrix 已通过。
- Rust scope matrix 已通过。
- 当前只修了一个 route-level test（路由级测试）的字段名断言：`task_id -> taskId`，未扩大功能范围。

### Task 4: Start exactly one Tauri dev backend and establish log/port observation

**Files:**
- Verify runtime startup command only, no extra backend duplication
- Track logs from the single running Tauri process

**Status:** pending

**Requirements:**
- 只能启动一个 `tauri dev` / 桌面调试后台。
- 启动前先确认不与其它 worktree 的 Tauri 端口冲突。
- 持续保留日志读取手段，便于 MCP / E2E 联调。

### Task 5: Run real integration and E2E on the single Tauri backend

**Files:**
- Verify related desktop routes, settings data transfer, EventLog / Task / TimeBlock persistence
- Add or fix E2E only if真实联调暴露缺口

**Status:** pending

### Task 6: Merge latest `origin/dev` and resolve conflicts

**Files:**
- Conflict files reported by merge
- Priority: `SettingsPage`, runtime routes, persistence stores, related tests

**Status:** pending

### Task 7: Multi-agent review, PR comments, final verification and readiness

**Files:**
- PR comment content
- Final verification command set

**Status:** pending

**Requirements:**
- 用多代理做至少一轮 spec review（需求符合性评审）和一轮 code review（代码质量评审）。
- 用你的账号发表评论，但在评论中明确当前扮演的角色。
- 接受外部 review 意见后，按 `receiving-code-review` 流程逐条验证。
- 在本地验证、Tauri 联调、E2E、CI 证据齐全后，再准备人工验收说明。
