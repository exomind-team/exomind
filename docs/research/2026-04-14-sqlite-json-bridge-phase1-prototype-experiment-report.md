# SQLite JSON Bridge Phase 1 原型实验报告

> 日期：2026-04-14
> 状态：完成
> 结论：原型成立，`tasks` 域可双向互认，`exomind-runtime --lib` 全绿
> 对应 issue：`#911` `#912`

---

## 1. 一页摘要

本轮实验验证了四件事：

1. `exomind-runtime` 内部可以新增一个同步式 `sqlite_json_bridge`，不必先拆独立 crate。
2. bridge 可以同时承载：
   - expanded 字段 -> 真实 SQLite 列
   - preserved 字段 -> `*_json` 列
   - unknown 字段 -> `_ext_json`
3. bridge 从第一天就能支持 ExoMind 当前真实需要的复合主键，如 `(scope_key, id)`。
4. bridge prototype 与现有 `SqliteTaskStore` 能在同一 sqlite 文件上双向读写互认，不是孤立 demo。

---

## 2. 参考输入

- [2026-04-14-sqlite-json-bridge-research.md](../plans/2026-04-14-sqlite-json-bridge-research.md)
- [2026-04-14-sqlite-json-bridge-handoff.md](../plans/2026-04-14-sqlite-json-bridge-handoff.md)
- [2026-04-14-sqlite-json-bridge-phase1-prototype-plan.md](../plans/2026-04-14-sqlite-json-bridge-phase1-prototype-plan.md)
- [sqlite_store.rs](../../crates/exomind-runtime/src/task/sqlite_store.rs)
- [eventlog_sqlite.rs](../../crates/exomind-runtime/src/eventlog_sqlite.rs)
- [sqlite_store.rs](../../crates/exomind-runtime/src/session/sqlite_store.rs)
- [types.rs](../../crates/exomind-runtime/src/task/types.rs)

锁定前提：

- internal module，不替换生产 `SqliteTaskStore`
- 同步实现，`rusqlite + Mutex<Connection>`
- 首个真实域是 `tasks`
- preserved 命名保持 `*_json`
- unknown 字段进入 `_ext_json`
- 类型不匹配严格报错
- 必须包含真实 sqlite 文件 reopen 验证

---

## 3. 核心流程图

### 3.1 写入路径

```text
Task / JSON document
        |
        v
+----------------------+
| task_to_bridge_doc() |
+----------------------+
        |
        v
+----------------------------------+
| SqliteJsonBridge::upsert_json()  |
+----------------------------------+
        |
        +---------------- expanded_fields -----------------> real columns
        |
        +--------------- preserved_fields -----------------> *_json columns
        |
        +--------------- unknown fields -------------------> _ext_json
        |
        v
+----------------------------------+
| SQLite table: tasks              |
| PK(scope_key, id)                |
+----------------------------------+
```

### 3.2 读取路径

```text
SQLite row
   |
   v
+-------------------------------+
| SqliteJsonBridge::get/query   |
+-------------------------------+
   |
   v
+----------------------+
| row_to_json()        |
+----------------------+
   |
   v
+----------------------+
| task_from_bridge_doc |
+----------------------+
   |
   +-------------------------> Task
   |
   +-------------------------> bridge query result JSON
```

### 3.3 并行验证路径

```text
SqliteTaskStore -------- write --------+
                                       |
                                       v
                               shared tasks.sqlite
                                       ^
                                       |
Bridge Prototype ------- write --------+

验证：
1. Store 写 -> Bridge 读
2. Bridge 写 -> Store 读
```

---

## 4. 关键代码

### 4.1 bridge 核心 API

文件：
- [mod.rs](../../crates/exomind-runtime/src/sqlite_json_bridge/mod.rs)

```rust
pub fn upsert_json(&self, table: &str, doc: Value) -> Result<JsonKey, BridgeError>;
pub fn get_json(&self, table: &str, key: &JsonKey) -> Result<Option<Value>, BridgeError>;
pub fn query_json(&self, table: &str, sql_tail: &str, params: &[Value]) -> Result<Vec<Value>, BridgeError>;
pub fn delete_json(&self, table: &str, key: &JsonKey) -> Result<bool, BridgeError>;
```

要点：

- `JsonKey = Map<String, Value>`
- `query_json` 实际边界是 SQL tail，不只是纯 `WHERE`
- key 从第一天支持复合主键

### 4.2 tasks schema

文件：
- [bridge_prototype.rs](../../crates/exomind-runtime/src/task/bridge_prototype.rs)

```rust
TableSchema::new("tasks")
    .primary_keys(&["scope_key", "id"])
    .expanded_fields(vec![
        FieldDef::text("scope_key").default_json(json!("anonymous")),
        FieldDef::text("id"),
        FieldDef::text("title"),
        FieldDef::text("description").nullable(),
        FieldDef::text("done_condition").nullable(),
        FieldDef::text("status"),
        FieldDef::text("priority"),
        FieldDef::text("source").nullable(),
        FieldDef::text("parent_id").nullable(),
        FieldDef::integer("due_at").nullable(),
        FieldDef::integer("estimated_minutes").nullable(),
        FieldDef::integer("created_at"),
        FieldDef::integer("updated_at"),
        FieldDef::integer("completed_at").nullable(),
    ])
    .preserved_fields(vec![
        PreservedFieldDef::json("tags").default_json(json!([])),
        PreservedFieldDef::json("depends_on").default_json(json!([])),
        PreservedFieldDef::json("time_block_ids").default_json(json!([])),
    ])
    .ext_field(ExtFieldDef::new("_ext_json").default_json(json!({})))
```

字段分层：

- expanded：可直接筛选/排序/索引
- preserved：保持当前仓库 `*_json` 风格
- ext：兜底未知字段

### 4.3 tasks 原型适配层

文件：
- [bridge_prototype.rs](../../crates/exomind-runtime/src/task/bridge_prototype.rs)

```rust
pub(crate) struct SqliteTaskBridgePrototype {
    bridge: SqliteJsonBridge,
}

pub(crate) fn upsert_scoped(&self, scope_key: &str, task: &Task) -> Result<(), _>;
pub(crate) fn get_scoped(&self, scope_key: &str, id: &str) -> Result<Option<Task>, _>;
pub(crate) fn list_scoped(&self, scope_key: &str) -> Result<Vec<Task>, _>;
pub(crate) fn list_by_status_scoped(&self, scope_key: &str, status: &TaskStatus) -> Result<Vec<Task>, _>;
pub(crate) fn list_by_tag_scoped(&self, scope_key: &str, tag: &str) -> Result<Vec<Task>, _>;
```

### 4.4 兼容性防线

文件：
- [mod.rs](../../crates/exomind-runtime/src/sqlite_json_bridge/mod.rs)

```rust
fn ensure_primary_key_compatibility(...)
fn ensure_column_compatibility(...)
```

这两层检查解决的问题：

- 旧表主键形状不一致时，不会误判为兼容
- 旧表列类型/可空性不一致时，不会静默继续运行
- 需要重建表的场景会直接报 `UnsupportedMigration`

---

## 5. 这轮真正做成了什么

### 5.1 bridge 层成立

已验证：

- 复合主键 CRUD
- `missing` 与 `null` 严格区分
- preserved JSON 往返
- `_ext_json` 兜底
- `json_each` 查询 preserved JSON
- 自动补列
- 真实 sqlite 文件 reopen

### 5.2 tasks 原型成立

已验证：

- 内存库 roundtrip
- 跨 scope 隔离
- 按状态查询
- 按 tag 查询
- 文件库 reopen

### 5.3 与现有 store 双向互认成立

测试名：

- `bridge_can_read_tasks_written_by_sqlite_task_store`
- `sqlite_task_store_can_read_tasks_written_by_bridge`

这两项比自测更重要，因为它们证明：

- bridge 没偏离现有 `tasks` 表结构
- bridge 可以作为现有代码旁边的并行验证层
- 后续真要吸收到现有代码，不需要从零重走 schema 对齐

---

## 6. 验证结果

执行并通过：

```bash
cargo test -p exomind-runtime --lib --no-run
cargo test -p exomind-runtime --lib sqlite_json_bridge::tests
cargo test -p exomind-runtime --lib bridge_prototype::tests
cargo test -p exomind-runtime --lib agent::tools::tests::get_recent_events_tool_formats_event_lines -- --exact
cargo test -p exomind-runtime --lib
```

最终结果：

```text
472 passed; 0 failed
```

---

## 7. 经验

### 7.1 `_ext_json` 必须是硬约束

如果 `ext_field` 可选，未知字段就可能被静默丢弃。
这不是“方便”，这是数据保真风险。

### 7.2 迁移检查必须看定义，不只看列名

只看 `PRAGMA table_info` 里的列名不够。
至少要检查：

- 主键列集合与顺序
- 列类型
- 列可空性

### 7.3 最有价值的验证是“互认”，不是“自循环”

bridge 自己写自己读，只能证明模块闭环。
桥接层与 `SqliteTaskStore` 双向互认，才说明它对当前外心代码有吸收价值。

### 7.4 完整测试恢复全绿很重要

如果新原型是绿的，但仓库整体还是红的，这轮实验就不完整。
把 `--lib` 恢复全绿，才算把实验做成可接续状态。

### 7.5 临时目录生命周期会污染测试结论

`TempDir` 提前释放会制造假失败。
这种问题不属于业务逻辑，但会直接污染实验结果。

---

## 8. 对当前外心代码的补足价值

这轮实验已经沉淀出三类可复用资产：

1. bridge 抽象雏形
   可继续用于 `eventlog` / `timeblock` 等 JSON-heavy 域。

2. `tasks` 并行验证层
   可用于后续导入导出、差异比较、schema 演进实验。

3. 迁移风险显式化
   未知字段、主键形状、列定义不兼容，已经从“口头提醒”变成“代码报错 + 测试覆盖”。

---

## 9. 下一步建议

优先级从高到低：

1. 给 `tasks` bridge prototype 增加导入/导出/批量替换对照实验。
2. 把 `eventlog` 作为第二个真实接入域，验证 `refs_json` 与 `metadata_json`。
3. 增加一个内部实验入口，让 bridge prototype 更方便联调，而不触碰生产路径。

---

## 10. 结论

本轮实验不是“写了个原型”，而是完成了下面这条链：

```text
设计 -> 原型 -> 真实 sqlite 验证 -> 与现有 store 互认 -> 完整测试全绿
```

因此，这次 `SQLite JSON Bridge Phase 1` 已经具备继续补到当前外心代码里的现实基础。
