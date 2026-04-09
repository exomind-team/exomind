# ExoMind Agent Runtime 统一基础对象模型

> **版本**: v0.2-draft.2  
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
8. `Actor / Agent / Port / Connection / Signal` 在第一版应如何收口
9. `Device / RuntimeHost / DeviceComponent / DeviceLink` 应如何进入统一对象模型

### 0.2 这份文档不回答什么

这份文档不回答：

1. 具体 UI 像素稿与设置页视觉稿
2. 向量数据库、文件夹、外部数据库等长期记忆实现细节
3. ACP 全量映射规范的逐字段 SDK 细节
4. 每种 provider 的最终命令行参数表
5. 多 Agent 自繁殖、自复制、治理系统的完整协议
6. `Signal` 的最终完整字段全集与跨版本兼容协议

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

本规格收口为 14 个一级核心对象。

### 2.1 `Node（节点）`

`Node` 是信号网络中的可寻址对象。

职责：

- 提供稳定地址
- 暴露能力声明
- 参与图谱关系
- 挂接配置画像（profile，配置画像）

`Node` 不一定执行，也不等于进程、线程、窗口或组件实例。

### 2.2 `Actor（执行体）`

`Actor` 是通用执行体，是信号网络中的基础执行节点。

职责：

- 拥有生命周期
- 拥有邮箱（mailbox，消息箱）
- 持有资源引用
- 暴露输入/输出端口
- 被调度、被监督
- 受本地资源预算约束
- 受底层权限隔离约束

`Actor` 关心的是“能不能跑、在哪跑、占多少资源、能访问什么系统边界、接什么输入、产什么输出”。

`Actor` 不是：

- workflow step（工作流步骤）
- 普通函数
- 默认带大模型认知的对象

### 2.3 `Agent（认知执行体）`

`Agent` 是认知节点，是更高层的认知对象。

职责：

- 持有默认模型策略
- 持有或挂接 `Memory`
- 持有 `Context` 策略
- 持有认知预算
- 持有工具策略
- 持有高层权限策略
- 可以调度模型、规划、压缩、总结、调用工具
- 可以创建 `Actor`
- 可以建立或沉淀 `Connection`

一句话：

> `Actor` 解决“执行”，`Agent` 解决“认知与调度”。

在领域模型和产品层命名中，必须严格区分 `Actor` 和 `Agent`，不使用 `agent actor` 这种混合叫法。底层实现即使共享部分 trait / interface（接口）机制，也不改变两者在对象模型中的分层差异。

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

### 2.11 `Device（设备）`

`Device` 是具身层对象（embodiment object，具身对象），用于描述 ExoMind 接入现实世界时的设备实体。

职责：

- 描述物理或具身边界
- 描述设备级能力、健康状态、供电状态与部署位置
- 聚合多个 `DeviceComponent`
- 可选挂接一个或多个 `RuntimeHost`
- 为设备设置页、运维页、编排页提供稳定设备身份

`Device` 不自动等于信号网络里的 `Node`。  
当 `Device` 需要进入信号网络时，通常通过以下两种方式投影：

1. 投影为一个聚合控制节点，例如 `device controller actor`
2. 投影为多个部件级节点，例如摄像头、麦克风、电机、机械臂等对应的 `Actor / Port`

因此推荐原则是：

> `Device` 是现实载体，`Node` 是网络可寻址投影。两者相关，但不强制同一。

### 2.12 `RuntimeHost（运行时主机）`

`RuntimeHost` 是运行时宿主（runtime carrier，运行载体），表示某个可运行 ExoMind Runtime 的执行宿主。

职责：

- 提供 `host_id`、拨号地址、监听端口、网络可达性
- 暴露主机级能力，例如 CPU / GPU / RAM / 存储 / OS / agent kind
- 承载 `Actor / Agent / Session` 的实际运行
- 参与 mesh peer（网状对等体）发现、配对、验证、拨号与运维

`RuntimeHost` 可以存在于：

- 本地电脑
- 手机
- 嵌入式主板
- 机器人车载板
- 云服务器 / VPS
- 容器 / 虚拟机

推荐关系：

- 一个 `Device` 可以挂接零个、一个或多个 `RuntimeHost`
- 一个 `RuntimeHost` 也可以独立存在，不要求必须先有 `Device`

这意味着：

- 机器人小车通常同时有 `Device` 和板载 `RuntimeHost`
- 云服务器通常只有 `RuntimeHost`，不一定要纳入 `Device` 管理

### 2.13 `DeviceComponent（设备部件）`

`DeviceComponent` 是设备内部可识别的部件对象。

典型例子：

- 摄像头
- 麦克风
- 扬声器
- GPS
- 心率传感器
- 轮子
- 电机
- 机械臂
- LED
- 屏幕

职责：

- 描述部件类别、能力、协议、状态
- 作为 `Device` 内部的可管理部件
- 为驱动层、绑定层或 `Actor` 提供对接目标

`DeviceComponent` 默认不是 `Actor`。  
只有在满足以下条件时，才推荐把某个 `DeviceComponent` 升格为独立 `Actor`：

- 有独立生命周期
- 有独立资源预算
- 有明确输入/输出端口
- 需要被复用或被多个对象编排
- 需要独立监控、隔离、重启或治理

否则更推荐：

- `DeviceComponent` 继续作为部件对象存在
- 通过一个 `driver actor（驱动执行体）` 统一代理访问

### 2.14 `DeviceLink（设备连接）`

`DeviceLink` 是设备层 / 主机层连接对象，不是信号网络里的业务连线。

职责：

- 描述设备与设备、设备与主机、主机与主机之间的连接
- 承载配对、认证、连通性、延迟、带宽、可用性、链路状态
- 对应 BLE / WiFi / USB / Serial / CAN / ADB / WebRTC / IPC 等连接介质

推荐理解：

- `DeviceLink` 解决“链路是否存在、是否可达、质量如何”
- `Connection` 解决“哪个节点的哪个端口连到哪个节点的哪个端口”

因此：

> `DeviceLink` 属于承载层 / 设备层，`Connection` 属于信号层 / 编排层。两者必须分开。

---

## 3. `Actor` 与 `Agent` 的正式区别

### 3.1 为什么必须严格分开

如果不把 `Actor` 和 `Agent` 分开，会很快出现两个问题：

1. 把所有可执行逻辑都误升格为认知体
2. 把所有认知处理都误塞进通用执行体，导致预算、权限、Session、Context 语义混乱

因此：

- `Actor` 是丰富的、便宜的、可大量生成的执行体
- `Agent` 是稀缺的、昂贵的、需要治理的认知体

### 3.2 典型例子

更适合建模为 `Actor` 的对象：

- `WeChatGatewayActor`
- `FeishuGatewayActor`
- `RssSourceActor`
- `TaskManagerActor`
- `TimeBlockActor`
- `EventLogActor`
- `LedgerActor`

更适合建模为 `Agent` 的对象：

- 时间块总结 Agent
- 科研文献调研 Agent
- 论文写作 Agent
- 财务分析 Agent
- 通用 Assistant Agent

### 3.3 何时升格为 `Actor`

满足以下条件中的至少 2 条，通常才值得升格为 `Actor`：

1. 持有长期资源
2. 需要独立预算/权限
3. 需要独立生命周期
4. 有明确输入/输出端口
5. 需要被多个地方复用
6. 需要被连接编排

否则，更适合保留为某个较大 `Actor` 或 `Agent` 内部的普通函数。

### 3.4 `DeviceComponent -> Actor` 简版 checklist

为了避免“所有设备部件都被过度 Actor 化”，第一版建议加入一个简单 checklist。

当某个 `DeviceComponent` 同时满足以下大多数条件时，才建议升格为独立 `Actor`：

- [ ] 需要独立启动、停止、重启
- [ ] 需要独立资源预算或权限策略
- [ ] 有明确输入端口、输出端口或请求响应接口
- [ ] 会被多个 `Agent` 或多个流程复用
- [ ] 需要独立观测、告警、日志或健康检查
- [ ] 需要跨宿主、跨设备或跨会话长期存在

如果主要只是：

- 被单一执行体内部直接调用
- 没有独立生命周期
- 没有独立治理需求

那么更推荐保留为：

- `DeviceComponent`
- 或某个 `Actor` 内部的 driver / function（驱动函数）

---

## 4. 四类最容易混淆的对象边界

### 4.1 `Session` 与 `Context`

- `Session` 是“这次连续任务/对话线程是什么”
- `Context` 是“这次线程当前正在使用的工作记忆是什么”

一个 `Session` 在任意时刻只激活一个 `Context`，但同一个 `Context` 可以被多个 `Session` 复用。

### 4.2 `Context` 与 `Memory`

- `Context = working memory`
- `Memory = long-term memory`

`Context` 强调当前任务活跃内容，`Memory` 强调跨会话长期持久知识。

### 4.3 `Actor` 与 `Workspace`

- `Actor` 是执行体
- `Workspace` 是执行环境

推荐关系：

- `Actor` 绑定 `Workspace`
- `Agent` 挂接 `Memory`
- `Session` 激活 `Context`

### 4.4 `Binding`、`Attachment` 与 `Surface`

- `Binding` 负责接入外部运行时
- `Attachment` 负责某次实时附着
- `Surface` 负责观察与交互

三者不是一一对应关系。

### 4.5 `Device`、`RuntimeHost`、`Actor` 与 `Agent`

这四者分别回答不同问题：

- `Device`
  - 这是什么现实载体或具身实体
- `RuntimeHost`
  - 这是什么运行时宿主，在哪里可拨号、可运行
- `Actor`
  - 这是谁在执行某种能力
- `Agent`
  - 这是谁在做认知、规划与调度

典型映射：

1. 一台笔记本电脑
   - `Device = laptop`
   - `RuntimeHost = local runtime`
   - `Actor / Agent =` 跑在这台宿主上的执行体与认知体
2. 一台云服务器
   - 可只有 `RuntimeHost`
   - 不要求一定先建一个 `Device`
3. 一辆机器人小车
   - `Device = robot car`
   - `RuntimeHost = onboard runtime`
   - `DeviceComponent = camera / wheel / motor / speaker`
   - `Actor = camera driver / motor controller / telemetry relay`
   - `Agent = navigation planner / task planner / review agent`

正式建议：

> 不把 `Device` 直接等同为 `Actor`。  
> 不把 `RuntimeHost` 直接等同为 `Device`。  
> 不把 `Agent` 混成“高级设备”。

### 4.6 `DeviceLink` 与 `Connection`

两者最容易在机器人、硬件、跨设备运行时里被混淆。

区别如下：

1. `DeviceLink`
   - 是承载链路
   - 关心 BLE / WiFi / USB / Serial / CAN 等
   - 关心配对、延迟、吞吐、掉线、认证
2. `Connection`
   - 是信号编排连线
   - 关心 `from_node.port -> to_node.port`
   - 关心信号类型、治理模式、过滤、临时/持续

一个 `DeviceLink` 上可以承载很多 `Connection`。  
同一条 `Connection` 在实现上也可能随着宿主变化而切换底层 `DeviceLink`。

因此推荐分层为：

- `DeviceLink` 对齐 ECS-1 / ECS-2 / ECS-3
- `Connection` 对齐 ExoMind 的信号网络对象层

---

## 5. 身份模型（Identity Model，身份模型）

### 5.1 基本原则

1. `em_session_id` 是内部唯一稳定主键
2. `provider session` 是外部身份，允许漂移
3. `attachment_id` 是实时附着句柄，不承担持久身份
4. `resume` 恢复的是 `Session`，不是某个旧的 terminal/attachment 实例

### 5.2 第一版核心身份字段

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

### 5.3 `resume` 的统一语义

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

## 6. Port / Connection（端口与连接）

### 6.1 `Port` 的角色

`Port` 不是 UI 按钮，也不是“一个节点只有一个输入一个输出”的简化别名。

`Port` 是 `Actor` 或 `Agent` 暴露出来的能力入口/出口，用于声明：

- 从哪里接收信号
- 向哪里发出结果
- 支持什么 `signal_type`
- 采用什么交互模式

第一版采用中间路线：

- 明确 `signal_type`
- 可选 `schema`
- 不强制一开始做超重强类型系统

### 6.2 `Port` 推荐最小结构

```ts
type Port = {
  port_id: string;
  name: string;
  direction: 'input' | 'output';
  signal_type: string;
  mode: 'event' | 'request_response' | 'stream' | 'command';
  schema?: string;
  required?: boolean;
  cardinality?: 'one' | 'many';
  accepts_multiple?: boolean;
  buffer_policy?: 'drop' | 'queue' | 'latest';
};
```

### 6.3 `Connection` 的角色

`Connection` 用于表达：

- 哪个对象的哪个输出端口
- 连到哪个对象的哪个输入端口
- 是预配置还是动态创建
- 是临时还是持续

第一版必须同时支持：

- `preset` 预配置连接
- `dynamic` 动态连接
- `ephemeral` 临时连接
- `persistent` 持续连接

### 6.4 `Connection` 推荐最小结构

```ts
type Connection = {
  connection_id: string;
  from_node_id: string;
  from_port_id: string;
  to_node_id: string;
  to_port_id: string;
  creation_mode: 'preset' | 'dynamic';
  lifespan: 'ephemeral' | 'persistent';
  owned_by?: 'system' | 'agent' | 'user';
  delivery_mode?: 'push' | 'pull';
  enabled?: boolean;
  filter_ref?: string;
  transform_ref?: string;
  governance_mode?: 'normal' | 'restricted' | 'approval_required';
  metadata?: Record<string, unknown>;
};
```

说明：

1. 这里使用 `from_node_id / to_node_id` 而不是写死 `actor_id`
   - 为的是允许：
     - `Actor -> Actor`
     - `Actor -> Agent`
     - `Agent -> Actor`
     - `Agent -> Agent`
2. `Agent -> Agent` 连接允许存在，但默认要更谨慎治理
3. `owned_by` 用于区分：
   - 系统默认连线
   - 用户手动连线
   - Agent 运行时沉淀出来的连线

### 6.5 `Agent` 可沉淀的结构

`Agent` 当前临时表现出来的能力，可以沉淀为：

1. 可长期运行的 `Actor`
2. 可复用的 `Connection`
3. 可复用的 `Profile / Policy`
4. 可写入 `Memory` 的长期知识

这也是 ExoMind 和普通 CLI skill（技能脚本）思路的重要差异之一：  
不是只保存 prompt 技巧，而是把能力沉淀为系统内部可运行、可治理、可复用的对象与连接。

### 6.6 `DeviceLink` 与 `Connection` 的配合关系

当 ExoMind 扩展到机器人、穿戴设备、小车、云主机时，应采用以下配合关系：

1. `DeviceLink`
   - 先把宿主或设备连起来
   - 解决 reachability（可达性）、pairing（配对）、auth（认证）、latency（延迟）
2. `Binding`
   - 再把 `Session`、provider、runtime 或设备驱动接进系统
3. `Connection`
   - 最后在信号层建立 `Node.Port -> Node.Port` 的正式连线

推荐流水线：

`DeviceLink established -> RuntimeHost reachable -> Binding attached -> Connection activated`

这样才能避免把“链路是否可达”和“业务对象是否应连线”混成一件事。

---

## 7. Signal（信号）与共享对象读取原则

### 7.1 核心原则

第一版推荐明确采用：

> `Connection` 默认传信号与引用，不直接传大正文。

也就是说：

- 连接线主要传：
  - 事件类型
  - 轻量 payload（轻量载荷）
  - 标识符
  - 引用
  - 控制信号
- 真正的大内容：
  - 长文本
  - 文件
  - 图像
  - 草稿
  - 大块上下文
  - 实验结果
  应进入共享对象层，再由接收方按引用读取

### 7.2 共享对象读取

接收方通常应从以下对象中读取正文或大内容：

- `Workspace`
- `Memory`
- `ContextSnapshot`
- `Artifact`

典型模式：

1. 上游对象完成处理
2. 将结果写入共享对象
3. 发出轻量信号，附带引用
4. 下游对象收到信号后再读取共享对象

这条原则特别适合：

- `Agent -> Agent`
- `Actor -> Agent`
- `Agent -> Actor`

因为它可以显著降低：

- 耦合度
- token 成本
- 调试复杂度
- 权限边界模糊

### 7.3 `Signal` 最小结构

本规格先只收口信号原则，不在本版写死完整字段全集。  
下一轮讨论应重点回答：`Signal` 的最小必要字段是什么、哪些字段属于事实源、哪些字段属于派生层。

### 7.4 `dora-rs/dora` 的参考边界

本规格确认：`dora-rs/dora` 可以作为 ExoMind 后续底层实现的重要工程参考，但不作为顶层概念设计的来源。

原因是：

1. `dora` 解决得很好的是 `dataflow runtime（数据流运行时）`
2. ExoMind 当前要定义的是 `signal-native runtime object model（信号原生运行时对象模型）`
3. 两者在底层通信和执行编排层有明显重叠
4. 但在 `Session / Context / Memory / Workspace / Agent governance` 这些认知对象层并不等价

可以借鉴的部分：

- `NodeId + input/output id` 的显式连线模型
- `input_id: source_node_id/output_id` 这类清晰的数据流声明方式
- 本地共享内存、跨进程高性能消息传递、远端通信抽象
- payload（正文）与 metadata（元数据）分层
- queue size / backpressure（队列长度与背压）等运行时细节
- `send_output` / `Event::Input` 这类稳定端口 API 的设计方式

不直接照搬的部分：

- 以机器人/硬件数据流为中心的产品语义
- `Arrow-first` 作为唯一正文格式
- 只用静态数据流图表达全部系统对象
- 缺少 `Session / Context / Memory / Workspace / Binding / Surface` 的上层对象模型

因此正式建议是：

> 顶层对象模型与语义边界，以 ExoMind 自己的 `Node / Actor / Agent / Session / Context / Memory / Workspace` 为准。  
> 底层端口、连线、消息传递、共享内存、dataflow runtime 等工程实现，可以系统参考 `dora-rs/dora`。

### 7.5 对 `dora` 的具体吸收方式

如果后续进入实现阶段，推荐吸收顺序如下：

1. 先吸收 `NodeId / PortId / Connection` 的显式建模方式
2. 再吸收 `payload / metadata / transport` 分层方式
3. 再评估本地共享内存、零拷贝、跨进程消息总线是否适合 ExoMind Runtime
4. 最后再决定是否借鉴其 dataflow descriptor / builder（数据流描述与构建器）形式

实现时应始终保持：

- `Signal` 仍以 ExoMind 的语义事件为中心，而不是退化成纯二进制数据包
- `Connection` 应支持动态创建与治理，不限制为纯静态图
- `Signal` 默认传轻量事实与引用，不直接把大正文塞进连线上
- `Actor` 与 `Agent` 的严格分层，不因底层 runtime 借鉴而被打平

---

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

### 13.1 时间块结束后的认知处理

推荐链路：

1. `TimeBlockActor` 发布 `timeblock.completed`
2. 通过 `Connection` 路由到专门的 `Agent`
3. 该 `Agent` 读取相关 `Workspace / EventLog / Context / Memory`
4. 生成总结、建议、后续动作

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
