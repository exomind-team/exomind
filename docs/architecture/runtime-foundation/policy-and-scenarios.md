# 预算、权限、模型、场景与实施

[返回《Agent Runtime 统一基础对象模型》](../agent-runtime-unified-foundation-spec.md)

## 8. Budget（预算系统）

### 8.1 总原则

`Budget（预算）` 与 `Telemetry（遥测）` 必须分离：

- `budget_limit` 表示允许花多少
- `budget_usage` 表示当前已经花了多少

### 8.2 `ActorBudget`

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

### 8.3 `AgentBudget`

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

### 8.4 预算归属

- `ActorBudget` 归 `Actor`
- `AgentBudget` 归 `Agent`
- `Session` 可以看到当前使用量与预算告警，但不拥有长期默认预算策略

---

## 9. Permission（权限系统）

### 9.1 双层权限系统

ExoMind 采用两层权限系统：

1. `ActorPermissionPolicy`
   - 底层系统/运行时/沙箱权限
2. `AgentPermissionPolicy`
   - 高层认知、工具、升级、生成对象的决策权限

### 9.2 继承与覆盖规则

推荐继承链：

`Node default -> Actor override -> Agent override -> Session override -> Turn override`

后层允许覆盖前层，但不能突破底层硬限制。

### 9.3 示例

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

## 10. Model（模型）归属规则

### 10.1 正式规则

> `Model policy belongs to Agent, active model belongs to Session.`  
> 模型策略属于 `Agent`，当前激活模型属于 `Session`。

### 10.2 `Agent` 持有默认模型策略

```ts
type AgentModelPolicy = {
  default_model?: string;
  allowed_models?: string[];
  routing_mode?: 'fixed' | 'adaptive';
  fallback_models?: string[];
  escalation_policy?: 'manual' | 'budget_based' | 'quality_based';
};
```

### 10.3 `Session` 持有当前激活模型状态

```ts
type SessionModelState = {
  preferred_model?: string;
  active_model?: string;
  model_locked?: boolean;
  switched_at?: number;
  switch_reason?: string;
};
```

### 10.4 动态路由能力

`Agent` 必须允许保留动态切模接口，即：

- 默认有一个首选模型
- 当前对话通常只有一个 `active_model`
- 当预算、能力、延迟、质量等条件变化时，允许切换模型

---

## 11. 横切系统

### 11.1 `Capability（能力声明）`

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

在设备与宿主场景里，建议把能力至少分成 3 层：

1. `DeviceCapability（设备能力）`
   - 偏具身
   - 回答“这个现实载体能感知什么、作用什么、是否贴近身体”
2. `RuntimeHostCapability（宿主能力）`
   - 偏算力与运行承载
   - 回答“这台宿主能运行什么、能承载什么超系统”
3. `NodeCapability（节点能力）`
   - 偏信号网络
   - 回答“这个节点暴露什么端口、支持什么协议、能参与什么连接”

### 11.1.1 `DeviceCapability` 与 `RuntimeHostCapability` 的分层

推荐边界如下：

1. `DeviceCapability`
   - 传感器
   - 执行器
   - 移动能力
   - 供电 / 电池
   - 位置 / 空间部署
   - 身体关系（body relation，身体关系）
2. `RuntimeHostCapability`
   - CPU / GPU / RAM / 存储 / 网络
   - 指令集架构（instruction set architecture，指令集架构）
   - OS / container / sandbox / shell / PTY
   - 本地模型运行时
   - provider adapter（提供商适配器）
   - agent kind support（Agent 类型支持）

推荐理解：

- `DeviceCapability` 描述“身体与环境接口”
- `RuntimeHostCapability` 描述“计算与执行超系统接口”

### 11.1.2 身体相关 vs 身体无关的设备能力

对于 `DeviceCapability`，建议再加一个轻量区分：

1. `body_related`
   - 手机
   - 手表
   - 耳机
   - 可穿戴设备
   - 生理传感器
2. `body_external`
   - 桌面电脑
   - 房间摄像头
   - 智能音箱
   - 小车
   - 机械臂
   - 环境传感器

也就是说：

- 一类设备更贴近人的身体与生理状态
- 一类设备更贴近环境、空间、基础设施或外部执行

这个区分应归 `Device`，不归 `RuntimeHost`。

### 11.1.3 `RuntimeHostCapability` 推荐最小结构

```ts
type RuntimeHostCapability = {
  compute?: {
    cpu_arch?: string;
    instruction_sets?: string[];
    logical_cores?: number;
    ram_mb?: number;
    gpu_kinds?: string[];
    accelerator_kinds?: string[];
  };
  execution_supersystem?: {
    shell?: boolean;
    pty?: boolean;
    sandbox?: boolean;
    container?: boolean;
    browser_automation?: boolean;
    native_api_runtime?: boolean;
    local_model_runtime?: string[];
  };
  agent_runtime_support?: {
    supported_agent_kinds?: string[];
    provider_adapters?: string[];
    acp?: boolean;
  };
  storage?: {
    disk_mb?: number;
    persistent_workspace?: boolean;
  };
  network?: {
    reachable_modes?: string[];
    relay_capable?: boolean;
  };
};
```

这里的 `execution_supersystem` 用来表达你说的“超系统能力”。

正式建议：

> `agent kind support` 不是单纯的业务层枚举，而是宿主底层执行超系统是否具备对应支撑条件的结果摘要。

### 11.2 `Lease（租约）`

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

### 11.3 `TelemetrySnapshot（遥测快照）`

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

### 11.4 `Profile（配置画像）`

每类对象都可能拥有自己的配置画像或设置页，但 `Profile` 不作为一级运行时核心对象，而作为控制面系统存在。

可支持：

- `NodeProfile`
- `ActorProfile`
- `AgentProfile`
- `WorkspaceProfile`
- `SurfaceProfile`

每个 `Actor` 或 `Agent` 都可以拥有自己的设置页，但设置页壳不需要为每个节点手写一套 UI。  
推荐做法是：使用统一模板壳，由 `ProfileSchema（配置画像 schema）` 驱动具体设置项生成。

---

## 12. Context / Memory / Workspace 的数据语义

### 12.1 `Context`

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

### 12.2 `Memory`

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

### 12.3 `Workspace`

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

## 13. 典型场景映射

### 13.1 时间块停止/结束后的认知处理

推荐链路：

1. 用户点击「停止时间块」→ `TimeBlockActor` 发布 `timeblock.replication.completed`
2. `timeblock_summary` Agent 收到信号，生成结束总结
3. 用户填写反馈 → 点击「提交」→ `TimeBlockActor` 发布 `timeblock.block_feedback.created`
4. `timeblock_summary` Agent 收到信号，生成用户反馈核验

**时间块生命周期**：
- 时间块开始 → 时间块暂停 → 时间块继续/恢复 → 时间块停止 → 用户发反馈 → 时间块结束
- **时间块停止**：专注过程结束，进入复盘总结反馈环节
- **时间块结束**：用户反馈结束，正式标记时间块范围终止

这里的认知处理对象应明确建模为 `Agent`，不与 `Actor` 混名。

### 13.2 任务系统

推荐拆分：

- 任务 CRUD / 持久化 / 关联更新 更适合 `TaskManagerActor`
- 规划、拆解、排序、复盘 更适合专门的 `Agent`

### 13.3 记账 / 财务

推荐拆分：

- 凭证接收、账本写入、预算检查 适合 `Actor`
- 模糊分类、异常分析、月度总结 适合 `Agent`

### 13.4 外部消息与订阅

像以下对象都天然适合 `Actor`：

- 微信消息接收/发送
- 飞书消息接收/发送
- RSS 拉取
- Webhook 接收
- 通知推送

因为它们通常：

- 持有长期资源
- 有独立生命周期
- 有明确输入/输出
- 需要被多个地方复用

### 13.5 多设备信号网络的全局视图

当 ExoMind 扩展到多设备、多宿主、多具身对象时，推荐采用如下全局视图：

```text
                         Signal Network（信号网络）

   [Cloud RuntimeHost]
       ├─ ResearchAgent
       ├─ SyncActor
       └─ SchedulerAgent
                │
                │ Connection
                │
   [Laptop Device] -- DeviceLink(WiFi) -- [Robot Car Device]
       ├─ Local RuntimeHost                 ├─ Onboard RuntimeHost
       ├─ ReviewAgent                       ├─ NavigationAgent
       ├─ EventLogActor                     ├─ MotorDriverActor
       └─ MicComponent                      ├─ CameraDriverActor
                                            ├─ WheelComponent
                                            └─ CameraComponent
```

这张图里有三层关系：

1. `Device / RuntimeHost / DeviceComponent`
   - 描述现实载体、宿主与内部部件
2. `Actor / Agent / Port / Connection`
   - 描述信号网络中的执行、认知与编排
3. `DeviceLink`
   - 描述设备与宿主之间如何真正连通

正式建议：

> 多个设备可以组成一张 ExoMind 信号网络。  
> 但它们不是靠“设备对象直接互连”完成协作，而是通过宿主、绑定、端口和连接，把现实世界投影进信号网络。

### 13.6 机器人 / 小车 / 云主机 的统一设计

要同时支持硬件小车、手机、桌面端、云服务器，推荐统一方式如下：

1. 对硬件侧
   - 用 `Device + DeviceComponent + DeviceLink`
   - 把轮子、电机、摄像头、麦克风、GPS 等建模为设备部件
   - 需要治理时，再升格为 `Actor`
2. 对运行时侧
   - 用 `RuntimeHost`
   - 统一承载 CPU / GPU / RAM / 存储 / OS / agent kind / dial address / host_id
3. 对执行与认知侧
   - 用 `Actor / Agent`
   - 所有自动化链路、认知链路、技能沉淀都进这一层

于是：

- 小车能接入，因为它有 `Device`、`DeviceComponent`、可能还有板载 `RuntimeHost`
- 云服务器能接入，因为它天然就是 `RuntimeHost`
- 两者都能进入同一张信号网络，因为最终都通过 `Actor / Agent / Port / Connection` 暴露统一接口

推荐一句话收口：

> `Device` 负责具身，`RuntimeHost` 负责承载，`Actor` 负责执行，`Agent` 负责认知，`Connection` 负责信号编排，`DeviceLink` 负责真实连通。

### 13.7 跨宿主连接与 relay（中继）语义

跨宿主时，正式推荐优先级如下：

1. 能直接连，就直接连
2. 直连失败，再走 relay（中继）
3. relay 默认属于底层通信 / mesh 能力，不默认建模为业务 `Actor`

原因是：

- relay 的首要职责是让链路可达
- 它更接近 ECS-2 / ECS-3 的承载与组网能力
- 如果默认把 relay 做成 `Actor`，容易把“网络基础设施”误当成“业务执行体”

但同时，relay 不应该完全隐形。  
正式建议是：

1. 在主信号拓扑图里
   - 默认不把 relay 展示成普通 `Actor`
2. 在设备网络视图 / 诊断视图 / trace 视图里
   - 要显式展示 relay hop（中继跳点）、relay path（中继路径）、失败原因、延迟贡献
3. 如果某个 relay 是人为部署、可治理、可运维的专门网关
   - 可以把它表示为一个带 `relay_gateway` 角色的 `RuntimeHost`
   - 但仍不推荐把它默认当业务 `Actor`

一句话：

> relay 默认是“底层可见能力”，不是“主业务图上的默认 Actor”；  
> 但它必须在网络视图和链路追踪里被显化出来。

### 13.8 两张视图，一张底层网

产品面推荐拆成两张主视图，但底层数据仍是一张统一网络：

1. `Device Network View（设备网络视图）`
   - 关注 `Device / RuntimeHost / DeviceLink / relay path`
   - 适合看设备、宿主、链路、配对、网络诊断
2. `Signal Topology View（信号拓扑视图）`
   - 关注 `Node / Port / Connection / Actor / Agent / Session`
   - 适合看执行链路、认知链路、自动化编排

两张图的关系应是：

- 不重复造两份数据
- 共享 `DeviceId / HostId / NodeId`
- 支持互相跳转和聚焦

推荐原则：

> 人看两张图，系统底层是一张网。  
> 视图分离是为了认知负担可控，不是为了把数据模型拆裂。

---

## 14. Canonical Event（规范事件）

### 14.1 和 `EventTape` 的关系

沿用现有架构主张：

> `EventTape（事件带）` 仍是事实源。  
> `Canonical Event` 是 `Session Kernel` 对外提供的稳定语义接口。

也就是说：

- 原始 terminal/agent/provider 流要可追溯保留
- 规范事件层负责稳定 UI、调度、恢复、预算、权限语义
- 新旧实现之间必须保留 traceability（可追踪映射）

### 14.2 第一版最小事件族

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

## 15. ExoMind 现有实现的映射建议

### 15.1 `runtime agent`

映射为：

- `Binding = provider-json binding`
- `Attachment = current runtime stream/process handle`
- `Surface = structured surface` 或 `hybrid surface`

### 15.2 `PTY terminal`

映射为：

- `Binding = pty binding`
- `Attachment = pty_id`
- `Surface = terminal surface`

### 15.3 `future ACP`

映射为：

- `Binding = acp binding`
- `Attachment = ACP live channel / session handle`
- `Surface = structured surface` 或 `hybrid surface`

### 15.4 `native API agent`

映射为：

- `Binding = native-api binding`
- `Attachment = local API runtime handle`
- `Surface = structured surface`

### 15.5 ExoMind 当前设备页的建议映射

基于现有实现，当前设备页更接近：

- `RuntimeHost / peer control plane（运行时主机 / 对等体控制面）`

而不是：

- 完整的 `Device` 对象模型页

这意味着当前页面里展示的重点应理解为：

1. 哪些 `RuntimeHost` 在线
2. 哪些 peer 已发现、已配对、已验证
3. 当前宿主的能力、拨号地址、RTT、版本、内存、认证状态

而不应误解为：

1. 设备内部部件拓扑
2. 机器人器官结构
3. 完整具身对象图

因此后续产品面建议拆出：

- `Runtime Hosts / Peers` 视图
- `Devices / Components` 视图
- `Signal Topology` 视图

---

## 16. 第一版落地范围

### 16.1 第一版必须落地

1. 一级对象边界
2. `em_session_id` 与 `provider_session_ref` 分层
3. `Context` 升格为一级对象
4. `Memory` 与 `Workspace` 升格为一级对象
5. 明确 `Actor` 与 `Agent` 的严格分层
6. 明确 `Port / Connection` 的第一版规则
7. 明确“默认传信号与引用，不直传大正文”的连接原则
8. `Budget / Permission / Capability / Lease / Telemetry / Profile` 作为横切系统入模
9. `Model policy belongs to Agent, active model belongs to Session`
10. `resume` 的统一语义
11. `Device / RuntimeHost / DeviceComponent / DeviceLink` 的一级对象边界
12. “设备连通”和“信号连线”分层

### 16.2 第一版明确不做重实现

1. 不要求立即消灭所有旧 runtime / PTY 路径
2. 不要求立即完成 ACP 全量接入
3. 不要求立即完成长期记忆具体存储后端
4. 不要求立即完成所有设置页 schema 设计
5. 不要求立即完成多 Agent 自繁殖/治理协议
6. 不要求在本版就定死 `Signal` 的完整字段全集

---

## 17. 最终收口

这套统一对象模型的核心，不是“把所有 Agent 都做成一个类”，而是：

1. 让 `Node / Actor / Agent` 成为信号网络执行层级
2. 让 `Device / RuntimeHost / DeviceComponent / DeviceLink` 成为具身与承载层
3. 让 `Session / Context / Memory / Workspace` 成为认知与工作对象层
4. 让 `Binding / Attachment / Surface` 成为接入与呈现层
5. 让 `Budget / Permission / Capability / Lease / Telemetry / Profile` 成为横切系统
6. 让 `Canonical Event` 成为统一语义接口，而 `EventTape` 继续保留事实源地位

一句话总结：

> ExoMind 要统一的不是某一种 CLI，也不是某一种 UI，而是 `Session Kernel（会话内核）`、`Signal-Native Runtime Object Model（信号原生运行时对象模型）`，以及它与现实设备 / 运行时宿主之间的稳定映射关系。
