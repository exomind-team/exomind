# ExoMind 的 ACP Agent Surface：从“聊天即日志”到“受限连续性入口”

2026-11-21。状态：**设计调研，未进入生产实现**。
结论：**有条件成立，且值得做一个最小实验，但不能把任意 ACP 聊天直接等同于 ExoMind 的完整事件日志，也不能让客户端的一次权限点击替代 Host 的授权与撤销。**

本文先核 ExoMind 当前 Core/Host/Native 边界，再对照 ACP 官方协议、本机 T3 Code 0.1.10、DSH 0.2.0-rc.2 的 ACP 实现，以及 D3Code 与“个人 Agent 工作体系代表大会”的最新状态。文中的“已验证”“设计判断”“未验证”分层使用；没有把源码存在、协议可协商或一次冒烟测试写成端到端产品通过。

## 检索路线与来源选择

本次先查 ExoMind 内部：

- `docs/product/vision.md` 与 `docs/architecture/principles.md` 确定产品位置和不变量；
- `src/beta/README.md`、Beta Agent grant/read 文档、Core/Host 源码确定当前事实、命令、回执与授权边界；
- `docs/architecture/agent-runtime-unified-foundation-spec.md` 只作为早期“durable session / ephemeral attachment”设计线索，不用它覆盖当前 Beta 所有权。

随后查本地参考源：

- `skills/cross-analysis/references/index.md` 及全部 `source-*.md` 中没有 ACP、T3 Code 或 DSH 专项参考源，因此需要补充本地源码与官方资料；
- D3Code 证据说明 T3/DSH 的工作现场和专用 UI 边界；
- T3 Code 源码与本机 0.1.10 安装包确认 ACP Client 能力；
- `@deepseek-ai/dsh-acp` 提供同生态的 Agent-side 实现参考。

最后只以 ACP 官方仓库的固定提交 `fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f` 和官方文档补协议事实。最终保留四组互补参考：ExoMind 内部边界、T3 Client、DSH Agent implementation、ACP stable schema。它们分别回答“谁是数据所有者”“宿主怎样运行 Agent”“Agent 如何结算会话”“协议到底承诺什么”。

## 0. 最短答案

如果 ExoMind 实现 ACP **Agent 服务端**，T3 Code 作为 ACP **Client** 启动它，再把线程、聊天、工具卡和权限请求呈现给用户，那么 ExoMind 确实可以成为 T3、Zed、JetBrains、VS Code 扩展、CLI/TUI、移动端等多个 ACP 宿主可调用的“个人连续性 Agent”。这会显著增加可达入口。

更准确的产品模型是：

```text
T3 Code / 其他 ACP Client
        │  ACP session/prompt、session/update、tool call、permission
        ▼
ExoMind ACP Agent adapter
        │  只调用 Host 已暴露的语义命令
        ▼
Host：身份、档案授权、撤销、固定命令、回执、原件与模型边界
        │
        ▼
Core：只增事实、事务回执、投影、原件证明与同步
```

T3 Code 负责“这次工作会话在哪里发生”；ExoMind 负责“哪些事实跨会话、跨设备、跨工具持续存在”。ACP 是两者之间的可替换通道，不是新的真值所有者。

## 1. 角色先校正：谁是 Agent，谁是 Client

用户最初的想法里有一处容易混淆的角色表述：

- 若 T3 Code 连接 ExoMind，让 ExoMind 处理 prompt、流式更新和工具调用，那么 **ExoMind 实现 ACP Agent/server**，T3 Code 实现 ACP Client/harness。
- 若 ExoMind 主动启动并驱动 T3 或其他编码 Agent，让它们作为 ExoMind 的子 Agent，那么 ExoMind 才是 ACP Client。

当前建议研究的是第一种：**ExoMind 作为可被 T3 Code 接入的 ACP Agent**。这不妨碍以后 ExoMind 再扮演 Client，去调用其他 ACP Agent；“可调用”和“可被调用”是两种不同适配器。

ACP 官方架构把职责分得很清楚：Client 启动 Agent 子进程，双方用 stdin/stdout 上的 JSON-RPC 通信；Agent 执行 prompt turn，并通过 `session/update` 流式报告消息、计划和工具状态，Agent 还可以反向请求 Client 显示一次性权限决策。一个连接可以承载多个并发 session。见 [ACP Architecture](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/get-started/architecture.mdx)。

## 2. 前因：为什么现在这个想法值得重新看

### 2.1 ExoMind 已经有可复用的连续性内核，但入口偏窄

当前 0.6 Beta 的核心边界不是普通聊天数据库：

- Core 持有只增事实、事务回执、投影、时间块、摘要、原件和来源证明；
- Host 持有档案权限、业务命令、peer、复制、原件、摘要任务和外部 Agent gate；
- Native 持有可信窗口、系统能力与凭据材料；
- 主窗、浮窗、外部 Agent HTTP 都是 Host 的客户端，不拥有业务生命周期。

这使 ExoMind 天然适合承载“长期过程”，但现有主要入口仍是自己的 Tauri UI 和专门设计的 `exomind-beta/1` HTTP。每接一个外部宿主就做一套包装，成本高，也很难进入已经拥有成熟聊天、工具卡、线程和权限界面的编辑器生态。

### 2.2 D3Code 证明了 T3/DSH 工作现场的重要性，也暴露了接入耦合

D3Code 已经在隔离 DSH profile 中生成并加载三个真实插件，工作台和决策台可以切换，Web 认证、组合禁用和面板切换有实测证据。但它仍受以下边界约束：

- A2 只有部分通过；
- release gate 为 `BLOCKED`，18 项官方体验继承为 `0/18`；
- 真实 T3 只读、稳定 Session 保留、单 SDK 实例、guest Remote 拒绝、实际卸载重装仍未完成；
- DSH 0.2.0-rc.2 的 browser surface 默认加载 client UI 插件，ACP、SDK、headless 的默认 bundle 不加载；
- 因此 D3Code 的专用主窗和决策台不会因为增加 ACP surface 就自动迁移过去。

详细证据见 [D3Code 跟踪账本](H:/A137442/Develop/AI/dsh/plugins-dev/d3code-r01/docs/AGENT_OS_TRACKING.zh-CN.md) 和 [四 surface 实测](H:/A137442/Develop/AI/dsh/plugins-dev/d3code-r01/evidence/surface-inventory-2026-11-21.json)。

这说明两件事：

1. 深度插件化能提供更强的专用 UI 和 T3 原生联动，但成本、宿主耦合和升级风险高。
2. ACP 不能复制这些专用 UI，却能以更低成本把 Agent 送入多个已有宿主，适合做可达性层。

### 2.3 T3 Code 已具备通用 ACP Client 入口

本机 `T3 Code (Beta).exe` 的已验证身份为：

| 项 | 实测值 |
|---|---|
| 产品/文件版本 | `0.1.10.0` / `0.1.10` |
| 文件大小 | `245,843,632` 字节 |
| SHA-256 | `EAC3D852B8C0C8F1917FF50A7CCB8092C4EC0087FB17342BB0813751301C7721` |
| 安装包内界面字符串 | `Local ACP command` |
| 安装包内协议能力 | ACP v1/v2 schema、`session/request_permission` 等 |

T3 当前源码也实现了通用 ACP runtime：

- `Settings → Providers → Add provider → Show more → Local ACP command`；
- 直接启动 executable，不经 shell 展开；
- 首先请求 ACP v2 Preview，失败时兼容 v1；
- 支持 Provider、Session、Prompt、Permission、配置、恢复与原生 Session 导入；
- ACP Registry agent 与本地命令都复用同一通用入口。

源码入口：

- `H:/A137442/Develop/AI/t3code/docs/user/providers-acp.md:12`
- `H:/A137442/Develop/AI/t3code/docs/user/providers-acp.md:33`
- `H:/A137442/Develop/AI/t3code/packages/provider-acp/src/server/AcpSessionRuntime.ts:2087`

因此，“T3 能否启动一个 ACP Agent”已经从猜测变成本机已验证能力。尚未验证的是 ExoMind 自己作为该 Agent 的完整会话、认证、授权、恢复与产品表现。

### 2.4 ACP 已进入可采用的协议窗口

截至 2026-11-20：

- ACP v1 是稳定线；
- ACP v2 从 Draft 进入 Preview，目标是避免大改但尚未冻结；
- v2 增加 `idempotencyKey`、`messageId`、`replay_complete`、后台工作、子 Agent 等适合长连接恢复的能力；
- T3 当前偏好 v2、兼容 v1；
- DSH 的 `dsh-acp` 当前提供稳定 v1，并明确只发送已提交的 assistant 消息、thought、通用工具生命周期与配置状态，不把原始 provider delta 或 DSH 专用呈现数据塞进协议。

见 [ACP v2 Preview 公告](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/announcements/acp-v2-preview.mdx) 与 [DSH ACP 包说明](C:/Users/56506/node_modules/@deepseek-ai/dsh-acp/README.zh.md)。

这意味着 ExoMind 不必发明整套“外部编辑器聊天协议”，也不应把首个实验赌在尚未冻结的 v2 全量能力上。合理的路线是：

- **稳定基线用 v1 读路径**；
- **写入与断线恢复实验优先验证 v2 的幂等语义**；
- 通过 SDK/router 同时协商 v1/v2，而不是二选一锁死宿主要求。

## 3. 后果：它可能怎样让外心更可触达

### 3.1 受益面

ACP 把“怎样创建会话、发 prompt、流式显示、展示工具、请求权限、取消、恢复”统一成宿主能力。ExoMind 一旦成为 ACP Agent，可以同时触达：

- T3 Code 的 Web、Desktop、Mobile；
- Zed、JetBrains、VS Code 及其兼容编辑器；
- Neovim、CLI/TUI 与支持 ACP 的自动化客户端；
- 已有的聊天或远程控制桥接器；
- 未来把 ExoMind 当子 Agent 的其他 ACP Client。

这里真正的产品价值不是“多一个聊天框”，而是：

> 用户正在任何 Agent 工作现场时，都能读取自己的连续过程、引用既有证据、追加受限说明，而不必切回 ExoMind 主窗重建上下文。

### 3.2 与 MCP、A2A、LSP 的分工

| 协议 | 适合解决的问题 | 与 ExoMind ACP 的关系 |
|---|---|---|
| ACP | 一个 Client 与一个交互式 Agent 维持 session、prompt、流式更新和权限 | 让 ExoMind 成为可交互 Provider |
| MCP | 给 Agent 提供工具、资源与 prompt | 未来可把 ExoMind 的读工具交给其他 Agent；与 ACP 互补 |
| A2A | 把独立任务交给另一个自主 Agent，异步拿结果 | 适合 ExoMind 作为长期后台主体接任务，不替代 ACP 的逐轮交互 |
| LSP | 编辑器与语言服务器之间的标准接口 | ACP 的结构类比来源，不是同一协议 |
| `exomind-beta/1` | ExoMind 自己的可信 Host 业务能力 | ACP 不得绕过它，只应成为它的一个适配器 |

ACP 官方明确建议“程序持续参与每个 turn”时用 ACP，“把任务交给另一个 Agent 后等待结果”时用 A2A。它们不是竞争关系。见 [ACP 与其他协议](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/get-started/related-protocols.mdx)。

### 3.3 不会自动获得什么

ACP 带来的是**可达性**，不是以下能力的自动迁移或证明：

- ExoMind 的时间块、浮窗、原件生命周期、设备邀请、权限管理专用 UI；
- D3Code 的 workbench/decisions 专用面板；
- 多设备同步和原件到达；
- Agent 是否聪明、模型是否可用；
- 安全可靠的人类身份；
- 完整历史回放、审查质量和用户验收；
- 远端 T3 server 与用户本机 ExoMind 数据之间的网络通道。

一个 ACP 宿主能显示标准文本、工具和权限卡，不等于它能完整表达 ExoMind 的产品语义。

## 4. “聊天记录就是事件日志”应当怎样理解

### 4.1 不能建立一对一映射

ACP 会话里至少有这些消息：

- 用户 prompt；
- assistant 文本增量；
- thought；
- tool call 与 tool result；
- plan、config、usage、notice；
- permission 请求与响应；
- 创建、恢复、取消、关闭等生命周期动作。

ExoMind Core 里的 typed fact 至少包括：

- Human capture；
- Agent note；
- 时间块；
- 更正；
- 摘要；
- original lifecycle；
- 复制、回执、投影和未来未知 fact kind。

这些集合的**粒度、作者、隐私、持久性、同步范围与业务意义都不同**。如果每一个 ACP delta、旧 thought、工具参数和权限点击都自动成为长期事实，会得到噪声大、隐私不可控、无法解释又不能删除的日志。

### 4.2 正确的三层模型

| 层 | 是否持久 | 谁拥有 | 用途 |
|---|---|---|---|
| ACP 传输事件 | 默认瞬时 | ACP 连接/Agent | JSON-RPC 请求、通知、流式更新与取消 |
| ACP 会话账本 | 按策略持久 | ExoMind ACP adapter | 会话映射、已准入 prompt、最后回执、恢复游标 |
| Core 领域事实 | 明确提交后持久 | ExoMind Host/Core | capture、agent note、时间块、摘要、原件与证明 |

聊天页面可以是“Core 事件日志的一个投影”，但不应把整个 Core 日志直接摊平成聊天消息。反过来，ACP 会话账本也不能是个人长期真值。

### 4.3 两条可行路线

#### 路线 A：adapter transcript，显式归档到 Core

ACP session 有自己的追加式消息账本；只有用户执行“记住这条”或专门工具时，才生成 `capture/1`、`agent_note` 或其他 Host 命令。

优点：

- 不污染个人事实；
- 可以先验证协议、恢复和宿主差异；
- 失败、工具噪声和 prompt injection 不进入连续过程。

缺点：

- 同一段聊天在 ACP 会话账本与 Core 中可能有两种身份；
- “聊天记录”默认不是跨设备 ExoMind 历史；
- 需要额外定义 adapter 会话账本的生命周期。

#### 路线 B：引入 typed conversation fact，并让聊天成为投影

把被选的会话消息建模为带 session/ref/author/digest 的只增事实，聊天 UI 只是这些事实的投影。

优点：

- 跨宿主恢复最完整；
- 可复用固定命令、回执和同步；
- “聊天即日志”在模型上真正成立。

缺点：

- 必须新增并评审新的 fact schema；
- Human prompt 与 Agent output 的作者语义必须严格分离；
- 历史、撤销、原件、模型提交、隐私和客户端缓存需要额外边界；
- 所有 ACP 客户端都会成为个人长期日志的生产者，误写风险高。

**现阶段建议先走路线 A。** 等到“哪些消息值得成为个人连续性事实、由谁授权、如何展示作者、撤销后如何解释旧副本”这组契约稳定后，再判断是否引入 conversation fact，不能仅因为 UI 是聊天就改变 Core schema。

### 4.4 “用户发消息相当于发事件”的准确版本

一个 `session/prompt` 首先只是 Client 对 Agent 的请求。要成为 ExoMind 事件，至少需要：

1. 连接已被可信认证；
2. session 已绑定一个明确 profile；
3. prompt 被解析为允许的领域动作；
4. Host 校验当前 grant、撤销状态与写入角色；
5. 生成固定 `command_id` / `event_id`；
6. 收到可查证的 receipt；
7. 重试携带同一身份，不生成第二条事实。

当前外部 Agent grant 不提供“任意 ACP 客户端等于 Human”的捷径：

- `observer` 只能读；
- `agent_note` 可追加 Agent 身份的说明和暂存原件；
- `summary_producer` 只能提交外部摘要；
- Host 不接受调用方自报 `actor:human`；
- Agent 写入使用 `AuthorKind::AgentNote`，不会冒充用户。

所以第一版即使让 T3 用户发消息，也不能直接把它记成 Human capture。那需要另行设计经过用户确认的人类身份认证路径，不能把 T3 的 `clientInfo`、线程 ID 或 ACP 权限点击当作身份。

### 4.5 会有两个日志，不能靠双重写入假装成一个

T3 Code 本身持久化 thread、run、conversation 和 provider session；ExoMind 持久化个人领域事实。即使 ExoMind 成为 ACP Agent，两端仍各有自己的日志：

```text
T3 thread/run log ── ACP session + prompt/tool updates ── ExoMind adapter journal
                                                           │ fixed command + receipt
                                                           ▼
                                                ExoMind domain event log
```

两者之间没有跨软件事务，不能声称“T3 turn 成功”与“ExoMind fact 已提交”原子一致。可以用下面的可靠链路：

1. Adapter 先持久化待提交意图和固定 `command_id`；
2. 再向 Host 提交；
3. 连接中断时按同一 ID 查 receipt；
4. 只有 receipt 才把业务状态表示为“已接受事实”；
5. Agent 回复可以引用 receipt，但不能用“聊天框里看起来成功”替代它。

这与 ExoMind 现有草稿、固定命令和未知结果回查是同一种模式。若要追求“只有一份日志”，正确的办法是先重新定义事件所有者与投影边界，而不是同时向两边写后再做两套去重。

## 5. 目标架构与不应采用的捷径

### 5.1 推荐的逻辑结构

```text
┌──────────────────────────────┐
│ T3 Code 0.1.10 ACP Client    │
│ Thread / chat / tools / auth │
└──────────────┬───────────────┘
               │ ACP v1/v2 over stdio
┌──────────────▼───────────────┐
│ exomind-acp sidecar          │
│ - ACP session ↔ profile map  │
│ - prompt intent and receipts │
│ - streaming projection       │
│ - cancellation               │
└──────────────┬───────────────┘
               │ same-user local bridge (target)
               │ existing scoped loopback API (possible spike)
┌──────────────▼───────────────┐
│ ExoMind Host                 │
│ grant / revoke / fixed cmds  │
│ receipts / originals / peers │
└──────────────┬───────────────┘
               │ sole writer
┌──────────────▼───────────────┐
│ ExoMind Core                 │
└──────────────────────────────┘
```

### 5.2 为什么应当另设 `exomind-acp` 可执行入口

Beta 的主 Tauri 可执行文件在 Windows release 下声明为 GUI subsystem：

- `src-tauri/src/main.rs:3` 使用 `windows_subsystem = "windows"`。

ACP 标准 transport 要求 Client 启动子进程，Agent 的 stdout 只能写 ACP 消息，日志走 stderr，且一行一个完整 JSON-RPC 消息。把 GUI 主进程直接当 ACP 子进程会同时遇到窗口生命周期、stderr/stdout 和普通用户误启动等问题。

独立 console-sidecar 可以：

- 只把 stdout 留给 ACP；
- 在 T3 关闭时退出；
- 不启动第二套主窗；
- 不要求把凭据写进命令行；
- 通过版本化的 ExoMind 本地接口访问已经运行的 Host。

### 5.3 不能让 ACP 进程直接打开同一个 Core

Host 对 root 持有独占锁。`Persistence::open` 会尝试对 `host-lock.sqlite3` 执行 `BEGIN EXCLUSIVE`，失败返回 `RootInUse`；见 `crates/exomind-beta-host/src/storage.rs:239-246`。

因此，让 T3 拉起的第二个 ExoMind 进程直接打开同一数据目录，会导致：

- 主窗运行时 sidecar 无法启动；
- 或要求主窗退出后由 sidecar 接管数据；
- 或诱发双 runtime、双 device identity、双写和不同投影；
- 破坏“Host 是唯一业务所有者”的不变量。

这条路线应明确否决。

### 5.4 两种可行接法

| 路线 | 运行关系 | 优点 | 局限 |
|---|---|---|---|
| 快速 spike：sidecar 使用现有 loopback Host API | 主窗持有 Host；sidecar 是外部 grant 客户端 | 复用已有 `exomind-beta/1`、权限、回执与端口边界 | 仍需要安全 grant/token 交付；当前剪贴板通道不可作为本轮验收前提 |
| 产品化目标：same-user local IPC | 主窗持有 Host；sidecar 通过 Windows named pipe / Unix socket 请求专有 adapter 能力 | 不暴露 bearer、可按 OS 用户收窄、可做一次性 attach | 需要新 IPC 合同、跨平台权限和版本协商 |

在 secure grant 交付尚未解决前，读路径可以使用合成 profile 和测试 grant 完成协议实验，但不能把真实个人数据接入 T3，也不应通过剪贴板或凭据正文完成“验收”。

### 5.5 profile、session 与 device 必须分层

- `ACP session ID`：一个 Client 连接中的会话句柄；
- `ExoMind provider/session mapping`：ACP session 到稳定 ExoMind 会话/投影的映射；
- `profile_id`：个人档案身份，是数据授权边界；
- `device_id`：事实来源与本地副本身份；
- `runtime_id`：单次 Host 运行实例；
- `command_id` / `event_id`：领域写入与事实身份。

这些 ID 任何两个都不能因为“看起来都是 session”而合并。ACP `cwd` 是 Client 的工作区，不应被当作 profile；T3 thread ID 也不能成为 ExoMind event ID。

最稳妥的首版交互是“一个 T3 provider instance 绑定一个 ExoMind profile UUID”。profile UUID 不是凭据，但仍应在 UI 中显示名称与稳定标识，避免同名档案串写。

## 6. ACP 语义到 ExoMind 的映射

| ACP 对象/方法 | ExoMind 语义 | 默认持久化 | 关键约束 |
|---|---|---|---|
| `initialize` | 版本、能力、auth method 协商 | 否 | `clientInfo` 自报，不是身份 |
| `authenticate` | 建立 Adapter/Host 会话或触发本地配对 | 仅认证结果 | 不把 token 放进 `_meta`、日志、聊天或命令行 |
| `session/new` | 绑定 profile、grant、adapter session | Adapter 状态 | 不自动创建 Core fact |
| `session/list` / `session/load` | 列出/重建已授权的会话投影 | 会话映射 | 重放前重新检查当前授权，不能恢复已撤销内容 |
| 用户 `session/prompt` | 一个待解释意图 | 视策略 | 不等于 Human capture |
| “记住……”明确意图 | `CaptureCommand` 或未来 conversation command | 仅受权时 | 固定 ID、Host 校验、receipt |
| `agent_message_chunk` | 用户可见的 Agent 输出投影 | 默认否 | 不逐 chunk 写 Core；需要长期保留时显式提交 |
| `agent_thought_chunk` | Agent 内部推理流 | 否 | 不进入个人事实；客户端也不应把它当审计证明 |
| `tool_call` / update | 工具执行进度 | Adapter 审计可选 | 不因协议出现即自动成为领域事实 |
| `session/request_permission` | 一次操作是否允许的 UI 决策 | 仅本次决策 | 不是 grant、不是 `allow_always` 的 ExoMind 授权 |
| `session/cancel` | 停止正在进行的工作 | 否 | 已提交事实不回滚 |
| `session/close` | 释放活动资源和映射 | 否 | Core 与 receipt 保留 |
| tool：读取 timeline | Host 有界读取 | 否 | profile 与 grant 每次核查 |
| tool：追加 agent note | 现有 `agent_note` 写入 | 是 | 作者必须保持 Agent，不得冒充 Human |
| tool：读取原件字节 | 显式原件读取 | 否 | 独立能力、lifecycle permit、hash 校验 |
| tool：提交模型任务 | 外部摘要/模型提交 | 视任务 | 独立外部提交授权和预算 |

## 7. “受限发送”必须放在 Host，而不是只放在 UI

ACP 的安全性有明确边界：协议本身不 sandbox Agent；permission request 是提示性的，Agent 必须自行尊重；Client 和 Agent 的 `clientInfo`/`agentInfo` 只是自报。见 [ACP Security Considerations](https://agentclientprotocol.com/protocol/v1/security)。

T3 还允许线程级 **Supervised / Auto-accept edits / Auto / Full access**，当前源码文档写明新线程初始默认是 Full access，ACP Agent 的 approval request 会按线程 permission mode 回答。见 `H:/A137442/Develop/AI/t3code/docs/user/permission-modes.md`。

因此不能把以下任一信号当成 ExoMind 的长期授权：

- T3 thread 是 Full access；
- 用户这次点了 `allow_once`；
- ACP 发来 `allow_always`；
- Client 自报 `actor:human`；
- `clientInfo.name` 看起来像可信应用；
- session 已建立；
- 上一次相同 tool call 被允许。

建议的授权栈：

1. **传输认证**：same-user local IPC 或安全的 Host 凭据；
2. **profile 绑定**：ACP session 只能作用于一个明确 profile；
3. **ExoMind grant**：observer / agent_note / summary_producer 等现行角色；
4. **动作范围**：只暴露受支持的语义 tool，不开放任意 fact/event 写接口；
5. **内容范围**：正文、附件、原件字节、模型外发分别授权；
6. **逐次确认**：高风险动作可再使用 ACP permission 或 Native 确认；
7. **Host 最终复核**：每个最终命令重新检查撤销状态和生命周期；
8. **回执与回查**：未知结果先查同一 `command_id`，不重发新命令。

推荐给首版 ACP Agent 三种显式模式：

| 模式 | 能力 | 适用 |
|---|---|---|
| `read_only` | 查 timeline、receipt、摘要元数据 | 既有 `observer` grant 的最小可行路径 |
| `note_only` | 在读之外追加上限受控的 `agent_note` | `agent_note` grant；不冒充 Human |
| `capture_confirm` | 用户明确要求时准备一条 Human capture 并等待确认 | 必须另有可信 Human 认证；默认关闭 |

不能把普通聊天自动设为 `capture_confirm`，否则用户只要问一句代码问题，就会把工程上下文写入个人事件日志。

## 8. 与 D3Code 和代表大会体系的关系

代表大会目前给 ExoMind 的位置是“个人连续性与持续主体层”；D3Code 所在层是“工作现场与编排”；ARC-02、EasyTier、OpenList、证书等是“个人基础设施”。这个位置关系在 ACP 接入后仍成立，而且更加清楚：

```text
个人基础设施：资源、网络、认证、存储、恢复
        ↓ 提供环境
工作现场：T3 / DSH / D3Code / IDE / CLI
        ⇅ ACP：标准交互适配
个人连续性：ExoMind profile / fact / time / provenance
        ↓ 提供长期过程
协作与治理：TeamSense / 集体决策 / 证据与责任
```

可以共享：

- source reference 与稳定 ID；
- 固定命令、幂等和未知结果回查；
- 凭据不进视图、权限由宿主持有；
- 客户端只是 surface，不拥有领域生命周期；
- 运行成功、事实提交、结果验收分别记录。

不能合并：

- T3 thread 不等于 ExoMind 的任务全貌；
- D3 decision 不等于 ExoMind 的个人事实；
- DSH 会话持久化不等于 ExoMind 的档案授权；
- ACP session 不等于 profile、device 或 Core event；
- 一个 Client 的权限 UI 不等于 Host 的 grant/revoke；
- ExoMind 的私密历史不能因某编辑器支持 ACP 就默认成为公共 Agent 上下文。

对代表大会的可参会结论可以压成三句：

1. **ACP 是 ExoMind 的横向可达性膜，不是把 ExoMind 并入 D3Code。**
2. **T3 0.1.10 作为 ACP Client 已在本机安装包和源码中证实；ExoMind 作为 ACP Agent 尚未实现或验收。**
3. **首个实验应是 v1 只读 observer 路径，聊天不会自动成为 Human 事件；写入只从显式 `agent_note` 或另行认证的 Human capture 开始。**

代表大会当前台账已有 18 份可追溯代表报告、0 份 pending；ExoMind 的正式状态仍是“Beta25 候选完成、完整验收受外部条件阻塞”。本文只增加一条新的可达性方案，不改变该验收状态，也不把尚未实现的 ACP surface 写进 Beta25 证据。

## 9. 分期实验与 Go/No-Go

### Phase 0：宿主兼容性冒烟

目标：只验证 ACP 管道，不接真实 ExoMind 数据。

实验：

- 提供一个无业务写入的最小 Agent；
- T3 0.1.10 用 Local ACP command 启动；
- 测试 `initialize`、v2→v1 协商、`session/new`、单 prompt、流式 chunk、取消、退出；
- 记录 T3 实际请求的协议版本、能力、stderr 行为与关闭顺序；
- 不读取 token、用户 profile、Core 或原件。

通过条件：

- T3 能启动、显示流式回复、取消并正常回收子进程；
- Agent stdout 无任何非协议输出；
- 重连/重启后能诚实地报告 session 是否可恢复，而不是伪造。

阻断条件：

- T3 只能导入 Registry agent，不能运行本地命令；
- 子进程生命周期无法可靠回收；
- 宿主把 v2 Preview 强制为业务前提，而 Agent 无法稳定回退 v1。

### Phase 1：v1 只读连续性 Provider

目标：从合成 profile 读取有界 timeline，不写 Core、不读原件字节。

实验：

- ACP session 绑定合成 `profile_id` 和 `observer` grant；
- 支持“列最近事实”“取一条 receipt”“按标签查询”；
- 每次读取都经过 Host；
- 在 session 中途撤销 grant，验证下一次读取被拒绝；
- `session/load` 只重放允许的对话投影，不重放整个 Core。

通过条件：

- 越出 profile 的读取 100% 拒绝；
- 撤销对既有 ACP 连接立即生效；
- 相同分页参数返回稳定快照；
- 不泄露其他 profile、token、模型密钥、原件字节；
- 断开客户端不会终止 Host 或复制/计时。

Go：允许继续设计 Agent note。

No-Go：只要 Adapter 需要自报 Human、绕过 Host 或持有 Core 写锁，停止。

### Phase 2：显式 `agent_note` 与幂等回执

目标：验证“受限发送”，但保持 Agent 作者语义。

实验：

- 用户显式调用“给当前 profile 加一条 agent note”；
- Adapter 生成固定 `command_id` / `event_id`，经 Host `agent_note` 路径提交；
- 重复 prompt、传输重试和进程重启都不产生第二条事实；
- 未收到 receipt 时只回查同一命令；
- 在提交期间撤销 grant，最终动作被拒绝；
- 检查 `AuthorKind::AgentNote`，不得写入 Human。

若使用 ACP v1，Adapter 必须自己持久化“本 turn 已分配命令 ID”的准入状态；若使用 v2 Preview，可用 `idempotencyKey` 强化跨连接重试语义，但仍以 ExoMind `command_id` 为业务真值。

通过条件：

- duplicate prompt 不重复；
- 取消不删除已经提交的 note；
- 未确认结果不显示为成功；
- Agent text 与 Human text 在 Core 投影中保持可区分。

### Phase 3：经过认证的 Human capture

这是风险最高的一步，不应被“ACP 聊天可以发消息”直接推导出来。

必须先有：

- 可撤销的一次性本地配对；
- ACP session 与服务端 Human authority 的绑定；
- 明确的 capture intent 与确认；
- profile、标签、正文、附件上限；
- 与 Native UI 相同的固定命令和回执语义；
- 客户端缓存不可被当作已撤销事实的删除证明。

实验应覆盖：

- 未经配对客户端无法写 Human；
- 同名 profile 不串档；
- 用户取消不提交；
- 回执未知不重发；
- grant/session 撤销后拒绝未来写入；
- 已接受事实在客户端退出后仍可回查。

### Phase 4：专用域工具与原件

按独立能力逐项打开：

- 时间块只读；
- 时间块控制仍要求 Human；
- 原件 metadata；
- 显式原件字节读取；
- 摘要任务；
- 外部模型提交；
- 本机保存与本机回收/释放。

每项都应有自己的 capability、预算、确认和审计，不能用一个 `tools_enabled=true` 一起打开。

### Phase 5：恢复、多设备与生态发布

验证：

- ACP session 映射跨 Adapter 重启；
- profile/device/runtime 身份不被 ACP session ID 替代；
- 客户端重连拿到一致但受当时授权约束的投影；
- v1/v2 双线协商不改变已接受事实；
- 远端 T3 environment 明确是“同一设备的本地 Host”还是“另一设备的授权代理”；
- ACP Registry 分发、签名、更新和卸载不会改变数据根。

## 10. 主要反例与红线

1. **“聊天即事实”**：每段聊天、thought、工具输出都自动写 Core，最终会把任务噪声、模型幻觉和隐私混成不可解释的长期记忆。
2. **`allow_always` 即 grant**：ACP option 的名称和客户端设置可自动批准；Host 的撤销与档案边界会失效。
3. **`actor:human` 即身份**：自报字段不是认证。T3 的 project、thread、clientInfo 也无法证明真实人类。
4. **取消即回滚**：已提交 capture 或 note 已经是事实；取消只停止尚未完成的工作。
5. **会话恢复即历史全知**：撤销后的 grant 不能继续读到旧事实；Client 本地已缓存的内容也不能由 ExoMind 宣称删除。
6. **ACP Agent 直接读 DB**：独占锁和单 Host 所有权会破裂；应采用 local bridge。
7. **ACP 取代 MCP**：ACP 让程序驱动 Agent，MCP 给 Agent 工具与资源，两者解决不同问题。
8. **ACP 取代 Native UI**：标准客户端不会呈现 ExoMind 的浮窗、档案管理、设备邀请和专用原件生命周期。
9. **只靠 stdout 日志排障**：ACP stdout 只能有协议帧；所有诊断走 stderr、结构化日志或 Native 诊断，并清除凭据。
10. **把 v2 Preview 当冻结标准**：v2 可以先行实验，但稳定发行必须处理 v1 fallback 和后续兼容。

## 11. 仍需由用户/大会决定的问题

1. ExoMind ACP Provider 首版是否只服务本地 Host，还是也要代理另一台已授权设备？
2. 一个 T3 provider instance 是绑定一个 profile，还是允许 session 内切换 profile？
3. 是否接受“ACP 聊天默认不入 Core，只有显式记住才入”？
4. Human capture 是否需要每次 Native 确认，还是可由可信设备建立短期 capture 模式？
5. Agent 是否自己运行模型，还是只提供确定性的时间线/回执工具？
6. 首版是否只实现稳定 v1，还是同时做 v2 Preview 写入验证？
7. 是否允许 `session/list` 把 ExoMind 历史标题暴露给所有同一 ACP Client？
8. 原件 metadata 与原件字节何时分开授权？
9. D3Code 是否最终以 rich native plugin 和 ACP portable provider 两条并行入口存在？
10. ACP Registry 发布是否属于 v0.6，还是只保留本地 command 入口？

## 12. 可复现依据

| 事实 | 证据 |
|---|---|
| ACP 标准角色、stdio、JSON-RPC 与多 session | [官方 Architecture](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/get-started/architecture.mdx) |
| ACP 当前稳定/预览版本 | [官方文档索引](https://agentclientprotocol.com/llms.txt)、[v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/schema/v1/schema.json)、[v2 Preview 公告](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/announcements/acp-v2-preview.mdx) |
| Prompt、update、cancel、permission 生命周期 | [Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)、[Tool Calls](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/protocol/v1/tool-calls.mdx) |
| ACP 不负责 sandbox，permission 是 advisory，身份信息自报 | [Security Considerations](https://agentclientprotocol.com/protocol/v1/security) |
| ACP 与 MCP/A2A/LSP 的分工 | [Related protocols](https://github.com/agentclientprotocol/agent-client-protocol/blob/fa50fde1ac75ccd22fafff69c3e0ec3562a4f30f/docs/get-started/related-protocols.mdx) |
| T3 0.1.10 安装包含 Local ACP command 与 ACP v1/v2 | `C:/Users/56506/AppData/Local/Programs/t3code/resources/app.asar`、`server.asar` 的只读字符串检查；EXE SHA-256 见本文 §2.3 |
| T3 本地 ACP 命令、v2 优先/v1 回退、Session/权限行为 | `H:/A137442/Develop/AI/t3code/docs/user/providers-acp.md`、`H:/A137442/Develop/AI/t3code/docs/user/permission-modes.md`、`H:/A137442/Develop/AI/t3code/packages/provider-acp/src/server/AcpSessionRuntime.ts` |
| DSH ACP 的已提交更新、一次性权限与 v1 限制 | `C:/Users/56506/node_modules/@deepseek-ai/dsh-acp/README.zh.md` |
| D3Code 的 A1/A2/gate 与 surface 事实 | `H:/A137442/Develop/AI/dsh/plugins-dev/d3code-r01/docs/AGENT_OS_TRACKING.zh-CN.md`、同目录 `evidence/surface-inventory-2026-11-21.json` |
| 代表大会中的 ExoMind 定位与代表报告 | `H:/A137442/Develop/AGI/ACA/2026-08-12 服务器运维/.archify/work-overview-2026-11-12/congress-2026-11-21/exomind-position.md`、同目录 `representative-reports.json` |
| ExoMind 固定命令、AgentNote 与 Human 区分 | `crates/exomind-core/src/lib.rs:201`、`crates/exomind-beta-host/src/lib.rs:545`、`crates/exomind-beta-host/src/lib.rs:674`、`crates/exomind-beta-host/src/lib.rs:772` |
| Host 独占 root | `crates/exomind-beta-host/src/storage.rs:239` |
| Host HTTP 强制 loopback | `crates/exomind-beta-host/src/http.rs:729` |
| 当前外部 grant 能力 | `crates/exomind-beta-host/src/agent_access.rs:9`、`docs/development/beta-agent-grants.md` |
| ACP 当前尚未在 ExoMind 实现 | 本仓库源码与文档只出现“future ACP”旧架构草案，没有当前 Beta ACP adapter、binary、Native command 或 E2E evidence |

本文件是后续实现和代表大会讨论的共同输入，不是 Beta25 候选、构建或验收记录。若进入实现，必须另开失败回归和精确候选门禁，不能回填到已冻结 Beta25。
