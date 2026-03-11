# RT Task SQLite Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把任务系统真实数据源迁移到 `RT + SQLite`，并让前端任务读写、任务导入导出、开发者调试信息都围绕 RT 任务后端工作。

**Architecture:** 保持现有 `RT /tasks` HTTP 路由为任务 API 外观（API surface，接口外观），把 `TaskStore` 从内存实现升级为 `SQLite-first` 持久化实现，同时新增前端 `TaskRtAdapter` 替换 `TaskPouchAdapter`。Settings 不改 EventLog 备份语义，只新增“任务数据”独立导入导出链路，支持 `JSON` 与 `SQLite snapshot`。

**Tech Stack:** Rust (`axum`, `rusqlite`), TypeScript, React, Tauri, Vitest.

---

### Task 1: RT TaskStore 升级为 SQLite-first

**Files:**
- Create: `crates/exomind-runtime/src/task/sqlite_store.rs`
- Modify: `crates/exomind-runtime/src/task/store.rs`
- Modify: `crates/exomind-runtime/src/task/types.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `crates/exomind-runtime/src/task/store.rs`
- Test: `crates/exomind-runtime/src/routes/tasks.rs`

**Step 1: 写失败测试**

覆盖：
- RT task store 在 SQLite 模式下重启后数据仍存在
- `depends_on / time_block_ids / done_condition / estimated_minutes` 能 roundtrip
- `transition / abandon / update` 在 SQLite 模式下保持现有行为

**Step 2: 运行测试确认失败**

Run:
```powershell
cargo test -p exomind-runtime task --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: 实现最小 SQLite task store**

要求：
- `TaskStore::new()` 继续保留内存实现，服务测试
- 新增 `TaskStore::with_sqlite_path(...)`
- 任务表覆盖前端现有核心字段
- 生产运行时默认走 SQLite 路径

**Step 4: 将 runtime startup 接到 task sqlite 路径**

要求：
- `RuntimeStartOptions` 增加 `task_storage_path`
- Tauri setup 预置 `EXOMIND_RT_TASK_SQLITE_PATH`

**Step 5: 回归测试**

Run:
```powershell
cargo test -p exomind-runtime task --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Task 2: 扩展 /tasks 路由与任务备份 API

**Files:**
- Modify: `crates/exomind-runtime/src/routes/tasks.rs`
- Modify: `crates/exomind-runtime/src/task/store.rs`
- Modify: `crates/exomind-runtime/src/task/types.rs`
- Test: `crates/exomind-runtime/src/routes/tasks.rs`

**Step 1: 写失败测试**

覆盖：
- `/tasks` 返回的 payload 与前端 `TaskNode` 所需字段对应
- `GET /tasks/backup/json`
- `GET /tasks/backup/sqlite`
- `POST /tasks/import/json`
- `POST /tasks/import/sqlite`
- `merge / overwrite` 语义正确

**Step 2: 运行测试确认失败**

Run:
```powershell
cargo test -p exomind-runtime routes::tasks --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: 实现最小备份协议**

要求：
- JSON payload 版本化
- SQLite snapshot 走 base64 + metadata 响应，供前端下载
- import 返回导入计数和总量

**Step 4: 回归测试**

Run:
```powershell
cargo test -p exomind-runtime routes::tasks --manifest-path src-tauri/Cargo.toml -- --nocapture
```

### Task 3: 前端任务读写切到 RT

**Files:**
- Create: `src/lib/adapters/task-rt-adapter.ts`
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/services/task.service.ts`
- Modify: `src/App.tsx`
- Optionally modify: `src/ui/app/components/TaskSyncCoordinator.tsx`
- Test: `tests/unit/adapters/task-rt-adapter.test.ts`
- Test: `tests/unit/app/app-router-context.startup.test.tsx`

**Step 1: 写失败测试**

覆盖：
- `TaskRtAdapter` 能 list / get / create / update / transition / abandon
- snake_case <-> camelCase 映射正确
- App 不再挂载 `TaskSyncCoordinator`
- `TaskService` 的变更能通知 UI 监听器

**Step 2: 运行测试确认失败**

Run:
```powershell
npx vitest run tests/unit/adapters/task-rt-adapter.test.ts tests/unit/app/app-router-context.startup.test.tsx
```

**Step 3: 实现最小 cutover**

要求：
- 默认任务 backend 改为 RT adapter
- 本地 task mutation 后触发 `onTaskChange`
- 不再依赖 task Pouch live sync

**Step 4: 回归测试**

Run:
```powershell
npx vitest run tests/unit/adapters/task-rt-adapter.test.ts tests/unit/app/app-router-context.startup.test.tsx
```

### Task 4: Settings 增加任务 JSON / SQLite 导入导出

**Files:**
- Create: `src/lib/services/task-backup.service.ts`
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `src-tauri/src/commands/file_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/unit/settings/task-import-export.issue481.test.tsx`

**Step 1: 写失败测试**

覆盖：
- Settings 能导出任务 JSON
- Settings 能导出任务 SQLite snapshot
- Settings 能导入任务 JSON
- Settings 能导入任务 SQLite snapshot
- 不影响现有 EventLog 备份按钮语义

**Step 2: 运行测试确认失败**

Run:
```powershell
npx vitest run tests/unit/settings/task-import-export.issue481.test.tsx
```

**Step 3: 实现最小 UI 与服务**

要求：
- 任务数据入口独立于 EventLog 备份入口
- Tauri 与 Web 都能走同一套导入导出逻辑
- Tauri 文件命令支持除 `.json` 外的任务快照文件

**Step 4: 回归测试**

Run:
```powershell
npx vitest run tests/unit/settings/task-import-export.issue481.test.tsx
```

### Task 5: 开发者模式调试信息

**Files:**
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Optionally create: `src/lib/services/task-backend-status.service.ts`
- Test: `tests/unit/settings/task-backend-diagnostics.issue481.test.tsx`

**Step 1: 写失败测试**

覆盖：
- 开发者模式开启时显示 `Task backend`
- 显示当前任务导入导出格式能力
- 非开发者模式时不显示

**Step 2: 运行测试确认失败**

Run:
```powershell
npx vitest run tests/unit/settings/task-backend-diagnostics.issue481.test.tsx
```

**Step 3: 实现最小诊断视图**

要求：
- 能看出当前是否 `rt-sqlite`
- 能看出任务备份支持 `json/sqlite`

**Step 4: 回归测试**

Run:
```powershell
npx vitest run tests/unit/settings/task-backend-diagnostics.issue481.test.tsx
```

### Task 6: 全链路验证与联调

**Files:**
- Verify only

**Step 1: 类型检查**

```powershell
npx tsc --noEmit
```

**Step 2: 跑相关单测**

```powershell
npx vitest run tests/unit/adapters/task-rt-adapter.test.ts tests/unit/settings/task-import-export.issue481.test.tsx tests/unit/settings/task-backend-diagnostics.issue481.test.tsx tests/unit/app/app-router-context.startup.test.tsx
cargo test -p exomind-runtime task --manifest-path src-tauri/Cargo.toml -- --nocapture
```

**Step 3: 构建验证**

```powershell
bun run build
```

**Step 4: 启动桌面端联调**

```powershell
bun run tauri dev
```

**Step 5: 人工验收点**

- 创建任务后刷新应用仍然存在
- 编辑估时 / 依赖 / 状态变更后刷新仍然存在
- Settings 能导出 / 导入任务 JSON
- Settings 能导出 / 导入任务 SQLite snapshot
- 开发者模式能显示任务后端为 `rt-sqlite`
