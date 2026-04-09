# ExoMind Agent Runtime 统一基础对象模型

> **版本**: v0.1-draft  
> **日期**: 2026-04-09  
> **状态**: 待评审（review pending，待评审）  
> **文档类型**: architecture / spec（架构规格）  
> **定位**: 定义 ExoMind 在 `Signal Network（信号网络）` 视角下的 Agent 运行时统一对象模型，收口 `runtime agent / PTY terminal / future ACP / native API agent` 的共同抽象、身份规则、预算规则、权限规则与恢复语义。  
> **关联**:
> - [Agent Workbench 共享工作图谱架构规格](/D:/project/exomind/docs/architecture/agent-workbench-shared-graph-spec.md)
> - [Codex Workbench Unification Implementation Plan](/D:/project/exomind/docs/plans/2026-04-09-codex-workbench-unification-plan.md)
> - [ExoMind AI Context](/D:/project/exomind/docs/AI-CONTEXT.md)

---

## 0. 文档契约

### 0.1 这份文档回答什么

这份文档回答的是：

1. 为什么 `runtime agent` 和 `PTY terminal agent` 不能简单合成一个类
2. ExoMind 在运行时层应该统一哪些对象，不统一哪些对象
3. `Node / Actor / Agent / Session / Context / Memory / Workspace` 的边界是什么
4. `Binding / Attachment / Surface` 如何把同一会话接到不同运行时和不同视图
5. `em_session_id / provider session / attachment id / resume locator` 的身份模型应该怎样分层
6. `Budget / Permission / Capability / Lease / Telemetry / Profile` 为什么必须是横切系统
7. `Model policy belongs to Agent, active model belongs to Session` 应如何落成正式规则

### 0.2 这份文档不回答什么

这份文档不回答：

1. 具体 UI 像素稿与设置页视觉稿
2. 向量数据库、文件夹、外部数据库等长期记忆实现细节
3. ACP 全量映射规范的逐字段 SDK 细节
4. 每种 provider 的最终命令行参数表
5. 多 Agent 自繁殖、自复制、治理系统的完整协议

### 0.3 术语约定

1. 下文统一使用 `em_session_id` 表示 ExoMind 内部稳定会话主键
2. 下文中的 `provider session` 指外部 provider/runtime 自己的会话标识，允许漂移
3. 下文中的 `attachment` 指一次实时附着实例，不承担持久身份
4. 下文中的 `Context` 明确表示 `working memory（工作记忆）`
5. 下文中的 `Memory` 明确表示 `long-term memory（长期记忆）`

---

## 1. 核心架构判断

### 1.1 统一实现，不等于单一 I/O 形态

本轮重构的目标不是：

- 只保留一种 Agent 接入方式
- 只保留一种终端表现形式
- 把 `runtime agent` 和 `PTY terminal` 强行揉成单类

真正目标是：

> 用一套稳定的内部对象模型，统一承载多种运行绑定（binding，绑定）与多种呈现面（surface，呈现面），让同一个 `Session（会话）` 能在终端态和结构化态之间切换、恢复、重连、审计与调度。

### 1.2 为什么 `runtime agent` 和 `PTY terminal agent` 不能直接合并

两者所在层级不同：

1. `runtime agent`
   - 更像 `structured runtime adapter（结构化运行适配器）`
   - 直接理解 provider 的结构化事件、工具调用、模型状态、使用量与恢复语义
2. `PTY terminal agent`
   - 更像 `terminal process host（终端进程宿主）`
   - 负责 PTY 进程拉起、字节流转发、scrollback、transcript、stdin/stdout、终端恢复

因此应统一的是：

- `Session Kernel（会话内核）`
- `Identity Model（身份模型）`
- `Canonical Event Contract（规范事件契约）`
- `Budget / Permission / Capability / Lease / Telemetry`

而不是强制统一成同一种 transport（传输）或 renderer（渲染器）。

### 1.3 两条总原则

1. `Session is durable, Attachment is ephemeral`
   - 会话持久，附着瞬时
2. `Binding decides how to run, Surface decides how to see`
   - 绑定决定怎么运行，呈现面决定怎么观察与交互

---

## 2. 一级核心对象

本规格收口为 10 个一级核心对象。

### 2.1 `Node（节点）`

`Node` 是信号网络中的可寻址对象。

职责：

- 提供稳定地址
- 暴露能力声明
- 参与图谱关系
- 挂接配置画像（profile，配置画像）

`Node` 不一定执行，也不等于进程、线程、窗口或组件实例。

### 2.2 `Actor（执行体）`

`Actor` 是可运行的节点实例。

职责：

- 拥有生命周期
- 拥有邮箱（mailbox，消息箱）
- 被调度、被监督
- 受本地资源预算约束
- 受底层权限隔离约束

`Actor` 关心的是“能不能跑、在哪跑、占多少资源、能访问什么系统边界”。

### 2.3 `Agent（认知执行体）`

`Agent` 是具备认知契约的 `Actor`。

职责：

- 持有默认模型策略
- 持有认知预算
- 持有工具策略
- 持有高层权限策略
- 可以调度模型、规划、压缩、总结、调用工具

一句话：

> `Actor` 解决“能不能执行”，`Agent` 解决“能不能思考与决策”。

### 2.4 `Session（会话）`

`Session` 是持久语义线程。

职责：

- 表示一段持续的任务/对话线程
- 持有稳定主键 `em_session_id`
- 引用当前激活的 `Context`
- 挂接当前 `Binding / Attachment / Surface / Lease`
- 记录 turn、模型状态、恢复关系、事件历史

`Session` 不等于：

- provider session id
- 终端窗口 id
- 当前活跃连接句柄

### 2.5 `Context（工作记忆）`

`Context` 是 `working memory（工作记忆）`，是一级核心对象。

职责：

- 承载当前任务正在使用的上下文语义
- 支持压缩、规划、总结、分叉、恢复
- 支持长度统计与预算联动
- 跨 provider、跨模型复用

`Context` 的版本化产物是 `ContextSnapshot（上下文快照）`。

### 2.6 `Memory（长期记忆）`

`Memory` 是 `long-term memory（长期记忆）`。

职责：

- 承载超出当前 `Context` 生命周期的长期知识与记忆基底
- 可以由文件夹、数据库、向量库、外部接口等不同 substrate（存储基底）实现
- 对 `Agent` 暴露统一的长期记忆能力接口

第一版不强制细分 Memory 子类型，但允许保留类型字段以支持后续扩展。

### 2.7 `Workspace（工作区）`

`Workspace` 是执行环境对象，不等于单一路径。

职责：

- 声明运行目录集合
- 关联多个仓库、分支、worktree、issue、PR
- 管理环境、挂载、写入边界、工具链配置
- 为 `Actor` 提供运行场所与执行边界

`Workspace` 允许多仓库、多分支、多项目组合。

### 2.8 `Binding（绑定）`

`Binding` 是 `Session` 接入外部运行时的适配层。

第一阶段至少支持：

- `pty binding`
- `acp binding`
- `provider-json binding`
- `native-api binding`

`Binding` 解决的是：

- 这段会话如何接到某个 runtime/provider
- 如何启动、恢复、继续、结束
- 如何把 provider-specific（提供商特有）语义映射到内部规范语义

### 2.9 `Attachment（附着实例）`

`Attachment` 是某次实时附着实例。

示例：

- `pty_id`
- 一次 streaming handle
- 一次 websocket control channel
- 一次 runtime process handle

`Attachment` 的特点：

- 短生命周期
- 可失效、可替换
- 可并存多个观察者
- 不承担持久身份

### 2.10 `Surface（呈现面）`

`Surface` 是用户如何看和控这段会话。

第一阶段至少支持：

- `terminal surface`
- `structured surface`
- `hybrid surface`

`Surface` 需要 `surface_id`，因为：

- 多窗口、多端接管需要区分观察者
- 同一 `Attachment` 可能被多个 `Surface` 观察
- 交互控制权需要和 `Lease` 联动

---

## 3. 四类最容易混淆的对象边界

### 3.1 `Session` 与 `Context`

- `Session` 是“这次连续任务/对话线程是什么”
- `Context` 是“这次线程当前正在使用的工作记忆是什么”

一个 `Session` 在任意时刻只激活一个 `Context`，但同一个 `Context` 可以被多个 `Session` 复用。

### 3.2 `Context` 与 `Memory`

- `Context = working memory`
- `Memory = long-term memory`

`Context` 强调当前任务活跃内容，`Memory` 强调跨会话长期持久知识。

### 3.3 `Actor` 与 `Workspace`

- `Actor` 是执行体
- `Workspace` 是执行环境

推荐关系：

- `Actor` 绑定 `Workspace`
- `Agent` 挂接 `Memory`
- `Session` 激活 `Context`

### 3.4 `Binding`、`Attachment` 与 `Surface`

- `Binding` 负责接入外部运行时
- `Attachment` 负责某次实时附着
- `Surface` 负责观察与交互

三者不是一一对应关系。

---

## 4. 身份模型（Identity Model，身份模型）

### 4.1 基本原则

1. `em_session_id` 是内部唯一稳定主键
2. `provider session` 是外部身份，允许漂移
3. `attachment_id` 是实时附着句柄，不承担持久身份
4. `resume` 恢复的是 `Session`，不是某个旧的 terminal/attachment 实例

### 4.2 第一版核心身份字段

```ts
type ProviderSessionRef = {
  provider: string;
  provider_session_id: string;
  state?: 'active' | 'stale' | 'superseded' | 'failed';
  binding_id?: string;
  attached_at?: number;
  detached_at?: number;
  resume_locator?: string;
  metadata?: Record<string, unknown>;
};

type SessionIdentity = {
  em_session_id: string;
  provider_session_refs: ProviderSessionRef[];
  attachment_ids: string[];
  workdir_fingerprint?: string;
};
```

第一版不引入 `agent_session_id` 作为核心字段。

### 4.3 `resume` 的统一语义

统一语义如下：

1. 用户请求恢复某个 `em_session_id`
2. `Session Kernel` 读取该 session 的 binding history（绑定历史）
3. 选择当前最优 `Binding`
4. `Binding` 解析可用的 `provider_session_ref / resume_locator`
5. 创建新的 `attachment_id`
6. 新 attachment 附着到旧 session
7. `Surface` 订阅新的 attachment 流

这保证了“恢复会话”和“恢复旧终端句柄”是两件不同的事。

---

## 5. Budget（预算系统）

### 5.1 总原则

`Budget（预算）` 与 `Telemetry（遥测）` 必须分离：

- `budget_limit` 表示允许花多少
- `budget_usage` 表示当前已经花了多少

### 5.2 `ActorBudget`

`ActorBudget` 面向本地资源：

```ts
type ActorBudgetLimit = {
  cpu_percent?: number;
  cpu_time_ms?: number;
  memory_mb?: number;
  disk_mb?: number;
  io_read_mb?: number;
  io_write_mb?: number;
  network_in_mb?: number;
  network_out_mb?: number;
  process_limit?: number;
  fd_limit?: number;
};
```

### 5.3 `AgentBudget`

`AgentBudget` 面向认知与资金：

```ts
type AgentBudgetLimit = {
  context_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  planning_tokens?: number;
  compression_tokens?: number;
  tool_call_count?: number;
  tool_cost_cny?: number;
  model_cost_cny?: number;
  total_cost_cny?: number;
  rate_limit_per_min?: number;
};
```

### 5.4 预算归属

- `ActorBudget` 归 `Actor`
- `AgentBudget` 归 `Agent`
- `Session` 可以看到当前使用量与预算告警，但不拥有长期默认预算策略

---

## 6. Permission（权限系统）

### 6.1 双层权限系统

ExoMind 采用两层权限系统：

1. `ActorPermissionPolicy`
   - 底层系统/运行时/沙箱权限
2. `AgentPermissionPolicy`
   - 高层认知、工具、升级、生成对象的决策权限

### 6.2 继承与覆盖规则

推荐继承链：

`Node default -> Actor override -> Agent override -> Session override -> Turn override`

后层允许覆盖前层，但不能突破底层硬限制。

### 6.3 示例

```ts
type ActorPermissionPolicy = {
  filesystem?: 'none' | 'read' | 'workspace_write' | 'full';
  process_spawn?: 'deny' | 'allow';
  network?: 'deny' | 'allow';
  device?: 'deny' | 'allow';
  secret_access?: 'deny' | 'allow';
};

type AgentPermissionPolicy = {
  tool_use?: 'deny' | 'ask' | 'allow';
  model_escalation?: 'deny' | 'ask' | 'allow';
  budget_reallocation?: 'deny' | 'ask' | 'allow';
  session_resume?: 'deny' | 'ask' | 'allow';
  actor_creation?: 'deny' | 'ask' | 'allow';
  node_creation?: 'deny' | 'ask' | 'allow';
};
```

---

## 7. Model（模型）归属规则

### 7.1 正式规则

> `Model policy belongs to Agent, active model belongs to Session.`  
> 模型策略属于 `Agent`，当前激活模型属于 `Session`。

### 7.2 `Agent` 持有默认模型策略

```ts
type AgentModelPolicy = {
  default_model?: string;
  allowed_models?: string[];
  routing_mode?: 'fixed' | 'adaptive';
  fallback_models?: string[];
  escalation_policy?: 'manual' | 'budget_based' | 'quality_based';
};
```

### 7.3 `Session` 持有当前激活模型状态

```ts
type SessionModelState = {
  preferred_model?: string;
  active_model?: string;
  model_locked?: boolean;
  switched_at?: number;
  switch_reason?: string;
};
```

### 7.4 动态路由能力

`Agent` 必须允许保留动态切模接口，即：

- 默认有一个首选模型
- 当前对话通常只有一个 `active_model`
- 当预算、能力、延迟、质量等条件变化时，允许切换模型

---

## 8. 横切系统

### 8.1 `Capability（能力声明）`

`Capability` 说明某个对象或绑定支持什么。

示例：

- `resume`
- `structured_events`
- `terminal_stream`
- `tool_calls`
- `usage_report`
- `permission_request`
- `model_switch`
- `quota_report`

推荐同时保留：

- `declared_capabilities`
- `runtime_capabilities`

### 8.2 `Lease（租约）`

`Lease` 解决控制权问题。

第一版最小版即可：

```ts
type Lease = {
  lease_id: string;
  holder_surface_id?: string;
  mode: 'readonly' | 'interactive';
  holder?: string;
  expires_at?: number;
};
```

### 8.3 `TelemetrySnapshot（遥测快照）`

`TelemetrySnapshot` 记录实时消耗值，不等于预算上限。

建议至少包含：

- CPU 使用率
- CPU 时间
- 内存
- 磁盘
- IO
- 网络
- token 使用量
- 人民币花费
- 工具调用次数

### 8.4 `Profile（配置画像）`

每类对象都可能拥有自己的配置画像或设置页，但 `Profile` 不作为一级运行时核心对象，而作为控制面系统存在。

可支持：

- `NodeProfile`
- `ActorProfile`
- `AgentProfile`
- `WorkspaceProfile`
- `SurfaceProfile`

---

## 9. Context / Memory / Workspace 的数据语义

### 9.1 `Context`

推荐最小结构：

```ts
type Context = {
  em_context_id: string;
  active_snapshot_id?: string;
  metadata?: Record<string, unknown>;
};
```

```ts
type ContextSnapshot = {
  snapshot_id: string;
  em_context_id: string;
  parent_snapshot_id?: string;
  size?: {
    chars?: number;
    tokens?: number;
    bytes?: number;
  };
  summary?: string;
  compression_state?: 'raw' | 'compressed' | 'planned' | 'branched';
};
```

### 9.2 `Memory`

推荐最小结构：

```ts
type Memory = {
  em_memory_id: string;
  kind?: string;
  store_ref?: string;
  root_path?: string;
  metadata?: Record<string, unknown>;
};
```

`Memory` 可以由文件夹、数据库、向量库或其他外部接口承载。

### 9.3 `Workspace`

推荐最小结构：

```ts
type RepoRef = {
  repo_id?: string;
  root_path: string;
  branch?: string;
  worktree_path?: string;
};

type Workspace = {
  em_workspace_id: string;
  name?: string;
  root_paths?: string[];
  repos?: RepoRef[];
  branches?: string[];
  issue_refs?: string[];
  pr_refs?: string[];
  mounts?: string[];
  env_profile_id?: string;
  settings_profile_id?: string;
  metadata?: Record<string, unknown>;
};
```

`Workspace` 允许：

- 多目录
- 多仓库
- 多分支
- 多 issue / PR 关联

---

## 10. Canonical Event（规范事件）

### 10.1 和 `EventTape` 的关系

沿用现有架构主张：

> `EventTape（事件带）` 仍是事实源。  
> `Canonical Event` 是 `Session Kernel` 对外提供的稳定语义接口。

也就是说：

- 原始 terminal/agent/provider 流要可追溯保留
- 规范事件层负责稳定 UI、调度、恢复、预算、权限语义
- 新旧实现之间必须保留 traceability（可追踪映射）

### 10.2 第一版最小事件族

- `session.created`
- `session.renamed`
- `session.resumed`
- `binding.attached`
- `binding.detached`
- `attachment.created`
- `attachment.closed`
- `turn.started`
- `turn.completed`
- `message.text`
- `message.thinking`
- `tool.call.started`
- `tool.call.updated`
- `tool.call.completed`
- `permission.requested`
- `permission.resolved`
- `usage.updated`
- `budget.alerted`
- `mode.updated`
- `model.updated`
- `terminal.chunk`
- `artifact.created`
- `error.raised`
- `context.created`
- `context.snapshot.created`
- `context.compressed`
- `context.planned`
- `context.forked`
- `context.restored`
- `context.length.updated`

---

## 11. ExoMind 现有实现的映射建议

### 11.1 `runtime agent`

映射为：

- `Binding = provider-json binding`
- `Attachment = current runtime stream/process handle`
- `Surface = structured surface` 或 `hybrid surface`

### 11.2 `PTY terminal`

映射为：

- `Binding = pty binding`
- `Attachment = pty_id`
- `Surface = terminal surface`

### 11.3 `future ACP`

映射为：

- `Binding = acp binding`
- `Attachment = ACP live channel / session handle`
- `Surface = structured surface` 或 `hybrid surface`

### 11.4 `native API agent`

映射为：

- `Binding = native-api binding`
- `Attachment = local API runtime handle`
- `Surface = structured surface`

---

## 12. 第一版落地范围

### 12.1 第一版必须落地

1. 一级对象边界
2. `em_session_id` 与 `provider_session_ref` 分层
3. `Context` 升格为一级对象
4. `Memory` 与 `Workspace` 升格为一级对象
5. `Budget / Permission / Capability / Lease / Telemetry / Profile` 作为横切系统入模
6. `Model policy belongs to Agent, active model belongs to Session`
7. `resume` 的统一语义

### 12.2 第一版明确不做重实现

1. 不要求立即消灭所有旧 runtime / PTY 路径
2. 不要求立即完成 ACP 全量接入
3. 不要求立即完成长期记忆具体存储后端
4. 不要求立即完成所有设置页 schema 设计
5. 不要求立即完成多 Agent 自繁殖/治理协议

---

## 13. 最终收口

这套统一对象模型的核心，不是“把所有 Agent 都做成一个类”，而是：

1. 让 `Node / Actor / Agent` 成为信号网络执行层级
2. 让 `Session / Context / Memory / Workspace` 成为认知与工作对象层
3. 让 `Binding / Attachment / Surface` 成为接入与呈现层
4. 让 `Budget / Permission / Capability / Lease / Telemetry / Profile` 成为横切系统
5. 让 `Canonical Event` 成为统一语义接口，而 `EventTape` 继续保留事实源地位

一句话总结：

> ExoMind 要统一的不是某一种 CLI，也不是某一种 UI，而是 `Session Kernel（会话内核）` 与 `Signal-Native Runtime Object Model（信号原生运行时对象模型）`。
