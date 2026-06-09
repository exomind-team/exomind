# EDS 架构讨论稿 v4

> 日期：2026-04-14
> 状态：v4，新增投影层定义、CRL × AtomicGroup 协作、ConflictObject 表、Validation Layer 位置、TimeBlock 数据融合、迁移触发时机与顺序
> 参与方：DSON 研究 + ECS 研究 + 跨设备同步计划交叉综合 + #906 搬迁决策 + 架构审阅 + 超级提问确认
> 蓝图性质：本文档是 #906 新架构的完整蓝图，面向满血版 EDS 的最终形态。
> 当前源码实现状态不影响本文档的架构决策；蓝图优先于现状。

---

## 核心设计原则：Schema 与冲突策略强绑定

JSON Schema 和冲突裁决策略是**一体两面**，声明时同时声明，不可分离。

```
  错误理解：Schema 和冲突策略是分开的两套声明

    schema.ts        → 定义字段名和类型
    conflict.ts      → 定义每个字段的冲突策略
    两者之间靠字段名手动关联，容易错位

  正确理解：Schema 和冲突策略是同一个声明

    TaskSchema {
      title:   String + Lww("updated_at")
      status:  String + Terminal(["completed", "cancelled"])
      tags:    Vec<String> + MergeAll
    }
    字段名、类型、冲突策略三者同时声明，天然对齐
```

### 存储适配层：真相源在持久层，操作层在另一端

**这是 B3 问题的最终答案。**

存储适配层（DsonStorageAdapter）是整条同步链路的唯一真相锚点：

```
  ┌─────────────────────────────────────────────────────────────┐
  │              Storage Adapter（存储适配层）                    │
  │                                                             │
  │    面向「持久化端」的一侧 ← ← ← ← ←  真相源在这里           │
  │         ↑                              ↑                   │
  │         │                              │                   │
  │    SQLite / JSON 文件 / 内存数据库 / 任何可持久化介质        │
  │                                                             │
  │         ↓                              │                   │
  │         │                              ↓                   │
  │    面向「操作端」的一侧 ← ← ← ← ← ←  可同步、可合并、可对接 UI  │
  │                                                             │
  └─────────────────────────┬───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         DSON Store     Projection       冲突裁决
       （合并发生地）    Layer          Resolution
       ← 内存中的 CRDT 合并结果，只是投影缓存，不是真相源
```

**关键原则**：

1. **真相源永不落在 DSON 合并处**。DSON 在 Rust 内存中做合并操作，合并结果本身不是存储的地点。合并后的状态通过 Storage Adapter 写入持久层，真相才落定。

2. **DSON snapshots 只是同步用的投影缓存**。DSON snapshots 可以在内存中暂存，用于传输或显示，但它们不替代持久化端作为真相源。

3. **Storage Adapter 的两端职责严格分离**：
   - **持久化端**：连接 SQLite、JSON 文件、内存数据库等，负责最终落盘
   - **操作端**：连接 DSON Store、Projection Layer、UI 路径，供合并操作和界面读取
   - 连接哪类持久化介质（SQLite / 文件 / 内存 DB），不影响 Storage Adapter 两侧的语义定位

4. **这意味着**：即便未来 Storage Adapter 连接的是纯内存对象，或接入了一个全新的存储引擎，只要它连接持久层的那一侧存在，整条同步链路的真相源定位就不变。

---

### DSON 嵌套 JSON 的三层职责边界

DSON 必须能够处理任意深度的嵌套 JSON 同步。Schema 声明层、DSON 层、Storage Adapter 层各自承担不同的职责，三者严格分离：

```
  Schema 声明层（what — 要声明什么）
  ├── 声明嵌套 JSON 的字段路径
  ├── 声明每个路径节点用什么冲突策略
  ├── 支持「大原子」—— 整个 Object/Array 当一个不可分单元
  └── 支持「动态结构」—— 未知字段名的递归合并

  DSON 层（how — 怎么实现）
  ├── OrMap 承载嵌套结构（key-value 映射）
  ├── MvReg 承载并发值（任意类型的叶子节点）
  ├── OrArray 承载有序列表（追加型）
  └── 递归下降时按 Schema 声明的路径节点策略执行

  Storage Adapter 层（persist — 怎么存）
  ├── 字段级原子操作（json_set / json_patch / json_extract）
  ├── 对 Schema 声明的路径完全透明
  └── 底层只认结构化 JSON，不管 CRDT 语义
```

**三层各司其职**：Schema 声明"什么字段用什么策略"，DSON 按策略递归执行合并，Storage Adapter 只负责把最终 JSON 原子地写入持久层。

---

### Schema 的三种字段声明模式

Schema 必须同时支持三种不同的字段声明粒度，以应对不同的业务数据特性：

```rust
// 模式 A：嵌套结构，路径级冲突策略
// 适用于：EventLog.events[].type、Task.subtasks[].status
FieldDecl {
    name: "events",
    ty: FieldType::Array,
    resolution: FieldResolution::Nested(vec![
        // events[].type — 每个事件的 type 字段独立 LWW
        NestedField { path: vec!["type"], resolution: FieldResolution::Lww("actor") },
        // events[].timestamp — 时间戳用自身值做 LWW
        NestedField { path: vec!["timestamp"], resolution: FieldResolution::Lww("timestamp") },
        // events[].payload — 整个 payload 对象按用户介入裁决
        NestedField { path: vec!["payload"], resolution: FieldResolution::UserRequired },
    ]),
}

// 模式 B：大原子 — 整个字段当一个不可分单元
// 适用于：Task.tags、Task.metadata、Proposal.action_params
FieldDecl {
    name: "tags",
    ty: FieldType::Array,
    resolution: FieldResolution::MergeAll,  // 整个 tags 数组做 OR 合并，不展开内部字段
}

FieldDecl {
    name: "metadata",
    ty: FieldType::Object,
    resolution: FieldResolution::MergeAll,  // metadata 整体做 OR 合并
}

// 模式 C：动态结构 — schema 非固定，递归跟踪内部变化
// 适用于：Task.custom_fields、User.profile_data
// 新增的字段自动继承父级的默认策略，不需要预先声明
FieldDecl {
    name: "custom_fields",
    ty: FieldType::Object,
    resolution: FieldResolution::RecursiveOr,  // 递归 OR：子字段各自独立合并，新增字段自动采纳
}
```

**三种模式的区别**：

| 模式 | Schema 是否固定 | 冲突策略粒度 | 典型场景 |
|------|--------------|------------|---------|
| **A 嵌套声明** | 固定 | 路径级 | EventLog.events[].type、Task.subtasks |
| **B 大原子** | 固定 | 字段级 | Task.tags、Task.metadata、Proposal.action_params |
| **C 动态递归** | 不固定 | 字段级 | Task.custom_fields、User.profile_data |

---

### 统一的 Schema 数据结构

在 Rust 侧，一个统一的 `Schema` 数据结构同时声明所有业务数据类型，打通 Domain 层到 DSON 层到存储层的完整链路：

```rust
// ── 冲突裁决策略注解 ──────────────────────────────────────────────
enum FieldResolution {
    Lww(String),                    // Last Write Wins，按某个时间戳字段排序
    Terminal(Vec<&'static str>),   // 终态优先，[completed, cancelled]
    AtomicGroup(Vec<&'static str>), // 字段组原子约束（解决 B4：终态 + 时间戳必须同时采纳）
    UserRequired,                   // 需要用户介入
    MergeAll,                      // 整体 OR 合并（大原子模式）
    RecursiveOr,                   // 递归 OR（动态结构模式）
    Nested(Vec<NestedField>),      // 嵌套路径声明（模式 A）
}

// 嵌套字段声明（模式 A）
struct NestedField {
    path: Vec<&'static str>,         // 相对路径，如 ["events", "type"]
    resolution: FieldResolution,       // 该路径节点的冲突策略
}

// ── 字段声明：类型 + 冲突策略同时声明 ─────────────────────────────
struct FieldDecl {
    name: &'static str,
    ty: FieldType,       // String / Number / Bool / Array / Object / Timestamp
    resolution: FieldResolution,
}

// ── 文档 Schema：doc_id 前缀 + 所有字段声明 ──────────────────────
struct DocSchema {
    doc_id_prefix: &'static str,  // "task:", "eventlog:", "timeblock:", ...
    fields: Vec<FieldDecl>,
}

// ── 全局 Schema：所有业务对象类型的统一声明 ───────────────────────
struct Schema {
    docs: Vec<DocSchema>,
}
```

### Schema 是唯一的入口

```
  Schema（Rust 侧唯一的声明文件）
       │
       ├── doc_id_prefix   → 决定 DSON Store 中的文档标识
       ├── field.name      → 决定 JSON 中的字段名
       ├── field.ty       → 决定 DSON 用 OrMap / OrArray / MvReg / MvReg
       ├── field.resolution → 决定 Conflict Resolution Layer 的裁决策略
       │
       ▼
  Schema 自动生成：
  ┌─────────────────────────────────────────────┐
  │  DSON 层                                       │
  │  · OrMap/MvReg/OrArray 的类型绑定            │
  │  · Delta 生成时的字段映射                     │
  │  · CausalContext 的维护                      │
  └─────────────────────────┬───────────────────┘
                              │
  ┌─────────────────────────▼───────────────────┐
  │  Conflict Resolution Layer                     │
  │  · 每个字段的 resolution 决定裁决行为          │
  └─────────────────────────┬───────────────────┘
                              │
  ┌─────────────────────────▼───────────────────┐
  │  DsonStorageAdapter                           │
  │  · 字段级操作（json_set / json_extract）     │
  │  · doc_id 前缀用于表分区或命名空间            │
  └─────────────────────────────────────────────┘
```

Domain 层只需要声明 Schema：
```rust
// 整个 EDS 系统的唯一声明入口
static EDS_SCHEMA: Schema = Schema {
    docs: vec![
        // ── Task：模式 B（大原子）+ 模式 C（动态递归）+ B4（字段组原子）─────────
        DocSchema {
            doc_id_prefix: "task:",
            fields: vec![
                // 模式 B：tags 整体当一个大原子，OR 合并整个数组
                FieldDecl { name: "tags",         ty: FieldType::Array,   resolution: FieldResolution::MergeAll },
                // 模式 B：metadata 整体递归 OR，新增字段自动合并
                FieldDecl { name: "metadata",     ty: FieldType::Object,  resolution: FieldResolution::RecursiveOr },
                // B4：status 和 completed_at 必须原子裁决，不允许单独出现终态
                FieldDecl { name: "status",       ty: FieldType::String,  resolution: FieldResolution::AtomicGroup(vec!["status", "completed_at"]) },
                FieldDecl { name: "completed_at",  ty: FieldType::Number,  resolution: FieldResolution::AtomicGroup(vec!["status", "completed_at"]) },
                // 普通字段
                FieldDecl { name: "title",        ty: FieldType::String,  resolution: FieldResolution::Lww("updated_at") },
                FieldDecl { name: "updated_at",    ty: FieldType::Number,  resolution: FieldResolution::Lww("updated_at") },
                FieldDecl { name: "assigned_to",   ty: FieldType::String,  resolution: FieldResolution::UserRequired },
            ],
        },
        // ── EventLog：模式 A（嵌套声明）────────────────────────────────────
        DocSchema {
            doc_id_prefix: "eventlog:",
            fields: vec![
                // 模式 A：events 是数组，展开每个元素的内部字段级策略
                FieldDecl {
                    name: "events",
                    ty: FieldType::Array,
                    resolution: FieldResolution::Nested(vec![
                        NestedField { path: vec!["type"],      resolution: FieldResolution::Lww("timestamp") },
                        NestedField { path: vec!["timestamp"], resolution: FieldResolution::Lww("timestamp") },
                        NestedField { path: vec!["actor"],     resolution: FieldResolution::Lww("timestamp") },
                        NestedField { path: vec!["payload"],  resolution: FieldResolution::RecursiveOr },
                    ]),
                },
            ],
        },
        // ── TimeBlock：数据融合（active + completed 统一）────────────────────
        // v4 决策：不再区分 active 和 completed 两种独立数据结构。
        // 「活跃时间块」仅作为「最新开放时间块」存在（end_time = null）。
        // 历史 completed blocks 在同一 blocks 数组中保留，不迁移到独立表。
        DocSchema {
            doc_id_prefix: "timeblock:",
            fields: vec![
                // blocks：OrArray + 字段级 LWW
                // 每个 block 内字段独立 LWW（description 递归 OR）
                FieldDecl {
                    name: "blocks",
                    ty: FieldType::Array,
                    resolution: FieldResolution::Nested(vec![
                        NestedField { path: vec!["block_type"],   resolution: FieldResolution::MergeAll },
                        NestedField { path: vec!["start_time"],  resolution: FieldResolution::Lww("updated_at") },
                        NestedField { path: vec!["end_time"],    resolution: FieldResolution::Lww("updated_at") },
                        NestedField { path: vec!["description"], resolution: FieldResolution::RecursiveOr },
                        NestedField { path: vec!["tags"],         resolution: FieldResolution::MergeAll },
                    ]),
                },
            ],
        },
        // ── Proposal：终态只含 approved/rejected，draft 是中间态 ─────────────
        DocSchema {
            doc_id_prefix: "proposal:",
            fields: vec![
                // Terminal 只包含真正的终态，draft 不出现在这里
                FieldDecl { name: "status",         ty: FieldType::String,  resolution: FieldResolution::Terminal(["approved", "rejected"]) },
                // action_params 整体当大原子，不展开内部字段
                FieldDecl { name: "action_params",   ty: FieldType::Object, resolution: FieldResolution::MergeAll },
                // comments 递归 OR，新评论自动合并
                FieldDecl { name: "comments",        ty: FieldType::Array,  resolution: FieldResolution::RecursiveOr },
            ],
        },
        // ── Reminder（功能迁移，非存储迁移）──────────────────────────────
        // ⚠ Reminder 域的存储架构（Pouch 残留 + 前端 scheduler 依赖）尚未成熟，
        // 不应作为新 EDS 的参考。Reminder 在新架构中的定位是：
        // 「只迁移功能与逻辑，不迁移其特有存储架构」。
        //
        // 实现路径：
        // 1. 将 Reminder 的触发逻辑与 TimeBlock 域或 EventLog 域整合
        //    （Reminder 本质是「在 trigger_at 触发一个事件」，天然落在 EventLog）
        // 2. DSON schema 中 Reminder 仅作为 minimal schema（用于历史数据迁移入口）
        //    而非独立域的存储模型
        // 3. ReminderService 变为一个无状态调度层，触发结果写入 EventLog/TimeBlock
        DocSchema {
            doc_id_prefix: "reminder:",
            fields: vec![
                // minimal schema：仅用于历史数据一次性迁移，不定义复杂冲突策略
                // 触发结果直接落入 EventLog（作为一条 event），Reminder 本身不留副本
                FieldDecl { name: "trigger_at",   ty: FieldType::Number, resolution: FieldResolution::Lww("trigger_at") },
                FieldDecl { name: "triggered_at",  ty: FieldType::Number, resolution: FieldResolution::Lww("triggered_at") },
                FieldDecl { name: "repeat",        ty: FieldType::Object, resolution: FieldResolution::RecursiveOr },
            ],
        },
    ],
};
```

**Schema 是从 Domain 层到 DSON 层到存储层的唯一入口。声明一次，全链路自动贯通。**

---

## 核心断言（#906）

> **从零设计时，EDS 只应有一个 rail：DSON。所有存储和同步都统一在 DSON 之下。**

「四类数据特性」（可变对象、追加型事实流、不可变内容、运行态状态）只是 **DSON 对象上的不同语义表现**，不是四个并行的技术系统。避免因为数据哲学不同而分裂出四套存储/同步机制，从而避免重复建设和跨系统协调成本。

## 核心设计原则：数据统一 JSON 化

Domain 层只需要知道两件事：

1. **我的对象 JSON 长什么样**
2. **每个字段的冲突裁决策略是什么**

DSON 在底下默默处理 delta / causal context / merge / tombstone-free，**上层完全无感知**。

```
  ┌──────────────────────────────────────────────────────────┐
  │                     Domain 层（无感知）                     │
  │                                                           │
  │   只需要声明两件事：                                      │
  │   1. 对象 JSON Schema（字段名 + 类型）                   │
  │   2. 每个字段的冲突裁决策略（声明式注解）                  │
  │                                                           │
  │   不需要知道：                                             │
  │   · DSON 的存在                                          │
  │   · MvReg / OrMap / OrArray 的区别                      │
  │   · CausalContext / Delta 的机制                        │
  └──────────────────────────────┬───────────────────────────┘
                                   │ 业务对象 JSON + 冲突策略声明
  ┌───────────────────────────────▼───────────────────────────┐
  │              Validation Layer（声明式校验）                  │
  │                                                           │
  │   对所有业务数据一视同仁的校验规则                         │
  │   · 字段非空                                             │
  │   · schema 版本兼容                                      │
  │   · null 值兜底                                          │
  └──────────────────────────────┬───────────────────────────┘
                                   │
  ┌───────────────────────────────▼───────────────────────────┐
  │              DSON 层（自动处理，透明）                     │
  │                                                           │
  │   感知到的是：                                           │
  │   · 冲突裁决策略（按字段自动选择 LWW / Terminal / UserRequired）│
  │   · 对象 JSON Schema（用于 OrMap / MvReg 的类型推断）       │
  │                                                           │
  │   自动完成：                                               │
  │   · Delta 生成                                           │
  │   · CausalContext 维护                                   │
  │   · MvReg 并发值合并                                     │
  │   · Tombstone-free 删除                                   │
  └──────────────────────────────────────────────────────────┘
```

Domain 层不需要知道 DSON，正是这一原则的具体体现——**声明即同步，无需感知底层实现**。

---

## 一、架构定位

EDS（Event Data Sync）是 ExoMind 多设备数据同步的核心架构。

它解决的问题是：**多台设备在没有中央服务器的情况下，如何对 Task、Proposal、EventLog、TimeBlock 等业务对象做增量同步，并在并发修改时正确合并，同时保留冲突可见性。**

核心设计原则：
- **唯一的底层**：DSON Object Store（OrMap / OrArray / MvReg）
- **唯一的同步机制**：Delta + CausalContext
- **唯一的存储接口**：DsonStorageAdapter
- **对一视同仁**：所有业务数据在 Validation Layer 适用相同的校验规则，不因数据类型而异

---

## 二、架构分层

### 2.1 分层总览

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┌───────────────────────────────────────────────┐
  │              Domain Services                      │
  │  TaskService / TimeBlockService /                │
  │  EventLogService / ProposalService              │
  │  ReminderService                               │
  │                                                   │
  │  输入输出都是纯业务对象 JSON：                   │
  │  Task { id, title, status, tags, ... }       │
  │  ← 永远不暴露 DSON 结构                        │
  └────────────────────┬──────────────────────────┘
                        │ 业务对象 JSON
  ┌────────────────────▼──────────────────────────┐
  │            Validation Layer                       │
  │                                                   │
  │  对所有业务数据一视同仁：                       │
  │  · 字段非空校验                                │
  │  · schema 版本兼容                              │
  │  · null 值兜底                                 │
  │  · 不按数据类型区分校验规则                      │
  └────────────────────┬──────────────────────────┘
                        │
           ┌────────────┴────────────┐
           │ local only  │   sync path │
           │ (无多端)  │  (有多端)   │
           ▼             ▼
  ┌─────────────┐ ┌────────────────────────────┐
  │ Projection  │ │         DSON Store        │
  │ Layer       │ │   OrMap / OrArray / MvReg  │
  │ (直接落库) │ │                            │
  │             │ │  ← 上层不可见内部结构      │
  │             │ │  只暴露「是否有冲突」的     │
  │             │ │  布尔门卫值               │
  └──────┬──────┘ └──────────┬─────────────┘
           │                     │
           │                     │ DSON JSON（含 MvReg 等结构）
           ▼                     ▼
  ┌───────────────────────────────────────────────┐
  │           DsonStorageAdapter                    │
  │                                                   │
  │  字段级 schema-aware 的 JSON 操作：             │
  │  · 原子更新单字段（json_set）                  │
  │  · 字段级读取（json_extract）                  │
  │  · 条件查询（WHERE json_extract(...) = ?）    │
  │  · Delta apply（json_patch）                  │
  │  · 事务支持（多字段原子更新）                  │
  │                                                   │
  │  ┌─────────────────────────────────────────┐   │
  │  │  不负责：                                │   │
  │  │  · 不懂 CRDT 语义（MvReg 在上层处理）  │   │
  │  │  · 不做冲突裁决（CRL 在上层处理）      │   │
  │  │  · 不做业务对象投影（Projection 在上层）│   │
  │  └─────────────────────────────────────────┘   │
  └────────────────────┬──────────────────────────┘
                        │ JSON 字符串
                        ▼
                 ┌─────────────┐
                 │   SQLite   │ ← TEXT 字段，存结构化 JSON
                 └─────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2.2 分层职责矩阵

| 层次 | 职责 | 不负责 |
|------|------|--------|
| **Domain Services** | 业务逻辑，输入输出都是纯业务对象 JSON | 不感知 DSON、不感知同步细节 |
| **Validation Layer** | 对所有业务数据一视同仁的写前/读后校验 | 不做 CRDT 合并、不做业务逻辑 |
| **Projection Layer** | `业务对象 ↔ 同步用对象` 转换 | 不做冲突裁决、不做持久化 |
| **DSON Store** | CRDT 合并（OrMap/MvReg/OrArray），对上层只暴露「是否有冲突」 | 不做业务投影、不做持久化 |
| **Conflict Resolution Layer** | 自动裁决（LWW/terminal 优先）、标记需用户介入的冲突、推送通知 | 不做持久化、不做业务逻辑 |
| **DsonStorageAdapter** | 字段级 JSON 操作（原子更新/查询/Delta apply） | 不懂 CRDT 语义、不做冲突裁决 |
| **SQLite / Storage** | 持久化 TEXT JSON | 无业务语义 |

---

## 三、核心断言：只有一条技术轨道

DSON 是唯一的底层技术轨道。「可变对象、追加型事实流、不可变内容、运行态状态」是 DSON 对象上的四种语义表现，不是四个独立的存储或同步系统。

| 数据语义 | DSON 中的表现 | 冲突处理 |
|---------|-------------|---------|
| **可变对象**（Task、Proposal、Settings） | OrMap + MvReg | CRDT merge（MvReg 保留并发值） |
| **追加型事实流**（EventLog） | OrArray + 写约束 | 追加天然无冲突，OrArray 满足交换性 |
| **不可变内容**（Blob 引用） | OrMap + immutable 约束 | 内容不可变，无冲突 |
| **运行态状态**（Active TimeBlock） | OrMap + lease 语义 | 独占性约束，Conflict Resolution 处理 |

所有数据都在 **同一个 DSON Store** 中，用 **同一套 DsonStorageAdapter** 持久化，走 **同一套 Conflict Resolution Layer**——只是 DSON 的不同原语组合和不同的 Validation 约束。

---

## 四、核心数据结构

### 4.1 DSON 文档结构（同步用对象）

```rust
// DSON 中的 Task 文档
// 不暴露给 Domain Service 层，仅 DSON Store 层使用
struct TaskDoc {
    id: String,
    title: MvReg,        // 多值寄存器，保留并发修改
    description: MvReg,
    status: MvReg,
    tags: OrArray,
    metadata: OrMap,
}

// EventLog 文档（追加型）
struct EventLogDoc {
    id: String,
    events: OrArray,  // OrArray 天然满足追加的交换性
}

// Active TimeBlock 文档（lease 状态）
struct ActiveTimeBlockDoc {
    id: String,
    task_id: String,
    started_at: MvReg,
    owner: MvReg,  // 谁在计时
    status: MvReg,
}
```

### 4.2 业务对象（Domain Service 层使用）

```rust
// 上层只看到这个结构
struct Task {
    id: String,
    title: String,
    description: String,
    status: TaskStatus,
    tags: Vec<String>,
    created_at: i64,
    updated_at: i64,
}

struct Event {
    id: String,
    type: String,
    payload: serde_json::Value,
    timestamp: i64,
    actor: String,
}

struct ActiveTimeBlock {
    id: String,
    task_id: String,
    started_at: i64,
    duration: i64,
    owner: String,
    status: String,
}
```

### 4.3 Delta 格式（网络传输用 JSON）

```json
{
    "type": "delta",
    "doc_id": "t1",
    "changes": [
        {
            "path": ["title"],
            "op": "set",
            "actor": "device-a",
            "seq": 2,
            "value": "完成季度报告"
        }
    ],
    "causal_context": [
        { "actor": "device-a", "seq": 2 },
        { "actor": "device-b", "seq": 1 }
    ]
}
```

---

## 五、DSON 的真实位置

### 5.1 本地编辑（无同步场景）

DSON **完全不参与**这条路径：

```
  用户本地编辑 Task
       │
       ▼
  Domain Service（纯业务逻辑）
       │
       ▼
  Validation Layer（字段校验，对所有数据类型一视同仁）
       │
       ▼
  Projection Layer（直接投影，不经过 DSON）
       │
       ▼
  DsonStorageAdapter（字段级写入）
       │
       ▼
  SQLite（持久化）
```

### 5.2 跨设备同步场景

DSON **仅在同步路径中出现**：

```
  设备A本地编辑 ───────────────────────┐
       │                                 │
  Domain Service                    DSON Store
  （纯业务对象）                    OrMap / MvReg
       │                                 │
  Validation                          │
  Layer                               │
       │                               │
  Projection ─────────────────────────┤
  Layer                               │
       │                               │
  ──────────── DSON JSON ─────────────┤
       │                               │
  DsonStorageAdapter              Conflict
  （字段级读写）                   Resolution
       │                               │ 自动裁决
       ▼                               ▼
  ┌────────────┐              ┌──────────────┐
  │ Projection │◄────────────│ 裁决后业务对象│
  │ Layer     │              └──────────────┘
  └─────┬─────┘
        ▼
  DsonStorageAdapter
        │
        ▼
     SQLite
```

### 5.3 DSON 对上层的接口

DSON Store 对 Projection Layer **只暴露一个门卫值**：

```rust
pub struct SyncGate {
    pub has_conflict: bool,           // 是否有并发冲突需处理
    pub conflict_fields: Vec<String>, // 哪些字段有冲突
}

impl DsonStore {
    /// 对上层暴露的接口：同步门卫
    pub fn get_sync_status(&self, doc_id: &str) -> SyncGate;

    /// 对 Projection Layer：返回合并后的干净业务对象
    pub fn project_to_domain(&self, doc_id: &str) -> serde_json::Value;

    /// 对 CRL 层：返回原始 MvReg 数据（用于展示冲突）
    pub fn get_conflict_data(&self, doc_id: &str) -> ConflictData;
}
```

上层（Domain Service / Projection Layer）永远不需要知道 `MvReg`、`CausalContext`、`OrMap` 的存在。

---

## 六、存储接口设计

### 6.1 DsonStorageAdapter trait

```rust
/// 存储层是 schema-aware 的，不是 blob storage
/// 底层能够逻辑级掌控 JSON 对象，而不仅仅是存储文本
pub trait DsonStorageAdapter: Send + Sync {
    // ── 快照级操作 ──
    fn write_snapshot(&self, doc_id: &str, doc: &serde_json::Value) -> Result<(), StorageError>;
    fn read_snapshot(&self, doc_id: &str) -> Result<Option<serde_json::Value>, StorageError>;
    fn delete_snapshot(&self, doc_id: &str) -> Result<(), StorageError>;

    // ── 字段级操作（存储层的核心能力）──
    /// 原子更新单个字段
    fn update_field(&self, doc_id: &str, path: &str, value: serde_json::Value) -> Result<(), StorageError>;
    /// 字段级读取
    fn read_field(&self, doc_id: &str, path: &str) -> Result<Option<serde_json::Value>, StorageError>;
    /// 原子 patch（用于 DSON delta apply）
    fn apply_delta(&self, doc_id: &str, delta: &serde_json::Value) -> Result<(), StorageError>;

    // ── 条件查询 ──
    fn query(&self, filter: &serde_json::Value) -> Result<Vec<(String, serde_json::Value)>, StorageError>;

    // ── Delta 追加（用于增量 backfill）──
    fn append_delta(&self, doc_id: &str, delta: &serde_json::Value) -> Result<(), StorageError>;
    fn read_deltas(&self, doc_id: &str, from_seq: u64, to_seq: u64) -> Result<Vec<serde_json::Value>, StorageError>;
}
```

### 6.2 SQLite 实现

```rust
pub struct SqliteDsonAdapter {
    pool: sqlx::SqlitePool,
}

impl DsonStorageAdapter for SqliteDsonAdapter {
    fn update_field(&self, doc_id: &str, path: &str, value: &serde_json::Value) -> Result<(), StorageError> {
        let path_expr = format!("$.{}", path);
        let value_json = serde_json::to_string(value)
            .map_err(StorageError::Serialize)?;

        sqlx::query(
            r#"
            UPDATE dson_snapshots
            SET snapshot = json_set(snapshot, ?, ?),
                updated_at = ?
            WHERE doc_id = ?
            "#
        )
        .bind(&path_expr)
        .bind(&value_json)
        .bind(now_ms())
        .bind(doc_id)
        .execute(&self.pool)
        .map_err(StorageError::Db)?;

        Ok(())
    }

    fn apply_delta(&self, doc_id: &str, delta: &serde_json::Value) -> Result<(), StorageError> {
        // SQLite json_patch 做原子 delta apply
        let delta_json = serde_json::to_string(delta)
            .map_err(StorageError::Serialize)?;

        sqlx::query(
            r#"
            UPDATE dson_snapshots
            SET snapshot = json_patch(snapshot, ?),
                updated_at = ?
            WHERE doc_id = ?
            "#
        )
        .bind(&delta_json)
        .bind(now_ms())
        .bind(doc_id)
        .execute(&self.pool)
        .map_err(StorageError::Db)?;

        Ok(())
    }

    fn query(&self, filter: &serde_json::Value) -> Result<Vec<(String, serde_json::Value)>, StorageError> {
        let mut where_clauses = Vec::new();
        let mut bindings: Vec<String> = Vec::new();

        if let Some(obj) = filter.as_object() {
            for (k, v) in obj {
                where_clauses.push(format!(
                    "json_extract(snapshot, '$.{}') = ?",
                    k
                ));
                bindings.push(
                    serde_json::to_string(v)
                        .map_err(StorageError::Serialize)?
                );
            }
        }

        let where_sql = if where_clauses.is_empty() {
            "1=1".to_string()
        } else {
            where_clauses.join(" AND ")
        };

        let sql = format!(
            "SELECT doc_id, snapshot FROM dson_snapshots WHERE {}",
            where_sql
        );

        let mut query = sqlx::query_as::<_, (String, String)>(&sql);
        for binding in &bindings {
            query = query.bind(binding);
        }

        let rows: Vec<(String, String)> = query
            .fetch_all(&self.pool)
            .map_err(StorageError::Db)?;

        Ok(rows
            .into_iter()
            .map(|(id, json)| {
                let doc: serde_json::Value = serde_json::from_str(&json).unwrap();
                (id, doc)
            })
            .collect())
    }

    fn append_delta(&self, doc_id: &str, delta: &serde_json::Value) -> Result<(), StorageError> {
        let delta_json = serde_json::to_string(delta)
            .map_err(StorageError::Serialize)?;

        sqlx::query(
            r#"
            INSERT INTO dson_deltas (doc_id, seq, delta, created_at)
            VALUES (
                ?,
                (SELECT COALESCE(MAX(seq), 0) + 1 FROM dson_deltas WHERE doc_id = ?),
                ?,
                ?
            )
            "#
        )
        .bind(doc_id)
        .bind(doc_id)
        .bind(&delta_json)
        .bind(now_ms())
        .execute(&self.pool)
        .map_err(StorageError::Db)?;

        Ok(())
    }
}
```

### 6.3 SQLite Schema

```sql
-- DSON 快照表
CREATE TABLE dson_snapshots (
    doc_id     TEXT PRIMARY KEY,
    snapshot   TEXT NOT NULL,   -- JSON 结构化数据（所有业务对象共用此表）
    updated_at INTEGER NOT NULL
);

-- DSON Delta 追加表（用于增量 backfill）
CREATE TABLE dson_deltas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    delta      TEXT NOT NULL,   -- DSON delta JSON
    created_at INTEGER NOT NULL,
    UNIQUE(doc_id, seq)
);

CREATE INDEX idx_snapshots_updated ON dson_snapshots(updated_at);
CREATE INDEX idx_deltas_doc_seq ON dson_deltas(doc_id, seq);
```

> 注意：所有业务对象（Task、Proposal、EventLog、TimeBlock、Reminder）共用 `dson_snapshots` 表，`doc_id` 包含类型前缀以区分（如 `task:t1`、`eventlog:e1`）。

---

## 七、冲突解决

### 7.1 三种裁决情况

```
情况1：可自动裁决
  MvReg 并发值
      │
      ▼
  Conflict Resolution Layer
      │
      ├── 策略裁决（LWW / terminal 优先 / origin 优先）
      │
      ▼
  Projection Layer（自动通过，无需用户介入）

情况2：需要用户介入
  MvReg 并发值
      │
      ▼
  Conflict Resolution Layer
      │
      ├── 标记 has_conflict = true
      ├── 推送通知给用户
      │
      ▼
  UI 展示冲突选项给用户
      │
      ▼
  用户选择 → Projection Layer

情况3：策略无法裁决，升级人工
  Conflict Resolution Layer
      │
      ├── 标记 unresolvedDrift = true
      ├── 推送高级别通知
      │
      ▼
  人工处理 → Projection Layer
```

### 7.2 Conflict Resolution Layer 接口

> **v4 更新**：CRL 只处理叶子节点冲突。`AtomicGroup` 跨字段协调在 CRL 层实现（见 8.4 协作流程）。

```rust
pub enum Resolution {
    Auto(serde_json::Value),     // 自动裁决，直接使用该值
    AtomicGroup(Vec<(&'static str, serde_json::Value)>), // 字段组原子裁决，同时采纳或同时拒绝
    UserRequired {
        field: String,
        options: Vec<serde_json::Value>,  // 并发值列表
    },
    Escalate {
        reason: String,
        doc_id: String,
    },
}

pub trait ConflictResolver: Send + Sync {
    /// 裁决单个字段的并发冲突
    fn resolve(&self, field: &str, values: Vec<ConcurrentValue>) -> Resolution;

    /// 批量裁决，返回可直接投影的干净对象
    fn resolve_all(&self, doc: &serde_json::Value) -> ResolutionResult;
}
```

### 7.3 ConflictObject 表（冲突结果持久化）

> **v4 确认**：CRL 裁决结果需要持久化到 ConflictObject 表，供 UI 展示和人工复核。

```sql
CREATE TABLE conflict_objects (
    id           TEXT PRIMARY KEY,       -- conflict UUID
    doc_id       TEXT NOT NULL,         -- e.g. "task:t1"
    field        TEXT NOT NULL,         -- 冲突字段名
    winning_value TEXT NOT NULL,        -- 裁决后胜出的值
    losing_values TEXT NOT NULL,        -- 落败的并发值（JSON array）
    resolution   TEXT NOT NULL,         -- "lww" | "terminal" | "atomic_group" | "user_choice"
    reason       TEXT,                  -- 裁决原因描述
    doc_version  INTEGER NOT NULL,      -- 冲突发生时的 doc 版本
    created_at   INTEGER NOT NULL,
    resolved_at  INTEGER,               -- null = 未解决
    resolved_by  TEXT,                 -- "user" | "system"
    resolved_value TEXT,                -- 用户最终选择的值
);

CREATE INDEX idx_conflicts_unresolved ON conflict_objects(doc_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_conflicts_doc ON conflict_objects(doc_id, created_at);
```

**写入时机**：CRL 裁决时，对于 `UserRequired` 和 `Escalate` 情况，立即写入 ConflictObject 表。对于 `Auto(AtomicGroup)` 情况，可选写入（取决于实现策略）。

**读取引擎**：Projection Layer 查询 ConflictObject 表，将未解决冲突注入 UI 视图。用户解决冲突后，`resolved_at`、`resolved_by`、`resolved_value` 字段更新。

---

## 八、数据流全览

### 8.1 完整同步链路（设备A → 设备B）

```
  Step 1：设备A本地编辑
    用户修改 Task.title = "完成季度报告"
         │
         ▼
    Domain Service（TaskService）
         │
         ▼
    Validation Layer（Write Gate，对所有数据类型一视同仁）
         │
         ▼
    DSON Store（本设备）
    · 生成 delta { path: ["title"], value: "完成季度报告", actor: "device-a", seq: 2 }
    · 更新本地 CausalContext
         │
         ▼
    DsonStorageAdapter（本地持久化）
    · apply_delta("task:t1", delta) → SQLite json_patch

  Step 2：delta 发送
    ECS Client（iroh / libp2p / 定制协议）
    · delta + causal_context → 设备B
    · 传输层不感知 CRDT 语义

  Step 3：设备B接收并合并
    ECS Server（Mesh Relay）
         │
         ▼
    DSON Store（设备B）
    · 收到 delta + causal_context
    · 对比 causal_context，判断哪些操作需要采纳/丢弃
    · 合并产出最终状态

  Step 4：冲突解决
    Conflict Resolution Layer
    · 检查 has_conflict
    · 可自动裁决 → 直接进入 Projection
    · 需用户介入 → 标记冲突，推送通知

  Step 5：投影
    Projection Layer
    · DSON 状态 → 干净业务对象
    · Task { title: "完成季度报告", status: "pending", ... }

  Step 6：持久化
    DsonStorageAdapter
    · update_field("task:t1", "title", "完成季度报告")
    · → SQLite json_set

  Step 7：UI 更新
    RT SQLite → TaskStore → 前端 UI
```

### 8.2 Projection Layer

> **v4 确认**：Projection Layer 是必需的，不可用 DSON JSON 直接替代。

CRL 裁决完成后，DSON merge 结果是结构化的 JSON（含 MvReg 标记），不能直接暴露给 UI。Projection Layer 负责：

1. **叶子节点展开**：将 MvReg 并发值替换为 CRL 裁决后的最终值
2. **默认值填充**：Schema 声明的字段默认值在投影时填入
3. **UI 专用字段构造**：如 `display_name`、`is_overdue` 等计算字段
4. **ConflictObject 持久化**：CRL 的 `has_conflict = true` 结果写入 ConflictObject 表（见 7.3）

Projection Layer 是按域实现的，每个域有自己的 projector。不存在跨域统一 projector。

### 8.3 Validation Layer（Write Gate）

> **v4 确认**：Validation Layer 位于 Domain Service 和 DSON Store 之间，所有写入经过同一套跨域 Write Gate。

Validation Layer 在 DSON write 之前执行，职责：

- **字段存在性**：必填字段不能缺失
- **类型检查**：字段值类型与 Schema 声明一致
- **值域约束**：如 `status` 必须在 `Terminal` 声明的范围内
- **跨域统一**：同一套 Validation 规则适用于所有域，不按域单独实现

验证失败 → 拒绝写入 → 返回错误，不进入 DSON Store。

### 8.4 CRL × AtomicGroup 协作

> **v4 确认**：CRL 只处理叶子节点冲突。`AtomicGroup` 的跨字段原子协调在 CRL 层实现。

```
Schema 声明：
  status: Terminal(["completed", "cancelled"]) + AtomicGroup(["status", "completed_at"])

CRL 处理流程：
  1. 收到 status 和 completed_at 两个叶子节点并发值
  2. 检测到它们属于同一个 AtomicGroup
  3. 作为一组同时裁决：
     - 情况A：status=completed + completed_at=非空 → ✅ 采纳整组
     - 情况B：status=cancelled + completed_at=非空 → ✅ 采纳整组
     - 情况C：status=completed + completed_at=null → ❌ 拒绝（非法中间态）→ 裁决为 cancelled
     - 情况D：两端都发 status=completed + completed_at=非空 → ✅ LWW 裁决
  4. 输出：AtomicGroup 裁决结果 → Projection Layer
```

CRL 对 AtomicGroup 的输出是一个结构化的 `GroupResolution`，不是两个独立字段结果的简单拼接。

---

## 九、与现状的差距

> 以下根据 2026-04-14 架构审阅结果整理，参考了 #906、#868、#869、#910、#893

### 9.1 已成型部分

- ECS 网络层（SignalPool + Mesh Relay + TCP + SSE）
- Task 域的 Reconciliation Service（含 summary / compare / pull / snapshot fallback）
- PeerScopeGrant 鉴权
- **Storage Adapter 持久层为真相源**（v3 新增原则）

### 9.2 当前缺口（v4 更新：B3/B4/B2/Reminder/EventLog+TimeBlock 已解决；新增 Projection Layer、CRL AtomicGroup、ConflictObject 表）

| 缺口 | 说明 | 关联 | 状态 |
|------|------|------|------|
| **DSON 未落地** | 当前 reconciliation 使用"盲跑 snapshot"，无 delta / causal_context | #905、#910 | 待实现 |
| **DsonStorageAdapter 未抽象** | TS 层无统一存储接口，存储层不感知 JSON 结构 | #910 | 待实现 |
| **Schema 不支持嵌套字段声明** | 需要 `Nested` / `RecursiveOr` / `MergeAll` 三种粒度模式 | **已解决（v3）** | ✅ |
| **Storage Adapter 持久端为真相源** | DSON snapshots 和 RT SQLite 都是投影缓存 | **已解决 B3（v3）** | ✅ |
| **语义原子裁决原则未定义** | `AtomicGroup` + CRL 层协调 | **已解决（v3/v4）** | ✅ |
| **Phase 2/3 共存策略** | DSON 从第一天就是唯一路径，Phase 2 是历史迁移工具 | **已解决 B2（v4）** | ✅ |
| **Reminder 域存储归属** | 触发结果落入 EventLog，DSON schema 仅作迁移入口 | **已解决（v4）** | ✅ |
| **EventLog / TimeBlock Reconciliation Adapter** | EventLog 纯追加不需要；TimeBlock 数据融合（active+completed 统一 blocks 数组） | **已解决（v4）** | ✅ |
| **TimeBlock 数据结构** | 不再区分 active/completed，blocks 数组统一管理 | **已解决（v4）** | ✅ |
| **Proposal 域 replication handlers 缺失** | 代码中 `proposal.replication.*` 完全缺失；需要完整 DSON Schema（含 Terminal approved/rejected） | Phase 2 缺口 | ⚠️ |
| **Projection Layer 未定义** | CRL 裁决后需要 projector 将 DSON JSON 转为 UI 视图 | #910 | 待实现 |
| **CRL AtomicGroup 实现** | CRL 层需要协调 `status + completed_at` 等字段组原子裁决 | #910 | 待实现 |
| **ConflictObject 表未定义** | 冲突结果持久化 schema（winning/losing/reason） | #869 | 待实现 |
| **Validation Layer 未实现** | Write Gate（所有域统一验证，在 DSON write 之前） | #910 | 待实现 |
| **mesh relay 文档/实现状态不符** | ECS-3 标注"未实现"但代码生产级 | #910 | 待文档更新 |
| **ECS 网络层选型** | 短期用 iroh 做暂时实现，长期在专门 issue 中跟踪 | **已决策（延期）** | ⏳ |
| **DSON/CDS 命名** | 确认使用 DSON（Delta-State Object Notation） | **已解决（v4）** | ✅ |

---

## 十、实施路线（v4 更新）

```
  Phase 1 ✅  Task 域核心路径（部分成型）
    Live signal + Reconciliation + PeerScopeGrant
    注："已闭环"描述过于乐观，应为"核心路径已通"

  Phase 2 📋 历史遗留迁移（一次性，用户主动触发）
    · 实现 DSON store + Storage Adapter 持久层
    · 实现 EventLog / Proposal / TimeBlock / Reminder 的 DSON Schema 声明
    · 实现 Validation Layer（跨域统一 Write Gate，在 DSON write 之前）
    · 一次性快照迁移：RT SQLite → DSON store
      迁移顺序：EventLog → Proposal → TimeBlock → Reminder
      迁移触发：用户主动触发 migration wizard
    · 补 peer-auth 路由（/mesh/eventlog/*, /mesh/timeblocks/*）
    · Reminder RT backend 改造（脱离前端 scheduler，触发结果入 EventLog）
    迁移完成后 Phase 2 reconciliation 代码废弃，不再运行

  Phase 3 🎯 DSON 完整实现（greenfield）
    · 接入 helsing-ai/dson
    · 实现 DsonStorageAdapter（以持久层为真相源，DSON snapshots 为投影缓存）
    · 抽象 Projection Layer（每个域有自己的 projector）
    · 完善 CRL（含 AtomicGroup 协调 + ConflictObject 持久化）
    · 实现 ConflictObject 表（冲突结果持久化）
    · Schema 驱动的 DSON 层（Nested / RecursiveOr / MergeAll / AtomicGroup 全量落地）
```

---

## 十一、待明确问题（v4 更新）

以下问题已通过超级提问确认或决策：

- [x] **B3（已解决）**：DSON snapshots 是同步用投影缓存，Storage Adapter 持久层是唯一真相源。RT SQLite 是另一层投影缓存。
- [x] **B4（已解决）**：语义原子裁决通过 `AtomicGroup` 策略 + CRL 层协调解决。
- [x] **Schema 嵌套声明（已解决）**：`Nested`、`RecursiveOr`、`MergeAll` 三种粒度覆盖嵌套/大原子/动态结构三种模式。
- [x] **B2（已解决）**：Phase 2 reconciliation 是历史遗留迁移工具，DSON 从第一天起是唯一同步路径。详见第十二节。
- [x] **B1 Proposal 域归属（已解决）**：需要完整 DSON Schema（含 Terminal approved/rejected 和 AtomicGroup），不是最小 Schema。
- [x] **Reminder 域归属（已解决）**：只迁移功能与逻辑，触发结果落入 EventLog，DSON schema 仅作迁移入口。详见 Schema 示例注释。
- [x] **EventLog Reconciliation Adapter（已解决）**：不需要，EventLog 纯追加，一次性迁移后完全废弃。
- [x] **TimeBlock 数据结构（已解决）**：active + completed 统一为 blocks 数组，active = "最新开放时间块"。
- [x] **Projection Layer（已确认）**：需要，每个域有自己的 projector，将 DSON JSON 转为 UI 视图。
- [x] **CRL 范围（已确认）**：只处理叶子节点冲突，AtomicGroup 跨字段协调在 CRL 层实现。
- [x] **Conflict object 持久化（已确认）**：需要独立 ConflictObject 表（详见 7.3 节 SQL schema）。
- [x] **Validation Layer 位置（已确认）**：在 Domain Service 和 DSON Store 之间，所有写入经过跨域统一 Write Gate。
- [x] **迁移触发时机（已确认）**：用户主动触发 migration wizard，不在 RT 启动时自动触发。
- [x] **迁移顺序（已确认）**：EventLog → Proposal → TimeBlock → Reminder。
- [x] **ECS 网络层（已决策）**：短期用 iroh 做暂时实现，长期在专门 issue 中跟踪选型。
- [x] **DSON/CDS 命名（已确认）**：使用 DSON（Delta-State Object Notation）。

**剩余开放问题（需要专门 issue 跟踪）**：
- [ ] Conflict object 持久化 schema 完整实现细节（依赖 #869）
- [ ] ECS 网络层长期选型（iroh / libp2p / 定制协议）
- [ ] DSON/CDS 最小接口边界（类型定义、Rust trait 设计）

---

## 十二、Phase 2 与 Phase 3 共存策略

> **已定决策（2026-04-14）**：新架构从第一天起直接使用 DSON，不存在 Phase 2/3 共存模型。Phase 2 reconciliation 是历史遗留迁移工具，不是新架构的一部分。
>
> 文档保留模型 A/B/C 的分析，作为"为什么我们不选它们"的历史对照。

### 12.1 已定决策

| 决策点 | 结论 | 理由 |
|--------|------|------|
| 同步机制 | **DSON 从第一天起就是唯一路径** | DSON 的 CRDT 数学保证是核心价值；任何双轨共存都会引入权威归属的灰色地带 |
| Phase 2 角色 | **历史遗留迁移工具** | 仅用于一次性快照迁移（legacy RT SQLite → DSON store），迁移完成后 Phase 2 代码不再运行 |
| 权威归属 | **DSON 是唯一权威** | 不存在"两条路径打架"的情况；Phase 2 输出在迁移期间单向流入 DSON，之后废弃 |
| 遗留数据迁移 | **一次性快照迁移** | RT SQLite 当前状态导出为 DSON snapshot，写入 DSON store，迁移完成 |
| 迁移触发时机 | **用户主动触发（migration wizard）** | 不在 RT 启动时自动触发；用户在设置页面主动选择升级，wizard 引导完成迁移 |
| 迁移顺序 | **EventLog → Proposal → TimeBlock → Reminder** | EventLog 最简单（纯追加），Proposal 次之（有终态约束），TimeBlock 需数据融合，Reminder 最后 |

### 12.2 历史分析（为什么不选模型 A/B/C）

#### 模型 A（冷切换）：不选

- DSON 从第一天就接管，不存在"激活时间点 T"前后的双轨状态
- 一次性迁移是纯工具步骤，不是架构共存策略

#### 模型 B（热共存）：不选

- 双轨并行意味着权威归属必须额外定义（DSON 权威还是 Phase 2 权威？）
- 排障复杂度加倍，两套系统的边界条件需要持续维护
- 与"DSON 从第一天就是唯一路径"矛盾

#### 模型 C（分工分层）：不选

- Phase 2 作为 fallback 的触发条件（delta 序列断裂、无法处理的域）需要精确定义
- fallback 触发时仍然面临权威归属问题
- 这实际上是把 Phase 2 保留为永久依赖，而不是真正的迁移完成

### 12.3 迁移路径（非共存策略）

```
用户在设置页面点击「升级到新同步引擎」
  └── migration wizard 引导
        ├── 步骤1：迁移 EventLog（纯追加，最简单）
        ├── 步骤2：迁移 Proposal（含 Terminal approved/rejected）
        ├── 步骤3：迁移 TimeBlock（融合 active+completed 为 blocks 数组）
        └── 步骤4：迁移 Reminder（触发结果入 EventLog）
              └── DSON 从此成为唯一同步路径
                    └── Phase 2 reconciliation 代码废弃（可删除）
```

迁移是**一次性事件**，用户主动触发，migration wizard 引导，不是 RT 启动时自动运行。

### 12.4 迁移前提

以下条件满足后，才能执行快照迁移：

1. DSON store 支持 EventLog / Proposal / TimeBlock / Reminder 的 schema 声明
2. Storage Adapter 持久端（SQLite）能正确序列化 DSON state（含 blocks 数组统一结构）
3. 每个域的 `Nested`/`MergeAll`/`RecursiveOr`/`AtomicGroup` 字段声明完成
4. Validation Layer（Write Gate）在 DSON write 之前实现
5. 存在可运行的迁移验证流程（迁移前后 RT SQLite 与 DSON store 数据一致）

---

## 参考来源

- `docs/research/DSON深度研究报告-2026-04-13.md`
- `docs/architecture/DSON-greenfield-sync-architecture-analysis-2026-04-11.md`
- `docs/plans/PLAN-cross-device-incremental-sync.md`
- `docs/plans/2026-04-13-multi-domain-reconciliation-design.md`
- `docs/plans/2026-04-13-task-sync-reconciliation-solution-plan.md`
- `docs/specs/sync.md`
- GitHub Issue #906（搬迁性更新）
- GitHub Issue #910（EDS 架构成型性评估）
- GitHub Issue #868（断线重连后缺少恢复性同步）
- GitHub Issue #869（配对 RT 离线分叉后的对象级冲突处理契约）
- GitHub Issue #893（Reminder headless 问题）
