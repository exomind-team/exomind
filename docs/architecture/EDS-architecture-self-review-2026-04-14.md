# EDS 架构自洽性审阅报告

> 日期：2026-04-14
> 审阅目标：`docs/architecture/EDS-architecture-discussion-v1.md`（v2）
> 审阅人：架构审阅 Agent

---

## 一、审阅方法

本次审阅聚焦于文档内部逻辑自洽性，从以下四个维度检验：
1. **层间一致性**：各层职责边界是否清晰、有无越权或遗漏
2. **数据流一致性**：数据在层间的传递是否有缺失环节或矛盾描述
3. **Schema 与实现一致性**：Schema 声明字段/类型/策略是否与分层描述的数据结构对齐
4. **阻断性问题前置条件**：B1/B2/B3/B4 是否真正阻断 Phase 3，依赖关系是否清晰

---

## 二、严重程度评级说明

| 级别 | 含义 |
|------|------|
| **阻断性** | 不解决 Phase 3 无法正确启动或必然出错 |
| **重要** | 不解决会导致 Phase 3 产出错误结果或无法完整实现 |
| **次要** | 不影响功能正确性，但影响文档可维护性或开发体验 |

---

## 三、Schema 与 DSON 层字段对齐问题（Schema vs Implementation）

### 问题 S1：Task 域 Schema 字段与 DSON TaskDoc 严重不对齐

**严重程度：阻断性**

Schema（第 96-107 行）定义的 Task 域字段：

```
title       FieldType::String  Lww("updated_at")
status      FieldType::String  Terminal(...)
tags        FieldType::Array   MergeAll
assigned_to FieldType::String  UserRequired
updated_at  FieldType::Number  Lww("updated_at")
```

DSON TaskDoc（第 319-326 行）定义的结构：

```rust
struct TaskDoc {
    id: String,
    title: MvReg,
    description: MvReg,   // ← Schema 无此字段
    status: MvReg,
    tags: OrArray,
    metadata: OrMap,      // ← Schema 无此字段
}
```

**缺失字段**：`description`、`created_at`、`assigned_to` 在 Schema 中声明，但不在 DSON TaskDoc 中。`metadata: OrMap` 在 DSON TaskDoc 中存在，但 Schema 无对应字段声明。

**影响**：Schema 是"唯一入口"，但 DSON 层使用了 Schema 未声明的字段。这意味着要么 Schema 不完整，要么 DSON 层多接收了额外字段但没有声明冲突策略，两种情况都是阻断性问题。

### 问题 S2：Lww 策略引用自身字段的语义歧义

**严重程度：重要**

Schema 中 `updated_at` 字段声明为：

```
FieldDecl { name: "updated_at", ty: FieldType::Number, resolution: FieldResolution::Lww("updated_at") }
```

这表示"按 `updated_at` 字段自身的时间戳值做 LWW 排序"。但这个语义在 DSON 层无法实现：

- `updated_at` 是一个普通数值字段，不是 CRDT 元数据
- DSON 的 LWW CRDT 语义是"按 CRDT 元数据中的逻辑时间戳排序"，而非"按 JSON 字段值排序"
- DSON 层没有 `ProposalDoc`/`ReminderDoc`，但 Schema 中已声明这些域的 `updated_at`/`trigger_at` 等字段

**建议**：要么将 LWW 改为"CRDT 元数据时间戳"（这是 DSON LWW 的标准语义），要么在 Schema 层显式声明 `Lww("metadata.ts")` 之类的 DSON 原语级引用。

### 问题 S3：Schema-FieldType 到 DSON-CRDT-Type 的映射规则未文档化

**严重程度：重要**

文档第 69 行说 `field.ty` 决定 DSON 用 OrMap/MvReg/OrArray，但从未给出具体的类型映射表。读者无法从 Schema 声明推断出 DSON 层的类型。

建议在文档中明确添加：

| Schema FieldType | DSON CRDT 类型 | 说明 |
|-----------------|---------------|------|
| String          | MvReg         | 多值寄存器保留并发修改 |
| Number          | MvReg         | 同上 |
| Bool            | MvReg         | 同上 |
| Array           | OrArray       | 追加型数组，天然交换性 |
| Object          | OrMap         | 多值映射 |

### 问题 S4：`Reminder` 域 Schema 无对应 DSON Doc 结构

**严重程度：重要**

Schema（第 130-135 行）定义了 `reminder:` 前缀的 DocSchema，但文档"四、核心数据结构"（第 314-342 行）只定义了 `TaskDoc`、`EventLogDoc`、`ActiveTimeBlockDoc`，没有 `ReminderDoc`。同样缺失的还有 `ProposalDoc`（Schema 第 122-128 行有定义）。

Phase 3 声称"Schema 是唯一入口，全链路自动贯通"，但 DSON 层实际上没有为所有 Schema 声明的域都定义对应的 Doc 结构。

---

## 四、数据流一致性问题（Data Flow）

### 问题 D1：写入路径描述存在矛盾

**严重程度：重要**

Section 2.1 分层总览图（第 247-256 行）描述 local-only 路径时，Projection Layer 直接连接 DsonStorageAdapter，但**没有经过 DSON Store**：

```
Projection Layer → DsonStorageAdapter → SQLite
```

然而 Section 8.1 同步链 Step 6（第 784-786 行）描述的是：

```
DsonStorageAdapter.update_field("task:t1", "title", "完成季度报告")
→ SQLite json_set
```

这里 Projection Layer **之后 DsonStorageAdapter 操作的仍是 DSON JSON（含 MvReg 结构）**，而 local-only 路径直接对业务对象 JSON 操作。

两条路径对 DsonStorageAdapter 的调用语义完全不同：
- **local-only**：Projection 输出干净业务对象 JSON → DsonStorageAdapter 写入
- **sync 路径**：DSON JSON → DsonStorageAdapter → SQLite → DSON JSON → Projection → 干净对象

**根本问题**：local-only 路径的 Projection Layer 输出是否经过 DSON Store？图上说"不经过 DSON"，但实际 DsonStorageAdapter 的 `update_field` 需要知道 JSON 路径。如果 local 路径也写 DSON JSON，则 Schema 中声明的字段需要先转为 DSON 结构。

### 问题 D2：Sync 路径 Step 6 的 DSON Store 参与存疑

**严重程度：重要**

Step 6（第 783-786 行）描述：
> Projection Layer · DSON 状态 → 干净业务对象 · DsonStorageAdapter · update_field → SQLite

这暗示 Projection Layer 输出干净对象后，DsonStorageAdapter 用 `update_field` 写入 SQLite。但 Step 3（第 767-770 行）说 DSON Store 在设备 B 收到 delta 后**已经合并了 delta 并产出最终状态**。

问题在于：合并后的 DSON 状态（含有 MvReg 等结构）是如何变成"干净业务对象"的？Projection Layer 需要先反序列化 MvReg 才能得到干净 String。这个转换过程在数据流中没有明确描述。

### 问题 D3：Sync 路径 Step 7 与 Step 6 的 SQLite 写入重复

**严重程度：次要**

Step 6 已经写入了 SQLite（`update_field`），Step 7 再次写入了 SQLite（`RT SQLite → TaskStore → 前端 UI`）。但 Step 7 的写入源头是"UI 更新"，不是 DSON 层。这是一个从 Projection Layer 到 RT SQLite 的回写路径，与 Step 6 的 DsonStorageAdapter 写入路径关系未定义。

### 问题 D4：CausalContext 的产生与存储位置未定义

**严重程度：重要**

Delta 格式（第 378-396 行）包含 `causal_context` 数组。Section 8.1 Step 1 说"DSON Store 生成 delta 并更新本地 CausalContext"，但：
- CausalContext 存储在哪里？（SQLite `dson_deltas` 表？内存？独立表？）
- CausalContext 在 local-only 路径是否也需要维护？
- `dson_deltas` 表（第 651-658 行）只有 `doc_id/seq/delta/created_at`，没有存储 `causal_context`

如果 CausalContext 没有被持久化，则设备重启后无法重建 delta 历史，导致增量 backfill 不可靠。

### 问题 D5：SyncGate 接口方法与 Projection Layer 交互未定义

**严重程度：次要**

Section 5.3（第 463-478 行）定义了 `SyncGate`、`get_sync_status`、`project_to_domain`、`get_conflict_data` 三个接口方法，但：
- 实际数据流中没有说明这三个方法何时被调用
- `get_conflict_data` 返回 `ConflictData` 类型，但该类型从未定义
- `project_to_domain` 的输入是 DSON 状态的哪个版本？（合并前/合并后/裁决后？）

---

## 五、Trait 与实现一致性问题（Schema vs Implementation）

### 问题 T1：DsonStorageAdapter trait 与 SQLite 实现方法签名不一致

**严重程度：阻断性（代码示例层面）**

Trait 声明（第 499-503 行）：
```rust
fn update_field(&self, doc_id: &str, path: &str, value: serde_json::Value) -> Result<(), StorageError>;
fn apply_delta(&self, doc_id: &str, delta: &serde_json::Value) -> Result<(), StorageError>;
```

SQLite 实现（第 522-525 行）：
```rust
fn update_field(&self, doc_id: &str, path: &str, value: &serde_json::Value) -> Result<(), StorageError>
//                                                           ^^^^^^^^^^^^^^^^^^^^^^^^^ 少了 &
fn apply_delta(&self, doc_id: &str, delta: &serde_json::Value) -> Result<(), StorageError>
//                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^ 少了 &
```

Trait 使用值类型 `serde_json::Value`，实现使用引用 `&serde_json::Value`。在 Rust 中这是两个不同的签名。如果这是 trait 的实际代码，编译不过。如果是设计稿，则 trait 定义与实现不一致，读者无法确定真实接口。

同样的问题出现在 `append_delta`（trait: `&serde_json::Value`，实现: `&serde_json::Value` — 注意同样缺少 `&`）。

### 问题 T2：`read_snapshot`/`write_snapshot`/`delete_snapshot` 在 SQLite 实现中缺失

**严重程度：重要**

Trait（第 493-495 行）声明了三个快照级操作：
```rust
fn write_snapshot(&self, doc_id: &str, doc: &serde_json::Value) -> Result<(), StorageError>;
fn read_snapshot(&self, doc_id: &str) -> Result<Option<serde_json::Value>, StorageError>;
fn delete_snapshot(&self, doc_id: &str) -> Result<(), StorageError>;
```

但 SQLite 实现（Section 6.2，第 521-636 行）只实现了 `update_field`、`apply_delta`、`query`、`append_delta`，**完全没有实现任何快照方法**。

`dson_snapshots` 表已定义（第 644-648 行），说明快照存储是设计的一部分，但实现不完整。这导致：
- `write_snapshot` 无法初始化新文档
- `read_snapshot` 无法加载完整状态（reconciliation snapshot fallback 需要）
- `delete_snapshot` 无法删除文档

### 问题 T3：`read_deltas` 在 SQLite 实现中缺失

**严重程度：重要**

Trait（第 510 行）声明：
```rust
fn read_deltas(&self, doc_id: &str, from_seq: u64, to_seq: u64) -> Result<Vec<serde_json::Value>, StorageError>;
```

SQLite 实现完全没有实现此方法。但 `dson_deltas` 表已定义，且 Section 5.2 的增量 backfill 场景需要读取 delta 序列来重建状态。

### 问题 T4：`delete_snapshot` 的 SQLite 实现缺失

**严重程度：次要**

除了快照读/写方法缺失，`delete_snapshot` 也未实现。如果 DSON 层需要对文档做 tombstone-free 删除，这个方法必须实现。

---

## 六、层间职责一致性问题（Layer Consistency）

### 问题 L1：Validation Layer 的"schema 版本兼容"无具体机制

**严重程度：次要**

Section 2.2 职责矩阵（第 285-293 行）描述 Validation Layer 包含"schema 版本兼容"检查。但：
- 文档中没有任何地方定义 schema 版本字段在哪里（`doc.schema_version`？）
- 版本不兼容时的行为是什么？（拒绝写入？自动迁移？降级？）
- DSON 层如何处理字段增加/删除/类型变更？

Section 11 待明确问题中也没有这个问题，说明文档作者可能认为这不需要澄清，但实际上"schema 版本兼容"是一个具体功能，必须有明确的机制定义。

### 问题 L2：DSON Store 职责矩阵描述"对上层只暴露 has_conflict"，但 Projection Layer 需要完整业务对象

**严重程度：次要**

Section 2.2 职责矩阵说"DSON Store 不做业务投影"，Section 5.3 定义了 `project_to_domain` 方法，Section 8.1 Step 5 执行 Projection。这说明 DSON Store 实际上**包含**投影能力，但职责矩阵的文字描述暗示它"不做业务投影"。这是职责矩阵描述不精确，不是功能缺失。

### 问题 L3：Conflict Resolution Layer 接口不完整

**严重程度：重要**

Section 7.2（第 711-731 行）定义的 `ConflictResolver` trait：
```rust
pub trait ConflictResolver: Send + Sync {
    fn resolve(&self, field: &str, values: Vec<ConcurrentValue>) -> Resolution;
    fn resolve_all(&self, doc: &serde_json::Value) -> ResolutionResult;
}
```

但：
- `ConcurrentValue` 类型未定义
- `ResolutionResult` 类型未定义
- `ConflictData` 类型（第 476 行引用）未定义
- Section 11 将"Conflict object 持久化 schema"列为待明确问题，说明这些类型目前就是未定义状态

---

## 七、阻断性问题前置条件评估（Blocking Issues）

### B3：DSON rail 与 RT SQLite 的真值关系未定义

**是否真正阻断 Phase 3：是**

**理由**：Phase 3 的核心是让 DSON 成为同步轨道的底层。如果不先定义 DSON snapshots 是独立真相源还是 RT SQLite 的投影缓存，两条写入路径（本地业务写入 → RT SQLite；同步合并 → DSON snapshots）谁优先的问题就无法回答。这不是 Phase 3 可以"边做边想"的问题，因为它是整个 Phase 3 数据流设计的起点。

**评估**：B3 标注为阻断性，**论证充分**，结论合理。

### B4：语义原子裁决原则未定义

**是否真正阻断 Phase 3：是**

**理由**：Section 7.1 的三种裁决情况描述了按字段独立裁决。但字段间可能有语义依赖（如 `status=completed` 要求 `completed_at` 非空）。如果 CRL 按字段独立裁决，可能产出 `status=completed; completed_at=null` 的业务中间态，导致 Phase 3 的输出结果不可信。

**评估**：B4 标注为阻断性，**论证充分**，结论合理。

### B2：Phase 2/3 共存策略未定义

**是否真正阻断 Phase 3：部分成立，但论证不充分**

**理由（支持阻断性）**：Phase 2 reconciliation 使用 snapshot-based diff/repair，Phase 3 使用 DSON delta/merge。如果两者同时存在但策略不明确，可能出现：
- Phase 2 的 snapshot import 覆盖 Phase 3 的 DSON 状态
- Phase 3 的 delta merge 被 Phase 2 的 snapshot fallback 中断

**理由（削弱阻断性）**：文档没有说明为什么"共存策略"不能在 Phase 3 实施过程中同步定义。Phase 3 的实施计划（Section 10）列出了"定义 Phase 2 → Phase 3 切换条件和共存策略"作为 Phase 3 自身的任务项，说明 B2 被认为是 Phase 3 的一部分，而不是前置条件。

**评估**：B2 的阻断性**论证不充分**。建议降级为"Phase 3 实施的前置风险"而非"前置条件"，或者补充说明为什么"在 Phase 3 内部定义共存策略"会导致 Phase 3 无法完成。

### B1：Proposal 域 sync 归属未明确

**是否真正阻断 Phase 3：否**

**理由**：Phase 3 是 DSON 接入（Section 10），目标是让 Task/EventLog/TimeBlock 进入 DSON 轨道。Proposal 不在 Phase 1-3 的实施计划中（Section 10 Phase 2 列出了"Proposal Reconciliation Adapter"但没有列入 Phase 3）。B1 实际上是 Phase 2 的缺口，不是 Phase 3 的阻断条件。

**评估**：B1 不阻断 Phase 3。建议重新归类为"Phase 2 的阻断性问题"或"Phase 3 覆盖范围外的已知缺口"，避免与 Phase 3 的阻断性前置条件混淆。

---

## 八、补充问题

### 问题 X1：`doc_id` 字段在 Schema 和 DocStruct 中的角色不清晰

**严重程度：次要**

Schema `DocSchema` 定义 `doc_id_prefix: &'static str`（如 `"task:"`），但没有说明完整 `doc_id` 的格式。实际使用中 `doc_id` 是 `prefix + uuid`（如 `task:t1`）。

在 DSON TaskDoc/EventLogDoc/ActiveTimeBlockDoc 中，`id` 字段是 `String` 类型，不是 CRDT 类型。但 Schema 没有定义 `id` 字段的 `FieldDecl`（`DocSchema.fields` 只包含业务数据字段）。这意味着 `doc_id` 不走 Schema 字段声明，是独立的存在。

**建议**：在 Schema 结构说明中明确 `doc_id` 是文档标识，不属于 Schema 字段声明范围。

### 问题 X2：Section 11 待明确问题列表未覆盖所有发现的不一致

**严重程度：次要**

以下在审阅中发现的问题未列入 Section 11：
- Schema TaskDoc 字段不对齐（S1）
- DsonStorageAdapter trait/实现签名不一致（T1）
- `read_snapshot`/`write_snapshot`/`delete_snapshot` 未实现（T2）
- `read_deltas` 未实现（T3）
- Schema-FieldType 到 DSON-CRDT-Type 映射未文档化（S3）
- `ReminderDoc`/`ProposalDoc` 在 DSON 层缺失（S4）

---

## 九、审阅总结

### 关键发现统计

| 类别 | 阻断性 | 重要 | 次要 |
|------|--------|------|------|
| Schema vs DSON 层字段对齐 | 1 | 3 | 0 |
| 数据流一致性 | 0 | 3 | 2 |
| Trait vs 实现一致性 | 1 | 2 | 1 |
| 层间职责一致性 | 0 | 1 | 2 |
| 阻断性前置条件评估 | 0 | 1 | 1（降级）|
| 补充问题 | 0 | 0 | 2 |

### 最优先修复项（按阻断性排序）

1. **S1（阻断性）**：Schema TaskDoc 字段对齐问题。必须统一 Schema 声明与 DSON 层 DocStruct，确保字段一一对应，或明确哪些字段属于 DSON 层内部扩展。
2. **T1（阻断性）**：DsonStorageAdapter trait 与 SQLite 实现方法签名不一致。Rust 代码示例必须能编译，建议以 trait 签名为准（值类型 `serde_json::Value`），调整实现代码。
3. **B3（阻断性）**：DSON 与 RT SQLite 真值关系。这是 Phase 3 的设计基线，必须在 Phase 3 启动前回答。
4. **B4（阻断性）**：语义原子裁决原则。必须定义字段间语义依赖的裁决规则，避免业务中间态。
5. **T2（重要）**：`read_snapshot`/`write_snapshot`/`delete_snapshot` 在 SQLite 实现中缺失。必须补全或明确说明替代方案。
6. **S3（重要）**：Schema-FieldType 到 DSON-CRDT-Type 映射未文档化。读者无法从 Schema 推断 DSON 层类型，违反"Schema 是唯一入口"的设计承诺。
7. **B2（重要/论证不充分）**：Phase 2/3 共存策略的阻断性论证需补充，或重新定义为 Phase 3 内部任务。
8. **B1（非阻断性）**：建议从"阻断 Phase 3"降级为"Phase 2 的已知缺口"。

### 文档质量整体评价

该文档在架构概念阐述（核心原则、一条技术轨道、层职责矩阵）方面逻辑清晰、自洽性良好。但作为 Phase 3 的实施蓝图，在以下方面存在系统性的"设计稿到实现蓝图"的缺口：

- Schema 声明的完整性（Schema 声明了但 DSON 层没定义对应 DocStruct）
- 存储接口的完整性（trait 声明了方法但实现没写）
- 数据流的确定性（两条路径的边界和交汇点不够清晰）

建议在 Phase 3 实施前，先补充一份"Schema 完整性验证"检查，逐域确认 Schema 字段与 DSON DocStruct 的对应关系，并完成 Trait 方法的完整实现覆盖。
