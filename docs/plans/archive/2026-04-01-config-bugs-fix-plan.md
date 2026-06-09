# Runtime Config Bug 修复计划

> **状态**：待执行
> **关联 Issue**：#791, #756
> **分支**：`fix/config-bugs`
> **优先级排序**：Bug 1 (中) > Bug 5 (低) > Bug 6 (低) > Bug 4 (低)

---

## Context

PR #784 将 runtime config 迁移代码合入 dev，Bug 2（RT 掉线清空缓存）已修复（`suspendedEntries` 三级回退），Bug 3（无认证）经复核为误判（`require_auth` middleware 已保护全部 protected 路由）。

剩余 4 个 bug：

| Bug | 文件 | 行号 | 严重度 |
|-----|------|------|--------|
| Bug 1: TOCTOU 竞态 | `crates/exomind-runtime/src/routes/config.rs` | L120 `import_frontend_config` | 中 |
| Bug 5: 静默吞异常 | `src/config/runtime-config-cache.ts` | L61, L73, L85 | 低 |
| Bug 6: JSON 无验证 | `src/config/runtime-config-adapter.ts` | L237 | 低 |
| Bug 4: 跨窗口缓存同步 | `src/config/runtime-config-cache.ts` | `replaceRuntimeEntries` 仅 bootstrap 调用一次 | 低 |

---

## 步骤 1: Bug 1 TOCTOU 修复 (#791)

### 1.1 改动

**文件**：`crates/exomind-runtime/src/config/sqlite_store.rs`

在 SQLite store 层新增 `put_if_absent` 方法，使用 `INSERT OR IGNORE`：

```rust
/// 原子导入：key 已存在则跳过，不存在才写入。返回是否实际写入。
pub fn put_if_absent(&self, input: PutConfigEntryInput) -> Result<bool> {
    let conn = self.conn.lock().unwrap();
    let changes = conn.execute(
        "INSERT OR IGNORE INTO runtime_config_entries
         (scope, key, value, sensitive, updated_at, source, source_origin)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.scope, input.key, input.value,
            input.sensitive, now_iso(), input.source, input.source_origin,
        ],
    )?;
    Ok(changes > 0)
}
```

**文件**：`crates/exomind-runtime/src/config/store.rs`

在 `ConfigStore` 上暴露 `put_if_absent`，内存模式用 `entry` API：

```rust
pub fn put_if_absent(&self, input: PutConfigEntryInput) -> Result<bool> {
    match &self.sqlite {
        Some(sqlite) => sqlite.put_if_absent(input),
        None => {
            // 内存模式：用 HashMap entry API 实现原子 check-then-insert
            use std::collections::hash_map::Entry;
            let key = (input.scope.clone(), input.key.clone());
            match self.entries.lock().unwrap().entry(key) {
                Entry::Occupied(_) => Ok(false),
                Entry::Vacant(e) => {
                    e.insert(ConfigEntry { /* ... */ });
                    Ok(true)
                }
            }
        }
    }
}
```

**文件**：`crates/exomind-runtime/src/routes/config.rs` L120

替换 `import_frontend_config` 中的 check-then-put：

```rust
// Before:
if state.config_store.get(&payload.scope, &entry.key)?.is_some() {
    skipped += 1;
    continue;
}
state.config_store.put(PutConfigEntryInput { ... })?;

// After:
let was_inserted = state.config_store.put_if_absent(PutConfigEntryInput { ... })
    .map_err(internal_error)?;
if was_inserted {
    imported += 1;
} else {
    skipped += 1;
}
```

### 1.2 验证

```bash
cargo test -p exomind-runtime config::store
cargo test -p exomind-runtime routes::config
```

新增测试用例：`concurrent_import_respects_first_writer`（用 `put_if_absent` 在两个线程中并发导入同一 key，断言仅一个成功）。

---

## 步骤 2: Bug 5 静默吞异常修复

### 2.1 改动

**文件**：`src/config/runtime-config-cache.ts` L61, L73, L85

将空 `catch {}` 替换为带日志的 catch：

```typescript
// Before:
} catch {
  // Ignore local mirror failures
}

// After:
} catch (error) {
  console.warn('[runtime-config] localStorage mirror write failed:', key, error);
}
```

三处 catch 块（`writeLocalStorageValue`、`removeLocalStorageValue`、`readLocalStorageValue`）统一处理。

### 2.2 验证

```bash
npx vitest run tests/unit/config/runtime-config-cache.test.ts
```

---

## 步骤 3: Bug 6 JSON 验证修复

### 3.1 改动

**文件**：`src/config/runtime-config-adapter.ts` L237

```typescript
// Before:
return response.json() as Promise<RuntimeConfigEntryRecord[]>;

// After:
const data: unknown = await response.json();
if (!Array.isArray(data)) {
  throw new Error(`runtime config snapshot: expected array, got ${typeof data}`);
}
return data.filter(
  (entry): entry is RuntimeConfigEntryRecord =>
    typeof entry === 'object' && entry !== null &&
    typeof (entry as Record<string, unknown>).key === 'string' &&
    typeof (entry as Record<string, unknown>).value === 'string'
);
```

### 3.2 验证

```bash
npx vitest run tests/unit/config/runtime-config-cache.test.ts
```

新增测试：`fetchRuntimeSnapshot filters out malformed entries`。

---

## 步骤 4: Bug 4 跨窗口缓存同步（可选/远期）

### 4.1 改动

**方案**：监听 `storage` 事件。由于所有 config 写入都会镜像到 localStorage（`writeLocalStorageValue`），另一个窗口的 `storage` 事件可以捕获变更。

**文件**：`src/config/runtime-config-cache.ts`

在 `bootstrapRuntimeConfig` 末尾注册：

```typescript
window.addEventListener('storage', (event) => {
  if (event.key && state.entries.has(event.key) && event.newValue !== null) {
    state.entries.set(event.key, event.newValue);
    dispatchSyntheticStorageEvent(event.key, event.newValue);
  }
});
```

### 4.2 验证

手动测试：两个窗口打开，窗口 A 改 theme，窗口 B 应响应。

---

## ⚠️ 不要做清单

1. **不要改 `put` 方法签名** — `put_if_absent` 是新增方法，现有 `put`（upsert 语义）保持不变
2. **不要改 `import_frontend_config` 的 HTTP 接口契约** — 请求/响应格式不变，仅内部实现改为原子
3. **不要为 localStorage catch 加 throw** — 镜像写入失败不应阻断主流程，只加日志
4. **不要给 fetchRuntimeSnapshot 加严格 schema 库**（如 zod）— 用内联 filter 即可，不引入新依赖
5. **不要动 `suspendedEntries` 机制** — Bug 2 已修复，不要回退
6. **不要改 auth middleware** — Bug 3 已确认为误判，认证层正常工作

---

## 验证总表

| 场景 | 操作 | 期望结果 | Bug# |
|------|------|---------|------|
| 两窗口同时启动 | 并发 `import_frontend_config` 同一 key | 仅第一个写入成功，第二个 skipped | #1 |
| 单窗口 `put_if_absent` 已有 key | 调用 `put_if_absent` | 返回 `false`，不覆盖 | #1 |
| localStorage 配额满 | 写 config | console.warn 日志，不 crash | #5 |
| RT 返回 malformed JSON | fetch snapshot | 过滤掉无效条目，不 crash | #6 |
| 窗口 A 改 theme | 窗口 B 监听 storage 事件 | 窗口 B 内存缓存更新 | #4 |
| `cargo test` 全量 | 运行 | 0 failed | all |
| `npx vitest run tests/unit/config/` | 运行 | 0 failed | all |

---

## 完成回填

（执行后填写）

| 步骤 | 状态 | commit | 备注 |
|------|------|--------|------|
| 步骤 1 Bug 1 | 已完成 | 待提交 | 已新增 `put_if_absent` 并改为原子导入；`cargo test -p exomind-runtime --lib config::store`、`cargo test -p exomind-runtime --lib routes::config` 通过 |
| 步骤 2 Bug 5 | 已完成 | 待提交 | localStorage mirror 的 read/write/remove 异常已改为 `console.warn`，相关 Vitest 通过 |
| 步骤 3 Bug 6 | 已完成 | 待提交 | runtime snapshot 已加最小 JSON 校验与 malformed entry 过滤，相关 Vitest 通过 |
| 步骤 4 Bug 4 | 已完成 | 待提交 | 已增加 `storage` 事件同步 Runtime cache，并验证订阅者能读到更新值 |
