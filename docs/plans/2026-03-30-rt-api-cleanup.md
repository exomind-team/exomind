# RT API 统一清理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 清理三模块（EventLog / Tasks / TimeBlock）的废弃路由、冗余别名和死代码，对齐 RT HTTP API 设计一致性。

**Architecture:** 纯删除 + 路径重命名，不改业务逻辑。Rust 端删路由/handler/测试，TS 端改路径/删死代码。

**Tech Stack:** Rust (axum routes) / TypeScript (adapters, services, MCP ports)

**关联 Issue:** #785, #786, #787

---

## 改动总览

| 步骤 | 文件 | 动作 | Issue |
|------|------|------|-------|
| 1 | `eventlog.rs` 路由表 | 删 mirror 2 行 + 改 events/:id 为 /:id + 删注释 | #785 #786 |
| 2 | `eventlog.rs` handler | 删 `mirror_status_handler` + `rebuild_handler` | #786 |
| 3 | `eventlog.rs` 测试 | 删 `mirror_status_route` + `rebuild_route` + 改 events 测试路径 | #785 #786 |
| 4 | `eventlog-rt-adapter.ts` | 改 `/eventlog/events/` → `/eventlog/` | #785 |
| 5 | `rt-eventlog-port.ts` (MCP) | 改路径 + 改注释 | #785 |
| 6 | `tasks.rs` 路由表 | 删 `.delete(delete_task)` | #787 |
| 7 | `tasks.rs` handler | 删 `delete_task` 函数 | #787 |
| 8 | `tasks.rs` 测试 | 删 `delete_route_remains_cancel_alias_for_compatibility` | #787 |
| 9 | `timeblocks.rs` 路由表 | 删 `.delete(delete_active_timeblock)` | #787 |
| 10 | `timeblocks.rs` handler | 删 `delete_active_timeblock` 函数 | #787 |
| 11 | `timeblocks.rs` 测试 | 删 `delete_active_returns_409_deprecated` | #787 |
| 12 | `timeblock-rt-adapter.ts` | 删 `deleteActiveBlock()` 方法 | #787 |
| 13 | `timeblock.service.ts` | 删 port 接口中 `deleteActiveBlock` 定义 | #787 |

---

### Task 1: EventLog — 删 mirror 路由 + handler + 测试 (#786)

**Files:**
- Modify: `crates/exomind-runtime/src/routes/eventlog.rs`

**Step 1: 删路由注册（2 行 + 注释 2 行）**

```
eventlog.rs:542-545 删除:
        // Mirror sub-routes use a distinct prefix to avoid conflict with
        // the dynamic `:id` capture below.
        .route("/eventlog/mirror/status", get(mirror_status_handler))
        .route("/eventlog/mirror/rebuild", post(rebuild_handler))
```

**Step 2: 删 handler 函数**

```
eventlog.rs:426-448 删除整块:
/// GET /eventlog/mirror-status — ...
async fn mirror_status_handler(...) { ... }

/// POST /eventlog/rebuild — ...
async fn rebuild_handler(...) { ... }
```

**Step 3: 删测试**

```
eventlog.rs:1321-1399 删除两个测试:
    #[tokio::test]
    async fn mirror_status_route() { ... }

    #[tokio::test]
    async fn rebuild_route() { ... }
```

**Step 4: 验证编译**

Run: `cd crates/exomind-runtime && cargo check 2>&1 | tail -5`
Expected: 无 mirror 相关未使用警告，编译通过

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/routes/eventlog.rs
git commit -m "refactor(rt/eventlog): remove unused /eventlog/mirror/* endpoints (#786)"
```

---

### Task 2: EventLog — 路径 /eventlog/events/:id → /eventlog/:id (#785)

**Files:**
- Modify: `crates/exomind-runtime/src/routes/eventlog.rs`
- Modify: `src/lib/adapters/eventlog-rt-adapter.ts`
- Modify: `packages/mcp/src/ports/rt-eventlog-port.ts`

**Step 1: 改 Rust 路由**

```
eventlog.rs (Task 1 之后的新行号，原 546 行附近):
改: .route("/eventlog/events/:id", get(get_event))
为: .route("/eventlog/:id", get(get_event))
```

**Step 2: 改 Rust 测试路径**

```
eventlog.rs (原 1190 行附近):
改: .uri(format!("/eventlog/events/{appended_id}"))
为: .uri(format!("/eventlog/{appended_id}"))

eventlog.rs (原 1215 行附近):
改: .uri("/eventlog/events/no-such-id")
为: .uri("/eventlog/no-such-id")
```

**Step 3: 改 TS adapter**

```typescript
// src/lib/adapters/eventlog-rt-adapter.ts:115
改: this.url(`/eventlog/events/${encodeURIComponent(id)}`, target)
为: this.url(`/eventlog/${encodeURIComponent(id)}`, target)
```

**Step 4: 改 MCP port**

```typescript
// packages/mcp/src/ports/rt-eventlog-port.ts:11
改注释: *   GET    /eventlog/events/:id    → getEvent
为:      *   GET    /eventlog/:id           → getEvent

// packages/mcp/src/ports/rt-eventlog-port.ts:59
改: `${this.baseUrl}/eventlog/events/${encodeURIComponent(id)}?...`
为: `${this.baseUrl}/eventlog/${encodeURIComponent(id)}?...`
```

**Step 5: 验证编译**

Run: `cd crates/exomind-runtime && cargo check 2>&1 | tail -5`
Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: 两者均通过

**Step 6: Commit**

```bash
git add crates/exomind-runtime/src/routes/eventlog.rs \
       src/lib/adapters/eventlog-rt-adapter.ts \
       packages/mcp/src/ports/rt-eventlog-port.ts
git commit -m "refactor(rt/eventlog): simplify /eventlog/events/:id to /eventlog/:id (#785)"
```

---

### Task 3: Tasks — 删 DELETE 别名 (#787)

**Files:**
- Modify: `crates/exomind-runtime/src/routes/tasks.rs`

**Step 1: 改路由注册（删 .delete）**

```rust
// tasks.rs:648-651
改:
        .route(
            "/tasks/:id",
            get(get_task).put(update_task).delete(delete_task),
        )
为:
        .route(
            "/tasks/:id",
            get(get_task).put(update_task),
        )
```

**Step 2: 删 handler 函数**

```
tasks.rs:336-352 删除整块:
/// DELETE /tasks/:id — compatibility alias for cancel
async fn delete_task(...) { ... }
```

注意：`delete_task` 下方紧接的是 `async fn export_tasks_json`（原 354 行），不要误删。

**Step 3: 删测试**

```
tasks.rs:1397-1434 删除:
    #[tokio::test]
    async fn delete_route_remains_cancel_alias_for_compatibility() { ... }
```

**Step 4: 验证编译**

Run: `cd crates/exomind-runtime && cargo check 2>&1 | tail -5`
Expected: 通过，无 delete_task 相关警告

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/routes/tasks.rs
git commit -m "refactor(rt/tasks): remove DELETE /tasks/:id compatibility alias (#787)"
```

---

### Task 4: TimeBlock — 删 DELETE 废弃端点 + TS 死代码 (#787)

**Files:**
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Modify: `src/lib/adapters/timeblock-rt-adapter.ts`
- Modify: `src/lib/services/timeblock.service.ts`

**Step 1: 改路由注册（删 .delete）**

```rust
// timeblocks.rs:1025-1030
改:
        .route(
            "/timeblocks/active",
            get(get_active_timeblock)
                .put(put_active_timeblock)
                .delete(delete_active_timeblock),
        )
为:
        .route(
            "/timeblocks/active",
            get(get_active_timeblock)
                .put(put_active_timeblock),
        )
```

**Step 2: 删 Rust handler 函数**

```
timeblocks.rs:713-726 删除整块:
/// DELETE /timeblocks/active — **DEPRECATED** (#780 legacy cleanup).
/// ...
async fn delete_active_timeblock() -> (StatusCode, Json<ErrorResponse>) { ... }
```

注意：`fn is_timeblock_ended` 紧接其后（原 728 行），不要误删。

**Step 3: 删 Rust 测试**

```
timeblocks.rs:1526-1550 删除:
    #[tokio::test]
    /// DELETE /timeblocks/active is deprecated (#780) and returns 409.
    async fn delete_active_returns_409_deprecated() { ... }
```

**Step 4: 删 TS adapter 死代码**

```typescript
// src/lib/adapters/timeblock-rt-adapter.ts:87-94 删除整块:
  /**
   * @deprecated DELETE /timeblocks/active returns 409 since #780 legacy cleanup.
   * Use rtEndBlock() or rtStopBlock() instead. Retained only for interface compliance.
   */
  async deleteActiveBlock(): Promise<void> {
    console.warn('[TB-RT] deleteActiveBlock is deprecated. Use rtEndBlock() or rtStopBlock(). See #780.');
  }
```

**Step 5: 删 TS port 接口定义**

```typescript
// src/lib/services/timeblock.service.ts:66, 删除这一行:
  /** @deprecated No callers remain. Route returns 409 since #780 cleanup. */
  deleteActiveBlock(): Promise<void>;
```

**Step 6: 验证编译**

Run: `cd crates/exomind-runtime && cargo check 2>&1 | tail -5`
Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: 两者均通过

**Step 7: Commit**

```bash
git add crates/exomind-runtime/src/routes/timeblocks.rs \
       src/lib/adapters/timeblock-rt-adapter.ts \
       src/lib/services/timeblock.service.ts
git commit -m "refactor(rt/timeblocks): remove deprecated DELETE /timeblocks/active + TS dead code (#787)"
```

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| eventlog mirror 路由已移除 | `cargo test mirror` | 无匹配测试（已删） | #786 |
| eventlog 单条查询新路径 | 测试中 `/eventlog/:id` | 200 + EventRecord | #785 |
| eventlog 子路由无冲突 | `/eventlog/watch` `/eventlog/backup/json` 等 | 正常 200 | #785 |
| tasks DELETE 已移除 | `cargo test delete_route` | 无匹配测试 | #787 |
| tasks cancel 正常 | `POST /tasks/:id/cancel` | 200 + cancelled task | #787 |
| timeblock DELETE 已移除 | `cargo test delete_active` | 无匹配测试 | #787 |
| timeblock end 正常 | `POST /timeblocks/end` | 正常结束 | #787 |
| TS 编译通过 | `npx tsc --noEmit` | 0 errors | all |
| Rust 编译通过 | `cargo check` | no errors | all |

## ⚠️ 不要做清单

- 不要改 `POST /tasks/:id/cancel` 的逻辑
- 不要改 `POST /timeblocks/end` 的逻辑
- 不要删 `DELETE /eventlog`（清空事件，正式功能）
- 不要删 `POST /tasks/batch-transition`（Agent 预留）
- 不要删 `/timeblocks/new`（Agent 原语）
- 不要删 `/timeblocks/describe`（Agent 原语）
- 不要删 `*/backend/status`（前端备份服务有消费）
- 不要改 handler 内部业务逻辑
- 不要加兼容层或 deprecation 中间件
