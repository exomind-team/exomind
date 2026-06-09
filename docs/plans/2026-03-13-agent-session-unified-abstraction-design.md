# Agent Session 统一抽象设计

> **Issue**: #515
> **日期**: 2026-03-13
> **状态**: Draft — 用户自评审通过，关键决策已确认（D16-D20）
> **关联**: #385 #201 #392 #470 #438 #440 #480

---

## 一、背景与动机

### 1.1 用户真实工作场景

用户同时运行 4+ 个 Claude Code 终端，每个承担不同职责：

| 终端 | 角色                                   | 分支                  | 关联       |
| ---- | -------------------------------------- | --------------------- | ---------- |
| ①   | 任务思考——评审 #511 定位与拆解       | dev                   | 规划性     |
| ②   | PR #506 迁移 rt-sql                    | feature/pr506-...     | PR #506    |
| ③   | 任务规划——拆分 + 整体理解 + 测试    | feature/...           | 多个 issue |
| ④   | 语音输入——分支创建、依赖安装、写测试 | feature/issue-511-... | #511       |

**当前做法**：用截图 + 粉色标签手动标注每个终端角色，肉眼扫描判断进度。本质上**用户在人肉充当多 Agent 调度器**。

### 1.2 核心问题

ExoMind 的 Agent 系统在**概念层**存在分裂：

```
用户视角：                    系统视角：
"4 个 Agent 在并行工作"  →   PTY 进程 × N（PtyManager）
                              + Agent 实例 × M（AgentRegistry）
                              + Claude Session × K（内部 HashMap）
                              —— 三套互不关联的体系
```

用户不关心"这是 PTY 还是 Agent 还是 Session"——用户只关心**"谁在做什么任务、进展如何、需不需要我介入"**。

### 1.3 设计目标

**用一个统一的 `AgentSession` 抽象**，将 PTY、Agent、Session 三套概念收敛为用户可理解的单一实体，并提供：

1. **可见性**：Dashboard 一眼看到所有活跃会话
2. **可追溯性**：每个会话绑定 Issue/分支/PR，持久化存储
3. **可恢复性**：会话历史不随进程退出消失
4. **可协作性**：会话之间可以传递消息和任务

---

## 二、需求分析

### 2.1 痛点需求（必须解决）

| ID           | 痛点                                                                 | 严重度 |
| ------------ | -------------------------------------------------------------------- | ------ |
| **N1** | **会话身份不可见**——打开终端不知道它"是谁"、在做什么任务     | 高     |
| **N2** | **会话状态不可知**——在跑什么？构建中？等我决策？只能盯输出猜 | 高     |
| **N3** | **会话历史不持久**——关掉终端丢失所有上下文                   | 高     |
| **N4** | **无全局视图**——没有一个面板能看到所有活跃会话概况           | 高     |
| **N5** | **会话间无协作语义**——Agent 之间是完全隔离的孤岛             | 中     |

### 2.2 期望功能（想要达到）

| ID           | 功能                                                                     | 优先级 |
| ------------ | ------------------------------------------------------------------------ | ------ |
| **W1** | **Dashboard 聚合视图**：所有活跃会话的角色、分支、PR、状态、摘要   | P0     |
| **W2** | **会话上下文绑定**：创建时绑定 Issue、分支、worktree；持久化不丢失 | P0     |
| **W3** | **会话历史列表**：标题+摘要+时间+关联 Issue/PR，可恢复             | P1     |
| **W4** | **跨会话消息传递**：Agent A 的产出可直接发送给 Agent B             | P2     |
| **W5** | **指挥官视角**：一键创建+分配任务、全局审批、任务依赖图            | P2     |

### 2.3 非目标（本次不做）

- 不替代认知生命 Agent 的 workspace/CognitionEngine 架构（#438）
- 不替代 SignalPool 信号网络（保持独立）
- 不实现完整的 TaskScheduler（#470 独立推进）
- 不做跨设备会话同步（后续 mesh 网络解决）

---

## 三、现有架构诊断

### 3.1 三套会话体系

```
┌─────────────────────────────────────────────────────────────┐
│                     当前架构（三套并存）                        │
├──────────────┬──────────────────┬───────────────────────────┤
│  PTY 系统     │  Agent 系统       │  CognitiveLife 系统        │
│  PtyManager  │  AgentRegistry   │  AgentWorkspace           │
│  PtyAgentInfo│  dyn Agent       │  CognitiveLifeAgent       │
│              │  ClaudeAgent     │                           │
│              │  CodexAgent      │                           │
│              │  ApiAgent        │                           │
├──────────────┼──────────────────┼───────────────────────────┤
│ 存储：内存    │ 存储：内存HashMap  │ 存储：文件系统              │
│ 会话：OS进程  │ 会话：内部Session  │ 会话：workspace+state      │
│ 路由：/pty/* │ 路由：/agents/*  │ 路由：/agents/*+workspace  │
│ 前端：xterm  │ 前端：ChatPanel  │ 前端：WorkspaceTabs        │
│ 语义：无      │ 语义：对话        │ 语义：生命                  │
└──────────────┴──────────────────┴───────────────────────────┘
                         ↑ 三者之间没有统一的 Session 概念
```

### 3.2 关键缺失

| 层面                 | 缺失                                     | 影响                          |
| -------------------- | ---------------------------------------- | ----------------------------- |
| **数据模型**   | 无 `Session` 持久化表                  | 重启丢失所有动态 Agent 和会话 |
| **上下文绑定** | Session 不知道自己关联哪个 Issue/分支/PR | 用户必须人肉记忆              |
| **状态聚合**   | 无统一的会话状态枚举                     | 前端无法一致展示              |
| **历史追溯**   | 无会话摘要和历史列表                     | 关掉即忘                      |
| **消息传递**   | SignalPool 只有广播，无点对点            | Agent 间无法直接通信          |

### 3.3 已有的好基础

| 已有                           | 来自              | 可复用           |
| ------------------------------ | ----------------- | ---------------- |
| RuntimeAgentEvent typed stream | #385              | 统一的事件流契约 |
| Agent trait + AgentRegistry    | agent/mod.rs      | Agent 行为抽象   |
| PtyManager spawn/resume        | pty/mod.rs        | 终端管理能力     |
| TaskStore (SQLite)             | task/             | 持久化存储模式   |
| AgentWorkspace                 | workspace.rs      | 文件系统存储模式 |
| RuntimeClient SSE              | runtime-client.ts | 前端流式通信     |
| AgentsPage 拓扑+列表           | AgentsPage.tsx    | UI 框架          |

---

## 四、核心抽象：AgentSession

### 4.1 概念定义

**AgentSession** 是 ExoMind 自己的会话概念——它不是 Claude 的 session，不是 PTY 的进程，而是**"一个 Agent 执行一项工作的完整生命周期"**。

```
AgentSession = Agent（谁）+ Context（为什么）+ State（怎样）+ History（经历了什么）
```

### 4.2 与现有概念的关系

```
AgentSession（ExoMind 统一抽象）
    │
    ├── 标记 Agent 类型（agent_kind: "claude" / "codex" / "api"）
    │     └── 1:N 关系：一种 Agent 可开多个 Session（如 4 个 Claude 终端 = 4 个 Session）
    │
    ├── 可选关联一个 PTY（终端交互模式）
    │     └── PTY 是 Session 的一种 I/O 通道，不是独立实体
    │
    ├── 绑定工作上下文（WorkContext）
    │     └── Issue / Branch / Worktree / PR
    │
    └── 维护会话历史（SessionHistory）
          └── Turns / Summary / Timeline
```

### 4.3 数据模型

#### Rust 核心结构

```rust
/// ExoMind 统一会话
pub struct AgentSession {
    pub id: Uuid,
    pub agent_kind: String,        // Agent 类型标识: "claude" / "codex" / "api"（1:N，一种 Agent 可开多个 Session）

    // ── 身份 ──
    pub role: String,              // "任务思考" / "PR迁移" / "代码审查"
    pub summary: String,           // 一句话描述当前状态（Agent 自动生成或用户手动设置）

    // ── 工作上下文 ──
    pub context: WorkContext,

    // ── 状态 ──
    pub status: SessionStatus,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,

    // ── 交互模式 ──
    pub interaction: InteractionMode,

    // ── 关系 ──
    pub parent_session_id: Option<Uuid>,  // 谁创建/派生了我
}

/// 工作上下文——绑定到具体的开发任务
pub struct WorkContext {
    pub git_branch: Option<String>,       // "feature/issue-511-voice-input"
    pub worktree_path: Option<String>,    // "D:/project/exomind-wt-ab12"
    pub issue_refs: Vec<String>,          // ["#511", "#506"]
    pub pr_ref: Option<String>,           // "#506"
    pub work_dir: Option<String>,         // Agent 工作目录
    pub labels: Vec<String>,             // 自由标签 ["urgent", "refactor"]
}

/// 会话状态
pub enum SessionStatus {
    Running,       // Agent 正在执行
    WaitingInput,  // 等待用户输入/决策
    Completed,     // 任务完成
    Error(String), // 出错
    Paused,        // 暂停（进程仍在，但不活跃）
    Archived,      // 归档（进程已退出，历史保留）
}

/// 交互模式——PTY 或结构化
pub enum InteractionMode {
    /// 结构化 JSON 对话（现有 /agents/:id/chat）
    Structured {
        inner_session_id: Option<String>,  // Claude/Codex 内部 session ID
    },
    /// 原始终端（现有 /pty/*）
    Terminal {
        pty_id: String,                    // PtyManager 中的 ID
        inner_session_id: Option<String>,  // Claude CLI session ID（如果是 Claude 终端）
    },
}
```

#### SQLite Schema

```sql
CREATE TABLE agent_sessions (
    id              TEXT PRIMARY KEY,     -- UUID
    agent_kind      TEXT NOT NULL,        -- Agent 类型标识（"claude"/"codex"/"api"），1:N 关系
    role            TEXT NOT NULL DEFAULT '',
    summary         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'running',  -- running/waiting/completed/error/paused/archived
    interaction_mode TEXT NOT NULL DEFAULT 'structured', -- structured/terminal
    pty_id          TEXT,                 -- Terminal 模式下的 PTY ID
    inner_session_id TEXT,               -- Claude/Codex 内部 session ID

    -- 工作上下文
    git_branch      TEXT,
    worktree_path   TEXT,
    issue_refs      TEXT,                -- JSON array: ["#511", "#506"]
    pr_ref          TEXT,
    work_dir        TEXT,
    labels          TEXT,                -- JSON array: ["urgent"]

    -- 关系
    parent_session_id TEXT REFERENCES agent_sessions(id),

    -- 时间
    created_at      TEXT NOT NULL,
    last_active_at  TEXT NOT NULL,

    -- 历史摘要
    turn_count      INTEGER NOT NULL DEFAULT 0,
    last_output_preview TEXT             -- 最后输出的前 200 字符
);

CREATE INDEX idx_sessions_status ON agent_sessions(status);
CREATE INDEX idx_sessions_agent ON agent_sessions(agent_kind);
CREATE INDEX idx_sessions_active ON agent_sessions(last_active_at DESC);
```

### 4.4 会话生命周期

```
创建（Create）
    │  用户在 Dashboard 点"新建会话"
    │  或通过 API 创建
    │  绑定 Agent kind + WorkContext
    ▼
运行（Running）
    │  Agent 正在执行任务
    │  实时更新 last_active_at / summary / last_output_preview
    ├──→ 等待输入（WaitingInput）──→ 用户响应后回到 Running
    ├──→ 出错（Error）──→ 用户处理后回到 Running
    │
    ▼
完成（Completed）
    │  任务完成
    │  自动生成最终摘要
    ▼
归档（Archived）
    │  进程退出，历史保留
    │  可从历史列表恢复（创建新 Session，继承 WorkContext + 引用旧 Session）
    ▼
删除（Delete）
    永久删除（用户主动操作）
```

### 4.5 与现有系统的整合策略

**原则：增量引入，不破坏现有接口。**

```
                    新增层（AgentSession）
                    ┌───────────────────────┐
                    │   SessionStore (SQLite)│
                    │   SessionManager       │
                    │   SessionRouter        │
                    └──────┬────────────────┘
                           │ 组合（不继承）
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
        AgentRegistry   PtyManager    TaskStore
        （不变）         （不变）       （不变）
```

- **AgentRegistry** 保持不变——管理 Agent 实例的创建/销毁
- **PtyManager** 保持不变——管理终端进程
- **SessionManager** 是新增的协调层，引用 AgentRegistry 和 PtyManager
- 现有 `/agents/*` 和 `/pty/*` 路由保持向后兼容
- 新增 `/sessions/*` 路由作为统一入口

---

## 五、API 设计

### 5.1 Session CRUD

```
POST   /sessions              创建会话
GET    /sessions              列出所有会话（支持 ?status=running&sort=last_active）
GET    /sessions/:id          获取会话详情
PATCH  /sessions/:id          更新会话（role/summary/context/status）
DELETE /sessions/:id          删除会话

GET    /sessions/:id/history  获取会话的对话历史摘要
POST   /sessions/:id/chat     通过会话发送消息（代理到底层 Agent）
POST   /sessions/:id/stop     停止会话中的 Agent
POST   /sessions/:id/resume   恢复已暂停/归档的会话
```

### 5.2 创建会话请求

```json
{
  "agent_kind": "claude",          // Agent 类型（claude / codex / api）
  "role": "PR迁移",
  "context": {
    "git_branch": "feature/pr506-rt-sql-migration",
    "issue_refs": ["#506"],
    "pr_ref": "#506",
    "work_dir": "D:/project/exomind"
  },
  "interaction": "terminal",    // "terminal" | "structured"
  "provider_profile_id": "..."  // 可选，用于 API Agent
}
```

### 5.3 Dashboard SSE 流

```
GET /sessions/stream   全局会话状态流（SSE）

事件类型：
- session.created    { session_id, role, agent_kind }
- session.updated    { session_id, status, summary, last_output_preview }
- session.completed  { session_id, final_summary }
- session.error      { session_id, error_message }
- session.deleted    { session_id }
```

---

## 六、前端设计

### 6.0 设计理念：任务指挥台（Mission Control）

前端核心理念不是"项目管理看板"，而是**任务指挥台**——只展示需要你行动的东西，完成的自动消失。

设计原则：
- **操作导向**：不展示已完成/已归档的会话，只展示活跃 + 需要你介入的
- **平铺优先**：默认用平铺窗格同时监控多个 Agent，不是列表+详情面板
- **任务驱动**：与现有任务系统（TaskStore）深度结合，Session 的 WorkContext 关联 Task
- **渐进增强**：平铺窗格（P0）→ 信号拓扑画布（P1）→ 3D 空间化（远期愿景）

### 6.1 核心视图：平铺窗格（Tiled Panes）

同时展示 2-8 个活跃 Agent 会话，每个窗格实时显示终端/对话输出。

```
┌─────────────────────────────────────────────────────────────────────┐
│  Mission Control                                [+ 新建]  [2×2 ▾]  │
├────────────────────────────────┬────────────────────────────────────┤
│ 🟢 任务思考           dev     │ 🟢 PR迁移      feature/pr506     │
│ #511 评审拆解          12m    │ #506 rt-sql 迁移    PR #506  8m  │
│ ─────────────────────────────│─────────────────────────────────── │
│ > 建议将 user.input 拆为三层 │ $ bun test                        │
│ > 1. raw_input — 原始输入    │ running 7 tests...                │
│ > 2. normalized — 归一化     │ ✓ task_runtime_sqlite             │
│ > 3. parsed — 结构化解析     │ ✓ timeblock_runtime               │
│ >                            │ ✓ session_store                   │
│ > 这样 CognitionEngine 只    │ 7/7 tests passed                  │
│ > 消费 parsed 层...          │                                   │
│ [发送...]            [⏸ ⏹]  │ [发送...]                 [⏸ ⏹]  │
├────────────────────────────────┼────────────────────────────────────┤
│ 🟡 语音输入   feature/#511   │ 🟢 代码审查         dev           │
│ #511 统一归一化    ⚠ 等待决策 │ #512 overlay fix             5m  │
│ ─────────────────────────────│─────────────────────────────────── │
│ > bun install 完成            │ > 审查了 3 个文件：               │
│ > 等待确认测试方案：          │ > - overlay.tsx: 修复 z-index     │
│ >   A) 只测 normalizer       │ > - theme.ts: 移除未使用变量      │
│ >   B) 端到端含 voice→parse  │ > - App.tsx: 路由守卫调整         │
│ >                            │ >                                 │
│ > 请选择方案                  │ > LGTM，建议合并                  │
│ [A] [B] [自定义...]  [⏸ ⏹]  │ [发送...]                 [⏸ ⏹]  │
└────────────────────────────────┴────────────────────────────────────┘
```

**窗格结构**：每个窗格由三部分组成——
- **标题栏**（24px）：状态灯 + 角色名 + 分支/Issue + 时间 | WaitingInput 时高亮
- **内容区**（flex-1）：嵌入 PtyTerminal（终端模式）或 ChatPanel（结构化模式），实时滚动
- **操作栏**（32px）：发送消息 + 暂停/停止 | WaitingInput 时显示快捷操作按钮

**布局选项**（右上角下拉）：
- `2×2`（默认）— 4 个窗格，每个占 1/4 屏幕
- `2×4` — 8 个窗格，适合大屏
- `1×2` — 2 个窗格横向分屏，适合深度对比
- `自适应` — 按活跃会话数量自动选择最佳布局

**交互行为**：
- 窗格可**拖拽交换位置**（@dnd-kit）
- 双击窗格标题栏 → **全屏放大**该窗格（再双击恢复）
- WaitingInput 状态的窗格 → **边框高亮**（黄色脉冲），操作栏变为快捷按钮
- 会话完成 → 窗格**淡出消失**，剩余窗格自动重排
- 空窗格显示 `[+ 新建会话]` 占位符

### 6.2 WaitingInput 快捷操作

当 Agent 需要用户决策时，操作栏变为内嵌的快捷操作面板，无需打开详情：

```
┌────────────────────────────────────────┐
│ 🟡 语音输入   #511         ⚠ 等待决策 │
│ ──────────────────────────────────────│
│ > 等待确认测试方案：                    │
│ >   A) 只测 normalizer                 │
│ >   B) 端到端含 voice→parse            │
│                                        │
│ ┌──────────────────────────────────┐   │
│ │ [A: 只测 normalizer]  [B: 端到端] │   │
│ │ [💬 自定义回复...]    [⏸ 暂停]    │   │
│ └──────────────────────────────────┘   │
└────────────────────────────────────────┘
```

Agent 可在 `WaitingInput` 事件中附带结构化选项（`options: Vec<QuickAction>`），前端渲染为按钮；否则 fallback 为自由文本输入。

### 6.3 与任务系统的关系

Session 和 Task 是**平行但关联**的概念：
- Task 是"要做什么"（来自 TaskStore），Session 是"谁在做"（来自 SessionStore）
- 一个 Task 可以关联到一个 Session（通过 `WorkContext.issue_refs`）
- Mission Control 可以从 Task 列表一键创建 Session："为这个 Task 分配一个 Agent"

```
TaskStore (已有)              SessionStore (新增)
┌──────────┐                 ┌──────────┐
│ Task     │ ── 1:N 关联 ──→ │ Session  │
│ #511     │                 │ 语音输入  │
│ 统一归一化│                 │ Running  │
└──────────┘                 └──────────┘
```

### 6.4 AgentsPage 四种视图模式

所有视图作为 AgentsPage 的 ViewMode 切换，**不新增路由**：

| 视图 | 状态 | 技术 | 说明 |
|------|------|------|------|
| **Topology** | 现有 | ReactFlow | 信号拓扑图——节点 + 连线，展示 Agent 间信号关系 |
| **Tiled** | **V1 新增** | CSS Grid + xterm.js | 平铺窗格 Mission Control——同时看 2-8 个 Agent 实时输出 |
| **Canvas** | 远期愿景 | ReactFlow / Three.js | 无限画布——类似 OpenCove 空间化布局，自由拖放 Agent 窗口 |
| **List** | 现有 | 表格/卡片 | 紧凑列表——快速浏览所有 Agent 状态 |

`tiled` 为默认视图。现有 topology / list 保持不变。

### 6.5 前端组件架构

```
AgentsPage（扩展现有页面，新增 tiled 视图模式）
├── ViewModeToggle                // topology | tiled（新增）| list | ...
│
├── ─── 平铺模式（新增，默认 ⭐）───
│   ├── MissionControl              // 平铺容器
│   │   ├── LayoutSelector          // 2×2 / 2×4 / 1×2 / auto
│   │   └── TiledGrid              // CSS Grid 容器
│   │       └── SessionPane × N    // 单个窗格
│   │           ├── PaneHeader      // 状态灯 + 角色 + 分支 + 时间
│   │           ├── PaneContent     // 复用 PtyTerminal 或 ChatPanel
│   │           │   ├── TerminalView  // xterm.js（终端模式）
│   │           │   └── ChatView      // 消息列表（结构化模式）
│   │           ├── PaneActions     // 发送/暂停/停止
│   │           └── QuickActionBar  // WaitingInput 时的快捷按钮
│   └── EmptyPanePlaceholder       // [+ 新建会话] 占位
│
├── ─── 拓扑模式（保留现有）───
│   └── ReactFlow topology graph    // 现有的 agents-signal-topology.ts
│
├── ─── 列表模式（简化保留）───
│   └── SessionList + SessionCard   // 紧凑列表，点击跳转到平铺窗格聚焦
│
├── CreateSessionDialog             // 创建新会话
│   ├── AgentKindSelector
│   ├── ContextForm (分支/Issue/PR/工作目录)
│   └── InteractionModeToggle (终端/结构化)
│
└── useSessionStream hook           // SSE 实时更新所有窗格
```

**技术细节**：
- `TiledGrid` 用 CSS Grid 实现：`grid-template-columns: repeat(cols, 1fr)`
- 每个 `SessionPane` 内嵌一个独立的 xterm.js 实例或 ChatPanel
- xterm 多实例性能：借鉴 OpenCove 的 `queuePtyDataBroadcast` debounce + 阈值刷新策略
- 窗格 resize 时需同步 PTY 的 cols/rows（`SIGWINCH` → Tauri `pty_resize` command）
- 拖拽交换：@dnd-kit sortable，只交换 Grid 中的 Session 引用，不移动 DOM

---

## 七、实现计划（垂直切片）

> **原则**：每个切片贯穿全栈，交付后用户打开 app 就能看到新东西。
> 不按技术层（Store→API→前端）拆，按用户体验拆。

### V1: Session 列表卡片 — 用新架构改进现有 Terminal Agent

**范围**：AgentsPage 新增 `sessions` 视图（独立新视图，不改现有拓扑/列表）+ Session 后端基础。

**设计理念**：类似 Windows Terminal 管理多个标签页——每个 Claude/Codex 会话是一张卡片，显示会话标题、状态、对话历史摘要。现有 Terminal Agent（Claude）已成熟，但缺少会话标题和全局管理视图。

**做什么**：
- 前端: AgentsPage 新增 `sessions` 视图模式（全新组件，不修改现有代码避免复杂度）
- 前端: Session 列表卡片（SessionCard）— 角色 + agent_kind 标签 + 状态灯 + 最后输出摘要
- 前端: 点击卡片 → 打开终端详情（复用现有 PtyTerminal / AgentConversation）
- 前端: **使用 mock 数据**（`mock-data.ts` 新增 `MOCK_SESSIONS`，受设置页"使用测试数据"开关控制）
- 后端暂不改：V1 纯前端 + mock，V2 再引入 SessionStore SQLite + CRUD API

**Mock 数据样例**：
```typescript
MOCK_SESSIONS = [
  { id: "mock-1", agent_kind: "claude", role: "任务思考",   status: "running",       summary: "分析 #511 拆解方案...",  git_branch: "dev" },
  { id: "mock-2", agent_kind: "claude", role: "PR迁移",     status: "running",       summary: "bun test 7/7 passed",   git_branch: "feature/pr506", pr_ref: "#506" },
  { id: "mock-3", agent_kind: "claude", role: "代码审查",   status: "waiting_input", summary: "等待确认测试方案 A/B",   git_branch: "dev" },
  { id: "mock-4", agent_kind: "codex",  role: "语音输入",   status: "running",       summary: "bun install 完成",       git_branch: "feature/#511" },
]
```

**你怎么验收**：
打开 AgentsPage → 切到 `sessions` 视图 → 看到 4 张 mock Session 卡片（角色+状态+摘要）。点击卡片打开终端详情。"使用测试数据"开关关闭时 → 列表为空（V2 接入真实 API 后才有数据）。

---

### V2: Session 真实后端 + 上下文绑定

**范围**：后端 SessionStore + 前端接入真实 API，告别 mock 数据。

**做什么**：
- Rust: `session/` 模块 — SessionStore (SQLite) + 基础 CRUD API (`/sessions/*`)
- Rust: SessionManager 包裹 PtyManager，PTY spawn 时**自动创建关联 Session**（D17）
- Rust: WorkContext 绑定（git branch / issue / PR / worktree）+ SSE `/sessions/stream`
- Rust: Session 状态自动更新（Agent 输出 → summary / last_output_preview）
- 前端: 关闭"使用测试数据"→ SessionCard 从真实 API 获取数据
- 前端: SessionCard 显示 branch / issue / PR 标签（ContextChips）
- 前端: `useSessionStream` hook 实时更新卡片状态
- 前端: 会话历史列表 — 已完成的 Session 可回顾（30-60s 缓冲后才折叠，不立即消失）
- 持久化：SQLite schema 使用 `PRAGMA user_version` 预留版本管理

**你怎么验收**：
关闭"使用测试数据"→ 打开终端 → 自动出现 Session 卡片"🟢 未命名 · claude"。编辑角色为"PR迁移"+ 绑定分支 → 卡片变成"🟢 PR迁移 · feature/pr506 · #506 · 3m ago"。关闭 app → 重新打开 → Session 记录还在。

---

### V3: 平铺窗格 — 多 Session 同屏监控

**范围**：前端新增 `tiled` 视图模式，内嵌终端实时输出。

**做什么**：
- 前端: TiledGrid（CSS Grid 2×2/2×4/1×2）+ SessionPane 嵌入 xterm.js
- 前端: 非聚焦窗格降频渲染（200ms debounce），聚焦窗格 60fps
- 前端: PtyTerminal paste handler 修复（多实例时只发到聚焦终端）
- 性能基准测试：4 个 xterm 实例 × 100行/秒输出，验证帧率 ≥ 30fps

**你怎么验收**：
切到 `tiled` 视图 → 看到 2×2 网格，每个窗格实时显示终端输出 → 在窗格内打字可交互。

---

### V4: 交互增强 — 布局+拖拽+注意力优先级

**范围**：纯前端交互。

**做什么**：
- 布局选择器：2×2 / 2×4 / 1×2 / 自适应
- @dnd-kit 拖拽交换 + 双击全屏
- 注意力优先级：正常运行窗格自动降亮（半透明），WaitingInput/Error 突出
- 全局状态指示："全部正常，无需介入"

**你怎么验收**：
正常运行的窗格内容稍暗，需要决策的窗格亮起。切布局、拖拽、双击全屏都可用。

---

### V5: WaitingInput 快捷操作（结构化模式优先）

**范围**：后端状态检测 + 前端快捷按钮。先只支持 Structured 模式。

**做什么**：
- Rust: 扩展 RuntimeAgentEvent 增加 WaitingInput 变体 + QuickAction 结构
- 前端: QuickActionBar 渲染按钮或自由文本输入
- PTY 终端模式暂用"手动标记"过渡（用户点按钮标记"等我决策"）

**你怎么验收**：
结构化对话模式下 Agent 等决策 → 卡片/窗格边框变黄 → 底部出现快捷按钮。

---

### V6（可延后）: 跨会话通信 + 指挥官视角

- Session 间点对点消息
- 指挥官面板：从 Task 列表一键分配 Agent
- 父子 Session 关系追溯
- Participant 统一身份（User/Agent 共用消息模型，为 Agent 自主协作预留）

---

## 八、与现有 Issue 的关系

```
                    ┌─────────────────────┐
                    │  本 Issue（统筹）     │
                    │  Agent Session       │
                    │  统一抽象             │
                    └──────┬──────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
     ┌──────────┐   ┌──────────┐   ┌──────────┐
     │ #385     │   │ #438     │   │ #480     │
     │ Runtime  │   │ 认知生命  │   │ Friday   │
     │ Adapter  │   │ Agent    │   │ MVP      │
     │ (基础)   │   │ (兼容)   │   │ (协同)   │
     └──────────┘   └──────────┘   └──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌──────────┐ ┌──────────┐
│ #392     │ │ #201     │
│ 运行态    │ │ Agent Hub│
│ 监控     │ │ MVP      │
│ (数据源) │ │ (UI基础) │
└──────────┘ └──────────┘
     │
     ▼
┌──────────┐
│ #470     │
│ Task     │
│ Scheduler│
│ (后续)   │
└──────────┘
```

| 关系              | Issue | 说明                                                         |
| ----------------- | ----- | ------------------------------------------------------------ |
| **依赖**    | #385  | Session 的 typed event stream 基于 #385 的 RuntimeAgentEvent |
| **兼容**    | #438  | CognitiveLifeAgent 的 workspace 不受影响，Session 层包裹它   |
| **协同**    | #480  | Friday MVP 的语音输入流可以作为 Session 的一种输入通道       |
| **数据源**  | #392  | Session 状态是运行态监控的统一数据源                         |
| **UI 基础** | #201  | Dashboard 复用 Agent Hub 的拓扑视图框架                      |
| **后续**    | #470  | TaskScheduler 可以通过 Session 分配任务给 Agent              |
| **后续**    | #440  | Phase 2 前端可视化与 SessionDashboard 合并或协调             |

---

## 九、验收标准

### MVP 验收（Phase 0-2）

- [ ] 用户可在 Dashboard 创建新的 Agent 会话，指定角色 + 工作上下文（分支/Issue/PR）
- [ ] Dashboard 实时显示所有活跃会话的状态（Running/Waiting/Error）
- [ ] 每个会话卡片展示：角色标签、分支名、关联 Issue/PR、最后输出摘要、活跃时间
- [ ] 点击会话可打开详情面板，查看对话历史或终端输出
- [ ] 会话状态持久化到 SQLite，Runtime 重启后历史不丢失
- [ ] 通过旧 API 创建的 PTY/Agent 自动关联到 Session（Phase 3）

### 完整验收（Phase 0-4）

- [ ] MVP 全部通过
- [ ] Session 间可发送消息
- [ ] 指挥官面板可一键创建会话并分配任务
- [ ] 父子 Session 关系可追溯

---

## 十、设计决策记录

| ID | 决策                                            | 理由                                                             |
| -- | ----------------------------------------------- | ---------------------------------------------------------------- |
| D1 | Session 存 SQLite 不存内存                      | N3 要求持久化；TaskStore 已验证 SQLite 模式                      |
| D2 | Session 层不替代 Agent trait                    | 增量引入原则；Agent trait 是行为契约，Session 是管理元数据       |
| D3 | PTY 收敛为 Session 的 InteractionMode           | 统一用户视角；PTY 和结构化对话只是 I/O 方式不同                  |
| D4 | 不引入 Thread/Turn 三层模型                     | YAGNI；先用 Session 单层解决 N1-N4，Turn 级别细节留给 Agent 内部 |
| D5 | Mission Control 作为 AgentsPage 的 tiled 视图模式（默认） | 复用现有 AgentsPage 框架；与拓扑视图共存                         |
| D8 | 前端只展示活跃+需介入的会话，不展示已完成/已归档 | 操作导向设计——用户只关心"现在需要处理什么"，不是项目管理看板 |
| D9 | 平铺窗格用 CSS Grid 而非 ReactFlow/无限画布 | 规整的 2×2/2×4 布局不需要自由拖放，Grid 性能更好且实现简单 |
| D10 | 借鉴 OpenCove 状态四分类：Durable Fact vs Runtime Observation | watcher 只上报 observation，不直接修改持久化状态 |
| D11 | WaitingInput 内嵌快捷操作按钮 | 减少上下文切换——用户无需打开详情页即可做决策 |
| D12 | ~~一个 PR~~ → **每个 V 切片一个 worktree/PR** | 避免 PR #474 教训（大 PR scope mismatch），每个 PR 控制 300-500 行 |
| D13 | V1 就引入 SessionStore SQLite（不等 mock） | 产品评审结论：重启丢状态不可交付，持久化是基础卫生 |
| D14 | 复用现有 PTY 终端能力，整合零散探索 | 已有对话历史保持、会话管理等能力，统一到新设计规范 |
| D15 | AgentsPage 四种视图模式（topology/tiled/canvas/list） | 不新增路由；canvas 为远期愿景（参考 OpenCove 空间化 + claw-empire CEO desk） |
| D16 | Session:Agent = **1:N**（`agent_kind` 类型标识，非实例 ID） | Agent 在 Registry 中是单例（"claude"/"codex"），Terminal 模式下 Session 直接持有 PTY，不需要 Agent 实例参与。agent_kind 只是类型标签 |
| D17 | 旧入口（`/pty/spawn`）**自动创建 Session** | SessionManager 包裹 PtyManager 拦截 spawn，避免"野生终端"不出现在 Dashboard |
| D18 | Archived Session **手动管理**，不自动清理 | SQLite 存几百条无压力；V1 不做 retention policy，历史列表默认折叠 |
| D19 | V1 = mock 数据（开关控制），V2 = 真实 API | 现有设置页"使用测试数据"开关控制；mock-data.ts 新增 MOCK_SESSIONS；V2 接入后开关仍保留供调试 |
| D20 | **单人开发阶段简化流程**：直接在 dev 提交，不强制 worktree/PR | 工具链未完善 + 唯一开发者，减少流程摩擦优先 |
| D6 | WorkContext 用 JSON 存可选字段                  | 不同场景的 context 差异大，固定 schema 太僵硬                    |
| D7 | summary 由 Agent 自动生成 + 用户可覆盖          | 降低用户手动维护成本；但保留人工修正权                           |

---

## 十一、风险与缓解

| 风险                              | 影响               | 缓解                                                                         |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| Session 层增加 Agent 创建的复杂度 | 用户体验退化       | 现有 API 保持兼容，Session 自动创建                                          |
| summary 自动生成质量差            | Dashboard 信息无用 | 用 Agent 最后一条输出做 fallback                                             |
| PTY 输出流与 Session 状态不同步   | 状态不一致         | Session 订阅 PTY 的 broadcast channel                                        |
| 与 #440 Phase 2 UI 工作重叠       | 重复开发           | 协调 UI 组件复用，Dashboard 的 SessionCard 和 #440 的 AgentCard 共享基础组件 |

---

## 附录 A：参考架构

### IronClaw Session/Thread/Turn 三层

ExoMind 当前只需要 Session 层。Thread（多对话线程）和 Turn（单轮细节）暂不引入：

- ExoMind 的 Session 对应 IronClaw 的 Thread（一个连续对话）
- IronClaw 的 Session（跨对话用户上下文）在 ExoMind 由 WorkContext 替代
- Turn 粒度留给 Agent 内部管理

### ZeroClaw 记忆模型

- Core / Daily / Conversation 三级记忆 → 对应 Session 的持久化 / 运行时 / 即时上下文
- 混合检索（向量 + BM25）→ Session 历史搜索的未来方向

### ExoMind 多 Agent 系统设计

- 监督者模式（Supervisor Hub-and-Spoke）→ Session 的 parent/child 关系 = 天然的监督者拓扑
- 三阶段人机协作（需求审批 → 自动执行 → 验收）→ Session 的 WaitingInput → Running → Completed 生命周期

### HiClaw Manager-Worker 模式（2026-03-13 调研）

阿里 Higress 团队的开源多 Agent 协作系统。详见 `3-学科知识沉淀/.../HiClaw-多Agent协作架构调研.md`。

**可借鉴的设计模式**：
1. **state.json 任务单一数据源** → SessionStore 作为 Session 状态的唯一真相源
2. **Worker 自动生命周期**（idle 30min → stop → wake on task assign）→ Session 自动归档 + 按需恢复
3. **Heartbeat 巡检**（15min 周期检查 Worker 健康+进度）→ SSE `/sessions/stream` 状态轮询
4. **.processing 标记文件**（防止 Manager/Worker 同时修改同一目录）→ SessionStatus 转换矩阵 + 乐观锁
5. **任务目录结构**（spec.md / plan.md / result.md / progress/）→ WorkContext 可绑定任务目录
6. **Coding CLI Delegation**（Worker → Manager 内的 Claude Code）→ Session 间任务委托模式

**ExoMind 的差异化优势**：
- SignalPool typed event stream（HiClaw 只有纯文本 IM）
- CognitionEngine 可插拔认知（HiClaw 的 Agent 只是 LLM wrapper）
- 本地优先 Tauri（HiClaw 是服务端 Docker 部署）
- PTY 实时终端集成（HiClaw 无终端视图）
- per-Agent workspace 知识库（HiClaw 用共享 MinIO）

---

## 附录 B：四方评审汇总（2026-03-13）

> 由 Architect / Designer / Coder / Product 四个 Agent 并行评审。

### 架构评审（Architect）

**确认的好设计**：组合不继承策略、InteractionMode 枚举、D4 YAGNI、D10 状态四分类。

**关键改进（已采纳）**：
1. `SessionStatus` 需补充状态转换矩阵（参考 `TaskStatus::valid_transitions()`）
2. `Error(String)` → 拆为 `status="error"` + 独立 `error_message TEXT` 列
3. SSE 事件节流：Session SSE 只推状态变更，PTY 输出走现有 `/pty/:id/stream`，不混合
4. PTY 自动关联走 SessionManager 包裹（路径 B），不侵入 PtyManager
5. WorkContext 新增 `task_id: Option<String>` 精确关联 TaskStore
6. `parent_session_id` 加 `ON DELETE SET NULL`
7. SessionStore 用独立 SQLite 文件（与 TaskStore 模式一致）

**风险预警**：
- xterm.js 8 实例性能 → 非聚焦降频（200ms）+ V3 做性能基准测试
- WaitingInput PTY 模式检测极难 → V5 先只支持 Structured，PTY 用手动标记过渡
- `inner_session_id` 命名混淆 → API 用 `id`（ExoMind）vs `provider_session_id`（Claude/Codex）

### 实现可行性评审（Coder）

**已确认可行**：
- `/pty` GET API 已存在，返回完整 `PtyAgentInfo`
- AgentsPage 视图切换是数据驱动，加视图只需改 3 处（类型+按钮+渲染分支）
- PTY broadcast channel 天然支持多 subscriber
- 零新依赖（V1-V3），V4 需安装 @dnd-kit

**需注意**：
- `PtyTerminal.tsx` paste handler 多实例 bug（document 级别 paste 发到所有终端）→ V3 前修复，~5 行
- V3 的 SessionStore SQLite 路径需加环境变量 `EXOMIND_RT_SESSION_SQLITE_PATH`
- AgentsPage 4186 行复杂度 → Codex prompt 需给精确行号锚点
- SQLite 无 migration 框架 → SessionStore init 时加 `PRAGMA user_version` 预留

**Codex 执行建议**：V1 单独 issue 可做；V3 拆 V3a（后端）V3b（前端）；V5 需先定义检测策略

### 产品策略评审（Product）

**核心结论**：
- 痛点真实但极小众（<1% 开发者同时跑 4+ Agent）
- **但长远愿景化解了这个风险**：最终所有人通过语音让 Agent 后台工作，平铺视图是可选监控窗口
- 与 tmux 的差异化在 Session 上下文绑定（WorkContext）才显现 → 持久化必须提前到 V1
- 完成后自动消失太激进 → 改为 30-60s 灰色缓冲态
- 缺少注意力优先级 → 正常运行降亮 + WaitingInput/Error 突出 + 全局"无需介入"指示
- 建议 SQLite schema 预留 `canvas_x/canvas_y`（Canvas 视图）和 `initiator_kind/initiator_id`（Participant 统一身份）

### 产品演进路径（用户确认）

```
近期（个人急需）          中期（产品化）             远期（愿景）
────────────────        ────────────────          ────────────────
人肉调度 10 工作区       单 Agent 体验做好          语音 → 自动调度
Session 列表卡片         完善 Terminal Agent        Agent 后台运行
→ 平铺视图监控          任务管理 + 知识库          平铺视图变可选监控
                        多 Agent 调度              大多数人不需要看
```

### UI/UX 设计评审（Designer）

**关键发现**：

1. **PaneHeader 24px 不够** → 改为 36-40px 双行（第一行：状态灯+角色+时间；第二行：分支+Issue badge）
2. **2×4 在 1080p 下只有 11 行终端** → 勉强可用，需 Sidebar 折叠到 icon-only（48px）+ 字号降到 11-12px
3. **WaitingInput 脉冲应衰减** → 30 秒后停止脉冲改为静态黄色边框+角标计数。替代方案：3px 黄色左侧竖条（更克制）
4. **完成后不应自动消失+不应自动重排** → 灰显(opacity 0.6)+手动归档，空位变占位符
5. **SSE 连接数超限** → 8 PTY SSE + 1 全局 = 9，超 HTTP/1.1 的 6 并发限制 → 需 SSE 多路复用（一个连接承载所有 PTY）
6. **移动端完全缺失** → tiled 退化为垂直卡片流（全宽 200px 高，点击进全屏）
7. **键盘快捷键缺失** → Ctrl+1-8 聚焦窗格、Escape 退出全屏、Tab 在窗格间移动
8. **色盲可访问性** → 纯色不够，需辅助形状（● 运行 / ▲ 等待 / ✕ 出错 / ✓ 完成 / ⏸ 暂停）
9. **补充布局** → 加 1×1（单窗格全屏）和 3×1（超宽屏三列）
10. **自适应断点** → <600px: 1×1 / 600-1200: 1×2 / 1200-1800: 2×2 / 1800+: 2×4

**V1/V2 前必须解决**：paste handler 焦点感知、SSE 多路复用方案、移动端退化策略

### 关键决策变更记录

| 原决策 | 变更为 | 原因 |
|--------|--------|------|
| V1 = 平铺骨架（纯前端） | V1 = Session 列表卡片 + SQLite 持久化 | 持久化是基础卫生；先做好单 Session 再做多 Session |
| 一个 PR 做完 V1-V5 | 每个 V 一个 worktree/PR | 避免大 PR scope mismatch |
| 改造现有 AgentsPage 视图 | 新建独立视图组件（sessions） | 避免修改现有拓扑/列表导致复杂度爆炸 |
| 完成后自动消失 | 完成后 30-60s 灰色缓冲态 | 用户需要回顾刚完成的内容 |
| WaitingInput 支持 PTY+Structured | V5 先只支持 Structured | PTY 终端模式检测不可靠，用手动标记过渡 |
