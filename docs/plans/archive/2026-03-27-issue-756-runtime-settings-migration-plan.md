# Issue #756 Runtime Settings Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不影响当前 `dev` 使用链路的前提下，把第一批关键设置从前端 `localStorage` 迁到 Runtime SQLite，并让 `tauri dev` 与安装版共享同一份设置数据。

**Architecture:** 新增 `RuntimeConfigStore` 作为 SQLite 持久化真相源，前端通过 `bootstrap + in-memory cache（启动快照 + 内存缓存）` 保持现有同步 `get / set / subscribe` 调用方式。被迁移模块仍兼容镜像写 `localStorage`，但优先从 Runtime cache 读，避免 origin 分叉继续成为真相源。

**Tech Stack:** Rust + Axum + Rusqlite + Tauri v2 + React 18 + TypeScript + Vitest

---

### Task 1: Runtime config store（运行时配置存储）

**Files:**
- Create: `crates/exomind-runtime/src/config/mod.rs`
- Create: `crates/exomind-runtime/src/config/store.rs`
- Create: `crates/exomind-runtime/src/config/sqlite_store.rs`
- Create: `crates/exomind-runtime/src/config/types.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`

**Step 1: Write the failing test**

在 `store.rs` 的测试里覆盖：
- 空库读配置返回空数组
- `put` 后 `get/list` 可读回
- 相同 `(scope, key)` 再写会覆盖旧值
- 重新打开 SQLite 后数据仍存在

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind-runtime config::store`
Expected: FAIL，因为 `config` 模块尚不存在

**Step 3: Write minimal implementation**

实现最小能力：
- `ConfigEntry { scope, key, value, sensitive, updated_at, source, source_origin }`
- `ConfigStore::new()` 内存版
- `ConfigStore::with_sqlite_path(path)`
- `put/get/list/delete/list_by_prefix`

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind-runtime config::store`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/config crates/exomind-runtime/src/lib.rs
git commit -m "feat(runtime): add config store for issue 756"
```

### Task 2: Runtime config routes（运行时配置路由）

**Files:**
- Create: `crates/exomind-runtime/src/routes/config.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`

**Step 1: Write the failing test**

在 `routes/config.rs` 的测试里覆盖：
- `GET /config?scope=user&prefix=exomind:` 返回前缀过滤结果
- `PUT /config/{key}` 可写入 value
- `DELETE /config/{key}` 删除成功
- `POST /config/import/frontend` 只在目标 key 为空时导入（`if-empty`）

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind-runtime routes::config`
Expected: FAIL，因为路由尚未注册

**Step 3: Write minimal implementation**

实现最小 HTTP API：
- `GET /config`
- `PUT /config/:key`
- `DELETE /config/:key`
- `POST /config/import/frontend`

本 PR 不做：
- `GET /config/stream`
- `POST /config/reset`

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind-runtime routes::config`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/routes/config.rs crates/exomind-runtime/src/routes/mod.rs crates/exomind-runtime/src/lib.rs
git commit -m "feat(runtime): expose config routes for issue 756"
```

### Task 3: Tauri runtime path wiring（桌面端路径注入）

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

如果当前测试基础不足，则补一个针对 `seed_runtime_sqlite_env_paths` 的单测，验证会写入：
- `EXOMIND_RT_CONFIG_SQLITE_PATH -> config.sqlite`

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind --lib config_sqlite`
Expected: FAIL，或没有对应变量注入

**Step 3: Write minimal implementation**

在 Tauri setup 阶段补上 `config.sqlite` 默认路径注入，并让 Runtime 启动时读取该 env。

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind --lib config_sqlite`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): seed runtime config sqlite path"
```

### Task 4: Frontend runtime config bootstrap（前端运行时配置启动快照）

**Files:**
- Create: `src/config/runtime-config-types.ts`
- Create: `src/config/runtime-config-cache.ts`
- Create: `src/config/runtime-config-adapter.ts`
- Modify: `src/main.tsx`
- Test: `tests/unit/config/runtime-config-cache.test.ts`

**Step 1: Write the failing test**

覆盖：
- bootstrap 成功后缓存命中
- Runtime 不可用时回退 localStorage
- `set/remove/importIfEmpty` 会更新内存缓存并发出事件

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/config/runtime-config-cache.test.ts`
Expected: FAIL，因为模块不存在

**Step 3: Write minimal implementation**

实现：
- 启动前空缓存 + local fallback
- `bootstrapRuntimeConfig()`
- `getRuntimeConfigValueSync(key)`
- `setRuntimeConfigValue(key, value, options?)`
- `removeRuntimeConfigValue(key)`
- `importFrontendConfigIfEmpty(entries)`
- 事件分发与本地镜像写

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/config/runtime-config-cache.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/runtime-config-* src/main.tsx tests/unit/config/runtime-config-cache.test.ts
git commit -m "feat(web): bootstrap runtime-backed config cache"
```

### Task 5: Migrate Batch A config modules（迁移首批关键配置模块）

**Files:**
- Modify: `src/config/config-factory.ts`
- Modify: `src/config/theme.ts`
- Modify: `src/config/voice-shortcut-hotkey.ts`
- Modify: `src/config/main-window-shortcut.ts`
- Modify: `src/config/main-window-shortcut-focus.ts`
- Modify: `src/config/voice-shortcut-asr-provider.ts`
- Modify: `src/config/voice-shortcut-mic-prewarm.ts`
- Modify: `src/config/voice-shortcut-send-mode.ts`
- Modify: `src/config/voice-transcript-send-mode.ts`
- Modify: `src/config/input-send-mode.ts`
- Modify: `src/config/volcano-asr-settings.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/lib/adapters/asr/moss-asr.ts`
- Test: `tests/unit/ui/theme-preference.test.ts`
- Test: `tests/unit/config/voice-shortcut-hotkey.test.ts`
- Test: `tests/unit/config/main-window-shortcut.test.ts`
- Test: `tests/unit/adapters/moss-asr-auth.test.ts`

**Step 1: Write the failing test**

逐个补充或扩展测试，验证：
- 被迁移 key 优先从 runtime cache 读取
- 写入后仍镜像到 localStorage
- Runtime 不可用时行为与当前一致
- `moss_api_key` 不再只依赖 localStorage

**Step 2: Run test to verify it fails**

Run:
- `bunx vitest run tests/unit/ui/theme-preference.test.ts`
- `bunx vitest run tests/unit/config/voice-shortcut-hotkey.test.ts`
- `bunx vitest run tests/unit/config/main-window-shortcut.test.ts`
- `bunx vitest run tests/unit/adapters/moss-asr-auth.test.ts`

Expected: FAIL，因为模块尚未接入 runtime cache

**Step 3: Write minimal implementation**

做法：
- 为 `createConfigModule` 增加“可选 runtime-backed mode（运行时后端模式）”
- 维持外部同步 API 不变
- `settings-registry` 的 `moss_api_key` 改走统一 config adapter
- 火山配置统一接入 runtime config

**Step 4: Run test to verify it passes**

Run 同上
Expected: PASS

**Step 5: Commit**

```bash
git add src/config src/ui/app/config/settings/settings-registry.ts src/lib/adapters/asr/moss-asr.ts tests/unit/ui/theme-preference.test.ts tests/unit/config/voice-shortcut-hotkey.test.ts tests/unit/config/main-window-shortcut.test.ts tests/unit/adapters/moss-asr-auth.test.ts
git commit -m "feat(settings): migrate batch-a settings to runtime config"
```

### Task 6: Migrate AI registry storage（迁移 AI Registry 快照与密钥）

**Files:**
- Modify: `src/lib/ai-registry/storage.ts`
- Modify: `src/lib/ai-registry/secrets.ts`
- Test: `tests/unit/storage/ai-registry-storage.test.ts`

**Step 1: Write the failing test**

验证：
- snapshot 与 energy secret 仍分离存储
- 优先读 runtime cache
- Runtime 不可用时仍回退 localStorage

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/storage/ai-registry-storage.test.ts`
Expected: FAIL，因为当前只读写 localStorage

**Step 3: Write minimal implementation**

把 `AI_REGISTRY_SNAPSHOT_KEY` 与 `AI_ENERGY_SECRET_KEY_PREFIX` 接到 runtime config adapter，并保留事件通知。

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/storage/ai-registry-storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/ai-registry/storage.ts src/lib/ai-registry/secrets.ts tests/unit/storage/ai-registry-storage.test.ts
git commit -m "feat(ai-registry): persist snapshot and secrets via runtime config"
```

### Task 7: Full verification and PR prep（全量验证与 PR 准备）

**Files:**
- Modify: `docs/plans/2026-03-27-issue-756-runtime-settings-migration-design.md`
- Modify: `docs/plans/2026-03-27-issue-756-runtime-settings-migration-plan.md`

**Step 1: Run focused verification**

Run:
- `bunx tsc --noEmit`
- `bunx vitest run tests/unit/config/runtime-config-cache.test.ts`
- `bunx vitest run tests/unit/ui/theme-preference.test.ts`
- `bunx vitest run tests/unit/config/voice-shortcut-hotkey.test.ts`
- `bunx vitest run tests/unit/config/main-window-shortcut.test.ts`
- `bunx vitest run tests/unit/adapters/moss-asr-auth.test.ts`
- `bunx vitest run tests/unit/storage/ai-registry-storage.test.ts`
- `cargo test -p exomind-runtime config::store`
- `cargo test -p exomind-runtime routes::config`

**Step 2: Fix anything still red**

只修与 `#756` 第一阶段直接相关的问题，不顺手扩散。

**Step 3: Push branch**

```bash
git push -u origin feature/issue-756-runtime-settings-migration
```

**Step 4: Create PR**

PR 标题建议：

```text
fix(issue-756): migrate runtime settings from localStorage to SQLite
```

PR 描述必须包含：
- 问题背景
- 第一阶段范围
- 测试命令与结果
- 未纳入本 PR 的后续项

**Step 5: Link issue**

在 PR 描述与评论中写明：
- `Closes #756` 或 `Refs #756`（若本 PR 只是第一阶段则用 `Refs #756`）
- 附设计文档与实施计划链接
