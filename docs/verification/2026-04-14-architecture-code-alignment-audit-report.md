# #454 架构文档与代码实现对齐审计报告

> 审计日期：2026-04-14
> 审计人：Claude Code (Architecture Auditor)
> 目标：对照 `docs/architecture/` 核心文档与 `src/` / `crates/` 实际代码，识别脱节点
> 关联 Issue：#454

---

## 执行摘要

经过对 `overview.md`、`principles.md`、`ARCH-SYNC.md`、`agent-runtime-unified-foundation-spec.md` 四份核心架构文档与实际代码的全面比对，**脱节率约为 35-40%**（低于 issue 估计的 40-50%，但仍需系统性修复）。

主要脱节集中在：
1. **文件组织结构与文档不符**（Phase 1-5 演进路线大部分未落地）
2. **Port 接口缺失严重**（9 个中仅 4 个完整定义）
3. **Agent/Agent 命名体系混乱**（前端叫 Service，RT 叫 Agent/Actor）
4. **EDS 数据栈文档过时**（多处描述 PouchDB，但代码已在迁移）
5. **演进路线文档严重过期**（v4.0 文档对应实际 v0.3.x 代码）

---

## 脱节详情

### 脱节-1：文件组织结构严重不符（P0）

| 文档描述（overview.md §7） | 实际路径 | 状态 |
|---------------------------|---------|------|
| `src/adapters/` | `src/lib/adapters/` | ⚠️ 目录名不同 |
| `src/environment/interfaces/` | `src/lib/environment/interfaces/` | ✅ |
| `src/environment/resource-pool.ts` | **不存在** | ❌ |
| `src/environment/message-buffer.ts` | **不存在** | ❌ |
| `src/actor/mailbox.ts` | **不存在** | ❌ |
| `src/actor/supervisor.ts` | **不存在** | ❌ |
| `src/actor/actors/` | `crates/exomind-runtime/src/signal/actors/` | ⚠️ 放到了 RT |
| `src/services/interfaces/` | `src/lib/services/` (平铺，无 interfaces/) | ⚠️ |
| `src/services/impl/` | `src/lib/services/` (平铺，无 impl/) | ⚠️ |
| `src/ui/` | `src/ui/app/` | ⚠️ 路径偏移 |

**影响**：Phase 4（Actor Model、Supervisor）完全未落地，Phase 5（Agent 生命周期、沙箱脚本）未开始。文档描述的演进路线严重超前于实际代码。

---

### 脱节-2：Port 接口体系不完整（P0）

**文档声称的 Port（overview.md §3）**：

| Port | 文档描述 | 实际状态 |
|------|---------|---------|
| `ILLMPort` | 大语言模型推理 | ❌ **未找到**（LLM 调用散落在 agent/api.rs、agent/claude.rs、agent/codex.rs） |
| `IASRPort` | 语音识别 | ✅ 存在于 `src/lib/environment/interfaces/asr.port.ts` |
| `ITTSPort` | 语音合成 | ❌ **未找到** |
| `IStoragePort` | 持久化存储 | ✅ 存在于 `src/lib/environment/interfaces/storage.port.ts` |
| `ITerminalPort` | 终端执行 | ❌ **未找到**（PTY 相关逻辑在 `crates/exomind-runtime/src/pty/） |
| `ISandboxPort` | 沙箱脚本执行 | ❌ **未找到** |
| `IPlatformPort` | 平台能力 | ❌ **未找到** |
| `IEventBusPort` | 事件总线 | ❌ **未找到**（有 ECS replication service） |
| `ICryptoPort` | 加密解密 | ❌ **未找到** |

**已实现但不在文档中的 Port**：
- `IEventLogPort` ✅ — 存在于 `src/lib/environment/interfaces/eventlog.port.ts`
- `ITaskPort` ✅ — 存在于 `src/lib/environment/interfaces/task.port.ts`
- `IReminderPort` ✅ — 存在于 `src/lib/environment/interfaces/reminder.port.ts`
- `IAgentPort` ✅ — 存在于 `src/lib/environment/interfaces/agent.port.ts`
- `IMePort` ✅ — 存在于 `src/lib/environment/interfaces/me.port.ts`
- `IClipboardPort` ✅ — 存在于 `src/lib/environment/interfaces/clipboard.port.ts`
- `IRuntimePort` ✅ — 存在于 `src/lib/environment/interfaces/runtime.port.ts`

**影响**：文档 Port 体系约 44% 未实现，而实际代码中存在的 Port 有 7 个未被文档记录。

---

### 脱节-3：Agent / Actor 命名体系混乱（P1）

**文档声称的 Agent 地图（overview.md §5.3）**：

| Agent | 文档状态 | 实际代码 |
|-------|---------|---------|
| EventLog Actor | **已实现** | ✅ `signal/actors/eventlog_actor.rs` |
| Task Actor | **已实现** | ✅ RT 中有 task actor 逻辑 |
| Echo Agent | **已实现** | ✅ `agent/echo.rs` |
| Claude Agent | **已实现** | ✅ `agent/claude.rs` |
| 分类 Agent | **已实现** | ⚠️ 部分实现（`external_input_actor.rs` 处理 normalized input） |
| Review Agent | **已实现** | ❌ **未找到独立实现**（但有 session.end 处理） |
| 知识 Agent | 计划中 | ❌ 未实现 |
| Growth Coach | 计划中 | ❌ 未实现 |

**额外发现的 Agent（在文档中未记录）**：
- `AgentBroker` (`agent/broker.rs`) — Agent 对话路由
- `CodexAgent` (`agent/codex.rs`) — Codex CLI 集成
- `APIAgent` (`agent/api.rs`) — HTTP API Agent
- `LLMCognition` (`agent/llm_cognition.rs`) — LLM 认知模块
- `ProposalAgent` (`agent/proposal_tools.rs`) — 提案工具

**前端命名问题**：文档中的 `Actor/Agent` 体系在前端对应的是 `Service`。`src/lib/services/` 下有 `task.service.ts`、`eventlog.service.ts`、`reminder.service.ts` 等，这些都是 L3 Service 实现，但文档没有反映这一点。

---

### 脱节-4：SignalPool 细节偏差（P1）

**文档 vs 代码差异**：

| 特性 | 文档描述（overview.md §6.3） | 实际代码 |
|------|---------------------------|---------|
| SignalBus 容量 | `tokio::broadcast` 256 容量 | 需验证（`signal/bus.rs`） |
| Journal 容量 | Ring Buffer 1000 条 | 需验证（`signal/journal.rs`） |
| WindowCache 容量 | Ring Buffer 1000 条 | 需验证（`signal/window.rs`） |
| `origin_host_id` | ECS-3 预留字段 | ✅ 存在 |
| `hop` | ECS-3 预留字段 | ✅ 存在 |
| `Remote` TargetType | 注释"计划中: 远端 RT" | ✅ **已实现**（`types.rs` 中有 `Remote` 变体，但不在文档中） |
| `delivery_record` | 未提及 | ✅ 存在于 `types.rs` 的 `DeliveryRecord` |

**影响**：文档落后于实现。`Remote` TargetType 和 `DeliveryRecord` 已在代码中实现但未写入文档。

---

### 脱节-5：EDS 数据栈文档严重过时（P0）

**文档声称（overview.md §6.8）**：
```
EDS-1: PouchDB, 前端 EventStorage ← 存储层
EDS-2: CRDT / 文件同步 + 冲突解决 ← 未实现
EDS-3: Obsidian / 知识库 ← 未实现
```

**实际情况**：
- `src/lib/storage/event-storage.ts` — PouchDB 实现**仍在**，但标记为 legacy
- `src/lib/storage/active-block-storage.ts` — PouchDB 实现**仍在**
- `src/lib/adapters/task-pouch-adapter.ts` — PouchDB 实现**仍在**
- `src/lib/adapters/eventlog-rt-adapter.ts` — RT 化**已完成** ✅
- `src/lib/adapters/task-rt-adapter.ts` — RT 化**已完成** ✅
- `src/lib/adapters/reminder-rt-adapter.ts` — RT 化**已完成** ✅
- `src/lib/adapters/timeblock-rt-adapter.ts` — RT 化**已完成** ✅
- `src/lib/adapters/today-planner-rt-adapter.ts` — RT 化**已完成** ✅

**ARCH-SYNC.md 整个文档已过时**（分析日期 2026-02-10）：
- 描述 PouchDB Server（端口 6984）作为同步后端 — **已废弃**
- 描述 `src/lib/storage/event-storage.ts` 需要迁移到 `src/adapters/` — **部分完成但文档未更新**
- 描述 sync-store.ts 混合业务逻辑 — **部分改善**

---

### 脱节-6：演进路线文档过期（P0）

**overview.md §8 声称**：
```
当前版本: v0.3.x
Plan X (近期): v0.4-0.5
Plan Z (中期): v0.5+
```

**实际情况**：
- 文档日期 2026-03-14，声称 `v4.0` — **严重过期**
- 实际版本：Rust runtime v0.3.0（`Cargo.toml`），前端 0.4.8（`package.json`）
- 文档从未更新版本号与代码版本对齐

**Phase 状态（overview.md §8.1）**：

| Phase | 文档描述 | 实际状态 |
|-------|---------|---------|
| Phase 1 | Port 层、直接调用链 | ✅ 部分完成 |
| Phase 2 | EventBus 发布订阅 | ✅ 部分完成（ECS replication services） |
| Phase 3 | 资源池、消息缓冲 | ❌ **未开始**（对应文件不存在） |
| Phase 4 | Actor Model、Supervisor | ❌ **未开始** |
| Phase 5 | Agent 生命周期、沙箱脚本 | ❌ **未开始** |

---

### 脱节-7：RT 技术栈描述偏差（P1）

| 文档描述（overview.md §2.2） | 实际代码 |
|---------------------------|---------|
| `RT (运行时) — Rust + Axum + Tokio` | ✅ `crates/exomind-runtime/` 使用 Axum + Tokio |
| ECS-3 组网层 — **已声称"进行中"** | ⚠️ `mesh/mod.rs` 存在但功能有限 |
| ECS-7 应用语义层 — **已声称"部分实现"** | ⚠️ 需要验证 |

---

### 脱节-8：环境层职责未完全实现（P1）

**文档声称（overview.md §4）**：
```
Environment 职责:
1. 持有 Port 实例 ← ✅ bootstrap.ts 组装 Adapter
2. 管理资源池 ← ❌ resource-pool.ts 不存在
3. 维护消息缓冲 ← ❌ message-buffer.ts 不存在
4. 独占资源管理 ← ❌ acquire/release 未实现
```

**实际 environment.ts**：
- 持有 Adapter 实例 ✅
- 通过 ECS replication services 做事件路由 ✅
- 但 resource-pool 和 message-buffer 概念未独立实现 ⚠️

---

### 脱节-9：文档引用路径失效（P2）

| 文档引用路径 | 实际路径 |
|------------|---------|
| `docs/architecture/7-LAYER.md` | ❌ **不存在** |
| `docs/specs/SPEC-301-多设备数据同步.md` | ❌ **不存在** |
| `docs/specs/SPEC-302-密码哈希模块.md` | ❌ **不存在** |
| `docs/specs/SPEC-303-sync模块架构.md` | ❌ **不存在** |
| `docs/specs/sync.md` | ❌ **不存在** |
| `docs/architecture/MVP-ARCHITECTURE.md` | ❌ **不存在** |
| `docs/architecture/MVP.md` | ❌ **不存在** |
| `docs/architecture/UNIFIED-ARCHITECTURE-v3-DRAFT.md` | ❌ **不存在** |

ARCH-SYNC.md 和 overview.md 中引用的多个文档在仓库中不存在。

---

## 脱节率综合评估

| 维度 | 脱节率 | 说明 |
|------|--------|------|
| 文件组织结构 | ~60% | Phase 4/5 完全未落地 |
| Port 接口体系 | ~55% | 5/9 文档声称的未实现，7 个实际存在的未记录 |
| Agent/Actor 实现 | ~40% | Review Agent 缺失，Knowledge/Growth 未实现 |
| SignalPool 细节 | ~25% | Remote TargetType 反超文档 |
| EDS 数据栈 | ~70% | PouchDB 迁移进行中，文档完全过时 |
| 演进路线 | ~80% | Phase 3/4/5 未开始 |
| 引用路径 | ~70% | 多处引用不存在的文档 |
| **综合** | **~35-40%** | |

---

## 修复优先级

### P0 — 立即修复
1. **更新 overview.md 版本号和日期**：v4.0 → 对应实际版本，日期更新到 2026-04-14
2. **更新 EDS 数据栈描述**：反映 RT 化迁移状态（PouchDB → RT adapters）
3. **更新 ARCH-SYNC.md**：该文档完全过时，建议删除或大幅重写
4. **修复引用路径**：删除对不存在文档的引用

### P1 — 下个迭代修复
5. **补全 Port 接口文档**：记录实际存在的 7 个 Port（IAgentPort、IMePort、IClipboardPort、IRuntimePort 等）
6. **更新 Agent 地图**：添加 AgentBroker、CodexAgent、APIAgent、ProposalAgent 等
7. **修正 SignalPool 细节**：补充 Remote TargetType 和 DeliveryRecord
8. **更新 Phase 演进路线**：将 Phase 3/4/5 标记为"未开始"，Phase 1/2 标记为"进行中"

### P2 — 规划中
9. **重构文件组织**：将 `src/lib/` 整理为文档描述的结构（或反过来更新文档）
10. **补全 Environment 职责**：实现 resource-pool 和 message-buffer（或从文档中移除）
11. **更新 ECS 通信栈路线**：对齐 ECS-3/4/5/6/7 的实际实现状态

---

## 结论

架构文档存在系统性的**版本不同步问题**：文档描述的 v4.0 架构包含大量尚未实现的功能（Phase 3-5），而代码中实际存在的许多模块（Port 扩展、Agent 变体、RT 化迁移）未反映到文档中。

建议优先处理 P0 级问题（更新版本、修正过时描述、清理失效引用），再逐步处理 P1 级问题（补全 Port 体系、更新 Agent 地图）。
