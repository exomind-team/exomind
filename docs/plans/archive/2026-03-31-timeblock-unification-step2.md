# TimeBlock 统一数据结构 Step 2: Rust transitions + SQLite 持久化

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Rust RT 成为 transitions 的唯一真相源——所有新路由写 transitions，SQLite 持久化，前端只读。

**Architecture:** 在 Rust struct 和 SQLite 中加 transitions 字段，让 do_new_block + stop/pause/resume 路由在内部写 transitions，active block 通过 JSON blob 自动支持，completed blocks 需要 ALTER TABLE。

**Tech Stack:** Rust, axum, SQLite (rusqlite), serde_json

---

## Task 1: Rust BlockTransition struct + transitions 字段

**Files:**
- Modify: `crates/exomind-runtime/src/timeblock.rs`

**Step 1: 在 BlockTaskAssociationEvent 之前添加 BlockTransition struct**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockTransition {
    #[serde(rename = "type")]
    pub transition_type: String,
    pub at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
}
```

**Step 2: 给 TimeBlockData 加 transitions 字段**

在 `source_planned_block_id` 之后添加：
```rust
#[serde(default)]
pub transitions: Vec<BlockTransition>,
```

**Step 3: 给 ActiveBlockData 加 transitions 字段**

同样位置添加：
```rust
#[serde(default)]
pub transitions: Vec<BlockTransition>,
```

**Step 4: cargo check**

Run: `cargo check -p exomind-runtime`
Expected: 零错误（serde(default) 保证向后兼容）

**Step 5: 更新所有测试中的 struct 构造**

在 tests 中搜索 `TimeBlockData {` 和 `ActiveBlockData {`，添加 `transitions: vec![],`

Run: `cargo check -p exomind-runtime --tests`

**Step 6: Commit**

```bash
git add crates/exomind-runtime/src/timeblock.rs crates/exomind-runtime/tests/
git commit -m "feat(runtime): add BlockTransition struct + transitions field for #780"
```

---

## Task 2: SQLite 迁移 — completed_timeblocks 加 transitions_json 列

**Files:**
- Modify: `crates/exomind-runtime/src/timeblock_sqlite.rs`

**Step 1: init() 中添加 ALTER TABLE 迁移**

在 `block_type` 迁移之后添加：
```rust
let columns = completed_timeblock_columns(&connection)?;
if !columns.iter().any(|column| column == "transitions_json") {
    connection.execute(
        "ALTER TABLE completed_timeblocks ADD COLUMN transitions_json TEXT NOT NULL DEFAULT '[]'",
        [],
    )?;
}
```

**Step 2: CREATE TABLE 加 transitions_json**

在 completed_timeblocks 的 CREATE TABLE 中，block_type 之后加：
```sql
transitions_json TEXT NOT NULL DEFAULT '[]',
```

**Step 3: SELECT 加 transitions_json**

在 `list_completed_scoped` 的 SELECT 中加 `transitions_json`，在 row mapping 中解析：
```rust
transitions: serde_json::from_str::<Vec<BlockTransition>>(&row.get::<_, String>(N)?)
    .map_err(to_sqlite_conversion_error)?,
```

**Step 4: INSERT 加 transitions_json**

在 `replace_completed_scoped` 的 INSERT 中加列和参数：
```rust
serde_json::to_string(&block.transitions)?,
```

**Step 5: 导入 BlockTransition**

确保 `use crate::timeblock::BlockTransition;` 在文件顶部。

**Step 6: cargo check + cargo check --tests**

**Step 7: Commit**

```bash
git add crates/exomind-runtime/src/timeblock_sqlite.rs
git commit -m "feat(runtime): persist transitions in completed_timeblocks SQLite for #780"
```

注意：active_timeblock 用 JSON blob（payload_json），serde 自动处理 transitions 字段，不需要改 schema。

---

## Task 3: do_new_block 写 transitions

**Files:**
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`

**Step 1: 在 do_new_block 中，完成旧块时 push end transition**

找到 `let completed_block = TimeBlockData {` 构造处，给 completed block 的 transitions 追加 end：

```rust
let mut completed_transitions = active.transitions.clone();
completed_transitions.push(BlockTransition {
    transition_type: "end".to_string(),
    at: now,
    actor_id: Some("rt:newblock".to_string()),
});

let completed_block = TimeBlockData {
    // ... 现有字段 ...
    transitions: completed_transitions,
};
```

**Step 2: 创建新块时初始化 transitions**

找到 `let new_active = ActiveBlockData {` 构造处：

```rust
let new_active = ActiveBlockData {
    // ... 现有字段 ...
    transitions: vec![BlockTransition {
        transition_type: "start".to_string(),
        at: now,
        actor_id: Some("rt:newblock".to_string()),
    }],
};
```

**Step 3: 确保 BlockTransition 已 import**

```rust
use crate::timeblock::{ActiveBlockData, TimeBlockData, TimeBlockStore, BlockTransition};
```

**Step 4: cargo check**

**Step 5: Commit**

```bash
git commit -m "feat(runtime): do_new_block writes transitions for #780"
```

---

## Task 4: stop/pause/resume 路由写 transitions

**Files:**
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`

**Step 1: stop_block push feedback_start transition**

在 `stop_block` 函数中，`updated.action_ended_at = Some(now)` 之后：

```rust
updated.transitions.push(BlockTransition {
    transition_type: "feedback_start".to_string(),
    at: now,
    actor_id: Some("rt:stop".to_string()),
});
```

**Step 2: pause_block push pause transition**

在 `pause_block` 函数中，`updated.paused = true` 之后：

```rust
updated.transitions.push(BlockTransition {
    transition_type: "pause".to_string(),
    at: now,
    actor_id: Some("rt:pause".to_string()),
});
```

**Step 3: resume_block push resume transition**

在 `resume_block` 函数中，`updated.paused = false` 之后：

```rust
updated.transitions.push(BlockTransition {
    transition_type: "resume".to_string(),
    at: now,
    actor_id: Some("rt:resume".to_string()),
});
```

**Step 4: cargo check**

**Step 5: Commit**

```bash
git commit -m "feat(runtime): stop/pause/resume routes write transitions for #780"
```

---

## Task 5: start_block 和 end_block 的 transitions 处理

**Files:**
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`

start_block 和 end_block 调用 do_new_block，Task 3 已处理。但 end_block 传了 feedback，需要在 completed block 中追加 feedback_submit transition。

**Step 1: end_block 在调用 do_new_block 前，给当前块 push feedback_submit**

找到 end_block 函数，在 `do_new_block(...)` 调用前：

由于 end_block 不直接操作 active block（交给 do_new_block），需要在 do_new_block 内部处理。

修改 do_new_block：当 `req.feedback.is_some()` 时，在 completed_transitions 中追加 feedback_submit（在 end 之前）：

```rust
let mut completed_transitions = active.transitions.clone();
if req.feedback.is_some() {
    completed_transitions.push(BlockTransition {
        transition_type: "feedback_submit".to_string(),
        at: now,
        actor_id: Some("rt:newblock".to_string()),
    });
}
completed_transitions.push(BlockTransition {
    transition_type: "end".to_string(),
    at: now,
    actor_id: Some("rt:newblock".to_string()),
});
```

**Step 2: cargo check**

**Step 3: Commit**

```bash
git commit -m "feat(runtime): end_block appends feedback_submit transition for #780"
```

---

## Task 6: Today Planner start_segment 的 transitions

**Files:**
- Modify: `crates/exomind-runtime/src/routes/today_planner.rs`

start_segment 已走 do_new_block（Task 3 已处理新块的 start transition）。但需要确认 sourcePlannedBlockId 也在 NewBlockRequest 中传递。

**Step 1: 验证 start_segment 的 do_new_block 调用是否正确**

搜索 `super::timeblocks::do_new_block` 调用，确认已有。Task 3 的 do_new_block 改动会自动覆盖。

**Step 2: cargo check**

无需改动则跳过。

---

## Task 7: 构建 + 活体测试

**Step 1: cargo build**

Run: `cargo build -p exomind-runtime`

**Step 2: 启动 RT 并测试 transitions 返回**

```bash
# start → 检查返回的 active 块是否有 transitions
curl -sS -X POST http://127.0.0.1:1949/timeblocks/start \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","mode":"countup"}' | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(f'active.transitions = {d[\"active\"][\"transitions\"]}')"

# pause → 检查 transitions 追加了 pause
curl -sS -X POST http://127.0.0.1:1949/timeblocks/pause | python3 -c "import json,sys; print(json.load(sys.stdin))"

# GET active → 检查完整 transitions 链
curl -sS http://127.0.0.1:1949/timeblocks/active | python3 -c "
import json,sys; d=json.load(sys.stdin)
for t in d.get('transitions',[]): print(f'  {t[\"type\"]} @ {t[\"at\"]}')"

# resume → stop → end → 检查 completed 块的 transitions
curl -sS -X POST http://127.0.0.1:1949/timeblocks/resume
curl -sS -X POST http://127.0.0.1:1949/timeblocks/stop
curl -sS -X POST http://127.0.0.1:1949/timeblocks/end \
  -H "Content-Type: application/json" \
  -d '{"feedback":"done"}' | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('completed transitions:')
for t in d['completed']['transitions']: print(f'  {t[\"type\"]} @ {t[\"at\"]}')
print('gap transitions:')
for t in d['active']['transitions']: print(f'  {t[\"type\"]} @ {t[\"at\"]}')"
```

Expected: 完整的 transitions 链 `start → pause → resume → feedback_start → feedback_submit → end`

**Step 3: Commit + Push**

```bash
git push origin dev
```

---

## 验收标准

- [ ] Rust BlockTransition struct 存在
- [ ] ActiveBlockData.transitions 字段（serde default）
- [ ] TimeBlockData.transitions 字段
- [ ] SQLite completed_timeblocks 有 transitions_json 列
- [ ] do_new_block 写 start + end transitions
- [ ] stop/pause/resume 路由 push transitions
- [ ] end 路由追加 feedback_submit transition
- [ ] GET /timeblocks/active 返回 transitions
- [ ] completed 块有完整 transitions 链
- [ ] cargo check 零错误
- [ ] 活体测试通过
