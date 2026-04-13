# SQLite JSON Bridge — 技术调研与设计方案

> 日期：2026-04-14
> 状态：调研中 / 草稿

---

## 1. 问题背景

ExoMind 当前使用 **TEXT-as-JSON 模式**存储复杂对象：

```rust
// 现状：所有复杂字段序列化到 TEXT 列
serde_json::to_string(&task.tags)?           // → "tags_json" TEXT NOT NULL
serde_json::to_string(&task.depends_on)?      // → "depends_on_json" TEXT NOT NULL
serde_json::to_string(&task.time_block_ids)?  // → "time_block_ids_json" TEXT NOT NULL
```

**目标**：上层提供 JSON 接口，下层享受 SQLite 的跨平台轻量存储 + SQL 查询能力。

---

## 2. 调研结论

### 2.1 Rust 生态现状

| 技术 | 说明 | 评估 |
|------|------|------|
| **rusqlite** | SQLite 绑定，已在用 v0.32 | ✅ 基础 |
| SQLite 内置 JSON 函数 | `json_extract`, `json_each`, `json_tree` | ⚠️ 当前未使用，需熟悉 |
| `sqlite-loadable` | 用 Rust 写 SQLite 扩展 | 🔶 早期 v0.0.5，部署复杂 |
| `sqlite3_ext` + `sqlite3-ext-vtab` | Rust 虚拟表框架 | 🔶 小众，但 API 成熟 |
| `fsqlite-ext-json` | json_each/json_tree 虚拟表实现 | 🔶 Frankensqlite 项目的一部分 |
| `sqlite-jsonschema` | JSON Schema 校验扩展 | 🔶 验证用，非核心需求 |
| `jsonschema` | JSON Schema 校验库 | ✅ 可用于声明式 schema 校验 |
| `hoardbase` | MongoDB-style on SQLite | 🔶 alpha，太早期 |

**核心结论**：**没有开箱即用的一键方案**，需要组合多个技术构建。

### 2.2 SQLite 内置 JSON 函数（关键发现）

SQLite 原生支持 JSON 查询能力，rusqlite 可直接使用：

```sql
-- 标量函数
json_extract(column, '$.field')           -- 提取字段
json_extract(column, '$.arr[0].name')    -- 嵌套数组索引
json_type(column, '$.key')               -- 返回类型
json_valid(column)                        -- 校验合法 JSON

-- 虚拟表（SQLite 自动遍历）
SELECT * FROM json_each(json_column, '$');   -- 遍历直接子级
SELECT * FROM json_tree(json_column);        -- 递归遍历整棵树

-- 示例：过滤 JSON 数组内的值
SELECT id, content
FROM eventlog_events, json_each(eventlog_events.tags_json, '$')
WHERE json_each.value = 'important';

-- 递归查询嵌套字段
SELECT id, json_tree.key, json_tree.value
FROM events, json_tree(events.metadata_json)
WHERE json_tree.path LIKE '$.author.%';
```

**现状**：当前代码完全没有使用这些函数。

---

## 3. 现有嵌套 JSON 结构分析

通过对 ExoMind 全部 store 的分析，将嵌套 JSON 字段分为三类：

### 3.1 应该拆成子表的（一对多关联实体）

| 嵌套结构 | 主表 | 理由 |
|---------|------|------|
| `EventRef[]` | event_refs | 有 `event_id` 作为 key，是跨表关联实体 |
| `QuickAction[]` | session_quick_actions | 有 `id`，UI 层独立查询 |
| `PlannedSegmentData[]` | planner_segments | 已有 `get_segment_scoped()` 独立查询需求 |
| `RhythmPresetData` | rhythm_presets | 有 `key` 标识，跨窗口复用 |

**判断标准**：有独立 ID 字段 + 会在独立上下文中被查询

### 3.2 固定 Schema 但保留 JSON 列即可的

| 嵌套结构 | 处理方式 | 理由 |
|---------|---------|------|
| `TaskDependency[]` | 保留 JSON 列 | 无独立 ID，只从 Task 出发查询 |
| `BlockTransition[]` | 保留 JSON 数组 | 无主键，展平反而复杂 |
| `BlockTaskAssociationEvent[]` | 保留 JSON 数组 | 复合 key，展平收益不高 |

### 3.3 必须保留 JSON 列的（动态 Schema）

| 字段 | 原因 |
|------|------|
| `metadata` | `serde_json::Value`，完全动态 |
| `tags[]` | 用户自由标签，无固定 schema |
| `task_ids[]` | 关联列表，只通过父表查询 |
| `payload` | Signal 动态负载 |
| `ActiveBlockData` | 作为 blob 存储，无需查询 |

### 3.4 嵌套结构分类决策树

```
嵌套 JSON 字段
├── 有独立 ID 字段？+ 会独立查询？
│   ├── 是 → 拆成独立子表（foreign key）
│   └── 否 ↓
├── Schema 固定但无独立 ID？
│   ├── 是 → 保留 JSON 数组 + json_each 查询
│   └── 否 ↓
└── Schema 动态或频繁变化？
    └── 是 → 保留 JSON TEXT 列 + json_extract 查询
```

---

## 4. 设计方案：分阶段演进

### 阶段 1（一层存储，最小可行）

**核心原则**：上层使用 JSON 接口，下层按 Schema 注册决定展开或保留。所有嵌套 JSON **不拆子表**，按一层存储处理。

**存储策略**：

```
JSON 对象字段
├── 声明式注册为"展开" → SQLite 真实列（可索引）
├── 声明式注册为"保留" → SQLite JSON TEXT 列
└── 未注册字段          → 自动放入 "ext" JSON 列（兜底）
```

**Schema 注册示例**：

```rust
// 注册 Task 的 schema
registry.register("tasks", TableSchema {
    expanded_fields: vec![
        FieldDef::new("id", SqlType::TEXT, indexed: true),
        FieldDef::new("title", SqlType::TEXT, indexed: false),
        FieldDef::new("status", SqlType::TEXT, indexed: true),
        FieldDef::new("due_at", SqlType::INTEGER, indexed: true),
    ],
    preserved_fields: vec![
        "tags",        // Vec<String>，保留为 JSON 数组
        "depends_on",  // Vec<TaskDependency>，保留为 JSON 数组
        "meta",        // serde_json::Value，动态对象
    ],
    ext_field: "_ext",  // 未注册字段兜底
})?;
```

**生成的表结构**：

```sql
CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    status      TEXT,
    due_at      INTEGER,
    tags_json   TEXT NOT NULL DEFAULT '[]',
    depends_on_json TEXT NOT NULL DEFAULT '[]',
    meta_json   TEXT,
    _ext_json   TEXT,   -- 兜底：未注册字段
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
```

**JSON CRUD API（核心接口）**：

```rust
// 插入/更新：JSON 对象 → SQLite 行
async fn upsert_json(
    &self,
    table: &str,
    doc: serde_json::Value,  // 整个 JSON 对象
) -> Result<String, BridgeError>;

// 按 ID 查询：返回完整 JSON 对象
async fn get_json(&self, table: &str, id: &str) -> Result<Option<serde_json::Value>, BridgeError>;

// SQL 条件查询：返回 JSON 对象列表
async fn query_json(
    &self,
    table: &str,
    sql_where: &str,  // e.g. "status = ? AND due_at > ?"
    params: &[Value],
) -> Result<Vec<serde_json::Value>, BridgeError>;

// 删除
async fn delete_json(&self, table: &str, id: &str) -> Result<bool, BridgeError>;
```

**实现要点**：
- `SchemaRegistry` 维护 `{table_name → TableSchema}` 映射
- 展开字段 → 真实 SQL 列，INSERT 时直接映射值
- 保留字段 → 单独提取，序列化到 `_json` 列
- 未注册字段 → 放入 `_ext_json`，通过 `json_extract` 查询
- **不拆子表**：所有嵌套数组/对象在一层内处理，通过 SQLite JSON 函数补充查询

**优点**：
- 实现最小，改动最浅
- 上层读写整个 JSON 对象，无需关心展开逻辑
- 未来可演进到子表，不影响 API

**缺点**：
- 固定嵌套结构（如 `EventRef[]`）无法跨表 JOIN
- 深层嵌套查询仍受 SQLite JSON 函数限制

---

### 阶段 2：增强 JSON 列查询

在阶段 1 基础上，引入 SQLite 内置 JSON 虚拟表：

```sql
-- 查询 tags_json 数组内的标签
SELECT id, json_extract(title, '$') as title, je.value as tag
FROM tasks, json_each(tasks.tags_json, '$') je
WHERE je.value LIKE '%urgent%';

-- 查询 meta 内嵌套字段
SELECT id, json_extract(meta_json, '$.source') as src
FROM tasks
WHERE json_extract(meta_json, '$.priority') = 'high';
```

**关键**：JSON 列上的索引需要表达式索引：

```sql
CREATE INDEX idx_tasks_meta_source
ON tasks(json_extract(meta_json, '$.source'));
```

---

### 阶段 3：固定嵌套结构拆子表（进阶）

针对阶段 1 中分析的"应该拆成子表"的嵌套结构，按需演进：

```
tasks (主表)
├── id (PK), title, status, due_at, ...
├── tags_json     ← 保留 JSON（简单字符串数组）
├── depends_on_json ← 保留 JSON（暂无独立查询需求）
└── meta_json     ← 保留 JSON（动态对象）

+ event_refs (新子表)
+ session_quick_actions (新子表)
+ planner_segments (新子表)
+ rhythm_presets (新子表)
```

**判断是否拆子表的标准**（同时满足才拆）：
1. 嵌套对象是否有独立 ID？
2. 是否会在独立上下文中被查询（不通过父表）？
3. 是否需要和其他表做 JOIN？

---

### 阶段 4：虚拟表扩展（可选，远期）

用 `sqlite-loadable` 写 Rust 扩展，创建完全动态 schema 的虚拟表。**初期不建议**，工程量和部署复杂度高。

---

## 5. 待确认问题（未解之谜）

- [ ] **schema 变更策略**：migration 是手动还是自动？（参考现有 `add_column_if_not_exists` 模式）
- [ ] **索引策略**：哪些字段默认建索引？表达式索引导入方式？
- [ ] **事务语义**：多表写入（未来子表场景）是否需要事务？
- [ ] **独立 crate 命名**：`sqlite-json-bridge` 还是其他？
- [ ] **crate 存放位置**：`crates/sqlite-json-bridge/` 还是其他路径？
- [ ] **性能基准**：大批量写入时的吞吐预期？
- [ ] **ext 兜底字段的 schema 演进**：未注册字段不断积累后如何清理/迁移？
- [ ] **API 风格**：async (tokio) 还是同步？现有 store 是同步的

---

## 6. 建议下一步

1. **先熟悉 SQLite JSON 函数**：在现有 store 上用 `json_each`/`json_tree` 做一次查询实验
2. **确定 crate 边界**：独立 crate 还是现有模块增强？路径在哪？
3. **设计 Phase 1 详细 API**：确定 JSON CRUD 接口的输入输出格式
4. **原型验证**：最小实现跑通后再扩展

---

## 7. 参考资料

- [SQLite JSON Functions 文档](https://www.sqlite.org/json1.html)
- [rusqlite JSON 存储模式（现有代码）](./crates/exomind-runtime/src/task/sqlite_store.rs)
- [schema-on-read 迁移模式（现有代码）](./crates/exomind-runtime/src/agent/session.rs#L320-L336)
