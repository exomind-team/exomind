# EDS 架构蓝图 — Codex 工作交接稿

> 起草日期：2026-04-14
> 起草人：Claude Opus 4.6
> 交接对象：无上下文 Codex agent
> 目的：让 Codex agent 能独立承接 EDS 新架构的实现工作，无需人工补充上下文

---

## 一、本文档性质

**这是未来完整版 EDS 架构的蓝图文档，不是当前代码状态的描述。**

- 当前源码实现状态不影响本文档的架构决策
- 蓝图优先于现状
- 代码中存在的任何与蓝图不一致的地方，以蓝图为准

---

## 二、核心架构立场（必须遵守）

### 2.1 DSON 是唯一同步路径

**从第一天起，DSON 就是 ExoMind 同步系统的唯一 rail。**

- 不存在 Phase 2/3 共存
- Phase 2 reconciliation 是**历史遗留迁移工具**，仅用于一次性快照迁移
- 迁移完成后 Phase 2 代码废弃，不再运行
- 任何双轨共存的方案（模型 A/B/C）已被废弃

### 2.2 Storage Adapter 的两端语义

```
┌─────────────────────────────────────┐
│         Storage Adapter               │
│  面向「持久化端」 ← 真相源在这里     │  ← 唯一真相源
│  面向「操作端」   ← 可同步/可合并   │
└─────────────────────────────────────┘
```

- **真相源永不落在 DSON 合并处**（Rust 内存中的合并操作不是存储位置）
- DSON snapshots 是投影缓存，不是真相源
- RT SQLite 是另一层投影缓存

### 2.3 三层职责严格分离

| 层次 | 职责 | 谁来做 |
|------|------|--------|
| Schema 声明层 | "什么字段用什么冲突策略" | Domain expert + architect |
| DSON 层 | 按 Schema 策略递归执行合并 | helsing-ai/dson crate |
| Storage Adapter 层 | 原子写入持久层 | Rust 实现 |

### 2.4 CRL 只处理叶子节点冲突

- CRL 的职责范围：**叶子节点并发值**的裁决（LWW、Terminal 等）
- `AtomicGroup`（跨字段原子协调，如 `status + completed_at`）在 **CRL 层内部实现**
- 不是"Schema 预处理后传给 CRL"，而是"CRL 收到两个叶子节点，检测到属于同一 AtomicGroup，作为一组裁决"

### 2.5 命名

使用 **DSON**（Delta-State Object Notation），不要用 CDS。

---

## 三、四大业务域的 Schema 决策

### 3.1 Task

```rust
DocSchema {
    doc_id_prefix: "task:",
    fields: vec![
        // MergeAll：大原子，tags 整体不可拆分
        FieldDecl { name: "tags", ty: FieldType::Array, resolution: FieldResolution::MergeAll },
        // RecursiveOr：动态结构，未知字段自动合并
        FieldDecl { name: "metadata", ty: FieldType::Object, resolution: FieldResolution::RecursiveOr },
        // AtomicGroup：跨字段原子约束
        FieldDecl { name: "status", resolution: FieldResolution::Terminal(["completed", "cancelled"]) + AtomicGroup(["status", "completed_at"]) },
    ],
}
```

**关键**：CRL 收到 `status` 和 `completed_at` 的并发值时，必须作为一组同时裁决：
- `status=completed + completed_at=非空` → ✅ 采纳
- `status=cancelled + completed_at=非空` → ✅ 采纳
- `status=completed + completed_at=null` → ❌ 非法 → 裁决为 cancelled
- 两端都是 `status=completed + completed_at=非空` → LWW

### 3.2 EventLog

```rust
DocSchema {
    doc_id_prefix: "eventlog:",
    fields: vec![
        FieldDecl { name: "events", resolution: FieldResolution::Nested(vec![
            NestedField { path: vec!["type"],        resolution: FieldResolution::MergeAll },
            NestedField { path: vec!["timestamp"],   resolution: FieldResolution::Lww("timestamp") },
            NestedField { path: vec!["content"],     resolution: FieldResolution::RecursiveOr },
        ])},
    ],
}
```

**关键**：EventLog 纯追加，不需要 Reconciliation Adapter。一次性迁移后完全废弃 Phase 2 的 EventLog reconciliation 代码。

### 3.3 TimeBlock（数据融合）

**已废弃的旧设计**：active 和 completed 是两个独立的数据结构。

**新设计（v4）**：统一为单一 `blocks` 数组，active = "最新开放时间块"。

```rust
DocSchema {
    doc_id_prefix: "timeblock:",
    fields: vec![
        // blocks 数组：end_time = null 的 entry 就是 active block
        FieldDecl { name: "blocks", ty: FieldType::Array, resolution: FieldResolution::Nested(vec![
            NestedField { path: vec!["block_type"],   resolution: FieldResolution::MergeAll },
            NestedField { path: vec!["start_time"],   resolution: FieldResolution::Lww("updated_at") },
            NestedField { path: vec!["end_time"],     resolution: FieldResolution::Lww("updated_at") },
            NestedField { path: vec!["description"],  resolution: FieldResolution::RecursiveOr },
            NestedField { path: vec!["tags"],         resolution: FieldResolution::MergeAll },
        ])},
    ],
}
```

**关键**：`end_time = null` 的 block = 当前活跃时间块；迁移时需将现有的 active block 和 completed blocks 融合为统一 blocks 数组。

### 3.4 Proposal

```rust
DocSchema {
    doc_id_prefix: "proposal:",
    fields: vec![
        // Terminal 只包含真正的终态，draft 是中间态，不出现
        FieldDecl { name: "status",       resolution: FieldResolution::Terminal(["approved", "rejected"]) },
        FieldDecl { name: "action_params", ty: FieldType::Object, resolution: FieldResolution::MergeAll },
        FieldDecl { name: "comments",      ty: FieldType::Array,  resolution: FieldResolution::RecursiveOr },
    ],
}
```

**关键**：`draft` 不在 Terminal 声明中——它是中间态，不是终态。终态只可能是 `approved` 或 `rejected`。

### 3.5 Reminder

**Reminder 不迁移存储架构。**

- 当前 Reminder 存储（Pouch 残留 + 前端 scheduler 依赖）不成熟，不能作为新 EDS 参考
- Reminder 触发结果直接落入 EventLog（作为一条 event）
- DSON schema 仅用于历史数据一次性迁移入口，不作为独立域存储模型

```rust
DocSchema {
    doc_id_prefix: "reminder:",
    fields: vec![
        // minimal schema：仅作迁移入口，不定义复杂冲突策略
        FieldDecl { name: "trigger_at",   resolution: FieldResolution::Lww("trigger_at") },
        FieldDecl { name: "triggered_at", resolution: FieldResolution::Lww("triggered_at") },
        FieldDecl { name: "repeat",       ty: FieldType::Object, resolution: FieldResolution::RecursiveOr },
    ],
}
```

---

## 四、关键 Schema 模式

| 模式 | 用途 | 何时用 |
|------|------|--------|
| `Lww("timestamp")` | 最后写入胜出 | 简单标量字段（title, description） |
| `Terminal([...])` | 终态限制 | status 等只有固定枚举值的字段 |
| `MergeAll` | 大原子 | tags、metadata 等不可拆分的整体 |
| `RecursiveOr` | 动态递归 | 未知字段名的结构（custom_fields、repeat） |
| `Nested([...])` | 路径级声明 | 数组内元素各字段的独立策略 |
| `AtomicGroup([...])` | 字段组原子约束 | status + completed_at 等跨字段语义约束 |

---

## 五、完整同步链路

```
用户编辑 → Domain Service → Validation Layer → DSON Store
                                              ↓
                                    Storage Adapter（持久端）
                                              ↓
 ECS Client（delta + causal_context）→ ECS Server
                                              ↓
                                    DSON Store（接收端）
                                              ↓
                                    Conflict Resolution Layer
                                     (leaf-only + AtomicGroup)
                                              ↓
                                    Projection Layer
                                     (per-domain projector)
                                              ↓
                                    ConflictObject 表（冲突持久化）
                                    Storage Adapter（持久端）
                                              ↓
                                         UI 更新
```

### Validation Layer（Write Gate）

- **位置**：Domain Service 和 DSON Store 之间
- **职责**：字段存在性、类型检查、值域约束（如 status 必须在 Terminal 范围内）
- **特点**：跨域统一，所有域共用同一套验证规则
- **失败时**：拒绝写入，返回错误，不进入 DSON Store

---

## 六、CRL 接口（叶子节点 + AtomicGroup）

```rust
pub enum Resolution {
    // 自动裁决（简单叶子节点）
    Auto(serde_json::Value),
    // 原子裁决（AtomicGroup 跨字段协调）
    AtomicGroup(Vec<(&'static str, serde_json::Value)>),
    // 需要用户介入
    UserRequired { field: String, options: Vec<serde_json::Value> },
    // 升级人工
    Escalate { reason: String, doc_id: String },
}
```

CRL 裁决后，对于 `UserRequired` 和 `Escalate` 情况，立即写入 ConflictObject 表。

---

## 七、ConflictObject 表

```sql
CREATE TABLE conflict_objects (
    id            TEXT PRIMARY KEY,
    doc_id        TEXT NOT NULL,           -- "task:t1"
    field         TEXT NOT NULL,           -- 冲突字段
    winning_value TEXT NOT NULL,          -- 胜出的值
    losing_values TEXT NOT NULL,           -- 落败的并发值（JSON array）
    resolution    TEXT NOT NULL,          -- lww/terminal/atomic_group/user_choice
    reason        TEXT,
    doc_version   INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    resolved_at   INTEGER,               -- null = 未解决
    resolved_by   TEXT,                   -- user/system
    resolved_value TEXT,
);

CREATE INDEX idx_conflicts_unresolved ON conflict_objects(doc_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_conflicts_doc ON conflict_objects(doc_id, created_at);
```

---

## 八、迁移设计

### 触发方式

用户主动触发 migration wizard（在设置页面），**不是** RT 启动时自动运行。

### 迁移顺序

```
EventLog（最简单，纯追加）
  → Proposal（有终态约束，需 AtomicGroup）
    → TimeBlock（需数据融合：active+completed → blocks）
      → Reminder（触发结果入 EventLog，minimal schema）
```

### 迁移前提（必须全部满足才能开始迁移）

1. DSON store 支持 EventLog / Proposal / TimeBlock / Reminder 的 schema 声明
2. Storage Adapter 持久端（SQLite）能正确序列化 DSON state（含 blocks 数组统一结构）
3. 每个域的 `Nested`/`MergeAll`/`RecursiveOr`/`AtomicGroup` 字段声明完成
4. Validation Layer（Write Gate）在 DSON write 之前实现
5. 存在可运行的迁移验证流程（迁移前后 RT SQLite 与 DSON store 数据一致）

---

## 九、实施路线

### Phase 1 ✅（已有基础）

Task 域核心路径：Live signal + Reconciliation + PeerScopeGrant

### Phase 2 📋（历史遗留迁移，一次性）

- 实现 DSON store + Storage Adapter 持久层
- 实现 EventLog / Proposal / TimeBlock / Reminder 的 DSON Schema 声明
- 实现 Validation Layer（跨域统一 Write Gate，在 DSON write 之前）
- 实现 migration wizard（用户主动触发）
- 按顺序迁移四个域
- 补 peer-auth 路由（`/mesh/eventlog/*`, `/mesh/timeblocks/*`）
- Reminder RT backend 改造（脱离前端 scheduler）

迁移完成后 Phase 2 reconciliation 代码**废弃**。

### Phase 3 🎯（DSON 完整实现，greenfield）

- 接入 helsing-ai/dson
- 实现 DsonStorageAdapter
- 抽象 Projection Layer（每个域有自己的 projector）
- 完善 CRL（含 AtomicGroup + ConflictObject 持久化）

---

## 十、已解决的核心问题（B3/B4/B2/Reminder）

| 问题 | 旧描述 | 新解决方案 |
|------|--------|--------|
| B3（真相源） | DSON snapshots vs RT SQLite 谁是真相源？ | Storage Adapter 持久端是唯一真相源，两者都是投影缓存 |
| B4（原子裁决） | status=completed 但 completed_at=null 的非法态？ | AtomicGroup + CRL 层协调 |
| B2（共存策略） | Phase 2/3 如何共存？ | 不共存，DSON 从第一天就是唯一路径 |
| Reminder 归属 | Reminder sync 走哪个 Phase？ | 只迁移功能，触发结果入 EventLog，存储架构不迁移 |

---

## 十一、剩余开放问题（需要专门 issue 跟踪）

1. **ECS 网络层长期选型**：iroh / libp2p / 定制协议（短期用 iroh 做暂时实现）
2. **ConflictObject 表完整实现细节**：依赖 #869（配对 RT 离线分叉后的对象级冲突处理契约）
3. **DSON 最小接口 Rust trait 设计**：需要进一步定义

---

## 十二、关键文件位置

| 文件 | 说明 |
|------|------|
| `docs/architecture/EDS-architecture-discussion-v1.md` | 架构蓝图主文档（v4 最新） |
| `docs/architecture/EDS-architecture-self-review-2026-04-14.md` | 自洽性审阅报告 |
| `docs/plans/2026-04-13-multi-domain-reconciliation-design.md` | 统一 Reconciliation 框架 |
| `docs/plans/2026-04-13-task-sync-reconciliation-settled-decisions.md` | Task sync  settled decisions |
| `docs/research/DSON深度研究报告-2026-04-13.md` | DSON 调研 |
| `docs/research/EDS架构成型性评估报告-2026-04-14.md` | EDS 架构成型性评估 |

---

## 十三、给 Codex 的特别提示

1. **本文档是蓝图，不是现状。** 不要被当前代码实现束缚。代码应向蓝图对齐，而不是蓝图向代码妥协。

2. **Schema 声明是唯一入口。** 声明一次，全链路贯通（Domain → DSON → CRL → Storage）。不要在链路中途硬编码字段逻辑。

3. **不要引入 Phase 2/3 双轨共存设计。** 任何新实现都直接基于 DSON。Phase 2 只作为一次性迁移工具使用一次。

4. **TimeBlock 不要沿用旧的 active/completed 分离设计。** 必须融合为单一 blocks 数组。旧实现中的 active block 表和 completed block 表是迁移前的遗留状态，不是目标状态。

5. **Reminder 的存储不是参考。** 当前 Reminder 的 Pouch 依赖和前端 scheduler 依赖是迁移前要清理的包袱，不是新架构要继承的特性。

6. **遇到"当前代码怎么做的"问题时**，先判断该代码是否属于 Phase 1 已成型部分（Task/ECS/鉴权）。如果是，直接参考。如果属于 Phase 2/3 范围，以本文档蓝图为准。
