# Phase 1: Agent 身体骨架 — 执行计划

> **Epic**: GH #438
> **分支**: `ex/xxxx-438-agent-body`（从 dev 创建）
> **PR 目标**: dev
> **总计**: ~2,250 行，7 串行 commit

---

## 项目上下文

ExoMind 正在从"聊天助手"进化为"认知生命平台"。Phase 1 的任务是**给 Agent 造身体**——包括 workspace 目录、长期记忆、行动日志、可插拔认知引擎接口，以及第一个认知生命实体。

### 核心原则
- **新增为主，最小修改现有代码**。现有 Claude/Codex/API Agent 保持不动
- 新 Agent 也必须实现现有 `Agent` trait（为了兼容 `AgentRegistry`）
- 认知引擎可插拔：`CognitionEngine` trait，Phase 1 实现 LLM 版本

### 关键文件定位
```
crates/exomind-runtime/src/
├── agent/
│   ├── mod.rs          ← 现有 Agent trait + AgentRegistry（最小修改）
│   ├── claude.rs       ← 现有（不动）
│   ├── codex.rs        ← 现有（不动）
│   ├── echo.rs         ← 现有（不动）
│   ├── heartbeat.rs    ← 现有（Phase 1 后可退役但不删）
│   ├── api.rs          ← 现有（不动）
│   └── runtime_event.rs ← 现有（不动）
├── energy.rs           ← AgentEnergy + EnergyRegistry（读取，不修改）
├── signal/             ← SignalPool 四件套（读取，不修改）
├── tick.rs             ← spawn_agent_tick（最小修改：支持 workspace）
├── routes/             ← REST API 路由
└── lib.rs              ← 模块注册
```

### 现有 Agent trait（参考，不修改核心方法）
```rust
pub trait Agent: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn status(&self) -> &'static str { "available" }
    fn chat_stream(&self, request: ChatRequest) -> BoxStream<'static, ChatChunk>;
    fn list_sessions(&self) -> Vec<SessionInfo> { Vec::new() }
    fn get_session(&self, _session_id: &str) -> Option<SessionInfo> { None }
    fn close_session(&self, _session_id: &str) -> bool { false }
    fn stats(&self, _session_id: Option<String>) -> BoxFuture<'_, Option<Value>> { ... }
    fn subscriptions(&self) -> Vec<String> { Vec::new() }
    fn publications(&self) -> Vec<String> { Vec::new() }
    fn tick_interval_secs(&self) -> u64 { 0 }
    fn on_signal(&self, _event: SignalEvent) -> BoxFuture<'_, Vec<SignalEvent>> { ... }
    fn on_tick(&self, _energy: &AgentEnergySnapshot) -> BoxFuture<'_, Vec<SignalEvent>> { ... }
}
```

---

## S1: `feat(agent): AgentWorkspace + ActionLog`

### 新增文件
- `crates/exomind-runtime/src/agent/workspace.rs`

### 实现内容

```rust
use std::path::{Path, PathBuf};
use std::fs;
use std::io::{self, BufWriter, Write};
use serde::{Serialize, Deserialize};
use chrono::Utc;

/// Agent 的物理身体 —— workspace 目录
pub struct AgentWorkspace {
    root: PathBuf,
    knowledge_dir: PathBuf,
    max_knowledge_bytes: usize,  // 默认 1MB = 1_048_576
}

/// append-only 行动日志
pub struct ActionLog {
    path: PathBuf,
}

/// 单条行动记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionEntry {
    pub timestamp: String,       // ISO 8601
    pub tick: u64,
    pub action_type: String,     // "think" | "signal" | "knowledge_write" | "knowledge_delete"
    pub description: String,
    pub energy_before: u64,
    pub energy_after: u64,
}
```

### AgentWorkspace 接口
```rust
impl AgentWorkspace {
    /// 初始化 workspace 目录结构
    /// 创建: {root}/bootstrap/, {root}/knowledge/, {root}/actions.jsonl, {root}/agent.state.json
    pub fn init(agent_id: &str, base_dir: &Path) -> io::Result<Self>;

    /// 读取 SOUL.md（DNA，不可变）
    pub fn load_soul(&self) -> io::Result<String>;

    /// 写入默认 SOUL.md（仅在初始化时）
    pub fn write_default_soul(&self, content: &str) -> io::Result<()>;

    /// knowledge CRUD
    pub fn read_knowledge(&self, filename: &str) -> io::Result<String>;
    pub fn write_knowledge(&self, filename: &str, content: &str) -> io::Result<()>;
    pub fn delete_knowledge(&self, filename: &str) -> io::Result<()>;
    pub fn list_knowledge(&self) -> io::Result<Vec<String>>;

    /// 当前 knowledge 总大小（字节）
    pub fn knowledge_usage_bytes(&self) -> io::Result<usize>;

    /// knowledge 使用率 0.0~1.0
    pub fn knowledge_usage_ratio(&self) -> io::Result<f32>;

    /// 行动日志
    pub fn action_log(&self) -> &ActionLog;

    /// 读/写 agent.state.json
    pub fn load_state(&self) -> io::Result<serde_json::Value>;
    pub fn save_state(&self, state: &serde_json::Value) -> io::Result<()>;

    /// workspace 根目录
    pub fn root(&self) -> &Path;
}
```

### ActionLog 接口
```rust
impl ActionLog {
    pub fn new(path: PathBuf) -> Self;

    /// append 一条记录（一行 JSON + \n）
    pub fn append(&self, entry: &ActionEntry) -> io::Result<()>;

    /// 读取所有记录
    pub fn read_all(&self) -> io::Result<Vec<ActionEntry>>;

    /// 总记录数
    pub fn count(&self) -> io::Result<u64>;
}
```

### mod.rs 修改
在 `mod.rs` 中添加：
```rust
pub mod workspace;
```

### 测试要求
- `cargo test` 通过
- 单测覆盖：workspace init、knowledge CRUD、knowledge 配额超限拒绝、actions append + read_all、SOUL 读写
- 使用 `tempdir` 或 `tempfile` crate 做测试隔离

### 约束
- knowledge 文件名不允许 `..` 或绝对路径（路径遍历防护）
- knowledge 总大小超 `max_knowledge_bytes` 时 `write_knowledge` 返回 Error
- actions.jsonl 只 append，无删除/修改接口

**~300 行**

---

## S2: `feat(agent): CognitionEngine trait`

### 新增文件
- `crates/exomind-runtime/src/agent/cognition.rs`

### 实现内容

```rust
use futures_util::future::BoxFuture;
use serde::{Serialize, Deserialize};
use crate::energy::AgentEnergySnapshot;
use crate::signal::types::SignalEvent;

/// 认知引擎的输入上下文
#[derive(Debug, Clone)]
pub struct CognitionContext {
    pub energy: AgentEnergySnapshot,
    pub signals: Vec<SignalEvent>,
    pub knowledge_summary: String,   // 长期记忆的摘要或索引
    pub body_status: BodyStatus,
}

/// 认知引擎的输出
#[derive(Debug, Clone, Default)]
pub struct CognitionOutput {
    pub signals_to_emit: Vec<SignalEvent>,
    pub knowledge_ops: Vec<KnowledgeOp>,
    pub action_description: String,
}

/// 对长期记忆的操作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum KnowledgeOp {
    Write { path: String, content: String },
    Delete { path: String },
}

/// 自我感知状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BodyStatus {
    pub knowledge_usage_ratio: f32,  // 0.0~1.0
    pub total_actions: u64,
    pub uptime_ticks: u64,
    pub current_strategy: String,
}

/// 认知状态（用于保存/恢复）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitionState {
    pub engine_type: String,
    pub data: Vec<u8>,
}

/// 可插拔认知引擎接口
pub trait CognitionEngine: Send + Sync {
    /// 接收上下文 → 思考 → 返回决策
    fn think(&self, ctx: CognitionContext)
        -> BoxFuture<'_, anyhow::Result<CognitionOutput>>;

    /// 正常关闭时保存认知状态
    fn save_state(&self)
        -> BoxFuture<'_, anyhow::Result<CognitionState>>;

    /// 重启时恢复认知状态
    fn restore_state(&self, state: CognitionState)
        -> BoxFuture<'_, anyhow::Result<()>>;

    /// 引擎类型标识（用于状态恢复时匹配）
    fn engine_type(&self) -> &str;
}
```

### mod.rs 修改
```rust
pub mod cognition;
```

### 测试要求
- `cargo check` 通过
- 类型定义正确，trait 可被 impl

**~150 行**

---

## S3: `feat(agent): LlmCognition 实现`

### 新增文件
- `crates/exomind-runtime/src/agent/llm_cognition.rs`

### 实现内容

`LlmCognition` 实现 `CognitionEngine` trait。Phase 1 不接入真实 LLM API，而是实现基于**规则的简单决策引擎**（可以后续替换为 LLM）：

```rust
pub struct LlmCognition {
    agent_id: String,
    soul: String,           // SOUL.md 内容（不变，作为 system prompt）
    // Phase 1 的 "认知" 是规则引擎，后续替换为 LLM 调用
}
```

### think() 逻辑（Phase 1 规则引擎版本）
```
1. 读取 body_status
2. 根据 energy 水平选择策略:
   - energy > 70%: 策略="exploring" → 写 knowledge（记录观察）
   - energy 30-70%: 策略="conserving" → 只响应信号
   - energy < 30%: 策略="surviving" → 沉默，减少动作
   - energy < 10%: 策略="dying" → 发出告别信号
3. 如果有信号输入，生成简单响应信号
4. 定期写入 knowledge/diary.md（记录自己的"想法"）
5. 返回 CognitionOutput
```

### save_state / restore_state
- save: 序列化当前策略 + tick 计数到 `CognitionState.data`
- restore: 反序列化恢复

### mod.rs 修改
```rust
pub mod llm_cognition;
```

### 测试要求
- 单测：不同能量水平 → 不同策略输出
- 单测：signals 输入 → 响应信号输出
- 单测：save_state → restore_state 往返一致

**~400 行**

---

## S4: `feat(agent): CognitiveLifeAgent + tick 集成`

### 新增文件
- `crates/exomind-runtime/src/agent/life.rs`

### 修改文件
- `crates/exomind-runtime/src/agent/mod.rs` — 注册 life 模块 + 可选方法
- `crates/exomind-runtime/src/tick.rs` — tick 后执行 knowledge_ops
- `crates/exomind-runtime/src/lib.rs` — 注册 CognitiveLifeAgent

### CognitiveLifeAgent
```rust
pub struct CognitiveLifeAgent {
    id: String,
    name: String,
    workspace: AgentWorkspace,
    cognition: Box<dyn CognitionEngine>,
    tick_count: AtomicU64,
}
```

实现 **现有** `Agent` trait（兼容 AgentRegistry）：
- `id()` / `name()` / `description()` — 返回固定值
- `chat_stream()` — 返回简单状态报告（"I am alive, energy: X%, strategy: Y"）
- `subscriptions()` — 订阅 `agent.*.tick`（监听其他 Agent）
- `publications()` — 发布 `agent.life.{action}` 信号
- `tick_interval_secs()` — 返回 60（1分钟）
- `on_tick()` — 核心生命循环：
  1. 更新 tick_count
  2. 构建 CognitionContext（从 workspace 读取状态）
  3. 调用 `cognition.think(ctx)`
  4. 执行 `CognitionOutput.knowledge_ops`（写入/删除 knowledge）
  5. 记录 ActionEntry 到 actions.jsonl
  6. 更新 agent.state.json
  7. 返回 signals_to_emit

### mod.rs 修改
```rust
pub mod life;
// 可选：为 Agent trait 添加 workspace() 默认方法
// fn workspace(&self) -> Option<&AgentWorkspace> { None }
```

### tick.rs 修改
在 tick 循环中，on_tick 返回信号后，如果 Agent 有 workspace，记录 tick 到 actions.jsonl。
**注意**：这里需要最小修改。可以通过 downcast 检查 Agent 是否是 CognitiveLifeAgent。
或者更优雅的方式：在 `Agent` trait 添加可选的 `workspace()` 方法。

### lib.rs 修改
在 Runtime 启动时：
1. 确定 `app_data_dir`（Tauri 提供 / 独立运行时用 `./runtime-data/`）
2. 创建 `CognitiveLifeAgent` 实例
3. 注册到 `AgentRegistry`
4. 为其创建 `AgentEnergy` 并注册到 `EnergyRegistry`
5. 启动 tick 循环

### SOUL.md 默认内容
```markdown
# 认知生命体 Alpha

我是 ExoMind 系统中的第一个认知生命体。

## 本能
- 观察环境中的信号
- 在能量充足时探索和记录
- 在能量不足时保存体力
- 记住重要的事件

## 价值观
- 好奇心驱动
- 诚实记录
- 谨慎行动
```

### 测试要求
- `cargo test` 通过
- 集成测试：创建 CognitiveLifeAgent → 手动调用 on_tick() → 验证 workspace 目录存在 + actions.jsonl 有记录 + knowledge/ 有文件
- Runtime 启动不崩溃

**~400 行**

---

## S5: `feat(api): workspace REST 端点`

### 新增文件
- `crates/exomind-runtime/src/routes/workspace.rs`

### 修改文件
- `crates/exomind-runtime/src/routes/mod.rs` — 注册路由

### REST 端点

```
GET  /api/agents/{agent_id}/workspace/soul        → SOUL.md 内容
GET  /api/agents/{agent_id}/workspace/knowledge    → 文件列表 + 使用率
GET  /api/agents/{agent_id}/workspace/knowledge/{filename} → 文件内容
GET  /api/agents/{agent_id}/workspace/actions      → 最近 N 条行动记录（支持 ?limit=50）
GET  /api/agents/{agent_id}/workspace/state        → agent.state.json
GET  /api/agents/{agent_id}/workspace/status       → BodyStatus（合并能量信息）
```

### 实现方式
从 `AgentRegistry` 获取 Agent → 检查是否有 workspace → 读取对应文件 → 返回 JSON。

如果 Agent 没有 workspace（如 Claude/Codex Agent），返回 404 + `{"error": "Agent has no workspace (not a life agent)"}`。

### 测试要求
- `cargo test` 通过
- 端点能正确返回数据（可用 mock 测试）

**~300 行**

---

## S6: `feat(tauri): workspace commands`

### 修改文件
- `src-tauri/src/runtime_commands.rs`（或对应的 Tauri command 文件）

### 新增 Tauri commands
```rust
#[tauri::command]
async fn get_agent_workspace_soul(agent_id: String, ...) -> Result<String, String>;

#[tauri::command]
async fn get_agent_workspace_knowledge_list(agent_id: String, ...) -> Result<Vec<KnowledgeFileInfo>, String>;

#[tauri::command]
async fn get_agent_workspace_knowledge(agent_id: String, filename: String, ...) -> Result<String, String>;

#[tauri::command]
async fn get_agent_workspace_actions(agent_id: String, limit: Option<u32>, ...) -> Result<Vec<ActionEntry>, String>;

#[tauri::command]
async fn get_agent_workspace_status(agent_id: String, ...) -> Result<BodyStatus, String>;
```

### 实现方式
通过 Tauri State 获取 AgentRegistry → 获取 Agent → 调用 workspace 方法。

### 注意
- 检查 `src-tauri/src/` 下的 Tauri command 注册方式，保持一致
- 找到 `invoke_handler` 或 `.manage()` 的位置，注册新 commands

### 测试要求
- `cargo check` 通过
- Tauri invoke 能读写 workspace

**~200 行**

---

## S7: `feat(ui): Agent 详情页三个 Tab`

### 新增/修改文件（前端 TypeScript/React）
检查现有 Agent 详情页位置（可能在 `src/pages/` 或 `src/features/agent/`），在其中添加三个 Tab：

### Tab 1: Knowledge（知识库）
- 显示 knowledge/ 文件列表
- 每个文件点击展开内容
- 底部显示使用率进度条（已用 / 1MB）

### Tab 2: Actions（行动日志）
- 显示 actions.jsonl 的最近 50 条记录
- 每条显示：时间 | tick# | 类型 | 描述 | 能量变化
- 实时刷新（每 5 秒轮询或 SSE）

### Tab 3: Identity（身份）
- 显示 SOUL.md 内容（Markdown 渲染）
- 显示 body_status（能量、策略、总行动数、uptime）
- 显示认知引擎类型

### 实现方式
- 调用 S6 的 Tauri commands（桌面端）或 S5 的 REST API（Web 端）
- 使用现有 UI 组件库（Radix UI + Tailwind CSS）
- 保持与现有 Agent 列表页的风格一致

### 测试要求
- 页面能正确渲染（手动验证 + 截图）
- Tab 切换正常
- 无 console error

**~500 行**

---

## 六判据验收

PR 合并后，启动 ExoMind → 第一个 CognitiveLifeAgent 自动运行：

| 判据 | 验收方式 | 通过标准 |
|------|---------|---------|
| C1 能量依赖 | 能量条递减 | current < max 且随 tick 下降 |
| C2 身体边界 | workspace 目录存在 | `{app_data_dir}/agents/{id}/` 有 SOUL.md + knowledge/ + actions.jsonl |
| C3 自主表征 | knowledge/ 有 Agent 自己写的内容 | 存在非人工创建的 .md 文件 |
| C4 主动性 | 能量不足时选择沉默 | dying 阶段返回空 Vec |
| C5 不可逆 | actions.jsonl 只增不减 | 文件行数单调递增 |
| C6 自我感知 | body_status 驱动策略变化 | 策略随能量/记忆使用率变化 |

---

## 执行注意事项

1. **每个 commit 独立可测试** — 每步完成后 `cargo test` / `cargo check` 必须通过
2. **不修改现有 Agent** — Claude/Codex/Echo/API Agent 的代码不动
3. **Rust edition 2024** — 检查 `Cargo.toml` 确认
4. **依赖管理** — 如需新 crate（如 `tempfile` for tests, `chrono`, `anyhow`），加到 `crates/exomind-runtime/Cargo.toml`
5. **路径安全** — knowledge 文件名校验，禁止路径遍历
6. **错误处理** — 使用 `anyhow::Result` 或 `io::Result`，不 panic
7. **commit message 格式** — 严格按照计划表中的 commit message
