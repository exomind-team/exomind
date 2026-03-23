# RT TimeBlock SQLite Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `TimeBlock` 的 `completed blocks + active block` 一起迁到 `RT + SQLite`，并补齐统一导入导出入口与开发者模式 backend 诊断。

**Architecture:** 延续 `Task / EventLog -> RT SQLite` 已验证的模式：Rust runtime 提供 `TimeBlockStore + /timeblocks routes`，前端新增 `TimeBlockRtAdapter / TimeBlockBackupService`，`TimeBlockService` 保留业务状态机，只切换底层持久化目标。`active_block.replication.snapshot` 在 `rt-sqlite` 模式下直接投影回 RT，而不是继续写 Pouch。

**Tech Stack:** Rust (`rusqlite`, `axum`), TypeScript, React, Tauri, Vitest.

---

### Task 1: TimeBlock Rust store（完成块 + 当前块）接入 SQLite

**Files:**
- Create: `crates/exomind-runtime/src/timeblock.rs`
- Create: `crates/exomind-runtime/src/timeblock_sqlite.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `crates/exomind-runtime/tests/timeblock_runtime_sqlite_persistence.rs`

**Step 1: Write the failing test**

覆盖：
- `completed blocks` 在 SQLite 模式下重启后仍存在
- `active block` 在 SQLite 模式下重启后仍存在
- `clear active block` 后只清当前块，不清历史完成块

**Step 2: Run test to verify it fails**

```powershell
cargo test -p exomind-runtime timeblock_runtime_sqlite_persistence --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: Implement minimal store**

要求：
- 支持 `list_completed / replace_completed`
- 支持 `get_active / put_active / delete_active`
- 支持 `sqlite_snapshot_bytes()`
- 支持 `backend_kind()`

**Step 4: Wire runtime startup**

要求：
- 支持 `EXOMIND_RT_TIMEBLOCK_SQLITE_PATH`
- Tauri setup 默认写入 `timeblocks.sqlite`

**Step 5: Re-run tests**

```powershell
cargo test -p exomind-runtime timeblock_runtime_sqlite_persistence --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Task 2: 扩展 /timeblocks 路由与备份 / 导入接口

**Files:**
- Create: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Test: `crates/exomind-runtime/src/routes/timeblocks.rs`

**Step 1: Write the failing test**

覆盖：
- `GET /timeblocks`
- `PUT /timeblocks`
- `GET /timeblocks/active`
- `PUT /timeblocks/active`
- `DELETE /timeblocks/active`
- `GET /timeblocks/backend/status`
- `GET /timeblocks/backup/json`
- `GET /timeblocks/backup/sqlite`
- `POST /timeblocks/import/json`
- `POST /timeblocks/import/sqlite`

**Step 2: Run tests to verify they fail**

```powershell
cargo test -p exomind-runtime routes::timeblocks --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: Implement minimal routes**

要求：
- JSON payload 包含：
  - `version`
  - `time_blocks`
  - `active_block`
- SQLite snapshot 返回 base64 + file name
- import 支持 `merge / overwrite`

**Step 4: Re-run tests**

```powershell
cargo test -p exomind-runtime routes::timeblocks --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Task 3: 前端 TimeBlock RT adapter / backup service

**Files:**
- Create: `src/lib/adapters/timeblock-rt-adapter.ts`
- Create: `src/lib/services/timeblock-backup.service.ts`
- Modify: `src/lib/services/index.ts`
- Test: `tests/unit/adapters/timeblock-rt-adapter.test.ts`
- Test: `tests/unit/services/timeblock-backup.service.test.ts`

**Step 1: Write the failing test**

覆盖：
- RT adapter 正确读写 `completed blocks`
- RT adapter 正确读写 `active block`
- backup service 正确处理 `JSON / SQLite`
- backend status 正确返回 `legacy / rt-sqlite`

**Step 2: Run tests to verify they fail**

```powershell
npx vitest run tests/unit/adapters/timeblock-rt-adapter.test.ts tests/unit/services/timeblock-backup.service.test.ts
```

**Step 3: Implement minimal client layer**

要求：
- 统一使用 runtime target 构造 `/timeblocks` base URL
- API 语义与 Task / EventLog backup service 保持一致

**Step 4: Re-run tests**

```powershell
npx vitest run tests/unit/adapters/timeblock-rt-adapter.test.ts tests/unit/services/timeblock-backup.service.test.ts
```

### Task 4: TimeBlockService 切换到按域 backend mode

**Files:**
- Modify: `src/lib/services/timeblock.service.ts`
- Modify: `src/lib/services/ecs-active-block-replication.service.ts`
- Modify: `src/ui/hooks/useSignalStream.ts`（若需要）
- Test: `tests/unit/services/timeblock.service.test.ts`
- Test: `tests/unit/services/timeblock.service.issue104-sync.test.ts`

**Step 1: Write the failing test**

覆盖：
- `rt-sqlite` 模式下 `loadTimeBlocks` 读 RT
- `rt-sqlite` 模式下 `loadActiveBlock / saveActiveBlock / clearActiveBlock` 读写 RT
- `read-promote`：RT 为空时从 legacy 提升
- `active_block.replication.snapshot` 在 `rt-sqlite` 模式下写回 RT
- `onBlockChange` 仍通知 UI

**Step 2: Run tests to verify they fail**

```powershell
npx vitest run tests/unit/services/timeblock.service.test.ts tests/unit/services/timeblock.service.issue104-sync.test.ts
```

**Step 3: Implement minimal backend switch**

要求：
- `legacy` 保持现状
- `rt-sqlite` 不再把 active block 真相源绑定到 `ActiveBlockStorage`
- 远端 snapshot 投影到 RT 后要触发 UI 订阅更新

**Step 4: Re-run tests**

```powershell
npx vitest run tests/unit/services/timeblock.service.test.ts tests/unit/services/timeblock.service.issue104-sync.test.ts
```

### Task 5: Settings 统一入口补齐 TimeBlock

**Files:**
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `tests/unit/components/settings/setup-settings-mocks.tsx`
- Create: `tests/unit/settings/timeblock-import-export.issue485.test.tsx`
- Create: `tests/unit/settings/timeblock-backend-diagnostics.issue485.test.tsx`

**Step 1: Write the failing test**

覆盖：
- 统一入口里可选 `TimeBlock`
- `TimeBlock JSON` 导出
- `TimeBlock SQLite` 导出
- `TimeBlock JSON` 导入
- `TimeBlock SQLite` 导入
- 开发者模式显示 `时间块后端`
- 可切换 `legacy / rt-sqlite`

**Step 2: Run tests to verify they fail**

```powershell
npx vitest run tests/unit/settings/timeblock-import-export.issue485.test.tsx tests/unit/settings/timeblock-backend-diagnostics.issue485.test.tsx
```

**Step 3: Implement minimal settings integration**

要求：
- 不新增单独按钮，只复用统一入口
- developer mode 中 TimeBlock 从只读占位升级为真实 backend diagnostics

**Step 4: Re-run tests**

```powershell
npx vitest run tests/unit/settings/timeblock-import-export.issue485.test.tsx tests/unit/settings/timeblock-backend-diagnostics.issue485.test.tsx
```

### Task 6: Final verification

**Files:**
- Verify only

**Step 1: Type check**

```powershell
bunx tsc --noEmit
```

**Step 2: Run targeted frontend tests**

```powershell
npx vitest run tests/unit/adapters/timeblock-rt-adapter.test.ts tests/unit/services/timeblock-backup.service.test.ts tests/unit/services/timeblock.service.test.ts tests/unit/services/timeblock.service.issue104-sync.test.ts tests/unit/settings/timeblock-import-export.issue485.test.tsx tests/unit/settings/timeblock-backend-diagnostics.issue485.test.tsx
```

**Step 3: Run backend tests**

```powershell
cargo test -p exomind-runtime timeblock --manifest-path src-tauri/Cargo.toml -- --nocapture
cargo test -p exomind-runtime routes::timeblocks --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 4: Manual desktop validation**

```powershell
bun run tauri dev
```

手动验收：
- 开始一个时间块后重启，active block 仍存在
- 结束时间块后 completed blocks 仍存在
- `TimeBlock JSON / SQLite` 导入导出可用
- 开发者模式显示 `时间块后端：rt-sqlite`
- 切换回 `legacy` 后仍能回读旧数据
