# 批次 N：RT 任务 API 增强

> **状态**：已完成（代码、测试、`9124`/build55 验收、提交推送均已完成；CI 跟踪中）
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#683, #689, #686, #687, #688, #460, #673, #672
> **执行顺序**：#683 → #689 → #686 → #687 → #688 → #460 → #673 → #672
> **下游批次**：N 完成后解锁 O/P/Q/W

---

## Context

### 当前代码状态

**任务状态机**（`crates/exomind-runtime/src/task/types.rs`）：
- 5 状态：`Pending → InProgress ⇌ Suspended → Completed / Cancelled`
- `valid_transitions()` 严格：Pending 只能到 InProgress，InProgress 可到 Suspended/Completed/Cancelled
- `is_terminal()` 识别 Completed/Cancelled

**任务存储**（`crates/exomind-runtime/src/task/store.rs` + `sqlite_store.rs`）：
- 双后端：Memory + SQLite
- `validate_terminal_task_update()` 仅冻结 `depends_on` 和 `estimated_minutes`，不冻结 `title`
- `transition_scoped()` 返回 `(old_status, Task)`
- SQLite schema：`tasks` 表含 `scope_key, id, title, status, priority, tags_json, parent_id, ...`

**任务路由**（`crates/exomind-runtime/src/routes/tasks.rs`）：
- `PUT /tasks/:id` → `update_task` handler，调用 `task_store.update_scoped()`
- `POST /tasks/:id/transition` → `transition_task` handler
- `GET /tasks?status=X` → 已支持单 status 过滤，不支持 tag/parent_id
- 无 batch-transition 端点
- transition 时发布 `task.transitioned` SignalEvent

**EventLog**（`crates/exomind-runtime/src/routes/eventlog.rs` + `src/eventlog.rs`）：
- HTTP 端点已完整：GET/POST/DELETE /eventlog, watch, mirror, backup/import
- `EventRecord { id, timestamp, content, tags, metadata }`
- `append_event(user_id, event)` 写入 + markdown 镜像同步
- 当前**不存在**任务状态变更自动写入 eventlog 的逻辑
- 当前**不存在**时间块生命周期事件自动写入 eventlog 的逻辑

**时间块**（`crates/exomind-runtime/src/routes/timeblocks.rs` + `src/timeblock.rs`）：
- `PUT /timeblocks/active` 写入活跃时间块
- `DELETE /timeblocks/active` 删除活跃时间块
- 无事件日志联动

**AppState** 包含：`task_store`, `eventlog_store`, `timeblock_store`, `signal_pool`, `host_id`

### 本批次范围

8 个 issue，全部在 Rust RT crate 内完成，涉及：
1. 字段冻结策略扩展（title 终态冻结）
2. 批量迁移端点
3. 服务端过滤查询
4. 状态机跳步
5. EventLog 端点已存在（#460 Phase 1 已完成，剩余 MCP 迁移部分）
6. 任务/时间块事件自动写入 eventlog

## 当前任务清单（2026-03-26）

- [x] 完成 #683 / #689：终态任务 `title` / `description` 均不可修改，路由返回 `409 Conflict`
- [x] 完成 #686：`POST /tasks/batch-transition` 支持全部成功与部分失败
- [x] 完成 #687：`GET /tasks` 支持 `status` / `tag` / `parent_id` 组合过滤
- [x] 完成 #688：`POST /tasks/:id/transition?shortcut=true` 支持快捷跳步
- [x] 完成 #460：RT EventLog HTTP 端点可用，Web 侧默认走 RT 适配链路
- [x] 完成 #673：任务状态迁移自动写入 EventLog，并改为人性化动作消息
- [x] 完成 #672：时间块 `start/pause/resume/end` 全生命周期自动写入 EventLog
- [x] 完成本轮联动收敛：任务与事件流默认 RT 化、旧前端适配器标记弃用、任务列表支持热更新
- [x] 修复 reviewer 补充回归：Web + RT 事件追加/投影统一走 RT EventLog，`task.cancelled` 纳入前端热更新链路
- [x] 依据更新后的验收 HTML 跑满全部手工验收项（`9124` / `anonymous` / build55 环境）
- [x] 串行补齐最终基线验证：`cargo build -p exomind-runtime`、`cargo test -p exomind-runtime`、`cargo clippy -p exomind-runtime -- -D warnings`
- [x] 补跑前端 RT 回归验证：`npx tsc --noEmit`、相关 Vitest 回归集、`9124` 本地 RT curl 复验
- [x] 汇总命令、预期、实际结果与因果说明，完成提交、推送并继续跟踪 CI

---

## 步骤 1：#683 终态任务 title / description 冻结（设计定论）

**结论**：`title` 与 `description` 在 `pending/in_progress/suspended` 均可修改，仅 `completed/cancelled` 冻结。

### 1.1 改动

**文件**：`crates/exomind-runtime/src/task/store.rs`

在 `validate_terminal_task_update()` 函数中新增 `title` / `description` 检查：

```rust
// ★ 新增：冻结 title / description
pub(crate) const TASK_FIELD_TITLE: &str = "title";
pub(crate) const TASK_FIELD_DESCRIPTION: &str = "description";

pub(crate) fn validate_terminal_task_update(
    status: TaskStatus,
    input: &UpdateTaskInput,
) -> Result<(), TaskStoreError> {
    if !status.is_terminal() {
        return Ok(());
    }

    if input.title.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_TITLE,
        });
    }

    if input.description.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_DESCRIPTION,
        });
    }

    if input.depends_on.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_DEPENDS_ON,
        });
    }

    if input.estimated_minutes.is_some() {
        return Err(TaskStoreError::TerminalFieldImmutable {
            status,
            field: TASK_FIELD_ESTIMATED_MINUTES,
        });
    }

    Ok(())
}
```

**文件**：`crates/exomind-runtime/src/task/mod.rs`

导出新常量：

```rust
pub use store::{TaskStore, TaskStoreBackendKind};
// ★ 如需要在 routes 层引用常量，可额外 pub use
```

### 1.2 验证

```bash
cargo test -p exomind-runtime -- task::store::tests::update_terminal_task
cargo test -p exomind-runtime -- routes::tasks::tests::update_terminal
cargo clippy -p exomind-runtime
```

新增测试（在 `store.rs` tests 模块）：

```rust
#[test]
fn update_terminal_task_rejects_title_and_description_changes() {
    let store = make_store();
    let task = store.create(create_input("Done task"));
    store.transition(&task.id, TaskStatus::InProgress).unwrap();
    store.transition(&task.id, TaskStatus::Completed).unwrap();

    let result = store.update(
        &task.id,
        UpdateTaskInput {
            title: Some("New name".to_string()),
            description: Some("New note".to_string()),
            done_condition: None,
            priority: None,
            tags: None,
            depends_on: None,
            due_at: None,
            estimated_minutes: None,
            parent_id: None,
            time_block_ids: None,
        },
    );
    assert!(matches!(
        result,
        Err(TaskStoreError::TerminalFieldImmutable {
            field: TASK_FIELD_TITLE | TASK_FIELD_DESCRIPTION,
            ..
        })
    ));
}
```

---

## 步骤 2：#689 PUT 终态任务 title / description 应拒绝修改

### 2.1 改动

步骤 1 的 `validate_terminal_task_update()` 改动已涵盖此 issue 的核心逻辑。

**文件**：`crates/exomind-runtime/src/routes/tasks.rs`

修改现有测试 `update_terminal_task_allows_non_frozen_fields`（行 651-694）：

当前测试断言终态仍允许部分文案修改，**需要改为断言 title / description 返回 409 CONFLICT**：

```rust
// ★ 修改：原测试 update_terminal_task_allows_non_frozen_fields
// title / description 在终态都应返回 409
```

新增路由层测试：

```rust
// setup: create task → in_progress → completed
// PUT {"title": "New name"} → assert 409
// PUT {"description": "New note"} → assert 409
```

### 2.2 验证

```bash
cargo test -p exomind-runtime -- routes::tasks::tests::update_terminal
cargo test -p exomind-runtime -- task::store::tests::update_terminal
```

---

## 步骤 3：#686 批量状态迁移 POST /tasks/batch-transition

### 3.1 改动

**文件**：`crates/exomind-runtime/src/task/types.rs`

新增请求/响应类型：

```rust
/// Input for batch transitioning multiple tasks.
#[derive(Debug, Clone, Deserialize)]
pub struct BatchTransitionInput {
    pub tasks: Vec<BatchTransitionItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchTransitionItem {
    pub id: String,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchTransitionResult {
    pub id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchTransitionResponse {
    pub results: Vec<BatchTransitionResult>,
    pub succeeded: usize,
    pub failed: usize,
}
```

**文件**：`crates/exomind-runtime/src/task/mod.rs`

导出新类型：

```rust
pub use types::{
    BatchTransitionInput, BatchTransitionItem, BatchTransitionResponse, BatchTransitionResult,
    CreateTaskInput, Task, TaskDependency, TaskDependencyType, TaskPriority, TaskStatus,
    TransitionInput, UpdateTaskInput,
};
```

**文件**：`crates/exomind-runtime/src/routes/tasks.rs`

新增 handler（行 182 附近，transition_task 之后）：

```rust
use crate::task::{BatchTransitionInput, BatchTransitionResponse, BatchTransitionResult};

/// POST /tasks/batch-transition
async fn batch_transition_tasks(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(input): Json<BatchTransitionInput>,
) -> Json<BatchTransitionResponse> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let mut results = Vec::with_capacity(input.tasks.len());
    let mut succeeded = 0usize;
    let mut failed = 0usize;

    for item in &input.tasks {
        match state
            .task_store
            .transition_scoped(scope_key, &item.id, item.status)
        {
            Ok((old_status, task)) => {
                // ★ 发布 signal 同单个 transition
                let event = SignalEvent {
                    schema_version: 1,
                    id: uuid::Uuid::new_v4().to_string(),
                    topic: "task.transitioned".to_string(),
                    ts: chrono::Utc::now().timestamp_millis() as u64,
                    source: "http:tasks".to_string(),
                    origin_host_id: state.host_id.clone(),
                    hop: 0,
                    trace_id: None,
                    payload: serde_json::json!({
                        "task": task,
                        "old_status": old_status,
                        "new_status": task.status,
                    }),
                };
                state.signal_pool.publish(event);

                succeeded += 1;
                results.push(BatchTransitionResult {
                    id: item.id.clone(),
                    success: true,
                    old_status: Some(old_status),
                    new_status: Some(task.status),
                    error: None,
                });
            }
            Err(e) => {
                failed += 1;
                results.push(BatchTransitionResult {
                    id: item.id.clone(),
                    success: false,
                    old_status: None,
                    new_status: None,
                    error: Some(e.to_string()),
                });
            }
        }
    }

    Json(BatchTransitionResponse {
        results,
        succeeded,
        failed,
    })
}
```

路由注册（在 `router()` 函数内新增）：

```rust
.route("/tasks/batch-transition", post(batch_transition_tasks))
```

**重要**：此路由必须在 `/tasks/:id` 之前注册，否则 `batch-transition` 会被 `:id` 参数捕获。放在 `/tasks/backend/status` 附近即可。

### 3.2 验证

```bash
cargo test -p exomind-runtime -- routes::tasks::tests::batch_transition
cargo clippy -p exomind-runtime
```

新增测试：

```rust
#[tokio::test]
async fn batch_transition_succeeds_for_valid_tasks() {
    // create 3 tasks in pending
    // transition all to in_progress → batch POST
    // assert succeeded=3, failed=0
}

#[tokio::test]
async fn batch_transition_partial_failure() {
    // create 2 tasks: one pending, one already completed
    // batch transition both to in_progress
    // assert succeeded=1, failed=1
}
```

curl 验证：

```bash
# 启动 RT 后
curl -X POST http://127.0.0.1:1949/tasks/batch-transition \
  -H 'Content-Type: application/json' \
  -d '{"tasks":[{"id":"task-1","status":"in_progress"},{"id":"task-2","status":"in_progress"}]}'
```

---

## 步骤 4：#687 按 status/tag/parent 服务端过滤查询

### 4.1 改动

**文件**：`crates/exomind-runtime/src/routes/tasks.rs`

扩展 `ListQuery`：

```rust
#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    status: Option<TaskStatus>,
    #[serde(default)]
    tag: Option<String>,           // ★ 新增：单 tag 过滤
    #[serde(default)]
    parent_id: Option<String>,     // ★ 新增：parent_id 过滤
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
}
```

修改 `list_tasks` handler：

```rust
async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Json<Vec<Task>> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let mut tasks = match &query.status {
        Some(status) => state.task_store.list_by_status_scoped(scope_key, status),
        None => state.task_store.list_scoped(scope_key),
    };

    // ★ 新增：tag 过滤（应用层）
    if let Some(tag) = &query.tag {
        tasks.retain(|t| t.tags.iter().any(|t_tag| t_tag == tag));
    }

    // ★ 新增：parent_id 过滤（应用层）
    if let Some(parent_id) = &query.parent_id {
        tasks.retain(|t| t.parent_id.as_deref() == Some(parent_id.as_str()));
    }

    Json(tasks)
}
```

**设计决策**：tag 和 parent_id 过滤在应用层实现（Rust 内存过滤），不新增 SQL 查询方法。理由：
1. 任务量级通常 < 1000，内存过滤足够快
2. 避免为每种组合新增 SQL variant
3. status 已有 SQL 层过滤（现有实现），tag/parent_id 在其结果上二次过滤

### 4.2 验证

```bash
cargo test -p exomind-runtime -- routes::tasks::tests
cargo clippy -p exomind-runtime
```

新增测试：

```rust
#[tokio::test]
async fn list_with_tag_filter() {
    // create: task A tags=["work"], task B tags=["personal"], task C tags=["work","urgent"]
    // GET /tasks?tag=work → 返回 A, C
}

#[tokio::test]
async fn list_with_parent_id_filter() {
    // create: parent task, child A (parent_id=parent.id), child B (parent_id=parent.id), orphan
    // GET /tasks?parent_id={parent.id} → 返回 child A, child B
}

#[tokio::test]
async fn list_with_combined_filters() {
    // GET /tasks?status=pending&tag=work → only pending tasks with "work" tag
}
```

curl 验证：

```bash
curl 'http://127.0.0.1:1949/tasks?status=pending&tag=复试'
curl 'http://127.0.0.1:1949/tasks?parent_id=parent-task-id'
```

---

## 步骤 5：#688 transition 支持快捷跳步

### 5.1 改动

**文件**：`crates/exomind-runtime/src/task/types.rs`

新增跳步路径查找方法：

```rust
impl TaskStatus {
    /// Find the shortest path of intermediate transitions to reach `target`.
    /// Returns None if unreachable. Returns Some(vec![]) if directly reachable.
    /// Returns Some(vec![intermediate1, intermediate2, ...]) for multi-step.
    pub fn path_to(&self, target: &TaskStatus) -> Option<Vec<TaskStatus>> {
        if self == target {
            return Some(vec![]);
        }
        if self.can_transition_to(target) {
            return Some(vec![]);  // direct, no intermediates needed
        }

        // BFS to find shortest path
        use std::collections::VecDeque;
        let mut queue: VecDeque<(TaskStatus, Vec<TaskStatus>)> = VecDeque::new();
        let mut visited = std::collections::HashSet::new();
        visited.insert(*self);

        for &next in self.valid_transitions() {
            visited.insert(next);
            if next == *target {
                return Some(vec![next]); // one intermediate
            }
            queue.push_back((next, vec![next]));
        }

        while let Some((current, path)) = queue.pop_front() {
            for &next in current.valid_transitions() {
                if next == *target {
                    let mut full_path = path;
                    full_path.push(next);
                    return Some(full_path);
                }
                if visited.insert(next) {
                    let mut new_path = path.clone();
                    new_path.push(next);
                    queue.push_back((next, new_path));
                }
            }
        }

        None // unreachable
    }
}
```

**文件**：`crates/exomind-runtime/src/task/store.rs`

新增 `transition_with_shortcut` 方法：

```rust
/// Transition with automatic intermediate steps.
/// E.g. pending → completed will auto-walk pending → in_progress → completed.
/// Returns all (old_status, new_status) pairs walked.
pub fn transition_with_shortcut(
    &self,
    id: &str,
    target_status: TaskStatus,
) -> Result<Vec<(TaskStatus, Task)>, TaskStoreError> {
    self.transition_with_shortcut_scoped(None, id, target_status)
}

pub fn transition_with_shortcut_scoped(
    &self,
    scope_key: Option<&str>,
    id: &str,
    target_status: TaskStatus,
) -> Result<Vec<(TaskStatus, Task)>, TaskStoreError> {
    let task = self
        .get_scoped(scope_key, id)
        .ok_or_else(|| TaskStoreError::NotFound(id.to_string()))?;

    if task.status == target_status {
        return Ok(vec![]);  // already at target
    }

    let path = task.status.path_to(&target_status).ok_or_else(|| {
        TaskStoreError::InvalidTransition {
            from: task.status,
            to: target_status,
        }
    })?;

    // Walk all steps: if path is empty, it's a direct transition
    let steps: Vec<TaskStatus> = if path.is_empty() || (path.len() == 1 && path[0] == target_status) {
        vec![target_status]
    } else {
        // path includes intermediates + target
        path
    };

    let mut results = Vec::new();
    for step in steps {
        let (old, updated) = self.transition_scoped(scope_key, id, step)?;
        results.push((old, updated));
    }

    Ok(results)
}
```

**文件**：`crates/exomind-runtime/src/routes/tasks.rs`

修改 `transition_task` handler 以支持 `?shortcut=true` 查询参数：

```rust
#[derive(Debug, Deserialize)]
struct TransitionQuery {
    #[serde(default)]
    profile_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    shortcut: Option<bool>,
}

async fn transition_task(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Query(query): Query<TransitionQuery>,
    Json(input): Json<TransitionInput>,
) -> Result<Json<Task>, (StatusCode, String)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let use_shortcut = query.shortcut.unwrap_or(false);

    if use_shortcut {
        let steps = state
            .task_store
            .transition_with_shortcut_scoped(scope_key, &id, input.status)
            .map_err(|e| {
                let code = match &e {
                    TaskStoreError::NotFound(_) => StatusCode::NOT_FOUND,
                    _ => StatusCode::CONFLICT,
                };
                (code, e.to_string())
            })?;

        // Publish signal for each step
        for (old_status, task) in &steps {
            let event = SignalEvent { /* same as existing */ };
            state.signal_pool.publish(event);
        }

        // Return final task state
        let final_task = steps
            .last()
            .map(|(_, t)| t.clone())
            .ok_or_else(|| (StatusCode::CONFLICT, "task already at target status".to_string()))?;

        Ok(Json(final_task))
    } else {
        // ★ 保留现有逻辑不变
        let (old_status, task) = state
            .task_store
            .transition_scoped(scope_key, &id, input.status)
            .map_err(|e| { /* existing error mapping */ })?;
        // ... existing signal publish ...
        Ok(Json(task))
    }
}
```

**同时更新 batch-transition**：batch-transition 也应支持 shortcut 模式。在 `BatchTransitionInput` 中新增可选字段：

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct BatchTransitionInput {
    pub tasks: Vec<BatchTransitionItem>,
    #[serde(default)]
    pub shortcut: Option<bool>,
}
```

### 5.2 验证

```bash
cargo test -p exomind-runtime -- task::types::tests
cargo test -p exomind-runtime -- task::store::tests
cargo test -p exomind-runtime -- routes::tasks::tests
```

新增测试：

```rust
// types.rs
#[test]
fn path_to_finds_shortcut() {
    assert_eq!(
        TaskStatus::Pending.path_to(&TaskStatus::Completed),
        Some(vec![TaskStatus::InProgress, TaskStatus::Completed])
    );
    assert_eq!(
        TaskStatus::Pending.path_to(&TaskStatus::Cancelled),
        Some(vec![TaskStatus::InProgress, TaskStatus::Cancelled])
    );
    // direct transition: no intermediates
    assert_eq!(
        TaskStatus::Pending.path_to(&TaskStatus::InProgress),
        Some(vec![])
    );
    // terminal → anything: unreachable
    assert_eq!(TaskStatus::Completed.path_to(&TaskStatus::Pending), None);
}

// store.rs
#[test]
fn transition_with_shortcut_walks_intermediates() {
    let store = make_store();
    let task = store.create(create_input("Shortcut task"));
    let steps = store
        .transition_with_shortcut(&task.id, TaskStatus::Completed)
        .unwrap();
    assert_eq!(steps.len(), 2);  // pending→in_progress, in_progress→completed
    assert_eq!(steps[0].0, TaskStatus::Pending);
    assert_eq!(steps[1].0, TaskStatus::InProgress);
    let final_task = store.get(&task.id).unwrap();
    assert_eq!(final_task.status, TaskStatus::Completed);
}

// routes::tasks tests
#[tokio::test]
async fn transition_shortcut_pending_to_completed() {
    // POST /tasks/:id/transition?shortcut=true {"status":"completed"}
    // from pending → assert 200, status=completed
}
```

curl 验证：

```bash
curl -X POST 'http://127.0.0.1:1949/tasks/TASK_ID/transition?shortcut=true' \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed"}'
```

---

## 步骤 6：#460 RT 新增 EventLog HTTP 端点 + MCP 迁移至 RT

### 6.1 改动

**Phase 1（RT EventLog 端点）已完成**。当前 `routes/eventlog.rs` 已实现完整的 CRUD、watch、mirror、backup/import 端点。

**剩余工作**：MCP 迁移至 RT（TypeScript 侧）。

> **注意**：本批次仅做 Rust 侧工作。MCP TypeScript 迁移不在 Termux 环境 Rust 范围内，应标记为已完成 Phase 1，Phase 2 (MCP) 留给后续批次。

**Rust 侧检查**：确认所有端点工作正常即可。如有缺失，补充以下：

1. 确认 `/eventlog` 端点已在 `routes/mod.rs` 注册 ✅（`eventlog::router()` 已 merge）
2. 确认 `eventlog_store` 在 `AppState` 中 ✅
3. 无需额外 Rust 代码改动

### 6.2 验证

```bash
cargo test -p exomind-runtime -- routes::eventlog::tests
cargo build -p exomind-runtime
```

curl 验证：

```bash
# 启动 RT 后
curl -sS http://127.0.0.1:1949/eventlog | head -c 200
curl -X POST http://127.0.0.1:1949/eventlog \
  -H 'Content-Type: application/json' \
  -d '{"timestamp":1711000000000,"content":"test from curl","tags":["note"]}'
```

---

## 步骤 7：#673 任务状态变更自动写入 eventlog

### 7.1 改动

**文件**：`crates/exomind-runtime/src/routes/tasks.rs`

在 `transition_task` handler 中，transition 成功后调用 `eventlog_store.append_event()`：

```rust
async fn transition_task(
    // ... existing params ...
) -> Result<Json<Task>, (StatusCode, String)> {
    // ... existing transition logic ...

    // ★ 新增：写入 eventlog
    let scope_key_for_eventlog = query.profile_id.as_deref().or(query.user_id.as_deref());
    let eventlog_event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        content: format!(
            "任务状态变更: {} ({} → {})",
            task.title,
            serde_json::to_string(&old_status).unwrap_or_default().trim_matches('"'),
            serde_json::to_string(&task.status).unwrap_or_default().trim_matches('"'),
        ),
        tags: vec!["task_transition".to_string()],
        metadata: Some(serde_json::json!({
            "task_id": task.id,
            "old_status": old_status,
            "new_status": task.status,
            "task_title": task.title,
            "source": {
                "app": "exomind-runtime",
                "trigger": "http:tasks/transition"
            }
        })),
    };

    // Best-effort: log error but don't fail the transition
    if let Err(e) = state.eventlog_store.append_event(
        scope_key_for_eventlog,
        eventlog_event,
    ) {
        tracing::warn!(error = %e, "failed to write task transition to eventlog");
    }

    Ok(Json(task))
}
```

**同样在 `cancel_task` handler 中新增**：

```rust
async fn cancel_task(/* ... */) -> Result<Json<Task>, (StatusCode, String)> {
    // ... existing cancel logic ...

    // ★ 新增：写入 eventlog
    let eventlog_event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        content: format!("任务已取消: {}", task.title),
        tags: vec!["task_transition".to_string()],
        metadata: Some(serde_json::json!({
            "task_id": task.id,
            "old_status": "in_progress_or_suspended",  // cancel 不保留 old_status
            "new_status": "cancelled",
            "task_title": task.title,
            "source": { "app": "exomind-runtime", "trigger": "http:tasks/cancel" }
        })),
    };
    let _ = state.eventlog_store.append_event(scope_key, eventlog_event);

    Ok(Json(task))
}
```

**抽取辅助函数避免重复**：

```rust
fn write_task_transition_eventlog(
    state: &AppState,
    scope_key: Option<&str>,
    task: &Task,
    old_status: TaskStatus,
    trigger: &str,
) {
    let old_str = serde_json::to_string(&old_status)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    let new_str = serde_json::to_string(&task.status)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    let event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        content: format!("任务状态变更: {} ({} → {})", task.title, old_str, new_str),
        tags: vec!["task_transition".to_string()],
        metadata: Some(serde_json::json!({
            "task_id": task.id,
            "old_status": old_status,
            "new_status": task.status,
            "task_title": task.title,
            "source": {
                "app": "exomind-runtime",
                "trigger": trigger
            }
        })),
    };

    if let Err(e) = state.eventlog_store.append_event(scope_key, event) {
        tracing::warn!(error = %e, "failed to write task transition to eventlog");
    }
}
```

**同时在 `batch_transition_tasks` handler 中，每个成功迁移也调用此函数。**

### 7.2 验证

```bash
cargo test -p exomind-runtime -- routes::tasks::tests
cargo clippy -p exomind-runtime
```

新增测试：

```rust
#[tokio::test]
async fn transition_writes_eventlog() {
    // setup: test_state with tempdir eventlog_store
    // create task → transition to in_progress
    // assert eventlog_store.list_events(None) contains 1 event with tag "task_transition"
}
```

curl 验证：

```bash
# transition a task, then check eventlog
curl -X POST http://127.0.0.1:1949/tasks/TASK_ID/transition \
  -H 'Content-Type: application/json' -d '{"status":"in_progress"}'
curl http://127.0.0.1:1949/eventlog?tags=task_transition
```

---

## 步骤 8：#672 时间块生命周期事件由 RT 自动写入 eventlog

### 8.1 改动

**文件**：`crates/exomind-runtime/src/routes/timeblocks.rs`

在 `put_active_timeblock` handler 中写入 block_start 事件：

```rust
async fn put_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
    Json(payload): Json<ActiveBlockData>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let normalized = payload.normalize_task_ids();

    // ★ 检查是否是新 block（之前无 active）或更新
    let existing_active = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    let is_new_block = existing_active.is_none()
        || existing_active
            .as_ref()
            .map(|b| b.start_id != normalized.start_id)
            .unwrap_or(true);

    state
        .timeblock_store
        .put_active_scoped(scope_key, normalized.clone())
        .map_err(|error| internal_error(error.to_string()))?;

    // ★ 新增：写入 block_start 事件
    if is_new_block {
        write_timeblock_eventlog(
            &state,
            scope_key,
            "block_start",
            &normalized.name,
            &normalized.start_id,
            &normalized.task_ids,
        );
    }

    Ok(StatusCode::NO_CONTENT)
}
```

在 `delete_active_timeblock` handler 中写入 block_end 事件：

```rust
async fn delete_active_timeblock(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());

    // ★ 读取当前活跃块信息用于 eventlog
    let active = state
        .timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    state
        .timeblock_store
        .delete_active_scoped(scope_key)
        .map_err(|error| internal_error(error.to_string()))?;

    // ★ 新增：写入 block_end 事件
    if let Some(block) = active {
        write_timeblock_eventlog(
            &state,
            scope_key,
            "block_end",
            &block.name,
            &block.start_id,
            &block.task_ids,
        );
    }

    Ok(StatusCode::NO_CONTENT)
}
```

对于 pause/resume，需检测 `put_active_timeblock` 中 `paused` 字段的变化：

```rust
// 在 put_active_timeblock 中，is_new_block 之后
if !is_new_block {
    if let Some(ref existing) = existing_active {
        if !existing.paused && normalized.paused {
            write_timeblock_eventlog(
                &state, scope_key, "block_pause",
                &normalized.name, &normalized.start_id, &normalized.task_ids,
            );
        } else if existing.paused && !normalized.paused {
            write_timeblock_eventlog(
                &state, scope_key, "block_resume",
                &normalized.name, &normalized.start_id, &normalized.task_ids,
            );
        }
    }
}
```

辅助函数：

```rust
fn write_timeblock_eventlog(
    state: &AppState,
    scope_key: Option<&str>,
    event_type: &str,  // "block_start", "block_end", "block_pause", "block_resume"
    block_name: &str,
    start_id: &str,
    task_ids: &[String],
) {
    let content = match event_type {
        "block_start" => format!("时间块开始: {}", block_name),
        "block_end" => format!("时间块结束: {}", block_name),
        "block_pause" => format!("时间块暂停: {}", block_name),
        "block_resume" => format!("时间块恢复: {}", block_name),
        _ => format!("时间块事件: {}", block_name),
    };

    let event = crate::eventlog::EventRecord {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        content,
        tags: vec![event_type.to_string()],
        metadata: Some(serde_json::json!({
            "block_name": block_name,
            "start_id": start_id,
            "task_ids": task_ids,
            "source": {
                "app": "exomind-runtime",
                "trigger": format!("http:timeblocks/{}", event_type)
            }
        })),
    };

    // eventlog user_id 使用与 scope_key 同样的逻辑
    let eventlog_user_id = scope_key;
    if let Err(e) = state.eventlog_store.append_event(eventlog_user_id, event) {
        tracing::warn!(error = %e, "failed to write timeblock event to eventlog");
    }
}
```

### 8.2 验证

```bash
cargo test -p exomind-runtime -- routes::timeblocks::tests
cargo test -p exomind-runtime -- routes::tasks::tests
cargo clippy -p exomind-runtime
cargo build -p exomind-runtime
```

新增测试：

```rust
#[tokio::test]
async fn put_active_writes_block_start_to_eventlog() {
    // setup: test_state_with_timeblock_store + tempdir eventlog_store
    // PUT /timeblocks/active → check eventlog has block_start event
}

#[tokio::test]
async fn delete_active_writes_block_end_to_eventlog() {
    // PUT active → DELETE active → check eventlog has block_start + block_end
}

#[tokio::test]
async fn put_active_pause_writes_block_pause_to_eventlog() {
    // PUT active (paused=false) → PUT active (paused=true) → check block_pause event
}
```

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `crates/exomind-runtime/src/task/types.rs` | 新增类型 + path_to 方法 | #686, #688 |
| `crates/exomind-runtime/src/task/store.rs` | 修改 validate + 新增 shortcut | #683, #689, #688 |
| `crates/exomind-runtime/src/task/mod.rs` | 导出新类型 | #686, #688 |
| `crates/exomind-runtime/src/task/sqlite_store.rs` | 无改动（复用现有方法） | — |
| `crates/exomind-runtime/src/routes/tasks.rs` | 新增 handler + 修改 handler + eventlog 联动 | #686, #687, #688, #689, #673 |
| `crates/exomind-runtime/src/routes/timeblocks.rs` | 新增 eventlog 联动 | #672 |
| `crates/exomind-runtime/src/routes/eventlog.rs` | 无改动（已完整） | #460 |
| `crates/exomind-runtime/src/eventlog.rs` | 无改动（已完整） | — |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| 不要修改 `TaskStatus::valid_transitions()` 的定义 | 状态机规则不变，shortcut 是上层逻辑 |
| 不要修改 SQLite schema（tasks 表） | 本批次无需新列 |
| 不要修改 `eventlog.rs` 或 `eventlog_sqlite.rs` 核心逻辑 | EventLog 存储层已稳定 |
| 不要修改 `timeblock.rs` 或 `timeblock_sqlite.rs` 核心逻辑 | TimeBlock 存储层已稳定 |
| 不要引入新 crate 依赖 | 用已有的 serde_json, chrono, uuid, tracing 即可 |
| 不要修改前端 TypeScript 代码 | 本批次仅 Rust |
| 不要修改 MCP TypeScript 代码 | Phase 2 (MCP迁移) 留给后续批次 |
| 不要让 eventlog 写入失败阻塞 HTTP 响应 | eventlog 写入必须 best-effort，用 `if let Err` |
| 不要在 batch-transition 中使用数据库事务包裹全部任务 | 部分成功模式：每个任务独立，一个失败不影响其他 |
| 不要删除或重命名现有的 `update_terminal_task_allows_non_frozen_fields` 测试 | 修改其断言内容即可，保留测试名（或合理重命名） |

---

## ⚠️ 容易出错的关键点

1. **路由顺序**：`/tasks/batch-transition` 必须在 `/tasks/:id` 之前注册，否则 axum 会把 `batch-transition` 当作 `:id` 参数。当前代码中 `/tasks/backend/status` 和 `/tasks/backup/*` 已正确在 `/tasks/:id` 之前，新路由放在同一位置。

2. **eventlog user_id vs task scope_key**：任务使用 `profile_id`/`user_id` query param 做 scope 隔离，eventlog 使用 `user_id`。写入 eventlog 时需传入相同的 scope 值，注意 `ScopeQuery` 优先取 `profile_id`，再取 `user_id`。

3. **`TaskStatus` 的 serde 输出格式**：`serde_json::to_string(&TaskStatus::InProgress)` 输出 `"in_progress"`（带引号），写入 eventlog content 时需 `trim_matches('"')`。

4. **shortcut 的 path_to 返回值语义**：`path_to()` 返回的是**中间步骤列表**。如果直接可达，返回 `Some(vec![])`。实际执行时需要区分：直接可达 = 只走一步到 target；需要中间步骤 = 按 path 逐步走。

5. **`validate_terminal_task_update` 影响范围**：现有测试 `update_terminal_task_allows_non_frozen_fields`（routes/tasks.rs:651）断言终态 title 修改返回 200，改为冻结后此测试会失败。必须同步修改测试。

6. **batch-transition 中 shortcut + eventlog 联动**：如果 batch-transition 同时支持 shortcut，每个中间步骤都应发布 signal 和写入 eventlog。确保不遗漏。

7. **timeblock pause/resume 检测**：`put_active_timeblock` 被调用时可能是首次创建、更新时间、或 pause/resume。需要正确比较 `existing_active.paused` vs `normalized.paused` 来判断事件类型。

8. **cancel_task 中获取 old_status**：当前 `cancel_task_in_scope()` 只返回 `Task`，不返回 old_status。写入 eventlog 需要 old_status。可以在 cancel 前先 `get_scoped` 获取，或修改 `cancel_scoped` 返回 `(TaskStatus, Task)`。

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 终态 title 冻结 | PUT /tasks/:id `{"title":"x"}` on completed task | 409 Conflict | #683, #689 |
| 终态 description 冻结 | PUT /tasks/:id `{"description":"x"}` on completed task | 409 Conflict | #683, #689 |
| 批量迁移-全部成功 | POST /tasks/batch-transition, 3 valid tasks | 200, succeeded=3, failed=0 | #686 |
| 批量迁移-部分失败 | POST /tasks/batch-transition, 1 valid + 1 invalid | 200, succeeded=1, failed=1 | #686 |
| tag 过滤 | GET /tasks?tag=work | 只返回含 "work" tag 的任务 | #687 |
| parent_id 过滤 | GET /tasks?parent_id=X | 只返回 parent_id=X 的任务 | #687 |
| 组合过滤 | GET /tasks?status=pending&tag=work | 交集 | #687 |
| 快捷跳步 | POST /tasks/:id/transition?shortcut=true `{"status":"completed"}` from pending | 200, status=completed | #688 |
| 快捷跳步不影响直接迁移 | POST /tasks/:id/transition `{"status":"in_progress"}` from pending (无 shortcut) | 200, 正常 | #688 |
| EventLog 端点存在 | GET /eventlog | 200 | #460 |
| 任务迁移写 eventlog | POST /tasks/:id/transition → GET /eventlog?tags=task_started | eventlog 中有动作化事件 | #673 |
| 批量迁移写 eventlog | POST /tasks/batch-transition → GET /eventlog?tags=task_started | 每个成功迁移一条记录 | #673 |
| 时间块开始写 eventlog | PUT /timeblocks/active (新块) → GET /eventlog?tags=block_start | eventlog 中有 block_start | #672 |
| 时间块结束写 eventlog | DELETE /timeblocks/active → GET /eventlog?tags=block_end | eventlog 中有 block_end | #672 |
| 时间块暂停写 eventlog | PUT /timeblocks/active (paused: true) → GET /eventlog?tags=block_pause | eventlog 中有 block_pause | #672 |
| 时间块恢复写 eventlog | PUT /timeblocks/active (paused: false) → GET /eventlog?tags=block_resume | eventlog 中有 block_resume | #672 |
| 全量构建 | cargo build -p exomind-runtime | 编译通过 | ALL |
| 全量测试 | cargo test -p exomind-runtime | 全部通过 | ALL |
| clippy 检查 | cargo clippy -p exomind-runtime | 无 warning | ALL |

---

## 完成回填

> （Codex 执行后填写）

| 步骤 | Issue | 状态 | commit hash | 备注 |
|------|-------|------|-------------|------|
| 1 | #683 | | | |
| 2 | #689 | | | |
| 3 | #686 | | | |
| 4 | #687 | | | |
| 5 | #688 | | | |
| 6 | #460 | | | |
| 7 | #673 | | | |
| 8 | #672 | | | |
