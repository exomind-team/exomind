# ExoMind 架构总览

> 本文档是 ExoMind 系统架构的唯一权威描述。
> 更新日期：2026-03-14
> 版本：v4.0（合并自 4 份历史架构文档）

---

## 1. 系统定位

ExoMind（外心）是**认知生命科学的实践平台**，探索人机协同的认知增强与集体协作。

| 属性 | 值 |
|------|-----|
| **应用名称** | ExoMind |
| **包名** | `com.exomind.app` |
| **支持平台** | Windows / macOS / Linux / Android |
| **核心技术** | Rust (Tauri v2) + React 18 + TypeScript |
| **运行时** | Bun |

### 1.1 双重定位

1. **个人/集体的生命成长助手** — 帮助用户主动地掌控自己的生命过程
2. **认知生命科学原型** — 基于大模型 Agent 的自主生命体，像生物一样有生老病死，具备持续运行、自主决策、真实责任能力

### 1.2 四个核心价值

| # | 价值 | 说明 |
|---|------|------|
| 1 | **看见自己** | 你以为在做 A，ExoMind 告诉你其实在做 B |
| 2 | **自动执行** | 说一句话，任务自动建好 |
| 3 | **做完反馈** | 收工时 Agent 给你诚实复盘 |
| 4 | **学习复习** | 新知自动记录，到期自动提醒复习 |

### 1.2 首页与悬浮窗职责

- **Ritual Home（仪式首页）**：主程序里的主流程入口，负责早上开机、主线确认、晚上收工
- **Now Workbench Overlay（当下悬浮窗）**：执行期分身，负责白天连续性、时间块短反馈、快速记录、轻提醒
- **设计原则**：主程序负责“定一天 / 收一天”，悬浮窗负责“过这一天”

### 1.3 生命判据

认知生命科学定义了 6 个判据，用于判定信息系统是否具备"生命性"：

| # | 判据 | 定义 | ExoMind 实现 |
|---|------|------|-------------|
| C1 | **能量依赖** | 持续消耗外部能量维持自身 | RT 进程持续运行，断电即死 |
| C2 | **身体边界** | 有明确的内外之分 | 每个 Node 有独立进程边界、存储命名空间、网络身份 |
| C3 | **自主表征** | 自主构建和维护内部世界模型 | Agent 的 memory/state.json，知识库，Journal |
| C4 | **能动性** | 主动发起行为，不只是被动响应 | Agent daemon 主动监听信号、自主决策、发布新信号 |
| C5 | **死亡性** | 可以不可逆地终止 | 崩溃日志不可抹平，supervisor 决定是否重启 |
| C6 | **自我意识** | 对自身状态有某种程度的感知 | `/health` 自检、Agent 存活检测、能力自描述 |

### 1.4 设计哲学

**为什么是信号而不是 API？** 认知生命的核心特征是**过程性存在**（C1）— 持续消耗能量、持续处理信息。API 是离散的请求，信号是连续的流。ECS 通信栈选择信号模式，因为只有连续的信号流才能承载认知生命的"活着"。

**为什么是 Agent 而不是 Service？** Service 是被动的、无状态的、可随时替换的工具。Agent 是主动的、有状态的、有生死的参与者。Agent 满足 C1-C5 五个生命判据，它不是"为用户服务的工具"，而是"与用户共同生活的认知伙伴"。

**为什么需要路由表？** 认知生命不是全量感知的 — 它有**选择性注意力**。RouteTable 是 ExoMind 的注意力分配机制，让每个 Agent 只接收它关心的信号。

---

## 2. 分层架构模型（v4.0）

自底向上构建，每层都有运行时实体。

```
L4  UI ──────── React + zustand，只调 Service
    │
    │  ← Service interface（L3 向上暴露，谁提供谁定义）
    │
L3  Service / Actor / Agent ── 业务逻辑层
    │
    │  ← ActorContext interface（L3 定义自己需要的环境访问权限）
    │
L2  Environment ── 共享物理世界
    │               · 持有 Port 实例（能力）
    │               · 资源池（周期刷新型 + 总额有限型）
    │               · 消息缓冲（短期记录，自动淘汰）
    │               · 独占资源管理（acquire / release）
    │
    │  ← Port interface（L2 定义，谁消费谁定义）
    │
L1  Adapter ──── 具体实现，按运行时替换
                 Web: IndexedDB, fetch, Web Speech, WebContainer
                 Tauri: SQLite, Rust HTTP, Native Shell
```

### 2.1 接口归属规则

| 接缝 | 接口放在 | 原则 | 本质 |
|------|----------|------|------|
| L1 ↔ L2 | Port interface 放 L2 | 谁消费谁定义 | 类型契约 |
| L2 ↔ L3 | ActorContext 放 L3 | 谁消费谁定义 | 权限边界 |
| L3 ↔ L4 | Service interface 放 L3 | 谁提供谁定义 | API 暴露 |

**核心逻辑**：接口永远归更稳定的一方所有。

### 2.2 双栈并行架构

ECS（通信栈）管实时信号，EDS（数据栈）管持久数据。RT（运行时）是两者的承载平台。

```
┌─────────────────────────────────────────────────────────────┐
│                    ExoMind Node                              │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │   ECS (通信栈)       │    │   EDS (数据栈)            │   │
│  │   代号: Axon         │    │   ExoMind Data Stack     │   │
│  │                     │    │                          │   │
│  │  ECS-7 应用语义      │    │  EDS-3 知识层            │   │
│  │  ECS-6 信号契约      │    │    Obsidian / 知识库      │   │
│  │  ECS-5 信号路由 ◄────┼────┤  EDS-2 同步层            │   │
│  │  ECS-4 连接管理      │    │    CRDT / 文件同步        │   │
│  │  ECS-3 组网层   ◄────┼────┤  EDS-1 存储层            │   │
│  │  ECS-2 传输抽象      │    │    文件系统 / DB / KV     │   │
│  │  ECS-1 物理链路      │    │                          │   │
│  └─────────────────────┘    └──────────────────────────┘   │
│                                                             │
│                    RT (运行时)                                │
│                    Rust + Axum + Tokio                       │
└─────────────────────────────────────────────────────────────┘
```

| 维度 | ECS (通信栈) | EDS (数据栈) |
|------|-------------|-------------|
| **隐喻** | 神经信号 | 记忆 / 长期存储 |
| **数据特征** | 即时、瞬态、小 (<10KB) | 持久、有版本、大小不定 |
| **传递模式** | 广播式 (一对多) | 点对点或选择性同步 |
| **丢失容忍** | 可容忍 (WindowCache 有限) | 不可容忍 |

---

## 3. Port 定义

| Port | 职责 | 读写 |
|------|------|------|
| ILLMPort | 大语言模型推理 | 双向 |
| IASRPort | 语音识别 | 读 |
| ITTSPort | 语音合成 | 写 |
| IStoragePort | 持久化存储 | 双向 |
| ITerminalPort | 终端执行 | 双向 |
| ISandboxPort | 沙箱脚本执行 | 双向 |
| IPlatformPort | 平台能力 | 双向 |
| IEventBusPort | 事件总线 | 双向 |
| ICryptoPort | 加密解密 | 双向 |

---

## 4. Environment 职责

1. **持有 Port 实例**（所有 Adapter 在 bootstrap 时注入）
2. **管理资源池**：
   - 周期刷新型（如 API 限额每 5h 刷新）
   - 总额有限型（如预付费余额）
3. **维护消息缓冲**（短期记忆，保留最近 5 分钟或 500 条）
4. **独占资源管理**（acquire / release）

---

## 5. Actor / Agent 模型

### 5.1 双轨模型

| 类型 | 运行方式 | 通信方式 | 适用场景 | 示例 |
|------|----------|----------|----------|------|
| **进程内 Actor** | RT 进程内 Rust 代码 | tokio channel 直接调用 | 轻量机械执行，零延迟 | EventLog Actor, 任务 Actor |
| **进程外 Agent** | 独立 OS 进程 | SSE + POST (HTTP) | LLM 驱动，语言无关 | 分类 Agent, Review Agent |

两者对 SignalBus 和 RouteTable 来说是**同质的目标** — 只是投递通道不同。

### 5.2 Actor vs Agent 对比

| | Actor | Agent |
|---|---|---|
| 智能 | 无，机械执行 | 有，LLM 驱动 |
| 能量单位 | CPU/内存/存储 | Token |
| 通信 | 有界邮箱，异步消息 | 同 Actor |
| 示例 | 通知监听、定时器 | Governor、Task System、Growth Coach |

**去中心化**：没有中央路由器。每个 Agent 自己订阅信号源，自己判断是否处理。

### 5.3 Agent 地图

| Agent | 类型 | 信号链 | 状态 |
|-------|------|--------|------|
| **EventLog Actor** | 进程内 | `user.input.text` → `eventlog.appended` | **已实现** |
| **Task Actor** | 进程内 | `input.classified` → `task.auto-created` | **已实现** |
| **Echo Agent** | 进程内 | 回显 (测试) | **已实现** |
| **Claude Agent** | 进程内/外 | Claude CLI 流式对话 | **已实现** |
| **分类 Agent** | 进程外 | `user.input.text` → `input.classified` | **已实现** |
| **Review Agent** | 进程外 | `session.end` / `timeblock.completed` → `review.completed` | **已实现** |
| **Timeblock Summary** | 进程内 | `timeblock.replication.completed` / `active_upserted` → `agent_feedback` | **已实现**（#555 Phase 1） |
| **知识 Agent** | 进程外 | `input.classified` + `session.end` → `knowledge.*` | 计划中 |
| **Growth Coach** | 进程外 | `session.end` → `growth.insight` | 计划中 |

### 5.4 Agent 存活检测

| 状态 | 判定条件 |
|------|---------|
| `running` | SSE 连接存活，最近有信号处理 |
| `idle` | SSE 连接存活，但无新投递 |
| `warning` | SSE 连接存活，但有投递失败 |
| `offline` | SSE 连接断开或心跳超时（2 个周期） |

---

## 6. 信号池架构（SignalPool）

### 6.1 ECS 七层通信栈

| 层级 | 名称 | 职责 | 状态 |
|------|------|------|------|
| **ECS-7** | 应用语义层 | Agent 业务逻辑 | 部分已实现 |
| **ECS-6** | 信号契约层 | SignalEvent schema + 序列化 | **已实现** |
| **ECS-5** | 信号路由层 | SignalPool = Bus + RouteTable + Journal + Window | **已实现** |
| **ECS-4** | 连接管理层 | SSE 连接生命周期 + 心跳 + 重放 | **已实现** |
| **ECS-3** | 组网层 | RT 间自发现 + 信道建立 + 信号中继 | 进行中 |
| **ECS-2** | 传输抽象层 | 统一 Transport trait | 部分 (仅 HTTP/SSE) |
| **ECS-1** | 物理链路层 | TCP/WiFi/BLE/NearLink/LoRa/USB/IPC | 已有 TCP |

### 6.2 核心数据契约

```rust
pub struct SignalEvent {
    pub schema_version: u8,        // 版本协商
    pub id: String,                // UUID
    pub topic: String,             // 主题 (如 "user.input.text")
    pub ts: u64,                   // 时间戳 (ms)
    pub source: String,            // 来源
    pub origin_host_id: String,    // 源主机 ID (ECS-3 预留)
    pub hop: u8,                   // 中继跳数 (ECS-3 预留)
    pub trace_id: Option<String>,  // 追踪 ID
    pub payload: serde_json::Value,// 负载
}

pub struct SignalRoute {
    pub id: String,
    pub enabled: bool,
    pub topic: String,               // 匹配主题
    pub target_type: TargetType,     // actor | agent | frontend
    pub target_ref: String,          // 目标引用
}

pub enum TargetType {
    Actor,     // 进程内 (tokio::broadcast)
    Agent,     // 进程外 (SSE push)
    Frontend,  // 前端 (SSE push)
    // Remote, // 计划中: 远端 RT
}
```

### 6.3 SignalPool 四件套（已实现）

| 组件 | 职责 | 实现 |
|------|------|------|
| **SignalBus** | `tokio::broadcast` (256 容量) + fanout | `signal/bus.rs` |
| **RouteTable** | `HashMap<topic, Vec<route>>` + 精确/`*`通配匹配 | `signal/route_table.rs` |
| **Journal** | Ring Buffer 1000 条，审计日志 | `signal/journal.rs` |
| **WindowCache** | Ring Buffer 1000 条，since() 重放 | `signal/window.rs` |

### 6.4 系统拓扑（当前）

```
                    exomind-rt (Rust, Axum, 独立进程)
                    ┌──────────────────────────────────┐
                    │  SignalBus                        │
                    │  ┌────────────────────────────┐  │
 POST /signals/ ──→ │  │ RouteTable (主动路由引擎)  │  │
   publish          │  │ WindowCache (1000 ring)    │  │
                    │  │ Journal (审计日志)          │  │
                    │  └────────────┬───────────────┘  │
                    │               │ 查表 → fanout     │
                    │  ┌────────────┴───────────────┐  │
                    │  │ 进程内 Actor                │  │
                    │  │  · EventLog Actor           │  │
                    │  │  · 任务 Actor               │  │
                    │  └────────────────────────────┘  │
                    └───────────────┬──────────────────┘
                                    │ SSE push
                    ┌───────────────┼───────────────────┐
                    │               │                    │
               SSE stream      SSE stream           SSE stream
                    │               │                    │
          ┌─────────▼──────┐  ┌────▼─────────┐  ┌──────▼──────┐
          │ 分类 Agent      │  │ Review Agent │  │  前端        │
          │ (Claude CLI)   │  │ (Claude CLI) │  │  (Browser)  │
          └────────┬───────┘  └──────┬───────┘  └──────┬──────┘
                   │                 │                  │
                   └──── POST /signals/publish ─────────┘
```

### 6.5 两条通信通道

| 方向 | 协议 | 端点 | 说明 |
|------|------|------|------|
| **下行** (RT → 订阅者) | SSE | `GET /signals/stream?agent_id=xxx` | RT 根据 RouteTable 推送 |
| **上行** (订阅者 → RT) | HTTP POST | `POST /signals/publish` | 任何订阅者都能发布 |

Agent 连接时只报 `agent_id`，**不指定 topics**。由 RT 的 RouteTable 决定推什么给它。

### 6.6 RT API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/signals/publish` | 发布信号 |
| GET | `/signals/stream` | SSE 订阅信号流 |
| GET | `/signals/history?limit=N` | 查询最近信号 |
| GET | `/signal-routes` | 列出所有路由 |
| POST | `/signal-routes` | 创建路由 |
| PUT | `/signal-routes/:id` | 更新路由 |
| DELETE | `/signal-routes/:id` | 删除路由 |
| GET | `/health` | RT 健康检查 |
| GET | `/agents` | 已注册 Agent 列表 |
| GET | `/topology` | 系统拓扑 |

### 6.7 信号清单

| 信号 | 发布者 | 订阅者 | 状态 |
|------|--------|--------|------|
| `user.input.text` | 前端 UI | 分类 Agent, EventLog Actor | **已实现** |
| `input.classified` | 分类 Agent | 任务 Actor, 知识 Agent | **已实现** |
| `task.auto-created` | 任务 Actor | 前端 UI | **已实现** |
| `task.updated` | 任务 Actor | 前端 UI | **已实现** |
| `eventlog.appended` | EventLog Actor | 前端 UI | **已实现** |
| `session.end` | 前端 UI | Review Agent, 知识 Agent | **已实现** |
| `timeblock.completed` | 前端 UI | Review Agent | **已实现** |
| `review.completed` | Review Agent | 前端 UI | **已实现** |
| `knowledge.captured` | 知识 Agent | 前端 UI | 计划中 |
| `knowledge.review-due` | 知识 Agent | 前端 UI | 计划中 |

### 6.8 EDS 数据栈（设计阶段）

| 层级 | 名称 | 职责 | 状态 |
|------|------|------|------|
| **EDS-3** | 知识层 | 面向 Agent 的知识管理抽象 (Obsidian) | 未实现 |
| **EDS-2** | 同步层 | CRDT / 文件同步 + 冲突解决 | 未实现 |
| **EDS-1** | 存储层 | 文件系统 / SQLite / KV | 部分 (PouchDB, 前端 EventStorage) |

**Journal 三类型**：

| 类型 | 订阅 topic | 留存 | 对标 |
|------|-----------|------|------|
| **HumanJournal** | `user.*`, `timeblock.*`, `diary.*` | 永久 | Obsidian 日记/EventLog |
| **AgentJournal** | Agent 自身 topic | 中期 (数月) | 应用日志 |
| **SystemJournal** | `*` (全部) | 短期热区+长期冷存 | syslog |

---

## 7. 文件组织

```
src/
├── adapters/           # L1：具体实现（llm, asr, tts, storage, terminal, crypto, platform）
├── environment/        # L2：共享物理世界
│   ├── interfaces/     #   Port interface 定义
│   ├── environment.ts  #   Environment 实现
│   ├── resource-pool.ts
│   ├── message-buffer.ts
│   └── bootstrap.ts    #   运行时检测 → 组装 Adapter
├── services/           # L3
│   ├── interfaces/     #   Service interface
│   └── impl/           #   Service 实现
├── actor/              # L3（Phase 4 引入）
│   ├── interfaces/     #   ActorContext 等
│   ├── mailbox.ts
│   ├── supervisor.ts
│   ├── actors/         #   具体 Actor
│   └── agents/         #   具体 Agent（LLM 驱动）
└── ui/                 # L4
    ├── components/
    ├── pages/
    ├── stores/
    └── providers/

crates/
└── exomind-runtime/    # Rust RT 运行时
    └── src/
        ├── signal/     #   SignalPool 四件套
        ├── routes/     #   HTTP API + SSE
        ├── mesh/       #   ECS-3 组网层
        └── agents/     #   进程内 Actor
```

---

## 8. 渐进式实施路线

### 8.1 前端架构 Phase（L1-L4 分层）

| Phase | 目标 | 引入特性 | 状态 |
|-------|------|----------|------|
| Phase 1 | 语音输入 → LLM → 事件日志 | Port 层、直接调用链 | 部分完成 |
| Phase 2 | 解耦 Service 依赖 | EventBus 发布订阅 | 部分完成 |
| Phase 3 | 资源管控 + 可观测性 | 资源池、消息缓冲 | 未开始 |
| Phase 4 | 多 Agent 并发协作 | Actor Model、Supervisor | 未开始 |
| Phase 5 | 高级生命特性 | Agent 生命周期，沙箱脚本 | 未开始 |

### 8.2 ECS 通信栈实施路线

```
P0 (已完成)     P1 (已完成)     P2 (近期)         P3 (中期)
─────────────   ─────────────   ───────────────   ────────────────
SignalPool      Agent 业务      WebSocket 传输    PeerRegistry
四件套          (classifier     IPC 优化          mDNS 发现
SSE + HTTP      reviewer)       BLE 传输          信道建立
Journal         EventLog Actor  Transport trait   信号中继
WindowCache     Task Actor      二进制编码        跨 RT 路由同步
RouteTable                      Agent 连接注册表
```

### 8.3 总体版本路线

| 阶段 | 版本 | 核心能力 | 通信方案 |
|------|------|----------|----------|
| **现在** | v0.3.x | 单 RT 单机，中心化 broker | HTTP/SSE over TCP |
| **Plan X (近期)** | v0.4-0.5 | 双通道 + 优先队列 | HTTP/SSE + WebSocket |
| **Plan Z (中期)** | v0.5+ | QUIC 多流 + iroh 组网 | iroh (QUIC/NAT/relay) |
| **长期** | v1.0+ | 多人联邦 + E2EE | Federation Gateway |

### 8.4 核心模块状态

| 模块 | 状态 | Phase |
|------|------|-------|
| Port 层（前端） | 部分完成 | Phase 1 |
| Environment（前端） | 部分完成 | Phase 1-3 |
| Service 层（前端） | 部分完成 | Phase 1 |
| EventBus（前端） | 部分完成 | Phase 2 |
| SignalPool（RT） | **已完成** | P0 |
| Agent 业务（RT） | **已完成** | P1 |
| ECS-3 组网层（RT） | 进行中 | P2 |
| EDS 数据栈 | 设计阶段 | P4 |

---

## 9. 设计模式总览

| 模式 | 应用 | 阶段 |
|------|------|------|
| Ports & Adapters | Port 定义能力接口 | Phase 1 |
| Facade | Service 包装底层机制 | Phase 1 |
| Observer | EventBus 发布订阅 | Phase 2 |
| Decorator | EncryptedStorage 叠加加密 | Phase 2 |
| Strategy | 邮箱策略、重启策略 | Phase 3-4 |
| Actor Model | 有界邮箱、异步通信 | Phase 4 |
| Supervisor Tree | 崩溃隔离、自动恢复 | Phase 4 |

### 架构决策记录（已冻结）

| # | 决策 | 选择 | 日期 |
|---|------|------|------|
| D1 | 路由模式 | RT 主动推给 Agent（RouteTable 是路由引擎） | 2026-03-03 |
| D2 | 通信协议 | SSE 统一，无分级 | 2026-03-03 |
| D3 | Agent 模型 | 双轨：进程内 Actor + 进程外 Agent | 2026-03-02 |
| D4 | 任务管理 | Agent 全权 CRUD | 2026-03-03 |
| D5 | 投递语义 | at-most-once | 2026-03-01 |
| D6 | 安全边界 | MVP 仅本机/LAN | 2026-03-01 |
| D7 | 前端角色 | 可 publish 信号 | 2026-03-03 |
| D8 | Topic 匹配 | 精确 + `*` 通配 | 2026-03-03 |
| D9 | RouteTable 持久化 | 文件 JSON | 2026-03-03 |
| D10 | Journal 存储 | 内存 Ring Buffer | 2026-03-03 |
| D11 | Agent supervisor | 外部 bash 脚本循环 | 2026-03-03 |

### 技术选型原则

| 原则 | 内容 | 理由 |
|------|------|------|
| **不引入** Holochain 框架 | 太重，是 dApp 框架 | 只借鉴思想 |
| **不引入** libp2p | iroh 更轻量更适合 | QUIC 单一协议 |
| **自建** SignalPool | 核心路由能力 | 已实现，中心化 broker 是竞争力 |
| **自建** Source Chain | 几百行 Rust | 不需要共识机制 |
| **借用** iroh | P2P 网络 + NAT + relay | Holochain 也在迁移 |
| **借用** btleplug | BLE 通信 | 跨平台成熟 |

---

## 附录：架构演化简史

ExoMind 的架构经历了从 CLI 原型到双栈分布式系统的渐进演化：

**MVP 阶段（2026-01 ~ 2026-02）**：CLI 应用，验证事件驱动的生命日志核心概念。Event + TimeBlock 数据模型，JSON 文件持久化，单活跃块模式。35 个测试全部通过，确立了事件驱动和离线优先两个基础原则。

**v2.0 架构（2026-02）**：引入 Tauri v2 桌面框架，设计了 7 层架构（L3 平台适配 → L7 UI），加入 SignalPool 概念和多端通信（WebSocket），支持 Android Termux 集成。

**v3.0 统一架构（2026-03）**：整合 8 个散落文档为统一架构。引入 ECS/EDS 双栈设计，将 SignalPool 发展为完整的 7 层通信栈（ECS-1 物理链路 → ECS-7 应用语义），加入认知生命科学理论基础和政治经济学视角。

**v4.0 当前架构（2026-03）**：保留 v3.0 的 ECS/EDS 双栈设计，同时用 L1-L4 分层模型（Adapter → Environment → Service/Actor → UI）组织前端代码。RT 运行时侧 SignalPool 四件套已全部实现，Agent 业务层（分类、审核）已上线。ECS-3 组网层（mDNS 发现 + PIN 配对 + Bearer Token 认证）正在开发中。

---

*文档版本: v4.0*
*更新日期: 2026-03-14*
*合并源文档:*
- `docs/architecture.md` — 旧版架构总览 (v2.0, 2026-02-05)
- `docs/architecture/UNIFIED-ARCHITECTURE-v3-DRAFT.md` — 统一架构 v3.1 草稿 (2026-03-05)
- `docs/architecture/MVP-ARCHITECTURE.md` — MVP 架构设计 (2026-02-08)
- `docs/architecture/MVP.md` — 原始 MVP 文档 (2026-02-08)
