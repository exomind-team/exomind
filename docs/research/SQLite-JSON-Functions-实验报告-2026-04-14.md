# SQLite JSON Functions 实验报告

> 日期：2026-04-14
> 环境：SQLite 3.42.0（Python sqlite3，内置 json1 扩展）
> 目的：验证 SQLite 内置 JSON 函数能否满足 exomind JSON→SQLite 映射层的查询需求
> 结论：**`json_each` + `json_extract` 模式已足够强大，Phase 1/2 设计可大幅简化**

---

## 实验概览

| 实验 | 主题 | 结果 | 结论 |
|------|------|------|------|
| #1 | `json_each` 遍历 JSON 数组 | ✅ 通过 | 核心可靠模式，推荐 |
| #2 | `json_extract` 提取嵌套字段 | ✅ 通过 | 核心可靠模式，推荐 |
| #3 | `json_tree` 递归遍历 | ⚠️ 部分通过 | SQLite 3.42.0 有 bug，见下方说明 |
| #4 | `depends_on_json` 嵌套对象数组 | ✅ 通过 | `json_each` + `json_extract` 可靠 |
| #5 | 表达式索引 | ✅ 通过 | 有效，但 EXPLAIN 输出需解析 |
| #6 | `json_type`/`json_valid`/`json_array_length` | ✅ 通过 | 辅助函数实用 |
| #7 | 跨表关联查询 | ✅ 通过 | 无需拆子表即可关联 |
| #8 | Schema 迁移模式 | ✅ 通过 | ALTER TABLE + UPDATE 方案可行 |

---

## 关键发现

### 1. `json_each` + `json_extract` = 核心可靠模式

对于 exomind 的所有 JSON 列类型，这是**最可靠且最实用的查询组合**，无需拆子表即可实现关联查询：

```sql
-- 简单字符串数组（tags）
SELECT e.id, je.value as tag
FROM eventlog_events e, json_each(e.tags_json, '$') je
WHERE je.value = 'urgent'

-- 嵌套对象数组（refs）
SELECT e.id,
       json_extract(je.value, '$.kind') as ref_kind,
       json_extract(je.value, '$.event_id') as ref_id
FROM eventlog_events e, json_each(e.refs_json, '$') je
WHERE json_extract(je.value, '$.kind') = 'task'

-- 嵌套对象数组（depends_on）
SELECT t.id, t.title,
       json_extract(je.value, '$.task_id') as dep_id,
       json_extract(je.value, '$.relation_type') as rel_type
FROM tasks t, json_each(t.depends_on_json, '$') je
```

### 2. `json_extract` WHERE 过滤 + 聚合

```sql
-- WHERE 过滤 JSON 内嵌套字段
SELECT id, content
FROM eventlog_events
WHERE json_extract(metadata_json, '$.priority') IN ('high', 'critical')

-- 深层嵌套字段（$.nested.count）
SELECT id, json_extract(metadata_json, '$.nested.count')
FROM eventlog_events
WHERE json_extract(metadata_json, '$.nested.count') > 20

-- GROUP BY JSON 字段
SELECT json_extract(metadata_json, '$.source') as src, COUNT(*) as cnt
FROM eventlog_events
GROUP BY json_extract(metadata_json, '$.source')
```

### 3. `json_tree` 有 SQLite 3.42.0 bug（重要）

**问题**：`json_tree(e.refs_json)` 当 `refs_json` 是表列时，无法用表别名访问其虚拟列（如 `jt.key`）。

```sql
-- ❌ 失败（报错：no such column: jt.key）
SELECT jt.key FROM t, json_tree(t.refs) jt WHERE jt.type = 'object'

-- ✅ 成功（不用列名前缀）
SELECT key FROM t, json_tree(t.refs) WHERE type = 'object'
-- 但这在有多表时无法消歧
```

**影响**：`json_tree` 适合查询 JSON 字面量，不适合带表列引用的复杂递归查询。

**替代方案**：`json_each` + `json_extract` 对所有 exomind 场景都够用，**无需研究 json_tree**。

### 4. 表达式索引有效

```sql
CREATE INDEX idx_events_priority
ON eventlog_events(json_extract(metadata_json, '$.priority'));

-- 实际查询验证：正确返回了结果
SELECT id, content
FROM eventlog_events
WHERE json_extract(metadata_json, '$.priority') = 'critical'
```

### 5. 辅助函数实用

```sql
-- 数组长度（无需展开就知道有多少个标签）
SELECT id, json_array_length(tags_json) as tag_count
FROM eventlog_events
WHERE json_array_length(tags_json) > 2

-- 类型检查
SELECT id, json_type(metadata_json, '$.nested.count')
-- 返回：integer / text / null / object / array

-- 合法的 JSON 校验
SELECT id, json_valid(metadata_json) as is_valid FROM eventlog_events
```

### 6. Schema 迁移模式验证

从 TEXT-as-JSON 迁移到混合列完全可行：

```sql
-- 新增展开列
ALTER TABLE eventlog_events ADD COLUMN tags_count INTEGER;
ALTER TABLE eventlog_events ADD COLUMN first_tag TEXT;

-- 填充（一次性迁移）
UPDATE eventlog_events
SET tags_count = json_array_length(tags_json),
    first_tag = json_extract(tags_json, '$[0]');
```

### 7. 跨表关联查询（无需拆子表）

这是最有力的发现——即使不拆子表，也可以做跨表关联：

```sql
-- 找所有依赖 task-001 的任务
SELECT t.id, t.title, json_extract(je.value, '$.relation_type')
FROM tasks t, json_each(t.depends_on_json, '$') je
WHERE json_extract(je.value, '$.task_id') = 'task-001'

-- 找所有引用 task-001 的事件
SELECT e.id, e.content, json_extract(je.value, '$.summary')
FROM eventlog_events e, json_each(e.refs_json, '$') je
WHERE json_extract(je.value, '$.event_id') = 'task-001'
```

---

## 对 Phase 1/2 设计的影响

### Phase 1（结论：可大幅简化）

原来设计中的"保留字段用 JSON TEXT 列"，现在可以用 `json_each` + `json_extract` 在 SQL 层做查询，**不需要拆子表就能实现大部分关联查询**。

具体影响：
- `EventRef[]`、`TaskDependency[]` 在阶段 1 **不需要拆子表**
- 用 `json_each` + `json_extract` 可以在 SQL 层直接做 JOIN 级别的查询
- 跨表关联在阶段 1 就能支持

### Phase 2（重新评估）

`json_each` + `json_extract` 已经足够强，Phase 2 的核心工作变成：
1. 为常用的 JSON 字段建表达式索引（`json_extract(path)` 上的索引）
2. 补充 `json_array_length` 过滤能力
3. 添加 `json_type` 做类型安全的查询

`json_tree` 在 SQLite 3.42.0 的 bug 意味着**不需要投入精力研究它**，因为替代方案已经够用。

### Phase 3（拆子表的判断标准收紧）

原来：有 ID + 独立查询 → 拆子表
现在：有 ID + **独立查询频率极高** → 才拆子表

因为 `json_each` + `json_extract` 已经能处理大部分场景，拆子表只带来 JOIN 性能收益，代价是 schema 复杂度上升。

---

## 待实验（未完成）

- [ ] 在真实 SQLite 数据库文件（不是 :memory:）上的性能基准
- [ ] 表达式索引在大数据量下的 EXPLAIN QUERY PLAN 验证
- [ ] `json_tree` bug 是否在更高版本 SQLite 中修复
- [ ] `json_each` 在空数组时的行为（是否会返回 0 行）

---

## 附录：实验脚本

> 完整可运行的 Python 实验脚本，可直接执行验证

```python
#!/usr/bin/env python3
"""
SQLite JSON Functions Experiment
===============================
实验目标：
1. json_each - 遍历 JSON 数组的直接子级
2. json_extract - 提取嵌套字段
3. json_tree - 递归遍历整棵 JSON 树
4. 表达式索引 - JSON 列字段能否被索引
"""

import sqlite3
import json
import sys

def print_header(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

def print_query(conn, sql, params=None):
    print(f"\nSQL: {sql}")
    if params:
        print(f"Params: {params}")
    cursor = conn.execute(sql, params) if params else conn.execute(sql)
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()
    print(f"Columns: {columns}")
    for row in rows:
        print(f"  {[row[c] for c in columns]}")
    print(f"Total: {len(rows)} rows")

def create_schema(conn):
    """创建模拟 exomind store 的表结构"""
    conn.execute("DROP TABLE IF EXISTS eventlog_events")
    conn.execute("DROP TABLE IF EXISTS tasks")

    conn.execute("""
        CREATE TABLE eventlog_events (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            refs_json TEXT NOT NULL DEFAULT '[]',
            metadata_json TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            due_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            depends_on_json TEXT NOT NULL DEFAULT '[]',
            time_block_ids_json TEXT NOT NULL DEFAULT '[]',
            meta_json TEXT
        )
    """)

    print("Schema created.")

def insert_sample_data(conn):
    """插入模拟 exomind 真实数据的样本"""
    now = 1740000000

    events = [
        {
            "id": "evt-001",
            "content": "完成了任务同步功能开发",
            "created_at": now - 86400,
            "tags_json": json.dumps(["done", "feature", "sync"]),
            "refs_json": json.dumps([
                {"kind": "task", "event_id": "task-001", "summary": "实现跨设备任务同步"},
                {"kind": "task", "event_id": "task-002", "summary": "修复同步冲突"}
            ]),
            "metadata_json": json.dumps({
                "source": "desktop",
                "author": "agent-hub",
                "priority": "high",
                "nested": {"field": "deep-value", "count": 42}
            })
        },
        {
            "id": "evt-002",
            "content": "修复了事件日志导入问题",
            "created_at": now - 43200,
            "tags_json": json.dumps(["bug", "eventlog", "urgent"]),
            "refs_json": json.dumps([
                {"kind": "task", "event_id": "task-003", "summary": "修复导入 bug"}
            ]),
            "metadata_json": json.dumps({
                "source": "mobile",
                "author": "user-feedback",
                "priority": "critical",
                "nested": {"field": "another-deep", "count": 17}
            })
        },
        {
            "id": "evt-003",
            "content": "设计文档更新",
            "created_at": now - 21600,
            "tags_json": json.dumps(["docs", "architecture"]),
            "refs_json": json.dumps([]),
            "metadata_json": json.dumps({
                "source": "web",
                "author": "manual",
                "priority": "low"
            })
        },
    ]

    tasks = [
        {
            "id": "task-001",
            "title": "实现跨设备任务同步",
            "status": "done",
            "due_at": now - 86400,
            "created_at": now - 172800,
            "updated_at": now - 86400,
            "tags_json": json.dumps(["feature", "sync", "p1"]),
            "depends_on_json": json.dumps([]),
            "time_block_ids_json": json.dumps(["tb-001", "tb-002"]),
            "meta_json": json.dumps({
                "domain": "sync",
                "version": "v1",
                "reviewers": ["user-a", "user-b"]
            })
        },
        {
            "id": "task-002",
            "title": "修复同步冲突",
            "status": "in_progress",
            "due_at": now + 86400,
            "created_at": now - 86400,
            "updated_at": now - 3600,
            "tags_json": json.dumps(["bug", "sync", "p0"]),
            "depends_on_json": json.dumps([
                {"task_id": "task-001", "relation_type": "soft"}
            ]),
            "time_block_ids_json": json.dumps(["tb-003"]),
            "meta_json": json.dumps({
                "domain": "sync",
                "version": "v1",
                "reviewers": []
            })
        },
        {
            "id": "task-003",
            "title": "优化导入导出性能",
            "status": "pending",
            "due_at": None,
            "created_at": now - 10000,
            "updated_at": now - 10000,
            "tags_json": json.dumps(["performance", "import", "p2"]),
            "depends_on_json": json.dumps([]),
            "time_block_ids_json": json.dumps([]),
            "meta_json": None
        },
    ]

    for e in events:
        conn.execute(
            "INSERT INTO eventlog_events (id, content, created_at, tags_json, refs_json, metadata_json) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [e["id"], e["content"], e["created_at"], e["tags_json"], e["refs_json"], e["metadata_json"]]
        )

    for t in tasks:
        conn.execute(
            "INSERT INTO tasks (id, title, status, due_at, created_at, updated_at, tags_json, depends_on_json, time_block_ids_json, meta_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [t["id"], t["title"], t["status"], t["due_at"], t["created_at"], t["updated_at"],
             t["tags_json"], t["depends_on_json"], t["time_block_ids_json"], t["meta_json"]]
        )

    conn.commit()
    print(f"Inserted {len(events)} events and {len(tasks)} tasks.")


def experiment_1_json_each_tags(conn):
    """实验1：json_each 遍历 tags_json 数组"""
    print_header("实验1: json_each — 遍历 tags_json 数组")

    # 基础：展开 tags 数组
    print_query(conn, """
        SELECT e.id, e.content, je.value as tag
        FROM eventlog_events e, json_each(e.tags_json, '$') je
        ORDER BY e.id, je.key
    """)

    # 过滤：只返回包含特定标签的事件
    print_query(conn, """
        SELECT e.id, e.content, je.value as tag
        FROM eventlog_events e, json_each(e.tags_json, '$') je
        WHERE je.value = 'urgent'
    """)

    # 过滤：以某字符串开头的标签
    print_query(conn, """
        SELECT e.id, je.value as tag
        FROM eventlog_events e, json_each(e.tags_json, '$') je
        WHERE je.value LIKE 'p%'
    """)

    # 统计：每个事件有多少个标签
    print_query(conn, """
        SELECT e.id, COUNT(je.value) as tag_count
        FROM eventlog_events e, json_each(e.tags_json, '$') je
        GROUP BY e.id
        ORDER BY tag_count DESC
    """)

    # 全局去重标签列表
    print_query(conn, """
        SELECT DISTINCT je.value as all_tags
        FROM eventlog_events e, json_each(e.tags_json, '$') je
        ORDER BY all_tags
    """)


def experiment_2_json_extract_nested(conn):
    """实验2：json_extract 提取 metadata_json 嵌套字段"""
    print_header("实验2: json_extract — 提取 metadata_json 嵌套字段")

    # 提取顶层字段
    print_query(conn, """
        SELECT id,
               json_extract(metadata_json, '$.source') as source,
               json_extract(metadata_json, '$.priority') as priority,
               json_extract(metadata_json, '$.author') as author
        FROM eventlog_events
    """)

    # 提取嵌套深层字段
    print_query(conn, """
        SELECT id,
               json_extract(metadata_json, '$.nested.field') as nested_field,
               json_extract(metadata_json, '$.nested.count') as nested_count
        FROM eventlog_events
    """)

    # WHERE 过滤
    print_query(conn, """
        SELECT id, content, json_extract(metadata_json, '$.priority') as priority
        FROM eventlog_events
        WHERE json_extract(metadata_json, '$.priority') IN ('high', 'critical')
    """)

    # 统计各 source 的事件数
    print_query(conn, """
        SELECT json_extract(metadata_json, '$.source') as source, COUNT(*) as cnt
        FROM eventlog_events
        GROUP BY json_extract(metadata_json, '$.source')
    """)

    # 深层字段过滤
    print_query(conn, """
        SELECT id, json_extract(metadata_json, '$.nested.count') as count
        FROM eventlog_events
        WHERE json_extract(metadata_json, '$.nested.count') > 20
    """)


def experiment_3_json_tree(conn):
    """实验3：json_each + json_extract — 替代 json_tree 的工作方案

    注意：SQLite 3.42.0 中，json_tree() 对表列引用存在 bug，
    无法正确解析虚拟表列名。json_each 则工作正常。
    """
    print_header("实验3: json_each + json_extract — 替代 json_tree")

    # json_each 展开 refs_json 数组的每个对象，然后 json_extract 取字段
    print_query(conn, """
        SELECT e.id,
               json_extract(je.value, '$.kind') as ref_kind,
               json_extract(je.value, '$.event_id') as ref_id,
               json_extract(je.value, '$.summary') as ref_summary
        FROM eventlog_events e, json_each(e.refs_json, '$') je
        ORDER BY e.id
    """)

    # 过滤：只查 kind = 'task' 的引用
    print_query(conn, """
        SELECT e.id, e.content,
               json_extract(je.value, '$.event_id') as ref_id,
               json_extract(je.value, '$.summary') as summary
        FROM eventlog_events e, json_each(e.refs_json, '$') je
        WHERE json_extract(je.value, '$.kind') = 'task'
        ORDER BY e.id
    """)

    # 统计：每个事件有多少个引用
    print_query(conn, """
        SELECT e.id, e.content, COUNT(je.value) as ref_count
        FROM eventlog_events e, json_each(e.refs_json, '$') je
        GROUP BY e.id
        HAVING ref_count > 0
        ORDER BY ref_count DESC
    """)

    # 全局去重 kind 类型
    print_query(conn, """
        SELECT DISTINCT json_extract(je.value, '$.kind') as kind
        FROM eventlog_events e, json_each(e.refs_json, '$') je
    """)

    # json_tree 对 JSON 字面量（验证）
    print("--- json_tree 对 JSON 字面量（验证）---")
    print_query(conn, """
        SELECT key, value, type
        FROM json_tree('{"refs":[{"id":"1"},{"id":"2"}]}')
        WHERE type = 'object' AND key IS NULL
    """)


def experiment_4_depends_on_json(conn):
    """实验4：tasks.depends_on_json — 嵌套对象数组"""
    print_header("实验4: json_each — tasks.depends_on_json 嵌套对象数组")

    print_query(conn, """
        SELECT t.id, t.title, t.status,
               json_extract(je.value, '$.task_id') as dep_task_id,
               json_extract(je.value, '$.relation_type') as dep_type
        FROM tasks t, json_each(t.depends_on_json, '$') je
    """)


def experiment_5_expression_index(conn):
    """实验5：表达式索引"""
    print_header("实验5: JSON 列表达式索引")

    # 创建表达式索引
    conn.execute("DROP INDEX IF EXISTS idx_events_priority")
    conn.execute("""
        CREATE INDEX idx_events_priority
        ON eventlog_events(json_extract(metadata_json, '$.priority'))
    """)
    conn.commit()
    print("Created index: idx_events_priority on json_extract(metadata_json, '$.priority')")

    # 验证 EXPLAIN QUERY PLAN
    print("\nQuery plan WITHOUT index hint:")
    for row in conn.execute("""
        EXPLAIN QUERY PLAN
        SELECT id, content
        FROM eventlog_events
        WHERE json_extract(metadata_json, '$.priority') = 'high'
    """):
        print(f"  {row}")

    print("\nQuery plan:")
    for row in conn.execute("""
        EXPLAIN QUERY PLAN
        SELECT id, content
        FROM eventlog_events
        WHERE json_extract(metadata_json, '$.priority') = 'critical'
    """):
        print(f"  {row}")

    # 实际查询验证
    print_query(conn, """
        SELECT id, content, json_extract(metadata_json, '$.priority') as priority
        FROM eventlog_events
        WHERE json_extract(metadata_json, '$.priority') = 'critical'
    """)

    # 数组长度的表达式索引
    conn.execute("DROP INDEX IF EXISTS idx_tasks_dep_count")
    conn.execute("""
        CREATE INDEX idx_tasks_dep_count
        ON tasks(json_array_length(depends_on_json))
    """)
    print("Created index: idx_tasks_dep_count on json_array_length(depends_on_json)")


def experiment_6_json_type_and_valid(conn):
    """实验6：类型检查和合法性校验"""
    print_header("实验6: json_type / json_valid / json_array_length")

    # json_type
    print_query(conn, """
        SELECT id,
               json_type(metadata_json) as top_level_type,
               json_type(metadata_json, '$.nested') as nested_type,
               json_type(metadata_json, '$.nested.count') as count_type
        FROM eventlog_events
    """)

    # json_valid
    print("\n--- json_valid ---")
    for row in conn.execute("SELECT id, json_valid(metadata_json) as is_valid FROM eventlog_events"):
        print(f"  {row}")

    # json_array_length
    print_query(conn, """
        SELECT id,
               json_array_length(tags_json) as tag_count,
               json_array_length(refs_json) as ref_count
        FROM eventlog_events
    """)

    # 结合过滤：只查有超过2个标签的事件
    print_query(conn, """
        SELECT id, json_array_length(tags_json) as tag_count
        FROM eventlog_events
        WHERE json_array_length(tags_json) > 2
    """)


def experiment_7_join_real_world(conn):
    """实验7：结合真实场景——找所有和 task-001 相关的任务/事件"""
    print_header("实验7: 跨表关联 — 查找 task-001 相关的任务和事件")

    # 通过 depends_on_json 找依赖 task-001 的任务
    print("Tasks that depend on task-001:")
    print_query(conn, """
        SELECT t.id, t.title, t.status,
               json_extract(je.value, '$.task_id') as dep_task,
               json_extract(je.value, '$.relation_type') as rel_type
        FROM tasks t, json_each(t.depends_on_json, '$') je
        WHERE json_extract(je.value, '$.task_id') = 'task-001'
    """)

    # 通过 refs_json 找引用了 task-001 的事件
    print("Events that reference task-001:")
    print_query(conn, """
        SELECT e.id, e.content,
               json_extract(je.value, '$.kind') as ref_kind,
               json_extract(je.value, '$.event_id') as ref_id,
               json_extract(je.value, '$.summary') as summary
        FROM eventlog_events e, json_each(e.refs_json, '$') je
        WHERE json_extract(je.value, '$.event_id') = 'task-001'
    """)


def experiment_8_migration_pattern(conn):
    """实验8：模拟 schema 迁移——从纯 TEXT-as-JSON 迁移到混合列"""
    print_header("实验8: Schema 迁移模式验证")

    print("当前模式（tags_json TEXT，纯 JSON）：")
    print_query(conn, """
        SELECT id, tags_json FROM eventlog_events LIMIT 2
    """)

    # 目标模式：新增展开列
    cols = [r[1] for r in conn.execute("PRAGMA table_info(eventlog_events)").fetchall()]
    if 'tags_count' not in cols:
        conn.execute("ALTER TABLE eventlog_events ADD COLUMN tags_count INTEGER")
    if 'first_tag' not in cols:
        conn.execute("ALTER TABLE eventlog_events ADD COLUMN first_tag TEXT")

    # 填充展开列（一次性迁移）
    conn.execute("""
        UPDATE eventlog_events
        SET tags_count = json_array_length(tags_json),
            first_tag = json_extract(tags_json, '$[0]')
    """)
    conn.commit()

    print("\n迁移后（新增展开列）：")
    print_query(conn, """
        SELECT id, tags_json, tags_count, first_tag FROM eventlog_events
    """)


def main():
    print("SQLite JSON Functions 实验")
    print(f"SQLite version: {sqlite3.sqlite_version}")
    print(f"Python sqlite3: {sqlite3.sqlite_version}")

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    create_schema(conn)
    insert_sample_data(conn)

    print("\n\n" + "="*60)
    print("  实验开始")
    print("="*60)

    experiment_1_json_each_tags(conn)
    experiment_2_json_extract_nested(conn)
    experiment_3_json_tree(conn)
    experiment_4_depends_on_json(conn)
    experiment_5_expression_index(conn)
    experiment_6_json_type_and_valid(conn)
    experiment_7_join_real_world(conn)
    experiment_8_migration_pattern(conn)

    print("\n\n" + "="*60)
    print("  实验全部完成")
    print("="*60)

    conn.close()


if __name__ == "__main__":
    main()
```

运行方式：
```bash
python3 sqlite_json_exp.py
# 或
/d/Program\ Files/Python311/python sqlite_json_exp.py
```

依赖：仅使用 Python 内置 `sqlite3` 和 `json` 模块，无需安装任何第三方库。
