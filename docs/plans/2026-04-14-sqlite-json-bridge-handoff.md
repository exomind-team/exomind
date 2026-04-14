# SQLite JSON Bridge — 交接上下文

> 供无上下文 Agent 阅读，从零快速上手
> 最后更新：2026-04-14

---

## 一句话背景

ExoMind 当前所有复杂对象用 TEXT-as-JSON 存储（`serde_json::to_string` → `_json` TEXT 列），查询必须全量读回 Rust 反序列化。我们希望在上层保留 JSON 接口的同时，下层能利用 SQLite 的索引和 SQL 查询能力。

---

## 调研结论（已确认）

**Rust 生态**：没有开箱即用的一键方案，需要组合 `rusqlite`（已有） + SQLite 内置 JSON 函数。

**核心模式**：`json_each` + `json_extract` = 可靠 + 无需拆子表。

| 函数 | 用途 | 状态 |
|------|------|------|
| `json_extract(col, '$.field')` | 提取 JSON 字段 | ✅ 可靠 |
| `json_each(col, '$')` | 遍历 JSON 数组 | ✅ 可靠 |
| `json_tree(col)` | 递归遍历 | ⚠️ SQLite 3.42.0 有 bug，用 json_each 替代即可 |
| `json_array_length(col)` | 数组长度 | ✅ 辅助实用 |
| `json_type(col, '$.path')` | 类型检查 | ✅ 辅助实用 |
| 表达式索引 | `json_extract` 字段建索引 | ✅ 有效 |

---

## 实验验证结论（已完成）

**最重要发现**：无需拆子表，`json_each` + `json_extract` 即可实现跨表关联查询：

```sql
-- 找所有依赖 task-001 的任务（无需拆子表）
SELECT t.id, t.title, json_extract(je.value, '$.relation_type')
FROM tasks t, json_each(t.depends_on_json, '$') je
WHERE json_extract(je.value, '$.task_id') = 'task-001'

-- 找所有引用 task-001 的事件
SELECT e.id, e.content, json_extract(je.value, '$.summary')
FROM eventlog_events e, json_each(e.refs_json, '$') je
WHERE json_extract(je.value, '$.event_id') = 'task-001'
```

**设计影响**：
- Phase 1 原"缺点"（无法跨表 JOIN）已消除
- Phase 3 拆子表门槛收紧：只有独立查询频率极高的嵌套结构才值得拆
- Phase 2 范围明确：表达式索引 + 辅助 JSON 函数

---

## 设计方案（已确定）

### 阶段 1（一层存储，最小可行）

- SchemaRegistry 注册 `{table_name → TableSchema}`
- 展开字段 → 真实 SQL 列（可索引）
- 保留字段 → JSON TEXT 列（用 `json_each`/`json_extract` 查询）
- 未注册字段 → `_ext_json` 兜底
- **不拆子表**

核心 API：
```rust
fn upsert_json(&self, table: &str, doc: serde_json::Value) -> Result<String, BridgeError>;
fn get_json(&self, table: &str, id: &str) -> Result<Option<serde_json::Value>, BridgeError>;
fn query_json(&self, table: &str, sql_where: &str, params: &[Value]) -> Result<Vec<serde_json::Value>, BridgeError>;
fn delete_json(&self, table: &str, id: &str) -> Result<bool, BridgeError>;
```

### 阶段 2（增强 JSON 查询）
- 常用 `json_extract` 路径建表达式索引
- `json_array_length` 数组长度过滤
- `json_type` 类型安全查询

### 阶段 3（按需拆子表）
- 只针对独立查询频率极高的嵌套结构

### 阶段 4（远期，不做）
- `sqlite-loadable` 虚拟表扩展

---

## 已完成事项

- ✅ Rust 生态调研
- ✅ SQLite JSON 函数实验验证（8 个实验，全部通过）
- ✅ 嵌套 JSON 结构分类（EventRef/QuickAction/PlannedSegment 等）
- ✅ 设计文档落地：`docs/plans/2026-04-14-sqlite-json-bridge-research.md`
- ✅ 实验报告落地：`docs/research/SQLite-JSON-Functions-实验报告-2026-04-14.md`
- ✅ GitHub Issue #911 追踪
- ✅ 设计文档已更新（反映实验结论）

---

## 待确认/待完成事项

### 高优先级（阻塞下一步）

1. **crate 命名和路径**：`crates/sqlite-json-bridge/` 还是其他？
2. **API 风格**：async (tokio) 还是同步？（现有 store 是同步的）
3. **schema 变更策略**：参考现有的 `add_column_if_not_exists` 模式

### 中优先级

4. **ext 兜底字段的 schema 演进**：未注册字段积累后如何清理/迁移
5. **索引策略**：哪些字段默认建索引？
6. **Phase 1 详细 API 设计**：确定 JSON CRUD 接口的输入输出格式

### 低优先级（后续）

7. 真实 SQLite 数据库文件性能基准
8. 表达式索引在真实数据规模下的 EXPLAIN QUERY PLAN 验证

---

## 关键文件路径（dev 分支）

| 文件 | 作用 |
|------|------|
| `docs/plans/2026-04-14-sqlite-json-bridge-research.md` | 设计方案（需先读） |
| `docs/research/SQLite-JSON-Functions-实验报告-2026-04-14.md` | 实验报告（含完整脚本） |
| `crates/exomind-runtime/src/task/sqlite_store.rs` | 现有 TEXT-as-JSON 实现参考 |
| `crates/exomind-runtime/src/agent/session.rs` | `add_column_if_not_exists` 迁移模式参考 |
| `crates/exomind-runtime/src/eventlog_sqlite.rs` | eventlog store 参考 |

---

## GitHub Issue

- **#911**：SQLite JSON Bridge 技术追踪（调研+设计阶段）
  - https://github.com/exomind-team/exomind/issues/911
  - `blocked by` #520（统一 SQLite 数据库宏观愿景）
- **#520**：统一 RT 用户数据库宏观愿景（上游）
  - https://github.com/exomind-team/exomind/issues/520

---

## 隔离实验分支

- 分支名：`experiment/sqlite-json-each`
- 包含：实验脚本 `sqlite_json_exp.py` + 原始实验报告
- 可直接运行验证：`python3 sqlite_json_exp.py`

---

## 下一步建议

1. **先读设计文档**：`docs/plans/2026-04-14-sqlite-json-bridge-research.md`，理解完整设计
2. **跑通实验脚本**：`experiment/sqlite-json-each/sqlite_json_exp.py`，熟悉 JSON 函数行为
3. **确定 crate 边界**：命名、路径、API 风格、迁移策略
4. **原型验证**：SchemaRegistry 最小实现跑通后再扩展
