# RT EventLog SQLite Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把桌面端 `EventLog` 的真实数据源迁移到 `RT + SQLite`，让前端事件读写、导入导出、Markdown mirror 与开发者调试信息都围绕 RT EventLog 真相源工作。

**Architecture:** 复用 `Task -> RT SQLite` 已验证的迁移模式：先把 Rust runtime 的 `EventLogStore` 从 `json file` 升级为 `SQLite-first`，保持 `EventLog HTTP API` 尽量稳定，再新增 `EventLogRtAdapter / EventLogBackupService` 把前端读写和 Settings 导入导出切到 RT。Settings 不再为每个域放独立导入导出按钮，而是改为一个统一入口，在弹层里选择 `格式（JSON / SQLite）` 与 `范围（按域）`。Markdown mirror 保留，但降级为由 RT SQLite 派生出的副产物。

**Tech Stack:** Rust (`rusqlite`, `axum`), TypeScript, React, Tauri, Vitest.

---

### Task 1: RT EventLogStore 升级为 SQLite-first

**Files:**
- Create: `crates/exomind-runtime/src/eventlog_sqlite.rs`
- Modify: `crates/exomind-runtime/src/eventlog.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `crates/exomind-runtime/src/eventlog.rs`
- Test: `crates/exomind-runtime/tests/eventlog_runtime_sqlite_persistence.rs`

**Step 1: Write the failing test**

覆盖：
- EventLog 在 SQLite 模式下重启后仍然存在
- `append/list/get/clear` 在 SQLite 模式下保持当前语义
- Markdown mirror 仍能从 SQLite 数据重建

**Step 2: Run test to verify it fails**

```powershell
cargo test -p exomind-runtime eventlog --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: Implement minimal SQLite EventLog store**

要求：
- `EventLogStore::new()` 保留当前兼容入口
- 增加 `EventLogStore::with_sqlite_path(...)`
- SQLite 为主存储，mirror/checkpoint 仍可落文件

**Step 4: Wire runtime startup to EventLog SQLite path**

要求：
- runtime 启动时支持 `EXOMIND_RT_EVENTLOG_SQLITE_PATH`
- Tauri setup 预设桌面端 eventlog sqlite 路径

**Step 5: Re-run tests**

```powershell
cargo test -p exomind-runtime eventlog --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Task 2: 扩展 /eventlog 路由为备份 / 导入接口

**Files:**
- Modify: `crates/exomind-runtime/src/routes/eventlog.rs`
- Modify: `crates/exomind-runtime/src/eventlog.rs`
- Test: `crates/exomind-runtime/src/routes/eventlog.rs`

**Step 1: Write the failing test**

覆盖：
- `GET /eventlog/backup/json`
- `GET /eventlog/backup/sqlite`
- `POST /eventlog/import/json`
- `POST /eventlog/import/sqlite`
- `merge / overwrite` 语义
- 兼容旧 JSON 备份格式

**Step 2: Run tests to verify they fail**

```powershell
cargo test -p exomind-runtime routes::eventlog --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: Implement minimal backup/import protocol**

要求：
- JSON payload 继续兼容现有 `version + events`
- SQLite snapshot 走 base64 响应供前端保存
- import 返回导入计数

**Step 4: Re-run tests**

```powershell
cargo test -p exomind-runtime routes::eventlog --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Task 3: 前端 EventLog 读写切到 RT

**Files:**
- Create: `src/lib/adapters/eventlog-rt-adapter.ts`
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/services/eventlog.service.ts`
- Modify: `src/components/Chat/ChatPage.tsx`（若需要）
- Test: `tests/unit/adapters/eventlog-rt-adapter.test.ts`
- Test: `tests/unit/eventlog/service-import-export.test.ts`

**Step 1: Write the failing test**

覆盖：
- EventLog RT adapter 正确映射 runtime payload
- 前端新增事件走 RT `/eventlog`
- `EventLogService` 导入导出仍保持兼容

**Step 2: Run tests to verify they fail**

```powershell
npx vitest run tests/unit/adapters/eventlog-rt-adapter.test.ts tests/unit/eventlog/service-import-export.test.ts
```

**Step 3: Implement minimal cutover**

要求：
- 默认 EventLog backend 改到 RT adapter
- 不再以 Web/Pouch EventLog 作为桌面端主路径
- 兼容现有 `EventLogService` API

**Step 4: Re-run tests**

```powershell
npx vitest run tests/unit/adapters/eventlog-rt-adapter.test.ts tests/unit/eventlog/service-import-export.test.ts
```

### Task 4: Settings 统一导入导出入口接入 EventLog

**Files:**
- Create: `src/lib/services/eventlog-backup.service.ts`
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `src-tauri/src/commands/file_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/unit/settings/eventlog-import-export.issue484.test.tsx`

**Step 1: Write the failing test**

覆盖：
- Settings 只有一个统一的 `导出数据 / 导入数据` 入口
- 在统一入口内可选择：
  - `格式：JSON / SQLite`
  - `范围：EventLog`
- `EventLog JSON` 导出
- `EventLog SQLite` 导出
- `EventLog JSON` 导入
- `EventLog SQLite` 导入
- 桌面端导出走 `Tauri` 原生保存，不走 Web fallback

**Step 2: Run tests to verify they fail**

```powershell
npx vitest run tests/unit/settings/eventlog-import-export.issue484.test.tsx
```

**Step 3: Implement minimal UI/service**

要求：
- 保留旧事件日志 JSON 备份兼容
- 不新增 EventLog 专属独立按钮，而是收口到统一导入导出入口
- Tauri 使用原生保存 / 选取文件命令
- 设计上允许后续 `Task / TimeBlock` 复用同一入口

**Step 4: Re-run tests**

```powershell
npx vitest run tests/unit/settings/eventlog-import-export.issue484.test.tsx
```

### Task 5: 开发者模式域级 backend 诊断与切换

**Files:**
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Optionally create: `src/lib/services/eventlog-backend-status.service.ts`
- Test: `tests/unit/settings/eventlog-backend-diagnostics.issue484.test.tsx`

**Step 1: Write the failing test**

覆盖：
- 开发者模式显示 `EventLog backend`
- 与 `Task / TimeBlock` 一样按域显示 backend 状态
- 允许按域切换 backend（迁移期仅开发者模式可见）
- 显示 EventLog 备份支持 `JSON / SQLite`
- 关闭开发者模式时不显示

**Step 2: Run tests to verify they fail**

```powershell
npx vitest run tests/unit/settings/eventlog-backend-diagnostics.issue484.test.tsx
```

**Step 3: Implement minimal diagnostics**

要求：
- backend 切换是**按域切换**，不是全局一起切
- 本轮 `#484` 至少要把 `EventLog` 域的显示与切换打通
- `Task / TimeBlock` 可以先占位展示，后续分别接线

**Step 4: Re-run tests**

```powershell
npx vitest run tests/unit/settings/eventlog-backend-diagnostics.issue484.test.tsx
```

### Task 6: Final verification

**Files:**
- Verify only

**Step 1: Type check**

```powershell
npx tsc --noEmit
```

**Step 2: Run targeted frontend tests**

```powershell
npx vitest run tests/unit/adapters/eventlog-rt-adapter.test.ts tests/unit/eventlog/service-import-export.test.ts tests/unit/settings/eventlog-import-export.issue484.test.tsx tests/unit/settings/eventlog-backend-diagnostics.issue484.test.tsx
```

**Step 3: Run backend tests**

```powershell
cargo test -p exomind-runtime eventlog --manifest-path src-tauri/Cargo.toml -- --nocapture
cargo test -p exomind-runtime routes::eventlog --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 4: Build**

```powershell
bun run build
```

**Step 5: Manual desktop validation**

```powershell
bun run tauri dev
```

手动验收：
- 新增 EventLog 后重启仍存在
- EventLog JSON 导出可用
- EventLog SQLite 导出可用
- EventLog JSON 导入可用
- EventLog SQLite 导入可用
- Markdown mirror 可重建
- 开发者模式可见 `EventLog backend: rt-sqlite`
