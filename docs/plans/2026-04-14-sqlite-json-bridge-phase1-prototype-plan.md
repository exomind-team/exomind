# SQLite JSON Bridge Phase 1 原型计划

> 日期：2026-04-14
> 状态：原型完成，已验证
> 上游文档：
> - `docs/plans/2026-04-14-sqlite-json-bridge-research.md`
> - `docs/plans/2026-04-14-sqlite-json-bridge-handoff.md`

---

## 摘要

在 `exomind-runtime` 内部新增一个同步版 `sqlite_json_bridge` 原型模块，先以 `tasks` 为首个真实接入对象，采用“单行 = 一个完整 JSON 对象”的桥接模型。

本轮目标不是替换现有业务 store，而是在域外完成隔离原型：自动建表/补列、完整对象 CRUD、复合主键支持、`*_json` 保留字段、`_ext_json` 兜底，以及基于低层 SQL `where + params` 的 JSON 查询能力。

本轮完成标准：

- bridge 模块级测试通过
- 真实 SQLite 临时文件验证通过
- 存在一个 bridge 驱动的 `tasks` 并行原型适配器，验证真实任务表场景可行
- 不修改现有 `SqliteTaskStore` 生产路径

---

## 关键实现

### 1. 模块边界与实现方式

- 在 `crates/exomind-runtime/src/sqlite_json_bridge/` 新增 internal module，不新建 workspace crate。
- 保持同步实现，沿用 `rusqlite + Mutex<Connection>` 风格。
- bridge 负责：
  - `TableSchema` 注册
  - 根据 schema 自动建表
  - 根据 schema 条件补列
  - JSON 对象与 SQLite 行互转
  - 普通索引声明与创建
- bridge 不负责：
  - patch 语义
  - 逻辑删除
  - 表达式索引实现
  - DSL 查询层
  - 现有业务 store 替换

### 2. 核心接口与类型

- 主键从一开始支持复合主键。
- `key` 使用 Rust 原生结构承载，不用 JSON 字符串。
- 直接定为：

```rust
type JsonKey = serde_json::Map<String, serde_json::Value>;
```

- Phase 1 核心接口：
  - `upsert_json(table, doc) -> JsonKey`
  - `get_json(table, &key) -> Option<Value>`
  - `query_json(table, sql_where, params) -> Vec<Value>`
  - `delete_json(table, &key) -> bool`
- `upsert_json` 仅接受“单行完整对象”。
- `delete_json` 语义固定为物理删除行。
- 类型不匹配默认严格报错，不做隐式转换。
- 缺失字段与显式 `null` 严格区分：
  - 缺失字段按 schema 默认或不写入处理
  - 显式 `null` 写入 SQL `NULL`，前提是字段类型允许

### 3. SchemaRegistry 与字段模型

- `TableSchema` 采用显式字段清单，不做自动推导。
- 每张表 schema 至少包含：
  - `primary_keys`
  - `expanded_fields`
  - `preserved_fields`
  - `ext_field`
  - `indexes`
- preserved/ext 列命名保持现有仓库风格：
  - preserved 字段落为 `field_name_json`
  - 兜底字段落为 `_ext_json`
- 未注册字段默认自动进入 `_ext_json`。
- 索引策略：
  - Phase 1 只支持普通索引声明
  - 不实现表达式索引
- bridge 初始化时应：
  - 若表不存在则创建
  - 若列不存在则补列
  - 若普通索引不存在则创建
- 若遇到需要重建表的迁移场景，本轮不自动处理；直接报不支持或保留 TODO，避免误做复杂迁移。

### 4. tasks 首个真实接入策略

- 新增一个 bridge 驱动的 `tasks` 并行原型适配器，不替换现有 `SqliteTaskStore`。
- 原型适配器只覆盖本轮验证所需能力：
  - task JSON -> row 写入
  - row -> task JSON 读取
  - 按复合主键读写
  - 基于低层 `where + params` 做简单查询
- `tasks` schema 的初始字段划分按现有表风格对齐：
  - expanded：`scope_key`, `id`, `title`, `description`, `done_condition`, `status`, `priority`, `source`, `parent_id`, `due_at`, `estimated_minutes`, `created_at`, `updated_at`, `completed_at`
  - preserved：`tags`, `depends_on`, `time_block_ids`
  - ext：`_ext_json`
- 本轮不追求和现有 `Task` 业务 API 完全等价，只要求证明 bridge 可以正确承载真实任务表结构。

---

## 公开接口与类型变化

- 新增 internal module：`sqlite_json_bridge`
- 新增核心内部类型：
  - `JsonKey`
  - `TableSchema`
  - `FieldDef`
  - `IndexDef`
  - `SchemaRegistry`
  - `SqliteJsonBridge`
  - `BridgeError`
- 不修改现有对外 HTTP/Tauri API。
- 不修改现有 `task`, `eventlog`, `timeblock` 业务模块的默认运行路径。

---

## 测试与验收

### 模块级测试

至少覆盖以下场景：

1. 单主键表与复合主键表都能正确 CRUD
2. `tasks` 风格 schema 可自动建表
3. 已有表缺少 preserved/ext 列时可自动补列
4. expanded 字段可正确写入与读回
5. preserved 字段以 `*_json` 形式正确往返
6. 未注册字段自动落入 `_ext_json` 并可还原
7. `missing` 与 `null` 行为严格区分
8. 类型不匹配时报错
9. `query_json(table, where, params)` 可驱动基于普通列的查询
10. `query_json` 可驱动基于 `json_each/json_extract` 的 preserved JSON 查询
11. 删除为物理删行，删除后 `get_json` 返回空

### 文件级验证

- 所有关键路径除内存 SQLite 外，至少再跑一遍临时目录下真实 sqlite 文件：
  - open/init
  - auto create
  - upsert
  - close/reopen
  - get/query/delete
- 临时文件放在测试临时目录中，不产生 repo 跟踪文件。

### tasks 原型验收

- 用 bridge 驱动的并行 `tasks` 原型适配器完成：
  - 写入一个完整 task JSON
  - 读回保持语义一致
  - 对 `tags/depends_on/time_block_ids` 的 JSON 字段查询至少各证明一类场景可行中的一类
  - 复合主键 `(scope_key, id)` 正常工作

---

## 已选默认与假设

- bridge 先做 internal module，不拆独立 crate
- 先做同步，不做 async
- `key` 用 `serde_json` 的 Rust 原生映射结构
- Phase 1 输入是“单行完整对象”
- 查询边界固定为低层 `where + params`
- 未注册字段自动进 `_ext_json`
- preserved/ext 保持现有 `*_json` 命名
- 类型不匹配严格报错
- 删除是物理删除
- 首个真实接入对象是 `tasks`
- 原型在域外并行验证，不动现有业务逻辑
- 真实 sqlite 文件验证必须包含，文件位于测试临时目录

---

## 实验结果（2026-04-14）

### 完成情况

- 已在 `crates/exomind-runtime/src/sqlite_json_bridge/` 落地同步版 internal bridge 原型
- 已新增 `tasks` 域并行原型适配器 `crates/exomind-runtime/src/task/bridge_prototype.rs`
- 未替换现有 `SqliteTaskStore` 生产路径
- 已完成内存 SQLite 与真实临时文件 SQLite 双路径验证
- 已补充现有表兼容性校验：
  - schema 必须声明 `_ext_json`
  - 已有表主键形状不一致时报 `UnsupportedMigration`
  - 已有列类型 / 可空性不兼容时报 `UnsupportedMigration`

### 关键验证结果

- bridge 模块级测试通过：`cargo test -p exomind-runtime --lib sqlite_json_bridge::tests`
- tasks 并行原型测试通过：`cargo test -p exomind-runtime --lib task::bridge_prototype::tests`
- `exomind-runtime` 全量 lib 单测通过：`cargo test -p exomind-runtime --lib`

### 结论

本轮原型已经证明：

1. `tasks` 现有表结构可以被显式 schema bridge 正确承载
2. bridge 与现有 `SqliteTaskStore` 可共享同一份 `tasks.sqlite` 数据格式
3. bridge 写入的数据可被现有 store 读取，现有 store 写入的数据也可被 bridge 读取
4. `expanded + preserved(*_json) + _ext_json` 这一模型足以覆盖当前 `tasks` 域的核心持久化形态

### 对当前代码的补足潜力

- 可作为后续 `tasks` / `eventlog` / `timeblock` 显式 schema 化改造的内部基础层
- 可用于把当前“手写 SQL store”逐步收敛为“领域适配器 + 通用 bridge”
- 可先承担导入导出、迁移验证、并行读写实验等低风险接入场景，再决定是否进入主路径替换
